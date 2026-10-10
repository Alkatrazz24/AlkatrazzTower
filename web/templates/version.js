'use strict';
// « La version » : la tour pilotee par l'objectif. A gauche, la version a sortir comme une liste de
// controle : la prochaine etape en grand avec son bouton, puis chaque feature et ses preuves. A droite,
// la forge et les derniers builds qui font avancer la liste. Sans version, un seul bouton pour en preparer une.
// Le jeu (web/usine/moteur.js) dessine l'usine ; ce fichier ne decrit que le fonctionnement.
(function () {
  const U = window.Usine;
  U.mode({
    id: 'version', name: 'La version', counters: false, noFiche: ['silo'],
    pads: (sel) => ({ l: 480, r: sel ? 410 : 330, t: 64, b: 20 }),
    hud(M, api) {
      const { h, T, btn } = api, c = M.campaign;
      let main;
      if (!c) {
        main = [h('h2', null, 'Prochaine version'),
          h('ol', { class: 'us-steps' },
            h('li', null, h('b', null, 'Choisis les features'), ' que la version doit contenir, et comment prouver que chacune marche (compilation, tests, essai en jeu).'),
            h('li', null, h('b', null, 'Les agents construisent.'), ' Chaque build et chaque test réussi coche une preuve, tout seul.'),
            h('li', null, h('b', null, 'La fusée décolle'), ' quand tout est prêt et que le package final passe.')),
          btn('Préparer une version', T.act.openBuilder, 'us-go us-big'),
          M.past.length ? h('p', { class: 'us-dim' }, 'Précédentes : ', M.past.slice(0, 6).map(p => `${p.name} (${p.won ? 'lancée' : 'abandonnée'})`).join(', ')) : null];
      } else if (c.won) {
        main = [h('h2', null, `${c.name} : fusée lancée`), h('div', { class: 'us-bar' }, h('i', { style: 'width:100%' })), h('p', { class: 'us-t-ok' }, h('b', null, 'Version validée.')), api.wonRows(c),
          h('div', { class: 'us-actions' }, btn('Préparer la suivante', T.act.next, 'us-go us-big'), btn('Ranger', T.act.archive))];
      } else {
        const nf = c.next && c.next.feature && c.features.find(f => f.id === c.next.feature.id);
        main = [
          h('div', { class: 'us-vhead' }, h('h2', null, `Version ${c.name}`), h('span', { class: 'us-pct' }, `${c.proven}/${c.total}`)),
          h('div', { class: 'us-bar' }, h('i', { style: `width:${c.pct}%` })),
          c.next ? h('div', { class: `us-nextbox us-c-${c.next.tone}` }, h('small', null, 'Prochaine étape'), h('p', null, c.next.text),
            nf && nf.manual && !nf.manual.done ? btn('Je l\'ai testée', () => T.act.manual(nf.id, true), 'us-go') : null) : null,
          api.featureList(c),
          h('div', { class: 'us-actions' }, btn('Abandonner la version', T.act.abandon, 'us-danger'))];
      }
      const L = M.lock;
      const side = h('aside', { class: 'us-vside' },
        h('section', { class: 'us-panel us-forgebox' }, h('div', { class: 'us-ptitle' }, 'Forge'),
          L ? h('p', null, h('b', null, `${L.kindText} de ${L.agent ? L.agent.name : L.label}`), ', depuis ', T.forEl(L.since)) : h('p', { class: 'us-t-ok' }, 'Libre.'),
          M.queue.length ? h('p', { class: 'us-dim' }, `En attente : ${M.queue.map(q => q.agent ? q.agent.name : q.label).join(', ')}`) : null,
          btn('Voir la forge', () => api.select({ kind: 'forge' }, true))),
        h('section', { class: 'us-panel us-lastbuilds' }, h('div', { class: 'us-ptitle' }, 'Derniers builds'),
          M.builds.length ? api.buildList(M.builds.slice(0, 6)) : h('p', { class: 'us-dim' }, 'Aucun build pour l\'instant.')));
      return [h('section', { class: 'us-panel us-quest', 'aria-label': 'La version' }, main), side];
    },
  });
})();
