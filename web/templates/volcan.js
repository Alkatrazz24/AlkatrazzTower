'use strict';
// Le volcan : une usine posee sur du basalte, entre des coulees de lave. Penombre rougeoyante, braises
// dans l'air. Le moteur est dans web/usine/moteur.js.
(function () {
  const U = window.Usine, TS = U.TS;
  const ROCK = ['#2b2320', '#282020', '#302725', '#251e1c'];
  U.start({
    id: 'volcan', name: 'Le volcan',
    col: {
      bg: '#1c1412', concrete: '#4c423d', concrete2: '#453b36', grid: 'rgba(0,0,0,.28)', stripeA: '#ff7a1a', stripeB: '#2a1a14',
      belt: '#c4882c', beltDark: '#5a3a14', machine: '#736a65', steel: '#7d746f', steelLight: '#aaa19b', steelDark: '#3e3734',
      forge: '#5a3a30', forgeLight: '#7c5040', forgeDark: '#2c1a14', fire: '#ff6a1a', fireHot: '#ffd36b',
      labelBg: 'rgba(26,14,10,.86)', text: '#f6e7dc', mini: '#160e0c', wire: 'rgba(10,6,5,.8)', pole: '#3a2a22', select: '#ffb347',
    },
    safe: '#2b2320', dark: 'rgba(28,8,4,.55)', glow: 1.6,
    smoke: (a) => `rgba(70,50,44,${(.45 * a).toFixed(2)})`,
    tile(x, y, n, k) {
      const d = Math.abs(n - .47);
      if (d < .022 || n > .8) return { c: '#ff5a14', anim: 'lava' };
      if (d < .038 || n > .77) return (k & 1) ? '#4a2418' : '#3e1f15';
      return ROCK[k & 3];
    },
    deco(c, x, y, n, k) {
      if (k % 23 === 0) { // eclats d'obsidienne
        c.fillStyle = '#1a1220'; c.beginPath(); c.moveTo(x + 4, y + 13); c.lineTo(x + 8, y + 3); c.lineTo(x + 12, y + 13); c.fill();
        c.fillStyle = '#3a2a48'; c.fillRect(x + 7, y + 5, 2, 4);
      } else if (k % 131 === 0) { // cheminee de soufre
        c.fillStyle = '#c9b23a'; c.beginPath(); c.arc(x + 8, y + 8, 5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2a2016'; c.beginPath(); c.arc(x + 8, y + 8, 2.5, 0, Math.PI * 2); c.fill();
      }
    },
    // la lave respire : couleur qui ondule, et une lueur toutes les quelques cases
    animTile(c, a, t, emit, light) {
      const k = U.h2(a.x, a.y), w = U.reduced ? .5 : .5 + .5 * Math.sin(t * 1.4 + a.x * .6 + a.y * .4 + (k & 7));
      emit.push(() => {
        c.fillStyle = w > .5 ? '#ff7a1a' : '#f04d0c'; c.fillRect(a.x * TS, a.y * TS, TS, TS);
        if ((k & 3) === 0) { c.fillStyle = '#ffc94a'; c.fillRect(a.x * TS + (k >>> 4) % 10, a.y * TS + (k >>> 8) % 10, 4 + w * 3, 2); }
      });
      if ((a.x + a.y * 3) % 5 === 0) light(a.x * TS + 8, a.y * TS + 8, 46, '#ff5a14', .55);
    },
    overlay(c, w, h, t) {
      if (U.reduced) return;
      for (let i = 0; i < 34; i++) {
        const k = U.h2(i, 3), sp = 20 + (k & 63);
        const x = ((k & 1023) / 1023 * w + Math.sin(t + i) * 20) % w, y = h - ((t * sp + (k >>> 10 & 1023)) % (h + 40));
        c.fillStyle = `rgba(255,${120 + (k & 90)},40,${(.5 + .4 * Math.sin(t * 3 + i)).toFixed(2)})`; c.fillRect(x, y, 2, 2);
      }
    },
  });
})();
