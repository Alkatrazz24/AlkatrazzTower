'use strict';
// Socle commun des templates de la tour : flux en direct, modele de donnees, actions, dialogues.
// Un template ne fait que dessiner : il s'enregistre avec Tower.register({ id, render(root, M) })
// et recoit a chaque changement le modele M deja calcule (agents, verrou, version, carte...).
//   ?t=<id>   choisit un template (retenu dans le navigateur)
//   ?demo     joue l'etat de demonstration web/demo/state.json, sans serveur

(function () {
  const TEMPLATES = window.TOWER_TEMPLATES;
  const DEFAULT = window.TOWER_DEFAULT;
  const SILENT_MS = 15 * 60 * 1000;
  const STATUS = { working: 'travaille', waiting: 'attend ta réponse', idle: 'a fini, à toi', ready: 'prêt', ended: 'terminé', silent: 'silencieux' };
  const KIND = { build: 'Compilation', test: 'Tests', package: 'Package', commandlet: 'Commandlet', livecoding: 'Live Coding' };
  const FEAT = { proven: 'Prête', progress: 'En cours', failing: 'En échec', broken: 'Cassée', todo: 'À vérifier' };
  // Reglages par l'adresse : ?demo&t=nuit, ou #demo.nuit (le # passe la ou ?... est retire).
  const params = new URLSearchParams(location.search);
  const hashTokens = location.hash.slice(1).split('.').filter(Boolean);
  const DEMO = params.has('demo') || hashTokens.includes('demo');

  // ---------- outils ----------
  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  }
  function svg(html) { const d = document.createElement('span'); d.innerHTML = html; return d.firstElementChild; }
  let skew = 0;
  const now = () => Date.now() - skew;
  function ago(t) {
    if (!t) return '';
    const s = Math.max(0, Math.round((now() - t) / 1000));
    if (s < 60) return 'à l\'instant';
    const m = Math.floor(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const hh = Math.floor(m / 60);
    return hh < 24 ? `il y a ${hh} h ${String(m % 60).padStart(2, '0')}` : `il y a ${Math.floor(hh / 24)} j`;
  }
  function dur(ms) {
    if (ms == null) return '';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')}`;
    const hh = Math.floor(m / 60);
    return hh < 48 ? `${hh} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(hh / 24)} jours`;
  }
  function clock(t) { return t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; }
  function folder(p) { return (p || '').split(/[\\/]/).filter(Boolean).pop() || ''; }
  function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }
  function lower(t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }
  const num = (n) => Number(n || 0).toLocaleString('fr-FR');
  // Texte qui vieillit tout seul : <span data-ago=ts> et <span data-for=ts> sont remis a jour chaque seconde.
  const agoEl = (t, tag = 'span', attrs = {}) => h(tag, { ...attrs, 'data-ago': t }, ago(t));
  const forEl = (t, tag = 'span', attrs = {}) => h(tag, { ...attrs, 'data-for': t }, dur(now() - t));
  function tickTexts() {
    document.querySelectorAll('[data-ago]').forEach(e => { const v = ago(+e.dataset.ago); if (e.textContent !== v) e.textContent = v; });
    document.querySelectorAll('[data-for]').forEach(e => { const v = dur(now() - +e.dataset.for); if (e.textContent !== v) e.textContent = v; });
  }

  let S = null, connected = false;
  async function api(path, body) {
    if (DEMO) { toast('Mode démo : rien n\'est envoyé à la tour.'); return null; }
    try { return await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json()); }
    catch { return null; }
  }
  function toast(text) {
    let t = $('tw-toast');
    if (!t) { t = h('div', { id: 'tw-toast', class: 'tw-toast', role: 'status' }); document.body.append(t); }
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // Etat d'interface garde d'un rendu a l'autre.
  const ui = { showEnded: false, openBuilds: new Set(), mapProject: null, mapRoom: 'maison', journalOpen: false };

  // ---------- modele ----------
  function statusOf(a) { return a.status === 'working' && now() - a.lastSeen > SILENT_MS ? 'silent' : a.status; }
  function agentName(a) { return a.title || (a.project ? a.project.name : folder(a.cwd) || 'agent'); }
  function charOf(a) { return (S.characters || {})[a.characterId] || null; }

  function checkText(p) {
    if (p.type === 'tests') return p.arg ? `Tests d'automatisation ${p.arg}` : 'Tests d\'automatisation';
    if (p.type === 'build') return p.arg ? `Compilation de ${p.arg}` : 'Le jeu compile';
    if (p.type === 'package') return 'Le jeu se package (BuildCookRun)';
    return 'Testée en jeu par toi';
  }
  function checkOf(p, locked) {
    const base = { type: p.type, text: checkText(p), at: p.last ? p.last.at : null };
    if (locked && p.last) return { ...base, ok: null, verb: 'à refaire', detail: 'une fois les features prêtes' };
    if (!p.last) return { ...base, ok: null, verb: p.type === 'manual' ? 'pas encore' : 'pas encore lancé', detail: '' };
    const verb = p.type === 'manual' ? 'validée' : p.type === 'tests' ? (p.last.ok ? 'passent' : 'échouent') : (p.last.ok ? 'réussi' : 'échoué');
    return { ...base, ok: p.last.ok, verb, detail: p.last.summary && p.type !== 'manual' ? p.last.summary : '', failed: p.last.failedNames || [] };
  }
  function whyFailed(p) {
    const n = p && p.last && p.last.failedNames;
    return n && n.length ? ` (${n.slice(0, 3).join(', ')}${n.length > 3 ? '…' : ''})` : '';
  }
  function nextStep(c) {
    const fs = c.features;
    const firstBad = (f) => f.proofs.find(p => p.last && !p.last.ok);
    const broken = fs.find(f => f.status === 'broken');
    if (broken) return { tone: 'ko', feature: broken, text: `« ${broken.title} » marchait et ne marche plus : ${lower(checkText(firstBad(broken)))} en échec${whyFailed(firstBad(broken))}. À corriger en priorité.` };
    const failing = fs.find(f => f.status === 'failing');
    if (failing) return { tone: 'ko', feature: failing, text: `« ${failing.title} » : ${lower(checkText(firstBad(failing)))} en échec${whyFailed(firstBad(failing))}. Un agent doit corriger puis relancer.` };
    const todo = fs.find(f => f.status === 'todo' || f.status === 'progress');
    if (todo) {
      const p = todo.proofs.find(x => !x.last || !x.last.ok);
      if (p.type === 'manual') return { tone: 'you', feature: todo, text: `Essaie « ${todo.title} » en jeu, puis clique sur « Je l'ai testée ».` };
      if (p.type === 'tests') return { tone: 'info', feature: todo, text: `« ${todo.title} » n'a pas encore été vérifiée : un agent doit lancer les tests ${p.arg || ''}.` };
      if (p.type === 'build') return { tone: 'info', feature: todo, text: `« ${todo.title} » : il faut une compilation réussie${p.arg ? ' de ' + p.arg : ''}.` };
      return { tone: 'info', feature: todo, text: `« ${todo.title} » : il faut un package réussi.` };
    }
    const finalLeft = c.boss.proofs.find(p => !p.last || !p.last.ok || (c.allProvenAt && p.last.at < c.allProvenAt));
    if (finalLeft) return { tone: 'info', feature: null, text: `Toutes les features sont prêtes. Dernière épreuve : ${c.boss.proofs.map(p => lower(checkText(p))).join(' et ')}.` };
    return { tone: 'ok', feature: null, text: 'Tout est vert : la version va être validée.' };
  }

  function docsOf(a) {
    if (!a.project) return null;
    const d = a.docs;
    if (d && d.count) return { tone: 'ok', text: `doc UE consultée (${d.count})`, detail: d.last ? d.last.what : '', at: d.last ? d.last.at : null };
    if (a.edits) return { tone: 'warn', text: `doc UE pas consultée, alors qu'il a déjà modifié ${plural(a.edits, 'fichier', 'fichiers')}` };
    return { tone: 'none', text: 'doc UE pas encore consultée' };
  }

  function model() {
    const R = window.ProjectMap ? window.ProjectMap.ROOMS : {};
    const agents = S.agents.map(a => {
      const st = statusOf(a);
      const ch = charOf(a);
      const queuePos = S.queue.findIndex(e => e.sessionId === a.sessionId) + 1;
      return {
        id: a.sessionId, raw: a, st, stText: STATUS[st] || st,
        name: ch ? ch.name : agentName(a), role: ch ? agentName(a) : '', char: ch, look: ch ? ch.look : {},
        holds: !!(S.lock && S.lock.sessionId === a.sessionId), queuePos,
        ask: st === 'waiting' ? a.message : '', said: st === 'idle' ? a.message : '',
        prompt: a.prompt, tool: a.tool, subs: Object.keys(a.subagents || {}).length,
        lastBuild: a.lastBuild, lastTest: a.lastTest, docs: docsOf(a), error: a.lastError,
        where: folder(a.cwd), project: a.project ? a.project.name : '', lastSeen: a.lastSeen,
        room: a.room || null, roomName: a.room && R[a.room] ? R[a.room][0] : '',
        usage: a.usage || null, task: a.task || null,
      };
    });
    const live = agents.filter(x => x.st !== 'ended');
    const count = (s) => agents.filter(x => x.st === s).length;
    const byId = Object.fromEntries(agents.map(x => [x.id, x]));

    // Editeur : ce que dit le plugin, sinon ce que voit la sonde de processus.
    const pluginEd = Object.values(S.editors || {}).filter(x => now() - x.lastSeen < 15000);
    const e = S.editor || {};
    let editor;
    if (pluginEd.length) {
      const x = pluginEd[0];
      const bits = [];
      if (x.map) bits.push(x.map);
      if (x.pie) bits.push('PIE en cours');
      if (x.liveCoding && x.liveCoding.compiling) bits.push('Live Coding compile');
      if (x.dirty) bits.push(`${x.dirty} non sauvegardé${x.dirty > 1 ? 's' : ''}`);
      editor = { known: true, open: true, plugin: true, project: x.project, map: x.map, pie: x.pie, liveCoding: x.liveCoding || {}, dirty: x.dirty, dirtyNames: x.dirtyNames || [], openAssets: x.openAssets || [], lastSaved: x.lastSaved, more: pluginEd.length - 1, text: bits.join(' · ') || 'ouvert' };
    } else editor = { known: !!e.checkedAt, open: !!e.open, plugin: false, count: e.count || 0, dirty: 0, dirtyNames: [], text: e.checkedAt ? (e.open ? `ouvert${e.count > 1 ? ' ×' + e.count : ''}` : 'fermé') : 'inconnu' };

    // Version a sortir
    const camps = S.campaigns || [];
    const c = camps.find(x => !x.archived && !x.wonAt) || camps.find(x => !x.archived) || null;
    let campaign = null;
    if (c) {
      const locked = !c.bossUnlocked && !c.wonAt;
      campaign = {
        raw: c, id: c.id, name: c.name, project: c.project, won: !!c.wonAt, wonAt: c.wonAt, createdAt: c.createdAt,
        proven: c.progress.proven, total: c.progress.total, pct: c.progress.total ? Math.round(100 * c.progress.proven / c.progress.total) : 0,
        next: c.wonAt ? null : nextStep(c),
        features: c.features.map(f => {
          const mp = f.proofs.find(p => p.type === 'manual');
          return { id: f.id, title: f.title, status: f.status, statusText: FEAT[f.status], checks: f.proofs.map(p => checkOf(p)), manual: mp && !c.wonAt ? { done: !!(mp.last && mp.last.ok) } : null };
        }),
        final: { locked, won: !!c.wonAt, status: c.wonAt ? 'proven' : locked ? 'locked' : c.bossStatus === 'failing' ? 'failing' : 'final', statusText: c.wonAt ? 'Réussie' : locked ? 'Verrouillée' : c.bossStatus === 'failing' ? 'En échec' : 'À jouer', checks: c.boss.proofs.map(p => checkOf(p, locked)) },
        stats: { builds: c.stats.builds, failures: c.stats.failures, agents: Object.keys(c.stats.agents || {}).length },
        commit: c.commit || null, log: c.log || [],
      };
    }
    const past = camps.filter(x => x.archived).map(x => ({ id: x.id, name: x.name, won: !!x.wonAt, wonAt: x.wonAt }));

    // Ce qui attend ali, du plus urgent au moins urgent.
    const attention = [];
    for (const x of live.filter(x => x.st === 'waiting')) attention.push({ tone: 'warn', kind: 'waiting', agent: x, title: `${x.name} attend ta réponse`, text: x.ask || 'Une question dans sa session Claude Code.' });
    if (campaign && !campaign.won) {
      for (const f of campaign.features.filter(f => f.status === 'broken' || f.status === 'failing')) {
        const bad = f.checks.find(k => k.ok === false);
        attention.push({ tone: 'ko', kind: f.status, feature: f, title: f.status === 'broken' ? `${f.title} ne marche plus` : `${f.title} est en échec`, text: `${bad ? bad.text + ' : ' + (bad.detail || bad.verb) : ''}${bad && bad.failed && bad.failed.length ? ' (' + bad.failed.slice(0, 3).join(', ') + ')' : ''}` });
      }
      for (const f of campaign.features.filter(f => f.manual && !f.manual.done && f.status !== 'proven')) attention.push({ tone: 'you', kind: 'manual', feature: f, title: `À essayer en jeu : ${f.title}`, text: 'Lance une partie, essaie-la, puis confirme ici.' });
    }
    for (const x of live.filter(x => x.st === 'idle')) attention.push({ tone: 'ok', kind: 'idle', agent: x, title: `${x.name} a fini`, text: x.said || 'Sa tâche est terminée, il attend la suite.' });
    if (editor.plugin && editor.dirty) attention.push({ tone: 'info', kind: 'dirty', title: `${plural(editor.dirty, 'asset non sauvegardé', 'assets non sauvegardés')} dans l'éditeur`, text: editor.dirtyNames.join(', ') });

    const L = S.lock;
    const lock = L ? { raw: L, kind: L.kind, kindText: KIND[L.kind] || L.kind, label: L.label, agent: byId[L.sessionId] || null, editor: String(L.sessionId).startsWith('editor:'), target: L.target || L.testFilter || '', command: L.command, since: L.grantedAt || L.since } : null;
    const queue = S.queue.map((q, i) => ({ raw: q, pos: i + 1, kind: q.kind, kindText: KIND[q.kind] || q.kind, label: q.label, agent: byId[q.sessionId] || null, since: q.since }));
    const chantiers = Object.entries(S.chantiers || {}).flatMap(([project, files]) => files.map(f => ({ project, file: f.file, text: f.text, mtime: f.mtime })));
    const builds = S.builds.map(b => ({
      raw: b, id: b.id, ok: b.ok, kind: b.kind, kindText: KIND[b.kind] || b.kind, label: b.label, agent: byId[b.sessionId] || null,
      detail: b.target || b.testFilter || '', summary: b.summary, endedAt: b.endedAt, waitMs: b.waitMs, durationMs: b.durationMs,
      how: b.how === 'expired' ? 'plus de nouvelles' : b.how === 'forced' ? 'libéré à la main' : '', command: b.command,
      lines: [...(b.errorLines || []), ...(b.tests && b.tests.failedNames && b.tests.failedNames.length ? ['Tests en échec : ' + b.tests.failedNames.join(', ')] : [])],
    }));

    const invs = Object.values(S.inventories || {}).sort((a, b) => b.assets - a.assets);
    if (!ui.mapProject || !invs.some(i => i.project === ui.mapProject)) ui.mapProject = invs[0] ? invs[0].project : null;
    const inv = invs.find(i => i.project === ui.mapProject) || null;

    const waiting = count('waiting');
    document.title = (waiting ? `(${waiting}) ` : '') + 'Alkatrazz Tower';
    return {
      S, demo: DEMO, connected, now: now(),
      template: current, templates: TEMPLATES,
      agents, liveAgents: live, visibleAgents: agents.filter(x => ui.showEnded || x.st !== 'ended'), endedCount: agents.length - live.length,
      counts: { working: count('working'), waiting, idle: count('idle'), ready: count('ready'), silent: count('silent'), live: live.length },
      editor, projects: S.projects || [], campaign, past, attention, lock, queue, chantiers, builds,
      inventories: invs, inv, testGroups: S.testGroups || {},
    };
  }

  // ---------- carte ----------
  function peopleOn(inv) {
    return S.agents.filter(a => a.status !== 'ended' && a.project && a.project.name === inv.project).map(a => {
      const ch = charOf(a);
      return { look: ch ? ch.look : {}, name: ch ? ch.name : agentName(a), state: statusOf(a), room: a.room, building: !!(S.lock && S.lock.sessionId === a.sessionId) };
    });
  }
  // La carte SVG du projet ; onPick(roomId) quand on clique une extension.
  function mapEl(inv, onPick) {
    const camp = (S.campaigns || []).find(c => !c.archived && c.project === inv.project);
    const box = h('div', { class: 'tw-map' });
    box.innerHTML = window.ProjectMap.render(inv, peopleOn(inv), { campaign: camp, lockHeld: !!S.lock });
    box.querySelectorAll('[data-room]').forEach(el => {
      if (el.dataset.room === ui.mapRoom) el.classList.add('sel');
      const pick = () => { ui.mapRoom = el.dataset.room; (onPick || rerender)(el.dataset.room); };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    return box;
  }
  // Les extensions d'un inventaire, triees par taille, avec leur nom et leur couleur.
  function rooms(inv) {
    const R = window.ProjectMap.ROOMS;
    return Object.values(inv.rooms).filter(r => r.count).sort((a, b) => b.count - a.count)
      .map(r => ({ ...r, name: R[r.id][0], color: R[r.id][1] }));
  }
  function room(inv, id) {
    const r = inv && inv.rooms[id];
    if (!r) return null;
    const R = window.ProjectMap.ROOMS;
    return { ...r, name: R[id][0], color: R[id][1], workers: peopleOn(inv).filter(p => p.room === id).map(p => p.name) };
  }

  // ---------- personnages ----------
  function avatar(look, state, size) { return svg(window.Avatar.render(look, { state, size })); }
  function forge(size, lit) { return svg(window.Avatar.forge(size, lit)); }
  function youAvatar(state, size) { return avatar({ hat: 'casquette', hatColor: '#78a6ff', accessory: 'casque-audio', tool: 'clavier', shirt: '#334155' }, state, size); }

  // ---------- actions ----------
  const act = {
    manual: (featureId, ok) => S && model().campaign && api('/api/campaigns/manual', { id: model().campaign.id, featureId, ok }),
    archive: () => { const c = model().campaign; if (c) api('/api/campaigns/archive', { id: c.id }); },
    abandon: () => { const c = model().campaign; if (c && confirm(`Abandonner la version ${c.name} ?`)) api('/api/campaigns/archive', { id: c.id }); },
    next: () => { act.archive(); openBuilder(); },
    release: () => { if (confirm('Libérer la compilation ? Le build en cours continue, mais un autre pourra démarrer en même temps.')) api('/api/lock/force-release'); },
    forget: (id) => api('/api/agents/forget', { sessionId: id }),
    disconnect: (p) => { if (confirm(`Déconnecter ${p.name} ?`)) api('/api/projects/disconnect', { uproject: p.uproject }); },
    refreshMap: () => { api('/api/inventory/refresh'); toast('La tour recompte le projet.'); },
    toggleEnded: (v) => { ui.showEnded = v === undefined ? !ui.showEnded : v; rerender(); },
    toggleBuild: (id) => { ui.openBuilds.has(id) ? ui.openBuilds.delete(id) : ui.openBuilds.add(id); rerender(); },
    openChar: (id) => openChar(id),
    openProjects: () => openProjects(),
    openBuilder: () => openBuilder(),
  };

  // ---------- dialogues partages ----------
  const STY = {
    hairStyle: [['court', 'Courts'], ['long', 'Longs'], ['chauve', 'Chauve'], ['crete', 'Crête'], ['queue', 'Queue de cheval']],
    shirtStyle: [['uni', 'T-shirt'], ['rayures', 'Rayé'], ['veste', 'Veste'], ['salopette', 'Salopette']],
    hat: [['aucun', 'Aucun'], ['casquette', 'Casquette'], ['casque', 'Casque de chantier'], ['couronne', 'Couronne'], ['bandana', 'Bandana'], ['chapeau', 'Chapeau'], ['capuche', 'Capuche']],
    accessory: [['aucun', 'Aucun'], ['lunettes', 'Lunettes'], ['barbe', 'Barbe'], ['masque', 'Masque'], ['casque-audio', 'Casque audio'], ['cache-oeil', 'Cache-œil']],
    tool: [['aucun', 'Rien'], ['pioche', 'Pioche'], ['marteau', 'Marteau'], ['cle', 'Clé'], ['epee', 'Épée'], ['clavier', 'Clavier'], ['pinceau', 'Pinceau']],
  };
  const COL = [['skin', 'Peau'], ['hair', 'Cheveux'], ['eyes', 'Yeux'], ['shirt', 'Haut'], ['pants', 'Pantalon'], ['shoes', 'Chaussures'], ['hatColor', 'Chapeau'], ['accessoryColor', 'Accessoire']];
  const cap = (k) => 'c' + k[0].toUpperCase() + k.slice(1);

  function buildDialogs() {
    const close = (id) => h('button', { type: 'button', class: 'tw-quiet', onclick: () => $(id).close() }, 'Fermer');
    document.body.append(
      h('dialog', { id: 'projDialog', class: 'tw-dialog' },
        h('div', { class: 'tw-dhead' }, h('h2', null, 'Connecter un projet Unreal'), close('projDialog')),
        h('p', { class: 'tw-hint' }, 'La tour cherche les fichiers .uproject dans tes Documents, ton Bureau et à la racine de tes disques. Choisis ceux que tes agents vont faire avancer.'),
        h('div', { id: 'scanList', class: 'tw-scan' }),
        h('div', { class: 'tw-row' }, h('input', { id: 'projPath', class: 'tw-grow', placeholder: 'Ou colle le chemin d\'un .uproject ou de son dossier' }), h('button', { type: 'button', id: 'projPathBtn' }, 'Connecter')),
        h('div', { id: 'projErr', class: 'tw-err' })),
      h('dialog', { id: 'charDialog', class: 'tw-dialog' },
        h('div', { class: 'tw-dhead' }, h('h2', null, 'Personnage'), close('charDialog')),
        h('div', { class: 'tw-editor' },
          h('div', { class: 'tw-preview' }, h('div', { id: 'cPreview' }), h('button', { type: 'button', id: 'cRandom' }, 'Au hasard')),
          h('div', null,
            h('div', { class: 'tw-fields' },
              h('label', null, 'Nom', h('input', { id: 'cName', maxlength: 32 })),
              h('label', null, 'Rôle (titre de session, facultatif)', h('input', { id: 'cRole', maxlength: 32, placeholder: 'ex. ctb-armes' })),
              h('label', null, 'Cheveux', h('select', { id: 'cHairStyle' })), h('label', null, 'Haut', h('select', { id: 'cShirtStyle' })),
              h('label', null, 'Chapeau', h('select', { id: 'cHat' })), h('label', null, 'Accessoire', h('select', { id: 'cAccessory' })),
              h('label', null, 'Outil', h('select', { id: 'cTool' })), h('label', null, 'Utilisé par cet agent', h('select', { id: 'cAssign' }))),
            h('div', { class: 'tw-colors', id: 'cColors' }),
            h('div', { class: 'tw-askbox' },
              h('b', null, 'Ou demande à Claude'),
              h('span', null, 'Dans n\'importe quelle session Claude Code, dis par exemple :'),
              h('code', { id: 'cAsk' }),
              h('div', { class: 'tw-row' }, h('button', { type: 'button', id: 'cCopy' }, 'Copier'), h('span', { class: 'tw-hint' }, 'Le skill « alkatrazz-tower-personnages » lui apprend à modifier le personnage.'))),
            h('div', { class: 'tw-row' }, h('button', { type: 'button', class: 'tw-primary', id: 'cSave' }, 'Enregistrer'), h('span', { id: 'cErr', class: 'tw-err' }))))),
      h('dialog', { id: 'buildDialog', class: 'tw-dialog tw-wide' },
        h('form', { id: 'builder', autocomplete: 'off' },
          h('div', { class: 'tw-dhead' }, h('h2', null, 'Préparer une version'), h('button', { type: 'button', class: 'tw-quiet', onclick: () => $('buildDialog').close() }, 'Annuler')),
          h('div', { class: 'tw-grid2' },
            h('label', null, 'Nom de la version', h('input', { id: 'bName', placeholder: 'CTB 0.3', required: true })),
            h('label', null, 'Projet Unreal', h('select', { id: 'bProject', required: true }))),
          h('div', null,
            h('div', { class: 'tw-row' }, h('b', null, 'Features de cette version'), h('span', { class: 'tw-hint' }, 'une ligne par feature, et comment la tour sait qu\'elle est prête')),
            h('div', { id: 'bRows', class: 'tw-rows' }),
            h('button', { type: 'button', id: 'bAdd' }, 'Ajouter une feature'),
            h('datalist', { id: 'testGroups' })),
          h('div', { class: 'tw-final' },
            h('b', null, 'Épreuve finale'),
            h('span', { class: 'tw-hint' }, 'Elle se débloque quand toutes les features sont prêtes, et doit réussir après elles.'),
            h('label', null, h('input', { type: 'checkbox', id: 'bPackage', checked: true }), 'Le jeu se package (RunUAT BuildCookRun)'),
            h('label', null, h('input', { type: 'checkbox', id: 'bAllTests', checked: true }), 'Tous les tests d\'automatisation passent, groupe', h('input', { id: 'bAllGroup', list: 'testGroups', placeholder: 'CTB', style: 'width:140px' }))),
          h('div', { class: 'tw-row' }, h('button', { type: 'submit', class: 'tw-primary' }, 'Lancer la version'), h('span', { id: 'bErr', class: 'tw-err' })))));
    wireDialogs();
  }

  let editing = null; // { id, look, sessionId }
  function previewChar() {
    const look = {};
    for (const k of Object.keys(STY)) look[k] = $(cap(k)).value;
    for (const [k] of COL) look[k] = $('col-' + k).value;
    editing.look = look;
    $('cPreview').replaceChildren(avatar(look, 'working', 150));
    const nm = $('cName').value.trim() || 'ce personnage';
    $('cAsk').textContent = `Change le personnage « ${nm} » de la tour Alkatrazz : donne-lui ${['un casque de chantier jaune', 'une barbe rousse et une pioche', 'une tenue de pirate'][Math.floor(Math.random() * 3)]}.`;
  }
  function openChar(sessionId) {
    const a = S.agents.find(x => x.sessionId === sessionId);
    const c = a && charOf(a);
    if (!c) return;
    editing = { id: c.id, sessionId };
    $('cName').value = c.name;
    $('cRole').value = c.role || '';
    for (const [k, opts] of Object.entries(STY)) {
      const el = $(cap(k));
      el.replaceChildren(...opts.map(([v, t]) => h('option', { value: v }, t)));
      el.value = c.look[k] || opts[0][0];
    }
    $('cColors').replaceChildren(...COL.map(([k, t]) => h('label', null, h('input', { type: 'color', id: 'col-' + k, value: c.look[k] || '#888888' }), t)));
    const others = Object.values(S.characters || {});
    $('cAssign').replaceChildren(...others.map(o => h('option', { value: o.id }, o.id === c.id ? `${o.name} (celui-ci)` : o.name)), h('option', { value: '__new' }, 'Nouveau personnage'));
    $('cAssign').value = c.id;
    $('cErr').textContent = '';
    previewChar();
    if (!$('charDialog').open) $('charDialog').showModal();
  }

  async function openProjects() {
    $('projErr').textContent = '';
    $('scanList').replaceChildren(h('div', { class: 'tw-hint' }, 'Recherche des projets Unreal…'));
    $('projDialog').showModal();
    let r = null;
    if (!DEMO) try { r = await fetch('/api/projects/scan').then(x => x.json()); } catch { /* tour injoignable */ }
    const connectedSet = new Set((S.projects || []).map(p => p.uproject.toLowerCase()));
    const found = (r && r.projects) || [];
    $('scanList').replaceChildren(...(found.length ? found.map(p => h('div', { class: 'tw-scanitem' },
      h('div', null, h('b', null, p.name), ' ', h('span', { class: 'tw-hint' }, `UE ${p.engine || '?'}`), h('div', { class: 'tw-hint tw-path' }, p.root)),
      connectedSet.has(p.uproject.toLowerCase()) ? h('span', { class: 'tw-ok' }, 'connecté')
        : h('button', { class: 'tw-primary', onclick: async (e) => { e.target.disabled = true; await api('/api/projects/connect', { uproject: p.uproject }); e.target.replaceWith(h('span', { class: 'tw-ok' }, 'connecté')); } }, 'Connecter')))
      : [h('div', { class: 'tw-hint' }, 'Aucun .uproject trouvé automatiquement : colle son chemin ci-dessous.')]));
  }

  const CHECKS = [['tests', 'Ses tests d\'automatisation passent'], ['build', 'Le jeu compile'], ['manual', 'Je la teste en jeu moi-même']];
  function addFeatureRow(title = '', type = 'tests', arg = '') {
    const name = h('input', { placeholder: 'Nom de la feature, ex. Lampe torche', value: title, 'aria-label': 'Nom de la feature' });
    const sel = h('select', { 'aria-label': 'Comment la vérifier' }, CHECKS.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = type;
    const extra = h('input', { list: 'testGroups', value: arg, 'aria-label': 'Groupe de tests ou cible' });
    const del = h('button', { type: 'button', class: 'tw-quiet', title: 'Retirer cette feature', 'aria-label': 'Retirer cette feature' }, '✕');
    const row = h('div', { class: 'tw-frow' }, name, sel, extra, del);
    const sync = () => {
      extra.hidden = sel.value === 'manual';
      extra.placeholder = sel.value === 'tests' ? 'Groupe de tests, ex. CTB.Lampe' : 'Cible (facultatif), ex. ConquerTheBackrooms';
      extra.setAttribute('list', sel.value === 'tests' ? 'testGroups' : '');
    };
    sel.addEventListener('change', sync);
    del.addEventListener('click', () => row.remove());
    sync();
    $('bRows').append(row);
    return name;
  }
  function fillGroups() {
    const g = (S.testGroups || {})[$('bProject').value] || {};
    const keys = Object.keys(g).sort();
    $('testGroups').replaceChildren(...keys.map(k => h('option', { value: k }, `${g[k]} tests`)));
    if (!$('bAllGroup').value) $('bAllGroup').value = (keys.find(k => k.split('.').length === 2) || '').split('.')[0] || ($('bProject').value ? 'CTB' : '');
  }
  function openBuilder() {
    const projects = [...new Set([...(S.projects || []).map(p => p.name), ...S.agents.filter(a => a.project).map(a => a.project.name)])];
    $('bProject').replaceChildren(...(projects.length ? projects : ['']).map(p => h('option', { value: p }, p || 'aucun projet Unreal vu pour l\'instant')));
    fillGroups();
    $('bRows').replaceChildren();
    addFeatureRow();
    addFeatureRow();
    $('bErr').textContent = '';
    $('buildDialog').showModal();
    $('bName').focus();
  }

  function wireDialogs() {
    $('projPathBtn').addEventListener('click', async () => {
      const r = await api('/api/projects/connect', { path: $('projPath').value });
      if (!r) { $('projErr').textContent = DEMO ? '' : 'La tour ne répond pas.'; return; }
      if (!r.ok) { $('projErr').textContent = r.error; return; }
      $('projPath').value = '';
      $('projDialog').close();
    });
    $('charDialog').addEventListener('input', (e) => { if (e.target.id !== 'cAssign' && editing) previewChar(); });
    $('cAssign').addEventListener('change', async () => {
      const v = $('cAssign').value;
      let id = v;
      if (v === '__new') { const r = await api('/api/characters', {}); if (!r || !r.ok) return; id = r.character.id; }
      await api('/api/agents/character', { sessionId: editing.sessionId, characterId: id });
      setTimeout(() => openChar(editing.sessionId), 250);
    });
    $('cRandom').addEventListener('click', async () => {
      const r = await api('/api/characters/update', { id: editing.id, randomize: true });
      if (r && r.ok) setTimeout(() => openChar(editing.sessionId), 200);
    });
    $('cCopy').addEventListener('click', () => { try { navigator.clipboard.writeText($('cAsk').textContent); $('cCopy').textContent = 'Copié'; setTimeout(() => { $('cCopy').textContent = 'Copier'; }, 1500); } catch { /* presse-papiers refuse */ } });
    $('cSave').addEventListener('click', async () => {
      const r = await api('/api/characters/update', { id: editing.id, newName: $('cName').value, role: $('cRole').value, look: editing.look });
      if (!r || !r.ok) { $('cErr').textContent = DEMO ? '' : (r && r.error) || 'La tour ne répond pas.'; return; }
      $('charDialog').close();
    });
    $('bProject').addEventListener('change', fillGroups);
    $('bAdd').addEventListener('click', () => addFeatureRow().focus());
    $('builder').addEventListener('submit', async (e) => {
      e.preventDefault();
      const lines = [];
      for (const row of $('bRows').children) {
        const [name, sel, extra] = row.querySelectorAll('input, select');
        const title = name.value.replace(/[|\n]/g, ' ').trim();
        if (!title) continue;
        const arg = extra.value.trim();
        if (sel.value === 'tests' && !arg) { $('bErr').textContent = `Indique le groupe de tests de « ${title} », ou choisis « Je la teste en jeu ».`; return; }
        lines.push(`${title} | ${sel.value === 'manual' ? 'manuel' : sel.value + (arg ? ':' + arg : '')}`);
      }
      if (!lines.length) { $('bErr').textContent = 'Ajoute au moins une feature.'; return; }
      const fin = [];
      if ($('bPackage').checked) fin.push('paquet');
      if ($('bAllTests').checked) fin.push('tests' + ($('bAllGroup').value.trim() ? ':' + $('bAllGroup').value.trim() : ''));
      if (!fin.length) fin.push('manuel');
      lines.push(`Boss | ${fin.join(', ')}`);
      const r = await api('/api/campaigns', { name: $('bName').value, project: $('bProject').value, text: lines.join('\n') });
      if (!r) { $('bErr').textContent = DEMO ? '' : 'La tour ne répond pas.'; return; }
      if (!r.ok) { $('bErr').textContent = r.error || 'Refusé.'; return; }
      $('bName').value = '';
      $('buildDialog').close();
    });
  }

  // ---------- choix du template ----------
  function chosen() {
    const q = params.get('t') || hashTokens.find(x => TEMPLATES.some(t => t.id === x));
    if (q && TEMPLATES.some(t => t.id === q)) return q;
    try { const s = localStorage.getItem('tower.template'); if (s && TEMPLATES.some(t => t.id === s)) return s; } catch { /* stockage bloque */ }
    return DEFAULT;
  }
  function choose(id) {
    try { localStorage.setItem('tower.template', id); } catch { /* stockage bloque */ }
    if (hashTokens.length) {
      location.hash = [DEMO ? 'demo' : null, id].filter(Boolean).join('.');
      location.reload();
      return;
    }
    const p = new URLSearchParams(location.search);
    p.set('t', id);
    location.search = p.toString();
  }
  // Le selecteur a poser dans l'en-tete de chaque template.
  function switcher(label = 'Apparence') {
    const sel = h('select', { 'aria-label': 'Template de la tour', onchange: (e) => choose(e.target.value) },
      TEMPLATES.map(t => h('option', { value: t.id, selected: t.id === current }, t.name)));
    return h('label', { class: 'tw-switch' }, h('span', null, label), sel, h('a', { href: 'galerie.html', title: 'Comparer les templates' }, 'Galerie'));
  }

  // ---------- rendu ----------
  let current = chosen(), tpl = null, root = null;
  function rerender() {
    if (!S || !tpl) return;
    tpl.render(root, model());
    tickTexts();
  }
  function register(t) {
    tpl = t;
    root = $('app');
    document.documentElement.dataset.template = current;
    rerender();
  }
  // Un template peut reposer sur un moteur commun (web/<moteur>/moteur.js et hud.css), charge avant lui.
  function load() {
    const def = TEMPLATES.find(t => t.id === current) || {};
    const script = (src, then) => { const s = document.createElement('script'); s.src = src; if (then) s.onload = then; document.body.append(s); };
    if (def.engine) document.head.append(h('link', { rel: 'stylesheet', href: `${def.engine}/hud.css` }));
    document.head.append(h('link', { rel: 'stylesheet', href: `templates/${current}.css` }));
    if (def.engine) script(`${def.engine}/moteur.js`, () => script(`templates/${current}.js`));
    else script(`templates/${current}.js`);
  }

  // Dates de la demo decalees pour que tout se passe "maintenant".
  function shift(v, d) {
    if (typeof v === 'number') return v > 1.5e12 && v < 2.5e12 ? v + d : v;
    if (Array.isArray(v)) return v.map(x => shift(x, d));
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = shift(v[k], d); return v; }
    return v;
  }
  function onState(next) {
    S = next;
    skew = DEMO ? 0 : Date.now() - S.now;
    rerender();
  }
  function connect() {
    if (DEMO) {
      connected = true;
      fetch('demo/state.json').then(r => r.json()).then(s => onState(shift(s, Date.now() - s.now)));
      return;
    }
    const es = new EventSource('/api/stream');
    es.onmessage = (m) => { connected = true; onState(JSON.parse(m.data)); };
    es.onerror = () => { if (connected) { connected = false; rerender(); } };
  }

  // Les personnages sont animes : on ne redessine qu'a chaque nouvelle donnee et toutes les 15 s
  // (agents devenus silencieux), les "il y a" se mettent a jour seuls chaque seconde.
  let tick = 0;
  setInterval(() => { tick++; tickTexts(); if (tick % 15 === 0) rerender(); }, 1000);

  window.Tower = {
    register, h, svg, ago, dur, clock, folder, plural, lower, num, agoEl, forEl, avatar, forge, youAvatar, mapEl, rooms, room,
    act, ui, api, toast, switcher, choose, rerender, TEMPLATES, KIND, STATUS, FEAT, get current() { return current; }, get demo() { return DEMO; },
  };
  buildDialogs();
  load();
  connect();
})();
