'use strict';
// L'application « Conversations » : la tour sans le jeu. A gauche, les conversations (le Chef, le Conseil,
// chaque session, les sujets en sommeil) ; au centre, celle qu'on a ouverte, ou chaque demande avance
// etape par etape ; a droite, ce qui t'attend, la forge, la version et la sante du projet.
// Les fiches (sauvegarde, git, doc, skills...) viennent de web/appli/fiches.js et s'ouvrent dans un volet.
// Un template appelle Appli.mode({ id }) ; la page se dessine a chaque nouvel etat de la tour (web/core.js).

(function () {
  const T = window.Tower, h = T.h;
  let F = null; // window.Fiches, charge juste apres ce fichier
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage bloque */ } },
  };
  // Etat de l'ecran, garde d'un rendu a l'autre.
  // la demo garde sa propre conversation ouverte, pour ne pas laisser une session fictive sur la vraie tour
  const CONV_KEY = T.demo ? 'appli.conv.demo' : 'appli.conv';
  const ui = { conv: store.get(CONV_KEY) || 'chef', at: 0, sheet: null, q: '', old: false, sleep: false, menu: false, view: 'list', drafts: new Map() };
  const A = window.Appli = { M: null, nav: { paint, conv, sheet, close }, mode };
  setTheme(store.get('appli.theme') || 'sombre');

  const ready = new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'appli/fiches.js';
    s.onload = () => { F = window.Fiches; res(); };
    document.body.append(s);
  });
  function mode(def) { ready.then(() => T.register({ id: def.id, render })); }

  function setTheme(t) {
    document.documentElement.dataset.theme = t === 'clair' ? 'clair' : 'sombre';
    store.set('appli.theme', t);
  }

  // ---------- navigation (appelee aussi par les fiches) ----------
  function conv(id) {
    if (id == null) id = 'chef';
    if (ui.conv !== id) { saveDraft(); ui.conv = id; store.set(CONV_KEY, id); }
    ui.at = Date.now();
    ui.view = 'conv';
    ui.menu = false;
    if (ui.sheet === 'session' || ui.sheet === 'rail') ui.sheet = null;
    paint();
    loadDraft();
    if (G && window.innerWidth > 760) G.text.focus({ preventScroll: true });
  }
  function sheet(kind) {
    ui.sheet = kind;
    ui.menu = false;
    paint();
    if (G) { G.sheet.scrollTop = 0; const x = G.sheet.querySelector('.us-x'); if (x) x.focus({ preventScroll: true }); }
  }
  function close() {
    if (!ui.sheet) return;
    const was = ui.sheet;
    ui.sheet = null;
    paint();
    const back = G && G.app.querySelector(`[data-sheet="${was}"]`);
    if (back) back.focus({ preventScroll: true });
  }

  // ---------- ce qu'on garde quand une zone est redessinee ----------
  // Les zones sont refaites a chaque nouvelle donnee : on remet le defilement, les <details> ouverts et
  // le champ en cours de saisie (son texte et son curseur), retrouves par le meme chemin.
  function viewPath(el, root) {
    const path = [];
    for (let e = el; e && e !== root; e = e.parentElement) {
      const sig = e.tagName + '.' + (e.getAttribute('class') || '');
      let n = 0;
      for (let x = e.previousElementSibling; x; x = x.previousElementSibling) if (x.tagName + '.' + (x.getAttribute('class') || '') === sig) n++;
      path.push([sig, n]);
    }
    return path.reverse();
  }
  function viewFind(root, path) {
    let cur = root;
    for (const [sig, n] of path) {
      let k = -1, hit = null;
      for (const x of cur.children) if (x.tagName + '.' + (x.getAttribute('class') || '') === sig && ++k === n) { hit = x; break; }
      if (!hit) return null;
      cur = hit;
    }
    return cur;
  }
  function swap(root, nodes) {
    nodes = nodes.flat(Infinity).filter(x => x != null && x !== false);
    // rien n'a change : on garde les noeuds (un clic en cours, un survol, un focus ne sont pas perdus)
    if (nodes.length === root.childNodes.length && nodes.every((n, i) => n instanceof Node && n.isEqualNode(root.childNodes[i]))) return;
    const scrolls = [], opens = [];
    for (const d of root.querySelectorAll('details')) opens.push([viewPath(d, root), d.open]);
    for (const el of [root, ...root.querySelectorAll('*')]) if (el.scrollTop || el.scrollLeft) scrolls.push([el === root ? [] : viewPath(el, root), el.scrollTop, el.scrollLeft]);
    const act = document.activeElement;
    const typing = act && act.dataset && act.dataset.keep && root.contains(act) ? [act.dataset.keep, act.value, act.selectionStart, act.selectionEnd] : null;
    // un bouton qui avait le focus clavier le retrouve a la meme place (Tab ne repart pas du debut)
    const focusAt = !typing && act && act !== root && root.contains(act) ? viewPath(act, root) : null;
    root.replaceChildren(...nodes.map(n => n instanceof Node ? n : document.createTextNode(String(n))));
    for (const [p, o] of opens) { const d = viewFind(root, p); if (d && d.tagName === 'DETAILS') d.open = o; }
    for (const [p, top, left] of scrolls) { const el = p.length ? viewFind(root, p) : root; if (el) { el.scrollTop = top; el.scrollLeft = left; } }
    if (focusAt) { const el = viewFind(root, focusAt); if (el && el.focus) el.focus({ preventScroll: true }); }
    if (typing) {
      const el = root.querySelector(`[data-keep="${CSS.escape(typing[0])}"]`);
      if (el) {
        if (typeof typing[1] === 'string' && el.value !== typing[1]) el.value = typing[1];
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(typing[2], typing[3]); } catch { /* champ sans curseur */ }
      }
    }
  }

  // ---------- les conversations ----------
  const RANK = { waiting: 0, idle: 1, working: 2, silent: 3, ready: 4, ended: 5 };
  const nameOf = (a) => a.label || a.salle || a.name;
  // l'initiale d'un nom, sans le prefixe des agents du projet (« ctb-ia » donne « I »)
  const initial = (t) => (String(t || '?').trim().replace(/^[a-z]{2,4}-(?=\S)/i, '').charAt(0) || '?').toUpperCase();
  // le bouton de la fiche ouverte reste allume
  const on = (kind) => (ui.sheet === kind ? ' on' : '');
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const DOT = { waiting: 'warn', idle: 'ok', working: 'blue', ready: 'grey', silent: 'grey', ended: 'grey' };
  function preview(a) {
    if (a.pending) return a.pending.kind === 'permission' ? `Autorisation : ${a.pending.tool || ''} ${a.pending.summary || ''}` : `Question : ${(a.pending.questions[0] || {}).question || ''}`;
    if (a.st === 'waiting') return a.ask || 'attend ta réponse';
    if (a.st === 'idle') return a.said || 'a fini, à toi';
    if (a.st === 'working' && a.tool) return `${a.tool.name} ${a.tool.summary || ''}`;
    return a.prompt || a.stText;
  }
  // Une session qu'on vient de reveiller ne devient « le chef » ou « ce sujet » qu'a son premier message
  // (quelques secondes) : d'ici la, la conversation la montre qui demarre, et on ne la relance pas.
  const woken = new Map(); // id de conversation -> { sid, at }
  function justWoken(M, id, chef) {
    const w = woken.get(id);
    if (!w || Date.now() - w.at > 120000) { woken.delete(id); return null; }
    const a = M.agents.find(x => x.id === w.sid);
    return a ? { kind: 'agent', a, chef } : { kind: 'starting', id: w.sid, chef };
  }
  function chefOf(M) { return M.chef && M.chef.session ? M.agents.find(x => x.id === M.chef.session.id) || null : null; }
  // ce que la conversation ouverte designe : une session, le chef en sommeil, le conseil, un sujet en sommeil
  function target(M, id) {
    if (id === 'conseil') return { kind: 'conseil' };
    if (id === 'chef') {
      if (!M.chef) return { kind: 'none' };
      const a = chefOf(M);
      return a ? { kind: 'agent', a, chef: true } : justWoken(M, 'chef', true) || { kind: 'sleep', z: M.chef, chef: true };
    }
    if (String(id).startsWith('sujet:')) {
      const z = F.sujetOfId(M, id);
      if (!z) return { kind: 'none' };
      if (z.session) return { kind: 'agent', a: M.agents.find(x => x.id === z.session.id) || z.session };
      return justWoken(M, id, false) || { kind: 'sleep', z };
    }
    const a = M.agents.find(x => x.id === id);
    if (a && a.kind === 'chef' && M.chef && M.chef.session && M.chef.session.id === a.id) return { kind: 'agent', a, chef: true };
    // une session qu'on vient de lancer n'est pas encore dans l'etat de la tour
    return a ? { kind: 'agent', a } : Date.now() - ui.at < 60000 ? { kind: 'starting', id } : { kind: 'none' };
  }
  // l'id de liste de la conversation ouverte (le chef garde la sienne, meme reveille)
  function listId(M) {
    const t = target(M, ui.conv);
    if (t.chef) return 'chef';
    return t.kind === 'agent' ? t.a.id : ui.conv;
  }

  function convItem(M, o) {
    const on = listId(M) === o.id;
    return h('li', null, h('button', {
      type: 'button', class: `ap-item${on ? ' on' : ''}${o.tone === 'warn' ? ' ap-wait' : ''}`, 'aria-current': on ? 'true' : null,
      onclick: () => conv(o.id),
    },
    h('span', { class: `ap-av ap-av-${o.av || 'sess'}`, 'aria-hidden': 'true' }, o.mono || initial(o.title), h('i', { class: `ap-dot ap-d-${o.tone || 'grey'}` })),
    h('span', { class: 'ap-itext' },
      h('span', { class: 'ap-ihead' }, h('b', null, o.title), o.at ? T.agoEl(o.at, 'small', { class: 'ap-iat' }) : null),
      h('span', { class: 'ap-iprev' }, o.sub || '')),
    o.badge ? h('span', { class: 'ap-badge', title: o.badgeTitle || '' }, o.badge) : null));
  }
  function lists(M) {
    const q = ui.q.trim().toLowerCase();
    const hit = (o) => !q || `${o.title} ${o.sub || ''} ${o.project || ''}`.toLowerCase().includes(q);
    // epinglees : le chef et le conseil
    const ca = chefOf(M);
    const wait = M.chef ? M.chef.envois.filter(e => e.status === 'proposé').length : 0;
    const K = F.conseilOf(M), run = K && K.runs && K.runs[0];
    const pinned = [];
    if (M.chef) pinned.push({ id: 'chef', title: 'Chef', av: 'chef', mono: 'C', tone: ca ? (wait ? 'warn' : DOT[ca.st]) : wait ? 'warn' : 'grey', at: ca ? ca.lastSeen : null,
      sub: ca ? preview(ca) : 'Confie-lui une demande : il vérifie, te répond, puis confie le travail.', badge: wait || null, badgeTitle: wait ? `${T.plural(wait, 'envoi attend', 'envois attendent')} ton accord` : '' });
    pinned.push({ id: 'conseil', title: 'Conseil', av: 'conseil', mono: 'K', tone: run && F.isLive(run) ? 'blue' : run && run.step === 'fini' ? 'ok' : 'grey', at: run ? run.at : null,
      sub: !K ? 'Cinq avis et un président, pour un vrai choix.' : run && F.isLive(run) ? `En cours : ${K.steps[run.step] || run.step}` : run && run.decision ? run.decision : run ? clip(run.question, 90) : 'Cinq avis et un président, pour un vrai choix.' });
    // les sessions de la tour
    const sess = M.agents.filter(a => !a.old && a.kind !== 'chef')
      .sort((x, y) => (RANK[x.st] - RANK[y.st]) || (y.lastSeen - x.lastSeen))
      .map(a => ({ id: a.id, title: nameOf(a), project: a.project, av: a.kind || 'sess', tone: DOT[a.st], at: a.lastSeen, sub: preview(a) }));
    // les sujets et features sans session : une conversation qu'on reveille en ecrivant
    const sleep = [...(M.sujets || []), ...(M.features || []).filter(f => !f.done)].filter(z => !z.session)
      .map(z => ({ id: 'sujet:' + z.id, title: z.title, av: z.kind, tone: 'grey', at: z.notes ? z.notes.at : null,
        sub: z.notes && z.notes.where ? clip(z.notes.where, 90) : z.kind === 'feature' ? clip(z.idea, 90) : 'En sommeil : écris-lui pour la réveiller.' }));
    const old = M.agents.filter(a => a.old && a.kind !== 'chef').sort((x, y) => y.lastSeen - x.lastSeen).slice(0, 40)
      .map(a => ({ id: a.id, title: nameOf(a), av: a.kind || 'sess', tone: 'grey', at: a.lastSeen, sub: a.hidden ? 'rangée' : a.stText }));
    return { pinned: pinned.filter(hit), sess: sess.filter(hit), sleep: sleep.filter(hit), old: old.filter(hit), q };
  }
  function group(title, items, key) {
    if (!items.length) return null;
    const fold = key && !ui[key] && !(ui.q || '').trim();
    return h('section', { class: 'ap-group' },
      key ? h('button', { type: 'button', class: 'ap-gtitle ap-gfold', 'aria-expanded': String(!fold), onclick: () => { ui[key] = !ui[key]; paintSide(); } },
        h('span', null, title), h('small', null, items.length))
        : h('h2', { class: 'ap-gtitle' }, h('span', null, title), h('small', null, items.length)),
      fold ? null : h('ul', { class: 'ap-items' }, items.map(o => convItem(A.M, o))));
  }
  function paintSide() {
    const M = A.M;
    const L = lists(M);
    const waits = M.counts.waiting;
    swap(G.head1, [
      h('div', { class: 'ap-brand' }, h('span', { class: 'ap-logo', 'aria-hidden': 'true' }), h('b', null, 'Tower'),
        h('span', { class: `ap-live${M.demo ? ' demo' : M.connected ? ' on' : ''}`, title: M.demo ? 'Démo : rien n\'est envoyé' : M.connected ? 'Branchée sur la tour' : 'La tour ne répond pas' },
          M.demo ? 'démo' : M.connected ? 'en direct' : 'hors ligne')),
      h('div', { class: 'ap-sideacts' },
        h('button', { type: 'button', class: 'us-btn ap-railbtn' + on('rail'), 'data-sheet': 'rail', onclick: () => sheet('rail'), title: 'Ce qui t\'attend, la forge, la version, la santé du projet, les réglages' },
          'Tableau', M.attention.length ? h('span', { class: 'ap-badge' }, M.attention.length) : null),
        newMenu(M)),
    ]);
    swap(G.list, [
      group('Épinglées', L.pinned),
      group(waits ? `Sessions · ${waits} t'attend${waits > 1 ? 'ent' : ''}` : 'Sessions', L.sess),
      !L.sess.length && !L.q ? h('p', { class: 'ap-empty' }, M.chef ? 'Aucune session ne tourne. Écris au Chef, ou lance une tâche avec « Nouveau ».' : 'Aucune session ne tourne. Connecte ton projet Unreal (Réglages) : le Chef et les sujets du jeu arrivent avec lui.') : null,
      group('En sommeil', L.sleep, 'sleep'),
      group('Anciennes', L.old, 'old'),
      L.q && !L.pinned.length && !L.sess.length && !L.sleep.length && !L.old.length ? h('p', { class: 'ap-empty' }, `Rien ne correspond à « ${ui.q.trim()} ».`) : null,
    ]);
  }
  // « Nouveau » : tout ce qu'on peut demander a la tour, au meme endroit.
  function newMenu(M) {
    const item = (label, sub, fn, off) => h('li', null, h('button', { type: 'button', class: 'ap-mitem', role: 'menuitem', disabled: off || null, onclick: () => { ui.menu = false; paintSide(); fn(); } }, h('b', null, label), h('small', null, sub)));
    return h('div', { class: 'ap-new' },
      h('button', { type: 'button', class: 'us-btn us-go ap-newbtn', 'aria-haspopup': 'menu', 'aria-expanded': String(ui.menu), onclick: () => { ui.menu = !ui.menu; paintSide(); } }, '+ Nouveau'),
      ui.menu ? h('ul', { class: 'ap-menu', role: 'menu' },
        item('Écrire au Chef', M.chef ? 'Un bug, une idée, des assets à vérifier' : 'Connecte d\'abord ton projet (Réglages)', () => conv('chef'), !M.chef),
        item('Demander au Conseil', 'Un vrai choix à trancher', () => conv('conseil')),
        item('Lancer une tâche', 'Relecture, anomalies, idées, ou la tienne', () => sheet('taches')),
        item('Nouvelle feature', 'Une idée neuve, avec sa conversation', () => F.featureDialog(M), M.demo || !M.sujetsProject),
        item('Préparer une version', 'Les features à prouver, puis le package', () => T.act.openBuilder())) : null);
  }

  // ---------- la conversation ouverte ----------
  const chat = { id: null, sig: '', seq: 0, mine: '', mineId: null };
  function demoMsgs(a) {
    const out = [];
    const t0 = a.raw.startedAt || a.lastSeen - 20 * 60000;
    if (a.prompt) out.push({ who: 'toi', kind: 'text', text: a.prompt, at: t0 });
    if (a.tool) out.push({ who: 'chef', kind: 'action', text: `${a.tool.name} ${a.tool.summary || ''}`, at: a.tool.at });
    if (a.said || a.ask) out.push({ who: 'chef', kind: 'text', text: a.said || a.ask, at: a.lastSeen });
    return out;
  }
  async function refreshChat(M, a, force) {
    const c = a.raw.chat || {};
    const sig = `${a.lastSeen}|${!!c.busy}|${a.raw.transcript || ''}`;
    if (chat.id !== a.id) { chat.id = a.id; chat.sig = ''; if (chat.mineId !== a.id) chat.mine = ''; G.log.replaceChildren(h('p', { class: 'ap-hint' }, 'Lecture de la conversation…')); force = true; }
    if (!force && sig === chat.sig) return;
    chat.sig = sig;
    const near = G.scroll.scrollHeight - G.scroll.scrollTop - G.scroll.clientHeight < 80;
    if (M.demo) {
      G.log.replaceChildren(...F.chatItems(demoMsgs(a), a, M), h('p', { class: 'ap-hint' }, 'Démo : la vraie conversation se lit sur ta tour.'));
      if (near || force) G.scroll.scrollTop = G.scroll.scrollHeight;
      return;
    }
    const id = a.id, seq = ++chat.seq; // une lecture plus ancienne qui revient apres ne recouvre pas la derniere
    let r = null;
    try { r = await fetch(`/api/chat?session=${encodeURIComponent(id)}&n=80`).then(x => x.json()); } catch { /* tour injoignable */ }
    if (chat.id !== id || seq !== chat.seq) return;
    const msgs = (r && r.messages) || [];
    // ton dernier message s'affiche tout de suite, avant que la session l'ait ecrit dans son journal
    if (chat.mine && !msgs.some(m => m.who === 'toi' && m.text === chat.mine)) msgs.push({ who: 'toi', kind: 'text', text: chat.mine, at: Date.now() });
    else chat.mine = '';
    const keep = G.scroll.scrollHeight - G.scroll.scrollTop - G.scroll.clientHeight < 80;
    // swap garde les rapports ouverts et ne refait rien si rien n'a change (selection, lecteur d'ecran)
    swap(G.log, msgs.length ? F.chatItems(msgs, a, M)
      : [h('p', { class: 'ap-hint' }, r && r.ok === false ? r.error : r && r.waiting ? 'La session démarre : ses messages arrivent ici.' : 'Pas encore de message.')]);
    if (keep || near || force) G.scroll.scrollTop = G.scroll.scrollHeight;
  }
  // ton dernier message (chat.mine) reste : la session qui demarre l'affichera des qu'elle est la
  function clearChat() { chat.id = null; chat.sig = ''; chat.seq++; G.log.replaceChildren(); }

  // les demandes de cette conversation, au fil de leurs etapes
  function demsFor(M, pred) {
    // les envois du Chef sont des demandes filles : la session qui les recoit les montre aussi
    const flat = (l) => l.flatMap(x => [x, ...flat(x.children || [])]);
    return flat(F.demsOf(M)).filter(x => pred(x) && (!F.demFinal(x) || !x.seenAt)).sort(F.demSort).slice(0, 4).map(x =>
      h('button', { type: 'button', class: `ap-dem ap-dem-${x.state}`, onclick: () => F.openDem(x.id), title: 'Voir son parcours' },
        h('span', { class: `us-dot us-d-${F.DEM_DOT[x.state]}` }),
        h('span', { class: 'ap-dem-txt' }, h('b', null, x.stateText), ' ', clip(F.demNow(x), 140)),
        h('small', null, F.demFinal(x) ? T.clock(x.doneAt) : T.forEl(x.at))));
  }

  function head(M, t) {
    const actions = [];
    let title = '', sub = [], tone = 'grey', chip = '';
    if (t.kind === 'agent') {
      const a = t.a;
      title = t.chef ? 'Chef' : nameOf(a);
      tone = DOT[a.st]; chip = a.stText;
      sub = [a.project || a.where, a.subs ? T.plural(a.subs, 'sous-agent', 'sous-agents') : null, a.usage && a.usage.contextPct != null ? `contexte ${a.usage.contextPct} %` : null,
        a.holds ? 'compile en ce moment' : a.queuePos ? `${a.queuePos}e dans la file de la forge` : null];
      actions.push(F.btn('Détails', () => sheet('session'), on('session'), { 'data-sheet': 'session', title: 'Suivi, tokens, sujet, renommer ou ranger' }));
    } else if (t.kind === 'conseil') {
      title = 'Conseil'; sub = ['Cinq membres, une relecture anonyme, un président qui tranche'];
      const run = (F.conseilOf(M) || {}).runs; const r = run && run[0];
      if (r && F.isLive(r)) { tone = 'blue'; chip = 'se réunit'; }
    } else if (t.kind === 'sleep') {
      title = t.chef ? 'Chef' : t.z ? t.z.title : '';
      chip = 'en sommeil';
      sub = [t.chef ? 'Il vérifie en lisant, te répond, puis confie les changements' : t.z && t.z.kind === 'feature' ? 'Feature' : 'Sujet du jeu (core)', M.sujetsProject];
    } else if (t.kind === 'starting') { title = t.chef ? 'Chef' : 'Nouvelle session'; chip = 'démarre'; tone = 'blue'; }
    return [
      h('button', { type: 'button', class: 'ap-back', 'aria-label': 'Retour aux conversations', onclick: () => { ui.view = 'list'; paint(); } }, '‹'),
      h('div', { class: 'ap-htext' },
        h('h1', null, title, chip ? h('span', { class: `ap-chip ap-c-${tone}` }, h('i', { class: `ap-dot ap-d-${tone}` }), chip) : null),
        h('p', null, sub.filter(Boolean).join(' · '))),
      h('div', { class: 'ap-hacts' }, actions),
    ];
  }

  // la zone de saisie : une seule, gardee d'une conversation a l'autre (avec un brouillon par conversation)
  function composeState(M, t) {
    if (t.kind === 'conseil' || t.kind === 'none') return { show: false };
    if (t.kind === 'starting') return { show: true, can: false, note: 'La session démarre…' };
    if (t.kind === 'sleep') {
      const z = t.z;
      if (!z || z.done) return { show: false };
      const can = !M.demo && !!M.sujetsProject;
      return { show: true, can, wake: z, place: t.chef ? 'Écris au Chef : ta demande le réveille.' : `Écris à ${z.title} : ton message réveille sa session.`,
        note: M.demo ? 'Démo : rien n\'est envoyé.' : !M.sujetsProject ? 'Connecte d\'abord ton projet Unreal (Réglages).' : 'En sommeil : ton message lance sa session ici, qui lit son carnet puis te répond.' };
    }
    const a = t.a, c = a.raw.chat || {};
    const can = F.canChat(a) && !M.demo, busy = !!c.busy;
    const note = M.demo ? 'Démo : rien n\'est envoyé.'
      : !F.canChat(a) ? 'Elle tourne dans sa fenêtre Claude Code : tu lis la conversation ici et tu lui écris là-bas. Une fois la fenêtre fermée, tu peux la reprendre ici.'
        : busy ? `${t.chef ? 'Le Chef' : nameOf(a)} travaille${a.tool ? ` (${a.tool.name} ${a.tool.summary || ''})` : ''}${c.queued ? `, ${T.plural(c.queued, 'message attend', 'messages attendent')} son tour` : ''}…`
          : c.error ? `Dernier message : ${c.error}` : a.st === 'ended' ? 'Session fermée : ton message la reprend ici, sans fenêtre.' : '';
    return { show: true, can, busy, note, id: a.id, place: t.chef ? 'Écris au Chef…' : `Écris à ${nameOf(a)}…` };
  }
  let sending = false; // un envoi en cours : Envoyer reste grise meme si la tour pousse un nouvel etat
  async function send() {
    const M = A.M, t = target(M, ui.conv), st = composeState(M, t);
    const text = G.text.value.trim();
    if (!text || !st.can || sending) return;
    sending = true;
    G.send.disabled = true;
    let r, sid = st.id;
    try {
      if (st.wake) {
        // reveiller la session (elle lit son carnet), puis lui passer le message
        const key = ui.conv;
        r = await T.api('/api/chat/start', { id: st.wake.id, project: M.sujetsProject });
        if (r && r.ok) {
          sid = r.sessionId;
          woken.set(key, { sid, at: Date.now() });
          r = await T.api('/api/chat/send', { sessionId: sid, text });
          if (r && r.ok && !t.chef) { ui.conv = sid; ui.at = Date.now(); store.set(CONV_KEY, sid); }
        }
      } else r = await T.api('/api/chat/send', { sessionId: st.id, text });
    } finally { sending = false; }
    if (r && r.ok) { G.text.value = ''; ui.drafts.delete(ui.conv); grow(); chat.mine = text; chat.mineId = sid; chat.sig = ''; paint(); }
    else { T.toast(r && r.error ? r.error : 'La tour ne répond pas.'); paint(); }
  }
  function saveDraft() { if (G) { if (G.text.value.trim()) ui.drafts.set(ui.conv, G.text.value); else ui.drafts.delete(ui.conv); } }
  function loadDraft() { if (G) { G.text.value = ui.drafts.get(ui.conv) || ''; grow(); } }
  function grow() { G.text.style.height = 'auto'; G.text.style.height = Math.min(220, G.text.scrollHeight + 2) + 'px'; }

  function paintMain() {
    const M = A.M, t = target(M, ui.conv);
    swap(G.head, head(M, t));
    const live = [], doc = [];
    if (t.kind === 'agent') {
      const a = t.a;
      refreshChat(M, a, false);
      const mine = demsFor(M, x => x.ref && x.ref.session === a.id);
      live.push(...mine);
      if (t.chef && M.chef) {
        const wait = M.chef.envois.filter(e => e.status === 'proposé').length;
        if (wait) live.push(h('div', { class: 'us-ask' }, h('b', null, `${T.plural(wait, 'envoi attend', 'envois attendent')} ton accord`),
          h('span', null, 'Le Chef veut confier ce travail à une session.'), h('div', { class: 'us-actions' }, F.btn('Voir et valider', () => sheet('session'), 'us-go'))));
      }
      if (a.pending) live.push(F.askBox(a));
      else if (a.st === 'waiting' && !F.canChat(a) && !mine.length) live.push(h('div', { class: 'us-ask' }, h('b', null, 'Elle attend ta réponse dans sa fenêtre'), h('span', null, a.ask || 'Une question dans sa session Claude Code.')));
      if (a.task && a.task.suivi && a.st === 'idle' && !t.chef) {
        const s = F.suiviState(a);
        if (s) live.push(h('div', { class: 'us-said' }, h('b', null, `Suivi : ${a.task.title}`), h('span', null, s.text || ''), h('div', { class: 'us-actions' }, F.btn('Voir le suivi', () => sheet('session')))));
      }
    } else {
      clearChat();
      if (t.kind === 'conseil') {
        live.push(...demsFor(M, x => x.ref && x.ref.conseil));
        doc.push(F.conseilBody(M));
      } else if (t.kind === 'sleep') {
        if (t.chef) doc.push(F.chefBody(M, t.z, null));
        else if (t.z) doc.push(F.sujetBody(M, t.z, null));
      } else if (t.kind === 'starting') doc.push(h('p', { class: 'ap-hint' }, 'La session démarre : ses messages arrivent ici dans un instant.'));
      else doc.push(h('p', { class: 'ap-hint' }, 'Cette conversation n\'existe plus. Choisis-en une à gauche.'));
    }
    swap(G.live, live);
    swap(G.doc, doc);
    G.doc.hidden = !doc.length;
    // la saisie
    const st = composeState(M, t);
    G.compose.hidden = !st.show;
    if (st.show) {
      G.text.disabled = !st.can;
      G.send.disabled = !st.can || sending;
      G.text.placeholder = st.place || 'Ton message…';
      G.stop.hidden = !st.busy;
      G.note.textContent = st.note || '';
      G.note.hidden = !st.note;
    }
  }

  // ---------- a droite : ce qui t'attend, la forge, la version, la sante ----------
  function attentionItem(x) {
    // les titres du socle nomment le personnage : ici, la session
    if (x.agent) x = { ...x, title: x.kind === 'waiting' ? `${nameOf(x.agent)} attend ta réponse` : x.agent.task && x.agent.task.title !== nameOf(x.agent) ? `${nameOf(x.agent)} a fini « ${x.agent.task.title} »` : `${nameOf(x.agent)} a fini`,
      text: x.kind === 'idle' && x.agent.task ? String(x.text).replace(/ : clique « Voir » pour le suivi\.$/, '.') : x.text };
    const go = x.agent ? () => conv(x.agent.id) : x.feature ? () => sheet('version') : null;
    return h('li', null, h(go ? 'button' : 'div', { type: go ? 'button' : null, class: `ap-att ap-att-${x.tone}`, onclick: go },
      h('span', { class: `us-dot us-d-${{ warn: 'warn', ko: 'ko', ok: 'ok', you: 'warn', info: 'blue' }[x.tone] || 'grey'}` }),
      h('span', null, h('b', null, x.title), x.text ? h('small', null, clip(x.text, 120)) : null)));
  }
  function card(kind, title, tone, lines, extra) {
    return h('button', { type: 'button', class: `ap-card ap-card-${tone}${on(kind)}`, 'data-sheet': kind, onclick: () => sheet(kind) },
      h('span', { class: 'ap-cardh' }, h('span', { class: `us-dot us-d-${tone}` }), h('b', null, title), h('span', { class: 'ap-more', 'aria-hidden': 'true' }, '›')),
      lines.filter(Boolean).map(l => h('span', { class: 'ap-cardl' }, l)), extra || null);
  }
  function healthRows(M) {
    const SV = F.svOf(M), cur = F.svCurrent(M);
    const Gt = F.gitOf(M);
    const sk = M.S.skills, ro = M.S.roster, debts = F.docDebts(M);
    const tasks = M.S.tasks || [];
    const tuto = M.S.tuto || {};
    const team = Object.values(M.S.team || {}).reduce((n, t) => n + t.length, 0);
    const worst = (tones) => tones.includes('ko') ? 'ko' : tones.includes('warn') ? 'warn' : tones.includes('blue') ? 'blue' : tones.includes('ok') ? 'ok' : 'grey';
    const svT = SV ? SV.projects.map(p => F.svTone(p, SV, M.now)) : [];
    const gitT = Gt ? Gt.repos.map(r => F.repoTone(r, Gt)) : [];
    const sujAlive = (M.sujets || []).filter(z => z.session).length;
    const feats = (M.features || []).filter(f => !f.done);
    return [
      ['sauvegarde', 'Sauvegarde', cur ? 'blue' : !SV ? 'grey' : worst(svT.map(x => x[0])),
        cur ? `en cours : ${cur.name}` : !SV ? 'lecture…' : svT.length === 1 ? svT[0][1] : (svT.find(x => x[0] === 'ko' || x[0] === 'warn') || svT[0] || [null, 'aucun projet'])[1]],
      ['git', 'Git et GitHub', !Gt ? 'grey' : F.gitAlert(M) ? 'ko' : worst(gitT.map(x => x[0])),
        !Gt ? 'lecture…' : !Gt.git ? 'git pas installé' : (gitT.find(x => x[0] !== 'ok' && x[0] !== 'off') || gitT[0] || [null, 'aucun dossier suivi'])[1] + (F.prsOf(M).length ? ` · ${T.plural(F.prsOf(M).length, 'PR ouverte', 'PR ouvertes')}` : '')],
      ['docs', 'Documentation', debts.some(d => d.owed) ? 'ko' : debts.length ? 'warn' : 'ok',
        debts.some(d => d.owed) ? `${T.plural(debts.filter(d => d.owed).length, 'session doit', 'sessions doivent')} sa doc` : debts.length ? `${T.plural(debts.length, 'session écrit', 'sessions écrivent')} sa doc` : 'à jour'],
      ['skills', 'Skills', !sk ? 'grey' : sk.ko ? 'ko' : sk.warn ? 'warn' : 'ok', !sk ? 'lecture…' : sk.ko + sk.warn ? `${sk.ko + sk.warn} à revoir sur ${sk.total}` : `${sk.total} installés`],
      ['roster', 'Agents', !ro ? 'grey' : ro.ko ? 'ko' : ro.warn ? 'warn' : 'ok', !ro ? 'lecture…' : ro.ko + ro.warn ? `${ro.ko + ro.warn} à revoir sur ${ro.total}` : `${ro.total} installés`],
      ['equipe', 'Équipe du projet', team ? 'ok' : 'grey', team ? T.plural(team, 'agent spécialisé', 'agents spécialisés') : 'aucun agent'],
      ['sujets', 'Sujets du jeu', (M.sujets || []).length ? (sujAlive ? 'blue' : 'ok') : 'grey', (M.sujets || []).length ? `${(M.sujets || []).length} sujets${sujAlive ? `, ${sujAlive} au travail` : ''}` : 'aucun'],
      ['features', 'Features', feats.length ? (feats.some(f => f.session) ? 'blue' : 'ok') : 'grey', feats.length ? T.plural(feats.length, 'idée en cours', 'idées en cours') : 'aucune'],
      ['taches', 'Tâches', 'ok', tasks.length ? T.plural(tasks.length, 'tâche prête', 'tâches prêtes') : 'consignes prêtes à lancer'],
      ['unreal', 'Unreal Engine', M.editor.open ? 'ok' : 'grey', `éditeur ${M.editor.text}`],
      ['tuto', 'Tutos', tuto.running ? 'blue' : 'grey', tuto.running ? 'un tuto tourne' : 'scénarios courts sur ta tour'],
    ];
  }
  function railNodes(M) {
    const att = M.attention;
    const L = M.lock, c = M.campaign;
    const dems = F.demsOf(M), liveD = dems.filter(x => !F.demFinal(x)), unseen = dems.filter(x => F.demFinal(x) && !x.seenAt);
    const lastKo = M.builds.find(b => !b.ok);
    return [
      h('section', { class: 'ap-rsec' },
        h('h2', { class: 'ap-gtitle' }, h('span', null, 'À toi'), att.length ? h('small', null, att.length) : null),
        att.length ? h('ul', { class: 'ap-atts' }, att.slice(0, 8).map(attentionItem)) : h('p', { class: 'ap-calm' }, 'Rien ne t\'attend. La tour tourne seule.')),
      h('section', { class: 'ap-rsec' },
        card('demandes', 'Tes demandes', liveD.some(x => x.state === 'attend') ? 'warn' : liveD.length ? 'blue' : unseen.length ? 'ok' : 'grey',
          [liveD.length ? `${liveD.length} en cours${liveD.some(x => x.state === 'attend') ? `, ${liveD.filter(x => x.state === 'attend').length} t'attend` : ''}` : 'Rien ne tourne.', unseen.length ? `${T.plural(unseen.length, 'finie', 'finies')} à voir` : null],
          liveD.length ? h('span', { class: 'ap-mini' }, liveD.slice(0, 3).map(x => h('span', null, h('i', { class: `us-dot us-d-${F.DEM_DOT[x.state]}` }), h('span', null, `${x.to} : ${clip(F.demNow(x), 80)}`)))) : null),
        card('forge', 'Forge', L ? 'blue' : lastKo && M.now - lastKo.endedAt < 3600000 ? 'ko' : 'ok', [
          L ? h('span', null, `${L.kindText} de ${L.agent ? nameOf(L.agent) : L.label}, depuis `, T.forEl(L.since)) : 'Libre : le prochain build passe tout de suite.',
          M.queue.length ? `${M.queue.length} dans la file` : null,
          lastKo ? h('span', null, 'Dernier échec ', T.agoEl(lastKo.endedAt)) : null]),
        card('version', c ? `Version ${c.name}` : 'Version', !c ? 'grey' : c.won ? 'ok' : c.next && c.next.tone === 'ko' ? 'ko' : c.next && c.next.tone === 'you' ? 'warn' : 'blue',
          c ? [c.won ? 'Validée.' : `${c.proven} sur ${c.total} features prouvées`, c.next ? clip(c.next.text, 110) : null] : ['Aucune version en cours.'],
          c && !c.won ? h('span', { class: 'us-bar' }, h('i', { style: `width:${c.pct}%` })) : null)),
      h('section', { class: 'ap-rsec' },
        h('h2', { class: 'ap-gtitle' }, h('span', null, 'Le projet')),
        h('ul', { class: 'ap-health' }, healthRows(M).map(([k, label, tone, txt]) => h('li', null,
          h('button', { type: 'button', class: 'ap-hrow' + on(k), 'data-sheet': k, onclick: () => sheet(k) },
            h('span', { class: `us-dot us-d-${tone}` }), h('b', null, label), h('small', null, txt)))))),
      h('button', { type: 'button', class: 'ap-hrow ap-settings' + on('reglages'), 'data-sheet': 'reglages', onclick: () => sheet('reglages') }, h('span', { class: 'ap-gear', 'aria-hidden': 'true' }, '⚙'), h('b', null, 'Réglages'), h('small', null, 'projets, thème, ancienne interface')),
    ];
  }

  // ---------- le volet (une fiche ouverte par-dessus) ----------
  const TITLES = { forge: 'Forge', version: 'Version', skills: 'Skills', roster: 'Agents installés', docs: 'Documentation', unreal: 'Unreal Engine', git: 'Git et GitHub', sauvegarde: 'Sauvegarde', reglages: 'Réglages', rail: 'Tableau de bord' };
  function sheetPanel(M) {
    const k = ui.sheet;
    if (k === 'demandes') return F.demandesPanel(M);
    if (k === 'equipe') return F.equipePanel(M);
    if (k === 'sujets') return F.sujetsPanel(M);
    if (k === 'features') return F.featuresPanel(M);
    if (k === 'taches') return F.tachesPanel(M);
    if (k === 'tuto') return F.tutoPanel(M);
    let title = TITLES[k] || '', body;
    if (k === 'session') {
      const t = target(M, ui.conv);
      if (t.kind !== 'agent') return null;
      title = t.chef ? 'Le Chef' : nameOf(t.a);
      body = F.agentDetails(M, t.a);
    } else if (k === 'forge') body = F.forgeBody(M);
    else if (k === 'version') body = F.versionBody(M);
    else if (k === 'skills') body = F.skillsBody(M);
    else if (k === 'roster') body = F.rosterBody(M);
    else if (k === 'docs') body = F.docsBody(M);
    else if (k === 'unreal') body = F.unrealBody(M);
    else if (k === 'git') body = F.gitBody(M, 'git');
    else if (k === 'sauvegarde') body = F.svBody(M);
    else if (k === 'reglages') body = settingsBody(M);
    else if (k === 'rail') body = railNodes(M);
    else return null;
    return h('section', { class: `us-panel us-entity ap-k-${k}`, 'aria-label': title },
      h('div', { class: 'us-ehead' }, h('h2', null, title), F.btn('Fermer', close, 'us-x', { 'aria-label': `Fermer : ${title}`, title: 'Échap' })),
      h('div', { class: 'us-ebody' }, body));
  }
  function settingsBody(M) {
    const theme = document.documentElement.dataset.theme;
    return [
      h('div', { class: 'us-sub' }, 'Projets Unreal'),
      M.projects.length ? h('ul', { class: 'ap-projs' }, M.projects.map(p => h('li', null, h('b', null, p.name), h('span', { class: 'us-dim us-path' }, p.root || p.uproject),
        F.btn('Déconnecter', () => T.act.disconnect(p), 'us-danger', M.demo ? { disabled: true } : {}))))
        : h('p', { class: 'us-dim' }, 'Aucun projet connecté : les sujets, la doc et la sauvegarde en ont besoin.'),
      h('div', { class: 'us-actions' }, F.btn('Connecter un projet', T.act.openProjects, M.projects.length ? '' : 'us-go')),
      h('div', { class: 'us-sub' }, 'Apparence'),
      h('div', { class: 'us-seg', role: 'group', 'aria-label': 'Thème' }, [['sombre', 'Sombre'], ['clair', 'Clair']].map(([v, txt]) =>
        h('button', { type: 'button', class: 'us-segbtn', 'aria-pressed': String(theme === v), onclick: () => { setTheme(v); paint(); } }, txt))),
    ];
  }

  // ---------- la page ----------
  let G = null;
  function build(root) {
    G = {};
    G.head1 = h('div', { class: 'ap-sidehead' });
    G.search = h('input', { type: 'search', class: 'ap-search', name: 'recherche', placeholder: 'Chercher  (Ctrl+K)', 'aria-label': 'Chercher une conversation', autocomplete: 'off',
      oninput: (e) => { ui.q = e.target.value; paintSide(); },
      onkeydown: (e) => {
        if (e.key === 'Enter') { const first = G.list.querySelector('.ap-item'); if (first) first.click(); }
        if (e.key === 'Escape' && ui.q) { e.stopPropagation(); ui.q = ''; e.target.value = ''; paintSide(); }
      } });
    G.list = h('nav', { class: 'ap-list', 'aria-label': 'Conversations' });
    G.side = h('aside', { class: 'ap-side' }, G.head1, h('div', { class: 'ap-searchbox' }, G.search), G.list);
    G.head = h('header', { class: 'ap-head' });
    G.log = h('div', { class: 'ap-log', role: 'log', 'aria-live': 'polite' });
    G.live = h('div', { class: 'ap-livebox' });
    G.doc = h('div', { class: 'ap-doc' });
    G.scroll = h('div', { class: 'ap-scroll' }, h('div', { class: 'ap-col' }, G.log, G.live, G.doc));
    G.text = h('textarea', { name: 'message', rows: 1, maxlength: 20000, 'aria-label': 'Ton message', placeholder: 'Ton message…',
      oninput: grow, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } } });
    G.send = h('button', { type: 'submit', class: 'us-btn us-go' }, 'Envoyer');
    G.stop = F.btn('Arrêter', async () => { const t = target(A.M, ui.conv); if (t.kind !== 'agent') return; const r = await T.api('/api/chat/stop', { sessionId: t.a.id }); if (r && r.error) T.toast(r.error); }, 'us-danger', { title: 'Arrête ce qu\'elle fait : la session garde son historique' });
    G.note = h('p', { class: 'ap-note' });
    G.compose = h('form', { class: 'ap-compose', onsubmit: (e) => { e.preventDefault(); send(); } },
      h('div', { class: 'ap-col' }, G.note, h('div', { class: 'ap-cbox' }, G.text, G.stop, G.send), h('small', { class: 'ap-keys' }, 'Entrée envoie · Maj+Entrée va à la ligne')));
    G.main = h('main', { class: 'ap-main' }, G.head, G.scroll, G.compose);
    G.rail = h('aside', { class: 'ap-rail', 'aria-label': 'Tableau de bord' });
    G.sheet = h('div', { class: 'ap-sheet', role: 'dialog', 'aria-modal': 'false' });
    G.shade = h('div', { class: 'ap-shade', onclick: close });
    G.app = h('div', { class: 'ap' }, G.side, G.main, G.rail, G.shade, G.sheet);
    root.replaceChildren(G.app);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.view = 'list'; paint(); G.search.focus(); G.search.select(); return; }
      if (e.key === 'Escape') {
        if (document.querySelector('dialog[open]')) return; // un dialogue se ferme tout seul
        if (ui.menu) { ui.menu = false; paintSide(); return; }
        if (ui.sheet) { close(); }
      }
    });
    document.addEventListener('click', (e) => { if (ui.menu && !e.target.closest('.ap-new')) { ui.menu = false; paintSide(); } });
    loadDraft();
  }

  function paint() {
    const M = A.M;
    if (!M || !G) return;
    // une conversation qui n'existe plus (session retiree) : on revient au chef
    // (le texte en cours reste en brouillon de l'ancienne : il ne part pas au chef par erreur)
    if (target(M, ui.conv).kind === 'none') { saveDraft(); ui.conv = M.chef ? 'chef' : 'conseil'; store.set(CONV_KEY, ui.conv); loadDraft(); }
    G.app.dataset.view = ui.view;
    paintSide();
    paintMain();
    swap(G.rail, railNodes(M));
    const panel = ui.sheet ? sheetPanel(M) : null;
    if (ui.sheet && !panel) ui.sheet = null;
    const was = G.sheet.firstChild;
    if (panel && was && was.getAttribute('aria-label') === panel.getAttribute('aria-label')) swap(G.sheet, [panel]);
    else G.sheet.replaceChildren(...(panel ? [panel] : []));
    G.app.classList.toggle('ap-has-sheet', !!panel);
    if (panel) G.sheet.setAttribute('aria-label', panel.getAttribute('aria-label')); else G.sheet.removeAttribute('aria-label');
  }

  function render(root, M) {
    A.M = M;
    if (!G || !root.contains(G.app)) build(root);
    paint();
    F.demNotice(M);
  }
})();
