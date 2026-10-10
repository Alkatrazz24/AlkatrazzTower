'use strict';
// La banquise : neige, glace et sapins. Lumiere froide ; les machines qui tournent rechauffent leur coin,
// celles qui s'arretent se couvrent de givre. Le moteur est dans web/usine/moteur.js.
(function () {
  const U = window.Usine, TS = U.TS;
  const SNOW = ['#eef4f8', '#e8f0f5', '#f3f7fa', '#e4edf3'];
  U.world({
    id: 'banquise', name: 'Banquise',
    col: {
      bg: '#e6eef4', concrete: '#9ea9b2', concrete2: '#97a2ab', grid: 'rgba(30,50,70,.14)', stripeA: '#2f7fc4', stripeB: '#e8f0f5',
      machine: '#8f9ba4', steel: '#9aa6af', steelLight: '#d4dde3', steelDark: '#56636e', belt: '#d6a23d', beltDark: '#7a5a1c',
      shadow: 'rgba(40,60,90,.22)', labelBg: 'rgba(22,38,56,.86)', mini: '#cbd8e1', wire: 'rgba(40,58,78,.65)', pole: '#56636e', select: '#ff7a1a',
    },
    dark: 'rgba(40,80,140,.22)', glow: 1.1,
    smoke: (a) => `rgba(255,255,255,${(.55 * a).toFixed(2)})`,
    tile(x, y, n, k) {
      if (n < .3) return n < .26 ? '#b9dcee' : '#c8e4f2';
      if (n < .32) return '#d9ebf4';
      return SNOW[k & 3];
    },
    deco(c, x, y, n, k) {
      if (n < .3) { if ((k & 15) === 0) { c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 2, y + 4); c.lineTo(x + 9, y + 8); c.lineTo(x + 14, y + 6); c.stroke(); } return; }
      if (n > .6 && k % 6 === 0) { // sapin enneige
        c.fillStyle = 'rgba(40,60,90,.18)'; c.beginPath(); c.ellipse(x + 10, y + 15, 8, 3, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2d4a3e'; c.beginPath(); c.moveTo(x + 8, y - 8); c.lineTo(x + 15, y + 13); c.lineTo(x + 1, y + 13); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x + 8, y - 8); c.lineTo(x + 11, y); c.lineTo(x + 5, y); c.fill();
        c.fillRect(x + 3, y + 8, 4, 2); c.fillRect(x + 10, y + 5, 3, 2);
      } else if (k % 61 === 0) { // rocher sous la neige
        c.fillStyle = '#6d7880'; c.fillRect(x + 3, y + 5, 11, 8);
        c.fillStyle = '#ffffff'; c.fillRect(x + 3, y + 4, 11, 3);
      }
    },
    // givre sur les machines arretees, petite vapeur chaude sur celles qui tournent
    machineOverlay(c, x, y, w, h, a, on) {
      if (on) return;
      c.fillStyle = 'rgba(235,245,255,.55)'; c.fillRect(x + 2, y + 2, w - 4, 7);
      c.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 5; i++) c.fillRect(x + 5 + i * 9, y + h - 4, 2, 3 + (i % 2) * 2);
    },
    overlay(c, w, h, t) {
      if (U.reduced) return;
      c.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 70; i++) {
        const k = U.h2(i, 11), sp = 18 + (k & 31);
        const x = ((k & 1023) / 1023 * w + Math.sin(t * .7 + i) * 18 + t * 8) % w, y = (t * sp + (k >>> 10 & 1023) / 1023 * h) % h;
        const s = 1 + (k >>> 20 & 1); c.fillRect(x, y, s * 2, s * 2);
      }
    },
  });
})();
