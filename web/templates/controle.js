'use strict';
// Template « Tour de contrôle » : la tour d'Alkatrazz vue comme une salle de contrôle aérien.
// Chaque agent est une bande de vol en papier rangée dans une colonne (à toi, en vol, au sol),
// la forge est la piste (un seul avion à la fois, les autres au point d'arrêt), la version à
// sortir est un plan de vol dont les features sont les points de passage.

(function () {
  const T = window.Tower, h = T.h;

  // Horloge de la salle : un seul minuteur pour toute la vie de la page.
  const pad = (n) => String(n).padStart(2, '0');
  function tickClock() {
    const d = new Date();
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    document.querySelectorAll('.ct-clock-hm').forEach(e => { if (e.textContent !== t) e.textContent = t; });
    document.querySelectorAll('.ct-clock-s').forEach(e => { e.textContent = pad(d.getSeconds()); });
  }
  setInterval(tickClock, 1000);

  const TOOL = { Edit: 'Modifie', MultiEdit: 'Modifie', Write: 'Écrit', Read: 'Lit', Grep: 'Cherche', Glob: 'Cherche', Bash: 'Lance', PowerShell: 'Lance', WebFetch: 'Consulte', WebSearch: 'Cherche sur le web', Task: 'Délègue', Agent: 'Délègue' };
  const BAND = { waiting: 'amber', idle: 'amber', working: 'blue', ready: 'green', silent: 'grey', ended: 'grey' };

  // ---------- en-tête ----------
  function header(M) {
    const e = M.editor;
    const live = M.demo ? ['demo', 'Démo'] : M.connected ? ['on', 'En direct'] : ['off', 'Tour injoignable'];
    let ed;
    if (e.plugin) {
      ed = [
        h('span', { class: 'ct-ed-main' }, h('b', null, e.map || 'aucune map'), ' ouverte'),
        h('span', { class: e.pie ? 'ct-ed-on' : 'ct-ed-q' }, e.pie ? 'partie en cours' : 'pas de partie'),
        e.liveCoding.enabled ? h('span', { class: e.liveCoding.compiling ? 'ct-ed-on' : 'ct-ed-q' }, e.liveCoding.compiling ? 'Live Coding compile' : 'Live Coding actif') : null,
        e.dirty ? h('span', { class: 'ct-ed-warn', title: e.dirtyNames.join(', ') }, T.plural(e.dirty, 'asset non sauvegardé', 'assets non sauvegardés')) : h('span', { class: 'ct-ed-q' }, 'tout est sauvegardé'),
      ];
    } else ed = [h('span', { class: 'ct-ed-main' }, e.known ? `Éditeur ${e.text}` : 'État de l\'éditeur inconnu')];
    const d = new Date();
    return h('header', { class: 'ct-head' },
      h('div', { class: 'ct-brand' },
        h('span', { class: 'ct-logo', 'aria-hidden': 'true' }),
        h('div', null, h('b', null, 'Alkatrazz Tower'), h('span', { class: `ct-live ct-live-${live[0]}` }, live[1]))),
      h('div', { class: 'ct-ed' }, h('span', { class: 'ct-ed-label' }, 'Unreal', e.plugin && e.project ? ` ${e.project}` : ''), h('div', { class: 'ct-ed-bits' }, ed)),
      h('div', { class: 'ct-clock', role: 'timer', 'aria-label': 'Heure locale' },
        h('span', { class: 'ct-clock-hm' }, `${pad(d.getHours())}:${pad(d.getMinutes())}`),
        h('span', { class: 'ct-clock-s' }, pad(d.getSeconds())),
        h('span', { class: 'ct-clock-d' }, d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))),
      h('div', { class: 'ct-switch' }, T.switcher()));
  }

  // ---------- bandes de vol ----------
  function doing(a, M) {
    if (a.holds) return [h('b', null, 'Sur la piste'), ` : ${T.lower(M.lock.kindText)}${M.lock.target ? ' ' + M.lock.target : ''}`];
    if (a.queuePos) { const q = M.queue[a.queuePos - 1]; return [h('b', null, `Attend la piste, n° ${a.queuePos}`), q ? ` : ${T.lower(q.kindText)}` : '']; }
    if (a.st === 'working' && a.tool) return [h('b', null, TOOL[a.tool.name] || a.tool.name), ' ', h('span', { class: 'ct-path' }, a.tool.summary || '')];
    if (a.st === 'working') return [h('b', null, 'Réfléchit')];
    return [h('b', null, a.stText.charAt(0).toUpperCase() + a.stText.slice(1))];
  }

  function strip(a, M) {
    const band = BAND[a.st] || 'grey';
    const timeCell = a.st === 'waiting' || a.st === 'idle'
      ? [h('span', { class: 'ct-cell-k' }, 'depuis'), T.forEl(a.lastSeen, 'span', { class: 'ct-big' })]
      : [h('span', { class: 'ct-cell-k' }, 'vu'), T.agoEl(a.lastSeen, 'span', { class: 'ct-mid' })];
    const facts = [];
    if (a.lastBuild) facts.push(h('span', null, `${T.KIND[a.lastBuild.kind] || 'Compilation'} `, h('b', { class: a.lastBuild.ok ? 'ct-pok' : 'ct-pko' }, a.lastBuild.ok ? 'réussie' : 'en échec'), ' ', T.agoEl(a.lastBuild.endedAt)));
    if (a.lastTest) facts.push(h('span', null, 'Tests ', h('b', { class: a.lastTest.ok ? 'ct-pok' : 'ct-pko' }, a.lastTest.summary || (a.lastTest.ok ? 'passent' : 'échouent')), ' ', T.agoEl(a.lastTest.endedAt)));
    if (a.subs) facts.push(h('span', null, T.plural(a.subs, 'sous-agent', 'sous-agents')));
    if (a.docs) facts.push(h('span', { class: `ct-doc ct-doc-${a.docs.tone}`, title: a.docs.detail || '' }, a.docs.text.charAt(0).toUpperCase() + a.docs.text.slice(1)));
    return h('article', { class: `ct-strip ct-b-${band} ct-st-${a.st}`, 'aria-label': `${a.name}, ${a.stText}` },
      h('div', { class: 'ct-strip-top' },
        h('button', { class: 'ct-av', onclick: () => T.act.openChar(a.id), title: `Personnaliser ${a.name}` }, T.avatar(a.look, a.st, 52)),
        h('div', { class: 'ct-id' },
          h('span', { class: 'ct-call' }, a.name),
          h('span', { class: 'ct-role' }, [a.role, a.roomName ? `dans ${T.lower(a.roomName)}` : ''].filter(Boolean).join(', '))),
        h('div', { class: 'ct-cell ct-cell-st' }, h('span', { class: 'ct-cell-k' }, 'statut'), h('span', { class: 'ct-stword' }, a.stText)),
        h('div', { class: 'ct-cell ct-cell-t' }, timeCell)),
      a.st === 'waiting' || a.st === 'idle' ? null : h('div', { class: 'ct-row ct-doing' }, doing(a, M)),
      a.ask ? h('div', { class: 'ct-row ct-ask' }, h('span', { class: 'ct-cell-k' }, 'Sa question'), h('p', null, a.ask), h('span', { class: 'ct-hint' }, 'Réponds dans sa session Claude Code.')) : null,
      a.said ? h('div', { class: 'ct-row ct-said' }, h('span', { class: 'ct-cell-k' }, 'Son message de fin'), h('p', null, a.said)) : null,
      a.error ? h('div', { class: 'ct-row ct-err' }, a.error) : null,
      a.prompt ? h('div', { class: 'ct-row ct-prompt' }, h('span', { class: 'ct-cell-k' }, 'Sa demande'), h('p', null, a.prompt)) : null,
      facts.length || a.st === 'ended' || a.st === 'silent' ? h('div', { class: 'ct-row ct-facts' }, facts,
        a.st === 'ended' || a.st === 'silent' ? h('button', { class: 'ct-pbtn', onclick: () => T.act.forget(a.id) }, 'Retirer') : null) : null);
  }

  // Ce qui attend ali sans être un agent : feature cassée, essai en jeu, assets non sauvegardés.
  function note(x) {
    const band = x.tone === 'ko' ? 'red' : x.tone === 'you' ? 'amber' : 'slate';
    const kind = x.kind === 'manual' ? 'À essayer' : x.kind === 'dirty' ? 'Éditeur' : x.kind === 'broken' ? 'Régression' : 'En échec';
    return h('article', { class: `ct-strip ct-note ct-b-${band}` },
      h('div', { class: 'ct-note-in' },
        h('span', { class: 'ct-cell-k' }, kind),
        h('b', { class: 'ct-note-t' }, x.title),
        x.text ? h('p', null, x.text) : null),
      x.kind === 'manual' ? h('button', { class: 'ct-pbtn ct-pbtn-go', onclick: () => T.act.manual(x.feature.id, true) }, 'Je l\'ai testée') : null);
  }

  function column(cls, title, count, sub, kids, extra) {
    return h('section', { class: `ct-col ${cls}`, 'aria-label': title },
      h('div', { class: 'ct-col-head' },
        h('h2', null, title), h('span', { class: 'ct-count' }, String(count)),
        h('span', { class: 'ct-col-sub' }, sub), extra || null),
      h('div', { class: 'ct-rack' }, kids));
  }

  function forYou(M) {
    const kids = M.attention.map(x => x.agent ? strip(x.agent, M) : note(x));
    return column('ct-col-you', 'À toi', M.attention.length, M.attention.length ? 'du plus urgent au moins urgent' : '',
      kids.length ? kids : h('p', { class: 'ct-empty' }, 'Rien ne t\'attend. Les questions des agents et les essais en jeu arriveront ici.'));
  }

  function inFlight(M) {
    const xs = M.visibleAgents.filter(a => a.st === 'working');
    return column('ct-col-air', 'En vol', xs.length, 'travaillent en ce moment',
      xs.length ? xs.map(a => strip(a, M)) : h('p', { class: 'ct-empty' }, 'Aucun agent ne travaille. Une bande apparaît dès qu\'une session Claude Code démarre.'));
  }

  function onGround(M) {
    const xs = M.visibleAgents.filter(a => a.st === 'ready' || a.st === 'silent' || a.st === 'ended');
    const tog = M.endedCount ? h('button', { class: 'ct-link', 'aria-pressed': String(T.ui.showEnded), onclick: () => T.act.toggleEnded() }, T.ui.showEnded ? 'Cacher les terminées' : `Voir les terminées (${M.endedCount})`) : null;
    return column('ct-col-ground', 'Au sol', xs.length, 'prêts, silencieux ou terminés',
      xs.length ? xs.map(a => strip(a, M)) : h('p', { class: 'ct-empty' }, 'Personne au sol.'), tog);
  }

  // ---------- la piste ----------
  function usual(M, kind) {
    const ds = M.builds.filter(b => b.kind === kind && b.durationMs > 0).map(b => b.durationMs);
    return ds.length ? ds.reduce((s, x) => s + x, 0) / ds.length : 0;
  }

  function runway(M) {
    const L = M.lock;
    const avg = L ? usual(M, L.kind) : 0;
    const p = L ? (avg ? Math.min(0.9, Math.max(0.05, (M.now - L.since) / avg)) : 0.12) : 0;
    const who = L ? (L.agent ? L.agent.name : L.label) : '';
    const plate = L
      ? h('div', { class: 'ct-plate' },
        h('div', { class: 'ct-plate-who' },
          h('span', { class: 'ct-plate-k' }, 'Sur la piste'),
          h('span', { class: 'ct-plate-name' }, who),
          h('span', { class: 'ct-plate-what' }, `${L.kindText}${L.target ? ' ' + L.target : ''}`)),
        h('div', { class: 'ct-plate-time' },
          h('span', { class: 'ct-plate-k' }, 'depuis'),
          T.forEl(L.since, 'span', { class: 'ct-timer' }),
          avg ? h('span', { class: 'ct-plate-avg' }, `en général ${T.dur(avg)}`) : null),
        h('button', { class: 'ct-btn ct-btn-danger', onclick: T.act.release, title: 'Si le build est bloqué : un autre pourra démarrer en même temps' }, 'Libérer la piste'))
      : h('div', { class: 'ct-plate ct-plate-free' },
        h('div', { class: 'ct-plate-who' },
          h('span', { class: 'ct-plate-name' }, 'Piste libre'),
          h('span', { class: 'ct-plate-what' }, 'Le prochain agent qui compile décolle tout de suite.')));

    const plane = L ? h('div', { class: 'ct-plane', style: { left: `calc(84px + ${p} * (100% - 150px))` } },
      L.agent ? T.avatar(L.agent.look, 'working', 92) : T.forge(64, true)) : null;

    const ground = h('div', { class: 'ct-ground', 'aria-hidden': 'true' },
      h('div', { class: 'ct-hold' },
        h('div', { class: 'ct-hold-q' }, M.queue.slice(0, 4).map(q => h('div', { class: 'ct-hold-plane' },
          q.agent ? T.avatar(q.agent.look, 'ready', 60) : T.forge(36, false),
          h('span', null, String(q.pos))))),
        h('div', { class: 'ct-hold-bars' }, h('i'), h('i'), h('i', { class: 'ct-dash' }), h('i', { class: 'ct-dash' }))),
      h('div', { class: 'ct-rw' + (L ? ' ct-rw-busy' : '') },
        h('span', { class: 'ct-rw-thr' }), h('span', { class: 'ct-rw-cl' }),
        plane));

    return h('section', { class: 'ct-piste', 'aria-label': 'La piste de compilation' },
      h('div', { class: 'ct-piste-head' },
        h('h2', null, 'La piste'),
        h('p', null, 'La forge compile un seul build à la fois. Les autres attendent au point d\'arrêt, dans l\'ordre.')),
      plate,
      ground,
      L && L.command ? h('code', { class: 'ct-cmd' }, L.command) : null,
      h('div', { class: 'ct-piste-foot' },
        h('div', { class: 'ct-queue' },
          h('h3', null, 'Au point d\'arrêt'),
          M.queue.length ? h('ol', null, M.queue.map(q => h('li', null,
            h('span', { class: 'ct-qn' }, String(q.pos)),
            h('span', null, h('b', null, q.agent ? q.agent.name : q.label), ` attend pour : ${T.lower(q.kindText)}${q.raw.target || q.raw.testFilter ? ' ' + (q.raw.target || q.raw.testFilter) : ''}, depuis `, T.forEl(q.since)))))
            : h('p', { class: 'ct-quiet' }, 'Personne n\'attend.')),
        h('div', { class: 'ct-zones' },
          h('h3', null, 'Zones réservées'),
          M.chantiers.length ? h('ul', null, M.chantiers.map(x => h('li', null, h('b', null, x.file), ' ', x.text,
            h('span', { class: 'ct-quiet' }, ' ', T.agoEl(x.mtime)))))
            : h('p', { class: 'ct-quiet' }, 'Aucun verrou de domaine posé par les agents.'))));
  }

  // ---------- plan de vol ----------
  function checkLine(k) {
    const cls = k.ok === true ? 'ct-ok' : k.ok === false ? 'ct-ko' : 'ct-quiet';
    return h('li', null, k.text, ' : ', h('b', { class: cls }, k.verb),
      k.detail ? h('span', { class: 'ct-quiet' }, `, ${k.detail}`) : null,
      k.at ? h('span', { class: 'ct-quiet' }, ', ', T.agoEl(k.at)) : null);
  }

  function plan(M) {
    const c = M.campaign;
    const past = M.past.length ? h('p', { class: 'ct-past' }, 'Versions passées : ',
      M.past.map((x, i) => [i ? ', ' : '', h('b', null, x.name), x.won ? ` (validée ${T.clock(x.wonAt) ? 'à ' + T.clock(x.wonAt) : ''})` : ' (abandonnée)'])) : null;
    if (!c) {
      return h('section', { class: 'ct-plan ct-plan-empty', 'aria-label': 'Plan de vol' },
        h('div', { class: 'ct-plan-head' }, h('h2', null, 'Plan de vol'), h('p', { class: 'ct-quiet' }, 'Aucune version en préparation.')),
        h('p', null, 'Liste les features de la prochaine version : chacune devient un point de passage, la tour la valide toute seule avec les compilations et les tests, puis le jeu passe l\'épreuve finale (le package).'),
        h('button', { class: 'ct-btn ct-btn-go', onclick: T.act.openBuilder }, 'Préparer une version'),
        past);
    }
    const sym = (status) => h('span', { class: `ct-wp ct-wp-${status}`, 'aria-hidden': 'true' });
    const route = h('ol', { class: 'ct-route', style: `--n: ${c.features.length + 1}` },
      c.features.map(f => h('li', { class: `ct-leg ct-leg-${f.status}` },
        h('div', { class: 'ct-leg-mark' }, sym(f.status)),
        h('div', { class: 'ct-leg-body' },
          h('span', { class: `ct-chip ct-chip-${f.status}` }, f.statusText),
          h('b', { class: 'ct-leg-t' }, f.title),
          h('ul', { class: 'ct-checks' }, f.checks.map(checkLine)),
          f.manual ? h('button', { class: 'ct-btn' + (f.manual.done ? '' : ' ct-btn-go'), onclick: () => T.act.manual(f.id, !f.manual.done) }, f.manual.done ? 'Annuler mon essai' : 'Je l\'ai testée') : null))),
      h('li', { class: `ct-leg ct-leg-dest ct-leg-${c.final.status}` },
        h('div', { class: 'ct-leg-mark' }, h('span', { class: `ct-dest ct-dest-${c.final.status}`, 'aria-hidden': 'true' })),
        h('div', { class: 'ct-leg-body' },
          h('span', { class: `ct-chip ct-chip-${c.final.status}` }, c.final.statusText),
          h('b', { class: 'ct-leg-t' }, 'Épreuve finale'),
          c.final.locked ? h('p', { class: 'ct-quiet' }, 'Se débloque quand toutes les features sont prêtes.') : null,
          h('ul', { class: 'ct-checks' }, c.final.checks.map(checkLine)))));

    const won = c.won ? h('div', { class: 'ct-won' },
      h('p', { class: 'ct-won-t' }, `${c.name} est arrivée : la version est validée.`),
      h('p', null, `${T.dur(c.wonAt - c.createdAt)} de vol, ${T.plural(c.features.length, 'feature', 'features')}, ${T.plural(c.stats.builds, 'build et test', 'builds et tests')}, ${T.plural(c.stats.failures, 'échec corrigé', 'échecs corrigés')} en route, ${T.plural(c.stats.agents, 'agent', 'agents')} à bord.`),
      c.commit ? h('p', { class: 'ct-quiet' }, `Commit ${c.commit.sha}${c.commit.dirty ? `, avec ${T.plural(c.commit.dirty, 'fichier non commité', 'fichiers non commités')}` : ''}.`) : null,
      h('div', { class: 'ct-actions' }, h('button', { class: 'ct-btn', onclick: T.act.archive }, 'Ranger'), h('button', { class: 'ct-btn ct-btn-go', onclick: T.act.next }, 'Préparer la suivante'))) : null;

    return h('section', { class: 'ct-plan' + (c.won ? ' ct-plan-won' : ''), 'aria-label': 'Plan de vol de la version' },
      h('div', { class: 'ct-plan-head' },
        h('h2', null, 'Plan de vol'),
        h('span', { class: 'ct-vname' }, c.name),
        h('span', { class: 'ct-quiet' }, `${c.project}, lancée `, T.agoEl(c.createdAt)),
        h('span', { class: 'ct-progress' }, h('b', null, `${c.proven}/${c.total}`), ' features prêtes'),
        c.won ? null : h('button', { class: 'ct-link ct-link-danger', onclick: T.act.abandon }, 'Abandonner la version')),
      h('div', { class: 'ct-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': c.total, 'aria-valuenow': c.proven, 'aria-label': `${c.proven} features prêtes sur ${c.total}` },
        h('span', { style: { width: `${c.pct}%` } })),
      c.next ? h('p', { class: `ct-next ct-next-${c.next.tone}` }, h('b', null, 'Prochaine étape'), c.next.text) : null,
      won,
      route,
      past);
  }

  // ---------- carte et projets ----------
  function mapPanel(M) {
    const head = h('div', { class: 'ct-panel-head' },
      h('h2', null, 'Carte du projet'),
      M.inv ? h('span', { class: 'ct-quiet' }, `${T.num(M.inv.assets)} assets, ${T.num(M.inv.code.lines)} lignes de C++, compté `, T.agoEl(M.inv.scannedAt)) : null,
      M.inv ? h('button', { class: 'ct-link', onclick: T.act.refreshMap }, 'Recompter') : null);
    if (!M.inv) {
      return h('section', { class: 'ct-panel ct-map' }, head,
        h('p', { class: 'ct-empty' }, M.projects.length ? 'La tour compte les assets du projet, la carte arrive.' : 'Connecte un projet Unreal : sa carte apparaîtra ici.'));
    }
    const r = T.room(M.inv, T.ui.mapRoom);
    return h('section', { class: 'ct-panel ct-map' }, head,
      M.inventories.length > 1 ? h('div', { class: 'ct-tabs', role: 'tablist' }, M.inventories.map(i => h('button', {
        class: 'ct-tab', role: 'tab', 'aria-selected': String(i.project === M.inv.project),
        onclick: () => { T.ui.mapProject = i.project; T.rerender(); },
      }, i.project))) : null,
      h('div', { class: 'ct-mapframe' }, T.mapEl(M.inv)),
      h('div', { class: 'ct-room' },
        r ? [
          h('b', { class: 'ct-room-t' }, h('span', { class: 'ct-swatch', style: { background: r.color } }), `${r.name} : ${T.num(r.count)}`),
          h('p', null, r.recent ? `${T.plural(r.recent, 'modifié', 'modifiés')} ces 3 derniers jours.` : 'Rien de modifié ces 3 derniers jours.',
            r.workers.length ? ` ${r.workers.join(', ')} y travaille${r.workers.length > 1 ? 'nt' : ''}.` : ''),
          r.latest && r.latest.length ? h('p', { class: 'ct-quiet' }, 'Derniers modifiés : ', r.latest.slice(0, 6).map(l => l.name).join(', ')) : null,
        ] : h('p', { class: 'ct-quiet' }, 'Clique une extension de la carte pour voir ce qu\'elle contient.')));
  }

  function projectsPanel(M) {
    return h('section', { class: 'ct-panel ct-projects' },
      h('div', { class: 'ct-panel-head' }, h('h2', null, 'Projets connectés'),
        h('button', { class: 'ct-link', onclick: T.act.openProjects }, M.projects.length ? 'Connecter un autre projet' : 'Connecter un projet')),
      M.projects.length ? h('ul', null, M.projects.map(p => h('li', null,
        h('b', null, p.name), h('span', { class: 'ct-quiet' }, ` Unreal ${p.engine || '?'}`),
        h('span', { class: 'ct-path ct-quiet', title: p.uproject }, p.root || p.uproject),
        T.act.disconnect ? h('button', { class: 'ct-link ct-link-danger', onclick: () => T.act.disconnect(p) }, 'Déconnecter') : null)))
        : h('p', { class: 'ct-empty' }, 'Aucun projet Unreal connecté. Connecte celui que tes agents font avancer.'));
  }

  // ---------- journal de bord ----------
  function journal(M) {
    const head = h('div', { class: 'ct-panel-head' }, h('h2', null, 'Journal de bord'),
      M.builds.length ? h('span', { class: 'ct-quiet' }, `${T.plural(M.builds.filter(b => !b.ok).length, 'échec', 'échecs')} sur les ${T.plural(M.builds.length, 'dernier passage', 'derniers passages')} sur la piste`) : null);
    if (!M.builds.length) return h('section', { class: 'ct-panel ct-log' }, head, h('p', { class: 'ct-empty' }, 'Les builds et les tests lancés par tes agents s\'inscriront ici.'));
    const rows = [];
    for (const b of M.builds) {
      const open = T.ui.openBuilds.has(b.id);
      rows.push(h('tr', { class: b.ok ? 'ct-tr-ok' : 'ct-tr-ko' },
        h('td', { class: 'ct-td-time' }, T.clock(b.endedAt)),
        h('td', null, h('span', { class: b.ok ? 'ct-res ct-res-ok' : 'ct-res ct-res-ko' }, b.ok ? 'Réussi' : 'Échec')),
        h('td', { class: 'ct-td-op' }, h('button', { class: 'ct-rowbtn', 'aria-expanded': String(open), onclick: () => T.act.toggleBuild(b.id) },
          h('span', { class: 'ct-caret', 'aria-hidden': 'true' }), h('b', null, b.kindText), b.detail ? ' ' + b.detail : '', h('span', { class: 'ct-sum' }, b.summary ? ` ${b.summary}` : ''))),
        h('td', { class: 'ct-td-who' }, b.agent ? b.agent.name : b.label),
        h('td', { class: 'ct-td-num' }, T.dur(b.durationMs)),
        h('td', { class: 'ct-td-num ct-td-wait' }, b.waitMs > 1000 ? T.dur(b.waitMs) : '')));
      if (open) rows.push(h('tr', { class: 'ct-tr-x' }, h('td', { colspan: 6 },
        h('p', null, b.summary || '', b.how ? `, ${b.how}` : '', `. Lancé par ${b.agent ? b.agent.name : b.label}`, b.waitMs > 1000 ? `, a attendu ${T.dur(b.waitMs)} au point d'arrêt` : '', '.'),
        b.command ? h('code', null, b.command) : null,
        b.lines.length ? h('pre', null, b.lines.join('\n')) : null)));
    }
    return h('section', { class: 'ct-panel ct-log' }, head,
      h('table', { class: 'ct-table' },
        h('thead', null, h('tr', null, h('th', null, 'Heure'), h('th', null, 'Résultat'), h('th', null, 'Opération'), h('th', { class: 'ct-td-who' }, 'Agent'), h('th', { class: 'ct-td-num' }, 'Durée'), h('th', { class: 'ct-td-num ct-td-wait' }, 'Attente'))),
        h('tbody', null, rows)));
  }

  function render(root, M) {
    root.replaceChildren(
      header(M),
      h('main', { class: 'ct-main' },
        h('div', { class: 'ct-board' + (M.visibleAgents.some(a => a.st === 'ready' || a.st === 'silent' || a.st === 'ended') ? '' : ' ct-board-calm') }, forYou(M), runway(M), inFlight(M), onGround(M)),
        plan(M),
        h('div', { class: 'ct-lower' },
          h('div', { class: 'ct-lower-l' }, mapPanel(M), projectsPanel(M)),
          journal(M))));
  }

  T.register({ id: 'controle', render });
})();
