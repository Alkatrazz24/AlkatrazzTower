'use strict';
// La documentation : toute la doc « humaine » d'un projet, rangee par etageres, que ali lit dans la tour
// et que les sessions consultent en cas de question. Et la regle « doc obligatoire » : une session ou un
// agent qui modifie le jeu ecrit sa doc dans docs/ avant de finir, sinon la tour l'arrete (hook Stop).
//
// Ce qui est lu (lecture seule, rien n'est ecrit dans docs/ par la tour) :
//   - docs/ : les fichiers a la racine (vue d'ensemble), puis une etagere par sous-dossier (bible,
//     decisions, idees, chantiers, memoire...) ; docs/README.md dit ou ecrire quoi ;
//   - CLAUDE.md et les skills du projet (.claude/skills/*/SKILL.md) : les regles et les procedures ;
//   - Saved/Tour : les carnets des sujets et des features, le tableau, les rapports et les plans ;
//   - les docs de packs tiers copiees dans le projet (dossiers *.docs et *.wiki a la racine).
// La tour ecrit un seul fichier, hors du depot : Saved/Tour/doc-unreal.md, le rayon Unreal Engine
// (les pages de la doc officielle par theme), que les sessions ouvrent quand elles se posent une question.

const fs = require('fs');
const path = require('path');
const unreal = require('./unreal');

const TEXT = /\.(md|markdown|txt)$/i;
const MAX_FILES = 1500;
const MAX_READ = 512 * 1024;

// Etageres connues de docs/ (les autres sous-dossiers prennent leur nom de dossier).
const KNOWN = {
  bible: ['La bible', 'Le canon du monde et la direction artistique. Elle prime.'],
  decisions: ['Décisions', 'Pourquoi tel choix (un ADR par décision).'],
  idees: ['Idées', 'Les fiches d\'idées, avant qu\'elles deviennent des chantiers.'],
  chantiers: ['Chantiers', 'Comment une idée devient un chantier.'],
  memoire: ['Mémoire', 'Copie versionnée de la mémoire de Claude Code sur le projet.'],
  musique: ['Musique', 'Les morceaux et les ambiances.'],
  visuels: ['Visuels', 'Les prompts et références d\'images.'],
};

// ---- chemins ----------------------------------------------------------------------------------
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
// Le chemin d'un fichier relatif a la racine du projet (avec des /), ou null s'il est ailleurs.
function relTo(root, file, cwd) {
  if (!root || !file) return null;
  let f = norm(file);
  if (!/^([a-z]:)?\//i.test(f)) f = norm(path.posix.join(norm(cwd || root), f));
  const r = norm(root);
  if (f.toLowerCase() === r.toLowerCase()) return '';
  if (!f.toLowerCase().startsWith(r.toLowerCase() + '/')) return null;
  return path.posix.normalize(f.slice(r.length + 1));
}

// Ce qui compte comme une modification du jeu : le code, les assets, la config, les plugins du projet
// (pas celui de la tour, un lien vers son depot), les outils, le .uproject. Ni docs/, ni Saved/, ni .claude/.
const GAME_DIRS = ['source', 'content', 'config', 'plugins', 'tools'];
function isGameRel(rel) {
  if (rel == null || rel === '' || rel.startsWith('..')) return false;
  const parts = rel.split('/'), top = parts[0].toLowerCase();
  if (parts.length === 1) return /\.uproject$/i.test(rel);
  if (top === 'plugins' && /^alkatrazztower$/i.test(parts[1] || '')) return false;
  return GAME_DIRS.includes(top);
}
// Ce qui compte comme de la doc ecrite : docs/ (texte), et les skills du projet (une procedure).
function isDocRel(rel) {
  if (rel == null || rel.startsWith('..')) return false;
  const low = rel.toLowerCase();
  return (low.startsWith('docs/') && TEXT.test(low)) || (low.startsWith('.claude/skills/') && TEXT.test(low));
}

// ---- lecture ----------------------------------------------------------------------------------
function titleOf(file, name) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      let text = buf.slice(0, n).toString('utf8').replace(/^﻿/, '');
      text = text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, (fm) => { const m = /^name:\s*(.+)$/m.exec(fm); return m ? `# ${m[1]}\n` : ''; });
      const m = /^#{1,3}\s+(.+?)\s*#*\s*$/m.exec(text);
      if (m) return m[1].replace(/[*_`]/g, '').slice(0, 120);
    } finally { fs.closeSync(fd); }
  } catch { /* illisible : on garde le nom du fichier */ }
  return name.replace(TEXT, '').replace(/[-_]+/g, ' ');
}
function entry(root, rel) {
  const file = path.join(root, ...rel.split('/'));
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return { rel, title: titleOf(file, path.posix.basename(rel)), mtime: Math.round(st.mtimeMs) };
  } catch { return null; }
}
function walk(root, relDir, { depth = 6, only = null } = {}, out = []) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, ...relDir.split('/')), { withFileTypes: true }); } catch { return out; }
  for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_FILES) break;
    if (d.name.startsWith('.') && relDir !== '.claude') continue;
    const rel = relDir ? `${relDir}/${d.name}` : d.name;
    if (d.isDirectory()) { if (depth > 0) walk(root, rel, { depth: depth - 1, only }, out); continue; }
    if (!TEXT.test(d.name) || (only && !only.test(d.name))) continue;
    const e = entry(root, rel);
    if (e) out.push(e);
  }
  return out;
}
const byDate = (a, b) => b.mtime - a.mtime;

// Les etageres d'un projet, dans l'ordre de lecture.
function shelves(root) {
  const out = [];
  const push = (id, title, why, files, sort) => { if (files.length) out.push({ id, title, why, files: sort ? files.sort(sort) : files }); };
  // racine de docs/ : la vue d'ensemble, README en premier
  let top = [], subs = [];
  try {
    for (const d of fs.readdirSync(path.join(root, 'docs'), { withFileTypes: true })) {
      if (d.isDirectory()) subs.push(d.name);
      else if (TEXT.test(d.name)) { const e = entry(root, `docs/${d.name}`); if (e) top.push(e); }
    }
  } catch { /* pas de docs/ */ }
  top.sort((a, b) => (/^readme/i.test(b.rel.split('/').pop()) - /^readme/i.test(a.rel.split('/').pop())) || a.rel.localeCompare(b.rel));
  const claude = entry(root, 'CLAUDE.md');
  push('ensemble', 'Vue d\'ensemble', 'Où écrire quoi (README), l\'architecture, la feuille de route, et les règles du projet (CLAUDE.md).', [...top, ...(claude ? [claude] : [])]);
  const order = Object.keys(KNOWN);
  subs.sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  for (const s of subs) {
    if (s.startsWith('.')) continue;
    const [title, why] = KNOWN[s.toLowerCase()] || [s.charAt(0).toUpperCase() + s.slice(1), ''];
    push(`docs-${s}`, title, why, walk(root, `docs/${s}`));
  }
  push('skills', 'Procédures (skills du projet)', 'Comment on fait : une recette, un piège d\'outil. L\'agent la charge quand le sujet s\'y prête.', walk(root, '.claude/skills', { depth: 2, only: /^skill\.md$/i }));
  const tour = [...walk(root, 'Saved/Tour/sujets', { depth: 0 }), ...walk(root, 'Saved/Tour/features', { depth: 0 })];
  const board = entry(root, 'Saved/Tour/tableau.md');
  push('tour', 'Carnets et tableau', 'La mémoire de chaque sujet et de chaque feature, et le tableau où ils se parlent.', [...(board ? [board] : []), ...tour.sort(byDate)]);
  push('rapports', 'Rapports et plans', 'Ce que les tâches de la tour ont rendu.', [...walk(root, 'Saved/Tour/rapports', { depth: 1 }), ...walk(root, 'Saved/Tour/plans', { depth: 1 })], byDate);
  return out;
}

// Les docs de packs tiers copiees dans le projet (Infima.docs, SKGSFExample.wiki...) : rayon Unreal.
function thirdParty(root) {
  const out = [];
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !/\.(docs|wiki)$/i.test(d.name)) continue;
      const files = walk(root, d.name, { depth: 3 });
      if (files.length) out.push({ id: `tiers-${d.name.toLowerCase()}`, title: d.name.replace(/\.(docs|wiki)$/i, ''), why: `Doc du pack, copiée dans ${d.name}/`, files });
    }
  } catch { /* dossier illisible */ }
  return out;
}

// Un chemin que la tour accepte de lire : dans les etageres, jamais ailleurs dans le projet.
function readable(rel) {
  rel = path.posix.normalize(norm(rel));
  if (!rel || rel.startsWith('..') || rel.startsWith('/') || /^[a-z]:/i.test(rel) || !TEXT.test(rel)) return null;
  const low = rel.toLowerCase();
  if (low === 'claude.md' || low.startsWith('docs/') || /^\.claude\/skills\/[^/]+\/skill\.md$/.test(low) || low.startsWith('saved/tour/')) return rel;
  if (/^[^/]+\.(docs|wiki)\//.test(low)) return rel;
  return null;
}
function readDoc(root, rel) {
  const ok = readable(rel);
  if (!root || !ok) return { ok: false, error: 'Ce fichier n\'est pas dans la documentation.' };
  const file = path.join(root, ...ok.split('/'));
  if (!path.resolve(file).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep.toLowerCase())) return { ok: false, error: 'chemin refusé' };
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(st.size, MAX_READ), buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, 0);
      return { ok: true, path: ok, mtime: st.mtimeMs, text: buf.toString('utf8').replace(/^﻿/, '') + (st.size > MAX_READ ? '\n\n… (la suite est coupée : fichier trop long)' : '') };
    } finally { fs.closeSync(fd); }
  } catch { return { ok: false, error: 'Fichier introuvable.' }; }
}

// Recherche plein texte, sans accents ni casse, dans toutes les etageres.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function search(root, q, { max = 40 } = {}) {
  const words = fold(q).split(/\s+/).filter(w => w.length > 1).slice(0, 6);
  if (!root || !words.length) return { ok: true, q, hits: [] };
  const all = [...shelves(root), ...thirdParty(root)];
  const hits = [];
  for (const sh of all) for (const f of sh.files) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, ...f.rel.split('/')), 'utf8').slice(0, MAX_READ); } catch { continue; }
    const low = fold(text), title = fold(f.title);
    if (!words.every(w => low.includes(w) || title.includes(w))) continue;
    // la ligne qui contient le plus de mots cherches
    let best = '', score = -1;
    for (const line of text.split(/\r?\n/)) {
      const l = fold(line), s = words.filter(w => l.includes(w)).length;
      if (s > score && line.trim() && !/^\s*#/.test(line)) { best = line.trim(); score = s; if (s === words.length) break; }
    }
    const inTitle = words.filter(w => title.includes(w)).length;
    hits.push({ rel: f.rel, title: f.title, shelf: sh.title, line: best.replace(/^[#>*\-\s]+/, '').slice(0, 220), score: inTitle * 3 + score, mtime: f.mtime });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return { ok: true, q, hits: hits.slice(0, max), total: hits.length };
}

// ---- le rayon Unreal Engine -------------------------------------------------------------------
// Les pages de la doc officielle, par theme. Adresses verifiees le 2026-10-10 ; ?application_version=X
// epingle la version du moteur du projet.
const UE_THEMES = [
  ['Les bases', [
    ['Accueil de la doc', null], ['Référence API C++', 'API'], ['Standard de code Epic', 'epic-cplusplus-coding-standard-for-unreal-engine'],
    ['Gameplay Framework', 'gameplay-framework-in-unreal-engine'], ['Réflexion, UPROPERTY, UFUNCTION', 'reflection-system-in-unreal-engine'],
    ['Spécificateurs de métadonnées', 'metadata-specifiers-in-unreal-engine'], ['Blueprints', 'blueprints-visual-scripting-in-unreal-engine'],
    ['Blueprints et C++', 'exposing-gameplay-elements-to-blueprints-visual-scripting-in-unreal-engine'], ['Gameplay Tags', 'using-gameplay-tags-in-unreal-engine'],
    ['Data Assets', 'data-assets-in-unreal-engine'], ['Tables de données', 'data-driven-gameplay-elements-in-unreal-engine'], ['Sauvegarder la partie', 'saving-and-loading-your-game-in-unreal-engine'],
    ['Logs', 'logging-in-unreal-engine'], ['Nommage des assets', 'recommended-asset-naming-conventions-in-unreal-engine-projects'],
  ]],
  ['Compiler, tester, livrer', [
    ['Modules et Build.cs', 'module-properties-in-unreal-engine'], ['Unreal Build Tool', 'unreal-build-tool-in-unreal-engine'],
    ['Live Coding', 'using-live-coding-to-recompile-unreal-engine-applications-at-runtime'], ['Écrire des tests C++', 'write-cplusplus-tests-in-unreal-engine'],
    ['Lancer les tests', 'run-automation-tests-in-unreal-engine'], ['Cook, package, BuildCookRun', 'build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine'],
    ['Unreal Insights (profilage)', 'unreal-insights-in-unreal-engine'], ['Scripts Python de l\'éditeur', 'scripting-the-unreal-editor-using-python'],
  ]],
  ['Personnage, animation, contrôles', [
    ['Character Movement', 'movement-components-in-unreal-engine'], ['Enhanced Input', 'enhanced-input-in-unreal-engine'],
    ['Animation Blueprints', 'animation-blueprints-in-unreal-engine'], ['Montages', 'animation-montage-in-unreal-engine'],
    ['Motion Matching', 'motion-matching-in-unreal-engine'], ['Control Rig', 'control-rig-in-unreal-engine'],
    ['Skeletal Meshes', 'skeletal-mesh-assets-in-unreal-engine'], ['Gameplay Ability System', 'gameplay-ability-system-for-unreal-engine'],
  ]],
  ['Interface et menus', [
    ['UMG', 'creating-user-interfaces-with-umg-and-slate-in-unreal-engine'], ['Common UI', 'common-ui-plugin-for-advanced-user-interfaces-in-unreal-engine'],
    ['Widget navigateur web', 'API/Plugins/WebBrowserWidget/UWebBrowser'],
  ]],
  ['Image, lumière, effets', [
    ['Matériaux', 'unreal-engine-materials'], ['Éclairer une scène', 'lighting-the-environment-in-unreal-engine'],
    ['Lumen', 'lumen-global-illumination-and-reflections-in-unreal-engine'], ['Nanite', 'nanite-virtualized-geometry-in-unreal-engine'],
    ['Post-process', 'post-process-effects-in-unreal-engine'], ['Niagara (effets)', 'creating-visual-effects-in-niagara-for-unreal-engine'],
  ]],
  ['Son', [['Le son dans Unreal', 'audio-in-unreal-engine'], ['MetaSounds', 'metasounds-in-unreal-engine']]],
  ['Ennemis et IA', [
    ['Intelligence artificielle', 'artificial-intelligence-in-unreal-engine'], ['Behavior Trees', 'behavior-trees-in-unreal-engine'],
    ['StateTree', 'state-tree-in-unreal-engine'], ['Navigation (NavMesh)', 'navigation-system-in-unreal-engine'],
  ]],
  ['Réseau et multijoueur', [
    ['Réseau et multijoueur', 'networking-and-multiplayer-in-unreal-engine'], ['Réplication des acteurs', 'replicate-actor-properties-in-unreal-engine'],
    ['RPC', 'remote-procedure-calls-in-unreal-engine'], ['Steam', 'online-subsystem-steam-interface-in-unreal-engine'],
  ]],
  ['Monde et niveaux', [
    ['Level design', 'level-designer-quick-start-in-unreal-engine'], ['World Partition', 'world-partition-in-unreal-engine'],
    ['Génération procédurale (PCG)', 'procedural-content-generation-overview'], ['Physique (Chaos)', 'physics-in-unreal-engine'],
    ['Collisions', 'collision-in-unreal-engine'], ['Importer des assets', 'importing-assets-directly-into-unreal-engine'],
    ['Cinématiques (Sequencer)', 'cinematics-and-movie-making-in-unreal-engine'],
  ]],
];
function ueShelf(v) {
  const q = v ? `?application_version=${v}` : '';
  const base = 'https://dev.epicgames.com/documentation/en-us/unreal-engine';
  const home = v ? `unreal-engine-${v.replace('.', '-')}-documentation` : '';
  return UE_THEMES.map(([theme, pages]) => ({ theme, pages: pages.map(([title, slug]) => ({ title, url: `${base}/${slug || home}${q}` })) }));
}

// La regle « doc Unreal » : 'question' (en cas de question sur la facon de creer ou d'utiliser
// quelque chose) ou 'modif' (avant chaque modification, l'ancienne regle).
const UNREAL_MODES = ['question', 'modif'];

// Le fichier Saved/Tour/doc-unreal.md : le rayon Unreal en texte, pour les sessions.
const UE_FILE = 'Saved/Tour/doc-unreal.md';
function ueMarkdown(project, extra = []) {
  const v = unreal.engineVersion(project.uproject);
  const dir = unreal.engineDir(v);
  const lines = [`# Doc Unreal Engine ${v || '5'} : le rayon`, '',
    'Écrit par Alkatrazz Tower, ne pas modifier à la main. La doc officielle, rangée par thème : ouvre la page du',
    'thème quand tu te demandes comment créer ou utiliser quelque chose (WebFetch), et cite la page consultée.', ''];
  for (const s of ueShelf(v)) { lines.push(`## ${s.theme}`, '', ...s.pages.map(p => `- ${p.title} : ${p.url}`), ''); }
  if (dir) lines.push('## Signatures exactes', '', `Les en-têtes du moteur installé font foi : cherche avec Grep dans ${path.join(dir, 'Engine', 'Source')} et ${path.join(dir, 'Engine', 'Plugins')}.`, '');
  if (extra.length) lines.push('## Docs de packs copiées dans le projet', '', ...extra.map(t => `- ${t.title} : ${t.files[0].rel.split('/')[0]}/ (${t.files.length} pages)`), '');
  return lines.join('\n');
}
function writeUeFile(project, extra) {
  const file = path.join(project.root, ...UE_FILE.split('/'));
  const text = ueMarkdown(project, extra);
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return true;
  } catch { return false; }
}

// Ce que la tour montre d'un projet.
function scan(project) {
  const root = project.root;
  const v = unreal.engineVersion(project.uproject);
  const list = shelves(root), extra = thirdParty(root);
  writeUeFile(project, extra);
  return {
    project: project.name, version: v || '', engineDir: unreal.engineDir(v) || '', hasReadme: fs.existsSync(path.join(root, 'docs', 'README.md')),
    shelves: list, tiers: extra, ue: ueShelf(v), ueFile: UE_FILE,
    total: list.reduce((n, s) => n + s.files.length, 0),
  };
}

// ---- la regle « doc obligatoire » -------------------------------------------------------------
// La tour suit, pour chaque session, les fichiers du jeu modifies depuis sa derniere ecriture de doc
// (pour la session entiere, et pour chaque sous-agent). Le hook Stop (fin de tour) ou SubagentStop
// (fin d'un agent) lui demande s'il peut finir : s'il reste des modifications sans doc, la tour
// renvoie la raison, et Claude Code fait continuer la session pour qu'elle l'ecrive. Une seule fois
// par fin : si elle s'arrete quand meme (stop_hook_active), la session reste « doc en retard ».
const WRITE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

function trackOf(a) {
  if (!a.docTrack) a.docTrack = { pending: [], subs: {}, written: [], owed: null };
  return a.docTrack;
}
function addUnique(list, rel, max = 30) { if (!list.includes(rel)) { list.push(rel); if (list.length > max) list.shift(); } }

// Un evenement d'outil (PostToolUse) : une modification du jeu, ou de la doc.
function track(a, ev, now = Date.now()) {
  if (!a || !a.project || !ev || ev.hook_event_name !== 'PostToolUse' || !WRITE_TOOLS.test(ev.tool_name || '')) return null;
  const file = ev.tool_input && (ev.tool_input.file_path || ev.tool_input.path);
  const rel = relTo(a.project.root, file, ev.cwd || a.cwd);
  if (rel == null) return null;
  const T = trackOf(a), sub = ev.agent_id ? String(ev.agent_id) : null;
  const S = sub ? (T.subs[sub] = T.subs[sub] || { pending: [], type: ev.agent_type || 'agent' }) : null;
  if (isDocRel(rel)) {
    T.pending = []; T.owed = null;
    if (S) S.pending = [];
    T.written = [{ rel, at: now, by: sub ? (ev.agent_type || 'agent') : '' }, ...T.written.filter(w => w.rel !== rel)].slice(0, 12);
    return 'doc';
  }
  if (isGameRel(rel)) {
    addUnique(T.pending, rel);
    if (S) addUnique(S.pending, rel);
    return 'game';
  }
  return null;
}

function reason(files, who) {
  const shown = files.slice(-6).map(f => `- ${f}`).join('\n');
  return [`[Alkatrazz Tower] Doc obligatoire : ${who} a modifie le jeu sans ecrire de doc.`, shown, '',
    'Avant de finir, ecris ou mets a jour la doc dans docs/ (docs/README.md dit ou : un ADR dans docs/decisions/',
    'pour un choix, docs/ARCHITECTURE.md pour ce qui existe et ou, une skill pour une procedure, docs/idees/ ou',
    'docs/chantiers/ pour un chantier). En quelques lignes : ce qui a change, ou, pourquoi, et comment le tester.',
    'Mets a jour une page existante plutot que d\'en creer une quand le sujet en a deja une.'].join('\n');
}

// La tour peut-elle laisser finir ? Renvoie { block: raison } ou null.
function check(a, ev, now = Date.now()) {
  if (!a || !a.project || !ev || !a.docTrack) return null;
  const T = a.docTrack, sub = ev.agent_id ? String(ev.agent_id) : null;
  if (ev.hook_event_name === 'SubagentStop' && sub) {
    const S = T.subs[sub];
    const out = S && S.pending.length && !ev.stop_hook_active ? { block: reason(S.pending, `l'agent ${S.type}`) } : null;
    if (!out) delete T.subs[sub];
    return out;
  }
  if (ev.hook_event_name !== 'Stop' || sub) return null;
  if (!T.pending.length) { T.owed = null; return null; }
  if (ev.stop_hook_active) { T.owed = { at: now, files: T.pending.slice(-8) }; return null; }
  T.owed = { at: now, files: T.pending.slice(-8), asked: true };
  return { block: reason(T.pending, 'la session') };
}

// ---- consignes ------------------------------------------------------------------------------
// Les lignes ajoutees au contexte de chaque session (SessionStart) et de chaque agent (SubagentStart)
// sur un projet Unreal. ASCII : elles passent par la console des agents.
function rules(project, { mode = 'question', agent = false } = {}) {
  const v = unreal.engineVersion(project.uproject) || '5';
  const hasReadme = fs.existsSync(path.join(project.root, 'docs', 'README.md'));
  const out = [
    `Regle de la tour, doc obligatoire : ${agent ? 'si tu modifies' : 'toute session et tout agent qui modifie'} le jeu (Source, Content, Config, Plugins, tools, .uproject)`,
    `${agent ? 'ecris ou mets a jour ta' : 'ecrit ou met a jour sa'} doc dans docs/ avant de finir : ce qui a change, ou, pourquoi, comment le tester.`,
    hasReadme ? 'docs/README.md dit ou ecrire quoi. Mets a jour la page du sujet quand elle existe.' : 'Mets a jour la page du sujet quand elle existe.',
    'La tour arrete la fin du tour (et la fin d\'un agent) tant que rien n\'est ecrit dans docs/ apres la modification.',
    'En cas de question sur le projet, cherche d\'abord la reponse dans docs/ (Grep) : c\'est la doc que lit ali.',
    '',
  ];
  if (mode === 'modif') {
    out.push(`Regle de la tour, doc Unreal : AVANT toute modification de code, de Build.cs, de config ou d'asset, verifie dans la`,
      `documentation officielle Unreal Engine ${v} que l'API, le systeme ou le specificateur que tu comptes utiliser existe et`,
      's\'utilise bien ainsi dans cette version. Dis dans ta reponse quelle page ou quel en-tete tu as consulte.');
  } else {
    out.push(`Regle de la tour, doc Unreal : quand tu te poses une question sur la facon de creer ou d'utiliser quelque chose`,
      `dans Unreal (API, systeme, specificateur, outil de l'editeur), consulte la documentation officielle Unreal Engine ${v}`,
      'ou les en-tetes du moteur plutot que ta memoire, et dis quelle page ou quel en-tete tu as consulte. Pas besoin de',
      'la relire pour ce que tu sais deja faire dans cette version.');
  }
  out.push(`Le rayon complet, par theme (animation, interface, IA, reseau, lumiere, son...) : ${UE_FILE}.`);
  return out.join('\n');
}

module.exports = { relTo, isGameRel, isDocRel, shelves, thirdParty, readable, readDoc, search, ueShelf, ueMarkdown, writeUeFile, UE_FILE, UE_THEMES, UNREAL_MODES, scan, track, check, reason, rules };
