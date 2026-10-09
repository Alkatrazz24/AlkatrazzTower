'use strict';
// Template « Console » : des panneaux de terminal (facon lazygit, htop, tmux) pilotes au clavier et a la souris.
// [1 Agents] [2 Forge] a gauche, [3 Detail] [4 Version] a droite, [5 Historique] [6 Carte] en bas.
// Un panneau a le focus (bordure ambre) ; la barre d'etat en bas montre ses raccourcis.

(function () {
  const T = window.Tower, h = T.h;
  const st = { focus: 1, agent: null, build: null, feat: null, bound: false };
  let LM = null, bar = null;

  const RANK = { waiting: 0, idle: 1, working: 2, ready: 3, silent: 4, ended: 5 };
  const SHORT = { working: 'travaille', waiting: 'attend', idle: 'a fini', ready: 'prêt', ended: 'terminé', silent: 'silencieux' };
  const TAG = { waiting: 'réponds', broken: 'cassée', failing: 'en échec', manual: 'à tester', idle: 'a fini', dirty: 'à sauver' };
  const PANELS = { 1: 'Agents', 2: 'Forge', 3: 'Détail', 4: 'Version', 5: 'Historique', 6: 'Carte' };

  // ---------- donnees derivees ----------
  const ordered = (M) => M.visibleAgents.slice().sort((a, b) => (RANK[a.st] ?? 9) - (RANK[b.st] ?? 9));
  function selAgent(M) {
    const list = ordered(M);
    let a = list.find(x => x.id === st.agent);
    if (!a && list.length) { a = list[0]; st.agent = a.id; }
    return a || null;
  }
  function selFeat(M) {
    const c = M.campaign;
    if (!c || c.won) return null;
    let f = c.features.find(x => x.id === st.feat);
    if (!f && c.features.length) { f = c.features[0]; st.feat = f.id; }
    return f || null;
  }
  function selBuild(M) {
    let b = M.builds.find(x => x.id === st.build);
    if (!b && M.builds.length) { b = M.builds[0]; st.build = b.id; }
    return b || null;
  }
  function doing(M, a) {
    if (a.holds) return `compile (${T.lower(M.lock.kindText)})`;
    if (a.queuePos) return `attend la forge (${a.queuePos}e)`;
    if (a.st === 'waiting') return a.ask || 'attend ta réponse';
    if (a.st === 'idle') return a.said || 'a fini, à toi';
    if (a.st === 'working' && a.tool) return `${a.tool.name} ${a.tool.summary}`;
    return a.prompt || a.stText;
  }
  const okCls = (ok) => ok === true ? 'co-ok' : ok === false ? 'co-ko' : 'co-dim';

  // ---------- actions ----------
  const A = {
    char: () => { const a = LM && selAgent(LM); if (a) T.act.openChar(a.id); },
    forget: () => {
      const a = LM && selAgent(LM);
      if (!a) return;
      if (a.st === 'ended' || a.st === 'silent') T.act.forget(a.id);
      else T.toast(`${a.name} est encore actif : seuls les agents terminés ou silencieux se retirent.`);
    },
    ended: () => T.act.toggleEnded(),
    release: () => { if (LM && LM.lock) T.act.release(); else T.toast('La forge est libre.'); },
    manual: () => {
      const f = LM && selFeat(LM);
      if (f && f.manual) T.act.manual(f.id, !f.manual.done);
      else T.toast('Cette feature se vérifie toute seule : rien à tester à la main.');
    },
    version: () => {
      const c = LM && LM.campaign;
      if (!c) T.act.openBuilder();
      else if (c.won) T.act.next();
      else { focusPanel(4); T.toast(`${c.name} est en cours : termine-la ou abandonne-la d'abord.`); }
    },
    projects: () => T.act.openProjects(),
    refresh: () => T.act.refreshMap(),
    help: () => openHelp(),
  };

  // Raccourcis montres dans la barre d'etat, par panneau.
  const KEYS = {
    1: [['j k', 'choisir', null], ['Entrée', 'détail', () => focusPanel(3)], ['c', 'personnage', A.char], ['x', 'retirer', A.forget], ['e', 'sessions terminées', A.ended]],
    2: [['l', 'libérer la forge', A.release]],
    3: [['c', 'personnage', A.char], ['x', 'retirer', A.forget]],
    4: [['j k', 'choisir', null], ['t', 'je l\'ai testée', A.manual], ['v', 'préparer une version', A.version]],
    5: [['j k', 'choisir', null], ['Entrée', 'déplier', () => { const b = LM && selBuild(LM); if (b) T.act.toggleBuild(b.id); }]],
    6: [['r', 'recompter', A.refresh], ['p', 'connecter un projet', A.projects]],
  };

  // ---------- clavier ----------
  function typing(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    if (document.querySelector('dialog[open]')) return true;
    const t = e.target;
    return !!(t && t.closest && t.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]'));
  }
  function move(d) {
    const M = LM;
    if (!M) return false;
    if (st.focus === 1) { const l = ordered(M); if (!l.length) return false; const i = l.findIndex(x => x.id === (selAgent(M) || {}).id); st.agent = l[Math.max(0, Math.min(l.length - 1, i + d))].id; }
    else if (st.focus === 4) { const c = M.campaign; if (!c || c.won || !c.features.length) return false; const l = c.features; const i = l.findIndex(x => x.id === (selFeat(M) || {}).id); st.feat = l[Math.max(0, Math.min(l.length - 1, i + d))].id; }
    else if (st.focus === 5) { const l = M.builds; if (!l.length) return false; const i = l.findIndex(x => x.id === (selBuild(M) || {}).id); st.build = l[Math.max(0, Math.min(l.length - 1, i + d))].id; }
    else return false;
    T.rerender();
    const s = document.querySelector(`[data-n="${st.focus}"] [aria-current="true"]`);
    if (s) s.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function onKey(e) {
    if (typing(e)) return;
    const k = e.key;
    if (/^[1-6]$/.test(k)) { e.preventDefault(); focusPanel(+k); return; }
    if (k === 'j' || k === 'ArrowDown') { if (move(1)) e.preventDefault(); return; }
    if (k === 'k' || k === 'ArrowUp') { if (move(-1)) e.preventDefault(); return; }
    if (k === 'Enter') {
      const tag = e.target && e.target.closest && e.target.closest('button, a, summary');
      if (tag) return; // le bouton fait son travail
      if (st.focus === 1) { e.preventDefault(); focusPanel(3); }
      else if (st.focus === 5) { const b = LM && selBuild(LM); if (b) { e.preventDefault(); T.act.toggleBuild(b.id); } }
      return;
    }
    const map = { e: A.ended, c: A.char, v: A.version, p: A.projects, r: A.refresh, x: A.forget, t: A.manual, l: A.release, '?': A.help };
    if (map[k]) { e.preventDefault(); map[k](); }
  }

  // ---------- focus des panneaux ----------
  function paintFocus() {
    document.querySelectorAll('.co-p').forEach(p => p.classList.toggle('is-focus', +p.dataset.n === st.focus));
    if (bar) bar.replaceChildren(...barKids());
  }
  function focusPanel(n) {
    st.focus = n;
    paintFocus();
    const p = document.querySelector(`.co-p[data-n="${n}"]`);
    if (p) { p.focus({ preventScroll: true }); p.scrollIntoView({ block: 'nearest' }); }
  }
  function barKids() {
    const keys = KEYS[st.focus] || [];
    return [
      h('span', { class: 'co-bar-mode' }, `${st.focus} ${PANELS[st.focus]}`),
      ...keys.map(([key, text, fn]) => fn
        ? h('button', { type: 'button', class: 'co-key', onclick: fn }, h('kbd', null, key), ' ', text)
        : h('span', { class: 'co-key' }, h('kbd', null, key), ' ', text)),
      h('span', { class: 'co-grow' }),
      h('span', { class: 'co-key co-dim' }, h('kbd', null, '1-6'), ' panneaux'),
      h('button', { type: 'button', class: 'co-key', onclick: A.help }, h('kbd', null, '?'), ' aide'),
    ];
  }

  // ---------- aide ----------
  function openHelp() {
    let d = document.getElementById('coHelp');
    if (!d) {
      const rows = [
        ['1 à 6', 'donner le focus à un panneau'], ['j k, flèches', 'choisir un agent, une feature ou un build'],
        ['Entrée', 'agents : voir le détail ; historique : déplier le build'], ['c', 'ouvrir le personnage de l\'agent choisi'],
        ['x', 'retirer l\'agent choisi (terminé ou silencieux)'], ['e', 'montrer ou masquer les sessions terminées'],
        ['t', 'marquer la feature choisie comme testée en jeu'], ['v', 'préparer une version'], ['l', 'libérer la forge'],
        ['p', 'connecter un projet Unreal'], ['r', 'recompter la carte du projet'], ['?', 'cette aide'], ['Échap', 'fermer une fenêtre'],
      ];
      d = h('dialog', { id: 'coHelp', class: 'tw-dialog co-help' },
        h('div', { class: 'tw-dhead' }, h('h2', null, 'Raccourcis clavier'), h('button', { type: 'button', class: 'tw-quiet', onclick: () => d.close() }, 'Fermer')),
        h('table', { class: 'co-helptab' }, h('tbody', null, rows.map(([k, t]) => h('tr', null, h('th', { scope: 'row' }, h('kbd', null, k)), h('td', null, t))))),
        h('p', { class: 'tw-hint' }, 'Les raccourcis se taisent pendant que tu écris dans un champ ou qu\'une fenêtre est ouverte. Tout se fait aussi à la souris.'));
      document.body.append(d);
    }
    d.showModal();
  }

  // ---------- briques ----------
  function panel(n, title, { right, foot, body, cls } = {}) {
    const sec = h('section', {
      class: `co-p co-a${n}${st.focus === n ? ' is-focus' : ''}${cls ? ' ' + cls : ''}`, 'data-n': n, 'data-k': 'p' + n, tabindex: '0', 'aria-labelledby': 'co-t' + n,
      onmousedown: () => { if (st.focus !== n) { st.focus = n; paintFocus(); } },
      onfocusin: () => { if (st.focus !== n) { st.focus = n; paintFocus(); } },
    },
    h('h2', { class: 'co-pt', id: 'co-t' + n }, h('span', { class: 'co-pn' }, n), h('span', null, title)),
    right ? h('span', { class: 'co-pr' }, right) : null,
    h('div', { class: 'co-pb', 'data-scroll': 'p' + n }, body),
    foot ? h('span', { class: 'co-pf' }, foot) : null);
    return sec;
  }
  const btn = (text, fn, { key, primary, danger, title, k } = {}) => h('button', { type: 'button', class: `co-btn${primary ? ' co-primary' : ''}${danger ? ' co-danger' : ''}`, onclick: fn, title, 'data-k': k },
    text, key ? h('kbd', null, key) : null);
  const kv = (label, ...val) => [h('dt', null, label), h('dd', null, ...val)];

  // ---------- en-tete et alertes ----------
  function header(M) {
    const e = M.editor;
    const live = M.demo ? h('span', { class: 'co-blue' }, 'démo') : M.connected ? h('span', { class: 'co-ok' }, 'en direct') : h('span', { class: 'co-ko' }, 'tour injoignable');
    let ed;
    if (e.plugin) {
      ed = [
        h('span', { class: 'co-field' }, h('span', { class: 'co-dim' }, 'éditeur '), h('b', null, e.project || '?')),
        h('span', { class: 'co-field' }, h('span', { class: 'co-dim' }, 'map '), e.map || 'aucune'),
        h('span', { class: 'co-field' }, h('span', { class: 'co-dim' }, 'PIE '), e.pie ? h('span', { class: 'co-ok' }, 'en cours') : 'non'),
        e.liveCoding.enabled ? h('span', { class: 'co-field' }, h('span', { class: 'co-dim' }, 'Live Coding '), e.liveCoding.compiling ? h('span', { class: 'co-blue' }, 'compile') : 'actif') : null,
        h('span', { class: 'co-field', title: e.dirtyNames.join(', ') }, e.dirty ? h('span', { class: 'co-warn' }, T.plural(e.dirty, 'non sauvegardé', 'non sauvegardés')) : h('span', { class: 'co-dim' }, 'tout est sauvegardé')),
        e.more ? h('span', { class: 'co-field co-dim' }, `+${e.more} éditeur${e.more > 1 ? 's' : ''}`) : null,
      ];
    } else ed = [h('span', { class: 'co-field' }, h('span', { class: 'co-dim' }, 'éditeur '), e.known ? e.text : 'état inconnu')];
    return h('header', { class: 'co-top' },
      h('span', { class: 'co-brand' }, 'alkatrazz-tower'),
      h('span', { class: 'co-field' }, live),
      ...ed,
      h('span', { class: 'co-grow' }),
      h('button', { type: 'button', class: 'co-btn', onclick: A.help, 'data-k': 'help' }, 'Aide', h('kbd', null, '?')),
      T.switcher());
  }

  function alerts(M) {
    const xs = M.attention;
    if (!xs.length) return h('div', { class: 'co-alert co-calm' }, h('span', { class: 'co-ok' }, 'Rien ne t\'attend.'), h('span', { class: 'co-dim' }, ` ${M.counts.working ? T.plural(M.counts.working, 'agent travaille', 'agents travaillent') : 'Aucun agent ne travaille'}, la forge est ${M.lock ? 'occupée' : 'libre'}.`));
    const go = (x) => () => {
      if (x.agent) { st.agent = x.agent.id; if (x.agent.st === 'ended') T.act.toggleEnded(true); T.rerender(); focusPanel(3); }
      else if (x.feature) { st.feat = x.feature.id; T.rerender(); focusPanel(4); }
      else if (x.kind === 'dirty') T.toast('Sauvegarde-les dans l\'éditeur Unreal (Ctrl+Maj+S).');
    };
    return h('section', { class: 'co-alert', 'aria-label': 'Ce qui t\'attend' },
      h('h2', { class: 'co-alert-h' }, xs.length > 1 ? `${xs.length} choses t'attendent` : 'Une chose t\'attend'),
      h('ul', { class: 'co-alist' }, xs.map((x, i) => h('li', { class: `co-aitem co-t-${x.tone}` },
        h('button', { type: 'button', class: 'co-arow', onclick: go(x), 'data-k': 'al' + i },
          h('span', { class: 'co-atag' }, TAG[x.kind] || x.kind),
          h('b', { class: 'co-atitle' }, x.title),
          h('span', { class: 'co-atext' }, x.text || '')),
        x.kind === 'manual' ? btn('Je l\'ai testée', () => T.act.manual(x.feature.id, true), { primary: true, k: 'alm' + i }) : null))));
  }

  // ---------- 1 agents ----------
  function agentsPanel(M) {
    const list = ordered(M);
    const cur = selAgent(M);
    const right = [M.counts.working ? `${M.counts.working} au travail` : null, M.counts.waiting ? `${M.counts.waiting} attend` : null].filter(Boolean).join(', ');
    const idx = cur ? list.indexOf(cur) + 1 : 0;
    const body = list.length ? h('div', { class: 'co-list', role: 'list' }, list.map(a => h('button', {
      type: 'button', role: 'listitem', class: `co-row co-agent co-s-${a.st}`, 'aria-current': a === cur ? 'true' : 'false', 'data-k': 'ag-' + a.id,
      onclick: () => { st.agent = a.id; st.focus = 1; T.rerender(); },
      ondblclick: () => focusPanel(3),
    },
    h('span', { class: 'co-mark', 'aria-hidden': 'true' }, a === cur ? '>' : ''),
    h('span', { class: 'co-name' }, a.name),
    h('span', { class: 'co-role' }, a.role || a.where),
    h('span', { class: 'co-st' }, SHORT[a.st] || a.st),
    h('span', { class: 'co-doing' }, doing(M, a)),
    T.agoEl(a.lastSeen, 'span', { class: 'co-ago' }))))
      : h('p', { class: 'co-empty' }, 'Aucun agent pour l\'instant. Une ligne apparaît dès qu\'une session Claude Code démarre.');
    const foot = [list.length ? `${idx} sur ${list.length}` : '', M.endedCount ? h('button', { type: 'button', class: 'co-inline', onclick: A.ended, 'data-k': 'ended' }, T.ui.showEnded ? 'masquer les terminées' : `terminées (${M.endedCount})`, h('kbd', null, 'e')) : null];
    return panel(1, 'Agents', { right, foot, body });
  }

  // ---------- 3 detail ----------
  function detailPanel(M) {
    const a = selAgent(M);
    if (!a) return panel(3, 'Détail', { body: h('p', { class: 'co-empty' }, 'Choisis un agent dans le panneau 1 pour voir sa demande, son outil et ses résultats.') });
    const docs = a.docs;
    const dl = h('dl', { class: 'co-kv' },
      a.ask ? kv('question', h('span', { class: 'co-warn' }, a.ask)) : null,
      a.said ? kv('fin', h('span', { class: 'co-ok' }, a.said)) : null,
      kv('demande', a.prompt || h('span', { class: 'co-dim' }, 'aucune pour l\'instant')),
      kv('outil', a.tool ? [h('b', null, a.tool.name), ' ', a.tool.summary, ' ', h('span', { class: 'co-dim' }, '(', T.agoEl(a.tool.at), ')')] : h('span', { class: 'co-dim' }, 'aucun')),
      a.subs ? kv('sous-agents', `${a.subs} en cours`) : null,
      a.holds ? kv('forge', h('span', { class: 'co-blue' }, `tient la forge (${T.lower(M.lock.kindText)})`)) : a.queuePos ? kv('forge', h('span', { class: 'co-warn' }, `en file, ${a.queuePos}e`)) : null,
      kv('compilation', a.lastBuild ? [h('span', { class: okCls(a.lastBuild.ok) }, a.lastBuild.ok ? 'réussie' : 'en échec'), ' ', h('span', { class: 'co-dim' }, a.lastBuild.summary || '', ', ', T.agoEl(a.lastBuild.endedAt))] : h('span', { class: 'co-dim' }, 'aucune')),
      kv('tests', a.lastTest ? [h('span', { class: okCls(a.lastTest.ok) }, a.lastTest.summary || (a.lastTest.ok ? 'passent' : 'échouent')), ' ', h('span', { class: 'co-dim' }, a.lastTest.testFilter || '', ', ', T.agoEl(a.lastTest.endedAt))] : h('span', { class: 'co-dim' }, 'aucun')),
      docs ? kv('doc UE', h('span', { class: docs.tone === 'ok' ? 'co-ok' : docs.tone === 'warn' ? 'co-warn' : 'co-dim' }, docs.text), docs.detail ? h('span', { class: 'co-dim' }, ' ', docs.detail) : null) : null,
      a.error ? kv('erreur', h('span', { class: 'co-ko' }, a.error)) : null,
      a.roomName ? kv('pièce', a.roomName) : null,
      kv('dossier', h('span', { class: 'co-dim' }, a.project || a.where)));
    const body = [
      h('div', { class: 'co-who' },
        h('button', { type: 'button', class: 'co-avbtn', onclick: () => T.act.openChar(a.id), title: `Personnaliser ${a.name}`, 'aria-label': `Personnage de ${a.name}`, 'data-k': 'avbtn' }, T.avatar(a.look, a.st, 88)),
        h('div', { class: 'co-whotext' },
          h('div', { class: 'co-big' }, a.name),
          h('div', { class: 'co-dim' }, a.role || a.where),
          h('div', null, h('span', { class: `co-st co-s-${a.st}` }, a.stText), ' ', h('span', { class: 'co-dim' }, T.agoEl(a.lastSeen))),
          h('div', { class: 'co-acts' },
            btn('Personnage', () => T.act.openChar(a.id), { key: 'c', k: 'dchar' }),
            a.st === 'ended' || a.st === 'silent' ? btn('Retirer', () => T.act.forget(a.id), { key: 'x', k: 'dforget' }) : null))),
      dl];
    return panel(3, 'Détail', { right: a.name, body });
  }

  // ---------- 2 forge ----------
  function forgePanel(M) {
    const L = M.lock;
    const body = [
      h('div', { class: 'co-forge' },
        T.forge(30, !!L),
        L ? h('div', { class: 'co-grow' },
          h('div', null, h('span', { class: 'co-blue' }, L.kindText), ' de ', h('b', null, L.agent ? L.agent.name : L.label), L.target ? h('span', { class: 'co-dim' }, ' ', L.target) : null),
          h('div', { class: 'co-dim' }, 'depuis ', T.forEl(L.since)))
          : h('div', { class: 'co-grow' }, h('span', { class: 'co-ok' }, 'libre'), h('span', { class: 'co-dim' }, ' : le prochain agent qui compile passe tout de suite.')),
        L ? btn('Libérer', A.release, { key: 'l', danger: true, title: 'Si le build est bloqué', k: 'release' }) : null),
      L && L.command ? h('code', { class: 'co-cmd' }, L.command) : null,
      M.queue.length ? h('div', { class: 'co-sub' }, h('h3', null, 'file d\'attente'),
        h('ol', { class: 'co-lines' }, M.queue.map(q => h('li', { class: 'co-qrow' },
          h('span', { class: 'co-dim' }, `${q.pos}.`),
          h('b', null, q.agent ? q.agent.name : q.label),
          h('span', null, T.lower(q.kindText)),
          T.forEl(q.since, 'span', { class: 'co-dim co-right' }))))) : null,
      M.chantiers.length ? h('div', { class: 'co-sub' }, h('h3', null, 'verrous de domaine'),
        h('ul', { class: 'co-lines' }, M.chantiers.map(x => h('li', { class: 'co-chrow' }, h('span', { class: 'co-violet' }, x.file), h('span', null, x.text))))) : null,
    ];
    return panel(2, 'Forge', { right: L ? 'occupée' : 'libre', body, foot: M.queue.length ? T.plural(M.queue.length, 'en file', 'en file') : null });
  }

  // ---------- 4 version ----------
  const FCLS = { proven: 'co-ok', progress: 'co-blue', failing: 'co-ko', broken: 'co-ko', todo: 'co-dim', locked: 'co-dim', final: 'co-warn' };
  function checkLines(checks) {
    return checks.map((k, i) => h('div', { class: 'co-check' },
      h('span', { class: 'co-tree', 'aria-hidden': 'true' }, i === checks.length - 1 ? '└' : '├'),
      h('span', null, k.text, ' ', h('span', { class: okCls(k.ok) }, k.verb),
        k.detail || k.at ? h('span', { class: 'co-dim' }, ' ', k.detail || '', k.detail && k.at ? ', ' : '', k.at ? T.agoEl(k.at) : '') : null)));
  }
  function versionPanel(M) {
    const c = M.campaign;
    const past = M.past.length ? h('div', { class: 'co-sub' }, h('h3', null, 'versions passées'),
      h('ul', { class: 'co-lines' }, M.past.map(p => h('li', null, h('b', null, p.name), ' ', p.won ? h('span', { class: 'co-ok' }, 'validée ', h('span', { class: 'co-dim' }, T.agoEl(p.wonAt))) : h('span', { class: 'co-dim' }, 'abandonnée'))))) : null;
    if (!c) {
      return panel(4, 'Version', { right: 'aucune', body: [
        h('p', { class: 'co-para' }, 'Aucune version en cours. Liste les features de la prochaine : la tour vérifie chacune avec les compilations et les tests, puis fait passer au jeu une épreuve finale (le package).'),
        h('div', { class: 'co-acts' }, btn('Préparer une version', T.act.openBuilder, { key: 'v', primary: true, k: 'vnew' })), past] });
    }
    if (c.won) {
      return panel(4, 'Version', { right: h('span', { class: 'co-ok' }, 'validée'), body: [
        h('div', { class: 'co-big co-ok' }, `${c.name} est validée`),
        h('dl', { class: 'co-kv' },
          kv('durée', T.dur(c.wonAt - c.createdAt)), kv('features', String(c.features.length)),
          kv('builds et tests', String(c.stats.builds)), kv('échecs corrigés', String(c.stats.failures)), kv('agents', String(c.stats.agents)),
          c.commit ? kv('commit', h('span', { class: 'co-violet' }, c.commit.sha), c.commit.dirty ? h('span', { class: 'co-warn' }, `, ${T.plural(c.commit.dirty, 'fichier non commité', 'fichiers non commités')}`) : null) : null),
        h('div', { class: 'co-acts' }, btn('Ranger', T.act.archive, { k: 'varch' }), btn('Préparer la suivante', T.act.next, { key: 'v', primary: true, k: 'vnext' })), past] });
    }
    const cur = selFeat(M);
    const cells = [...c.features.map(f => [f.status, `${f.title} : ${f.statusText}`]), [c.final.status, `Épreuve finale : ${c.final.statusText}`]];
    const body = [
      h('div', { class: 'co-vhead' },
        h('b', { class: 'co-big' }, c.name), h('span', { class: 'co-dim' }, c.project),
        h('span', { class: 'co-grow' }),
        h('span', null, h('b', null, `${c.proven}/${c.total}`), h('span', { class: 'co-dim' }, ' prêtes')),
        h('span', { class: 'co-meter', role: 'img', 'aria-label': `${c.proven} features prêtes sur ${c.total}` }, cells.map(([s, t]) => h('span', { class: `co-cell co-c-${s}`, title: t })))),
      c.next ? h('p', { class: `co-next co-n-${c.next.tone}` }, h('span', { class: 'co-prompt', 'aria-hidden': 'true' }, '$'), h('span', null, c.next.text)) : null,
      h('div', { class: 'co-feats' }, c.features.map(f => h('div', { class: `co-feat${f === cur ? ' is-sel' : ''}` },
        h('button', { type: 'button', class: 'co-row co-frow', 'aria-current': f === cur ? 'true' : 'false', 'data-k': 'ft-' + f.id, onclick: () => { st.feat = f.id; st.focus = 4; T.rerender(); } },
          h('span', { class: 'co-mark', 'aria-hidden': 'true' }, f === cur ? '>' : ''),
          h('span', { class: `co-fst ${FCLS[f.status] || ''}` }, f.statusText),
          h('b', { class: 'co-ftitle' }, f.title)),
        f.manual ? btn(f.manual.done ? 'Annuler le test' : 'Je l\'ai testée', () => T.act.manual(f.id, !f.manual.done), { primary: !f.manual.done, key: f === cur ? 't' : null, k: 'man-' + f.id }) : h('span'),
        h('div', { class: 'co-checks' }, checkLines(f.checks)))),
      h('div', { class: 'co-feat co-final' },
        h('div', { class: 'co-row co-frow co-static' },
          h('span', { class: 'co-mark' }),
          h('span', { class: `co-fst ${FCLS[c.final.status] || ''}` }, c.final.statusText),
          h('b', { class: 'co-ftitle' }, 'Épreuve finale')),
        h('span'),
        h('div', { class: 'co-checks' }, c.final.locked ? h('div', { class: 'co-check co-dim' }, h('span', { class: 'co-tree' }, '│'), h('span', null, 'se débloque quand toutes les features sont prêtes')) : null, checkLines(c.final.checks)))),
      h('div', { class: 'co-acts' }, btn('Abandonner la version', T.act.abandon, { danger: true, k: 'vab' })),
      past];
    return panel(4, 'Version', { right: c.name, body, foot: `${c.pct} %` });
  }

  // ---------- 5 historique ----------
  function historyPanel(M) {
    if (!M.builds.length) return panel(5, 'Historique', { body: h('p', { class: 'co-empty' }, 'Les compilations et tests lancés par tes agents apparaîtront ici.') });
    const cur = selBuild(M);
    const fails = M.builds.filter(b => !b.ok).length;
    const body = h('div', { class: 'co-list' }, M.builds.map(b => {
      const open = T.ui.openBuilds.has(b.id);
      return h('div', { class: 'co-bitem' },
        h('button', { type: 'button', class: 'co-row co-build', 'aria-current': b === cur ? 'true' : 'false', 'aria-expanded': String(open), 'data-k': 'b-' + b.id,
          onclick: () => { st.build = b.id; st.focus = 5; T.act.toggleBuild(b.id); } },
        h('span', { class: 'co-mark', 'aria-hidden': 'true' }, b === cur ? '>' : ''),
        h('span', { class: 'co-dim' }, T.clock(b.endedAt)),
        h('span', { class: b.ok ? 'co-ok' : 'co-ko' }, b.ok ? 'réussi' : 'échec'),
        h('span', { class: 'co-bwhat' }, b.kindText, b.detail ? h('span', { class: 'co-dim' }, ' ' + b.detail) : null),
        h('span', { class: 'co-bwho' }, b.agent ? b.agent.name : b.label),
        h('span', { class: 'co-dim co-right' }, T.dur(b.durationMs))),
        open ? h('div', { class: 'co-bopen' },
          h('div', null, h('span', { class: b.ok ? 'co-ok' : 'co-ko' }, b.summary || ''), h('span', { class: 'co-dim' }, b.how ? `, ${b.how}` : '', b.waitMs > 1000 ? `, a attendu ${T.dur(b.waitMs)} la forge` : '')),
          b.command ? h('code', { class: 'co-cmd' }, b.command) : null,
          b.lines.length ? h('pre', { class: 'co-errs' }, b.lines.join('\n')) : null) : null);
    }));
    return panel(5, 'Historique', { right: fails ? h('span', null, h('span', { class: 'co-ko' }, String(fails)), ` échec${fails > 1 ? 's' : ''} sur ${M.builds.length}`) : `${M.builds.length} réussis`, body, foot: `${M.builds.indexOf(cur) + 1} sur ${M.builds.length}` });
  }

  // ---------- 6 carte + projets ----------
  function mapPanel(M) {
    const projects = h('div', { class: 'co-sub' }, h('h3', null, 'projets connectés'),
      M.projects.length ? h('ul', { class: 'co-lines' }, M.projects.map((p, i) => h('li', { class: 'co-projrow' },
        h('b', null, p.name), h('span', { class: 'co-dim' }, `UE ${p.engine || '?'}`), h('span', { class: 'co-dim co-path', title: p.uproject }, p.root || p.uproject),
        btn('Déconnecter', () => T.act.disconnect(p), { k: 'disc' + i }))))
        : h('p', { class: 'co-empty' }, 'Aucun projet Unreal connecté : connecte celui de tes agents pour voir sa carte.'),
      h('div', { class: 'co-acts' }, btn('Connecter un projet', T.act.openProjects, { key: 'p', primary: !M.projects.length, k: 'proj' })));
    if (!M.inv) {
      return panel(6, 'Carte', { body: [h('p', { class: 'co-empty' }, M.projects.length ? 'Inventaire du projet en cours…' : 'La carte du projet apparaîtra ici.'), M.projects.length ? h('div', { class: 'co-acts' }, btn('Recompter', T.act.refreshMap, { key: 'r', k: 'refresh' })) : null, projects] });
    }
    const r = T.room(M.inv, T.ui.mapRoom);
    const tabs = M.inventories.length > 1 ? h('div', { class: 'co-tabs', role: 'tablist' }, M.inventories.map(i => h('button', {
      type: 'button', role: 'tab', class: 'co-tab', 'aria-selected': String(i.project === M.inv.project), 'data-k': 'tab-' + i.project,
      onclick: () => { T.ui.mapProject = i.project; T.rerender(); } }, i.project))) : null;
    const body = [
      tabs,
      h('div', { class: 'co-mapstats' },
        h('span', null, h('b', null, T.num(M.inv.assets)), h('span', { class: 'co-dim' }, ' assets')),
        M.inv.code ? h('span', null, h('b', null, T.num(M.inv.code.lines)), h('span', { class: 'co-dim' }, ' lignes de C++')) : null,
        M.inv.code && M.inv.code.tests != null ? h('span', null, h('b', null, T.num(M.inv.code.tests)), h('span', { class: 'co-dim' }, ' tests')) : null,
        h('span', { class: 'co-grow' }),
        M.inv.scannedAt ? h('span', { class: 'co-dim' }, 'compté ', T.agoEl(M.inv.scannedAt)) : null,
        btn('Recompter', T.act.refreshMap, { key: 'r', k: 'refresh' })),
      h('div', { class: 'co-mapframe' }, T.mapEl(M.inv)),
      h('div', { class: 'co-room' },
        r ? [
          h('div', null, h('b', { style: { color: r.color } }, r.name), ' ', h('span', null, T.num(r.count)), h('span', { class: 'co-dim' }, r.recent ? `, ${r.recent} modifiés ces 3 derniers jours` : ', rien de modifié ces 3 derniers jours'),
            r.workers.length ? h('span', { class: 'co-blue' }, `, ${r.workers.join(', ')} y travaille${r.workers.length > 1 ? 'nt' : ''}`) : null),
          r.latest && r.latest.length ? h('div', { class: 'co-dim' }, 'derniers : ', r.latest.slice(0, 5).map(l => l.name).join(', ')) : null]
          : h('span', { class: 'co-dim' }, 'Clique une extension de la carte pour voir ce qu\'elle contient.')),
      projects];
    return panel(6, 'Carte', { right: M.inv.project, body });
  }

  // ---------- rendu ----------
  function render(root, M) {
    LM = M;
    if (!st.bound) { st.bound = true; document.addEventListener('keydown', onKey); document.documentElement.classList.add('co-html'); }
    // Garder le defilement des panneaux et l'element qui a le focus d'un rendu a l'autre.
    const scrolls = {};
    root.querySelectorAll('[data-scroll]').forEach(el => { scrolls[el.dataset.scroll] = el.scrollTop; });
    const act = document.activeElement;
    const fk = act && root.contains(act) && act.dataset ? act.dataset.k : null;

    bar = h('footer', { class: 'co-bar', 'aria-label': 'Raccourcis du panneau actif' }, barKids());
    root.replaceChildren(h('div', { class: 'co-app' },
      header(M),
      alerts(M),
      h('main', { class: 'co-grid' }, agentsPanel(M), forgePanel(M), detailPanel(M), versionPanel(M), historyPanel(M), mapPanel(M)),
      bar));

    root.querySelectorAll('[data-scroll]').forEach(el => { if (scrolls[el.dataset.scroll]) el.scrollTop = scrolls[el.dataset.scroll]; });
    if (fk) { const el = root.querySelector(`[data-k="${CSS.escape(fk)}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  T.register({ id: 'console', render });
})();
