'use strict';
// Template « Essentiel » : une page claire qui commence par une phrase sur l'etat du moment, puis ce
// qui attend ali. L'equipe, la forge et l'editeur restent dans une colonne a droite ; la carte et
// l'historique sont plus bas, replies tant qu'on ne les ouvre pas.

(function () {
  const T = window.Tower, h = T.h;
  const open = { map: false, history: false };

  function sentence(M) {
    const n = M.attention.filter(x => x.tone !== 'info').length;
    const lead = n ? `${n > 1 ? n + ' choses t\'attendent' : 'Une chose t\'attend'}.` : 'Rien ne t\'attend.';
    const bits = [];
    bits.push(M.counts.working ? `${M.counts.working > 1 ? M.counts.working + ' agents travaillent' : 'Un agent travaille'}` : 'Aucun agent ne travaille');
    if (M.lock) bits.push(`${M.lock.agent ? M.lock.agent.name : M.lock.label} occupe la forge (${T.lower(M.lock.kindText)})`);
    else bits.push('la forge est libre');
    return [h('span', { class: 'es-lead' }, lead), ' ', h('span', null, bits.join(', ') + '.')];
  }

  function attentionRow(x) {
    const action = x.kind === 'manual' ? h('button', { class: 'es-btn es-primary', onclick: () => T.act.manual(x.feature.id, true) }, 'Je l\'ai testée')
      : x.agent && x.kind === 'idle' ? h('button', { class: 'es-btn', onclick: () => T.act.openChar(x.agent.id), title: 'Personnaliser ce personnage' }, 'Personnage') : null;
    return h('li', { class: `es-todo es-t-${x.tone}` },
      x.agent ? T.avatar(x.agent.look, x.agent.st, 44) : h('span', { class: 'es-mark', 'aria-hidden': 'true' }),
      h('div', { class: 'es-todo-body' },
        h('b', null, x.title),
        x.text ? h('p', null, x.text) : null,
        x.agent ? h('span', { class: 'es-meta' }, x.agent.role, x.agent.role ? ', ' : '', T.agoEl(x.agent.lastSeen)) : null),
      action);
  }

  function versionBlock(M) {
    const c = M.campaign;
    if (!c) {
      return h('section', { class: 'es-block' },
        h('h2', null, 'Version à sortir'),
        h('p', { class: 'es-quiet' }, 'Liste les features de la prochaine version : la tour vérifie chacune toute seule avec les compilations et les tests, puis fait passer au jeu une épreuve finale (le package).'),
        h('button', { class: 'es-btn es-primary', onclick: T.act.openBuilder }, 'Préparer une version'));
    }
    if (c.won) {
      return h('section', { class: 'es-block es-won' },
        h('h2', null, `${c.name} est validée`),
        h('p', null, `${T.dur(c.wonAt - c.createdAt)} de développement, ${c.features.length} features, ${c.stats.builds} builds et tests, ${c.stats.failures} échecs corrigés en route.`),
        c.commit ? h('p', { class: 'es-quiet' }, `Commit ${c.commit.sha}${c.commit.dirty ? `, avec ${c.commit.dirty} fichiers non commités` : ''}.`) : null,
        h('div', { class: 'es-actions' }, h('button', { class: 'es-btn', onclick: T.act.archive }, 'Ranger'), h('button', { class: 'es-btn es-primary', onclick: T.act.next }, 'Préparer la suivante')));
    }
    const seg = (status, title) => h('span', { class: `es-seg es-s-${status}`, title });
    return h('section', { class: 'es-block' },
      h('div', { class: 'es-vhead' },
        h('h2', null, c.name),
        h('span', { class: 'es-quiet' }, `${c.proven} sur ${c.total} features prêtes`),
        h('button', { class: 'es-link', onclick: T.act.abandon }, 'Abandonner')),
      h('div', { class: 'es-segs', role: 'img', 'aria-label': `${c.proven} features prêtes sur ${c.total}` },
        c.features.map(f => seg(f.status, `${f.title} : ${f.statusText}`)), seg(c.final.status, `Épreuve finale : ${c.final.statusText}`)),
      c.next && (c.next.tone === "info" || c.next.tone === "ok") ? h("p", { class: `es-next es-t-${c.next.tone}` }, c.next.text) : null,
      h('ol', { class: 'es-feats' },
        c.features.map(f => h('li', { class: `es-feat es-f-${f.status}` },
          h('span', { class: 'es-chip' }, f.statusText),
          h('div', null, h('b', null, f.title),
            f.checks.map(k => h('div', { class: 'es-check' }, k.text, ' : ', h('span', { class: k.ok === true ? 'es-ok' : k.ok === false ? 'es-ko' : 'es-quiet' }, k.verb),
              k.detail ? h('span', { class: 'es-quiet' }, ', ', k.detail) : null, k.at ? h('span', { class: 'es-quiet' }, ', ', T.agoEl(k.at)) : null))),
          f.manual ? h('button', { class: 'es-btn' + (f.manual.done ? '' : ' es-primary'), onclick: () => T.act.manual(f.id, !f.manual.done) }, f.manual.done ? 'Annuler' : 'Je l\'ai testée') : null)),
        h('li', { class: `es-feat es-f-${c.final.status}` },
          h('span', { class: 'es-chip' }, c.final.statusText),
          h('div', null, h('b', null, 'Épreuve finale'),
            c.final.locked ? h('div', { class: 'es-quiet' }, 'Se débloque quand toutes les features sont prêtes.') : null,
            c.final.checks.map(k => h('div', { class: 'es-check' }, k.text, ' : ', h('span', { class: k.ok === true ? 'es-ok' : k.ok === false ? 'es-ko' : 'es-quiet' }, k.verb)))))));
  }

  function forgeBlock(M) {
    const L = M.lock;
    return h('section', { class: 'es-side-block' },
      h('h3', null, 'Forge'),
      L ? h('div', { class: 'es-forge' },
        L.agent ? T.avatar(L.agent.look, 'working', 48) : T.forge(40, true),
        h('div', null,
          h('b', null, `${L.kindText} de ${L.agent ? L.agent.name : L.label}`),
          h('div', { class: 'es-quiet' }, L.target ? `${L.target}, ` : '', 'depuis ', T.forEl(L.since))),
        h('button', { class: 'es-link es-danger', onclick: T.act.release, title: 'Si le build est bloqué' }, 'Libérer'))
        : h('p', { class: 'es-quiet' }, 'Libre : le prochain agent qui compile passe tout de suite.'),
      M.queue.length ? h('ol', { class: 'es-queue' }, M.queue.map(q => h('li', null, h('b', null, q.agent ? q.agent.name : q.label), ` attend pour : ${T.lower(q.kindText)}, depuis `, T.forEl(q.since)))) : null,
      M.chantiers.length ? h('details', { class: 'es-chantiers' }, h('summary', null, `${T.plural(M.chantiers.length, 'verrou de domaine', 'verrous de domaine')}`),
        M.chantiers.map(x => h('p', null, h('b', null, x.file), ' ', x.text))) : null);
  }

  function teamBlock(M) {
    return h('section', { class: 'es-side-block' },
      h('div', { class: 'es-side-head' }, h('h3', null, 'Équipe'),
        M.endedCount ? h('button', { class: 'es-link', onclick: () => T.act.toggleEnded() }, T.ui.showEnded ? 'Masquer les terminées' : `Terminées (${M.endedCount})`) : null),
      M.visibleAgents.length ? h('ul', { class: 'es-team' }, M.visibleAgents.map(a => h('li', { class: `es-agent es-a-${a.st}` },
        h('button', { class: 'es-av', onclick: () => T.act.openChar(a.id), title: `Personnaliser ${a.name}` }, T.avatar(a.look, a.st, 40)),
        h('div', null,
          h('div', null, h('b', null, a.name), ' ', h('span', { class: 'es-quiet' }, a.role)),
          h('div', { class: 'es-doing' }, a.holds ? `compile (${T.lower(M.lock.kindText)})` : a.queuePos ? `attend la forge (${a.queuePos}e)` : a.st === 'working' && a.tool ? `${a.tool.name} ${a.tool.summary}` : a.stText),
          a.prompt ? h('details', { class: 'es-more' }, h('summary', null, 'Sa demande'), h('p', null, a.prompt),
            a.lastBuild ? h('p', null, 'Compilation : ', h('span', { class: a.lastBuild.ok ? 'es-ok' : 'es-ko' }, a.lastBuild.ok ? 'réussie' : 'en échec'), ', ', T.agoEl(a.lastBuild.endedAt)) : null,
            a.lastTest ? h('p', null, 'Tests : ', h('span', { class: a.lastTest.ok ? 'es-ok' : 'es-ko' }, a.lastTest.summary), ', ', T.agoEl(a.lastTest.endedAt)) : null,
            a.docs ? h('p', { class: a.docs.tone === 'warn' ? 'es-warn' : 'es-quiet' }, a.docs.text) : null) : null),
        a.st === 'ended' || a.st === 'silent' ? h('button', { class: 'es-link', onclick: () => T.act.forget(a.id) }, 'Retirer') : null)))
        : h('p', { class: 'es-quiet' }, 'Aucun agent pour l\'instant. Une ligne apparaît dès qu\'une session Claude Code démarre.'));
  }

  function editorBlock(M) {
    const e = M.editor;
    return h('section', { class: 'es-side-block' },
      h('h3', null, 'Éditeur Unreal'),
      e.plugin ? h('div', null,
        h('p', null, h('b', null, e.project), ' est ouvert sur ', h('b', null, e.map || 'aucune map'), e.pie ? ', une partie tourne (PIE).' : '.'),
        e.dirty ? h('p', { class: 'es-warn' }, `${T.plural(e.dirty, 'asset non sauvegardé', 'assets non sauvegardés')} : ${e.dirtyNames.join(', ')}`) : h('p', { class: 'es-quiet' }, 'Tout est sauvegardé.'),
        e.liveCoding.enabled ? h('p', { class: 'es-quiet' }, e.liveCoding.compiling ? 'Live Coding compile.' : 'Live Coding actif.') : null)
        : h('p', { class: 'es-quiet' }, e.known ? `Éditeur ${e.text}.` : 'État inconnu pour l\'instant.'));
  }

  function projectsLine(M) {
    return h('p', { class: 'es-projects' },
      M.projects.length ? ['Projets : ', M.projects.map((p, i) => [i ? ', ' : '', h('b', { title: p.uproject }, p.name), ` (UE ${p.engine || '?'})`])] : 'Aucun projet Unreal connecté. ',
      ' ', h('button', { class: 'es-link', onclick: T.act.openProjects }, M.projects.length ? 'Connecter un autre projet' : 'Connecter un projet'));
  }

  function mapBlock(M) {
    const d = h('details', { class: 'es-fold', open: open.map }, h('summary', null, h('h2', null, 'Carte du projet'), h('span', { class: 'es-quiet' }, M.inv ? `${T.num(M.inv.assets)} assets, ${T.num(M.inv.code.lines)} lignes de C++` : '')));
    d.addEventListener('toggle', () => { open.map = d.open; });
    if (!M.inv) { d.append(h('p', { class: 'es-quiet' }, M.projects.length ? 'Inventaire du projet en cours…' : 'Connecte un projet Unreal : sa carte apparaîtra ici.')); return d; }
    const r = T.room(M.inv, T.ui.mapRoom);
    d.append(
      M.inventories.length > 1 ? h('div', { class: 'es-tabs' }, M.inventories.map(i => h('button', { class: 'es-btn' + (i.project === M.inv.project ? ' es-primary' : ''), onclick: () => { T.ui.mapProject = i.project; T.rerender(); } }, i.project))) : null,
      h('div', { class: 'es-mapframe' }, T.mapEl(M.inv)),
      h('div', { class: 'es-roominfo' },
        r ? [h('b', null, `${r.name} : ${T.num(r.count)}`), h('span', null, r.recent ? ` ${r.recent} modifiés ces 3 derniers jours.` : ' Rien de modifié ces 3 derniers jours.'),
          r.workers.length ? h('span', null, ` ${r.workers.join(', ')} y travaille${r.workers.length > 1 ? 'nt' : ''}.`) : null,
          h('p', { class: 'es-quiet' }, 'Derniers modifiés : ', r.latest.slice(0, 5).map(l => l.name).join(', '))]
          : h('span', { class: 'es-quiet' }, 'Clique une extension pour voir ce qu\'elle contient.'),
        h('button', { class: 'es-link', onclick: T.act.refreshMap }, 'Recompter')));
    return d;
  }

  function historyBlock(M) {
    const d = h('details', { class: 'es-fold', open: open.history }, h('summary', null, h('h2', null, 'Historique'),
      M.builds.length ? h('span', { class: 'es-quiet' }, `${M.builds.filter(b => !b.ok).length} échecs sur les ${M.builds.length} derniers builds et tests`) : null));
    d.addEventListener('toggle', () => { open.history = d.open; });
    if (!M.builds.length) { d.append(h('p', { class: 'es-quiet' }, 'Les builds lancés par tes agents apparaîtront ici.')); return d; }
    d.append(h('ul', { class: 'es-builds' }, M.builds.map(b => h('li', null,
      h('button', { class: 'es-build', 'aria-expanded': String(T.ui.openBuilds.has(b.id)), onclick: () => T.act.toggleBuild(b.id) },
        h('span', { class: 'es-time' }, T.clock(b.endedAt)),
        h('span', { class: b.ok ? 'es-ok' : 'es-ko' }, b.ok ? 'Réussi' : 'Échec'),
        h('span', null, `${b.kindText}${b.detail ? ' ' + b.detail : ''}`),
        h('span', { class: 'es-quiet' }, b.agent ? b.agent.name : b.label),
        h('span', { class: 'es-quiet es-right' }, T.dur(b.durationMs))),
      T.ui.openBuilds.has(b.id) ? h('div', { class: 'es-errs' }, h('p', { class: 'es-quiet' }, b.summary, b.how ? `, ${b.how}` : '', b.waitMs > 1000 ? `, a attendu ${T.dur(b.waitMs)}` : ''),
        h('code', null, b.command), b.lines.length ? h('pre', null, b.lines.join('\n')) : null) : null))));
    return d;
  }

  function render(root, M) {
    root.replaceChildren(
      h('header', { class: 'es-top' },
        h('span', { class: 'es-brand' }, 'Alkatrazz Tower'),
        h('span', { class: 'es-live' + (M.connected ? ' on' : '') }, M.demo ? 'démo' : M.connected ? 'en direct' : 'tour injoignable'),
        h('span', { class: 'es-grow' }),
        T.switcher()),
      h('main', { class: 'es-main' },
        h('div', { class: 'es-col' },
          h('h1', { class: 'es-sentence' }, sentence(M)),
          M.attention.length ? h('ul', { class: 'es-todos', 'aria-label': 'Ce qui t\'attend' }, M.attention.map(attentionRow)) : null,
          versionBlock(M),
          mapBlock(M),
          historyBlock(M),
          projectsLine(M)),
        h('aside', { class: 'es-side' }, forgeBlock(M), teamBlock(M), editorBlock(M))));
  }

  T.register({ id: 'essentiel', render });
})();
