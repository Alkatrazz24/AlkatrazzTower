'use strict';
// Template « Le village » : la page est un ecran de jeu pixel. La carte du projet tient le centre de
// l'ecran ; autour, un HUD de RPG : les portraits de l'equipe a gauche, le suivi de quete (la version a
// sortir) a droite, et en bas une boite de dialogue qui fait parler ce qui attend ali, une chose a la
// fois. Sous l'ecran : les fiches de l'equipe, la forge, le journal des builds et les projets.

(function () {
  const T = window.Tower, h = T.h;
  let talkKey = null; // titre de la replique affichee dans la boite de dialogue, garde entre deux rendus

  const ST_TONE = { working: 'work', waiting: 'wait', idle: 'done', ready: 'ready', ended: 'off', silent: 'off' };
  const FEAT_BOX = { proven: 'x', progress: '~', failing: '!', broken: '!', todo: '' };
  const okCls = (ok) => ok === true ? 'vi-ok' : ok === false ? 'vi-ko' : 'vi-dim';

  function btn(label, onclick, extra = {}) {
    const { kind, ...attrs } = extra;
    return h('button', { type: 'button', class: 'vi-btn' + (kind ? ' vi-btn-' + kind : ''), onclick, ...attrs }, label);
  }
  const doing = (a, M) => a.holds ? `compile à la forge (${T.lower(M.lock.kindText)})`
    : a.queuePos ? `attend la forge, ${a.queuePos}e dans la file`
      : a.st === 'working' && a.tool ? `${a.tool.name} ${a.tool.summary || ''}`.trim() : a.stText;

  // ---------- en-tete : la barre de titre du jeu ----------
  function header(M) {
    const e = M.editor;
    const ed = [];
    if (e.plugin) {
      ed.push(h('span', { class: 'vi-ed-map' }, e.map || 'aucune map'));
      if (e.pie) ed.push(h('span', { class: 'vi-tag vi-tag-work' }, 'PIE en cours'));
      if (e.liveCoding.enabled) ed.push(h('span', { class: 'vi-tag' + (e.liveCoding.compiling ? ' vi-tag-work' : '') }, e.liveCoding.compiling ? 'Live Coding compile' : 'Live Coding actif'));
      ed.push(e.dirty ? h('span', { class: 'vi-tag vi-tag-wait', title: e.dirtyNames.join(', ') }, `${T.plural(e.dirty, 'asset non sauvegardé', 'assets non sauvegardés')}`)
        : h('span', { class: 'vi-tag vi-tag-done' }, 'tout est sauvegardé'));
    } else ed.push(h('span', { class: 'vi-dim' }, e.known ? `éditeur ${e.text}` : 'éditeur : état inconnu'));
    const live = M.demo ? ['demo', 'Démo'] : M.connected ? ['on', 'En direct'] : ['off', 'Tour injoignable'];
    return h('header', { class: 'vi-top' },
      h('div', { class: 'vi-brand' }, h('span', { class: 'vi-brand-name' }, 'Alkatrazz Tower'),
        h('span', { class: `vi-live vi-live-${live[0]}` }, live[1])),
      h('div', { class: 'vi-editor', 'aria-label': 'Éditeur Unreal' },
        h('span', { class: 'vi-hud-label' }, e.plugin ? `Unreal, ${e.project}` : 'Unreal'), ed),
      T.switcher());
  }

  // ---------- HUD : portraits de groupe ----------
  function party(M) {
    const list = M.liveAgents;
    return h('nav', { class: 'vi-party vi-px', 'aria-label': 'Équipe' },
      h('div', { class: 'vi-hud-title' }, h('span', null, 'Équipe'), h('span', { class: 'vi-dim' }, `${M.counts.working} au travail`)),
      list.length ? h('ul', { class: 'vi-frames' }, list.map(a => h('li', null,
        h('button', { type: 'button', class: `vi-frame vi-st-${ST_TONE[a.st] || 'off'}`, onclick: () => T.act.openChar(a.id), title: `Personnaliser ${a.name}` },
          h('span', { class: 'vi-portrait' }, T.avatar(a.look, a.st, 40)),
          h('span', { class: 'vi-frame-body' },
            h('span', { class: 'vi-frame-name' }, a.name),
            h('span', { class: 'vi-frame-st' }, a.holds ? 'à la forge' : a.queuePos ? `file ${a.queuePos}` : a.stText))))))
        : h('p', { class: 'vi-empty' }, 'Personne au village. Un personnage arrive dès qu\'une session Claude Code démarre.'));
  }

  // ---------- HUD : suivi de quete ----------
  function quest(M) {
    const c = M.campaign;
    if (!c) {
      return h('section', { class: 'vi-quest vi-px', id: 'vi-quest', 'aria-label': 'Version à sortir' },
        h('div', { class: 'vi-hud-title' }, h('span', null, 'Aucune quête')),
        h('p', { class: 'vi-small' }, 'Liste les features de la prochaine version : la tour vérifie chacune avec les compilations et les tests, puis le jeu affronte une épreuve finale.'),
        btn('Préparer une version', T.act.openBuilder, { kind: 'go' }),
        pastList(M));
    }
    if (c.won) {
      return h('section', { class: 'vi-quest vi-px vi-quest-won', id: 'vi-quest', 'aria-label': 'Version validée' },
        h('div', { class: 'vi-hud-title' }, h('span', null, `Quête accomplie : ${c.name}`)),
        h('dl', { class: 'vi-stats' },
          h('div', null, h('dt', null, 'Durée'), h('dd', null, T.dur(c.wonAt - c.createdAt))),
          h('div', null, h('dt', null, 'Features'), h('dd', null, c.features.length)),
          h('div', null, h('dt', null, 'Builds et tests'), h('dd', null, c.stats.builds)),
          h('div', null, h('dt', null, 'Échecs corrigés'), h('dd', null, c.stats.failures)),
          h('div', null, h('dt', null, 'Agents'), h('dd', null, c.stats.agents))),
        c.commit ? h('p', { class: 'vi-small' }, `Commit ${c.commit.sha}${c.commit.dirty ? `, avec ${T.plural(c.commit.dirty, 'fichier non commité', 'fichiers non commités')}` : ''}.`) : null,
        h('div', { class: 'vi-row' }, btn('Ranger', T.act.archive), btn('Préparer la suivante', T.act.next, { kind: 'go' })),
        pastList(M));
    }
    const box = (status) => h('span', { class: `vi-check vi-check-${status}`, 'aria-hidden': 'true' }, FEAT_BOX[status] || '');
    const checks = (list) => h('ul', { class: 'vi-proofs' }, list.map(k => h('li', null,
      k.text, ' : ', h('span', { class: okCls(k.ok) }, k.verb),
      k.detail ? h('span', { class: 'vi-dim' }, `, ${k.detail}`) : null,
      k.at && k.ok !== null ? h('span', { class: 'vi-dim' }, ', ', T.agoEl(k.at)) : null)));
    return h('section', { class: 'vi-quest vi-px', id: 'vi-quest', 'aria-label': `Version à sortir : ${c.name}` },
      h('div', { class: 'vi-hud-title' }, h('span', null, `Quête : ${c.name}`), h('span', { class: 'vi-dim' }, `${c.proven}/${c.total}`)),
      h('div', { class: 'vi-xp', role: 'img', 'aria-label': `${c.proven} features prêtes sur ${c.total}` }, h('span', { style: { width: c.pct + '%' } })),
      c.next ? h('p', { class: `vi-nextstep vi-next-${c.next.tone}` }, c.next.text) : null,
      h('ol', { class: 'vi-objs' },
        c.features.map(f => h('li', { class: `vi-obj vi-obj-${f.status}` },
          box(f.status),
          h('div', { class: 'vi-obj-body' },
            h('div', { class: 'vi-obj-title' }, f.title, h('span', { class: 'vi-obj-st' }, f.statusText)),
            checks(f.checks),
            f.manual ? btn(f.manual.done ? 'Annuler le test' : 'Je l\'ai testée', () => T.act.manual(f.id, !f.manual.done), { kind: f.manual.done ? 'quiet' : 'go' }) : null))),
        h('li', { class: `vi-obj vi-boss vi-obj-${c.final.status}` },
          h('span', { class: 'vi-check vi-check-boss', 'aria-hidden': 'true' }, c.final.locked ? '' : c.final.status === 'failing' ? '!' : ''),
          h('div', { class: 'vi-obj-body' },
            h('div', { class: 'vi-obj-title' }, 'Boss : l\'épreuve finale', h('span', { class: 'vi-obj-st' }, c.final.statusText)),
            c.final.locked ? h('p', { class: 'vi-small vi-dim' }, 'Se débloque quand toutes les features sont prêtes.') : null,
            checks(c.final.checks)))),
      h('div', { class: 'vi-row vi-quest-foot' }, btn('Abandonner la quête', T.act.abandon, { kind: 'quiet' })),
      pastList(M));
  }
  function pastList(M) {
    if (!M.past.length) return null;
    return h('details', { class: 'vi-past' }, h('summary', null, `Quêtes passées (${M.past.length})`),
      h('ul', null, M.past.map(p => h('li', null, h('b', null, p.name), p.won ? [' validée ', T.agoEl(p.wonAt)] : ' abandonnée'))));
  }

  // ---------- carte au centre de l'ecran ----------

  function stage(M) {
    if (!M.inv) {
      return h('div', { class: 'vi-stage vi-stage-empty' },
        h('div', { class: 'vi-empty-map' },
          T.forge(64, false),
          h('p', { class: 'vi-pix' }, M.projects.length ? 'La tour compte le projet…' : 'Le village est vide.'),
          h('p', { class: 'vi-small' }, M.projects.length ? 'La carte apparaît dès que l\'inventaire est prêt.' : 'Connecte un projet Unreal : ses domaines deviendront les maisons du village.'),
          M.projects.length ? btn('Recompter', T.act.refreshMap) : btn('Connecter un projet', T.act.openProjects, { kind: 'go' })));
    }
    const r = T.room(M.inv, T.ui.mapRoom);
    const inv = M.inv;
    return h('div', { class: 'vi-stage' },
      M.inventories.length > 1 ? h('div', { class: 'vi-tabs', role: 'group', 'aria-label': 'Projet affiché' }, M.inventories.map(i =>
        h('button', { type: 'button', class: 'vi-tab', 'aria-pressed': String(i.project === inv.project), onclick: () => { T.ui.mapProject = i.project; T.rerender(); } }, i.project))) : null,
      h('div', { class: 'vi-mapwin' }, T.mapEl(inv)),
      h('div', { class: 'vi-roombar' },
        h('div', { class: 'vi-roominfo' },
          r ? [h('b', { class: 'vi-pix' }, `${r.name} : ${T.num(r.count)}`),
            h('span', null, r.recent ? ` ${r.recent} modifiés ces 3 derniers jours.` : ' Rien de modifié ces 3 derniers jours.'),
            r.workers.length ? h('span', null, ` ${r.workers.join(', ')} y travaille${r.workers.length > 1 ? 'nt' : ''}.`) : null,
            r.latest && r.latest.length ? h('span', { class: 'vi-dim' }, ` Derniers modifiés : ${r.latest.slice(0, 4).map(l => l.name).join(', ')}.`) : null]
            : [h('b', { class: 'vi-pix' }, inv.project), h('span', null, ` ${T.num(inv.assets)} assets, ${T.num(inv.code.lines)} lignes de C++.`), h('span', { class: 'vi-dim' }, ' Clique une maison pour voir ce qu\'elle contient.')]),
        btn('Recompter', T.act.refreshMap, { kind: 'quiet' })));
  }

  // ---------- boite de dialogue ----------
  function speakerOf(x) {
    if (x.agent) return { name: x.agent.name, face: T.avatar(x.agent.look, x.agent.st, 56) };
    if (x.kind === 'manual') return { name: 'Toi', face: T.youAvatar('waiting', 56) };
    if (x.kind === 'dirty') return { name: 'L\'éditeur', face: T.forge(48, false) };
    return { name: 'La quête', face: T.forge(48, true) };
  }
  function dialogue(M) {
    const list = M.attention;
    if (!list.length) {
      const msg = M.counts.working ? `Rien ne t'attend. ${M.counts.working > 1 ? M.counts.working + ' agents travaillent' : 'Un agent travaille'}, ${M.lock ? 'la forge est allumée' : 'la forge est libre'}.` : 'Rien ne t\'attend et personne ne travaille. Le village dort.';
      return h('section', { class: 'vi-talk vi-px', 'aria-label': 'Ce qui t\'attend' },
        h('div', { class: 'vi-talk-face' }, T.youAvatar('ready', 56)),
        h('div', { class: 'vi-talk-body' }, h('div', { class: 'vi-talk-name' }, 'La tour'), h('p', { class: 'vi-talk-text' }, msg)));
    }
    let i = list.findIndex(x => x.title === talkKey);
    if (i < 0) i = 0;
    talkKey = list[i].title;
    const x = list[i];
    const go = (d) => { talkKey = list[(i + d + list.length) % list.length].title; T.rerender(); };
    const sp = speakerOf(x);
    const say = x.kind === 'waiting' ? x.text : x.kind === 'idle' ? `J'ai fini. ${x.text}` : x.text ? `${x.title}. ${x.text}` : `${x.title}.`;
    const actions = [];
    if (x.kind === 'manual') actions.push(btn('Je l\'ai testée', () => T.act.manual(x.feature.id, true), { kind: 'go' }));
    if (x.agent) actions.push(h('a', { class: 'vi-btn', href: '#vi-a-' + x.agent.id }, 'Voir sa fiche'));
    if (x.feature && x.kind !== 'manual') actions.push(h('a', { class: 'vi-btn', href: '#vi-quest' }, 'Voir la quête'));
    return h('section', { class: `vi-talk vi-px vi-talk-${x.tone}`, 'aria-label': 'Ce qui t\'attend', 'aria-live': 'polite' },
      h('div', { class: 'vi-talk-face' }, sp.face),
      h('div', { class: 'vi-talk-body' },
        h('div', { class: 'vi-talk-name' }, sp.name, x.kind === 'waiting' ? h('span', { class: 'vi-talk-tag' }, 'attend ta réponse dans sa session') : null),
        h('p', { class: 'vi-talk-text' }, say, list.length > 1 ? h('span', { class: 'vi-cursor', 'aria-hidden': 'true' }) : null),
        h('div', { class: 'vi-row vi-talk-actions' }, actions,
          list.length > 1 ? h('span', { class: 'vi-talk-nav' },
            h('span', { class: 'vi-dim vi-pix' }, `${i + 1} sur ${list.length}`),
            btn('Précédent', () => go(-1), { kind: 'quiet' }),
            btn('Suivant', () => go(1))) : null)));
  }

  // ---------- sous l'ecran : fiches de l'equipe ----------
  function card(a, M) {
    const row = (label, ...v) => h('div', { class: 'vi-line' }, h('dt', null, label), h('dd', null, ...v));
    return h('article', { class: `vi-card vi-px vi-st-${ST_TONE[a.st] || 'off'}`, id: 'vi-a-' + a.id },
      h('div', { class: 'vi-card-head' },
        h('button', { type: 'button', class: 'vi-card-face', onclick: () => T.act.openChar(a.id), title: `Personnaliser ${a.name}`, 'aria-label': `Personnaliser ${a.name}` }, T.avatar(a.look, a.st, 64)),
        h('div', null,
          h('h3', null, a.name),
          h('div', { class: 'vi-dim vi-small' }, a.role || a.where, a.project && a.role ? `, ${a.project}` : ''),
          h('div', { class: 'vi-card-st' }, a.stText, ', ', T.agoEl(a.lastSeen)))),
      a.ask ? h('p', { class: 'vi-bubble vi-bubble-wait' }, h('b', null, 'Sa question : '), a.ask) : null,
      a.said ? h('p', { class: 'vi-bubble' }, h('b', null, 'Son message : '), a.said) : null,
      h('dl', { class: 'vi-lines' },
        row('Fait', doing(a, M)),
        a.prompt ? row('Demande', a.prompt) : null,
        a.subs ? row('Sous-agents', String(a.subs)) : null,
        a.lastBuild ? row('Compilation', h('span', { class: okCls(a.lastBuild.ok) }, a.lastBuild.ok ? 'réussie' : 'en échec'), ', ', T.agoEl(a.lastBuild.endedAt)) : null,
        a.lastTest ? row('Tests', h('span', { class: okCls(a.lastTest.ok) }, a.lastTest.summary || (a.lastTest.ok ? 'passent' : 'échouent')), ', ', T.agoEl(a.lastTest.endedAt)) : null,
        a.docs ? row('Doc UE', h('span', { class: a.docs.tone === 'warn' ? 'vi-warn' : a.docs.tone === 'ok' ? '' : 'vi-dim' }, a.docs.text), a.docs.detail ? h('span', { class: 'vi-dim' }, `, ${a.docs.detail}`) : null) : null,
        a.error ? row('Erreur', h('span', { class: 'vi-ko' }, a.error)) : null),
      a.st === 'ended' || a.st === 'silent' ? h('div', { class: 'vi-row' }, btn('Retirer', () => T.act.forget(a.id), { kind: 'quiet' })) : null);
  }
  function team(M) {
    return h('section', { class: 'vi-sec vi-sec-team' },
      h('div', { class: 'vi-sec-head' }, h('h2', null, 'L\'équipe'),
        M.endedCount ? btn(T.ui.showEnded ? 'Masquer les sessions terminées' : `Montrer les sessions terminées (${M.endedCount})`, () => T.act.toggleEnded(), { kind: 'quiet', 'aria-pressed': String(T.ui.showEnded) }) : null),
      M.visibleAgents.length ? h('div', { class: 'vi-cards' }, M.visibleAgents.map(a => card(a, M)))
        : h('p', { class: 'vi-empty' }, 'Aucun agent pour l\'instant. Lance une session Claude Code dans un projet : son personnage apparaît ici.'));
  }

  // ---------- la forge ----------
  function forgeSec(M) {
    const L = M.lock;
    return h('section', { class: 'vi-sec vi-px vi-panel' },
      h('div', { class: 'vi-sec-head' }, h('h2', null, 'La forge'), L ? btn('Libérer', T.act.release, { kind: 'danger', title: 'Si le build est bloqué' }) : null),
      h('div', { class: 'vi-forge' },
        h('div', { class: 'vi-forge-pic' }, T.forge(72, !!L)),
        L ? h('div', null,
          h('p', { class: 'vi-pix vi-forge-who' }, `${L.agent ? L.agent.name : L.label} : ${T.lower(L.kindText)}`),
          L.target ? h('p', { class: 'vi-small' }, L.target) : null,
          h('p', { class: 'vi-small vi-dim' }, 'Allumée depuis ', T.forEl(L.since)),
          L.command ? h('code', { class: 'vi-code' }, L.command) : null)
          : h('p', null, 'Éteinte. Le prochain agent qui compile passe tout de suite.')),
      h('h3', { class: 'vi-sub' }, 'File d\'attente'),
      M.queue.length ? h('ol', { class: 'vi-queue' }, M.queue.map(q => h('li', null,
        q.agent ? T.avatar(q.agent.look, q.agent.st, 28) : null,
        h('span', null, h('b', null, q.agent ? q.agent.name : q.label), ` attend pour : ${T.lower(q.kindText)}, depuis `, T.forEl(q.since)))))
        : h('p', { class: 'vi-dim vi-small' }, 'Personne n\'attend.'),
      h('h3', { class: 'vi-sub' }, 'Verrous de domaine'),
      M.chantiers.length ? h('ul', { class: 'vi-locks' }, M.chantiers.map(x => h('li', null, h('b', null, x.file), h('span', { class: 'vi-dim' }, ` (${x.project}) `), x.text)))
        : h('p', { class: 'vi-dim vi-small' }, 'Aucun domaine réservé.'));
  }

  // ---------- le journal ----------
  function journal(M) {
    const fails = M.builds.filter(b => !b.ok).length;
    return h('section', { class: 'vi-sec vi-px vi-panel' },
      h('div', { class: 'vi-sec-head' }, h('h2', null, 'Le journal'), M.builds.length ? h('span', { class: 'vi-dim vi-small' }, `${fails} échec${fails > 1 ? 's' : ''} sur ${M.builds.length}`) : null),
      M.builds.length ? h('ul', { class: 'vi-log' }, M.builds.map(b => {
        const open = T.ui.openBuilds.has(b.id);
        return h('li', { class: open ? 'vi-log-open' : '' },
          h('button', { type: 'button', class: 'vi-log-row', 'aria-expanded': String(open), onclick: () => T.act.toggleBuild(b.id) },
            h('span', { class: 'vi-log-time' }, T.clock(b.endedAt)),
            h('span', { class: 'vi-badge ' + (b.ok ? 'vi-badge-ok' : 'vi-badge-ko') }, b.ok ? 'Réussi' : 'Échec'),
            h('span', { class: 'vi-log-what' }, `${b.kindText}${b.detail ? ' ' + b.detail : ''}`, h('span', { class: 'vi-dim' }, b.agent ? `, ${b.agent.name}` : b.label ? `, ${b.label}` : '')),
            h('span', { class: 'vi-dim vi-log-dur' }, T.dur(b.durationMs))),
          open ? h('div', { class: 'vi-log-detail' },
            h('p', { class: 'vi-small' }, b.summary || '', b.how ? `, ${b.how}` : '', b.waitMs > 1000 ? `, a attendu ${T.dur(b.waitMs)} la forge` : ''),
            b.command ? h('code', { class: 'vi-code' }, b.command) : null,
            b.lines.length ? h('pre', { class: 'vi-pre' }, b.lines.join('\n')) : null) : null);
      })) : h('p', { class: 'vi-dim' }, 'Les compilations et tests de tes agents s\'inscriront ici.'));
  }

  // ---------- projets ----------
  function projects(M) {
    return h('section', { class: 'vi-sec vi-px vi-panel vi-sec-proj' },
      h('div', { class: 'vi-sec-head' }, h('h2', null, 'Les projets'), btn(M.projects.length ? 'Connecter un autre projet' : 'Connecter un projet', T.act.openProjects, { kind: M.projects.length ? '' : 'go' })),
      M.projects.length ? h('ul', { class: 'vi-projs' }, M.projects.map(p => h('li', null,
        h('div', null, h('b', null, p.name), h('span', { class: 'vi-dim' }, ` Unreal ${p.engine || '?'}`), h('div', { class: 'vi-path' }, p.root || p.uproject)),
        btn('Déconnecter', () => T.act.disconnect(p), { kind: 'quiet' }))))
        : h('p', { class: 'vi-dim' }, 'Aucun projet connecté. Connecte ton .uproject pour que la tour suive ses builds et dessine sa carte.'));
  }

  let mapScroll = null; // defilement de la carte sur petit ecran, garde d'un rendu a l'autre
  function render(root, M) {
    const old = root.querySelector('.vi-mapwin');
    if (old) mapScroll = old.scrollLeft;
    root.replaceChildren(
      header(M),
      h('main', { class: 'vi-main' },
        h('section', { class: 'vi-screen', 'aria-label': 'Écran du village' },
          stage(M), party(M), quest(M), dialogue(M)),
        team(M),
        h('div', { class: 'vi-duo' }, forgeSec(M), journal(M)),
        projects(M)));
    const win = root.querySelector('.vi-mapwin');
    if (win && win.scrollWidth > win.clientWidth) win.scrollLeft = mapScroll != null ? mapScroll : (win.scrollWidth - win.clientWidth) / 2;
  }

  T.register({ id: 'village', render });
})();
