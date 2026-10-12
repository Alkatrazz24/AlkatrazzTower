'use strict';
// Socle de la page : flux en direct, modele de donnees, actions, dialogues.
// L'application (web/appli) ne fait que dessiner : elle s'enregistre avec Tower.register({ id, render(root, M) })
// et recoit a chaque changement le modele M deja calcule (agents, verrou, version...).
//   ?demo     joue l'etat de demonstration web/demo/state.json, sans serveur

(function () {
  const TEMPLATES = window.TOWER_TEMPLATES;
  const DEFAULT = window.TOWER_DEFAULT;
  const SILENT_MS = 15 * 60 * 1000;
  // Une session qui ne fait plus rien depuis une heure est rangee : « Anciennes sessions » la remontre.
  const OLD_MS = 60 * 60 * 1000;
  const STATUS = { working: 'travaille', waiting: 'attend ta réponse', idle: 'a fini, à toi', ready: 'prêt', ended: 'terminé', silent: 'silencieux', sujet: 'en sommeil' };
  const KIND = { build: 'Compilation', test: 'Tests', package: 'Package', commandlet: 'Commandlet', livecoding: 'Live Coding' };
  // Le domaine du projet que touche une session (lib/inventory.js range les assets par domaine).
  const ROOMS = {
    blueprints: 'Blueprints', animations: 'Animations', personnages: 'Personnages', decors: 'Décors', materiaux: 'Matériaux',
    textures: 'Textures', sons: 'Sons', effets: 'Effets', niveaux: 'Niveaux', interface: 'Interface', donnees: 'Données', ia: 'IA',
    cinematiques: 'Cinématiques', code: 'Code C++', tests: 'Tests', autres: 'Autres',
  };
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
      // une zone de texte ignore l'attribut value : son texte de depart est son contenu
      else if (k === 'value' && tag === 'textarea') e.textContent = String(v);
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
  const ui = { showEnded: false, openBuilds: new Set(), mapProject: null, journalOpen: false };

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
    const agents = S.agents.map(a => {
      const st = statusOf(a);
      const ch = charOf(a);
      const queuePos = S.queue.findIndex(e => e.sessionId === a.sessionId) + 1;
      return {
        id: a.sessionId, raw: a, st, stText: STATUS[st] || st,
        // salle : ce que fait la session (son nom choisi, sa tache, son titre ou sa premiere demande)
        name: ch ? ch.name : agentName(a), salle: a.salle || agentName(a), label: a.label || '', role: a.salle || (ch ? agentName(a) : ''), char: ch, look: ch ? ch.look : {},
        holds: !!(S.lock && S.lock.sessionId === a.sessionId), queuePos,
        ask: st === 'waiting' ? a.message : '', said: st === 'idle' ? a.message : '',
        // question ouverte dans la tour (hooks/tower-ask.js) : ali y repond d'un clic
        pending: st === 'waiting' && a.ask && !a.ask.window ? a.ask : null,
        prompt: a.prompt, tool: a.tool, subs: Object.keys(a.subagents || {}).length,
        subList: Object.entries(a.subagents || {}).map(([id, v]) => ({ id, type: v.type || 'agent', section: v.section || '', lastSeen: v.lastSeen })),
        lastBuild: a.lastBuild, lastTest: a.lastTest, docs: docsOf(a), error: a.lastError,
        where: folder(a.cwd), project: a.project ? a.project.name : '', lastSeen: a.lastSeen,
        room: a.room || null, roomName: (a.room && ROOMS[a.room]) || '',
        usage: a.usage || null, task: a.task || null,
        // session core (un sujet du jeu) ou feature (une nouvelle idee) : l'id de son sujet ou de sa feature
        // (ou le chef, qui recoit toutes les demandes et les confie aux autres)
        sujet: a.task && /^((sujet|feature)-|chef$)/.test(String(a.task.id)) ? a.task.id : '', hidden: !!a.hidden,
        kind: a.task && String(a.task.id).startsWith('sujet-') ? 'core' : a.task && String(a.task.id).startsWith('feature-') ? 'feature' : a.task && a.task.id === 'chef' ? 'chef' : '',
      };
    });
    // Sujets du jeu (lib/sujets.js) : la session la plus recente de chaque sujet occupe sa salle ; les
    // precedentes, et les sessions sans rien de neuf depuis une heure, sont des anciennes sessions.
    const sujetSession = {};
    for (const x of agents) if (x.sujet && x.st !== 'ended' && !x.hidden && (!sujetSession[x.sujet] || x.lastSeen > sujetSession[x.sujet].lastSeen)) sujetSession[x.sujet] = x;
    // Une feature terminee quitte le batiment avec ses sessions (on la retrouve dans les anciennes).
    const doneFeature = new Set((S.features || []).filter(f => f.doneAt).map(f => f.id));
    for (const x of agents) {
      const current = x.sujet && sujetSession[x.sujet] === x;
      x.old = x.st === 'ended' || x.hidden || doneFeature.has(x.sujet) || (x.sujet ? !current : x.st !== 'working' && x.st !== 'waiting' && !x.holds && !x.queuePos && now() - x.lastSeen > OLD_MS);
    }
    const proj0 = (S.projects || [])[0];
    const sv = (S.sujets || {})[proj0 ? proj0.name : ''] || Object.values(S.sujets || {})[0] || null;
    const sujets = sv ? sv.topics.map(t => ({ ...t, kind: 'core', project: sv.project, session: sujetSession[t.id] || null })) : [];
    // Features (lib/features.js) : leurs agents sont ceux des sujets qu'elles touchent.
    const features = (S.features || []).filter(f => !sv || !f.project || f.project === sv.project).map(f => {
      const mine = sujets.filter(t => (f.sujets || []).includes(t.id));
      return { ...f, kind: 'feature', project: f.project || (sv ? sv.project : ''), agents: [...new Set(mine.flatMap(t => t.agents))], reviewers: [...new Set(mine.flatMap(t => t.reviewers || []))],
        topics: mine.map(t => t.title), session: sujetSession[f.id] || null, done: !!f.doneAt };
    });
    // Le chef (lib/chef.js) : sa salle dans son batiment, et ce qu'il a confie a qui.
    const C = S.chef || { ask: false, envois: [] };
    const chef = sv ? { id: 'chef', kind: 'chef', title: 'Chef', project: sv.project, agents: [], reviewers: [], session: sujetSession.chef || null,
      ask: !!C.ask, envois: (C.envois || []).filter(e => !e.project || e.project === sv.project) } : null;
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
    for (const x of live.filter(x => x.st === 'idle' && !x.hidden)) { // une salle rangee (mise en place finie...) ne demande rien
      // Une tache lancee depuis la tour : son suivi dit ce qui reste et s'il y a des questions.
      const sv = x.task && x.task.suivi;
      const vf = x.task && x.task.verif ? { fail: 'la vérification de la tour a échoué', waiting: 'les tests attendent que tu fermes l\'éditeur', running: 'la tour vérifie', ok: 'vérifiée par la tour' }[x.task.verif.state] : '';
      const sum = sv ? [vf, sv.afaire.length && plural(sv.afaire.length, 'chose à faire', 'choses à faire'), sv.questions.length && plural(sv.questions.length, 'question pour toi', 'questions pour toi'), sv.rapport && 'un rapport à lire'].filter(Boolean).join(', ') : '';
      attention.push({ tone: vf && x.task.verif.state === 'fail' ? 'ko' : 'ok', kind: 'idle', agent: x, title: x.task ? `${x.name} a fini « ${x.task.title} »` : `${x.name} a fini`,
        text: x.task ? `${sum ? sum[0].toUpperCase() + sum.slice(1) : 'Son suivi est prêt'} : clique « Voir » pour le suivi.` : x.said || 'Sa tâche est terminée, il attend la suite.' });
    }
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
      agents, liveAgents: live, visibleAgents: agents.filter(x => ui.showEnded || !x.old), endedCount: agents.filter(x => x.old).length,
      sujets, features, chef, conseil: S.conseil || null, board: sv ? sv.board.entries : [], sujetsProject: sv ? sv.project : '',
      regles: S.regles || {}, actions: S.actions || [],
      mise: S.miseEnPlace || { budgets: [], budget: 1, current: null, queue: [], runs: {} },
      counts: { working: count('working'), waiting, idle: count('idle'), ready: count('ready'), silent: count('silent'), live: live.length },
      editor, projects: S.projects || [], campaign, past, attention, lock, queue, chantiers, builds,
      inventories: invs, inv, testGroups: S.testGroups || {},
    };
  }

  // ---------- actions ----------
  const act = {
    manual: (featureId, ok) => S && model().campaign && api('/api/campaigns/manual', { id: model().campaign.id, featureId, ok }),
    archive: () => { const c = model().campaign; if (c) api('/api/campaigns/archive', { id: c.id }); },
    abandon: () => { const c = model().campaign; if (c && confirm(`Abandonner la version ${c.name} ?`)) api('/api/campaigns/archive', { id: c.id }); },
    next: () => { act.archive(); openBuilder(); },
    release: () => { if (confirm('Libérer la compilation ? Le build en cours continue, mais un autre pourra démarrer en même temps.')) api('/api/lock/force-release'); },
    forget: (id) => api('/api/agents/forget', { sessionId: id }),
    hide: (id, hidden = true) => api('/api/agents/hide', { sessionId: id, hidden }),
    disconnect: (p) => { if (confirm(`Déconnecter ${p.name} ?`)) api('/api/projects/disconnect', { uproject: p.uproject }); },
    refreshMap: () => { api('/api/inventory/refresh'); toast('La tour recompte le projet.'); },
    toggleEnded: (v) => { ui.showEnded = v === undefined ? !ui.showEnded : v; rerender(); },
    toggleBuild: (id) => { ui.openBuilds.has(id) ? ui.openBuilds.delete(id) : ui.openBuilds.add(id); rerender(); },
    openProjects: () => openProjects(),
    openBuilder: () => openBuilder(),
  };

  // ---------- dialogues partages ----------
  function buildDialogs() {
    const close = (id) => h('button', { type: 'button', class: 'tw-quiet', onclick: () => $(id).close() }, 'Fermer');
    document.body.append(
      h('dialog', { id: 'projDialog', class: 'tw-dialog' },
        h('div', { class: 'tw-dhead' }, h('h2', null, 'Connecter un projet Unreal'), close('projDialog')),
        h('p', { class: 'tw-hint' }, 'La tour cherche les fichiers .uproject dans tes Documents, ton Bureau et à la racine de tes disques. Choisis ceux que tes agents vont faire avancer.'),
        h('div', { id: 'scanList', class: 'tw-scan' }),
        h('div', { class: 'tw-row' }, h('input', { id: 'projPath', class: 'tw-grow', placeholder: 'Ou colle le chemin d\'un .uproject ou de son dossier' }), h('button', { type: 'button', id: 'projPathBtn' }, 'Connecter')),
        h('div', { id: 'projErr', class: 'tw-err' })),
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
    const name = h('input', { name: 'fname', placeholder: 'Nom de la feature, ex. Lampe torche', value: title, 'aria-label': 'Nom de la feature' });
    const sel = h('select', { name: 'fcheck', 'aria-label': 'Comment la vérifier' }, CHECKS.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = type;
    const extra = h('input', { name: 'farg', list: 'testGroups', value: arg, 'aria-label': 'Groupe de tests ou cible' });
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

  // ---------- interface ----------
  // Une seule : l'application « Conversations ». Les anciens choix retenus dans le navigateur sont oublies.
  try { localStorage.removeItem('tower.template'); localStorage.removeItem('tower.appli'); } catch { /* stockage bloque */ }

  // ---------- rendu ----------
  let current = DEFAULT, tpl = null, root = null;
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
  let pageVersion = null;
  function connect() {
    if (DEMO) {
      connected = true;
      fetch('demo/state.json').then(r => r.json()).then(s => onState(shift(s, Date.now() - s.now)));
      return;
    }
    const es = new EventSource('/api/stream');
    es.onmessage = (m) => { connected = true; onState(JSON.parse(m.data)); };
    es.onerror = () => { if (connected) { connected = false; rerender(); } };
    // La tour a ete mise a jour pendant que la page etait ouverte : on recharge la nouvelle page.
    es.addEventListener('version', (m) => {
      const v = JSON.parse(m.data);
      if (pageVersion && v !== pageVersion) location.reload();
      pageVersion = v;
    });
  }

  // Les personnages sont animes : on ne redessine qu'a chaque nouvelle donnee et toutes les 15 s
  // (agents devenus silencieux), les "il y a" se mettent a jour seuls chaque seconde.
  let tick = 0;
  setInterval(() => { tick++; tickTexts(); if (tick % 15 === 0) rerender(); }, 1000);

  window.Tower = {
    register, h, svg, ago, dur, clock, folder, plural, lower, num, agoEl, forEl,
    act, ui, api, toast, rerender, TEMPLATES, KIND, STATUS, FEAT, get current() { return current; }, get demo() { return DEMO; },
  };
  buildDialogs();
  load();
  connect();
})();
