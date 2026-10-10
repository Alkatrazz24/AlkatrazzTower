'use strict';
// Equipe de nuit : la meme usine dans le noir. Seules les machines qui tournent, la forge, les lampadaires
// et les alertes eclairent. Le moteur est dans web/usine/moteur.js.
(function () {
  const U = window.Usine, TS = U.TS;
  const GRASS = ['#3d5a3a', '#395536', '#41603d', '#365234'];
  U.world({
    id: 'nuit', name: 'Nuit',
    col: {
      bg: '#0c1220', concrete: '#5d6168', concrete2: '#575b62', grid: 'rgba(0,0,0,.18)', stripeA: '#e2b23a',
      labelBg: 'rgba(8,12,24,.85)', text: '#e6ecff', mini: '#0b1220', wire: 'rgba(20,24,34,.85)', select: '#7cc4ff', blue: '#5fb4ff',
    },
    dark: 'rgba(5,9,24,.86)', glow: 1.5, lamps: '#ffd27a',
    safe: '#3d5a3a',
    tile(x, y, n, k) {
      if (n < .25) return { c: n < .21 ? '#1d3f5c' : '#244a69', anim: 'water' };
      if (n < .28) return '#8a7d60';
      const g = GRASS[k & 3];
      return n > .64 ? U.shade(g, -.15) : g;
    },
    deco(c, x, y, n, k) {
      if (n < .29) return;
      if (n > .6 && k % 6 === 0) {
        const r = 7 + (k >>> 4) % 4;
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + 10, y + 14, r, r * .55, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1f3a22'; c.beginPath(); c.arc(x + 8, y + 4, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2b4d2c'; c.beginPath(); c.arc(x + 6, y + 2, r * .6, 0, Math.PI * 2); c.fill();
      } else if (k % 97 === 0) {
        c.fillStyle = '#5d5a54'; c.fillRect(x + 3, y + 4, 10, 8);
      }
    },
    // la lune se reflete sur l'eau, et des lucioles dansent au-dessus de l'herbe
    animTile(c, a, t, emit) {
      const k = U.h2(a.x, a.y);
      if ((k & 7) !== 0) return;
      const p = U.reduced ? .5 : (t * .3 + (k & 255) / 255) % 1;
      emit.push(() => { c.fillStyle = `rgba(190,215,255,${(.5 * Math.sin(p * Math.PI)).toFixed(2)})`; c.fillRect(a.x * TS + p * 12, a.y * TS + (k >>> 8) % 12, 4, 1); });
    },
    overlay(c, w, h, t) {
      if (U.reduced) return;
      for (let i = 0; i < 26; i++) {
        const k = U.h2(i, 7), x = ((k & 1023) / 1023 * w + Math.sin(t * .4 + i) * 30) % w, y = ((k >>> 10 & 1023) / 1023 * h + Math.cos(t * .3 + i * 2) * 20) % h;
        const a = .5 + .5 * Math.sin(t * 2 + i * 1.7);
        c.fillStyle = `rgba(214,255,120,${(a * .7).toFixed(2)})`; c.fillRect(x, y, 2, 2);
      }
    },
  });
})();
