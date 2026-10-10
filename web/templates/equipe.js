'use strict';
// « L'équipe » : la tour vue par les agents. En bas, une carte par agent : qui il est, ce qu'il fait en
// ce moment, depuis quand. On en choisit un (clic ou touches 1 a 9) : la camera va a sa salle et
// sa fiche s'ouvre a droite. Le jeu (web/usine/moteur.js) dessine la tour ; ce fichier ne decrit que le fonctionnement.
(function () {
  const U = window.Usine;
  // Ce que fait l'agent, en une ligne lisible.
  function doing(a, T, M) {
    if (a.st === 'waiting') return a.ask || 'Attend ta réponse dans sa session.';
    if (a.holds && M.lock) return `${M.lock.kindText} à la forge depuis ${T.dur(Date.now() - M.lock.since)}`;
    if (a.queuePos) return `Attend la forge (${a.queuePos}e)`;
    if (a.st === 'idle') return a.said || 'A fini, attend la suite.';
    if (a.tool) return `${a.tool.name} ${a.tool.summary}`;
    return a.prompt || a.stText;
  }
  U.mode({
    id: 'equipe', name: 'L\'équipe', counters: true, follow: true,
    pads: (sel) => ({ l: 20, r: sel ? 410 : 20, t: 64, b: 200 }),
    hud(M, api) {
      const { h, T, btn, dotFor } = api, W = api.world;
      const ms = W ? W.machines : [];
      const card = (m, i) => {
        const a = m.a, sel = api.sel && api.sel.kind === 'agent' && api.sel.id === a.id;
        return h('li', null, h('button', { type: 'button', class: `us-mate us-s-${dotFor(a.st)}${sel ? ' sel' : ''}`, 'aria-pressed': String(sel), onclick: () => api.select(sel ? null : { kind: 'agent', id: a.id }, true) },
          h('span', { class: 'us-mface' }, T.avatar(a.look, a.st === 'ended' ? 'ended' : a.st, 52), i < 9 ? h('kbd', null, String(i + 1)) : null),
          h('span', { class: 'us-mtext' },
            h('b', null, a.name), h('span', { class: `us-state us-s-${dotFor(a.st)}` }, a.stText),
            h('span', { class: 'us-mdo' }, doing(a, T, M)),
            h('small', { class: 'us-dim' }, a.subs ? `${T.plural(a.subs, 'sous-agent', 'sous-agents')}, ` : '', a.roomName ? `${a.roomName}, ` : '', 'vu ', T.agoEl(a.lastSeen)))));
      };
      return [h('section', { class: 'us-panel us-roster', 'aria-label': 'L\'équipe' },
        h('header', { class: 'us-rhead' }, h('h2', null, 'L\'équipe'), h('span', { class: 'us-dim' }, ms.length ? 'Choisis un agent : la caméra le suit.' : ''), h('span', { class: 'us-grow' }),
          btn(T.ui.showEnded ? 'Masquer les terminées' : `Sessions terminées (${M.endedCount})`, () => T.act.toggleEnded(), '', { disabled: !M.endedCount && !T.ui.showEnded }),
          btn('Forge', () => api.select({ kind: 'forge' }, true), '', { title: 'Touche F' }), btn('Version', () => api.select({ kind: 'silo' }, true), '', { title: 'Touche V' })),
        ms.length ? h('ul', { class: 'us-mates' }, ms.map(card))
          : h('div', { class: 'us-empty' }, h('strong', null, 'Personne pour l\'instant.'), h('p', null, 'Lance une session Claude Code dans ton projet : sa salle s\'ouvre dans la tour et son personnage s\'y installe.')))];
    },
  });
})();
