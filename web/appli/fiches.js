'use strict';
// Les fiches de l'application : tout ce que la tour sait montrer et faire, hors de la carte du jeu.
// Skills, agents, doc, depots, sauvegarde, conseil, chef, sujets, features, taches, demandes, tutos,
// suivi d'une tache, questions : web/appli/moteur.js les place dans les conversations et les feuillets.
// Ce fichier attend window.Appli.nav (ouvrir une conversation ou un feuillet, redessiner) avant d'etre utilise.

(function () {
  const T = window.Tower, h = T.h;
  const NAV = () => window.Appli.nav;
  const M_ = () => window.Appli.M;
  const renderHud = () => NAV().paint();
  function hash(str) { let x = 2166136261; for (const c of String(str)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }
  const BOOK = ['#2f6db5', '#3d8b4f', '#7a4fa3', '#1f8a8a', '#b5652f', '#5a6fb5', '#8a3d6b', '#4f7a2f'];
  // le nom d'une session tel que la liste le montre
  const sname = (a) => a.label || a.salle || a.name;
  const dotFor = (st) => ({ waiting: 'warn', idle: 'ok', working: 'blue', ready: 'grey', silent: 'grey', ended: 'grey' }[st] || 'grey');
  const btn = (text, onclick, cls = '', attrs = {}) => h('button', { type: 'button', class: 'us-btn ' + cls, onclick, ...attrs }, text);
  function rowsOf(pairs) { return h('dl', { class: 'us-dl' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])); }
  function resultTxt(b) { return b ? [h('span', { class: b.ok ? 'us-t-ok' : 'us-t-ko' }, b.ok ? 'réussi' : 'en échec'), ' ', b.summary || '', ', ', T.agoEl(b.endedAt)] : null; }

  // La version : liste des features et de leurs preuves.
  function featureList(c) {
    const verb = (k) => h('span', { class: k.ok === true ? 'us-t-ok' : k.ok === false ? 'us-t-ko' : 'us-dim' }, k.verb);
    return h('ul', { class: 'us-feats' },
      c.features.map(f => h('li', { class: `us-f-${f.status}` },
        h('span', { class: 'us-chip' }, f.statusText),
        h('div', null, h('b', null, f.title), f.checks.map(k => h('small', null, `${k.text} : `, verb(k), k.detail ? `, ${k.detail}` : '', k.at ? [', ', T.agoEl(k.at)] : ''))),
        f.manual ? btn(f.manual.done ? 'Annuler' : 'Je l\'ai testée', () => T.act.manual(f.id, !f.manual.done), f.manual.done ? '' : 'us-go') : null)),
      h('li', { class: `us-f-${c.final.status}` }, h('span', { class: 'us-chip' }, c.final.statusText),
        h('div', null, h('b', null, 'Lancement : épreuve finale'), c.final.locked ? h('small', null, 'Se débloque quand toutes les features sont prêtes.') : null,
          c.final.checks.map(k => h('small', null, `${k.text} : `, verb(k))))));
  }
  function wonRows(c) {
    return rowsOf([['Développement', T.dur(c.wonAt - c.createdAt)], ['Features', String(c.features.length)], ['Builds et tests', String(c.stats.builds)], ['Échecs corrigés', String(c.stats.failures)], ['Agents', String(c.stats.agents)], c.commit && ['Commit', `${c.commit.sha}${c.commit.dirty ? `, ${c.commit.dirty} fichiers non commités` : ''}`]]);
  }
  function buildList(list) {
    return h('ul', { class: 'us-builds' }, list.map(b => h('li', null,
      h('button', { type: 'button', class: 'us-build', 'aria-expanded': String(T.ui.openBuilds.has(b.id)), onclick: () => T.act.toggleBuild(b.id) },
        h('span', { class: 'us-time' }, T.clock(b.endedAt)), h('span', null, h('b', null, `${b.kindText}${b.detail ? ' ' + b.detail : ''}`), h('small', null, `${b.agent ? b.agent.name : b.label}, ${b.summary}${b.how ? ', ' + b.how : ''}`)), h('span', { class: 'us-time' }, T.dur(b.durationMs))),
      T.ui.openBuilds.has(b.id) ? h('div', { class: 'us-errs' }, h('code', { class: 'us-code' }, b.command), b.lines.length ? h('pre', null, b.lines.join('\n')) : h('span', { class: 'us-dim' }, 'Aucune ligne d\'erreur relevée.'), b.waitMs > 1000 ? h('span', { class: 'us-dim' }, `A attendu ${T.dur(b.waitMs)} devant la forge.`) : null) : null)));
  }

  // Les sessions ou travaille un agent du quartier (appele comme sous-agent).
  function rosterBusy(M, ag) {
    const k = ag.call.toLowerCase(), n = ag.name.toLowerCase();
    return M.agents.filter(a => a.st !== 'ended' && (ag.scope !== 'projet' || a.project === ag.project) && a.subList.some(x => { const t = String(x.type).toLowerCase(); return t === k || t === n; }));
  }
  // ---------- la documentation ----------
  // La doc du projet affichee (le premier projet connecte qui en a une, ou celui choisi dans la fiche).
  const docUi = { project: null, open: new Set(['ensemble']), q: '', results: null, busy: false };
  function docsOf(M) {
    const all = (M.S && M.S.docs) || {};
    return all[docUi.project] || all[(M.projects[0] || {}).name] || Object.values(all)[0] || null;
  }
  // Les sessions qui ont modifie le jeu sans ecrire leur doc : arretees par la tour (owed), ou en cours.
  function docDebts(M) {
    return M.agents.filter(a => a.raw && a.raw.docTrack && a.st !== 'ended' && (a.raw.docTrack.owed || a.raw.docTrack.pending.length))
      .map(a => ({ a, owed: a.raw.docTrack.owed, files: a.raw.docTrack.owed ? a.raw.docTrack.owed.files : a.raw.docTrack.pending }));
  }
  const SHELF_COL = { ensemble: '#c9a227', 'docs-bible': '#8a3d6b', 'docs-decisions': '#2f6db5', 'docs-idees': '#3d8b4f', 'docs-memoire': '#7a4fa3', skills: '#1f8a8a', tour: '#b5652f', rapports: '#5a6fb5' };
  const shelfCol = (id) => SHELF_COL[id] || BOOK[hash(id) % BOOK.length];
  // ---------- le conseil (lib/conseil.js) ----------
  const conseilOf = (M) => (M && M.conseil) || null;
  const isLive = (r) => !!r && !['fini', 'erreur', 'arrete'].includes(r.step);
  // ---------- les depots : git sur le PC et GitHub ----------
  const gitUi = { open: new Set(), url: {}, path: '', busy: '' };
  const gitOf = (M) => (M.S && M.S.git) || null;
  const nCommits = (n) => T.plural(n, 'commit', 'commits');
  function repoTone(r, Gt) {
    if (Gt && !Gt.git) return ['ko', 'git pas installé'];
    if (!r.exists) return ['ko', 'dossier introuvable'];
    if (r.error) return ['ko', 'illisible'];
    if (!r.isRepo) return ['off', r.inside ? 'dans un autre dépôt' : 'pas de git'];
    if (r.dirty && r.dirty.conflicts) return ['ko', 'conflits à régler'];
    if (r.sync && r.sync.state === 'behind') return ['blue', `${nCommits(r.sync.n)} à récupérer`];
    if (r.sync && r.sync.state === 'diverged') return ['warn', 'différent de GitHub'];
    if (r.dirty && r.dirty.total) return ['warn', T.plural(r.dirty.total, 'fichier pas commité', 'fichiers pas commités')];
    if (r.sync && r.sync.state === 'ahead') return ['blue', `${nCommits(r.sync.n)} à pousser`];
    if (!r.github) return ['ok', 'propre, pas sur GitHub'];
    return ['ok', 'à jour'];
  }
  function gitAlert(M) { const Gt = gitOf(M); return !!Gt && (!Gt.git || Gt.repos.some(r => repoTone(r, Gt)[0] === 'ko')); }
  function prsOf(M) { const Gt = gitOf(M), seen = new Set(), out = []; for (const r of (Gt && Gt.repos) || []) if (r.remote && r.remote.ok && !seen.has(r.remote.url)) { seen.add(r.remote.url); out.push(...r.remote.prs); } return out; }
  // ---------- la sauvegarde (lib/sauvegarde.js) ----------
  const svUi = { open: new Set(), type: {}, dest: {}, run: null, busy: '', seen: false };
  const svOf = (M) => (M && M.S && M.S.sauvegarde) || null;
  const svLive = (r) => !!r && !r.endedAt;
  const svRun = (SV, id) => (SV && id && SV.runs.find(r => r.id === id)) || null;
  const svCurrent = (M) => { const SV = svOf(M); return SV && svRun(SV, SV.current); };
  function octets(n) {
    const f = (x, d) => x.toLocaleString('fr-FR', { maximumFractionDigits: d });
    return n >= 1024 ** 3 ? `${f(n / 1024 ** 3, 1)} Go` : n >= 1024 ** 2 ? `${f(n / 1024 ** 2, 0)} Mo` : `${f(Math.max(1, n / 1024), 0)} ko`;
  }
  function svAge(t, now) {
    const d = Math.floor((now - t) / 86400_000);
    return d <= 0 ? 'aujourd\'hui' : d === 1 ? 'hier' : `il y a ${d} jours`;
  }
  // L'etat d'un projet en un mot et une couleur.
  function svTone(p, SV, now) {
    const r = svRun(SV, p.last);
    if (svLive(r)) return ['blue', T.lower(r.stepText || 'en cours')];
    if (p.info && !p.info.exists) return ['ko', 'dossier introuvable'];
    if (!p.target) return p.info && p.info.uproject ? ['warn', 'pas encore protégé'] : ['off', 'pas de destination'];
    if (r && r.step === 'erreur') return ['ko', 'dernière sauvegarde en échec'];
    if (!p.lastOk) return ['warn', 'jamais sauvegardé'];
    if (now - p.lastOk > 7 * 86400_000) return ['warn', `sauvegardé ${svAge(p.lastOk, now)}`];
    return ['ok', `sauvegardé ${svAge(p.lastOk, now)}`];
  }
  // le jeu sans sauvegarde recente, ou une sauvegarde en echec : la sante du projet le signale
  function svAlert(M) { const SV = svOf(M); return !!SV && SV.projects.some(p => { const [t] = svTone(p, SV, M.now); return t === 'ko' || (t === 'warn' && p.info && p.info.uproject); }); }
  // ---------- tutos : de courts scenarios joues sur la vraie tour (lib/tuto.js) ----------
  // Le panneau prend la place de la fiche ; chaque etape se coche quand la tour la voit vraiment.
  const TUTO_LOOK = {
    agent: 'Sa conversation apparaît dans la liste à gauche ; quand il a fini, elle passe au vert.',
    question: 'Sa conversation remonte en haut, en orange, avec sa question dans le fil.',
    forge: 'Regarde la forge à droite : un build tourne, le second attend son tour.',
    echec: 'Le build finit en échec dans la forge ; ouvre-la pour lire l\'erreur.',
    vrai: 'Ouvre un terminal dans le dossier du projet, lance claude et demande : « Liste les dossiers de Content, sans rien modifier. »',
  };

  function tutoSteps(id, M, t) {
    const ag = (sid) => M.agents.find(a => a.id === sid);
    const proj = t.project;
    const builds = (pre) => M.builds.filter(b => String(b.raw.sessionId).startsWith(pre));
    if (id === 'agent') {
      const a = ag('tuto-agent');
      return [['Sa conversation apparaît dans la tour', !!a], [`Elle est sur ${proj}`, !!a && a.project === proj],
        ['Il lit des fichiers : sa conversation montre l\'outil', !!a && !!a.tool], ['Il a fini : la tour te le dit', !!a && a.st === 'idle']];
    }
    if (id === 'question') {
      const a = ag('tuto-question');
      const done = !!a && a.st === 'idle';
      return [['Sa conversation apparaît dans la tour', !!a], ['Il attend ta réponse', !!a && (a.st === 'waiting' || done)], ['Tu as vu sa question', done]];
    }
    if (id === 'forge') {
      const bs = builds('tuto-forge'), b2 = bs.find(b => b.raw.sessionId === 'tuto-forge-b');
      const holdA = M.lock && M.lock.raw.sessionId === 'tuto-forge-a';
      return [['Le premier build prend la forge', holdA || bs.some(b => b.raw.sessionId === 'tuto-forge-a')],
        ['Le second attend son tour dans la file', M.queue.some(q => q.raw.sessionId === 'tuto-forge-b') || (!!b2 && b2.waitMs > 1000)],
        ['Les deux builds réussissent, l\'un après l\'autre', bs.filter(b => b.ok).length >= 2]];
    }
    if (id === 'echec') {
      const b = builds('tuto-echec')[0];
      return [['Le faux build passe à la forge', !!b || (!!M.lock && M.lock.raw.sessionId === 'tuto-echec')],
        ['Il échoue : le build passe dans les échecs de la forge', !!b && !b.ok], ['La tour a lu l\'erreur de compilation', !!b && b.lines.length > 0]];
    }
    const real = M.agents.find(a => !a.id.startsWith('tuto-') && a.project === proj && (a.raw.firstSeen || 0) >= t.startedAt);
    return [[`Un nouvel agent apparaît sur ${proj}`, !!real], ['Il travaille : sa conversation montre son outil', !!real && !!real.tool], ['Il a fini', !!real && real.st === 'idle']];
  }

  async function tutoCall(path, body) {
    const r = await T.api(path, body);
    if (r && r.ok === false && r.error) T.toast(r.error);
    return r;
  }

  function tutoPanel(M) {
    const info = M.S.tuto || {};
    const list = info.list || [];
    const last = info.last, running = info.running;
    const proj = info.project;
    const close = btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer les tutos', title: 'Échap' });
    const cards = list.map((x, i) => {
      const open = last && last.id === x.id;
      const steps = open ? tutoSteps(x.id, M, last) : [];
      const all = open && steps.every(s => s[1]);
      const off = M.demo || !proj ? { disabled: true } : {};
      const launch = (label, cls) => btn(label, () => tutoCall('/api/tuto/start', { id: x.id }), cls, off);
      const head = h('div', { class: 'us-tuto-head' }, h('b', null, `${i + 1}. ${x.title}`),
        all ? h('span', { class: 'us-t-ok' }, 'Réussi') : open && running ? h('span', { class: 'us-dim' }, 'en cours') : open ? null : launch('Lancer', 'us-go'));
      const body = [h('p', { class: 'us-dim' }, x.text)];
      if (open) {
        const where = TUTO_LOOK[x.id];
        if (where) body.push(h('p', { class: 'us-tuto-where' }, where));
        body.push(h('ol', { class: 'us-tuto-steps' }, steps.map(([txt, ok]) => h('li', { class: ok ? 'ok' : '' }, h('i', { 'aria-hidden': 'true' }, ok ? '✓' : '·'), txt, ok ? h('span', { class: 'us-sr' }, ' (fait)') : null))));
        const a = M.agents.find(y => y.id === 'tuto-question');
        if (x.id === 'question' && a && a.st === 'waiting') body.push(btn('J\'ai vu', () => tutoCall('/api/tuto/answer'), 'us-go'));
      }
      if (open) body.push(launch('Rejouer', ''));
      return h('li', { class: 'us-tuto-card' + (open ? ' open' : '') + (all ? ' done' : '') }, head, body);
    });
    const intro = M.demo ? 'En démo, les tutos ne se lancent pas : ouvre la tour sur ton PC.'
      : !proj ? 'Connecte d\'abord ton projet Unreal (Réglages, en bas à droite) : les tutos se jouent dessus.'
      : `Des scénarios courts joués sur ta vraie tour, avec ${proj}. Rien n'est écrit dans le projet : les agents du tuto sont simulés et la forge lance un faux build. Chaque étape se coche quand la tour la voit.`;
    return h('section', { class: 'us-panel us-entity us-tuto', 'aria-label': 'Tutos' },
      h('div', { class: 'us-ehead' }, h('h2', null, proj ? `Tutos sur ${proj}` : 'Tutos'), close),
      h('div', { class: 'us-ebody' }, h('p', null, intro), h('ol', { class: 'us-tuto-list' }, cards),
        h('div', { class: 'us-tuto-foot' }, btn('Effacer les traces des tutos', () => tutoCall('/api/tuto/clean'), '', M.demo ? { disabled: true } : {}),
          h('span', { class: 'us-dim' }, 'Elles partent aussi seules au bout de 30 min et ne sont jamais sauvegardées.'))));
  }

  // ---------- taches : consignes pretes a lancer, et tokens de chaque session (lib/taches.js, lib/usage.js) ----------
  // 12 345 -> « 12,3 k » ; 1 234 567 -> « 1,23 M »
  function tok(n) {
    n = n || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: n < 1e4 ? 1 : 0 })} k`;
    return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M`;
  }
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // Le contexte : une jauge qui vire a l'orange puis au rouge quand la fenetre se remplit.
  function ctxBar(u) {
    const pct = u.contextPct || 0;
    return h('div', { class: 'us-ctx', title: `${tok(u.context)} tokens dans le contexte sur ${tok(u.window)}` },
      h('div', { class: 'us-bar' }, h('i', { class: pct >= 80 ? 'ko' : pct >= 55 ? 'warn' : '', style: `width:${Math.max(2, pct)}%` })),
      h('span', null, `${pct} % (${tok(u.context)} / ${tok(u.window)})`));
  }

  // Bloc « Tokens » de la fiche d'un agent : total, contexte, et ce que coute chaque action.
  function usageBlock(a) {
    const u = a.usage;
    if (!u) return h('p', { class: 'us-dim' }, 'Tokens : la tour les lira à la prochaine action de cet agent.');
    const max = Math.max(1, ...u.tools.map(t => t.out + t.ctx));
    return h('div', { class: 'us-usage' },
      h('div', { class: 'us-sub' }, 'Tokens de la session'),
      h('p', null, h('b', null, tok(u.total)), ` en ${T.plural(u.messages, 'réponse', 'réponses')} : `,
        h('span', { class: 'us-dim' }, `entrée ${tok(u.in)}, sortie ${tok(u.out)}, cache lu ${tok(u.cacheRead)}, cache écrit ${tok(u.cacheWrite)}`)),
      h('div', { class: 'us-sub' }, 'Contexte'), ctxBar(u),
      h('div', { class: 'us-sub' }, 'Par action'),
      h('ul', { class: 'us-tools' }, u.tools.slice(0, 6).map(t => h('li', null,
        h('b', null, t.name.replace(/^mcp__[^_]+__/, '')), h('span', { class: 'us-dim' }, t.calls ? T.plural(t.calls, 'appel', 'appels') : 'texte'),
        h('i', { style: `width:${Math.max(3, Math.round(100 * (t.out + t.ctx) / max))}%` }), h('span', null, tok(t.out + t.ctx)))))
    );
  }

  // ---------- question posee a ali, a laquelle il repond dans la tour (hooks/tower-ask.js) ----------
  const picks = new Map(); // id de question -> { question: [labels choisis] }
  async function sendAsk(a, body) {
    if ((M_() || {}).demo) { T.toast('Mode démo : la réponse part sur la vraie tour.'); return; }
    const r = await T.api('/api/ask/answer', { id: a.pending.id, ...body });
    if (r && r.ok) picks.delete(a.pending.id);
    else T.toast(r && r.error ? r.error : 'La tour ne répond pas : ta réponse n\'est pas partie.');
  }
  function askBox(a) {
    const k = a.pending;
    const inTower = !!(a.raw && a.raw.chat && a.raw.chat.mode === 'tour'); // discussion sans fenetre : la reponse ne peut venir que d'ici
    const later = inTower ? null : btn('Dans sa fenêtre', () => sendAsk(a, { decision: 'window' }), '', { title: 'La question s\'affiche dans sa fenêtre Claude Code, tu y réponds là-bas' });
    if (k.kind === 'permission') {
      return h('div', { class: 'us-ask us-askq' },
        h('b', null, 'Il demande l\'autorisation'), h('p', null, h('code', null, k.tool), ' ', k.summary),
        k.retenir && k.retenir.length ? h('small', { class: 'us-dim' }, `Autoriser vaut aussi pour la suite : la tour ne redemandera plus pour ${k.retenir.map(x => `« ${x} »`).join(', ')}.`) : null,
        h('div', { class: 'us-actions' }, btn('Autoriser', () => sendAsk(a, { decision: 'allow' }), 'us-go'), btn('Refuser', () => sendAsk(a, { decision: 'deny' })), later));
    }
    const sel = picks.get(k.id) || {};
    const one = k.questions.length === 1 && !k.questions[0].multiSelect;
    const choose = (q, label) => {
      if (one) return sendAsk(a, { answers: { [q.question]: label } });
      const cur = sel[q.question] || [];
      sel[q.question] = q.multiSelect ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : [label];
      picks.set(k.id, sel);
      renderHud();
    };
    const other = (q) => {
      const input = h('input', { type: 'text', name: `autre-${k.id}-${k.questions.indexOf(q)}`, 'data-keep': `autre-${k.id}-${k.questions.indexOf(q)}`, placeholder: 'Autre réponse…', 'aria-label': `Autre réponse à « ${q.question} »`, maxlength: 300,
        onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); choose(q, input.value.trim()); } } });
      return h('div', { class: 'us-askother' }, input, btn(one ? 'Envoyer' : 'Choisir', () => { if (input.value.trim()) choose(q, input.value.trim()); }));
    };
    const ready = k.questions.every(q => (sel[q.question] || []).length);
    return h('div', { class: 'us-ask us-askq' },
      k.questions.map(q => h('fieldset', { class: 'us-askset' },
        h('legend', null, q.header ? h('span', { class: 'us-dim' }, `${q.header} · `) : null, q.question, q.multiSelect ? h('small', null, ' (plusieurs choix possibles)') : null),
        h('div', { class: 'us-askopts' }, q.options.map((o) => {
          const on = (sel[q.question] || []).includes(o.label);
          return h('button', { type: 'button', class: 'us-askopt' + (on ? ' on' : ''), 'aria-pressed': one ? null : String(on), title: o.description || o.label, onclick: () => choose(q, o.label) },
            h('b', null, o.label), o.description ? h('small', null, o.description) : null);
        })),
        other(q))),
      h('div', { class: 'us-actions' }, one ? null : btn('Envoyer mes réponses', () => sendAsk(a, { answers: Object.fromEntries(k.questions.map(q => [q.question, sel[q.question] || []])) }), 'us-go', ready ? {} : { disabled: true }), later),
      h('small', { class: 'us-dim' }, inTower ? 'La session reprend dès que tu réponds. Sans réponse ici en 10 minutes, c\'est refusé.' : 'La session reprend dès que tu réponds. Sans réponse ici, la question passe dans sa fenêtre au bout de 10 minutes.'));
  }

  // ---------- suivi d'une tache lancee (lib/suivi.js) : ou il en est, ce qu'il a fait, ce qu'il reste ----------
  const shortPath = (p) => { const m = /(?:^|[\\/])Saved[\\/]Tour[\\/](.*)$/i.exec(p || ''); return (m ? m[1] : String(p || '').split(/[\\/]/).slice(-2).join('/')).replace(/\\/g, '/'); };
  function suiviState(a) {
    const k = a.task;
    if (a.st === 'waiting') return { tone: 'warn', text: 'Attend ta réponse dans sa fenêtre Claude Code', detail: a.ask };
    if (a.st === 'working') return { tone: 'blue', text: 'En cours', detail: a.tool ? `${a.tool.name} ${a.tool.summary}` : '' };
    if (a.st === 'ended' && !k.doneAt) return { tone: 'grey', text: 'Session fermée avant la fin' };
    if (k.doneAt || a.st === 'idle') {
      const v = k.verif && k.verif.state;
      if (v === 'fail') return { tone: 'ko', text: 'Fini, mais la vérification de la tour a échoué' };
      if (v === 'running') return { tone: 'blue', text: 'Fini : la tour vérifie (compilation et tests)' };
      if (v === 'waiting') return { tone: 'warn', text: 'Fini : ferme l\'éditeur pour que la tour lance les tests' };
      const q = k.suivi && k.suivi.questions.length;
      return { tone: 'ok', text: q ? 'Fini : il a des questions pour toi' : k.suivi && k.suivi.rapport ? 'Fini : à toi de lire le rapport' : 'Fini, à toi' };
    }
    return { tone: 'grey', text: a.stText };
  }
  // Ce que la tour a vu faire, quand l'agent n'a pas (encore) ecrit son bloc « Suivi ».
  function seenDone(a) {
    const k = a.task, c = k.counts || {};
    return [
      c.reads ? `A lu ${T.plural(c.reads, 'fichier ou recherche', 'fichiers ou recherches')}` : null,
      ...(k.files || []).filter(f => f.tower).map(f => `A écrit ${shortPath(f.path)}`),
      c.edits ? `A modifié le projet (${T.plural(c.edits, 'modification', 'modifications')})` : null,
      c.cmds ? `A lancé ${T.plural(c.cmds, 'commande', 'commandes')}` : null,
      a.lastBuild && a.lastBuild.endedAt > k.at ? `Compilation : ${a.lastBuild.ok ? 'réussie' : 'en échec'}` : null,
      a.lastTest && a.lastTest.endedAt > k.at ? `Tests : ${a.lastTest.summary || (a.lastTest.ok ? 'verts' : 'en échec')}` : null,
    ].filter(Boolean);
  }
  const bullets = (items) => h('ul', { class: 'us-suivi-list' }, items.map(x => h('li', null, x)));
  // ---------- verification de fin de tache (lib/verif.js) : la tour compile et lance les tests ----------
  const VERDICT = {
    ok: ['ok', 'Vérifiée par la tour : ça compile et les tests passent'],
    fail: ['ko', 'La vérification a échoué'],
    waiting: ['warn', 'Ferme l\'éditeur Unreal quand tu veux : la tour compilera la cible Éditeur et lancera les tests'],
    running: ['blue', 'Vérification en cours'],
    error: ['grey', 'Vérification impossible'],
  };
  const STEP_DOT = { ok: 'ok', fail: 'ko', running: 'blue', waiting: 'warn' };
  const testName = (p) => String(p).split('.').slice(-2).join('.');
  function stepText(s) {
    if (s.state === 'waiting') return 'attend que l\'éditeur soit fermé';
    if (s.state === 'todo') return 'à faire';
    if (s.state === 'running') return ['en cours depuis ', T.forEl(s.at)];
    if (s.state === 'skipped') return s.detail || 'pas lancée';
    const t = s.tests;
    if (t) {
      const old = (s.oldFailures || []).length;
      return `${t.passed}/${t.total} verts` + (old ? `, ${T.plural(old, 'test déjà rouge', 'tests déjà rouges')} avant la tâche` : '');
    }
    return s.ok ? 'réussie' : s.summary || 'en échec';
  }
  function verifBlock(a) {
    const k = a.task, v = k.verif;
    const running = v && v.state === 'running';
    const go = btn(v ? 'Revérifier' : 'Vérifier maintenant', async () => {
      const r = await T.api('/api/tasks/verify', { sessionId: a.id });
      if (r && r.ok === false && r.error) T.toast(r.error);
    }, '', M_demo() || running || a.st === 'working' ? { disabled: true } : { title: 'Compile le projet et lance la suite de tests sous le verrou de la forge' });
    const head = h('div', { class: 'us-sub' }, 'Vérification par la tour');
    if (!v) return [head, h('p', { class: 'us-dim' }, 'À la fin de la tâche, la tour compile le projet et lance les tests elle-même, sans jamais fermer ton éditeur.'), h('div', { class: 'us-actions' }, go)];
    const [tone, text] = VERDICT[v.state] || VERDICT.error;
    const bad = v.steps.filter(s => s.state === 'fail');
    return [head,
      h('div', { class: `us-state us-s-${tone}` }, text),
      h('ul', { class: 'us-verif' }, v.steps.map(s => h('li', null,
        h('span', { class: `us-dot us-d-${STEP_DOT[s.state] || 'grey'}` }), h('b', null, s.label), h('span', { class: 'us-dim' }, stepText(s))))),
      bad.map(s => [
        (s.newFailures || []).length ? [h('div', { class: 'us-dim' }, 'Tests cassés :'), bullets(s.newFailures.map(testName))] : null,
        (s.errorLines || []).length ? h('pre', { class: 'us-suivi-last' }, s.errorLines.join('\n')) : null]),
      v.state === 'fail' ? h('p', { class: 'us-dim' }, 'Dis-le à l\'agent dans sa fenêtre (ou relance la tâche) : il corrige, puis la tour revérifie à sa fin.') : null,
      h('div', { class: 'us-actions' }, go)];
  }
  const M_demo = () => !!(M_() || {}).demo;
  function suiviBlock(a) {
    const k = a.task;
    if (!k) return null;
    const st = suiviState(a), sv = k.suivi;
    const done = !!k.doneAt && a.st !== 'working' && a.st !== 'waiting';
    const fait = sv && sv.fait.length ? sv.fait : seenDone(a);
    const questions = [...(sv ? sv.questions : [])];
    if (a.st === 'waiting' && a.ask && !questions.includes(a.ask)) questions.unshift(a.ask);
    const files = (k.files || []).slice().reverse();
    if (sv && sv.rapport && !files.some(f => shortPath(f.path) === shortPath(sv.rapport))) files.unshift({ path: sv.rapport, tower: true });
    return h('div', { class: 'us-suivi' },
      h('div', { class: `us-state us-s-${st.tone}` }, st.text),
      h('div', { class: 'us-dim' }, `Lancée à ${T.clock(k.at)}, `, done ? `finie en ${T.dur(k.doneAt - k.at)}` : ['depuis ', T.forEl(k.at)]),
      st.detail && a.st !== 'waiting' ? h('p', { class: 'us-dim' }, st.detail) : null, // une question s'affiche plus bas
      h('div', { class: 'us-sub' }, 'Ce qu\'il a fait'),
      fait.length ? bullets(fait) : h('p', { class: 'us-dim' }, 'Rien encore : il commence.'),
      h('div', { class: 'us-sub' }, 'Ce qu\'il reste à faire'),
      sv && sv.afaire.length ? bullets(sv.afaire)
        : h('p', { class: 'us-dim' }, done ? 'Il n\'a pas laissé de liste : lis son dernier message ci-dessous.' : 'Il le dira en finissant.'),
      questions.length ? [h('div', { class: 'us-sub' }, 'Ses questions pour toi'), bullets(questions), h('p', { class: 'us-dim' }, 'Réponds dans sa fenêtre Claude Code : il reprend là où il en était.')] : null,
      files.length ? [h('div', { class: 'us-sub' }, 'Fichiers écrits'),
        h('ul', { class: 'us-suivi-files' }, files.map(f => h('li', null,
          h('span', null, shortPath(f.path)),
          f.tower ? btn('Lire', () => readFile(a, f.path), 'us-go', { title: 'Ouvre le fichier ici, dans la page' }) : h('span', { class: 'us-dim' }, 'dans le projet'))))] : null,
      done && !sv && k.last ? [h('div', { class: 'us-sub' }, 'Son dernier message'), h('p', { class: 'us-suivi-last' }, k.last)] : null,
      k.verif || (done && (k.counts || {}).edits) ? verifBlock(a) : null);
  }

  let readerDlg = null;
  // Markdown simple (titres, listes, code, tableaux en bloc), construit en noeuds : aucun HTML du fichier n'est interprete.
  function mdView(text) {
    const out = [];
    let list = null, code = null, table = null;
    for (const line of String(text).split(/\r?\n/)) {
      if (/^\s*```/.test(line)) { if (code) { out.push(h('pre', null, code.join('\n'))); code = null; } else code = []; continue; }
      if (code) { code.push(line); continue; }
      if (/^\s*\|/.test(line)) { if (!table) { table = []; out.push(table); } if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) table.push(line.trim()); continue; }
      table = null;
      const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) { if (!list) { list = h('ul'); out.push(list); } list.append(h('li', null, mdInline(li[1]))); continue; }
      list = null;
      const hd = /^(#{1,6})\s+(.*)$/.exec(line);
      if (hd) out.push(h(hd[1].length <= 2 ? 'h3' : 'h4', null, mdInline(hd[2])));
      else if (line.trim()) out.push(h('p', null, mdInline(line)));
    }
    if (code) out.push(h('pre', null, code.join('\n')));
    return h('div', { class: 'us-md' }, out.map(x => Array.isArray(x) ? h('pre', { class: 'us-md-table' }, x.join('\n')) : x));
  }
  async function readFile(a, rel) {
    if ((M_() || {}).demo) { T.toast('Mode démo : le fichier se lit sur la vraie tour.'); return; }
    let r = null;
    try { r = await fetch(`/api/tasks/file?session=${encodeURIComponent(a.id)}&path=${encodeURIComponent(rel)}`).then(x => x.json()); } catch { /* r reste null */ }
    if (!r || !r.ok) { T.toast(r && r.error ? r.error : 'Lecture impossible.'); return; }
    if (!readerDlg) {
      readerDlg = h('dialog', { class: 'us-dialog us-reader', 'aria-label': 'Fichier de la tâche' });
      document.body.append(readerDlg);
    }
    readerDlg.replaceChildren(
      h('div', { class: 'us-ehead' }, h('h2', null, shortPath(r.path)), btn('Fermer', () => readerDlg.close(), 'us-x')),
      h('p', { class: 'us-dim' }, `${sname(a)}, « ${a.task.title} »${r.cut ? ' (début du fichier seulement)' : ''}`),
      mdView(r.text));
    readerDlg.showModal();
  }

  const suiviOpen = new Map();
  // Renommer une salle : le nom reste tant que tu ne l'effaces pas (vide = nom automatique).
  let renameDlg = null;
  function renameDialog(a) {
    if (!renameDlg) {
      const f = {};
      renameDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Renommer la session' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const r = await T.api('/api/agents/rename', { sessionId: renameDlg.dataset.id, label: f.name.value });
          if (r && r.ok) renameDlg.close(); else if (r) f.err.textContent = r.error || 'Renommage impossible.';
        } },
          h('h2', null, 'Renommer la session'),
          h('label', null, 'Nom de la session', f.name = h('input', { name: 'salle', maxlength: 60, placeholder: 'ex. Coup de pied dans les portes' })),
          f.auto = h('p', { class: 'us-dim' }),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => renameDlg.close()), h('button', { type: 'submit', class: 'us-btn us-go' }, 'Renommer'))));
      renameDlg.f = f;
      document.body.append(renameDlg);
    }
    const f = renameDlg.f;
    renameDlg.dataset.id = a.id;
    f.name.value = a.label || a.salle || '';
    f.auto.textContent = 'Laisse vide pour revenir au nom automatique : la tâche lancée, le titre de la session dans Claude Code, sinon sa première demande.';
    f.err.textContent = '';
    renameDlg.showModal();
    f.name.select();
  }

  // L'equipe du projet : ses agents (.claude/agents), par section, et ou ils travaillent en ce moment.
  function equipePanel(M) {
    const close = btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer l\'équipe', title: 'Échap' });
    const teams = Object.entries(M.S.team || {});
    const at = (proj, name) => M.agents.filter(a => a.st !== 'ended' && a.project === proj && a.subList.some(s => s.type.toLowerCase() === name.toLowerCase()));
    const open = (a) => { NAV().close(); NAV().conv(a.id); };
    const projBlock = ([proj, team]) => {
      const sections = [...new Set(team.map(x => x.section))];
      return [teams.length > 1 ? h('div', { class: 'us-sub' }, proj) : null,
        team.length ? h('ul', { class: 'us-tuto-list' }, sections.map(sec => h('li', { class: 'us-task' },
          h('div', { class: 'us-tuto-head' }, h('b', null, sec), h('span', { class: 'us-dim' }, T.plural(team.filter(x => x.section === sec).length, 'agent', 'agents'))),
          team.filter(x => x.section === sec).map(x => {
            const busy = at(proj, x.name);
            return h('div', { class: 'us-mem' },
              h('span', { class: `us-dot us-d-${busy.length ? 'blue' : 'none'}` }), h('code', null, x.name),
              busy.length ? h('span', null, ' au travail dans ', busy.map((a, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'us-link', onclick: () => open(a) }, `« ${sname(a)} »`)])) : null,
              x.description ? h('small', { class: 'us-dim' }, x.description) : null);
          }))))
          : h('p', { class: 'us-dim' }, `Aucun agent dans ${proj}\\.claude\\agents. Chaque fichier .md de ce dossier est un agent que tes sessions peuvent appeler ; ajoute « section: Animation » dans son en-tête pour le ranger.`)];
    };
    return h('section', { class: 'us-panel us-entity us-taches', 'aria-label': 'Équipe' },
      h('div', { class: 'us-ehead' }, h('h2', null, 'Équipe'), close),
      h('div', { class: 'us-ebody' },
        h('p', null, 'Les agents spécialisés de ton projet, rangés par section. Quand une session en appelle un, il apparaît dans sa conversation avec le nom de sa section.'),
        h('div', { class: 'us-actions' }, btn('Détails de chaque agent', () => { NAV().close(); NAV().sheet('roster'); }, '', { title: 'Les agents installés : leur fichier, leurs skills, leurs appels et leurs tokens' })),
        teams.length ? teams.map(projBlock) : h('p', { class: 'us-dim' }, 'Connecte d\'abord ton projet Unreal (Réglages, en bas à droite).')));
  }

  // ---------- la bibliotheque des skills ----------
  // Ce qui est installe (perso, compte claude.ai, projets, plugins), ce qui cloche, ce qui sert. Le serveur
  // relit tout toutes les 2 minutes (lib/skills.js) ; « Ajouter un skill » ecrit un SKILL.md.
  const skillUi = { filter: null, open: new Set() };
  const STATUS_TXT = { ko: 'Cassé', warn: 'À revoir', unused: 'Jamais utilisé', ok: 'Utilisé' };
  const DOT = { ko: 'ko', warn: 'warn', unused: 'none', ok: 'ok' };
  function skillsBody(M) {
    const L = M.S.skills;
    if (!L) return [h('p', { class: 'us-dim' }, 'La tour lit les skills installés et les journaux des sessions…')];
    const todo = L.ko + L.warn;
    const filter = skillUi.filter || (todo ? 'todo' : 'all');
    const FILTERS = [['todo', 'À réparer', todo, (x) => x.status === 'ko' || x.status === 'warn'], ['unused', 'Jamais utilisés', L.unused, (x) => x.status === 'unused'],
      ['ok', 'Utilisés', L.ok, (x) => x.status === 'ok'], ['all', 'Tous', L.total, () => true]];
    const keep = FILTERS.find(f => f[0] === filter)[3];
    const shown = L.skills.filter(keep);
    const groups = [...new Set(shown.map(x => x.where))];
    const used = L.skills.filter(x => x.uses).length;
    const row = (x) => {
      const open = skillUi.open.has(x.id);
      return h('li', { class: `us-task us-skill us-sk-${x.status}` },
        h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(open), onclick: () => { if (open) skillUi.open.delete(x.id); else skillUi.open.add(x.id); renderHud(); } },
          h('span', { class: `us-dot us-d-${DOT[x.status]}` }), h('code', null, x.call),
          h('span', { class: `us-skst us-t-${x.status === 'ko' ? 'ko' : x.status === 'warn' ? 'warn' : x.status === 'ok' ? 'ok' : 'unused'}` }, x.uses ? `${x.uses}×` : STATUS_TXT[x.status])),
        x.issues.length ? h('ul', { class: 'us-skissues' }, x.issues.map(i => h('li', { class: i.level === 'ko' ? 'us-t-ko' : 'us-t-warn' }, i.text))) : null,
        open ? [
          x.description ? h('p', { class: 'us-dim' }, x.description) : h('p', { class: 'us-t-ko' }, 'Pas de description.'),
          h('p', null, x.uses ? [`${T.plural(x.uses, 'appel', 'appels')} dans ${T.plural(x.sessions, 'session', 'sessions')}`, x.typed ? ` (dont ${x.typed} tapé${x.typed > 1 ? 's' : ''} en /${x.call})` : '', ', le dernier ', T.agoEl(x.lastAt), x.usedIn.length ? `, dans ${x.usedIn.join(', ')}` : '', '.']
            : `Aucune session ne s'en est servie ces ${L.days} derniers jours.${x.manual ? ' Il ne se déclenche pas tout seul (disable-model-invocation) : tape /' + x.call + '.' : ''}`),
          h('div', { class: 'us-actions' }, btn('Lire le SKILL.md', () => skillFile(x), '', M.demo ? { disabled: true } : {}))] : null);
    };
    return [
      h('p', null, `${T.plural(L.total, 'skill installé', 'skills installés')} : ${used} utilisé${used > 1 ? 's' : ''} ces ${L.days} derniers jours, ${L.unused} jamais, `,
        h('span', { class: L.ko ? 'us-t-ko' : L.warn ? 'us-t-warn' : 'us-t-ok' }, todo ? `${todo} à réparer ou revoir` : 'aucun à réparer'), '.'),
      h('div', { class: 'us-actions' }, btn('Ajouter un skill', () => skillDialog(M), 'us-go', M.demo ? { disabled: true } : {}),
        btn('Relire', async () => { const r = await T.api('/api/skills/refresh'); if (r) T.toast(r.ok ? 'Skills relus.' : 'Lecture impossible.'); }),
        h('span', { class: 'us-dim' }, 'lu ', T.agoEl(L.scannedAt))),
      h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Filtrer les skills' }, FILTERS.map(([id, text, n]) =>
        h('button', { type: 'button', class: 'us-chip2' + (filter === id ? ' on' : ''), 'aria-pressed': String(filter === id), onclick: () => { skillUi.filter = id; renderHud(); } }, `${text} (${n})`))),
      shown.length ? groups.map(g => [h('div', { class: 'us-sub' }, `${g} (${shown.filter(x => x.where === g).length})`), h('ul', { class: 'us-tuto-list' }, shown.filter(x => x.where === g).map(row))])
        : h('p', { class: 'us-t-ok' }, filter === 'todo' ? 'Rien à réparer : chaque skill a un en-tête lisible et une description.' : 'Aucun.'),
      L.plugins.length ? [h('div', { class: 'us-sub' }, 'Plugins'), h('ul', { class: 'us-tuto-list' }, L.plugins.map(p => h('li', { class: 'us-task' },
        h('div', { class: 'us-tuto-head' }, h('b', null, p.name), h('span', { class: 'us-dim' }, p.installed ? T.plural(p.skills, 'skill', 'skills') : 'pas téléchargé')),
        h('small', { class: p.enabled.length ? 'us-dim' : 'us-t-warn' }, p.enabled.length ? `Activé : ${p.enabled.join(', ')}` : 'Activé nulle part'),
        p.issues.map(i => h('small', { class: i.level === 'ko' ? 'us-t-ko' : 'us-t-warn' }, i.text)))))] : null,
      L.unknown.length ? [h('div', { class: 'us-sub' }, 'Appelés mais pas sur le disque'),
        h('p', { class: 'us-dim' }, 'Souvent des skills intégrés à Claude Code (simplify, code-review…) : rien à réparer s\'ils ont marché. Sinon, le skill a été supprimé ou renommé.'),
        h('ul', { class: 'us-list' }, L.unknown.map(u => h('li', null, h('code', null, u.name), ` ${u.uses}×, le dernier `, T.agoEl(u.lastAt))))] : null,
      h('div', { class: 'us-sub' }, 'Où Claude Code les cherche'),
      h('p', { class: 'us-dim' }, 'Perso : ~/.claude/skills (tous tes projets). Projet : <projet>/.claude/skills. Compte : ceux de claude.ai. Plugin : appelé « plugin:nom », seulement là où le plugin est activé. Chaque skill est un dossier avec un SKILL.md : un en-tête (name, description) puis ses consignes. La description décide quand Claude le charge.'),
    ];
  }

  // ---------- le quartier des agents ----------
  // Tous les agents que Claude Code peut appeler sur le PC (integres, perso, projets, plugins), rangés par
  // section : ce que dit leur fichier, les skills qu'ils prechargent ou citent, leurs appels et leurs tokens
  // sur 30 jours (lib/agents.js), et la salle ou ils travaillent en ce moment.
  const rosterUi = { filter: 'all', open: new Set() };
  const SCOPE_TXT = { integre: 'intégré', perso: 'perso', projet: 'projet', plugin: 'plugin' };
  function rosterBody(M) {
    const A = M.S.roster;
    if (!A) return [h('p', { class: 'us-dim' }, 'La tour lit les agents installés et les journaux des sessions…')];
    const busyOf = new Map(A.agents.map(ag => [ag.id, rosterBusy(M, ag)]));
    const todo = A.ko + A.warn, working = A.agents.filter(ag => busyOf.get(ag.id).length).length;
    const FILTERS = [['all', 'Tous', A.total, () => true], ['busy', 'Au travail', working, (x) => busyOf.get(x.id).length], ['todo', 'À revoir', todo, (x) => x.status === 'ko' || x.status === 'warn'],
      ['unused', 'Jamais appelés', A.unused, (x) => !x.uses]];
    const f = FILTERS.find(x => x[0] === rosterUi.filter) || FILTERS[0];
    const shown = A.agents.filter(f[3]);
    const sections = [...new Set(shown.map(x => x.section))];
    const count = (sc) => A.agents.filter(x => x.scope === sc).length;
    const open = (a) => NAV().conv(a.id);
    const skillList = (list) => list.length ? list.map((x, i) => [i ? ', ' : '', h('code', { class: x.ok === false ? 'us-t-warn' : '', title: x.ok === false ? 'introuvable sur le PC' : '' }, x.name), x.ok === false ? ' (absent)' : '']) : null;
    const where = (x) => x.scope === 'integre' ? 'Intégré à Claude Code, pas de fichier' : x.scope === 'perso' ? 'Perso : ~/.claude/agents, tous tes projets' : x.scope === 'projet' ? `Projet ${x.project} : .claude/agents, ce projet seulement` : `Plugin ${x.plugin}${x.enabledIn && x.enabledIn.length ? `, activé : ${x.enabledIn.join(', ')}` : ''}`;
    const canTxt = (x) => x.canSkill === true ? (x.preload.length ? 'Oui, et il en précharge' : 'Oui, par l\'outil Skill, quand il en a besoin') : x.canSkill === false ? h('span', { class: 'us-t-warn' }, x.tools ? 'Non : Skill n\'est pas dans sa liste « tools: »' : 'Non : Skill est dans « disallowedTools: »') : 'Agent en lecture seule, la doc ne le précise pas';
    const row = (x) => {
      const isOpen = rosterUi.open.has(x.id), busy = busyOf.get(x.id);
      const dot = x.status === 'ko' ? 'ko' : busy.length ? 'blue' : x.status === 'warn' ? 'warn' : x.uses ? 'ok' : 'none';
      return h('li', { class: `us-task us-skill us-sk-${x.status}` },
        h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(isOpen), onclick: () => { if (isOpen) rosterUi.open.delete(x.id); else rosterUi.open.add(x.id); renderHud(); } },
          h('span', { class: `us-dot us-d-${dot}` }), h('code', null, x.call), h('span', { class: 'us-dim us-scope' }, x.scope === 'projet' ? x.project : SCOPE_TXT[x.scope]),
          h('span', { class: `us-skst us-t-${busy.length ? 'info' : x.uses ? 'ok' : 'unused'}` }, busy.length ? 'au travail' : x.uses ? `${x.uses}×` : 'jamais')),
        busy.length ? h('small', null, 'Au travail dans ', busy.map((a, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'us-link', onclick: () => open(a) }, `« ${sname(a)} »`)])) : null,
        x.issues.length ? h('ul', { class: 'us-skissues' }, x.issues.map(i => h('li', { class: i.level === 'ko' ? 'us-t-ko' : 'us-t-warn' }, i.text))) : null,
        isOpen ? [
          x.description ? h('p', { class: 'us-dim' }, x.description) : null,
          rowsOf([
            ['Où', where(x)],
            ['Modèle', x.model || 'celui de la session'],
            ['Outils', x.tools ? x.tools.join(', ') : 'tous ceux de la session'],
            x.disallowed.length && ['Interdits', x.disallowed.join(', ')],
            ['Skills', canTxt(x)],
            x.preload.length && ['Préchargés', skillList(x.preload)],
            x.cites.length && ['Cités', skillList(x.cites)],
            x.mcp && x.mcp.length && ['Serveurs MCP', x.mcp.join(', ')],
            x.permissionMode && ['Permissions', x.permissionMode],
            ['Appels', x.uses ? [`${T.plural(x.uses, 'appel', 'appels')} dans ${T.plural(x.sessions, 'session', 'sessions')}`, x.tokens ? `, ${tok(x.tokens)} tokens` : '', ', le dernier ', T.agoEl(x.lastAt), x.usedIn.length ? `, dans ${x.usedIn.join(', ')}` : ''] : `aucun ces ${A.days} derniers jours`],
          ]),
          x.recent.length ? h('ul', { class: 'us-list' }, x.recent.map(r => h('li', null, r.what ? `${r.what} ` : '', h('span', { class: 'us-dim' }, r.tokens ? `${tok(r.tokens)} tokens, ` : '', T.agoEl(r.at))))) : null,
          x.builtin ? null : h('div', { class: 'us-actions' }, btn('Lire son fichier', () => fileView(x.call, x.file, '/api/roster/file?id=' + encodeURIComponent(x.id)), '', M.demo ? { disabled: true } : {}))] : null);
    };
    return [
      h('p', null, `${T.plural(A.total, 'agent', 'agents')} que tes sessions peuvent appeler : ${count('integre')} intégrés, ${count('perso')} perso, ${count('projet')} dans tes projets, ${count('plugin')} de plugins. `,
        h('span', { class: working ? 'us-t-info' : 'us-dim' }, working ? `${working} au travail` : 'aucun au travail'), ', ',
        h('span', { class: A.ko ? 'us-t-ko' : todo ? 'us-t-warn' : 'us-t-ok' }, todo ? `${todo} à revoir` : 'aucun à revoir'), '.'),
      h('div', { class: 'us-actions' }, btn('Relire', async () => { const r = await T.api('/api/roster/refresh'); if (r) T.toast(r.ok ? 'Agents relus.' : 'Lecture impossible.'); }),
        h('span', { class: 'us-dim' }, 'lu ', T.agoEl(A.scannedAt))),
      h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Filtrer les agents' }, FILTERS.map(([id, text, n]) =>
        h('button', { type: 'button', class: 'us-chip2' + (f[0] === id ? ' on' : ''), 'aria-pressed': String(f[0] === id), onclick: () => { rosterUi.filter = id; renderHud(); } }, `${text} (${n})`))),
      shown.length ? sections.map(sec => [h('div', { class: 'us-sub' }, `${sec} (${shown.filter(x => x.section === sec).length})`), h('ul', { class: 'us-tuto-list' }, shown.filter(x => x.section === sec).map(row))])
        : h('p', { class: 'us-dim' }, 'Aucun.'),
      A.unknown.length ? [h('div', { class: 'us-sub' }, 'Appelés mais pas sur le disque'),
        h('p', { class: 'us-dim' }, 'Un agent supprimé ou renommé, ou un agent d\'un projet que la tour ne connaît pas.'),
        h('ul', { class: 'us-list' }, A.unknown.map(u => h('li', null, h('code', null, u.name), ` ${u.uses}×, le dernier `, T.agoEl(u.lastAt))))] : null,
      h('div', { class: 'us-sub' }, 'Les agents et les skills'),
      h('p', { class: 'us-dim' }, 'Un agent appelle tout seul les skills perso, du projet et des plugins activés, par l\'outil Skill, sauf si sa liste « tools: » ne contient pas Skill. « skills: » dans son en-tête ne donne pas l\'accès : il précharge le texte complet de ces skills dès son démarrage, pour qu\'il les suive sans avoir à les chercher. Un skill seulement cité dans ses consignes est ouvert s\'il y pense.'),
    ];
  }

  // ---------- la documentation : la fiche ----------
  // Toute la doc « humaine » du projet, par etageres (lib/docs.js) ; une recherche ; les sessions qui doivent
  // encore leur doc ; ce qu'elles ont ecrit. Un clic ouvre la page, lue dans la tour.
  async function docSearch(M) {
    const D = docsOf(M); if (!D || !docUi.q.trim()) { docUi.results = null; renderHud(); return; }
    docUi.busy = true; renderHud();
    try { docUi.results = await fetch(`/api/docs/search?project=${encodeURIComponent(D.project)}&q=${encodeURIComponent(docUi.q)}`).then(r => r.json()); }
    catch { docUi.results = { ok: false, hits: [] }; }
    docUi.busy = false; renderHud();
  }
  function docsBody(M) {
    const D = docsOf(M);
    if (!D) return [h('p', { class: 'us-dim' }, M.projects.length ? 'La tour lit la doc du projet…' : 'Connecte ton projet Unreal : sa doc (le dossier docs/, les carnets, les rapports) s\'affiche ici.')];
    const read = (rel, title) => docView(D.project, rel, title, M);
    const all = Object.keys((M.S && M.S.docs) || {});
    const debts = docDebts(M), late = debts.filter(d => d.owed), busy = debts.filter(d => !d.owed);
    const input = h('input', { type: 'search', class: 'us-docq', name: 'docq', 'data-keep': 'docq', value: docUi.q, placeholder: 'Chercher (ex. porte, réplication)', 'aria-label': 'Chercher dans la doc',
      oninput: (e) => { docUi.q = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!M.demo) docSearch(M); } } });
    const R = docUi.results;
    // la page d'entree : docs/COMPRENDRE.md (ecrite par la tache « Doc du projet »), sinon docs/README.md
    const has = (rel) => D.shelves.some(sh => sh.files.some(f => f.rel === rel));
    const entry = has('docs/COMPRENDRE.md') ? 'docs/COMPRENDRE.md' : D.hasReadme ? 'docs/README.md' : null;
    return [
      all.length > 1 ? h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Projet' }, all.map(n => h('button', { type: 'button', class: 'us-chip2' + (n === D.project ? ' on' : ''), 'aria-pressed': String(n === D.project), onclick: () => { docUi.project = n; docUi.results = null; renderHud(); } }, n))) : null,
      h('p', null, `La doc de ${D.project}, pour toi et pour les sessions : ${T.plural(D.total, 'page', 'pages')}. Les sessions et leurs agents y écrivent leur doc : c'est obligatoire, la tour les fait continuer tant qu'elles ont modifié le jeu sans rien écrire dans docs/. La doc d'Unreal Engine 5 a sa propre fiche.`),
      h('div', { class: 'us-actions' },
        entry ? btn(`Comprendre ${D.project}`, () => read(entry, `Comprendre ${D.project}`), 'us-go') : null,
        btn(entry === 'docs/COMPRENDRE.md' ? 'Compléter la doc' : 'Écrire la page d\'entrée', () => launchTask((M.S.tasks || []).find(t => t.id === 'doc-projet') || { id: 'doc-projet', title: 'Doc du projet : tout comprendre', prompt: '' }, D.project, true), entry ? '' : 'us-go',
          M.demo ? { disabled: true } : { title: `Une session en fond relit tout le jeu et fait de docs/ la doc qui suffit pour comprendre ${D.project} : une page d'entrée, une page par système. Elle n'écrit que dans docs/.` })),
      h('div', { class: 'us-row' }, input, btn(docUi.busy ? 'Recherche…' : 'Chercher', () => docSearch(M), 'us-go', { disabled: docUi.busy || !!M.demo })),
      R ? [h('div', { class: 'us-sub' }, R.hits.length ? `${R.total > R.hits.length ? `${R.hits.length} premiers sur ${R.total}` : T.plural(R.hits.length, 'page trouvée', 'pages trouvées')} pour « ${R.q} »` : `Rien pour « ${R.q || docUi.q} »`),
        h('ul', { class: 'us-tuto-list' }, R.hits.map(x => h('li', { class: 'us-task us-doc' }, h('button', { type: 'button', class: 'us-runbtn', onclick: () => read(x.rel, x.title) }, h('b', null, x.title), h('span', { class: 'us-dim us-scope' }, x.shelf)),
          x.line ? h('small', { class: 'us-dim' }, x.line) : null))),
        h('div', { class: 'us-actions' }, btn('Effacer la recherche', () => { docUi.results = null; docUi.q = ''; renderHud(); }))] : null,
      late.length ? [h('div', { class: 'us-sub' }, 'Doc en retard'),
        h('ul', { class: 'us-tuto-list' }, late.map(d => h('li', { class: 'us-task us-doc us-sk-ko' },
          h('button', { type: 'button', class: 'us-runbtn', onclick: () => NAV().conv(d.a.id) }, h('span', { class: 'us-dot us-d-ko' }), h('b', null, sname(d.a)), h('span', { class: 'us-skst us-t-ko' }, d.owed.asked ? 'la tour lui fait écrire' : 'a fini sans l\'écrire')),
          h('small', { class: 'us-dim' }, `${T.plural(d.files.length, 'fichier modifié', 'fichiers modifiés')} : ${d.files.slice(-3).map(f => f.split('/').pop()).join(', ')}`))))] : null,
      busy.length ? h('p', { class: 'us-dim' }, `En cours : ${busy.map(d => sname(d.a)).join(', ')} ${busy.length > 1 ? 'ont' : 'a'} modifié le jeu ; la doc vient avant la fin de leur tour.`) : null,
      modifsBlock(M, 'docs'),
      D.shelves.map(sh => {
        const open = docUi.open.has(sh.id);
        return h('div', { class: 'us-shelf' },
          h('button', { type: 'button', class: 'us-runbtn us-shelfhead', 'aria-expanded': String(open), onclick: () => { if (open) docUi.open.delete(sh.id); else docUi.open.add(sh.id); renderHud(); } },
            h('i', { class: 'us-shelfcol', style: `background:${shelfCol(sh.id)}`, 'aria-hidden': 'true' }), h('b', null, sh.title), h('span', { class: 'us-skst us-dim' }, String(sh.files.length))),
          open ? [sh.why ? h('small', { class: 'us-dim' }, sh.why) : null,
            h('ul', { class: 'us-doclist' }, sh.files.slice(0, 200).map(f => h('li', null, h('button', { type: 'button', class: 'us-link', onclick: () => read(f.rel, f.title) }, f.title), ' ', h('span', { class: 'us-dim' }, T.agoEl(f.mtime))))),
            sh.files.length > 200 ? h('small', { class: 'us-dim' }, `… et ${sh.files.length - 200} autres : cherche-les.`) : null] : null);
      }),
      h('div', { class: 'us-actions' }, btn('Doc Unreal Engine', () => NAV().sheet('unreal')), btn('Relire', async () => { const r = await T.api('/api/docs/refresh'); if (r) T.toast('Doc relue.'); }),
        h('span', { class: 'us-dim' }, D.hasReadme ? 'docs/README.md dit où écrire quoi.' : '')),
    ];
  }
  function unrealBody(M) {
    const D = docsOf(M), mode = (M.S && M.S.docRules && M.S.docRules.unreal) || 'question';
    const set = async (m) => { if (m === mode) return; const r = await T.call('/api/docs/unreal', { mode: m }); if (r && r.ok) T.toast(m === 'modif' ? 'Les sessions liront la doc Unreal avant chaque modification.' : 'Les sessions liront la doc Unreal quand elles ont une question.'); };
    const MODES = [['question', 'Quand elles ont une question', 'Sur la façon de créer ou d\'utiliser quelque chose. Moins de tokens.'], ['modif', 'Avant chaque modification', 'L\'ancienne règle : vérifier chaque API avant d\'écrire.']];
    return [
      h('p', null, `La doc officielle d'Unreal Engine ${D && D.version ? D.version : '5'}, rangée par thème. Les sessions et leurs agents l'ouvrent eux-mêmes ; elle est aussi écrite pour eux dans `, h('code', null, D ? D.ueFile : 'Saved/Tour/doc-unreal.md'), '.'),
      h('div', { class: 'us-sub' }, 'Quand les sessions la lisent'),
      h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Quand les sessions lisent la doc Unreal' }, MODES.map(([id, text, hint]) =>
        h('button', { type: 'button', class: 'us-chip2' + (mode === id ? ' on' : ''), 'aria-pressed': String(mode === id), title: hint, disabled: !!M.demo, onclick: () => set(id) }, text))),
      h('small', { class: 'us-dim' }, MODES.find(x => x[0] === mode)[2], ' Vaut pour les sessions qui démarrent ensuite.'),
      D ? D.ue.map(th => [h('div', { class: 'us-sub' }, th.theme), h('ul', { class: 'us-doclist' }, th.pages.map(pg => h('li', null, h('a', { href: pg.url, target: '_blank', rel: 'noopener', class: 'us-link' }, pg.title))))]) : h('p', { class: 'us-dim' }, 'Lecture en cours…'),
      D && D.tiers.length ? [h('div', { class: 'us-sub' }, 'Docs des packs, copiées dans le projet'), D.tiers.map(sh => [h('small', { class: 'us-dim' }, sh.why),
        h('ul', { class: 'us-doclist' }, sh.files.slice(0, 60).map(f => h('li', null, h('button', { type: 'button', class: 'us-link', onclick: () => docView(D.project, f.rel, f.title, M) }, f.title))))])] : null,
      D && D.engineDir ? [h('div', { class: 'us-sub' }, 'Signatures exactes'), h('p', { class: 'us-dim' }, 'Les en-têtes du moteur installé font foi : ', h('code', { class: 'us-path' }, `${D.engineDir}\\Engine\\Source`), '.')] : null,
      h('div', { class: 'us-actions' }, btn('Doc du jeu', () => NAV().sheet('docs'))),
    ];
  }

  // ---------- le suivi des modifications (lib/modifs.js) ----------
  // Un seul journal pour les deux batiments : chaque page de doc ecrite par une session ou un agent,
  // chaque git commit et chaque git push, avec qui, quand, et ou ca en est (commite ? pousse ?).
  // La Documentation l'ouvre sur la doc, les Depots sur git ; les puces passent de l'un a l'autre.
  const modUi = { filter: { docs: 'doc', git: 'git' }, more: { docs: false, git: false }, open: new Set() };
  const samePath = (a, b) => !!a && !!b && String(a).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === String(b).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const baseName = (f) => String(f || '').split('/').pop();
  const isDocFile = (f) => /^(docs\/.+|\.claude\/skills\/.+)\.(md|markdown|txt)$/i.test(f || '');
  function repoOfRoot(M, root) { const Gt = gitOf(M); return Gt && root ? Gt.repos.find(r => samePath(r.root, root)) || null : null; }
  // Un commit est-il parti ? GitHub le montre, ou un push reussi l'a suivi ; sinon il attend sur le PC.
  function pushedOf(M, c) {
    if (c.state !== 'ok') return null;
    const r = repoOfRoot(M, c.root);
    if (r && r.remote && r.remote.ok && c.short && r.remote.commits.some(k => k.sha.startsWith(c.short))) return ['ok', 'sur GitHub'];
    if ((M.S.modifs || []).some(e => e.kind === 'push' && e.at >= c.at && samePath(e.root, c.root) && (e.state === 'ok' || e.state === 'uptodate'))) return ['ok', 'poussé'];
    if (r && r.isRepo && !(r.remotes || []).length) return ['unused', 'reste sur le PC (pas de dépôt distant)'];
    if (r && r.isRepo) return ['warn', 'pas encore poussé'];
    return null;
  }
  // Une page de doc : deja dans un commit, ou encore dans les fichiers pas commites.
  function docStateOf(M, e) {
    if (e.commit) {
      const c = (M.S.modifs || []).find(x => x.kind === 'commit' && x.short === e.commit.short && samePath(x.root, e.root));
      const p = c && pushedOf(M, c);
      return [p && p[0] === 'warn' ? 'warn' : 'ok', `commitée (${e.commit.short})${p ? `, ${p[1]}` : ''}`];
    }
    const r = repoOfRoot(M, e.root);
    if (r && r.dirty && r.dirty.files.some(f => f.path === e.rel)) return ['warn', 'pas encore commitée'];
    if (r && !r.isRepo) return ['unused', 'pas de git dans ce projet'];
    return null;
  }
  // Qui : la salle (la session dans la tour), et l'agent quand c'est lui.
  function byWho(M, e) {
    const a = M.agents.find(x => x.id === e.sessionId);
    const name = a ? sname(a) : e.salle || 'une session';
    return [e.sub ? `l'agent ${e.sub} de ` : '', a ? h('button', { type: 'button', class: 'us-link', onclick: () => NAV().conv(a.id) }, `« ${name} »`) : `« ${name} »`];
  }
  function modRow(M, e) {
    const key = e.id || `${e.kind}:${e.sha || e.short}`, isOpen = modUi.open.has(key);
    const toggle = () => { if (isOpen) modUi.open.delete(key); else modUi.open.add(key); renderHud(); };
    const repo = e.repo || e.project || '';
    let dot, title, tone, state, details = [];
    if (e.kind === 'doc') {
      const st = docStateOf(M, e);
      dot = 'blue'; title = [h('b', null, baseName(e.rel)), ` ${e.tool === 'Write' ? 'écrite' : 'mise à jour'}`];
      [tone, state] = st || ['unused', ''];
      details = [
        h('small', null, 'Par ', byWho(M, e), e.n > 1 ? `, ${e.n} fois` : '', e.asked ? ', ' : '', e.asked ? h('span', { class: 'us-t-warn' }, 'à la demande de la tour (doc en retard)') : '', '. ',
          h('button', { type: 'button', class: 'us-link', onclick: () => docView(e.project, e.rel, baseName(e.rel), M) }, 'Lire')),
        e.covers && e.covers.length ? h('small', { class: 'us-dim' }, `Couvre ${T.plural(e.covers.length, 'fichier du jeu', 'fichiers du jeu')} : ${e.covers.slice(-4).map(baseName).join(', ')}${e.covers.length > 4 ? '…' : ''}`) : null,
        isOpen ? h('small', { class: 'us-dim us-path' }, e.rel) : null];
    } else if (e.kind === 'commit' || e.kind === 'ext') {
      const p = pushedOf(M, { ...e, state: e.kind === 'ext' ? 'ok' : e.state });
      dot = e.state === 'error' ? 'ko' : 'ok';
      title = [h('b', null, 'Commit'), e.short ? [' ', h('code', null, e.short)] : '', ` ${e.subject ? `« ${e.subject} »` : ''}`];
      [tone, state] = e.state === 'error' ? ['ko', 'échoué'] : e.state === 'unknown' ? ['unused', 'résultat inconnu'] : p || ['unused', ''];
      const docs = (e.list || []).filter(isDocFile).length;
      details = [
        isOpen && e.subject ? h('small', null, h('b', null, e.subject)) : null,
        h('small', null, e.kind === 'ext' ? `Par ${e.author || '?'}, hors d'une session suivie` : ['Par ', byWho(M, e)], repo ? ` dans ${repo}` : '', e.branch ? `, branche ${e.branch}` : '',
          e.files != null ? `, ${T.plural(e.files, 'fichier', 'fichiers')}` : '', docs ? ` dont ${T.plural(docs, 'page de doc', 'pages de doc')}` : '', e.amend ? ' (amend)' : '', '.'),
        e.error ? h('small', { class: 'us-t-ko' }, e.error) : null,
        isOpen && e.list && e.list.length ? h('ul', { class: 'us-doclist' }, e.list.map(f => h('li', { class: isDocFile(f) ? '' : 'us-dim' }, isDocFile(f) && e.project
          ? h('button', { type: 'button', class: 'us-link', onclick: () => docView(e.project, f, baseName(f), M) }, f) : h('span', { class: 'us-path' }, f))), e.count > e.list.length ? h('li', { class: 'us-dim' }, `… et ${e.count - e.list.length} autres`) : null) : null];
    } else {
      const ok = e.state === 'ok' || e.state === 'uptodate';
      dot = ok ? 'ok' : e.state === 'unknown' ? 'warn' : 'ko';
      const dest = [e.remote, e.ref].filter(Boolean).join(' ') || (e.refs && e.refs[0] ? e.refs[0].to : '');
      title = [h('b', null, 'Push'), dest ? ` vers ${dest}` : '', e.force ? ' (forcé)' : ''];
      [tone, state] = e.state === 'ok' ? ['ok', 'envoyé'] : e.state === 'uptodate' ? ['ok', 'déjà à jour'] : e.state === 'rejected' ? ['ko', 'refusé'] : e.state === 'error' ? ['ko', 'échoué'] : ['unused', 'résultat inconnu'];
      details = [
        h('small', null, 'Par ', byWho(M, e), repo ? ` depuis ${repo}` : '', e.to ? ', vers ' : '', e.to ? h('span', { class: 'us-path' }, e.to) : '', '.'),
        e.refs && e.refs.length ? h('small', { class: 'us-dim' }, e.refs.map(r => `${r.from} → ${r.to}${r.what === 'new' ? ' (nouvelle branche)' : r.range ? ` (${r.range})` : ''}${r.what === 'rejected' ? ` refusé${r.why ? ` : ${r.why}` : ''}` : ''}`).join(' · ')) : null,
        e.error && e.state !== 'rejected' ? h('small', { class: 'us-t-ko' }, e.error) : null,
        e.state === 'rejected' ? h('small', { class: 'us-dim' }, 'GitHub a des commits que le PC n\'a pas : il faut d\'abord les récupérer (git pull), puis repousser.') : null];
    }
    return h('li', { class: 'us-task us-doc us-mod' },
      h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(isOpen), onclick: toggle },
        h('span', { class: `us-dot us-d-${dot}` }), h('span', { class: 'us-modt' }, title), h('span', { class: 'us-dim us-scope us-modat' }, T.agoEl(e.at))),
      state ? h('small', { class: `us-modst us-t-${tone}` }, state) : null,
      details);
  }
  // Le journal vu d'un batiment : place = 'docs' ou 'git'.
  function modifsBlock(M, place) {
    const all = M.S.modifs || [];
    const f = modUi.filter[place];
    const known = new Set(all.filter(e => e.kind === 'commit' && e.short).map(e => e.short));
    // les commits faits hors des sessions suivies (ali dans un terminal, un outil) : lus dans les depots
    const Gt = gitOf(M), oldest = all.length ? all[all.length - 1].at : 0;
    const ext = f === 'doc' ? [] : ((Gt && Gt.repos) || []).flatMap(r => (r.commits || []).filter(k => !known.has(k.short) && k.at >= oldest - 1000)
      .map(k => ({ kind: 'ext', id: `ext:${r.root}:${k.short}`, at: k.at, short: k.short, sha: k.sha, subject: k.subject, author: k.author, root: r.root, repo: r.name, state: 'ok' })));
    const list = [...all, ...ext].filter(e => f === 'tout' || (f === 'doc' ? e.kind === 'doc' : e.kind !== 'doc')).sort((a, b) => b.at - a.at);
    const shown = list.slice(0, modUi.more[place] ? 40 : 8);
    const n = (k) => all.filter(e => k === 'doc' ? e.kind === 'doc' : e.kind !== 'doc').length;
    const late = all.filter(e => e.kind === 'commit' && pushedOf(M, e) && pushedOf(M, e)[0] === 'warn').length;
    const CHIPS = [['doc', `Doc (${n('doc')})`], ['git', `Commits et push (${n('git')})`], ['tout', 'Tout']];
    const empty = f === 'doc' ? 'Rien encore : la tour note ici chaque page de doc qu\'une session ou un agent écrit, avec les fichiers du jeu qu\'elle couvre.'
      : 'Rien encore : la tour note ici chaque git commit et chaque git push lancé par une session, avec son résultat.';
    return [
      h('div', { class: 'us-sub' }, 'Suivi des modifications'),
      h('p', { class: 'us-dim' }, place === 'docs' ? 'Qui a écrit quelle page, pour quels fichiers du jeu, et si elle est déjà commitée.' : 'Qui a commité quoi, ce qui est parti sur GitHub et ce qui attend encore sur le PC.',
        late ? [' ', h('span', { class: 'us-t-warn' }, `${T.plural(late, 'commit pas encore poussé', 'commits pas encore poussés')}.`)] : ''),
      h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Filtrer le suivi des modifications' }, CHIPS.map(([id, text]) =>
        h('button', { type: 'button', class: 'us-chip2' + (f === id ? ' on' : ''), 'aria-pressed': String(f === id), onclick: () => { modUi.filter[place] = id; renderHud(); } }, text))),
      shown.length ? h('ul', { class: 'us-tuto-list' }, shown.map(e => modRow(M, e))) : h('p', { class: 'us-dim' }, empty),
      list.length > 8 ? h('div', { class: 'us-actions' }, btn(modUi.more[place] ? 'Moins' : `Voir plus (${Math.min(list.length, 40)})`, () => { modUi.more[place] = !modUi.more[place]; renderHud(); })) : null,
    ];
  }

  // ---------- les depots : la fiche ----------
  // Un depot par dossier suivi (la tour, chaque projet connu, les dossiers ajoutes) : son etat git sur
  // le PC et, s'il est relie a GitHub, ce qui s'y passe. La tour lit ; les trois gestes qui changent un
  // depot (initialiser git, le relier a GitHub, recuperer) attendent un clic et une confirmation.
  async function gitDo(key, path, body, done) {
    gitUi.busy = key; renderHud();
    const r = await T.api(path, body);
    gitUi.busy = ''; renderHud();
    if (!r) return null;
    if (r.nogit) { gitMissing(r.download); return r; }
    if (!r.ok) { T.toast(r.error || 'Échec.'); return r; }
    if (done) T.toast(typeof done === 'function' ? done(r) : done);
    return r;
  }
  // Git absent : la tour le demande clairement, avec le lien officiel.
  let gitDlg = null;
  function gitMissing(url) {
    if (!gitDlg) {
      gitDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Git n\'est pas installé' },
        h('form', { method: 'dialog' }, h('h2', null, 'Git n\'est pas installé'),
          h('p', null, 'La tour a besoin de Git pour suivre tes projets et leurs dépôts GitHub. Installe-le depuis le site officiel en gardant les choix par défaut, puis reviens ici et clique « Revérifier ».'),
          h('div', { class: 'us-actions' },
            gitDlg_link = h('a', { class: 'us-btn us-go', target: '_blank', rel: 'noopener' }, 'Télécharger Git'),
            h('button', { type: 'submit', class: 'us-btn', onclick: () => T.api('/api/git/refresh') }, 'Revérifier'),
            h('button', { type: 'submit', class: 'us-btn' }, 'Plus tard'))));
      document.body.append(gitDlg);
    }
    gitDlg_link.href = url || 'https://git-scm.com/downloads/win';
    if (!gitDlg.open) gitDlg.showModal();
  }
  let gitDlg_link = null;
  function gitInit(r, M) {
    if (M.demo) return T.api('/api/git/init');
    const Gt = gitOf(M);
    if (Gt && !Gt.git) return gitMissing(Gt.download);
    const msg = `Initialiser git dans ${r.root} ?\n\nLa tour lance « git init » (branche main)${r.uproject ? ' et ajoute un .gitignore Unreal (Binaries, Intermediate, Saved, DerivedDataCache) s\'il n\'y en a pas' : ''}. Aucun fichier n'est commité ni envoyé sur GitHub.`;
    if (!confirm(msg)) return;
    gitDo('init:' + r.root, '/api/git/init', { root: r.root }, (x) => x.gitignore ? 'Git initialisé, avec un .gitignore Unreal.' : 'Git initialisé.');
  }
  function gitRemote(r, M) {
    const url = String(gitUi.url[r.root] || '').trim();
    if (!url) return T.toast('Colle l\'adresse du dépôt GitHub.');
    if (!M.demo && !confirm(`Relier ${r.name} à ${url} ?\n\nLa tour lance « git remote add origin ». Rien n'est envoyé : pousser reste ton geste.`)) return;
    gitDo('remote:' + r.root, '/api/git/remote', { root: r.root, url }, 'Dépôt relié à GitHub.');
  }
  function repoCard(r, M, Gt) {
    const [tone, text] = repoTone(r, Gt), open = gitUi.open.has(r.root), busy = (k) => gitUi.busy === k + ':' + r.root;
    const kind = { tour: 'la tour', projet: 'projet', suivi: 'dossier ajouté' }[r.kind] || '';
    const head = h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(open), onclick: () => { if (open) gitUi.open.delete(r.root); else gitUi.open.add(r.root); renderHud(); } },
      h('span', { class: `us-dot us-d-${tone}` }), h('b', null, r.name), h('span', { class: 'us-dim' }, kind), h('span', { class: `us-skst us-t-${tone === 'off' ? 'unused' : tone}` }, text));
    if (!open) return h('li', { class: 'us-task us-doc' }, head);
    const D = r.dirty, R = r.remote, sync = r.sync;
    const part = [];
    part.push(h('small', { class: 'us-dim us-path' }, r.root));
    if (Gt && !Gt.git) part.push(h('p', null, 'Git n\'est pas installé : la tour ne peut pas lire ce dossier.'), h('div', { class: 'us-actions' }, btn('Installer Git', () => gitMissing(Gt.download), 'us-go')));
    else if (!r.exists) part.push(h('p', { class: 'us-t-ko' }, 'Ce dossier n\'existe plus.'));
    else if (r.error) part.push(h('p', { class: 'us-t-ko' }, r.error));
    else if (!r.isRepo) {
      if (r.inside) part.push(h('p', null, 'Ce dossier fait déjà partie du dépôt ', h('code', { class: 'us-path' }, r.inside), '.'));
      else part.push(h('p', null, 'Pas encore de git ici : rien n\'est versionné, rien ne peut aller sur GitHub.'),
        h('div', { class: 'us-actions' }, btn(busy('init') ? 'Initialisation…' : 'Initialiser git', () => gitInit(r, M), 'us-go', { disabled: !!gitUi.busy })));
    } else {
      // le PC
      part.push(h('div', { class: 'us-sub' }, 'Sur le PC'));
      part.push(h('p', null, r.detached ? 'Pas sur une branche (HEAD détaché).' : ['Branche ', h('b', null, r.branch || '?'), r.empty ? ', encore aucun commit.' : r.upstream ? ` (suit ${r.upstream}).` : '.']));
      if (D && D.total) {
        const bits = [D.modified && `${D.modified} modifié${D.modified > 1 ? 's' : ''}`, D.untracked && `${D.untracked} nouveau${D.untracked > 1 ? 'x' : ''}`, D.staged && `${D.staged} prêt${D.staged > 1 ? 's' : ''} à commiter`, D.conflicts && `${D.conflicts} en conflit`].filter(Boolean);
        part.push(h('p', { class: D.conflicts ? 'us-t-ko' : 'us-t-warn' }, `${T.plural(D.total, 'fichier pas commité', 'fichiers pas commités')} : ${bits.join(', ')}.`));
        part.push(h('ul', { class: 'us-doclist' }, D.files.map(f => h('li', null, h('code', null, f.st), ' ', h('span', { class: 'us-path' }, f.path))), D.total > D.files.length ? h('li', { class: 'us-dim' }, `… et ${D.total - D.files.length} autres`) : null));
      } else part.push(h('p', { class: 'us-t-ok' }, 'Tout est commité.'));
      if (r.commits && r.commits.length) part.push(h('ul', { class: 'us-doclist' }, r.commits.map(k => h('li', null, h('code', null, k.short), ' ', k.subject, ' ', h('span', { class: 'us-dim' }, `${k.author}, `, T.agoEl(k.at))))));
      // GitHub
      part.push(h('div', { class: 'us-sub' }, 'Sur GitHub'));
      if (!r.github) {
        const other = (r.remotes || []).find(x => x.name === 'origin');
        if (other) part.push(h('p', null, 'Relié à ', h('code', { class: 'us-path' }, other.url), ', qui n\'est pas GitHub.'));
        else {
          part.push(h('p', null, 'Pas encore sur GitHub.'));
          if (r.lfs) part.push(h('p', { class: 'us-dim' }, 'Ce projet range ses gros fichiers avec Git LFS. Pour le mettre sur GitHub : créer un dépôt privé, le relier ici, puis tout pousser. GitHub offre 10 Go de stockage LFS gratuits ; au-delà, c\'est payant au Go. Rien n\'est envoyé sans toi.'));
          part.push(h('div', { class: 'us-row' },
            h('input', { type: 'url', class: 'us-docq', 'data-keep': 'gitremote' + hash(r.root), value: gitUi.url[r.root] || '', placeholder: 'https://github.com/toi/projet', 'aria-label': `Adresse GitHub de ${r.name}`,
              oninput: (e) => { gitUi.url[r.root] = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); gitRemote(r, M); } } }),
            btn(busy('remote') ? 'Liaison…' : 'Relier', () => gitRemote(r, M), '', { disabled: !!gitUi.busy })));
          part.push(h('small', { class: 'us-dim' }, 'Relier ne pousse rien : la tour ajoute seulement l\'adresse du dépôt (git remote add origin).'));
        }
      } else if (!R) part.push(h('p', { class: 'us-dim' }, 'Lecture de GitHub…'));
      else if (!R.ok) part.push(h('p', { class: 'us-t-ko' }, R.error));
      else {
        part.push(h('p', null, h('a', { href: R.url, target: '_blank', rel: 'noopener', class: 'us-link' }, `${r.github.owner}/${r.github.repo}`), ` · ${R.private ? 'privé' : 'public'} · dernier push `, T.agoEl(R.pushedAt)));
        const say = !sync ? null : sync.state === 'ok' ? ['us-t-ok', `Le PC est à jour avec ${R.defaultBranch}.`]
          : sync.state === 'behind' ? ['us-t-warn', `GitHub a ${nCommits(sync.n)} que le PC n'a pas encore : récupère-les (git pull).`]
            : sync.state === 'ahead' ? ['us-t-warn', `Le PC a ${nCommits(sync.n)} pas encore poussé${sync.n > 1 ? 's' : ''} sur GitHub.`]
              : sync.state === 'branch' ? ['us-dim', `Le PC est sur la branche ${sync.branch} ; GitHub suit ${sync.main}.`]
                : ['us-t-warn', 'Le PC et GitHub ont chacun des commits que l\'autre n\'a pas.'];
        if (say) part.push(h('p', { class: say[0] }, say[1]));
        if (R.prs.length) part.push(h('div', { class: 'us-sub' }, T.plural(R.prs.length, 'PR ouverte', 'PR ouvertes')), h('ul', { class: 'us-doclist' }, R.prs.map(p => h('li', null, h('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'us-link' }, `#${p.number} ${p.title}`), ' ', h('span', { class: 'us-dim' }, `${p.draft ? 'brouillon, ' : ''}${p.user || ''}, `, T.agoEl(p.at))))));
        else part.push(h('p', { class: 'us-dim' }, 'Aucune PR ouverte.'));
        if (R.commits.length) part.push(h('div', { class: 'us-sub' }, `Derniers commits sur ${R.defaultBranch}`), h('ul', { class: 'us-doclist' }, R.commits.slice(0, 5).map(k => h('li', null, h('code', null, k.short), ' ', k.subject, ' ', h('span', { class: 'us-dim' }, `${k.author}, `, T.agoEl(k.at))))));
        part.push(h('div', { class: 'us-actions' }, btn(busy('fetch') ? 'Récupération…' : 'Récupérer de GitHub', () => gitDo('fetch:' + r.root, '/api/git/fetch', { root: r.root }, 'GitHub relu (git fetch).'), '', { disabled: !!gitUi.busy, title: 'git fetch : met à jour ce que le PC sait de GitHub, sans toucher à tes fichiers' }),
          r.fetchedAt ? h('span', { class: 'us-dim' }, 'dernier fetch ', T.agoEl(r.fetchedAt)) : null));
      }
    }
    if (r.kind === 'suivi') part.push(h('div', { class: 'us-actions' }, btn('Ne plus suivre', () => T.call('/api/git/unfollow', { root: r.root }))));
    return h('li', { class: 'us-task us-doc' }, head, ...part);
  }
  function gitBody(M, kind) {
    const Gt = gitOf(M);
    if (!Gt) return [h('p', { class: 'us-dim' }, 'La tour lit tes dépôts…')];
    // a la premiere ouverture, le premier depot qui demande de l'attention est deplie
    if (!gitUi.seen) { gitUi.seen = true; const first = Gt.repos.find(r => ['ko', 'warn', 'blue'].includes(repoTone(r, Gt)[0])) || Gt.repos[0]; if (first) gitUi.open.add(first.root); }
    const follow = () => { const p = gitUi.path.trim(); if (!p) return T.toast('Colle le chemin du dossier.'); gitDo('follow:', '/api/git/follow', { path: p }, (r) => { gitUi.path = ''; gitUi.open.add(r.root); return 'Dossier suivi.'; }); };
    const list = kind === 'github' ? [...Gt.repos].sort((a, b) => !!b.github - !!a.github) : Gt.repos;
    return [
      !Gt.git ? h('div', { class: 'us-task us-sk-ko', role: 'alert' }, h('b', { class: 'us-t-ko' }, 'Git n\'est pas installé sur ce PC.'),
        h('p', null, 'La tour en a besoin pour suivre tes projets. Installe-le depuis le site officiel en gardant les choix par défaut, puis clique « Revérifier ».'),
        h('div', { class: 'us-actions' }, h('a', { class: 'us-btn us-go', href: Gt.download, target: '_blank', rel: 'noopener' }, 'Télécharger Git'), btn('Revérifier', () => gitDo('refresh:', '/api/git/refresh', {}, 'Git revérifié.')))) : null,
      h('p', null, 'Chaque dossier suivi : sa branche, ses derniers commits, ce qui n\'est pas encore commité, et ce qui se passe sur GitHub. La tour ne fait que lire ; rien ne part sur GitHub sans toi.'),
      h('ul', { class: 'us-tuto-list' }, list.map(r => repoCard(r, M, Gt))),
      modifsBlock(M, 'git'),
      h('div', { class: 'us-sub' }, 'Suivre un autre dossier'),
      h('div', { class: 'us-row' },
        h('input', { type: 'text', name: 'git-dossier', class: 'us-docq', 'data-keep': 'gitpath', value: gitUi.path, placeholder: 'C:\\Users\\toi\\Documents\\MonProjet', 'aria-label': 'Chemin du dossier à suivre',
          oninput: (e) => { gitUi.path = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); follow(); } } }),
        btn(gitUi.busy === 'follow:' ? 'Ajout…' : 'Suivre', follow, 'us-go', { disabled: !!gitUi.busy })),
      h('small', { class: 'us-dim' }, 'S\'il n\'a pas encore git, la tour te proposera de l\'initialiser.'),
      h('div', { class: 'us-actions' }, btn(gitUi.busy === 'refresh:' ? 'Lecture…' : 'Relire', () => gitDo('refresh:', '/api/git/refresh', {}, 'Dépôts relus.'), '', { disabled: !!gitUi.busy }),
        Gt.git ? h('span', { class: 'us-dim' }, `git ${Gt.git.version}`) : null),
    ];
  }

  // La sauvegarde : pour chaque projet, sa destination (un dossier ailleurs, ou un depot git) et le bouton
  // qui lance une copie complete ; puis les dernieres sauvegardes, avec ce qui a ete copie et les erreurs.
  async function svDo(key, path, body, done) {
    svUi.busy = key; renderHud();
    const r = await T.api(path, body);
    svUi.busy = ''; renderHud();
    if (!r) return null;
    if (!r.ok) { T.toast(r.error || 'Échec.'); return r; }
    if (done) T.toast(done);
    return r;
  }
  function svSummary(r) {
    const R = r.result || {}, L = R.lfs || {}, P = R.wip || {}, out = [];
    if (R.head) out.push(`dernier commit ${R.head.slice(0, 7)}, ${T.plural(R.branches || 0, 'branche', 'branches')}${R.tags ? `, ${T.plural(R.tags, 'étiquette', 'étiquettes')}` : ''}${R.stashes ? `, ${T.plural(R.stashes, 'stash', 'stash')}` : ''}`);
    const lfs = (n, one, many) => `${T.num(n)} ${n > 1 ? many : one}`;
    if (L.files) out.push(r.type === 'depot' ? `${lfs(L.files, 'fichier LFS envoyé', 'fichiers LFS envoyés')} (${octets(L.bytes)})` : L.copied ? `${lfs(L.copied, 'fichier LFS copié', 'fichiers LFS copiés')} (${octets(L.copiedBytes)}) sur ${T.num(L.files)}` : `${lfs(L.files, 'fichier LFS déjà là', 'fichiers LFS déjà là')}`);
    if (P.unchanged) out.push('travail en cours inchangé depuis la dernière fois');
    else if (P.files || P.removed || P.extra) out.push([P.files && `${T.plural(P.files, 'fichier pas commité', 'fichiers pas commités')}`, P.removed && `${P.removed} supprimé${P.removed > 1 ? 's' : ''}`, P.extra && `${P.extra} dans Saved/Tour`].filter(Boolean).join(', ') + (P.bytes ? ` (${octets(P.bytes)})` : ''));
    else out.push('rien de pas commité');
    return out;
  }
  function svRunBlock(r, M) {
    if (svLive(r)) {
      const p = r.progress, k = p && p.total ? Math.round(100 * p.done / p.total) : null;
      return h('div', { class: 'us-task', role: 'status' },
        h('p', null, h('span', { class: 'us-dot us-d-blue' }), ' ', h('b', null, r.stepText || 'En cours'), ' · depuis ', T.forEl(r.startedAt)),
        k != null ? [h('div', { class: 'us-bar' }, h('i', { style: `width:${k}%` })), h('small', { class: 'us-dim' }, `${T.num(p.done)} sur ${T.num(p.total)}${p.totalBytes ? ` · ${octets(p.bytes || 0)} sur ${octets(p.totalBytes)}` : ''}`)] : null,
        h('div', { class: 'us-actions' }, btn(svUi.busy === 'stop' ? 'Arrêt…' : 'Arrêter', () => svDo('stop', '/api/sauvegarde/stop', {}, 'Sauvegarde arrêtée.'), 'us-danger', { disabled: !!svUi.busy || M.demo })));
    }
    if (r.step === 'erreur') return h('div', { class: 'us-task us-sk-ko' }, h('p', { class: 'us-t-ko' }, h('b', null, 'Échec '), T.agoEl(r.endedAt), ' : ', r.error || 'erreur inconnue'));
    const R = r.result || {};
    return h('div', { class: 'us-task' },
      h('p', { class: R.warnings && R.warnings.length ? 'us-t-warn' : 'us-t-ok' }, h('b', null, R.verified ? 'Réussie et vérifiée' : 'Terminée'), ' ', T.agoEl(r.endedAt), `, en ${T.dur(r.endedAt - r.startedAt)}`),
      h('ul', { class: 'us-doclist' }, svSummary(r).map(x => h('li', null, x)), R.size ? h('li', null, `Taille de la sauvegarde : ${octets(R.size)}`) : null, R.location ? h('li', null, h('span', { class: 'us-path' }, R.location)) : null),
      R.warnings && R.warnings.length ? h('ul', { class: 'us-doclist' }, R.warnings.map(w => h('li', { class: 'us-t-warn' }, w))) : null,
      R.wip && R.wip.skipped && R.wip.skipped.length ? h('small', { class: 'us-dim' }, `Pas envoyés : ${R.wip.skipped.map(x => x.rel).join(', ')}`) : null);
  }
  function svCard(p, M, SV) {
    const [tone, text] = svTone(p, SV, M.now), open = svUi.open.has(p.root), cur = svCurrent(M);
    const kind = { tour: 'la tour', projet: p.info && p.info.uproject ? 'le jeu' : 'projet', suivi: 'dossier ajouté' }[p.kind] || '';
    const head = h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(open), onclick: () => { if (open) svUi.open.delete(p.root); else svUi.open.add(p.root); renderHud(); } },
      h('span', { class: `us-dot us-d-${tone}` }), h('b', null, p.name), h('span', { class: 'us-dim' }, kind), h('span', { class: `us-skst us-t-${tone === 'off' ? 'unused' : tone}` }, text));
    if (!open) return h('li', { class: 'us-task us-doc' }, head);
    const I = p.info || {}, part = [h('small', { class: 'us-dim us-path' }, p.root)];
    // ce qui part dans la sauvegarde
    part.push(h('p', null, 'À sauvegarder : ', I.isRepo ? [
      'tout l\'historique git', I.lfsFiles ? `, ${T.num(I.lfsFiles)} ${I.lfsFiles > 1 ? 'fichiers' : 'fichier'} LFS (${octets(I.lfsBytes)})` : '', ', le travail pas encore commité', I.uproject ? ' et Saved/Tour' : '', '.',
    ] : ['tous les fichiers du dossier', I.uproject ? ' sauf ce qu\'Unreal régénère (Binaries, Intermediate, DerivedDataCache, Saved hors Saved/Tour)' : '', '. Pas de git ici : chaque sauvegarde garde une version de plus.']));
    // la destination
    const type = svUi.type[p.root] || (p.target && p.target.type) || 'dossier';
    const val = svUi.dest[p.root] != null ? svUi.dest[p.root] : p.target && p.target.type === type ? p.target.dest : '';
    const save = () => {
      const d = String(svUi.dest[p.root] != null ? svUi.dest[p.root] : val || '').trim();
      if (!d) return T.toast(type === 'dossier' ? 'Colle le chemin du dossier.' : 'Colle l\'adresse du dépôt.');
      svDo('cible:' + p.root, '/api/sauvegarde/cible', { root: p.root, type, dest: d }, 'Destination enregistrée.').then((r) => { if (r && r.ok) { delete svUi.dest[p.root]; delete svUi.type[p.root]; } });
    };
    const seg = (id, label) => h('button', { type: 'button', class: 'us-segbtn', 'aria-pressed': String(type === id), onclick: () => { svUi.type[p.root] = id; delete svUi.dest[p.root]; renderHud(); } }, label);
    part.push(h('div', { class: 'us-sub' }, 'Où sauvegarder'));
    if (p.target) part.push(h('p', null, p.target.type === 'dossier' ? ['Dans ', h('code', { class: 'us-path' }, p.target.dest)] : ['Vers ', h('code', { class: 'us-path' }, p.target.dest)]));
    part.push(h('div', { class: 'us-seg us-sv-seg', role: 'group', 'aria-label': `Type de destination pour ${p.name}` }, seg('dossier', 'Un dossier (autre disque, NAS)'), seg('depot', 'Un dépôt git')));
    part.push(h('div', { class: 'us-row' },
      h('input', { type: type === 'depot' ? 'url' : 'text', name: 'sauvegarde-destination', class: 'us-docq', 'data-keep': 'svdest' + type + hash(p.root), value: val, placeholder: type === 'depot' ? 'https://github.com/toi/jeu-sauvegarde.git' : 'E:\\Sauvegardes', 'aria-label': type === 'depot' ? `Adresse du dépôt de sauvegarde de ${p.name}` : `Dossier de sauvegarde de ${p.name}`,
        oninput: (e) => { svUi.dest[p.root] = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } } }),
      btn(svUi.busy === 'cible:' + p.root ? 'Enregistrement…' : 'Enregistrer', save, p.target ? '' : 'us-go', { disabled: !!svUi.busy })));
    if (type === 'dossier') {
      part.push(h('small', { class: 'us-dim' }, `Un autre disque, un disque externe ou un dossier réseau (\\\\NAS\\partage). La tour y range ${p.name}.git et un LISEZMOI qui explique comment tout récupérer.`));
      if (p.target && p.target.sameDisk) part.push(h('p', { class: 'us-t-warn' }, 'Même disque que le projet : si ce disque lâche, tu perds les deux. Préfère un disque externe ou un NAS.'));
    } else {
      part.push(h('small', { class: 'us-dim' }, 'Un dépôt vide, privé de préférence (GitHub, GitLab, un serveur). Rien n\'y est écrasé : si une branche y a des commits que le PC n\'a pas, la tour le signale. Les fichiers pas commités de plus de 50 Mo restent sur le PC.'));
      if (!I.isRepo && I.exists) part.push(h('p', { class: 'us-t-warn' }, 'Ce dossier n\'a pas git : il ne peut partir que dans un dossier, ou après « Initialiser git » dans la fiche Git et GitHub.'));
      const gh = /github\.com/i.test(String(val || '')) || (p.target && p.target.github);
      if (gh && I.lfsBytes > SV.githubLfsFree) part.push(h('p', { class: 'us-t-warn' }, `Ce projet a ${octets(I.lfsBytes)} de fichiers LFS : GitHub gratuit en garde 10 Go, l'envoi s'arrêtera au-delà. Un disque externe n'a pas cette limite.`));
    }
    // lancer
    const r = svRun(SV, p.last), mine = cur && cur.root === p.root;
    const go = () => {
      if (!M.demo && p.target.type === 'depot' && !confirm(`Envoyer ${p.name} vers ${p.target.dest} ?\n\nLa tour y pousse l'historique, les fichiers LFS et le travail en cours (branche tour-sauvegarde/en-cours). Rien n'y est écrasé, et le projet n'est pas modifié.`)) return;
      svDo('lancer:' + p.root, '/api/sauvegarde/lancer', { root: p.root }, 'Sauvegarde lancée.');
    };
    part.push(h('div', { class: 'us-actions' },
      btn(svUi.busy === 'lancer:' + p.root ? 'Lancement…' : 'Sauvegarder maintenant', go, 'us-go', { disabled: !p.target || !!cur || !!svUi.busy, title: !p.target ? 'Choisis d\'abord où sauvegarder' : cur && !mine ? `Une sauvegarde de ${cur.name} est en cours` : '' }),
      p.target && !mine ? btn('Retirer la destination', () => svDo('cible:' + p.root, '/api/sauvegarde/cible', { root: p.root, type: '' }, 'Destination retirée.'), 'us-link') : null));
    if (r && !svLive(r)) part.push(svRunBlock(r, M)); // celle en cours est deja en haut de la fiche
    return h('li', { class: 'us-task us-doc' }, head, part);
  }
  function svBody(M) {
    const SV = svOf(M);
    if (!SV) return [h('p', { class: 'us-dim' }, 'La tour lit les projets à sauvegarder…')];
    // a la premiere ouverture, le jeu (ou le premier projet a proteger) est deplie
    if (!svUi.seen && SV.projects.length) { svUi.seen = true; const first = SV.projects.find(p => svTone(p, SV, M.now)[0] !== 'ok') || SV.projects[0]; svUi.open.add(first.root); }
    const cur = svCurrent(M), others = SV.runs.filter(r => !svLive(r)).slice(0, 8);
    return [
      h('p', null, 'Une copie complète de chaque projet, ailleurs que sur son disque : tout l\'historique git, les fichiers LFS, le travail pas encore commité et Saved/Tour. Le projet lui-même n\'est jamais modifié : ni commit, ni stash.'),
      cur ? [h('div', { class: 'us-sub' }, `En cours : ${cur.name}`), svRunBlock(cur, M)] : null,
      h('ul', { class: 'us-tuto-list' }, SV.projects.map(p => svCard(p, M, SV))),
      others.length ? [h('div', { class: 'us-sub' }, 'Dernières sauvegardes'), h('ul', { class: 'us-tuto-list' }, others.map(r => {
        const open = svUi.run === r.id, ok = r.step !== 'erreur';
        return h('li', { class: 'us-task us-doc' },
          h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(open), onclick: () => { svUi.run = open ? null : r.id; renderHud(); } },
            h('span', { class: `us-dot us-d-${ok ? 'ok' : 'ko'}` }), h('b', null, r.name), h('span', { class: 'us-dim' }, r.type === 'depot' ? 'dépôt' : 'dossier'), h('span', { class: `us-skst us-t-${ok ? 'ok' : 'ko'}` }, T.agoEl(r.endedAt))),
          open ? svRunBlock(r, M) : null);
      }))] : null,
      h('div', { class: 'us-actions' }, btn(svUi.busy === 'relire' ? 'Lecture…' : 'Relire les projets', () => svDo('relire', '/api/sauvegarde/relire', {}, 'Projets relus.'), '', { disabled: !!svUi.busy })),
    ];
  }

  // Lecteur de doc : le Markdown mis en page (titres, listes, tableaux, code, liens). Un lien vers une autre
  // page de la doc l'ouvre ici ; un lien web s'ouvre dans un onglet.
  function mdInline(text, base, open) {
    const out = [];
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const tk = m[0];
      if (m[1]) out.push(h('code', null, tk.slice(1, -1)));
      else if (m[2]) out.push(h('b', null, tk.slice(2, -2)));
      else if (m[4]) out.push(h('i', null, tk.slice(1, -1)));
      else {
        const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tk), label = lm[1], href = lm[2];
        if (/^https?:\/\//i.test(href)) out.push(h('a', { href, target: '_blank', rel: 'noopener', class: 'us-link' }, label));
        else if (/\.(md|markdown|txt)(#.*)?$/i.test(href) && open) {
          const parts = (base ? base.split('/').slice(0, -1) : []);
          for (const seg of href.split('#')[0].split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
          out.push(h('button', { type: 'button', class: 'us-link', onclick: () => open(parts.join('/'), label) }, label));
        } else out.push(label);
      }
      last = m.index + tk.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function mdNodes(text, base, open) {
    const lines = String(text || '').replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
    const out = [];
    let para = [], list = null;
    const flush = () => { if (para.length) { out.push(h('p', null, mdInline(para.join(' '), base, open))); para = []; } if (list) { out.push(list); list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*```/.test(l)) { flush(); const code = []; for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]); out.push(h('pre', { class: 'us-code' }, code.join('\n'))); continue; }
      const hd = /^(#{1,6})\s+(.*?)\s*#*$/.exec(l);
      if (hd) { flush(); out.push(h(`h${Math.min(6, hd[1].length + 2)}`, null, mdInline(hd[2], base, open))); continue; }
      if (/^\s*\|/.test(l)) {
        flush(); const rows = [];
        for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) if (!/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim()));
        i--;
        out.push(h('div', { class: 'us-mdtable' }, h('table', null, rows.map((r, k) => h('tr', null, r.map(cell => h(k ? 'td' : 'th', null, mdInline(cell, base, open))))))));
        continue;
      }
      const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l);
      if (li) { if (para.length) { out.push(h('p', null, mdInline(para.join(' '), base, open))); para = []; } if (!list) list = h(/^\s*\d/.test(l) ? 'ol' : 'ul', null); list.append(h('li', null, mdInline(li[1], base, open))); continue; }
      if (/^\s*>/.test(l)) { flush(); out.push(h('blockquote', null, mdInline(l.replace(/^\s*>\s?/, ''), base, open))); continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { flush(); out.push(h('hr')); continue; }
      if (!l.trim()) { flush(); continue; }
      if (list && /^\s{2,}\S/.test(l)) { list.lastChild.append(' ', ...mdInline(l.trim(), base, open)); continue; }
      if (list) flush();
      para.push(l.trim());
    }
    flush();
    return out;
  }
  let docDlg = null;
  async function docView(project, rel, title, M) {
    if (!docDlg) {
      const f = {};
      docDlg = h('dialog', { class: 'us-dialog us-wide us-docdlg', 'aria-label': 'Page de la doc' },
        h('form', { method: 'dialog' }, f.h2 = h('h2', null), f.path = h('p', { class: 'us-dim us-path' }), f.body = h('div', { class: 'us-md' }),
          h('div', { class: 'us-actions' }, h('button', { type: 'submit', class: 'us-btn' }, 'Fermer'))));
      docDlg.f = f;
      document.body.append(docDlg);
    }
    const f = docDlg.f;
    const open = (r2, t2) => docView(project, r2, t2, M);
    f.h2.textContent = title || rel;
    f.path.textContent = rel;
    f.body.replaceChildren(h('p', { class: 'us-dim' }, 'Lecture…'));
    if (!docDlg.open) docDlg.showModal();
    if (M && M.demo) { f.body.replaceChildren(h('p', { class: 'us-dim' }, 'Démo : les pages se lisent sur ta tour.')); return; }
    try {
      const r = await fetch(`/api/docs/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`).then(res => res.json());
      if (!r || !r.ok) { f.body.replaceChildren(h('p', { class: 'us-t-ko' }, (r && r.error) || 'Lecture impossible.')); return; }
      // le premier titre de la page devient le titre du lecteur
      let text = r.text;
      const first = /^\s*(?:---\n[\s\S]*?\n---\n\s*)?#\s+(.+?)\s*#*\s*$/m.exec(text);
      if (first && !/\.txt$/i.test(rel) && text.slice(0, first.index).replace(/^---\n[\s\S]*?\n---\n/, '').trim() === '') { f.h2.textContent = first[1].replace(/[*_`]/g, ''); text = text.replace(/^(\s*(?:---\n[\s\S]*?\n---\n\s*)?)#\s+.+$/m, '$1'); }
      f.body.replaceChildren(...(/\.txt$/i.test(rel) ? [h('pre', { class: 'us-code us-pre' }, text)] : mdNodes(text, r.path, open)), h('p', { class: 'us-dim' }, 'Modifiée ', T.agoEl(r.mtime), '.'));
      f.body.scrollTop = 0; docDlg.scrollTop = 0;
    } catch { f.body.replaceChildren(h('p', { class: 'us-t-ko' }, 'Tour injoignable.')); }
  }

  let fileDlg = null, fileDlg_h2, fileDlg_path, fileDlg_pre;
  function skillFile(x) { return fileView(x.call, x.file, '/api/skills/file?id=' + encodeURIComponent(x.id)); }
  async function fileView(title, file, url) {
    if (!fileDlg) {
      fileDlg = h('dialog', { class: 'us-dialog us-wide', 'aria-label': 'SKILL.md' },
        h('form', { method: 'dialog' }, fileDlg_h2 = h('h2', null), fileDlg_path = h('p', { class: 'us-dim us-path' }), fileDlg_pre = h('pre', { class: 'us-code us-skilltext' }),
          h('div', { class: 'us-actions' }, h('button', { type: 'submit', class: 'us-btn' }, 'Fermer'))));
      document.body.append(fileDlg);
    }
    fileDlg_h2.textContent = title;
    fileDlg_path.textContent = file;
    fileDlg_pre.textContent = 'Lecture…';
    fileDlg.showModal();
    try {
      const r = await fetch(url).then(res => res.json());
      fileDlg_pre.textContent = r && r.ok ? r.text : (r && r.error) || 'Lecture impossible.';
    } catch { fileDlg_pre.textContent = 'Tour injoignable.'; }
  }

  // Ajouter un skill : depuis le modele (nom, quand s'en servir, consignes), ou depuis une adresse GitHub.
  // Un skill recupere dehors est montre en entier, et ne s'installe qu'une fois lu et confirme.
  let skillDlg = null;
  function skillDialog(M) {
    const L = M.S.skills || { projects: [] };
    if (!skillDlg) {
      const f = {};
      const setMode = (m) => {
        f.mode = m;
        f.tabTpl.setAttribute('aria-pressed', String(m === 'tpl')); f.tabUrl.setAttribute('aria-pressed', String(m === 'url'));
        f.tabTpl.classList.toggle('on', m === 'tpl'); f.tabUrl.classList.toggle('on', m === 'url');
        f.tpl.hidden = m !== 'tpl'; f.url.hidden = m !== 'url';
        f.err.textContent = '';
        f.submit.textContent = m === 'tpl' ? 'Créer le skill' : 'Installer ce skill';
        f.submit.disabled = m === 'url' && !(f.got && f.ok.checked);
      };
      const fetchIt = async () => {
        f.err.textContent = ''; f.preview.hidden = true; f.got = null; setMode('url');
        f.fetchBtn.disabled = true; f.fetchBtn.textContent = 'Récupération…';
        const r = await T.api('/api/skills/fetch', { url: f.addr.value });
        f.fetchBtn.disabled = false; f.fetchBtn.textContent = 'Récupérer';
        if (!r || !r.ok) { f.err.textContent = (r && r.error) || 'Tour injoignable.'; return; }
        f.got = r;
        f.from.textContent = r.url;
        f.text.textContent = r.text;
        if (!f.name.value) f.name.value = r.name;
        f.notes.replaceChildren(...[
          ...r.problems.map(p => h('li', { class: 'us-t-warn' }, `En-tête : ${p}.`)),
          r.links.length ? h('li', { class: 'us-t-warn' }, `Il cite aussi ${r.links.join(', ')} : seul SKILL.md est copié, ces fichiers manqueront.`) : null,
          h('li', { class: 'us-dim' }, 'Un skill donne des consignes à Claude dans tes sessions : lis-le en entier avant de l\'installer.')].filter(Boolean));
        f.ok.checked = false;
        f.preview.hidden = false;
        setMode('url');
      };
      skillDlg = h('dialog', { class: 'us-dialog us-wide', 'aria-label': 'Ajouter un skill' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const where = f.where.value;
          const body = { scope: where === '__perso' ? 'perso' : 'projet', project: where === '__perso' ? undefined : where, name: f.name.value.trim() };
          if (f.mode === 'tpl') Object.assign(body, { description: f.desc.value, body: f.steps.value });
          else { if (!f.got || !f.ok.checked) { f.err.textContent = 'Récupère le skill et lis-le avant de l\'installer.'; return; } body.text = f.got.text; }
          const r = await T.api('/api/skills/create', body);
          if (r && r.ok) { skillDlg.close(); skillUi.filter = 'all'; T.toast(`Skill créé : ${r.path}`); } else if (r) f.err.textContent = r.error || 'Création impossible.';
        } },
          h('h2', null, 'Ajouter un skill'),
          h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Comment' },
            f.tabTpl = h('button', { type: 'button', class: 'us-chip2', onclick: () => setMode('tpl') }, 'Partir d\'un modèle'),
            f.tabUrl = h('button', { type: 'button', class: 'us-chip2', onclick: () => setMode('url') }, 'Depuis GitHub')),
          h('label', null, 'Où le ranger', f.where = h('select', { class: 'us-select', name: 'skill-where' })),
          h('label', null, 'Nom (minuscules et tirets)', f.name = h('input', { maxlength: 64, name: 'skill-name', pattern: '[a-z0-9][a-z0-9\\-]*', required: true, placeholder: 'ex. lecture-logs-build', autocomplete: 'off' })),
          f.tpl = h('div', { class: 'us-dlgpart' },
            h('label', null, 'Quand Claude doit-il s\'en servir ?', f.desc = h('textarea', { name: 'skill-description', rows: 3, maxlength: 1024, placeholder: 'Utilise ce skill quand un build Unreal échoue : lis le log complet avant de corriger.' })),
            h('p', { class: 'us-dim' }, 'C\'est la description : Claude la lit à chaque session pour décider de charger le skill. Dis quand, avec les mots que tu emploies.'),
            h('label', null, 'Ce qu\'il doit faire (facultatif, sinon un plan à compléter)', f.steps = h('textarea', { name: 'skill-body', rows: 6, maxlength: 100000, placeholder: '1. Ouvre le log complet du build, sans le couper.\n2. Trouve la première erreur.\n3. Corrige-la, puis relance un seul build.' }))),
          f.url = h('div', { class: 'us-dlgpart' },
            h('label', null, 'Adresse du skill', h('span', { class: 'us-row' }, f.addr = h('input', { type: 'url', name: 'skill-url', placeholder: 'https://github.com/…/skills/mon-skill', autocomplete: 'off' }), f.fetchBtn = btn('Récupérer', fetchIt))),
            h('p', { class: 'us-dim' }, 'La page GitHub du dossier du skill ou de son SKILL.md. Rien n\'est installé avant que tu l\'aies lu.'),
            f.preview = h('div', { class: 'us-dlgpart', hidden: true },
              f.from = h('p', { class: 'us-dim us-path' }), f.notes = h('ul', { class: 'us-skissues' }),
              f.text = h('pre', { class: 'us-code us-skilltext' }),
              h('label', { class: 'us-check' }, f.ok = h('input', { type: 'checkbox', name: 'skill-read', onchange: () => setMode('url') }), 'J\'ai lu ce SKILL.md et je veux l\'installer'))),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => skillDlg.close()), f.submit = h('button', { type: 'submit', class: 'us-btn us-go' }, 'Créer le skill'))));
      skillDlg.f = f; f.setMode = setMode;
      document.body.append(skillDlg);
    }
    const f = skillDlg.f;
    f.where.replaceChildren(h('option', { value: '__perso' }, 'Perso : ~/.claude/skills (tous tes projets)'), ...L.projects.map(p => h('option', { value: p }, `${p} : .claude/skills (ce projet seulement)`)));
    f.name.value = ''; f.desc.value = ''; f.steps.value = ''; f.addr.value = ''; f.preview.hidden = true; f.got = null;
    f.setMode('tpl');
    skillDlg.showModal();
    f.name.focus();
  }

  let taskDlg = null;
  function taskDialog(task) {
    if (!taskDlg) {
      const f = {};
      taskDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Tâche' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const r = await T.api('/api/tasks/save', { id: taskDlg.dataset.id || undefined, title: f.title.value, text: f.text.value, prompt: f.prompt.value, readonly: f.ro.checked });
          if (r && r.ok) { taskDlg.close(); T.toast('Tâche enregistrée.'); } else if (r) f.err.textContent = r.error || 'Enregistrement impossible.';
        } },
          f.head = h('h2', null, 'Nouvelle tâche'),
          h('label', null, 'Titre', f.title = h('input', { maxlength: 80, required: true, placeholder: 'ex. Assets orphelins' })),
          h('label', null, 'En une ligne (facultatif)', f.text = h('input', { maxlength: 200, placeholder: 'ce que la tâche apporte' })),
          h('label', null, 'Consigne pour Claude Code', f.prompt = h('textarea', { rows: 10, maxlength: 8000, required: true, placeholder: 'Ce que l\'agent doit faire, étape par étape. {projet} est remplacé par le nom du projet, {date} par la date du jour.' })),
          h('label', { class: 'us-check' }, f.ro = h('input', { type: 'checkbox' }), 'Ne modifie pas le code : peut tourner en fond (lecture du projet, écriture dans Saved/Tour seulement)'),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => taskDlg.close()), h('button', { type: 'submit', class: 'us-btn us-go' }, 'Enregistrer'))));
      taskDlg.f = f;
      document.body.append(taskDlg);
    }
    const f = taskDlg.f;
    taskDlg.dataset.id = task && !task.builtin ? task.id : '';
    f.head.textContent = task && !task.builtin ? 'Modifier la tâche' : task ? `Copie de « ${task.title} »` : 'Nouvelle tâche';
    f.title.value = task ? (task.builtin ? `${task.title} (perso)` : task.title) : '';
    f.text.value = task ? task.text || '' : '';
    f.prompt.value = task ? task.prompt : '';
    f.ro.checked = !!(task && task.readonly);
    f.err.textContent = '';
    taskDlg.showModal();
    f.title.focus();
  }

  function promptText(t, proj) {
    const d = todayKey();
    const S = (M_() && M_().S) || {};
    return `Tache de la tour [${t.id}] : ${t.title}\n\n${t.prompt.replace(/\{projet\}/g, proj || 'en cours').replace(/\{date\}/g, d)}\n${S.taskSuivi ? `\n${S.taskSuivi}\n` : ''}`;
  }
  async function copyPrompt(t, proj) {
    try { await navigator.clipboard.writeText(promptText(t, proj)); T.toast('Consigne copiée : colle-la dans une session Claude Code ouverte sur le projet.'); }
    catch { T.toast('Copie impossible dans ce navigateur.'); }
  }
  async function launchTask(t, proj, background = false) {
    const r = await T.api('/api/tasks/launch', { id: t.id, project: proj, background });
    if (r && r.ok) { suiviOpen.clear(); T.toast(background ? `« ${t.title} » tourne en fond : suis-la ici, dans « Suivi des tâches ».` : `Claude Code s'ouvre dans une nouvelle fenêtre avec « ${t.title} ». Suis-la ici, dans « Suivi des tâches ».`); }
    // Sans la commande claude (Claude Code utilise depuis l'application de bureau), on copie la consigne.
    else if (r && (r.code === 'noclaude' || /Windows/.test(r.error || ''))) {
      try { await navigator.clipboard.writeText(promptText(t, proj)); T.toast(`Consigne copiée : colle-la dans une session Claude Code ouverte sur ${proj || 'le projet'}.`); }
      catch { T.toast(r.error); }
    } else if (r && r.error) T.toast(r.error);
  }

  // ---------- discuter avec une session (lib/discussion.js) ----------
  // La conversation est lue dans le journal de la session. Une session lancee dans la tour reprend a
  // chaque message ; une session ouverte dans sa fenetre se lit seulement (on lui ecrit la-bas).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const chatMode = (a) => !!(a && a.raw && a.raw.chat && a.raw.chat.mode === 'tour');
  const canChat = (a) => !!a && UUID.test(a.id) && (chatMode(a) || a.st === 'ended');
  // La discussion : toi, le chef (la session), ses missions aux agents, ce que les agents disent et font,
  // et leurs rapports. Les actions qui se suivent sont regroupees sur une ligne.
  function chatItems(msgs, a, M) {
    const team = (M.S.team || {})[a && a.project] || [];
    const who = (ag) => { const m = team.find(x => x.name.toLowerCase() === String(ag).toLowerCase()); return m ? `${ag} (${m.section})` : ag; };
    const chef = !a ? 'La session' : a.kind === 'chef' ? 'Le Chef' : (a.label || a.salle || a.name);
    const head = (txt, m) => h('small', { class: 'us-dim' }, txt, m.at ? ` · ${T.clock(m.at)}` : '');
    const long = (text) => {
      const [first, ...rest] = String(text).split('\n');
      return rest.join('\n').trim() ? h('details', null, h('summary', null, first), h('div', { class: 'us-pre' }, rest.join('\n').trim())) : h('div', { class: 'us-pre' }, first);
    };
    const out = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.kind === 'action') {
        const run = [m];
        while (msgs[i + 1] && msgs[i + 1].kind === 'action' && msgs[i + 1].who === m.who && msgs[i + 1].agent === m.agent) run.push(msgs[++i]);
        const shown = run.slice(-3).map(x => x.text);
        out.push(h('div', { class: `us-act us-act-${m.who}` }, h('b', null, m.who === 'chef' ? chef : who(m.agent)), ' ',
          run.length > 3 ? `${run.length} actions, dont ` : '', shown.join(' · ')));
        continue;
      }
      if (m.who === 'toi') out.push(h('div', { class: 'us-msg us-msg-toi' }, head('Toi', m), h('div', { class: 'us-pre' }, m.text)));
      else if (m.who === 'chef') out.push(h('div', { class: 'us-msg us-msg-chef' }, head(chef, m), h('div', { class: 'us-pre' }, m.text)));
      else if (m.kind === 'mission') out.push(h('div', { class: 'us-msg us-msg-mission' }, head(`Mission pour ${who(m.agent)}`, m), long(m.text)));
      else if (m.kind === 'rapport') out.push(h('div', { class: 'us-msg us-msg-rapport' }, head(`Rapport de ${who(m.agent)}`, m), long(m.text)));
      else out.push(h('div', { class: 'us-msg us-msg-agent' }, head(who(m.agent), m), h('div', { class: 'us-pre' }, m.text)));
    }
    return out;
  }

  // ---------- sujets du jeu (lib/sujets.js) ----------
  // Un sujet = une salle qui existe meme sans session, son carnet (ou on en est) et le tableau partage
  // ou les sujets se laissent des messages. Une session de sujet se lance a la demande et reprend le carnet.
  const forSujet = (z, e) => { const t = e.to.toLowerCase(); return t === z.title.toLowerCase() || /^(tous|toutes|all)$/.test(t); };
  const boardLine = (e) => h('li', null, h('span', { class: 'us-time' }, e.when ? e.when.slice(5).replace(/^(\d\d)-(\d\d)/, '$2/$1') : ''),
    h('span', null, h('b', null, `${e.from} → ${e.to}`), ' ', e.text));
  // Par defaut, la session d'un sujet ou d'une feature se lance dans la tour : tu lui parles dans sa discussion.
  async function sujetLaunch(M, z, window) {
    if (window) return launchTask({ id: z.id, title: z.title }, M.sujetsProject);
    const r = await T.api('/api/chat/start', { id: z.id, project: M.sujetsProject });
    if (r && r.ok) NAV().conv(r.sessionId);
    else if (r && r.error) T.toast(r.error);
  }
  // Les regles d'une session core ou feature (lib/regles.js) : pour chaque action, sans demander,
  // en demandant a ali, ou interdit. Elles s'appliquent a son prochain lancement ou message.
  const LEVELS = [['oui', 'Sans demander'], ['demander', 'Demander'], ['non', 'Interdit']];
  function rulesBlock(M, z) {
    const r = (M.regles || {})[z.id];
    if (!r || !(M.actions || []).length) return null;
    const set = async (action, level) => {
      const res = await T.api('/api/regles', { id: z.id, action, level });
      if (res && res.ok) T.toast('Règle changée : elle s\'applique au prochain message ou lancement de la session.');
      else if (res) T.toast(res.error || 'Règle refusée.');
    };
    return [h('div', { class: 'us-sub' }, 'Ses règles'),
      h('ul', { class: 'us-rules' }, M.actions.map(ac => h('li', null,
        h('span', null, h('b', null, ac.label), h('small', { class: 'us-dim' }, ac.hint)),
        h('span', { class: 'us-seg', role: 'group', 'aria-label': ac.label }, LEVELS.map(([lv, txt]) =>
          h('button', { type: 'button', class: `us-segbtn us-lv-${lv}`, 'aria-pressed': String(r[ac.id] === lv), ...(M.demo ? { disabled: true } : {}),
            onclick: () => { if (r[ac.id] !== lv) set(ac.id, lv); } }, txt)))))),
      h('p', { class: 'us-dim' }, 'Toujours permis : lire tout le projet et écrire dans Saved/Tour (carnet, tableau, rapports). « Demander » te pose la question dans la tour.')];
  }
  // Mise en place (lib/miseenplace.js) : un passage en fond et en lecture seule ou la session core fait le
  // tour de son sujet et remplit son carnet, pour preparer les prochaines taches. Un sujet a la fois.
  const usd = (x) => `${Number(x).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  function miseText(M, z) {
    const r = M.mise.runs[z.id];
    if (!r || r.status === 'none') return h('span', { class: 'us-dim' }, 'pas encore faite');
    if (r.status === 'queued') return `en file (${M.mise.queue.indexOf(z.id) + 1}e)`;
    if (r.status === 'running') return ['en cours depuis ', T.agoEl(r.at)];
    const spent = [r.tokens ? `${tok(r.tokens)} tokens` : '', r.cost != null ? usd(r.cost) : ''].filter(Boolean).join(', ');
    if (r.status === 'error') return h('span', { class: 'us-t-ko' }, `échouée : ${r.error || 'erreur'}`);
    return ['faite ', T.agoEl(r.endedAt), spent ? `, ${spent}` : '', r.capped ? h('span', { class: 'us-t-warn' }, ', arrêtée à sa limite') : ''];
  }
  async function miseStart(M, ids, budget) {
    const r = await T.api('/api/miseenplace', { ids, budget: budget || M.mise.budget });
    if (r && r.ok) T.toast(r.queued > 1 ? `${r.queued} sujets en file : ils passent un par un, en lecture seule.` : 'Mise en place lancée, en fond et en lecture seule : le carnet se remplit.');
    else if (r) T.toast(r.error || 'Mise en place impossible.');
  }
  function sujetBody(M, z, live) {
    if (z.kind === 'chef') return chefBody(M, z, live);
    const feat = z.kind === 'feature';
    const n = z.notes, mail = feat ? [] : (M.board || []).filter(e => forSujet(z, e)).slice(-4);
    const proj = encodeURIComponent(M.sujetsProject || '');
    const notes = feat ? `Saved/Tour/features/${z.id.slice(8)}.md` : `Saved/Tour/sujets/${z.id.slice(6)}.md`;
    return [
      live ? null : h('p', { class: 'us-dim' }, z.done ? 'Feature terminée : sa conversation est rangée.'
        : feat ? 'En sommeil : aucune session ne tourne. « Discuter » en lance une ici, qui lit son carnet et ceux des sujets touchés, puis te propose un plan.'
          : 'Session core en sommeil : elle garde la mémoire du sujet dans son carnet. « Discuter » en lance une ici, qui lit le carnet et le tableau, puis te demande quoi faire.'),
      feat ? h('div', { class: 'us-said' }, h('b', null, 'L\'idée : '), h('span', { class: 'us-pre' }, z.idea)) : z.text ? h('p', null, z.text) : null,
      rowsOf([
        feat && ['Sujets touchés', z.topics.length ? z.topics.join(', ') : h('span', { class: 'us-dim' }, 'aucun choisi')],
        ['Ses agents', z.agents.length ? z.agents.join(', ') : 'aucun attitré'],
        !feat && ['Mise en place', miseText(M, z)],
        z.reviewers && z.reviewers.length && ['Relecture', z.reviewers.join(', ')],
        [feat ? 'Son carnet' : 'Mémoire (carnet)', n ? ['mis à jour ', T.agoEl(n.at)] : h('span', { class: 'us-dim' }, `pas encore : la première session ${feat ? 'de la feature' : 'du sujet'} le crée`)],
      ]),
      n && n.where ? h('div', { class: 'us-said' }, h('b', null, 'Où on en est : '), h('span', { class: 'us-pre' }, n.where)) : null,
      n && n.next ? h('div', { class: 'us-said' }, h('b', null, 'Prochaines étapes : '), h('span', { class: 'us-pre' }, n.next)) : null,
      mail.length ? [h('div', { class: 'us-sub' }, 'Pour lui au tableau'), h('ul', { class: 'us-board' }, mail.map(boardLine))] : null,
      rulesBlock(M, z),
      h('div', { class: 'us-actions' },
        live || z.done ? null : btn('Discuter', () => sujetLaunch(M, z), 'us-go', M.demo || !M.sujetsProject ? { disabled: true } : { title: 'Lance sa session dans la tour : tu lui parles ici, sans fenêtre' }),
        live || z.done ? null : btn('Dans une fenêtre', () => sujetLaunch(M, z, true), '', M.demo || !M.sujetsProject ? { disabled: true } : { title: 'Ouvre Claude Code dans une fenêtre, dans le dossier du projet' }),
        btn('Lire le carnet', () => fileView(`Carnet : ${z.title}`, notes, `/api/sujets/file?project=${proj}&id=${encodeURIComponent(z.id)}`), '', M.demo || !n ? { disabled: true } : {}),
        feat ? null : btn('Écrire au tableau', () => boardDialog(M, z.title), '', M.demo ? { disabled: true } : {}),
        feat || live ? null : btn('Mise en place', () => miseStart(M, [z.id]), '', M.demo || !M.sujetsProject || ['queued', 'running'].includes((M.mise.runs[z.id] || {}).status) ? { disabled: true } : { title: `La session fait le tour du sujet en fond, en lecture seule, et remplit son carnet (limite ${usd(M.mise.budget)})` }),
        feat ? btn(z.done ? 'Reprendre la feature' : 'Terminer la feature', async () => {
          const r = await T.api('/api/features/done', { id: z.id, done: !z.done });
          if (r && r.ok && !z.done) { NAV().conv(null); T.toast(`« ${z.title} » est terminée : sa conversation est rangée (« Anciennes » la remontre).`); }
        }, z.done ? '' : 'us-danger', M.demo ? { disabled: true } : { title: 'L\'idée est en place : sa conversation est rangée, rien n\'est effacé' }) : null),
    ];
  }
  // ---------- le conseil (lib/conseil.js) ----------
  // Pour un vrai choix : cinq membres repondent chacun de leur cote, se relisent sans savoir qui a dit
  // quoi, puis le president tranche. Pour tout le reste (une confirmation, une question, un bug) : le chef.
  const conseilUi = { q: '', open: null, avis: false, busy: false };
  const MEMBER_ST = { attend: ['en attente', 'none'], reflechit: ['réfléchit', 'blue'], relit: ['relit les avis', 'blue'], fini: ['a répondu', 'ok'], erreur: ['erreur', 'ko'] };
  function verdictBlock(M, K, r, full) {
    const toChef = async () => {
      const res = await T.api('/api/conseil/chef', { id: r.id });
      if (res && res.ok) { T.toast('Décision confiée au chef.'); if (res.sessionId) NAV().conv(res.sessionId); }
      else if (res) T.toast(res.error || 'Impossible.');
    };
    return [
      r.decision ? h('p', { class: 'us-cs-decision' }, r.decision) : null,
      full ? h('div', { class: 'us-md us-cs-verdict' }, mdNodes(String(r.verdict || '').replace(/^\*\*D[ée]cision\s*:?\*\*.*\n*/i, ''))) : null,
      full && r.members ? [
        btn(conseilUi.avis ? 'Cacher les avis' : 'Lire les cinq avis', () => { conseilUi.avis = !conseilUi.avis; renderHud(); }, 'us-link'),
        conseilUi.avis ? h('div', { class: 'us-cs-avis' }, (K.members || []).filter(m => r.members[m.id] && r.members[m.id].avis).map(m => h('details', null, h('summary', null, h('b', null, m.name), h('span', { class: 'us-dim' }, ` · ${m.short}`)), h('div', { class: 'us-pre' }, r.members[m.id].avis)))) : null] : null,
      h('div', { class: 'us-actions' },
        btn(r.chef ? 'Confier à nouveau au chef' : 'Confier au chef', toChef, r.chef ? '' : 'us-go', M.demo ? { disabled: true } : { title: 'Le chef met la décision en œuvre : il vérifie, puis confie les changements aux sessions core ou à une feature' }),
        r.chef ? h('span', { class: 'us-dim' }, 'Confiée au chef ', T.agoEl(r.chef.at)) : null),
      h('small', { class: 'us-dim' }, [r.file ? `Écrit dans ${r.file}` : null, r.cost ? `${r.cost.toFixed(2)} $` : null, r.tokens ? `${tok(r.tokens)} tokens` : null].filter(Boolean).join(' · ')),
    ];
  }
  function conseilBody(M) {
    const K = conseilOf(M);
    if (!K) return [h('p', { class: 'us-dim' }, 'La tour prépare le conseil…')];
    const runs = K.runs || [], r = runs[0], live = isLive(r);
    const set = async (o) => { const res = await T.api('/api/conseil/reglages', o); if (res && !res.ok) T.toast(res.error || 'Impossible.'); };
    const ask = async () => {
      const q = conseilUi.q.trim();
      if (!q) { T.toast('Écris d\'abord ta question.'); return; }
      conseilUi.busy = true; renderHud();
      const res = await T.api('/api/conseil', { question: q, project: M.sujetsProject || '' });
      conseilUi.busy = false;
      if (res && res.ok) { conseilUi.q = ''; T.toast('Le conseil se réunit.'); } else if (res) T.toast(res.error || 'Impossible.');
      renderHud();
    };
    const off = M.demo || live || conseilUi.busy;
    const form = h('div', { class: 'us-cs-form' },
      h('textarea', { name: 'conseil-question', 'data-keep': 'conseilq', rows: 4, maxlength: 4000, value: conseilUi.q, 'aria-label': 'Ta question au conseil', ...(off ? { disabled: true } : {}),
        placeholder: 'Le choix à trancher, et ce qui compte pour toi. Ex. : lampe torche avec une batterie à recharger, ou lumière infinie qui attire les entités ?',
        oninput: (e) => { conseilUi.q = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(); } } }),
      h('div', { class: 'us-cs-opts' },
        h('label', { class: 'us-check' }, h('input', { type: 'checkbox', checked: !!K.cadrage, ...(M.demo ? { disabled: true } : {}), onchange: (e) => set({ cadrage: e.target.checked }) }), 'Lire le projet d\'abord'),
        h('label', { class: 'us-check' }, h('input', { type: 'checkbox', checked: !!K.revue, ...(M.demo ? { disabled: true } : {}), onchange: (e) => set({ revue: e.target.checked }) }), 'Relecture croisée'),
        h('label', { class: 'us-check' }, 'Modèle ', h('select', { class: 'us-select', name: 'conseil-model', 'aria-label': 'Modèle des membres', ...(M.demo ? { disabled: true } : {}), onchange: (e) => set({ model: e.target.value }) },
          (K.models || []).map(([id, label]) => h('option', { value: id, ...(id === K.model ? { selected: true } : {}) }, label))))),
      h('small', { class: 'us-dim' }, `${K.cadrage ? 'Si un projet est connecté, un cadrage lit d\'abord 3 de ses fichiers au plus ; puis ' : ''}${K.revue ? '11' : '6'} appels courts, sans outils ni contexte chargé.`),
      h('div', { class: 'us-actions' }, btn(conseilUi.busy ? 'Envoi…' : 'Demander au conseil', ask, 'us-go', off ? { disabled: true } : { title: 'Ctrl+Entrée' })));
    const progress = live ? [
      h('div', { class: 'us-sub' }, `En cours · ${K.steps[r.step] || r.step}`),
      h('p', { class: 'us-cs-q' }, r.question),
      r.framed && r.cadrage ? h('details', null, h('summary', null, 'La question cadrée'), h('div', { class: 'us-pre' }, r.framed)) : null,
      h('ul', { class: 'us-cs-members' }, (K.members || []).map(m => {
        const st = (r.members && r.members[m.id]) || { status: 'attend' }, [txt, dot] = MEMBER_ST[st.status] || MEMBER_ST.attend;
        return h('li', null, h('span', { class: `us-dot us-d-${dot}` }), h('b', null, m.name), h('span', { class: 'us-dim' }, ` ${txt}`));
      }), h('li', null, h('span', { class: `us-dot us-d-${r.step === 'president' ? 'blue' : 'none'}` }), h('b', null, 'Le Président'), h('span', { class: 'us-dim' }, r.step === 'president' ? ' tranche' : ' attend les avis'))),
      h('div', { class: 'us-actions' }, btn('Arrêter', async () => { const res = await T.api('/api/conseil/stop'); if (res && !res.ok) T.toast(res.error || 'Impossible.'); }, 'us-danger', M.demo ? { disabled: true } : {}),
        h('span', { class: 'us-dim' }, `${r.cost ? `${r.cost.toFixed(2)} $ pour l'instant · ` : ''}commencé `, T.agoEl(r.at)))] : null;
    const last = !live && r ? [
      h('div', { class: 'us-sub' }, r.step === 'fini' ? 'Dernier verdict' : r.step === 'erreur' ? 'Dernière question : erreur' : 'Dernière question : arrêtée'),
      h('p', { class: 'us-cs-q' }, r.question),
      r.step === 'fini' ? verdictBlock(M, K, r, true) : h('p', { class: r.step === 'erreur' ? 'us-t-ko' : 'us-dim' }, r.error || r.note || 'Arrêté avant le verdict.')] : null;
    const old = runs.slice(1).filter(x => x.step === 'fini');
    return [
      h('p', null, 'Pour un vrai choix. Cinq membres répondent chacun de leur côté, chacun avec sa façon de penser ; ils relisent ensuite les cinq réponses sans savoir qui a dit quoi ; le président tranche. Pour tout le reste (une confirmation, une question, un bug), demande au chef.'),
      progress, live ? null : form, r && r.note && live ? h('p', { class: 'us-dim' }, r.note) : null, last,
      old.length ? [h('div', { class: 'us-sub' }, 'Verdicts précédents'),
        h('ul', { class: 'us-tuto-list' }, old.map(x => h('li', { class: 'us-task' },
          h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(conseilUi.open === x.id), onclick: () => { conseilUi.open = conseilUi.open === x.id ? null : x.id; renderHud(); } },
            h('b', null, x.question.length > 90 ? x.question.slice(0, 89) + '…' : x.question), h('span', { class: 'us-dim us-scope' }, T.agoEl(x.at))),
          conseilUi.open === x.id ? verdictBlock(M, K, x, true) : x.decision ? h('small', { class: 'us-dim' }, x.decision) : null)))] : null,
      h('div', { class: 'us-sub' }, 'Les membres'),
      h('ul', { class: 'us-cs-members' }, (K.members || []).map(m => h('li', null, h('b', null, m.name), h('span', { class: 'us-dim' }, ` · ${m.short}`)))),
      h('small', { class: 'us-dim' }, 'Méthode du LLM Council de Karpathy, d\'après le skill llm-council d\'aiwithremy.'),
    ];
  }

  // ---------- le chef (lib/chef.js) ----------
  // Une session a qui ali confie toutes ses demandes : elle verifie en lisant, repond, et confie les
  // changements aux sessions core ou a une nouvelle feature. Ses envois s'affichent ici, avec ou ils en sont.
  function envoiItem(M, e) {
    const a = e.sessionId ? M.agents.find(x => x.id === e.sessionId) : null;
    const z = !a && e.to ? defOf(M, e.to) : null;
    const target = a ? a.id : z ? (z.session ? z.session.id : 'sujet:' + z.id) : '';
    const where = e.status === 'envoyé' ? (a ? `${sname(a)}, ${a.stText}` : 'transmis')
      : e.status === 'au tableau' ? 'au tableau : sa session tourne dans sa fenêtre'
        : e.status === 'proposé' ? 'attend ton accord' : e.status === 'ignoré' ? 'ignoré' : `erreur : ${e.error || 'inconnue'}`;
    const dot = e.status === 'proposé' ? 'warn' : e.status === 'erreur' ? 'ko' : e.status === 'ignoré' ? 'grey' : a ? dotFor(a.st) : 'ok';
    const decide = async (go) => {
      const r = await T.api('/api/chef/envoi', { id: e.id, go });
      if (r && r.ok) T.toast(go ? `Envoyé à ${e.toTitle || e.to}.` : 'Envoi ignoré.'); else if (r) T.toast(r.error || 'Impossible.');
    };
    return h('li', { class: 'us-envoi' },
      h('div', { class: 'us-envoi-head' }, h('span', { class: `us-dot us-d-${dot}` }), h('b', null, `→ ${e.toTitle || e.to || '?'}`), h('span', { class: 'us-dim' }, ` ${where}, `, T.agoEl(e.at))),
      e.text ? h('div', { class: 'us-pre us-envoi-text' }, e.text) : null,
      e.status === 'proposé' || target ? h('div', { class: 'us-actions' },
        e.status === 'proposé' ? [btn('Envoyer', () => decide(true), 'us-go', M.demo ? { disabled: true } : {}), btn('Ignorer', () => decide(false), '', M.demo ? { disabled: true } : {})] : null,
        target ? btn('Ouvrir la conversation', () => NAV().conv(target)) : null) : null);
  }
  function chefBody(M, z, live) {
    const E = z.envois || [], wait = E.filter(e => e.status === 'proposé').length;
    const can = !M.demo && !!M.sujetsProject;
    return [
      h('p', null, 'Confie-lui tout ce qui touche au jeu : une animation qui ne marche pas, des assets que tu viens d\'importer, une idée, un bug. Il vérifie ce qu\'il peut en lisant le projet et ses journaux, te répond, et confie les changements à la session core du sujet, ou à une nouvelle feature pour une idée neuve. Il ne modifie pas le jeu lui-même.'),
      live ? null : h('p', { class: 'us-dim' }, 'En sommeil : « Discuter » le lance ici. Il lit les carnets, le tableau et le suivi de ses envois, puis prend ta demande.'),
      live ? null : h('div', { class: 'us-actions' },
        btn('Discuter', () => sujetLaunch(M, z), 'us-go', can ? { title: 'Lance le chef dans la tour : tu lui parles ici, sans fenêtre' } : { disabled: true }),
        btn('Dans une fenêtre', () => sujetLaunch(M, z, true), '', can ? { title: 'Ouvre Claude Code dans une fenêtre, dans le dossier du projet' } : { disabled: true })),
      h('label', { class: 'us-check us-chef-ask' }, h('input', { type: 'checkbox', checked: !!z.ask, ...(M.demo ? { disabled: true } : {}),
        onchange: async (ev) => { const r = await T.call('/api/chef/ask', { ask: ev.target.checked }); if (r && r.ok) T.toast(r.ask ? 'Ses envois t\'attendent : tu les valides ici avant qu\'ils partent.' : 'Ses envois partent tout seuls vers les sessions.'); } }),
        'Me demander avant chaque envoi'),
      h('div', { class: 'us-sub' }, wait ? `Ses envois · ${wait} à valider` : 'Ses envois'),
      E.length ? h('ul', { class: 'us-envois' }, E.slice(0, 20).map(e => envoiItem(M, e)))
        : h('p', { class: 'us-dim' }, 'Rien de confié pour l\'instant. Chaque demande qu\'il confie s\'affiche ici : à quelle session, et où elle en est. Elle est aussi écrite au tableau.'),
      rulesBlock(M, z),
    ];
  }

  function sujetsPanel(M) {
    const close = btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer les sujets', title: 'Échap' });
    const zs = M.sujets || [];
    const proj = encodeURIComponent(M.sujetsProject || '');
    const open = (z) => { NAV().close(); NAV().conv(z.session ? z.session.id : 'sujet:' + z.id); };
    return h('section', { class: 'us-panel us-entity us-taches', 'aria-label': 'Sujets' },
      h('div', { class: 'us-ehead' }, h('h2', null, M.sujetsProject ? `Core : les sujets de ${M.sujetsProject}` : 'Core : les sujets'), close),
      h('div', { class: 'us-ebody' },
        zs.length ? h('p', null, 'Les sessions core, une par sujet du jeu. Elles ne tournent pas en permanence : chacune garde la mémoire de son sujet dans son carnet, et la suivante reprend là où elle s\'est arrêtée. Tu règles dans ses détails ce qu\'elle peut faire seule, ce qu\'elle te demande et ce qui lui est interdit. Les sujets se parlent par le tableau.')
          : h('p', null, 'Connecte ton projet Unreal : ses sujets viennent des sections de ses agents (.claude/agents).'),
        zs.length ? miseBar(M) : null,
        h('ul', { class: 'us-runs' }, zs.map(z => {
          const a = z.session, mail = (M.board || []).filter(e => forSujet(z, e)).length, mr = M.mise.runs[z.id];
          return h('li', null,
            h('button', { type: 'button', class: 'us-runbtn', onclick: () => open(z) },
              h('span', { class: `us-dot us-d-${a ? dotFor(a.st) : 'grey'}` }), h('b', null, z.title),
              h('span', { class: 'us-dim' }, ` ${a ? a.stText : 'en sommeil'}${z.notes ? '' : ', sans carnet'}${mail ? `, ${T.plural(mail, 'message', 'messages')}` : ''}${mr && mr.status === 'queued' ? ', en file' : mr && mr.status === 'running' ? ', mise en place en cours' : mr && mr.status === 'done' ? ', mis en place' : ''}`)),
            a ? btn('Discuter', () => NAV().conv(a.id)) : btn('Discuter', () => sujetLaunch(M, z), 'us-go', M.demo || !M.sujetsProject ? { disabled: true } : {}));
        })),
        h('div', { class: 'us-sub' }, 'Tableau'),
        (M.board || []).length ? h('ul', { class: 'us-board' }, M.board.slice(-12).reverse().map(boardLine)) : h('p', { class: 'us-dim' }, 'Vide pour l\'instant. Les sessions de sujet y écrivent ce que les autres doivent savoir.'),
        h('div', { class: 'us-actions' }, btn('Écrire au tableau', () => boardDialog(M, 'tous'), 'us-go', M.demo ? { disabled: true } : {}),
          btn('Lire tout le tableau', () => fileView('Tableau des sujets', 'Saved/Tour/tableau.md', `/api/sujets/file?project=${proj}&id=tableau`), '', M.demo || !(M.board || []).length ? { disabled: true } : {}))));
  }
  // « Tout mettre en place » : tous les sujets dans la file, avec la limite choisie par sujet ; ce qui a ete depense.
  function miseBar(M) {
    const R = M.mise, ids = (M.sujets || []).map(z => z.id), runs = ids.map(id => R.runs[id]).filter(Boolean);
    const done = runs.filter(r => r.status === 'done').length, cost = runs.reduce((n, r) => n + (r.cost || 0), 0), toks = runs.reduce((n, r) => n + (r.tokens || 0), 0);
    const busy = !!R.current || R.queue.length;
    const sel = h('select', { name: 'budget', 'aria-label': 'Limite par sujet', class: 'us-select', ...(M.demo ? { disabled: true } : {}) },
      (R.budgets.length ? R.budgets : [R.budget]).map(b => h('option', { value: b, selected: b === R.budget }, `${usd(b)} max par sujet`)));
    return [h('div', { class: 'us-sub' }, 'Mise en place'),
      h('p', { class: 'us-dim' }, 'Chaque session core fait le tour de son sujet (code, assets, tests, décisions) et remplit son carnet, pour préparer les prochaines tâches. En fond, en lecture seule, un sujet après l\'autre.'),
      h('p', null, `${done} sur ${ids.length} sujets mis en place${toks ? `, ${tok(toks)} tokens` : ''}${cost ? `, ${usd(cost)} dépensés` : ''}${busy ? ` · en cours : ${(M.sujets.find(z => z.id === R.current) || {}).title || '…'}${R.queue.length ? `, ${R.queue.length} en file` : ''}` : ''}.`),
      h('div', { class: 'us-actions' }, sel,
        btn('Tout mettre en place', () => miseStart(M, [], Number(sel.value)), 'us-go', M.demo || !M.sujetsProject ? { disabled: true } : {}),
        busy ? btn('Arrêter la file', async () => { const r = await T.api('/api/miseenplace/stop', {}); T.toast(r && r.ok !== false ? 'File arrêtée.' : (r && r.error) || 'La tour ne répond pas.'); }, 'us-danger', M.demo ? { disabled: true } : {}) : null)];
  }
  let boardDlg = null;
  function boardDialog(M, to) {
    if (!boardDlg) {
      const f = {};
      boardDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Écrire au tableau' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const r = await T.api('/api/sujets/post', { project: M_().sujetsProject, to: f.to.value, text: f.text.value });
          if (r && r.ok) { boardDlg.close(); T.toast('Message ajouté au tableau : la prochaine session du sujet le lira.'); } else if (r) f.err.textContent = r.error || 'Écriture impossible.';
        } },
          h('h2', null, 'Écrire au tableau'),
          h('label', null, 'Pour', f.to = h('select', { name: 'to' })),
          h('label', null, 'Message', f.text = h('textarea', { name: 'text', rows: 4, maxlength: 400, required: true, placeholder: 'ex. On garde la touche K pour le coup de pied.' })),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => boardDlg.close()), h('button', { type: 'submit', class: 'us-btn us-go' }, 'Ajouter'))));
      boardDlg.f = f;
      document.body.append(boardDlg);
    }
    const f = boardDlg.f;
    f.to.replaceChildren(h('option', { value: 'tous' }, 'Tous les sujets'), ...(M.sujets || []).map(z => h('option', { value: z.title, selected: z.title === to }, z.title)));
    f.text.value = ''; f.err.textContent = '';
    boardDlg.showModal();
    f.text.focus();
  }

  // ---------- features (lib/features.js) ----------
  // Une feature : une session pour mettre en place une nouvelle idee, dans son propre batiment. Elle se
  // cree ici (nom, idee, sujets touches), lit les carnets core de ces sujets et s'arrete une fois l'idee en place.
  function featuresPanel(M) {
    const close = btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer les features', title: 'Échap' });
    const fs = (M.features || []).filter(f => !f.done), done = (M.features || []).filter(f => f.done);
    const open = (z) => { NAV().close(); NAV().conv(z.session ? z.session.id : 'sujet:' + z.id); };
    const row = (z) => {
      const a = z.session;
      return h('li', null,
        h('button', { type: 'button', class: 'us-runbtn', onclick: () => open(z) },
          h('span', { class: `us-dot us-d-${a ? dotFor(a.st) : 'grey'}` }), h('b', null, z.title),
          h('span', { class: 'us-dim' }, ` ${z.done ? 'terminée' : a ? a.stText : 'en sommeil'}${z.topics.length ? `, touche ${z.topics.join(', ')}` : ''}`)),
        z.done ? null : a ? btn('Discuter', () => NAV().conv(a.id)) : btn('Discuter', () => sujetLaunch(M, z), 'us-go', M.demo || !M.sujetsProject ? { disabled: true } : {}));
    };
    return h('section', { class: 'us-panel us-entity us-taches', 'aria-label': 'Features' },
      h('div', { class: 'us-ehead' }, h('h2', null, 'Features : les nouvelles idées'), close),
      h('div', { class: 'us-ebody' },
        h('p', null, 'Une session feature met en place une nouvelle idée, à côté des sujets core. Elle lit la mémoire des sujets qu\'elle touche sans la réécrire, laisse au tableau ce qui change pour eux, et s\'arrête quand l\'idée est en place.'),
        h('div', { class: 'us-actions' }, btn('Nouvelle feature', () => featureDialog(M), 'us-go', M.demo || !M.sujetsProject ? { disabled: true, title: 'Connecte d\'abord ton projet' } : {})),
        fs.length ? h('ul', { class: 'us-runs' }, fs.map(row)) : h('p', { class: 'us-dim' }, 'Aucune feature en cours.'),
        done.length ? [h('div', { class: 'us-sub' }, 'Terminées'), h('ul', { class: 'us-runs' }, done.map(row))] : null));
  }
  let featDlg = null;
  function featureDialog(M) {
    if (!M.sujetsProject) { T.toast('Connecte d\'abord ton projet Unreal : une feature se lance dans son dossier.'); return; }
    if (!featDlg) {
      const f = {};
      featDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Nouvelle feature' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const sujets = [...f.topics.querySelectorAll('input:checked')].map(x => x.value);
          f.go.disabled = true;
          const r = await T.api('/api/features', { project: M_().sujetsProject, title: f.title.value, idea: f.idea.value, sujets });
          f.go.disabled = false;
          if (!r || !r.ok) { f.err.textContent = (r && r.error) || 'Création impossible.'; return; }
          featDlg.close();
          const z = { ...r.feature, kind: 'feature' };
          if (f.where.value === 'fenetre') return launchTask({ id: z.id, title: z.title }, M_().sujetsProject);
          sujetLaunch(M_(), z);
        } },
          h('h2', null, 'Nouvelle feature'),
          h('p', { class: 'us-dim' }, 'Une session pour mettre en place une idée. Elle lit d\'abord la mémoire des sujets touchés, puis te propose un plan avant de toucher au jeu.'),
          h('label', null, 'Nom', f.title = h('input', { name: 'title', maxlength: 60, required: true, placeholder: 'ex. Lampe torche' })),
          h('label', null, 'L\'idée', f.idea = h('textarea', { name: 'idea', rows: 5, maxlength: 2000, required: true, placeholder: 'ex. Le joueur trouve une lampe torche, l\'allume avec F, et sa pile se vide en 3 minutes.' })),
          h('fieldset', { class: 'us-topics' }, h('legend', null, 'Sujets touchés'), f.topics = h('div', { class: 'us-checks' })),
          h('label', null, 'Où la lancer', f.where = h('select', { name: 'where' }, h('option', { value: 'tour' }, 'Dans la tour (discussion)'), h('option', { value: 'fenetre' }, 'Dans une fenêtre Claude Code'))),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => featDlg.close()), f.go = h('button', { type: 'submit', class: 'us-btn us-go' }, 'Créer et lancer'))));
      featDlg.f = f;
      document.body.append(featDlg);
    }
    const f = featDlg.f;
    f.topics.replaceChildren(...(M.sujets || []).map(z => h('label', { class: 'us-check' }, h('input', { type: 'checkbox', name: 'sujet', value: z.id }), z.title)));
    f.title.value = ''; f.idea.value = ''; f.err.textContent = ''; f.where.value = 'tour';
    featDlg.showModal();
    f.title.focus();
  }

  function tachesPanel(M) {
    const tasks = M.S.tasks || [];
    const proj = M.projects[0] ? M.projects[0].name : '';
    const close = btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer les tâches', title: 'Échap' });
    const runs = M.agents.filter(a => a.task).sort((x, y) => y.task.at - x.task.at).slice(0, 6);
    // En demo, les dates sont decalees a l'ouverture : « aujourd'hui » est le dernier jour du journal.
    const day = M.demo ? M.agents.flatMap(a => Object.keys((a.usage && a.usage.days) || {})).sort().pop() || todayKey() : todayKey();
    const today = M.agents.map(a => ({ a, n: a.usage && a.usage.days ? a.usage.days[day] || 0 : 0 })).filter(x => x.n).sort((x, y) => y.n - x.n);
    const sum = today.reduce((s, x) => s + x.n, 0);
    const card = (t) => h('li', { class: 'us-task' },
      h('div', { class: 'us-tuto-head' }, h('b', null, t.title), t.builtin ? null : h('span', { class: 'us-dim' }, 'perso')),
      t.text ? h('p', { class: 'us-dim' }, t.text) : null,
      h('div', { class: 'us-actions' },
        btn('Lancer', () => launchTask(t, proj), 'us-go', M.demo || !proj ? { disabled: true } : { title: 'Ouvre Claude Code dans une fenêtre, dans le dossier du projet, avec cette consigne' }),
        t.readonly ? btn('En fond', () => launchTask(t, proj, true), '', M.demo || !proj ? { disabled: true } : { title: t.writesDocs ? 'Sans fenêtre : tu suis l\'agent dans la tour. Il lit le projet et n\'écrit que dans docs/ et Saved/Tour.' : 'Sans fenêtre : tu suis l\'agent dans la tour. Il lit le projet et écrit son rapport dans Saved/Tour, sans rien modifier d\'autre.' }) : null,
        btn('Copier la consigne', () => copyPrompt(t, proj)),
        t.builtin ? btn('Copier en perso', () => taskDialog(t), '', M.demo ? { disabled: true } : { title: 'Crée une tâche perso à partir de celle-ci' })
          : [btn('Modifier', () => taskDialog(t), '', M.demo ? { disabled: true } : {}),
            btn('Supprimer', () => { if (confirm(`Supprimer la tâche « ${t.title} » ?`)) T.call('/api/tasks/delete', { id: t.id }); }, 'us-danger', M.demo ? { disabled: true } : {})]));
    const open = (a) => { NAV().close(); NAV().conv(a.id); };
    return h('section', { class: 'us-panel us-entity us-taches', 'aria-label': 'Tâches' },
      h('div', { class: 'us-ehead' }, h('h2', null, proj ? `Tâches sur ${proj}` : 'Tâches'), close),
      h('div', { class: 'us-ebody' },
        h('p', null, proj ? `« Lancer » ouvre Claude Code dans une fenêtre, dans le dossier de ${proj} : tu lui réponds et valides ses modifications. « En fond » le fait tourner sans fenêtre pour les tâches qui ne touchent pas au code. Dans les deux cas, la tour suit la session et ses tokens.`
          : 'Connecte d\'abord ton projet Unreal (Réglages, en bas à droite) : les tâches se lancent dans son dossier.'),
        h('ul', { class: 'us-tuto-list' }, tasks.map(card)),
        btn('Nouvelle tâche', () => taskDialog(null), 'us-go', M.demo ? { disabled: true } : {}),
        h('div', { class: 'us-sub' }, 'Suivi des tâches'),
        runs.length ? h('ul', { class: 'us-runs' }, runs.map((a, i) => {
          // La plus recente est ouverte d'office ; un clic ouvre ou ferme les autres.
          const isOpen = suiviOpen.has(a.id) ? suiviOpen.get(a.id) : i === 0;
          return h('li', { class: isOpen ? 'on' : '' },
            h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(isOpen), onclick: () => { suiviOpen.set(a.id, !isOpen); renderHud(); } },
              h('span', { class: `us-dot us-d-${dotFor(a.st)}` }), h('b', null, a.task.title), h('span', { class: 'us-dim' }, isOpen ? ` ${sname(a)}` : ` ${sname(a)}, ${T.lower(suiviState(a).text)}`)),
            a.usage ? h('span', null, tok(a.usage.total)) : null,
            isOpen ? [suiviBlock(a), h('div', { class: 'us-actions' }, btn('Voir l\'agent', () => open(a)))] : null);
        }))
          : h('p', { class: 'us-dim' }, 'Aucune pour l\'instant. Lance une tâche : son suivi s\'affiche ici et se met à jour tout seul.'),
        h('div', { class: 'us-sub' }, 'Tokens aujourd\'hui'),
        sum ? [h('p', null, h('b', null, tok(sum)), ` pour ${T.plural(today.length, 'session', 'sessions')}`),
          h('ul', { class: 'us-tools' }, today.slice(0, 6).map(x => h('li', null, h('b', null, sname(x.a)), h('span', { class: 'us-dim' }, x.a.task ? x.a.task.title : x.a.role || x.a.where),
            h('i', { style: `width:${Math.max(3, Math.round(100 * x.n / today[0].n))}%` }), h('span', null, tok(x.n)))))]
          : h('p', { class: 'us-dim' }, 'Rien de compté aujourd\'hui. La tour lit les journaux de Claude Code à chaque action des agents.')));
  }

  // ---------- les demandes (lib/demandes.js) ----------
  // Tout ce qu'ali envoie depuis la tour (au conseil, au chef, a une session, une tache) : une carte au
  // tableau en haut de l'application des que ca part. Elle passe seule de colonne en colonne (a faire,
  // en cours, t'attend, fini). Ouverte : un resume, le suivi des agents et les commentaires.
  const demUi = { open: null, states: null, known: null, fresh: new Map() };
  const DEM_DOT = { envoyee: 'grey', 'en-cours': 'blue', attend: 'warn', test: 'test', fini: 'ok', erreur: 'ko', arretee: 'grey', repos: 'grey' };
  const DEM_RANK = { attend: 0, test: 1, 'en-cours': 1, envoyee: 1, fini: 2, erreur: 2, arretee: 3 };
  const DEM_CHIP = { attend: 'warn', test: 'test', 'en-cours': 'blue', envoyee: 'blue', fini: 'ok', erreur: 'ko' };
  const DEM_KIND = { conseil: 'Conseil', chef: 'Chef', discussion: 'Session', tache: 'Tâche', envoi: 'Envoi du Chef' };
  const demsOf = (M) => (M && M.S && M.S.demandes) || [];
  // Les features (lib/features.js) sont aussi des cartes : chacune regroupe les demandes qui en parlent
  // (le chef dit laquelle) et son historique retrouve sur le disque. Une demande rangee dans une feature
  // n'a plus sa propre carte : on la retrouve dans celle de la feature.
  const featsOf = (M) => (M && M.S && M.S.featureCards) || [];
  const isFeat = (id) => String(id || '').startsWith('f:');
  const boardItems = (M) => [...featsOf(M), ...demsOf(M).filter(x => !x.feature)];
  const demFinal = (x) => x.state === 'fini' || x.state === 'erreur' || x.state === 'arretee';
  const demSort = (a, b) => (DEM_RANK[a.state] - DEM_RANK[b.state]) || (b.at - a.at);
  const demFind = (M, id) => { if (isFeat(id)) return featsOf(M).find(x => x.id === id) || null; const walk = (l) => { for (const x of l) { if (x.id === id) return x; const k = walk(x.children || []); if (k) return k; } return null; }; return walk(demsOf(M)); };
  const dclip = (s, n) => { s = String(s || '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  // Ou en est une demande, en une ligne : l'etape, ce qui se passe, ou le resultat.
  const todoOf = (x) => (x.checks || []).filter(c => c.ok === null || c.ok === undefined);
  function demNow(x) {
    if (x.state === 'test') { const n = todoOf(x).length; return n ? `à tester par toi : ${n > 1 ? `${n} essais` : 'un essai'}` : 'un essai ne marche pas : dis-le à l\'agent'; }
    if (x.state === 'fini') return x.result && x.result.text ? x.result.text : 'fini';
    if (x.state === 'attend') return x.live || x.phase;
    if (demFinal(x)) return x.phase;
    return x.live ? `${x.phase} · ${x.live}` : x.phase;
  }
  const demSeen = (id) => isFeat(id) ? T.call('/api/features/vu', { id: id.slice(2) }) : T.call('/api/demandes/vu', id ? { id } : {});
  // ouvrir une carte finie, c'est l'avoir vue
  function openDem(id) {
    const M = M_(), x = demFind(M, id);
    demUi.open = id;
    if (x && (isFeat(id) || (demFinal(x) && !x.seenAt && !x.parent)) && M && !M.demo) demSeen(id);
    NAV().sheet('demande');
  }

  // Le tableau : quatre colonnes, une carte par demande d'ali (les envois du chef restent dans leur carte).
  const COLS = [
    ['afaire', 'À faire', (x) => x.state === 'envoyee' || x.state === 'repos'],
    ['encours', 'En cours', (x) => x.state === 'en-cours'],
    ['attend', 'T\'attend', (x) => x.state === 'attend'],
    ['test', 'À tester', (x) => x.state === 'test'],
    ['fini', 'Fini', demFinal],
  ];
  const FINI_MAX = 8;
  function boardCols(M) {
    const all = boardItems(M);
    return COLS.map(([id, title, pred]) => {
      let items = all.filter(pred).sort((a, b) => b.at - a.at);
      if (id === 'fini') {
        const unseen = items.filter(x => !x.seenAt && x.kind !== 'feature').sort((a, b) => b.doneAt - a.doneAt);
        const seen = items.filter(x => x.seenAt || x.kind === 'feature').sort((a, b) => b.doneAt - a.doneAt);
        items = [...unseen, ...seen.slice(0, Math.max(0, FINI_MAX - unseen.length))];
      }
      return { id, title, items };
    });
  }
  // Une carte qui vient d'arriver : le tableau s'ouvre et elle s'allume quelques secondes.
  function boardFresh(M) {
    const ids = boardItems(M).map(x => x.id);
    const now = Date.now();
    let spawned = false;
    if (demUi.known) for (const id of ids) if (!demUi.known.has(id)) { demUi.fresh.set(id, now); spawned = true; }
    demUi.known = new Set(ids);
    for (const [id, t] of demUi.fresh) if (now - t > 6000) demUi.fresh.delete(id);
    return spawned;
  }
  // Le pied d'une carte : ses essais a faire, ou ses derniers tests.
  function testFoot(x) {
    const todo = todoOf(x).length, ko = (x.checks || []).filter(c => c.ok === false).length;
    const runs = (x.runs || []).filter(r => r.kind === 'test'), lt = runs[runs.length - 1];
    if (x.running) return h('span', { class: 'ap-bc-tfoot' }, x.running.kind === 'test' ? 'tests en cours' : 'compile');
    if (todo) return h('span', { class: 'ap-bc-tfoot' }, T.plural(todo, 'essai à faire', 'essais à faire'));
    if (ko) return h('span', { class: 'ap-bc-tfoot ap-bc-ko' }, T.plural(ko, 'essai raté', 'essais ratés'));
    if (lt) return h('span', { class: lt.failed || !lt.ok ? 'ap-bc-ko' : '' }, lt.total ? `tests ${lt.total - lt.failed}/${lt.total}` : `tests : ${lt.summary}`);
    return null;
  }

  // Une feature au tableau : son nom, ce qui s'y passe, et ce qu'elle regroupe.
  function featCard(M, x) {
    const n = (x.demandes || []).length, p = (x.past || []).length, c = (x.comments || []).length;
    const fresh = x.at > (x.seenAt || 0) && x.state !== 'repos' && x.seenAt;
    return h('li', null, h('button', {
      type: 'button', class: `ap-bcard ap-bc-feature ap-bc-${x.state}${demUi.fresh.has(x.id) ? ' ap-bc-new' : ''}`,
      onclick: () => openDem(x.id), 'aria-label': `Feature ${x.title}, ${x.stateText}`,
    },
    h('span', { class: 'ap-bc-head' }, h('span', { class: `us-dot us-d-${DEM_DOT[x.state] || 'grey'}` }), h('b', null, x.title), h('small', { class: 'ap-bc-fbadge' }, 'Feature'),
      x.state === 'fini' ? h('time', null, T.clock(x.doneAt)) : T.forEl(x.at, 'time')),
    h('span', { class: 'ap-bc-now' }, dclip(x.live || (x.summary || [])[1] || x.text, 140)),
    h('span', { class: 'ap-bc-foot' },
      h('span', null, n ? T.plural(n, 'demande', 'demandes') : 'aucune demande'),
      p ? h('span', null, T.plural(p, 'trace d\'avant', 'traces d\'avant')) : null,
      c ? h('span', null, T.plural(c, 'commentaire', 'commentaires')) : null,
      testFoot(x),
      fresh ? h('span', { class: 'ap-bc-badge' }, 'du nouveau') : null)));
  }
  function boardCard(M, x) {
    if (x.kind === 'feature') return featCard(M, x);
    const kind = DEM_KIND[x.kind] && DEM_KIND[x.kind] !== x.to ? DEM_KIND[x.kind] : '';
    const kids = x.children || [], notes = x.notes || [];
    const unseen = demFinal(x) && !x.seenAt;
    return h('li', null, h('button', {
      type: 'button', class: `ap-bcard ap-bc-${x.state}${demUi.fresh.has(x.id) ? ' ap-bc-new' : ''}${unseen ? ' ap-bc-unseen' : ''}${x.seenAt ? ' ap-bc-seen' : ''}`,
      onclick: () => openDem(x.id), 'aria-label': `${x.to}, ${x.stateText} : ${dclip(x.text, 80)}`,
    },
    h('span', { class: 'ap-bc-head' }, h('span', { class: `us-dot us-d-${DEM_DOT[x.state]}` }), h('b', null, x.to), kind ? h('small', null, kind) : null,
      demFinal(x) ? h('time', null, T.clock(x.doneAt)) : T.forEl(x.at, 'time')),
    h('span', { class: 'ap-bc-text' }, dclip(x.text, 150)),
    h('span', { class: 'ap-bc-now' }, dclip(demNow(x), 120)),
    kids.length || notes.length || unseen || testFoot(x) ? h('span', { class: 'ap-bc-foot' },
      testFoot(x),
      kids.length ? h('span', null, `${T.plural(kids.length, 'envoi', 'envois')}${kids.some(k => k.state === 'attend') ? ', un t\'attend' : kids.some(k => !demFinal(k)) ? ', en cours' : ''}`) : null,
      notes.length ? h('span', null, T.plural(notes.length, 'commentaire', 'commentaires')) : null,
      unseen ? h('span', { class: 'ap-bc-badge' }, 'nouveau') : null) : null));
  }
  // open : le tableau deplie ; toggle() le replie ou le deplie.
  function boardNodes(M, open, toggle) {
    const cols = boardCols(M);
    const total = boardItems(M).length;
    const count = (c) => h('span', { class: `ap-bcount ap-bcount-${c.id}`, 'data-n': c.items.length },
      h('i', { class: `us-dot us-d-${{ afaire: 'grey', encours: 'blue', attend: 'warn', test: 'test', fini: 'ok' }[c.id]}` }), c.title, ' ', h('b', null, c.items.length));
    const unseen = cols.find(c => c.id === 'fini').items.filter(x => !x.seenAt && x.kind !== 'feature').length;
    const head = h('div', { class: 'ap-bhead' },
      h('button', { type: 'button', class: 'ap-btoggle', 'aria-expanded': total ? String(open) : null, 'aria-controls': total ? 'ap-bcols' : null, onclick: toggle, disabled: !total || null },
        h('b', null, 'Demandes'), total ? h('span', { class: 'ap-bcounts' }, cols.map(count)) : h('span', { class: 'ap-bempty' }, 'Ce que tu demandes au Chef, au Conseil ou à une session arrive ici, en carte.')),
      open && unseen ? btn('Tout vu', () => demSeen(''), 'ap-ballseen', M.demo ? { disabled: true } : { title: 'Les cartes finies perdent leur marque « nouveau »' }) : null);
    if (!open || !total) return [head];
    return [head, h('div', { class: 'ap-bcols', id: 'ap-bcols' }, cols.map(c => h('section', { class: `ap-bcol ap-bcol-${c.id}`, 'aria-label': c.title },
      h('h2', { class: 'ap-gtitle' }, h('span', null, c.title), h('small', null, c.items.length)),
      c.items.length ? h('ul', { class: 'ap-bitems' }, c.items.map(x => boardCard(M, x)))
        : h('p', { class: 'ap-bnone' }, { afaire: 'Rien en attente de départ.', encours: 'Personne ne travaille pour toi en ce moment.', attend: 'Rien ne t\'attend.', test: 'Rien à essayer pour l\'instant.', fini: 'Rien de fini pour l\'instant.' }[c.id]))))];
  }

  const mdPlain = (t) => String(t || '').replace(/\*\*|__|`/g, '').replace(/^[ \t]*#{1,6}[ \t]+/gm, '').trim();
  // Le suivi d'une carte, du plus ancien au plus recent : les etapes de la demande et de ses envois,
  // les reponses des agents, tes commentaires.
  function feedOf(x) {
    const items = [];
    const walk = (n, depth, parent) => {
      for (const [i, p] of (n.phases || []).entries()) {
        const text = depth && i === 0 ? `${parent.to} lui confie : « ${dclip(n.text, 200)} »` : p.text;
        items.push({ at: p.at, who: n.to, kind: 'step', text, sub: depth > 0 });
      }
      if (n.result && n.result.text && n.status === 'fini') items.push({ at: n.ownDoneAt || n.doneAt, who: n.to, kind: 'reply', label: n.ref && n.ref.conseil ? 'Décision' : 'Réponse', text: mdPlain(n.result.text), sub: depth > 0 });
      for (const c of n.notes || []) items.push(c.who === 'ali'
        ? { at: c.at, who: 'Toi', kind: 'mine', text: c.text, meta: c.to ? (c.pending ? `envoyé à ${c.to}, il répond dès qu'il a fini ce qu'il fait` : c.lost ? `envoyé à ${c.to}, la tour a redémarré avant sa réponse` : `envoyé à ${c.to}`) : 'note' }
        : { at: c.at, who: c.name, kind: c.error ? 'err' : 'reply', label: 'Réponse à ton commentaire', text: mdPlain(c.text) });
      for (const k of n.children || []) walk(k, depth + 1, n);
    };
    walk(x, 0, null);
    return items.map((it, i) => [it, i]).sort((a, b) => (a[0].at - b[0].at) || (a[1] - b[1])).map(([it]) => it);
  }

  // Les boutons d'une carte : repondre, valider, lire le rapport ou le verdict, arreter.
  function demActs(M, x) {
    const ag = x.ref && x.ref.session ? M.agents.find(a => a.id === x.ref.session) : null;
    const goAgent = () => { NAV().close(); NAV().conv(ag.id); };
    const acts = [];
    const feat = x.feature && featsOf(M).find(f => f.feature === x.feature);
    if (feat) acts.push(btn(`Feature : ${dclip(feat.title, 40)}`, () => openDem(feat.id), '', { title: 'Cette demande est rangée dans cette feature' }));
    const wait = x.state === 'attend' ? [x, ...(x.children || [])].find(k => k.status === 'attend') : null;
    if (wait && wait.kind === 'envoi' && wait.phase === 'attend ta validation') acts.push(btn('Valider chez le Chef', () => { NAV().close(); NAV().conv('chef'); }, 'us-go'));
    else if (x.status === 'attend' && ag) acts.push(btn('Répondre', goAgent, 'us-go'));
    if (x.ref && x.ref.conseil) acts.push(btn(x.status === 'fini' ? 'Lire le verdict' : 'Voir le conseil', () => { NAV().close(); NAV().conv('conseil'); }));
    const res = x.result || {};
    if (res.file && ag && ag.raw.task && !M.demo) acts.push(btn('Lire le rapport', () => fileView(x.to, res.file, `/api/tasks/file?session=${encodeURIComponent(ag.id)}&path=${encodeURIComponent(res.file)}`)));
    if (ag && x.status !== 'attend') acts.push(btn('Ouvrir la conversation', goAgent));
    if (!demFinal(x) && x.ref && x.ref.conseil && x.status !== 'fini') acts.push(btn('Arrêter', () => T.call('/api/conseil/stop'), 'us-danger', M.demo ? { disabled: true } : {}));
    else if (x.status === 'en-cours' && ag && ag.raw.chat && ag.raw.chat.busy) acts.push(btn('Arrêter', () => T.call('/api/chat/stop', { sessionId: ag.id }), 'us-danger', M.demo ? { disabled: true } : { title: 'Arrête ce que fait la session : elle garde son historique' }));
    return acts;
  }

  let commenting = false;
  async function demComment(M, x) {
    const box = document.querySelector('[data-keep="dem-comment"]');
    const text = box ? box.value.trim() : '';
    if (!text || commenting) return;
    if (M.demo) { T.toast('Mode démo : le commentaire part sur la vraie tour.'); return; }
    commenting = true;
    const r = await T.api('/api/demandes/commenter', { id: x.id, text });
    commenting = false;
    if (r && r.ok) { if (box) box.value = ''; T.toast(r.to ? `Envoyé à ${r.to}.` : 'Noté sur la carte.'); }
    else T.toast((r && r.error) || 'La tour ne répond pas.');
    renderHud();
  }

  // ---- la phase de test d'une carte : ce qu'ali essaie (et sur quel niveau), les tests lances, leur journal ----
  const mapsOf = (M, project) => { const inv = (M.S && M.S.inventories) || {}; const v = inv[project] || Object.values(inv)[0]; return v && Array.isArray(v.maps) ? v.maps : null; };
  // un niveau nomme par l'agent existe-t-il dans le projet ? (null : on ne sait pas)
  function mapKnown(M, project, name) {
    const maps = mapsOf(M, project);
    if (!maps || !name || !/^[A-Za-z]\w*$/.test(name)) return null;
    return maps.some(m => m.split('/').pop().toLowerCase() === name.toLowerCase());
  }
  let testing = false;
  async function sendTest(M, url, body) {
    if (M.demo) { T.toast('Mode démo : rien n\'est envoyé.'); return; }
    if (testing) return;
    const box = document.querySelector('[data-keep="dem-comment"]');
    const note = body.ok === false && box ? box.value.trim() : '';
    testing = true;
    const r = await T.api(url, { ...body, note });
    testing = false;
    if (r && r.ok) { if (note && box) box.value = ''; if (r.to) T.toast(`Envoyé à ${r.to}.`); else if (body.ok === false && body.check === undefined) T.toast(note ? 'Noté sur la carte.' : 'Écris ce qui ne va pas dans « Commenter » pour que l\'agent le reprenne.'); }
    else T.toast((r && r.error) || 'La tour ne répond pas.');
    renderHud();
  }
  const runLabel = (r) => r.kind === 'test' ? (r.verif ? 'Tests (vérification de la tour)' : 'Tests') : (r.verif ? 'Compilation (vérification de la tour)' : 'Compilation');
  function testBlock(M, x) {
    const runs = x.runs || [], checks = x.checks || [];
    if (!runs.length && !checks.length && !x.running) return null;
    const isF = x.kind === 'feature';
    const todo = checks.filter(c => c.ok === null || c.ok === undefined).length;
    const all = (ok) => sendTest(M, isF ? '/api/features/tester' : '/api/demandes/tester', { id: isF ? x.feature : x.id, ok });
    const one = (c, ok) => sendTest(M, '/api/demandes/tester', { id: c.id, check: c.i, ok: c.ok === ok ? null : ok });
    return [h('div', { class: 'us-sub' }, 'Tests'),
      checks.length ? h('div', { class: 'ap-tchecks' },
        h('b', null, todo ? `À tester par toi (${todo} sur ${checks.length})` : 'Tes essais'),
        h('ol', { class: 'ap-tlist' }, checks.map(c => {
          const known = mapKnown(M, x.project, c.niveau);
          return h('li', { class: `ap-tcheck${c.ok === true ? ' ap-t-ok' : c.ok === false ? ' ap-t-ko' : ''}` },
            h('span', { class: 'ap-tlevel' }, c.niveau ? [h('span', { class: 'ap-tmap' }, c.niveau), known === false ? h('small', { class: 'ap-tmiss' }, 'n\'existe pas encore') : null] : h('small', { class: 'us-dim' }, 'niveau non précisé')),
            h('span', { class: 'ap-tquoi' }, c.quoi, c.who && isF ? h('small', { class: 'us-dim' }, ` · ${c.who}`) : null),
            h('span', { class: 'ap-tbtns' },
              btn('Marche', () => one(c, true), 'ap-tyes', { 'aria-pressed': String(c.ok === true), disabled: M.demo || null }),
              btn('Ne marche pas', () => one(c, false), 'ap-tno', { 'aria-pressed': String(c.ok === false), disabled: M.demo || null, title: 'Écris ce qui ne va pas dans « Commenter » avant : ça part à l\'agent' })));
        })),
        todo || checks.some(c => c.ok === false) ? h('div', { class: 'us-actions' },
          todo ? btn('Tout marche', () => all(true), 'us-go', M.demo ? { disabled: true } : {}) : null,
          btn('Ça ne marche pas', () => all(false), 'us-danger', M.demo ? { disabled: true } : { title: 'Écris ce qui ne va pas dans « Commenter » avant : ça part à l\'agent' })) : null) : null,
      runs.length || x.running ? h('ol', { class: 'ap-truns' },
        runs.map(r => h('li', { class: `ap-trun ${r.ok ? 'ap-t-ok' : 'ap-t-ko'}` },
          h('span', { class: 'ap-f-meta' }, h('time', null, dayClock(r.at)), ' ', h('b', null, runLabel(r)), r.who ? ` · ${r.who}` : '', r.durationMs ? ` · ${T.dur ? T.dur(r.durationMs) : `${Math.round(r.durationMs / 1000)} s`}` : ''),
          h('span', { class: 'ap-trun-res' },
            h('span', { class: `ap-chip ap-c-${r.ok ? 'ok' : 'ko'}` }, r.kind === 'test' && r.total ? `${r.total - r.failed}/${r.total} verts` : r.ok ? (r.kind === 'test' ? 'verts' : 'compile') : 'échec'),
            r.failedNames.length ? h('span', { class: 'ap-trun-red' }, `rouge${r.failedNames.length > 1 ? 's' : ''} : ${r.failedNames.join(', ')}`) : !r.ok && r.errorLines[0] ? h('span', { class: 'ap-trun-red' }, dclip(r.errorLines[0], 160)) : null,
            r.hasLog && !M.demo ? btn('Voir le log', () => fileView(`${runLabel(r)}${r.who ? ` · ${r.who}` : ''}`, `${r.summary} · ${dayClock(r.at)}`, `/api/builds/log?id=${encodeURIComponent(r.id)}`), 'ap-tlog') : null))),
        x.running ? h('li', { class: 'ap-trun ap-t-now' }, h('span', { class: 'ap-f-meta' }, h('b', null, x.running.kind === 'test' ? 'Tests en cours' : 'Compilation en cours'), x.running.who ? ` · ${x.running.who}` : ''), h('span', { class: 'us-dim' }, x.running.command)) : null) : null];
  }

  // l'historique d'une feature tient sur plusieurs jours : la date avant l'heure, sauf aujourd'hui
  const dayClock = (t) => { if (!t) return ''; const d = new Date(t); return d.toDateString() === new Date().toDateString() ? T.clock(t) : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${T.clock(t)}`; };
  const PAST_SRC = { tableau: 'tableau partagé', envoi: 'envoi du Chef', conseil: 'verdict du conseil', rapport: 'rapport', carnet: 'carnet' };
  function featFeed(M, x) {
    const items = (x.past || []).map(p => ({ at: p.at, who: p.who || '?', kind: 'past', label: `${PAST_SRC[p.src] || p.src}${p.to ? ` → ${p.to}` : ''}`, text: p.text }));
    for (const id of x.demandes || []) {
      const d = demFind(M, id);
      if (!d) continue;
      items.push({ at: d.at, who: 'Toi', kind: 'ask', label: `demande à ${d.to}`, text: d.text, id });
      // les etapes de la demande elle-meme (envoyée, prise en charge, fini) chargent l'historique : sa carte les garde
      items.push(...feedOf(d).filter(it => !(it.kind === 'step' && !it.sub)));
    }
    for (const c of x.comments || []) items.push({ at: c.at, who: 'Toi', kind: 'mine', text: c.text, meta: c.to ? `envoyé à ${c.to}` : 'note' });
    return items.map((it, i) => [it, i]).sort((a, b) => (a[0].at - b[0].at) || (a[1] - b[1])).map(([it]) => it);
  }
  async function featComment(M, x) {
    const box = document.querySelector('[data-keep="dem-comment"]');
    const text = box ? box.value.trim() : '';
    if (!text || commenting) return;
    if (M.demo) { T.toast('Mode démo : le commentaire part sur la vraie tour.'); return; }
    commenting = true;
    const r = await T.api('/api/features/commenter', { id: x.feature, text });
    commenting = false;
    if (r && r.ok) { if (box) box.value = ''; T.toast(r.to ? `Envoyé à ${r.to}.` : 'Noté sur la feature.'); }
    else T.toast((r && r.error) || 'La tour ne répond pas.');
    renderHud();
  }
  // Une feature ouverte : son resume, ses demandes, et tout son historique (avant et depuis son suivi).
  function featurePanel(M, x) {
    const z = (M.features || []).find(f => f.id === x.feature);
    const feed = featFeed(M, x);
    const acts = [];
    if (z && !z.done) acts.push(z.session ? btn('Discuter', () => { NAV().close(); NAV().conv(z.session.id); }, 'us-go')
      : btn('Discuter', () => { NAV().close(); NAV().conv('sujet:' + z.id); }, 'us-go', { title: 'Ouvre la conversation de la feature : elle se réveille quand tu écris' }));
    acts.push(btn(x.state === 'fini' ? 'Reprendre' : 'Terminer', () => T.call('/api/features/done', { id: x.feature, done: x.state !== 'fini' }), x.state === 'fini' ? '' : 'us-ghost', M.demo ? { disabled: true } : { title: x.state === 'fini' ? 'La feature revient au tableau' : 'Elle passe dans Fini : rien n\'est effacé' }));
    const box = h('textarea', { class: 'ap-dd-input', name: 'commentaire', rows: 3, maxlength: 2000, 'data-keep': 'dem-comment', 'aria-label': 'Ton commentaire',
      placeholder: x.commentTo ? `Un commentaire pour ${x.commentTo}…` : 'Une note sur cette feature…', disabled: M.demo || null,
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); featComment(M, x); } } });
    const by = { Chef: 'le Chef', 'Tâche': 'ta tâche perso' }[x.by] || (x.by ? x.by : 'toi');
    return h('section', { class: 'us-panel us-entity ap-k-demande ap-k-feature', 'aria-label': `Feature : ${x.title}`, 'data-key': `demande:${x.id}` },
      h('div', { class: 'us-ehead' },
        h('h2', null, x.title, h('span', { class: `ap-chip ap-c-${DEM_CHIP[x.state] || 'grey'}` }, h('i', { class: `ap-dot ap-d-${DEM_DOT[x.state] || 'grey'}` }), x.stateText)),
        btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer la feature', title: 'Échap' })),
      h('div', { class: 'us-ebody' },
        h('div', { class: 'ap-dd-ask' }, h('small', null, `Feature · suivie depuis `, T.agoEl(x.createdAt), `, créée par ${by}`), h('p', null, x.text)),
        h('div', { class: `ap-dd-sum ap-dd-sum-${x.state}` }, h('b', null, 'Résumé'), h('ul', null, (x.summary || []).map(l => h('li', null, l)))),
        x.mots && x.mots.length ? h('p', { class: 'us-dim ap-dd-mots' }, `Mots qui la retrouvent : ${x.mots.join(', ')}`) : null,
        h('div', { class: 'us-actions' }, acts),
        (x.demandes || []).length ? [h('div', { class: 'us-sub' }, 'Ses demandes'),
          h('ul', { class: 'ap-dd-dems' }, x.demandes.map(id => demFind(M, id)).filter(Boolean).map(d => h('li', null,
            h('button', { type: 'button', class: 'us-runbtn', onclick: () => openDem(d.id) },
              h('span', { class: `us-dot us-d-${DEM_DOT[d.state]}` }), h('b', null, d.to), h('span', { class: 'us-dim' }, ` ${d.stateText} · ${dclip(d.text, 90)}`)))))] : null,
        testBlock(M, x),
        h('div', { class: 'us-sub' }, 'Historique'),
        feed.length ? h('ol', { class: 'ap-feed' },
          feed.map(it => h('li', { class: `ap-f-${it.kind === 'past' ? 'step' : it.kind === 'ask' ? 'mine' : it.kind}${it.sub ? ' ap-f-sub' : ''}${it.kind === 'past' ? ' ap-f-past' : ''}` },
            h('span', { class: 'ap-f-meta' }, h('time', null, dayClock(it.at)), ' ', h('b', null, it.who), it.label ? ` · ${it.label}` : '', it.meta ? h('small', null, ` · ${it.meta}`) : null),
            h('span', { class: 'ap-f-text' }, it.text))),
          x.live ? h('li', { class: 'ap-f-now' }, h('span', { class: 'ap-f-meta' }, h('b', null, 'Maintenant')), h('span', { class: 'ap-f-text' }, x.live)) : null)
          : h('p', { class: 'us-dim' }, 'Rien encore : ce que tu demandes au Chef sur cette feature arrivera ici.'),
        h('div', { class: 'us-sub' }, 'Commenter'),
        h('div', { class: 'ap-dd-comment' }, box,
          h('div', { class: 'ap-dd-cfoot' },
            h('small', { class: 'us-dim' }, M.demo ? 'Démo : rien n\'est envoyé.' : x.commentTo ? `Part à ${x.commentTo}, qui travaille dessus : sa réponse s'affiche dans l'historique.` : 'Personne n\'y travaille en ce moment : ton commentaire reste une note sur la feature. Le Chef la lit avec les demandes.'),
            btn(x.commentTo ? 'Envoyer' : 'Noter', () => featComment(M, x), 'us-go', M.demo ? { disabled: true } : { title: 'Ctrl+Entrée' })))));
  }

  // La carte ouverte, dans le volet.
  function demandePanel(M) {
    const x = demUi.open && demFind(M, demUi.open);
    if (!x) return null;
    if (x.kind === 'feature') return featurePanel(M, x);
    const acts = demActs(M, x);
    const res = x.result || {};
    const feed = feedOf(x);
    const box = h('textarea', { class: 'ap-dd-input', name: 'commentaire', rows: 3, maxlength: 2000, 'data-keep': 'dem-comment', 'aria-label': 'Ton commentaire',
      placeholder: x.commentTo ? `Un commentaire pour ${x.commentTo}…` : 'Une note sur cette demande…', disabled: M.demo || null,
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); demComment(M, x); } } });
    return h('section', { class: 'us-panel us-entity ap-k-demande', 'aria-label': `Demande : ${x.to}`, 'data-key': `demande:${x.id}` },
      h('div', { class: 'us-ehead' },
        h('h2', null, x.to, h('span', { class: `ap-chip ap-c-${DEM_CHIP[x.state] || 'grey'}` }, h('i', { class: `ap-dot ap-d-${DEM_DOT[x.state]}` }), x.stateText)),
        btn('Fermer', () => NAV().close(), 'us-x', { 'aria-label': 'Fermer la demande', title: 'Échap' })),
      h('div', { class: 'us-ebody' },
        h('div', { class: 'ap-dd-ask' }, h('small', null, `${DEM_KIND[x.kind] || 'Demande'} · envoyée `, T.agoEl(x.at)), h('p', null, x.text)),
        h('div', { class: `ap-dd-sum ap-dd-sum-${x.state}` }, h('b', null, 'Résumé'), h('ul', null, (x.summary || [demNow(x)]).map(l => h('li', null, l)))),
        res.questions && res.questions.length ? [h('b', null, 'Ses questions pour toi'), h('ul', { class: 'us-suivi-list' }, res.questions.map(q => h('li', null, q)))] : null,
        res.file ? h('p', { class: 'us-dim us-path' }, res.file) : null,
        acts.length ? h('div', { class: 'us-actions' }, acts) : null,
        testBlock(M, x),
        h('div', { class: 'us-sub' }, 'Suivi'),
        h('ol', { class: 'ap-feed' },
          feed.map(it => h('li', { class: `ap-f-${it.kind}${it.sub ? ' ap-f-sub' : ''}` },
            h('span', { class: 'ap-f-meta' }, h('time', null, T.clock(it.at)), ' ', h('b', null, it.who), it.label ? ` · ${it.label}` : '', it.meta ? h('small', null, ` · ${it.meta}`) : null),
            h('span', { class: 'ap-f-text' }, it.text))),
          !demFinal(x) ? h('li', { class: 'ap-f-now' }, h('span', { class: 'ap-f-meta' }, h('b', null, 'Maintenant')), h('span', { class: 'ap-f-text' }, demNow(x))) : null),
        h('div', { class: 'us-sub' }, 'Commenter'),
        h('div', { class: 'ap-dd-comment' }, box,
          h('div', { class: 'ap-dd-cfoot' },
            h('small', { class: 'us-dim' }, M.demo ? 'Démo : rien n\'est envoyé.' : x.commentTo ? `Part à ${x.commentTo}, qui travaille dessus : sa réponse s'affiche dans le suivi.` : `${demFinal(x) ? 'Plus aucun agent dessus' : 'Personne ne lit de message en cours de route ici'} : ton commentaire reste une note sur la carte. Le Chef la lit avec les demandes.`),
            btn(x.commentTo ? 'Envoyer' : 'Noter', () => demComment(M, x), 'us-go', M.demo ? { disabled: true } : { title: 'Ctrl+Entrée' })))));
  }

  // Une demande qui finit pendant qu'ali regarde ailleurs : un mot en bas de l'ecran.
  function demNotice(M) {
    const now = new Map(demsOf(M).map(x => [x.id, x.state]));
    if (demUi.states) for (const x of demsOf(M)) {
      const was = demUi.states.get(x.id);
      if (was && was !== x.state && (demFinal(x) || x.state === 'attend')) T.toast(x.state === 'attend' ? `${x.to} attend ta réponse.` : `${x.to} : ${x.stateText}.`);
    }
    demUi.states = now;
  }

  // ---------- la session : ce que montrait sa fiche, pour le volet « Détails » d'une conversation ----------
  function sujetOfId(M, id) {
    if (!String(id || '').startsWith('sujet:')) return null;
    return defOf(M, String(id).slice(6));
  }
  function defOf(M, id) {
    return [...(M.sujets || []), ...(M.features || []), ...(M.chef ? [M.chef] : [])].find(z => z.id === id) || null;
  }
  function agentDetails(M, a) {
    return [
      rowsOf([
        a.project || a.where ? ['Projet', a.project || a.where] : null,
        a.prompt && ['Demande', a.prompt],
        a.tool && ['Dernière action', [h('b', null, a.tool.name), ' ', a.tool.summary, ', ', T.agoEl(a.tool.at)]],
        a.roomName && ['Domaine touché', a.roomName],
        a.subs && ['Sous-agents', `${a.subs} : ${[...new Set(a.subList.map(x => (x.section ? `${x.type} (${x.section})` : x.type)))].join(', ')}`],
        a.holds ? ['Forge', 'compile en ce moment'] : a.queuePos ? ['Forge', `${a.queuePos}e dans la file`] : null,
        a.lastBuild && ['Compilation', resultTxt(a.lastBuild)],
        a.lastTest && ['Tests', resultTxt(a.lastTest)],
        a.docs && ['Doc UE', h('span', { class: a.docs.tone === 'warn' ? 'us-t-warn' : a.docs.tone === 'ok' ? 'us-t-ok' : 'us-dim' }, a.docs.text)],
      ]),
      a.task && a.kind !== 'chef' ? [h('div', { class: 'us-sub' }, `Suivi : ${a.task.title}`), suiviBlock(a)] : null,
      a.kind === 'chef' && M.chef ? [h('div', { class: 'us-sub' }, 'Le chef'), chefBody(M, M.chef, a)] : null,
      a.sujet && a.kind !== 'chef' && defOf(M, a.sujet) ? [h('div', { class: 'us-sub' }, a.kind === 'feature' ? 'Sa feature' : 'Son sujet (core)'), sujetBody(M, defOf(M, a.sujet), a)] : null,
      usageBlock(a),
      a.old ? h('p', { class: 'us-dim' }, a.hidden ? 'Rangée : elle n\'apparaît qu\'avec les anciennes sessions.' : 'Ancienne session : elle n\'apparaît qu\'avec les anciennes sessions.') : null,
      h('div', { class: 'us-actions' },
        btn('Renommer', () => renameDialog(a), '', M.demo ? { disabled: true } : {}),
        a.hidden ? btn('Remettre dans la liste', () => T.act.hide(a.id, false), '', M.demo ? { disabled: true } : {})
          : btn('Ranger', () => { T.act.hide(a.id, true); NAV().conv(null); }, '', M.demo ? { disabled: true } : { title: 'Elle quitte la liste, rien n\'est effacé : « Anciennes » la remontre' }),
        a.st === 'ended' || a.st === 'silent' ? btn('Retirer', () => { T.act.forget(a.id); NAV().conv(null); }, 'us-danger') : null),
    ];
  }

  // ---------- la forge, les builds, la version ----------
  function forgeBody(M) {
    const L = M.lock;
    const ok = M.builds.filter(b => b.ok), ko = M.builds.filter(b => !b.ok);
    return [
      h('p', { class: 'us-dim' }, 'Un seul build, test ou package Unreal à la fois sur le PC : les autres attendent leur tour dans la file.'),
      L ? [h('p', null, h('b', null, `${L.kindText} de ${L.agent ? sname(L.agent) : L.label}`), L.target ? ` (${L.target})` : '', ', depuis ', T.forEl(L.since)),
        h('code', { class: 'us-code' }, L.command), h('div', { class: 'us-actions' }, btn('Libérer la forge', T.act.release, 'us-danger', { title: 'Si le build est bloqué' }))]
        : h('p', { class: 'us-t-ok' }, 'Libre : le prochain build passe tout de suite.'),
      M.queue.length ? [h('div', { class: 'us-sub' }, 'Dans la file'), h('ol', { class: 'us-list' }, M.queue.map(q => h('li', null, h('b', null, q.agent ? sname(q.agent) : q.label), ` : ${T.lower(q.kindText)}, attend depuis `, T.forEl(q.since))))] : null,
      M.chantiers.length ? [h('div', { class: 'us-sub' }, 'Zones réservées par les agents'), h('ul', { class: 'us-list' }, M.chantiers.map(x => h('li', null, h('b', null, x.file), ` ${x.text} `, h('span', { class: 'us-dim' }, T.agoEl(x.mtime)))))] : null,
      h('div', { class: 'us-sub' }, `Échecs récents (${ko.length})`),
      ko.length ? buildList(ko) : h('p', { class: 'us-dim' }, 'Aucun échec récent.'),
      h('div', { class: 'us-sub' }, `Réussis récents (${ok.length})`),
      ok.length ? buildList(ok) : h('p', { class: 'us-dim' }, 'Aucun build réussi pour l\'instant.'),
    ];
  }
  function versionBody(M) {
    const c = M.campaign;
    if (!c) return [h('p', null, 'Une version, c\'est une liste de features à prouver (des tests qui passent, une compilation, ou ton essai en jeu), puis une épreuve finale : le package.'), h('div', { class: 'us-actions' }, btn('Préparer une version', T.act.openBuilder, 'us-go'))];
    if (c.won) return [h('p', { class: 'us-t-ok' }, h('b', null, `${c.name} est validée.`)), wonRows(c), h('div', { class: 'us-actions' }, btn('Ranger', T.act.archive), btn('Préparer la suivante', T.act.next, 'us-go'))];
    return [
      h('div', { class: 'us-bar' }, h('i', { style: `width:${c.pct}%` })),
      h('p', { class: 'us-dim' }, `${c.proven} sur ${c.total} features prouvées.`),
      c.next ? h('p', { class: `us-next us-t-${c.next.tone}` }, c.next.text) : null,
      featureList(c),
      h('div', { class: 'us-actions' }, btn('Abandonner la version', T.act.abandon, 'us-danger')),
    ];
  }

  window.Fiches = {
    btn, dotFor, rowsOf, tok, ctxBar, askBox, suiviState, chatItems, chatMode, canChat, UUID,
    agentDetails, sujetBody, chefBody, conseilBody, conseilOf, isLive, sujetOfId, defOf, sujetLaunch,
    forgeBody, versionBody, skillsBody, rosterBody, docsBody, unrealBody, gitBody, svBody,
    equipePanel, sujetsPanel, featuresPanel, tachesPanel, demandePanel, boardNodes, boardFresh, tutoPanel,
    featureDialog, taskDialog, launchTask, boardDialog,
    demsOf, demFinal, demNow, demSort, demSeen, demNotice, openDem, DEM_DOT,
    docDebts, gitOf, repoTone, svOf, svTone, svCurrent, svAlert, gitAlert, prsOf,
  };
})();
