'use strict';
// Template « Level 0 » : la tour vue depuis la salle de surveillance du Level 0 des Backrooms.
// Chaque agent est un ecran de camera (le mur d'ecrans), ceux qui attendent ali ont un cadre ambre.
// La forge est la salle des machines, la version a sortir est « la sortie » : des niveaux a franchir
// jusqu'a la porte. L'historique est le registre de surveillance, la carte passe sur l'ecran large.

(function () {
  const T = window.Tower, h = T.h;
  const open = { history: true };

  // L'heure de l'incrustation tourne a la seconde, independamment des rendus.
  const pad = (n) => String(n).padStart(2, '0');
  function stamp(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  function day(d = new Date()) { return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; }
  if (!window.__l0Clock) {
    window.__l0Clock = setInterval(() => {
      const s = stamp();
      document.querySelectorAll('.l0-clock').forEach(e => { if (e.textContent !== s) e.textContent = s; });
    }, 1000);
  }
  const clockEl = (cls = '') => h('span', { class: 'l0-clock ' + cls, 'aria-hidden': 'true' }, stamp());
  const camId = (a) => 'l0-cam-' + String(a.id).replace(/[^\w-]/g, '');
  const goTo = (id) => { const e = document.getElementById(id); if (e) { e.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); e.focus({ preventScroll: true }); } };

  // ---------- en-tete : incrustation camescope ----------
  function header(M) {
    const e = M.editor;
    const link = M.demo ? 'démo, rien n\'est envoyé' : M.connected ? 'signal reçu' : 'pas de signal : la tour ne répond pas';
    let ed;
    if (e.plugin) {
      ed = [
        h('span', { class: 'l0-ed-item' }, h('span', { class: 'l0-k' }, 'Éditeur'), ' ', h('b', null, e.project)),
        h('span', { class: 'l0-ed-item' }, h('span', { class: 'l0-k' }, 'Map'), ' ', h('b', null, e.map || 'aucune')),
        h('span', { class: 'l0-ed-item' + (e.pie ? ' l0-on' : '') }, e.pie ? 'Partie en cours (PIE)' : 'Pas de partie lancée'),
        e.liveCoding.enabled ? h('span', { class: 'l0-ed-item' + (e.liveCoding.compiling ? ' l0-on' : '') }, e.liveCoding.compiling ? 'Live Coding compile' : 'Live Coding actif') : null,
        h('span', { class: 'l0-ed-item' + (e.dirty ? ' l0-warn' : '') }, e.dirty ? `${T.plural(e.dirty, 'asset non sauvegardé', 'assets non sauvegardés')}` : 'Tout est sauvegardé'),
        e.more ? h('span', { class: 'l0-ed-item' }, `et ${T.plural(e.more, 'autre éditeur', 'autres éditeurs')}`) : null,
      ];
    } else ed = [h('span', { class: 'l0-ed-item' }, h('span', { class: 'l0-k' }, 'Éditeur Unreal'), ' ', e.known ? e.text : 'état inconnu')];
    return h('header', { class: 'l0-top' },
      h('div', { class: 'l0-top-row' },
        h('span', { class: 'l0-rec' + (M.connected ? '' : ' l0-rec-off') }, h('i', { 'aria-hidden': 'true' }), M.connected ? 'REC' : 'PAUSE'),
        h('h1', { class: 'l0-brand' }, 'Alkatrazz Tower', h('span', null, 'salle de surveillance, Level 0')),
        h('span', { class: 'l0-grow' }),
        h('span', { class: 'l0-time' }, h('span', { class: 'l0-date' }, day()), ' ', clockEl()),
        T.switcher()),
      h('div', { class: 'l0-top-row l0-top-info' },
        h('span', { class: 'l0-link' + (M.connected ? ' l0-link-ok' : ' l0-link-ko') }, link),
        h('div', { class: 'l0-ed', 'aria-label': 'État de l\'éditeur Unreal' }, ed)));
  }

  // ---------- memo : ce qui attend ali ----------
  function memo(M) {
    const items = M.attention;
    const n = items.filter(x => x.tone !== 'info').length;
    const title = n ? (n > 1 ? `${n} choses t'attendent` : 'Une chose t\'attend') : 'Rien ne t\'attend';
    const doing = M.counts.working ? (M.counts.working > 1 ? `${M.counts.working} agents travaillent` : 'Un agent travaille') : 'Aucun agent ne travaille';
    const forge = M.lock ? `${M.lock.agent ? M.lock.agent.name : M.lock.label} occupe la salle des machines` : 'la salle des machines est libre';
    return h('section', { class: 'l0-memo', 'aria-labelledby': 'l0-memo-h' },
      h('div', { class: 'l0-memo-head' },
        h('h2', { id: 'l0-memo-h' }, title),
        h('p', null, `${doing}, ${forge}.`)),
      items.length ? h('ol', { class: 'l0-memo-list' }, items.map(memoItem))
        : h('p', { class: 'l0-memo-empty' }, 'Les écrans sont calmes. Une ligne apparaît ici dès qu\'un agent te pose une question ou qu\'une feature casse.'));
  }
  function memoItem(x) {
    let action = null;
    if (x.kind === 'manual') action = h('button', { class: 'l0-btn l0-btn-main', onclick: () => T.act.manual(x.feature.id, true) }, 'Je l\'ai testée');
    else if (x.agent) action = h('button', { class: 'l0-btn', onclick: () => goTo(camId(x.agent)) }, 'Voir sa caméra');
    else if (x.feature) action = h('button', { class: 'l0-btn', onclick: () => goTo('l0-exit') }, 'Voir la sortie');
    return h('li', { class: `l0-mi l0-mi-${x.tone}` },
      x.agent ? h('button', { class: 'l0-mi-av', onclick: () => T.act.openChar(x.agent.id), title: `Personnaliser ${x.agent.name}`, 'aria-label': `Personnaliser ${x.agent.name}` }, T.avatar(x.agent.look, x.agent.st, 40)) : h('span', { class: 'l0-mi-mark', 'aria-hidden': 'true' }),
      h('div', { class: 'l0-mi-body' },
        h('b', null, x.title),
        x.text ? h('p', null, x.text) : null,
        x.agent ? h('span', { class: 'l0-small' }, x.agent.role ? x.agent.role + ', ' : '', T.agoEl(x.agent.lastSeen)) : null),
      action);
  }

  // ---------- le mur d'ecrans ----------
  function doing(a, M) {
    if (a.holds) return `compile en salle des machines (${T.lower(M.lock.kindText)})`;
    if (a.queuePos) return `attend la salle des machines, ${a.queuePos === 1 ? '1re' : a.queuePos + 'e'} de la file`;
    if (a.st === 'working' && a.tool) return `${a.tool.name} ${a.tool.summary || ''}`;
    return a.stText;
  }
  function screen(a, i, M) {
    const quiet = a.st === 'ended' || a.st === 'silent';
    return h('article', { class: `l0-cam l0-st-${a.st}`, id: camId(a), tabindex: '-1', 'aria-label': `Caméra de ${a.name}, ${a.stText}` },
      h('div', { class: 'l0-screen' },
        h('div', { class: 'l0-osd l0-osd-tl' }, h('span', { class: 'l0-camno' }, `CAM ${pad(i + 1)}`), h('span', { class: 'l0-camname' }, a.name)),
        h('div', { class: 'l0-osd l0-osd-tr' }, h('span', { class: 'l0-st' }, a.stText)),
        h('button', { class: 'l0-figure', onclick: () => T.act.openChar(a.id), title: `Personnaliser ${a.name}`, 'aria-label': `Personnaliser ${a.name}` }, T.avatar(a.look, a.st, 100)),
        h('div', { class: 'l0-osd l0-osd-bl' }, day(), ' ', clockEl()),
        h('div', { class: 'l0-osd l0-osd-br' }, a.roomName ? a.roomName : a.where)),
      h('div', { class: 'l0-plate' },
        h('div', { class: 'l0-plate-head' },
          h('span', { class: 'l0-role' }, a.role || a.project || a.where),
          h('span', { class: 'l0-small' }, 'vu ', T.agoEl(a.lastSeen)),
          quiet ? h('button', { class: 'l0-btn l0-btn-s', onclick: () => T.act.forget(a.id) }, 'Retirer') : null),
        a.ask ? h('p', { class: 'l0-ask' }, h('b', null, 'Sa question : '), a.ask) : null,
        a.said ? h('p', { class: 'l0-said' }, h('b', null, 'Il a fini : '), a.said) : null,
        h('p', { class: 'l0-doing' }, doing(a, M)),
        a.error ? h('p', { class: 'l0-ko' }, a.error) : null,
        (a.prompt || a.lastBuild || a.lastTest || a.docs || a.subs) ? h('details', { class: 'l0-more' },
          h('summary', null, 'Sa demande et ses preuves'),
          a.prompt ? h('p', { class: 'l0-prompt' }, a.prompt) : null,
          a.subs ? h('p', null, `${T.plural(a.subs, 'sous-agent', 'sous-agents')} en cours.`) : null,
          a.lastBuild ? h('p', null, 'Compilation ', h('span', { class: a.lastBuild.ok ? 'l0-ok' : 'l0-ko' }, a.lastBuild.ok ? 'réussie' : 'en échec'), ', ', T.agoEl(a.lastBuild.endedAt)) : null,
          a.lastTest ? h('p', null, 'Tests : ', h('span', { class: a.lastTest.ok ? 'l0-ok' : 'l0-ko' }, a.lastTest.summary), ', ', T.agoEl(a.lastTest.endedAt)) : null,
          a.docs ? h('p', { class: a.docs.tone === 'warn' ? 'l0-warn-t' : a.docs.tone === 'ok' ? '' : 'l0-small' }, a.docs.text, a.docs.detail ? ` : ${a.docs.detail}` : '') : null) : null));
  }
  function wall(M) {
    const head = h('div', { class: 'l0-sec-head' },
      h('h2', null, 'Le mur d\'écrans'),
      h('span', { class: 'l0-small l0-on-wall' }, `${T.plural(M.counts.live, 'caméra active', 'caméras actives')}`),
      h('span', { class: 'l0-grow' }),
      M.endedCount ? h('button', { class: 'l0-btn', onclick: () => T.act.toggleEnded(), 'aria-pressed': String(T.ui.showEnded) }, T.ui.showEnded ? 'Masquer les sessions terminées' : `Afficher les sessions terminées (${M.endedCount})`) : null);
    const order = [...M.visibleAgents].sort((a, b) => (a.st === 'waiting' ? 0 : 1) - (b.st === 'waiting' ? 0 : 1));
    return h('section', { class: 'l0-wall', 'aria-label': 'Les agents' }, head,
      order.length ? h('div', { class: 'l0-grid' }, order.map((a, i) => screen(a, i, M)))
        : h('div', { class: 'l0-nosignal' }, h('span', { class: 'l0-vt' }, 'Aucun signal'), h('p', null, 'Un écran s\'allume dès qu\'une session Claude Code démarre dans un projet suivi.')));
  }

  // ---------- salle des machines ----------
  function machines(M) {
    const L = M.lock;
    return h('section', { class: 'l0-machines', 'aria-labelledby': 'l0-mach-h' },
      h('div', { class: 'l0-sec-head' }, h('h2', { id: 'l0-mach-h' }, 'Salle des machines')),
      h('div', { class: 'l0-forge' + (L ? ' l0-forge-on' : '') },
        h('div', { class: 'l0-forge-art' }, L && L.agent ? T.avatar(L.agent.look, 'working', 56) : null, T.forge(44, !!L)),
        L ? h('div', { class: 'l0-forge-txt' },
          h('b', null, `${L.kindText} de ${L.agent ? L.agent.name : L.label}`),
          h('div', null, L.target ? `${L.target}, ` : '', 'depuis ', T.forEl(L.since)),
          L.command ? h('code', null, L.command) : null)
          : h('div', { class: 'l0-forge-txt' }, h('b', null, 'Machines à l\'arrêt'), h('div', null, 'Le prochain agent qui compile passe tout de suite.'))),
      L ? h('button', { class: 'l0-btn l0-btn-danger', onclick: T.act.release, title: 'Si le build est bloqué' }, 'Libérer la salle') : null,
      h('h3', null, 'File d\'attente'),
      M.queue.length ? h('ol', { class: 'l0-queue' }, M.queue.map(q => h('li', null,
        h('span', { class: 'l0-vt l0-qpos' }, pad(q.pos)),
        h('span', null, h('b', null, q.agent ? q.agent.name : q.label), `, ${T.lower(q.kindText)}`),
        h('span', { class: 'l0-small' }, 'attend depuis ', T.forEl(q.since)))))
        : h('p', { class: 'l0-small' }, 'Personne n\'attend.'),
      h('h3', null, 'Zones réservées'),
      M.chantiers.length ? h('ul', { class: 'l0-locks' }, M.chantiers.map(x => h('li', null, h('b', null, x.file), h('span', null, x.text), h('span', { class: 'l0-small' }, T.agoEl(x.mtime)))))
        : h('p', { class: 'l0-small' }, 'Aucun agent n\'a réservé de domaine.'));
  }

  // ---------- la sortie ----------
  function checkLine(k) {
    return h('li', { class: 'l0-check' },
      h('span', { class: 'l0-dot ' + (k.ok === true ? 'l0-dot-ok' : k.ok === false ? 'l0-dot-ko' : ''), 'aria-hidden': 'true' }),
      h('span', null, k.text, ' : ', h('b', { class: k.ok === true ? 'l0-ok' : k.ok === false ? 'l0-ko' : '' }, k.verb),
        k.detail ? `, ${k.detail}` : '', k.failed && k.failed.length ? ` (${k.failed.join(', ')})` : '', k.at ? [', ', T.agoEl(k.at)] : null));
  }
  function exitBlock(M) {
    const c = M.campaign;
    const wrap = (cls, ...kids) => h('section', { class: 'l0-exit ' + cls, id: 'l0-exit', tabindex: '-1', 'aria-labelledby': 'l0-exit-h' }, ...kids);
    const past = M.past.length ? h('div', { class: 'l0-past' }, h('h3', null, 'Sorties précédentes'),
      h('ul', null, M.past.map(p => h('li', null, h('b', null, p.name), p.won ? [' trouvée le ', new Date(p.wonAt).toLocaleDateString('fr-FR')] : ' abandonnée')))) : null;
    if (!c) {
      return wrap('l0-exit-none',
        h('div', { class: 'l0-sec-head' }, h('h2', { id: 'l0-exit-h' }, 'La sortie')),
        h('p', null, 'Aucune version en préparation. Liste les features de la prochaine version : chacune devient un niveau que la tour valide seule avec les compilations et les tests, puis le package ouvre la porte de sortie.'),
        h('button', { class: 'l0-btn l0-btn-main', onclick: T.act.openBuilder }, 'Préparer une version'), past);
    }
    if (c.won) {
      return wrap('l0-exit-won',
        h('div', { class: 'l0-sec-head' }, h('h2', { id: 'l0-exit-h' }, `${c.name} : la porte est ouverte`)),
        h('p', { class: 'l0-won-lead' }, `Sortie trouvée après ${T.dur(c.wonAt - c.createdAt)}.`),
        h('dl', { class: 'l0-stats' },
          h('div', null, h('dt', null, 'Niveaux'), h('dd', null, c.features.length)),
          h('div', null, h('dt', null, 'Builds et tests'), h('dd', null, c.stats.builds)),
          h('div', null, h('dt', null, 'Échecs corrigés'), h('dd', null, c.stats.failures)),
          h('div', null, h('dt', null, 'Agents'), h('dd', null, c.stats.agents))),
        c.commit ? h('p', { class: 'l0-small' }, `Commit ${c.commit.sha}${c.commit.dirty ? `, avec ${c.commit.dirty} fichiers non commités` : ''}.`) : null,
        h('div', { class: 'l0-actions' }, h('button', { class: 'l0-btn', onclick: T.act.archive }, 'Ranger'), h('button', { class: 'l0-btn l0-btn-main', onclick: T.act.next }, 'Préparer la suivante')), past);
    }
    const levels = c.features.map((f, i) => h('li', { class: `l0-lvl l0-f-${f.status}` },
      h('div', { class: 'l0-lvl-no' }, h('span', { class: 'l0-vt' }, `N${pad(i + 1)}`)),
      h('div', { class: 'l0-lvl-body' },
        h('div', { class: 'l0-lvl-head' }, h('b', null, f.title), h('span', { class: 'l0-chip' }, f.statusText)),
        h('ul', { class: 'l0-checks' }, f.checks.map(checkLine))),
      f.manual ? h('button', { class: 'l0-btn' + (f.manual.done ? '' : ' l0-btn-main'), onclick: () => T.act.manual(f.id, !f.manual.done) }, f.manual.done ? 'Annuler mon test' : 'Je l\'ai testée') : null));
    const door = h('li', { class: `l0-lvl l0-door l0-f-${c.final.status}` },
      h('div', { class: 'l0-lvl-no', 'aria-hidden': 'true' }, h('span', { class: 'l0-exitsign' }, 'EXIT')),
      h('div', { class: 'l0-lvl-body' },
        h('div', { class: 'l0-lvl-head' }, h('b', null, 'Porte de sortie, l\'épreuve finale'), h('span', { class: 'l0-chip' }, c.final.statusText)),
        c.final.locked ? h('p', { class: 'l0-small' }, 'Elle s\'ouvre quand tous les niveaux sont franchis.') : null,
        h('ul', { class: 'l0-checks' }, c.final.checks.map(checkLine))));
    const seg = (st, t) => h('span', { class: `l0-seg l0-f-${st}`, title: t });
    return wrap('',
      h('div', { class: 'l0-sec-head' },
        h('h2', { id: 'l0-exit-h' }, `La sortie : ${c.name}`),
        h('span', { class: 'l0-small' }, `${c.proven} niveaux franchis sur ${c.total}, ${c.project}`),
        h('span', { class: 'l0-grow' }),
        h('button', { class: 'l0-btn l0-btn-ghost', onclick: T.act.abandon }, 'Abandonner')),
      h('div', { class: 'l0-corridor', role: 'img', 'aria-label': `${c.proven} niveaux franchis sur ${c.total}, porte ${T.lower(c.final.statusText)}` },
        c.features.map(f => seg(f.status, `${f.title} : ${f.statusText}`)), seg(c.final.status + ' l0-seg-door', `Porte de sortie : ${c.final.statusText}`)),
      c.next ? h('p', { class: `l0-next l0-next-${c.next.tone}` }, h('b', null, 'Prochaine étape : '), c.next.text) : null,
      h('ol', { class: 'l0-levels' }, levels, door), past);
  }

  // ---------- ecran large : carte ----------
  function mapBlock(M) {
    const s = h('section', { class: 'l0-wide', 'aria-labelledby': 'l0-map-h' },
      h('div', { class: 'l0-sec-head' },
        h('h2', { id: 'l0-map-h' }, 'Écran large : le projet'),
        M.inv ? h('span', { class: 'l0-small' }, `${T.num(M.inv.assets)} assets, ${T.num(M.inv.code.lines)} lignes de C++, compté `, T.agoEl(M.inv.scannedAt)) : null,
        h('span', { class: 'l0-grow' }),
        M.inv ? h('button', { class: 'l0-btn', onclick: T.act.refreshMap }, 'Recompter') : null));
    if (!M.inv) {
      s.append(h('div', { class: 'l0-wide-screen l0-nosignal' }, h('span', { class: 'l0-vt' }, M.projects.length ? 'Inventaire en cours' : 'Aucun signal'),
        h('p', null, M.projects.length ? 'La tour compte les assets du projet, la carte s\'affiche dans un instant.' : 'Connecte un projet Unreal : sa carte s\'affichera sur cet écran.'),
        M.projects.length ? null : h('button', { class: 'l0-btn l0-btn-main', onclick: T.act.openProjects }, 'Connecter un projet')));
      return s;
    }
    if (M.inventories.length > 1) s.append(h('div', { class: 'l0-tabs', role: 'group', 'aria-label': 'Projet affiché' }, M.inventories.map(i => h('button', { class: 'l0-btn' + (i.project === M.inv.project ? ' l0-btn-main' : ''), 'aria-pressed': String(i.project === M.inv.project), onclick: () => { T.ui.mapProject = i.project; T.rerender(); } }, i.project))));
    const r = T.room(M.inv, T.ui.mapRoom);
    s.append(
      h('div', { class: 'l0-wide-screen' }, h('div', { class: 'l0-osd-line' }, h('span', null, `CAM PLAN ${M.inv.project}`), h('span', null, clockEl())), T.mapEl(M.inv)),
      h('div', { class: 'l0-room' },
        r ? [h('b', { class: 'l0-room-name' }, h('i', { style: { background: r.color }, 'aria-hidden': 'true' }), `${r.name}, ${T.num(r.count)}`),
          h('span', null, r.recent ? `${r.recent} modifiés ces 3 derniers jours.` : 'Rien de modifié ces 3 derniers jours.'),
          r.workers.length ? h('span', null, `${r.workers.join(', ')} y travaille${r.workers.length > 1 ? 'nt' : ''}.`) : null,
          r.latest && r.latest.length ? h('span', { class: 'l0-small' }, 'Derniers modifiés : ', r.latest.slice(0, 5).map(l => l.name).join(', ')) : null]
          : h('span', { class: 'l0-small' }, 'Clique une pièce de la carte pour voir ce qu\'elle contient.')));
    return s;
  }

  // ---------- registre de surveillance ----------
  function registry(M) {
    const fails = M.builds.filter(b => !b.ok).length;
    const d = h('details', { class: 'l0-log', open: open.history },
      h('summary', null, h('h2', null, 'Registre de surveillance'),
        M.builds.length ? h('span', { class: 'l0-small' }, `${M.builds.length} entrées, ${T.plural(fails, 'échec', 'échecs')}`) : null));
    d.addEventListener('toggle', () => { open.history = d.open; });
    if (!M.builds.length) { d.append(h('p', { class: 'l0-small l0-pad' }, 'Les compilations et tests lancés par tes agents s\'inscriront ici.')); return d; }
    d.append(h('ul', { class: 'l0-entries' }, M.builds.map(b => {
      const isOpen = T.ui.openBuilds.has(b.id);
      return h('li', { class: b.ok ? '' : 'l0-entry-ko' },
        h('button', { class: 'l0-entry', 'aria-expanded': String(isOpen), onclick: () => T.act.toggleBuild(b.id) },
          h('span', { class: 'l0-vt l0-entry-t' }, T.clock(b.endedAt)),
          h('span', { class: 'l0-entry-res ' + (b.ok ? 'l0-ok' : 'l0-ko') }, b.ok ? 'Réussi' : 'Échec'),
          h('span', { class: 'l0-entry-what' }, `${b.kindText}${b.detail ? ' ' + b.detail : ''}`),
          h('span', { class: 'l0-small' }, b.agent ? b.agent.name : b.label),
          h('span', { class: 'l0-vt l0-entry-d' }, T.dur(b.durationMs))),
        isOpen ? h('div', { class: 'l0-entry-more' },
          h('p', null, b.summary, b.how ? `, ${b.how}` : '', b.waitMs > 1000 ? `, a attendu ${T.dur(b.waitMs)}` : ''),
          b.command ? h('code', null, b.command) : null,
          b.lines.length ? h('pre', null, b.lines.join('\n')) : h('p', { class: 'l0-small' }, 'Aucune ligne d\'erreur.')) : null);
    })));
    return d;
  }

  // ---------- moquette : projets ----------
  function carpet(M) {
    return h('footer', { class: 'l0-carpet' },
      h('div', { class: 'l0-carpet-in' },
        h('h2', null, 'Projets suivis'),
        M.projects.length ? h('ul', { class: 'l0-projects' }, M.projects.map(p => h('li', null,
          h('b', { title: p.uproject }, p.name), h('span', null, `UE ${p.engine || '?'}`),
          h('button', { class: 'l0-btn l0-btn-s l0-btn-ghost', onclick: () => T.act.disconnect(p) }, 'Déconnecter'))))
          : h('p', null, 'Aucun projet Unreal connecté : les caméras ne savent pas encore quoi filmer.'),
        h('button', { class: 'l0-btn l0-btn-main', onclick: T.act.openProjects }, M.projects.length ? 'Connecter un autre projet' : 'Connecter un projet')));
  }

  function render(root, M) {
    root.replaceChildren(
      header(M),
      h('main', { class: 'l0-main' },
        memo(M),
        h('div', { class: 'l0-row' }, wall(M), h('aside', { class: 'l0-side' }, machines(M))),
        exitBlock(M),
        mapBlock(M),
        registry(M)),
      carpet(M));
  }

  T.register({ id: 'level0', render });
})();
