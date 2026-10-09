'use strict';
// Le plan : l'usine dessinee en plan d'ingenieur, blanc sur bleu. Pas de decor, des traits et une grille.
// Le moteur est dans web/usine/moteur.js (SC = dessin au trait).
(function () {
  const U = window.Usine, TS = U.TS;
  U.start({
    id: 'plan', name: 'Le plan', schematic: true,
    col: {
      bg: '#1b4c8c', ground: '#1d5193', concrete: 'rgba(255,255,255,.035)', grid: 'rgba(255,255,255,.1)',
      steel: '#2a64a8', steelLight: '#e8f1ff', steelDark: '#9cc0ee', machine: '#2a64a8', belt: '#9cc8ff', beltDark: '#9cc8ff',
      forge: '#2a64a8', forgeLight: '#e8f1ff', forgeDark: '#9cc0ee', stripeA: '#e8f1ff',
      text: '#ffffff', labelBg: 'rgba(20,62,118,.94)', select: '#ffffff', mini: '#143e74', shadow: 'rgba(0,0,0,0)', ghost: 'rgba(232,241,255,.5)',
      ok: '#8ff0a4', ko: '#ff9c8a', warn: '#ffe08a', blue: '#a8dcff', fire: '#ffb38a', fireHot: '#ffe0c8',
    },
    labelFont: '"JetBrains Mono", Consolas, monospace',
    avatarFilter: 'grayscale(1) brightness(1.6) sepia(1) hue-rotate(175deg) saturate(2.5)',
    tile() { return '#1d5193'; },
    deco(c, x, y) {
      const gx = Math.round(x / TS), gy = Math.round(y / TS);
      c.fillStyle = gx % 8 === 0 || gy % 8 === 0 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)';
      c.fillRect(x, y, TS, 1); c.fillRect(x, y, 1, TS);
    },
  });
})();
