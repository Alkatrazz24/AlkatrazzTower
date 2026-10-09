'use strict';
// Campagnes : une version a valider, comme une partie avec une fin.
//
// Une campagne = des niveaux (les features), chacun prouve par des builds ou des tests verts,
// puis un boss final (par defaut un paquet BuildCookRun vert). Aucune E/S ici.
//
// Texte de creation, une ligne par niveau :
//   Munitions | tests:CTB.Munitions
//   Lampe torche | tests:CTB.Lampe, build:ConquerTheBackrooms
//   Menu de raid | manuel
//   Boss | paquet, tests:CTB

const MAX_LOG = 40;

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'niveau';
}

// "tests:CTB.Munitions" -> { type: 'tests', arg: 'CTB.Munitions' }
function parseProof(raw) {
  const s = raw.trim();
  if (!s) return null;
  const [head, ...rest] = s.split(':');
  const arg = rest.join(':').trim() || null;
  const h = head.trim().toLowerCase();
  if (h === 'tests' || h === 'test') return arg ? { type: 'tests', arg } : { type: 'tests', arg: null };
  if (h === 'build' || h === 'compile') return { type: 'build', arg };
  if (h === 'paquet' || h === 'package' || h === 'buildcookrun') return { type: 'package', arg: null };
  if (h === 'manuel' || h === 'manual' || h === 'main') return { type: 'manual', arg: null };
  throw new Error(`preuve inconnue : "${s}" (attendu tests:..., build, build:..., paquet ou manuel)`);
}

function parseCampaignText(text) {
  const features = [];
  let boss = null;
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const [titlePart, proofPart = ''] = l.split('|');
    const title = titlePart.trim();
    if (!title) continue;
    let proofs = proofPart.split(',').map(parseProof).filter(Boolean);
    if (!proofs.length) proofs = [{ type: 'manual', arg: null }];
    if (/^boss\b/i.test(title)) { boss = { title, proofs }; continue; }
    let id = slug(title);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    features.push({ id, title, proofs });
  }
  if (!features.length) throw new Error('au moins un niveau (une feature par ligne)');
  if (!boss) boss = { title: 'Boss final : le paquet', proofs: [{ type: 'package', arg: null }] };
  return { features, boss };
}

function newCampaign({ id, name, project, text, now }) {
  const { features, boss } = parseCampaignText(text);
  const withState = (proofs) => proofs.map(p => ({ ...p, last: null, everOk: false }));
  return {
    id,
    name: String(name || '').trim() || 'Nouvelle version',
    project: String(project || '').trim(),
    text: String(text || ''),
    createdAt: now,
    wonAt: null,
    allProvenAt: null,
    archived: false,
    commit: null,
    features: features.map(f => ({ ...f, proofs: withState(f.proofs) })),
    boss: { ...boss, proofs: withState(boss.proofs) },
    stats: { builds: 0, failures: 0, agents: {} },
    log: [{ at: now, text: 'Campagne lancée' }],
  };
}

// Le test `path` releve-t-il du filtre `prefix` ? CTB.Munitions couvre CTB.Munitions.Recharge.
function under(path, prefix) {
  return path === prefix || path.startsWith(prefix + '.');
}

// Ce que dit un build sur une preuve : { ok } si le build la concerne, sinon null.
function verdictFor(proof, b) {
  if (proof.type === 'manual') return null;
  if (proof.type === 'package') return b.kind === 'package' ? { ok: b.ok } : null;
  if (proof.type === 'build') {
    if (b.kind !== 'build') return null;
    if (!proof.arg) return { ok: b.ok };
    return b.target && b.target.toLowerCase() === proof.arg.toLowerCase() ? { ok: b.ok } : null;
  }
  if (proof.type === 'tests') {
    const t = b.tests;
    if (!t) return null;
    if (!proof.arg) return { ok: b.ok && t.total > 0 };
    const R = proof.arg;
    if (Array.isArray(t.passedPaths) || Array.isArray(t.failedPaths)) {
      const failed = (t.failedPaths || []).filter(p => under(p, R)).length;
      const passed = (t.passedPaths || []).filter(p => under(p, R)).length;
      if (!failed && !passed) return null; // ce run n'a pas touche a ce niveau
      return { ok: failed === 0 && passed > 0 };
    }
    // Sans chemins, on se fie au filtre du run : il couvre R si R est dedans.
    const F = b.testFilter;
    if (!F || !(under(R, F) || under(F, R))) return null;
    return { ok: t.failed === 0 && t.total > 0 };
  }
  return null;
}

function proofsOk(proofs) { return proofs.every(p => p.last && p.last.ok); }

function featureStatus(f) {
  if (proofsOk(f.proofs)) return 'proven';
  if (f.proofs.some(p => p.last && !p.last.ok && p.everOk)) return 'broken';
  if (f.proofs.some(p => p.last && !p.last.ok)) return 'failing';
  if (f.proofs.some(p => p.last)) return 'progress';
  return 'todo';
}

function addLog(c, at, text) {
  c.log.unshift({ at, text });
  if (c.log.length > MAX_LOG) c.log.length = MAX_LOG;
}

// Enregistre un build dans une campagne. Renvoie true si quelque chose a change.
function applyBuild(c, b) {
  if (c.wonAt || c.archived) return false;
  if (c.project && b.project && c.project.toLowerCase() !== b.project.toLowerCase()) return false;
  if (c.project && !b.project) return false;
  c.stats.builds++;
  if (!b.ok) c.stats.failures++;
  if (b.label) c.stats.agents[b.sessionId || b.label] = b.label;
  let changed = true;

  const before = c.features.map(featureStatus);
  const bossBefore = proofsOk(c.boss.proofs);
  for (const p of [...c.features.flatMap(f => f.proofs), ...c.boss.proofs]) {
    const v = verdictFor(p, b);
    if (!v) continue;
    p.last = { ok: v.ok, at: b.endedAt, buildId: b.id, summary: b.summary, label: b.label, failedNames: (b.tests && b.tests.failedNames) || [] };
    if (v.ok) p.everOk = true;
  }
  c.features.forEach((f, i) => {
    const now = featureStatus(f);
    if (now === before[i]) return;
    if (now === 'proven') addLog(c, b.endedAt, `Niveau gagné : ${f.title}`);
    else if (now === 'broken') addLog(c, b.endedAt, `Régression : ${f.title} est repassé au rouge`);
  });
  trackAllProven(c, b.endedAt);
  if (!bossBefore && proofsOk(c.boss.proofs) && !allFeatures(c)) {
    addLog(c, b.endedAt, 'Le boss est vert, mais il reste des niveaux : il faudra le rebattre');
  }
  return changed;
}

function allFeatures(c) { return c.features.every(f => featureStatus(f) === 'proven'); }

// Retient l'instant ou tous les niveaux sont devenus verts ensemble (efface a la premiere regression).
function trackAllProven(c, at) {
  if (allFeatures(c)) {
    if (!c.allProvenAt) { c.allProvenAt = at; addLog(c, at, 'Tous les niveaux sont gagnés : le boss est déverrouillé'); }
  } else {
    c.allProvenAt = null;
  }
}

// Le boss ne compte que s'il est vert APRES que tous les niveaux le sont devenus.
function checkVictory(c, now) {
  if (c.wonAt || c.archived) return false;
  if (!allFeatures(c) || !proofsOk(c.boss.proofs) || !c.allProvenAt) return false;
  const bossAt = Math.min(...c.boss.proofs.map(p => p.last.at));
  if (c.boss.proofs.some(p => p.type !== 'manual') && bossAt < c.allProvenAt) return false;
  c.wonAt = now;
  addLog(c, now, `Version validée : ${c.name}`);
  return true;
}

function setManual(c, featureId, ok, now, who) {
  if (c.wonAt || c.archived) return false;
  const target = featureId === 'boss' ? c.boss : c.features.find(f => f.id === featureId);
  if (!target) return false;
  const p = target.proofs.find(x => x.type === 'manual');
  if (!p) return false;
  const was = featureId === 'boss' ? null : featureStatus(target);
  p.last = ok ? { ok: true, at: now, summary: 'validé à la main', label: who || 'Ali' } : null;
  if (ok) p.everOk = true;
  if (featureId !== 'boss') {
    const st = featureStatus(target);
    if (st !== was && st === 'proven') addLog(c, now, `Niveau gagné : ${target.title}`);
    trackAllProven(c, now);
  }
  return true;
}

// Vue calculee pour la page.
function view(c) {
  const features = c.features.map(f => ({ ...f, status: featureStatus(f) }));
  const proven = features.filter(f => f.status === 'proven').length;
  return {
    ...c,
    features,
    progress: { proven, total: features.length },
    bossUnlocked: proven === features.length,
    bossStatus: proofsOk(c.boss.proofs) ? 'proven' : c.boss.proofs.some(p => p.last && !p.last.ok) ? 'failing' : 'todo',
  };
}

module.exports = { parseCampaignText, parseProof, newCampaign, applyBuild, checkVictory, setManual, view, featureStatus, verdictFor };
