'use strict';
// L'usine en plein jour : herbe, rivieres et forets autour de la dalle. Le moteur est dans web/usine/moteur.js.
(function () {
  const U = window.Usine, TS = U.TS;
  const GRASS = ['#5f7d3b', '#5a7738', '#63823e', '#577236'];
  U.start({
    id: 'usine', name: 'L\'usine',
    col: { bg: '#5a7738', concrete: '#8d8a82', concrete2: '#86837b', grid: 'rgba(0,0,0,.1)', labelBg: 'rgba(24,22,20,.82)', mini: '#3f5a2a', wire: 'rgba(30,24,18,.7)' },
    safe: '#5f7d3b',
    tile(x, y, n, k) {
      if (n < .25) return { c: n < .21 ? '#2c5878' : '#336584', anim: 'water' };
      if (n < .28) return (k & 3) ? '#b39e72' : '#a99469';
      if ((k & 127) < 3) return '#6b5a3e';
      const g = GRASS[k & 3];
      return n > .64 ? U.shade(g, -.12) : g;
    },
    deco(c, x, y, n, k) {
      if (n < .29) return;
      if (n > .6 && k % 6 === 0) { // arbre
        const r = 7 + (k >>> 4) % 4;
        c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x + 10, y + 14, r, r * .55, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#5a3d22'; c.fillRect(x + 7, y + 6, 3, 8);
        c.fillStyle = '#2f5a24'; c.beginPath(); c.arc(x + 8, y + 4, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3f7230'; c.beginPath(); c.arc(x + 6, y + 2, r * .6, 0, Math.PI * 2); c.fill();
      } else if (k % 97 === 0) { // rocher
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x + 4, y + 9, 11, 4);
        c.fillStyle = '#7d776c'; c.fillRect(x + 3, y + 4, 10, 8);
        c.fillStyle = '#9a9488'; c.fillRect(x + 4, y + 4, 6, 3);
      } else if ((k & 31) === 5) { // fleurs
        c.fillStyle = ['#e8d36a', '#e8e4da', '#d98bb0'][k % 3]; c.fillRect(x + (k >>> 6) % 12, y + (k >>> 9) % 12, 2, 2);
      }
    },
    // reflets qui glissent sur l'eau
    animTile(c, a, t) {
      if (U.reduced) return;
      const k = U.h2(a.x, a.y), p = (t * .35 + (k & 255) / 255) % 1;
      if ((k & 3) !== 0) return;
      c.fillStyle = `rgba(200,230,255,${(.35 * Math.sin(p * Math.PI)).toFixed(2)})`;
      c.fillRect(a.x * TS + p * 12, a.y * TS + (k >>> 8) % 12, 4, 1);
    },
  });
})();
