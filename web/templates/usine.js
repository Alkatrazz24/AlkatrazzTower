'use strict';
// Template « L'usine » : la tour comme une usine vue de dessus, facon jeu de gestion d'usine.
// Le jeu tourne en fond, en direct :
//   - chaque domaine du projet (Blueprints, Sons...) est un gisement ; une foreuse y tourne quand
//     il a bouge ces 3 derniers jours ;
//   - chaque agent est une machine d'assemblage avec son personnage ; elle tourne quand il travaille,
//     une alerte clignote au-dessus quand il attend ta reponse, un tapis l'alimente depuis le gisement
//     du fichier qu'il touche ;
//   - le tapis principal mene au four (la forge) : une seule caisse dedans a la fois, les autres
//     attendent sur le tapis ; a la sortie, un coffre des builds reussis et un coffre des echecs ;
//   - la version a sortir est le silo a fusee : chaque feature prete est une piece de la fusee,
//     l'epreuve finale est le lancement.
// Par-dessus, un HUD : version en haut a gauche, mini-carte et alertes a droite, barre rapide en bas,
// et la fiche de ce qu'on a selectionne (clic sur le jeu, ou touches 1 a 9).

(function () {
  const T = window.Tower, h = T.h;
  const TS = 16; // taille d'une case en pixels du monde
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COL = {
    ground: '#3a3530', ground2: '#353029', grid: 'rgba(0,0,0,.18)', concrete: '#57544e', concrete2: '#4f4c46',
    belt: '#c9a227', beltDark: '#6b5615', steel: '#8b8f94', steelDark: '#4b4f55', steelLight: '#b9bdc2',
    fire: '#ff8a1f', fireHot: '#ffd166', ok: '#5fbf4a', ko: '#e0533d', warn: '#f2b233', blue: '#59a8e8', ghost: 'rgba(110,170,255,.55)',
    text: '#f1ede4', shadow: 'rgba(0,0,0,.45)',
  };

  // ---------- etat du jeu (garde d'un rendu a l'autre) ----------
  const G = {
    built: false, canvas: null, ctx: null, mini: null, hud: {}, M: null, world: null,
    cam: { x: 0, y: 0, z: 2 }, fitted: false, userMoved: false,
    sel: null, // { kind: 'agent'|'patch'|'forge'|'ok'|'ko'|'silo', id }
    imgs: new Map(), t: 0, last: 0, drag: null, hover: null,
  };

  // ---------- personnages : SVG -> image pour le canvas ----------
  function avatarImg(look, state) {
    const key = JSON.stringify(look) + state;
    let im = G.imgs.get(key);
    if (!im) {
      im = new Image();
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.Avatar.render(look, { state, size: 88 }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
      G.imgs.set(key, im);
    }
    return im;
  }

  // ---------- plan de l'usine ----------
  function rnd(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function hash(str) { let x = 2166136261; for (const c of String(str)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }

  function layout(M) {
    const shown = M.agents.filter(a => a.st !== 'ended' || T.ui.showEnded);
    const order = { waiting: 0, idle: 1, working: 2, ready: 3, silent: 4, ended: 5 };
    shown.sort((a, b) => (order[a.st] - order[b.st]) || a.name.localeCompare(b.name));
    const n = Math.max(shown.length, 1);
    const pitch = 6, x0 = 3;
    const machines = shown.map((a, i) => ({ a, x: x0 + i * pitch, y: 10, w: 3, h: 3 }));
    const queue = M.queue.length;
    const forgeX = Math.max(x0 + n * pitch + 2 + queue * 2, 24);
    const forge = { x: forgeX, y: 15, w: 4, h: 4 };
    const beltY = 16.5;
    const okChest = { x: forgeX + 7, y: 14, w: 2, h: 2 }, koChest = { x: forgeX + 7, y: 18, w: 2, h: 2 };
    const silo = { x: forgeX + 12, y: 9, w: 8, h: 8 };
    const width = silo.x + silo.w + 3;
    // Gisements : un par domaine du projet, largeur selon le nombre d'elements.
    const rooms = M.inv ? T.rooms(M.inv) : [];
    const patches = [];
    let px = 2;
    const avail = width - 4;
    const raw = rooms.map(r => Math.max(3, Math.min(8, Math.round(2 + 1.6 * Math.log10(r.count + 1)))));
    const total = raw.reduce((s, w) => s + w + 1, 0);
    const k = total > avail ? avail / total : 1;
    rooms.forEach((r, i) => {
      const w = Math.max(2, Math.floor(raw[i] * k));
      patches.push({ r, x: px, y: 2, w, h: 4 });
      px += w + 1;
    });
    const you = { x: silo.x - 2.2, y: silo.y + silo.h - 1 };
    return { machines, forge, beltY, okChest, koChest, silo, patches, you, w: width, h: 23, x0 };
  }

  // ---------- dessin ----------
  function tileNoise(x, y) { return ((x * 73856093) ^ (y * 19349663)) & 7; }

  function drawGround(c, W) {
    // Le terrain couvre tout l'ecran, pas seulement l'usine : on ne voit jamais le bord du monde.
    const vw = G.canvas.width / G.dpr / G.cam.z, vh = G.canvas.height / G.dpr / G.cam.z;
    const x0 = Math.floor(G.cam.x / TS) - 1, y0 = Math.floor(G.cam.y / TS) - 1;
    const x1 = Math.ceil((G.cam.x + vw) / TS) + 1, y1 = Math.ceil((G.cam.y + vh) / TS) + 1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const n = tileNoise(x, y);
      c.fillStyle = n < 2 ? COL.ground2 : COL.ground;
      c.fillRect(x * TS, y * TS, TS, TS);
      const out = x < 0 || y < 0 || x >= W.w || y >= W.h;
      const k = Math.imul(x, 374761393) + Math.imul(y, 668265263) >>> 0;
      if (out && ((k ^ (k >>> 13)) >>> 0) % 23 === 0) { // cailloux et touffes hors de l'usine
        const rock = (k >>> 5) & 1;
        c.fillStyle = rock ? '#4d463d' : '#46502f';
        c.fillRect(x * TS + 4, y * TS + 6, rock ? 8 : 6, 6);
        c.fillStyle = rock ? '#5e564b' : '#56623a';
        c.fillRect(x * TS + 5, y * TS + 6, rock ? 4 : 3, 2);
      }
    }
    // Dalle de beton sous la ligne de production.
    c.fillStyle = COL.concrete;
    c.fillRect(1 * TS, 8 * TS, (W.w - 2) * TS, 14 * TS);
    for (let y = 8; y < 22; y++) for (let x = 1; x < W.w - 1; x++) if (tileNoise(x, y) === 0) { c.fillStyle = COL.concrete2; c.fillRect(x * TS, y * TS, TS, TS); }
    c.strokeStyle = COL.grid; c.lineWidth = 1;
    for (let x = 1; x < W.w; x++) { c.beginPath(); c.moveTo(x * TS + .5, 8 * TS); c.lineTo(x * TS + .5, 22 * TS); c.stroke(); }
    for (let y = 8; y <= 22; y++) { c.beginPath(); c.moveTo(TS, y * TS + .5); c.lineTo((W.w - 1) * TS, y * TS + .5); c.stroke(); }
    // Bandes de securite au bord de la dalle.
    for (let x = 1; x < W.w - 1; x++) { c.fillStyle = x % 2 ? '#d9b02b' : '#2b2722'; c.fillRect(x * TS, 8 * TS - 3, TS, 3); }
  }

  function drawPatch(c, p, t) {
    const rand = rnd(hash(p.r.id));
    c.fillStyle = 'rgba(0,0,0,.18)';
    c.fillRect(p.x * TS - 2, p.y * TS - 2, p.w * TS + 4, p.h * TS + 4);
    const dots = Math.min(90, 10 + p.w * p.h * 2);
    for (let i = 0; i < dots; i++) {
      const x = p.x * TS + rand() * p.w * TS, y = p.y * TS + rand() * p.h * TS, s = 2 + Math.floor(rand() * 4);
      c.fillStyle = T.lower ? window.Avatar.shade(p.r.color, rand() * .5 - .3) : p.r.color;
      c.fillRect(Math.floor(x), Math.floor(y), s, s);
    }
    if (p.r.recent) { // une foreuse qui tourne
      const dx = (p.x + p.w / 2 - 1) * TS, dy = (p.y + p.h - 2.4) * TS;
      c.fillStyle = COL.shadow; c.fillRect(dx + 3, dy + 3, 2 * TS, 2 * TS);
      c.fillStyle = COL.steelDark; c.fillRect(dx, dy, 2 * TS, 2 * TS);
      c.fillStyle = COL.steel; c.fillRect(dx + 2, dy + 2, 2 * TS - 4, 2 * TS - 4);
      const a = reduced ? 0 : t * 4;
      c.save(); c.translate(dx + TS, dy + TS); c.rotate(a);
      c.fillStyle = COL.steelDark; c.fillRect(-9, -2, 18, 4); c.fillRect(-2, -9, 4, 18);
      c.restore();
      c.fillStyle = COL.warn; c.fillRect(dx + 2, dy + 2, 4, 4);
    }
  }

  function box(c, x, y, w, hgt, body, light, dark) {
    c.fillStyle = COL.shadow; c.fillRect(x + 4, y + 5, w, hgt);
    c.fillStyle = dark; c.fillRect(x, y, w, hgt);
    c.fillStyle = body; c.fillRect(x + 2, y + 2, w - 4, hgt - 5);
    c.fillStyle = light; c.fillRect(x + 2, y + 2, w - 4, 2);
  }

  function gear(c, cx, cy, r, a, color) {
    c.save(); c.translate(cx, cy); c.rotate(a); c.fillStyle = color;
    for (let i = 0; i < 8; i++) { c.rotate(Math.PI / 4); c.fillRect(-2, -r - 3, 4, 5); }
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = COL.steelDark; c.beginPath(); c.arc(0, 0, r * .38, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawMachine(c, m, t) {
    const a = m.a, x = m.x * TS, y = m.y * TS, w = m.w * TS, hh = m.h * TS;
    if (a.st === 'ended') { // fantome bleu : la machine a ete demontee
      c.strokeStyle = COL.ghost; c.setLineDash([4, 3]); c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, hh - 2); c.setLineDash([]);
      c.fillStyle = 'rgba(110,170,255,.12)'; c.fillRect(x, y, w, hh);
      return;
    }
    const on = a.st === 'working' || a.holds;
    box(c, x, y, w, hh, a.st === 'silent' ? '#6b6e72' : '#7d8288', COL.steelLight, COL.steelDark);
    gear(c, x + w / 2, y + hh / 2 - 2, 11, on && !reduced ? t * 2.2 : 0.3, on ? '#c7ccd2' : '#9aa0a6');
    // voyant d'etat
    const lamp = a.st === 'waiting' ? COL.warn : a.st === 'idle' ? COL.ok : on ? COL.blue : '#6f747a';
    c.fillStyle = '#1e1f22'; c.fillRect(x + w - 10, y + 5, 6, 6);
    c.fillStyle = lamp; c.fillRect(x + w - 9, y + 6, 4, 4);
    // bras qui pose les caisses sur le tapis
    c.fillStyle = COL.steelDark; c.fillRect(x + w / 2 - 2, y + hh, 4, TS * 2.2);
    c.fillStyle = COL.warn; c.fillRect(x + w / 2 - 4, y + hh + TS * 2.2 - 4, 8, 4);
    // fumee quand ca tourne
    if (on && !reduced) for (let i = 0; i < 3; i++) {
      const p = ((t * .6 + i / 3) % 1);
      c.fillStyle = `rgba(200,200,200,${.35 * (1 - p)})`;
      const s = 4 + p * 8;
      c.fillRect(x + 8 - s / 2 + p * 6, y - p * 26, s, s);
    }
  }

  // Tapis : chevrons qui avancent.
  function belt(c, x1, x2, y, t, moving) {
    const yy = y * TS - 6;
    c.fillStyle = COL.beltDark; c.fillRect(x1 * TS, yy, (x2 - x1) * TS, 12);
    c.fillStyle = COL.belt; c.fillRect(x1 * TS, yy + 2, (x2 - x1) * TS, 8);
    const off = moving && !reduced ? (t * 24) % 8 : 0;
    c.fillStyle = COL.beltDark;
    for (let x = x1 * TS + off; x < x2 * TS - 4; x += 8) { c.fillRect(Math.floor(x), yy + 3, 2, 2); c.fillRect(Math.floor(x) + 2, yy + 5, 2, 2); c.fillRect(Math.floor(x), yy + 7, 2, 2); }
  }
  function vbelt(c, x, y1, y2, t, color) {
    const xx = x * TS - 3;
    c.fillStyle = COL.beltDark; c.fillRect(xx, y1 * TS, 6, (y2 - y1) * TS);
    c.fillStyle = COL.belt; c.fillRect(xx + 1, y1 * TS, 4, (y2 - y1) * TS);
    if (!reduced) for (let i = 0; i < 3; i++) {
      const p = (t * .35 + i / 3) % 1;
      c.fillStyle = color; c.fillRect(xx, (y1 + (y2 - y1) * p) * TS - 3, 6, 6);
    }
  }

  function crate(c, x, y, look, label) {
    c.fillStyle = COL.shadow; c.fillRect(x - 6, y - 4, 14, 12);
    c.fillStyle = '#a0723c'; c.fillRect(x - 7, y - 7, 14, 12);
    c.fillStyle = '#7a5428'; c.fillRect(x - 7, y - 2, 14, 2); c.fillRect(x - 1, y - 7, 2, 12);
    c.fillStyle = (look && look.shirt) || COL.blue; c.fillRect(x - 5, y - 5, 4, 3);
  }

  function drawForge(c, W, t) {
    const f = W.forge, x = f.x * TS, y = f.y * TS, w = f.w * TS, hh = f.h * TS;
    const lit = !!G.M.lock;
    box(c, x, y, w, hh, '#8a5a3c', '#a77455', '#4a2f20');
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x + 3 + k * 15 + (r % 2) * 7, y + 6 + r * 13, 12, 1); }
    c.fillStyle = '#1b120d'; c.fillRect(x + 14, y + 22, w - 28, 26);
    if (lit) {
      const fl = reduced ? 1 : .75 + .25 * Math.sin(t * 13) * Math.sin(t * 7.3);
      c.fillStyle = COL.fire; c.globalAlpha = fl; c.fillRect(x + 16, y + 30, w - 32, 16);
      c.fillStyle = COL.fireHot; c.fillRect(x + 22, y + 36, w - 44, 8); c.globalAlpha = 1;
      const g = c.createRadialGradient(x + w / 2, y + hh / 2, 4, x + w / 2, y + hh / 2, 70);
      g.addColorStop(0, 'rgba(255,140,40,.28)'); g.addColorStop(1, 'rgba(255,140,40,0)');
      c.fillStyle = g; c.fillRect(x - 60, y - 60, w + 120, hh + 120);
    }
    // cheminee
    c.fillStyle = '#4a2f20'; c.fillRect(x + w - 16, y - 12, 10, 16);
    if (lit && !reduced) for (let i = 0; i < 3; i++) { const p = (t * .5 + i / 3) % 1; c.fillStyle = `rgba(90,90,90,${.5 * (1 - p)})`; c.fillRect(x + w - 15 + p * 10, y - 14 - p * 30, 6 + p * 8, 6 + p * 8); }
  }

  function drawChest(c, ch, ok, count) {
    const x = ch.x * TS, y = ch.y * TS, w = ch.w * TS;
    box(c, x, y, w, w, ok ? '#58704a' : '#7a3a32', ok ? '#7c9a6a' : '#a3544a', '#2a2620');
    c.fillStyle = '#2a2620'; c.fillRect(x + 2, y + w / 2 - 2, w - 4, 3);
    c.fillStyle = '#d9b02b'; c.fillRect(x + w / 2 - 3, y + w / 2 - 4, 6, 6);
  }

  function drawSilo(c, W, t) {
    const s = W.silo, x = s.x * TS, y = s.y * TS, w = s.w * TS;
    const camp = G.M.campaign;
    box(c, x, y, w, w, '#6d7176', '#9ca1a7', '#3c3f43');
    c.fillStyle = '#26282b'; c.beginPath(); c.arc(x + w / 2, y + w / 2, w * .34, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d9b02b'; c.lineWidth = 3; c.setLineDash([6, 5]); c.beginPath(); c.arc(x + w / 2, y + w / 2, w * .4, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    if (camp) { // la fusee sort du puits a mesure que les features sont pretes
      const p = camp.won ? 1 : camp.total ? camp.proven / camp.total : 0;
      const cx = x + w / 2, cy = y + w / 2, rh = 18 + p * 30;
      c.save(); c.beginPath(); c.arc(cx, cy, w * .34, 0, Math.PI * 2); c.clip();
      c.fillStyle = '#e8e4da'; c.fillRect(cx - 7, cy + 18 - rh, 14, rh);
      c.fillStyle = COL.ko; c.beginPath(); c.moveTo(cx - 7, cy + 18 - rh); c.lineTo(cx, cy + 6 - rh); c.lineTo(cx + 7, cy + 18 - rh); c.fill();
      c.fillStyle = '#3c3f43'; c.fillRect(cx - 3, cy + 26 - rh, 6, 5);
      c.restore();
      // jauge des pieces
      const gx = x + 8, gy = y + w - 12, gw = w - 16;
      c.fillStyle = '#1e1f22'; c.fillRect(gx, gy, gw, 6);
      c.fillStyle = camp.won ? COL.ok : COL.blue; c.fillRect(gx + 1, gy + 1, Math.round((gw - 2) * p), 4);
    }
  }

  function drawWorld(c, W, t) {
    const M = G.M;
    drawGround(c, W);
    for (const p of W.patches) drawPatch(c, p, t);
    // tapis d'alimentation : du gisement touche jusqu'a la machine de l'agent qui y travaille
    W.machines.forEach((m, i) => {
      if (m.a.st !== 'working' || !m.a.room) return;
      const p = W.patches.find(q => q.r.id === m.a.room);
      if (!p) return;
      const px = p.x + p.w / 2, mx = m.x + 1.5, lane = 7 + (i % 3) * .5;
      vbelt(c, px, p.y + p.h, lane, t, p.r.color);
      c.fillStyle = COL.beltDark; c.fillRect(Math.min(px, mx) * TS, lane * TS - 3, Math.abs(mx - px) * TS + 3, 6);
      c.fillStyle = COL.belt; c.fillRect(Math.min(px, mx) * TS, lane * TS - 2, Math.abs(mx - px) * TS + 3, 4);
      vbelt(c, mx, lane, m.y, t, p.r.color);
    });
    // tapis principal vers le four, puis sorties vers les coffres
    const busy = !!M.lock;
    belt(c, W.x0 - 1, W.forge.x, W.beltY + .5, t, busy || M.queue.length > 0);
    belt(c, W.forge.x + W.forge.w, W.okChest.x, W.okChest.y + 1, t, busy);
    belt(c, W.forge.x + W.forge.w, W.koChest.x, W.koChest.y + 1, t, busy);
    c.fillStyle = COL.beltDark; c.fillRect((W.forge.x + W.forge.w + 1.5) * TS - 3, (W.okChest.y + 1) * TS, 6, (W.koChest.y - W.okChest.y) * TS);
    for (const m of W.machines) drawMachine(c, m, t);
    // caisses en attente sur le tapis, devant le four
    M.queue.forEach((q, i) => crate(c, (W.forge.x - 1 - i * 1.6) * TS, (W.beltY + .5) * TS, q.agent && q.agent.look));
    drawForge(c, W, t);
    drawChest(c, W.okChest, true);
    drawChest(c, W.koChest, false);
    drawSilo(c, W, t);
    // personnages : devant leur machine ; celui qui compile au four
    const people = [];
    for (const m of W.machines) {
      if (m.a.st === 'ended') continue;
      if (m.a.holds) people.push({ a: m.a, x: (W.forge.x - .2) * TS, y: (W.forge.y + .6) * TS });
      else people.push({ a: m.a, x: (m.x - 1.4) * TS, y: (m.y + .2) * TS });
    }
    people.push({ you: true, x: W.you.x * TS, y: W.you.y * TS });
    people.sort((p, q) => p.y - q.y);
    for (const p of people) {
      const st = p.you ? 'ready' : p.a.st;
      const im = p.you ? avatarImg({ hat: 'casquette', hatColor: '#78a6ff', accessory: 'casque-audio', tool: 'clavier', shirt: '#334155' }, st) : avatarImg(p.a.look, p.a.holds ? 'working' : st);
      const bob = st === 'working' && !reduced ? Math.round(Math.sin(t * 9 + p.x) * 1) : 0;
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(p.x + 11, p.y + 34, 9, 3, 0, 0, Math.PI * 2); c.fill();
      if (im.complete && im.naturalWidth) c.drawImage(im, p.x, p.y - 2 + bob, 22, 35);
      if (!p.you && G.sel && G.sel.kind === 'agent' && G.sel.id === p.a.id) {
        c.strokeStyle = COL.ok; c.lineWidth = 1.5; c.beginPath(); c.ellipse(p.x + 11, p.y + 34, 13, 5, 0, 0, Math.PI * 2); c.stroke();
      }
    }
    // alertes facon jeu : triangle qui clignote au-dessus des machines qui t'attendent
    for (const m of W.machines) {
      if (m.a.st !== 'waiting' && m.a.st !== 'idle') continue;
      const blink = reduced || Math.floor(t * 2) % 2 === 0;
      if (!blink && m.a.st === 'waiting') continue;
      const x = (m.x + 1.5) * TS, y = m.y * TS - 14;
      c.fillStyle = m.a.st === 'waiting' ? COL.warn : COL.ok;
      c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + 10, y + 7); c.lineTo(x - 10, y + 7); c.closePath(); c.fill();
      c.fillStyle = '#1e1f22'; c.fillRect(x - 1, y - 4, 2, 6); c.fillRect(x - 1, y + 3, 2, 2);
    }
  }

  // Textes en coordonnees ecran (nets a tout zoom).
  function label(c, text, sx, sy, opts = {}) {
    c.font = `${opts.weight || 600} ${opts.size || 13}px "Barlow Condensed", "Segoe UI", sans-serif`;
    const w = c.measureText(text).width + 10;
    c.fillStyle = opts.bg || 'rgba(20,20,22,.78)';
    c.fillRect(Math.round(sx - w / 2), Math.round(sy - 9), Math.round(w), 18);
    if (opts.edge) { c.fillStyle = opts.edge; c.fillRect(Math.round(sx - w / 2), Math.round(sy + 7), Math.round(w), 2); }
    c.fillStyle = opts.color || COL.text; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, Math.round(sx), Math.round(sy));
  }
  function drawLabels(c, W) {
    const z = G.cam.z, S = (x, y) => [(x * TS - G.cam.x) * z, (y * TS - G.cam.y) * z];
    const small = z < 1.4;
    for (const p of W.patches) {
      const [sx, sy] = S(p.x + p.w / 2, p.y + p.h + .9);
      label(c, small ? p.r.name : `${p.r.name} ${T.num(p.r.count)}${p.r.recent ? '  +' + p.r.recent : ''}`, sx, sy, { edge: p.r.color, size: small ? 11 : 13 });
    }
    for (const m of W.machines) {
      const [sx, sy] = S(m.x + 1.5, m.y + m.h + .7);
      const sel = G.sel && G.sel.kind === 'agent' && G.sel.id === m.a.id;
      label(c, m.a.name, sx, sy, { edge: m.a.st === 'waiting' ? COL.warn : m.a.st === 'idle' ? COL.ok : m.a.st === 'working' ? COL.blue : '#777', color: sel ? COL.ok : COL.text, size: small ? 11 : 14, weight: 700 });
    }
    const [fx, fy] = S(W.forge.x + 2, W.forge.y + W.forge.h + .8);
    label(c, G.M.lock ? `Forge : ${G.M.lock.agent ? G.M.lock.agent.name : G.M.lock.label}` : 'Forge libre', fx, fy, { edge: G.M.lock ? COL.fire : '#777', weight: 700 });
    const [ox, oy] = S(W.okChest.x + 1, W.okChest.y - .6);
    label(c, `Réussis ${G.M.builds.filter(b => b.ok).length}`, ox, oy, { edge: COL.ok, size: 12 });
    const [kx, ky] = S(W.koChest.x + 1, W.koChest.y + W.koChest.h + .7);
    label(c, `Échecs ${G.M.builds.filter(b => !b.ok).length}`, kx, ky, { edge: COL.ko, size: 12 });
    const camp = G.M.campaign;
    const [qx, qy] = S(W.silo.x + W.silo.w / 2, W.silo.y + W.silo.h + .8);
    label(c, camp ? (camp.won ? `${camp.name} lancée` : `Fusée ${camp.name} : ${camp.proven}/${camp.total}`) : 'Silo vide : prépare une version', qx, qy, { edge: camp && camp.won ? COL.ok : COL.blue, weight: 700 });
  }

  // ---------- boucle ----------
  function resize() {
    const cv = G.canvas, r = cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    G.dpr = dpr;
    if (!G.userMoved) fit();
  }
  function fit() {
    const W = G.world; if (!W) return;
    const vw = G.canvas.width / G.dpr, vh = G.canvas.height / G.dpr;
    const wide = vw > 900;
    // Sur grand ecran, le HUD prend les bords : on cadre l'usine dans la zone libre.
    const padL = wide ? 20 : 8, padR = wide ? 290 : 8, padT = wide ? 96 : 8, padB = wide ? 110 : 8;
    const z = Math.min((vw - padL - padR) / (W.w * TS), (vh - padT - padB) / (W.h * TS));
    G.cam.z = Math.max(.35, Math.min(4, z));
    G.cam.x = W.w * TS / 2 - (padL + (vw - padL - padR) / 2) / G.cam.z;
    G.cam.y = W.h * TS / 2 - (padT + (vh - padT - padB) / 2) / G.cam.z;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!G.world || document.hidden || !G.canvas.isConnected) return;
    if (reduced && now - G.last < 1000 && !G.dirty) return;
    G.last = now; G.dirty = false;
    G.t = now / 1000;
    const c = G.ctx, cv = G.canvas;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#211e1b'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(G.dpr * G.cam.z, 0, 0, G.dpr * G.cam.z, -G.cam.x * G.cam.z * G.dpr, -G.cam.y * G.cam.z * G.dpr);
    c.imageSmoothingEnabled = false;
    drawWorld(c, G.world, G.t);
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    drawLabels(c, G.world);
    drawMini();
  }

  function drawMini() {
    const m = G.mini; if (!m || !G.world) return;
    const W = G.world, c = m.getContext('2d');
    const mh = Math.max(40, Math.min(160, Math.round(m.width * W.h / W.w)));
    if (m.height !== mh) m.height = mh;
    const s = Math.min(m.width / (W.w * TS), m.height / (W.h * TS));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#16140f'; c.fillRect(0, 0, m.width, m.height);
    c.setTransform(s, 0, 0, s, 0, 0);
    c.fillStyle = COL.concrete; c.fillRect(TS, 8 * TS, (W.w - 2) * TS, 14 * TS);
    for (const p of W.patches) { c.fillStyle = p.r.color; c.fillRect(p.x * TS, p.y * TS, p.w * TS, p.h * TS); }
    for (const mm of W.machines) { c.fillStyle = mm.a.st === 'waiting' ? COL.warn : mm.a.st === 'idle' ? COL.ok : mm.a.st === 'working' ? COL.blue : '#777'; c.fillRect(mm.x * TS, mm.y * TS, mm.w * TS, mm.h * TS); }
    c.fillStyle = G.M.lock ? COL.fire : '#8a5a3c'; c.fillRect(W.forge.x * TS, W.forge.y * TS, W.forge.w * TS, W.forge.h * TS);
    c.fillStyle = '#9ca1a7'; c.fillRect(W.silo.x * TS, W.silo.y * TS, W.silo.w * TS, W.silo.h * TS);
    const vw = G.canvas.width / G.dpr / G.cam.z, vh = G.canvas.height / G.dpr / G.cam.z;
    c.strokeStyle = '#fff'; c.lineWidth = 2 / s; c.strokeRect(G.cam.x, G.cam.y, vw, vh);
  }

  // ---------- interaction ----------
  function worldAt(ev) {
    const r = G.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / G.cam.z + G.cam.x, y: (ev.clientY - r.top) / G.cam.z + G.cam.y };
  }
  function hit(p) {
    const W = G.world, inR = (o, pad = 0) => p.x >= (o.x - pad) * TS && p.x <= (o.x + o.w + pad) * TS && p.y >= (o.y - pad) * TS && p.y <= (o.y + o.h + pad) * TS;
    for (const m of W.machines) {
      if (inR({ x: m.x - 1.6, y: m.y - .2, w: m.w + 1.6, h: m.h + 1.2 })) return { kind: 'agent', id: m.a.id };
    }
    if (G.M.lock) { const a = G.M.lock.agent; if (a && inR({ x: W.forge.x - .4, y: W.forge.y + .4, w: 1.6, h: 2.4 })) return { kind: 'agent', id: a.id }; }
    if (inR(W.forge, .3)) return { kind: 'forge' };
    if (inR(W.okChest, .3)) return { kind: 'ok' };
    if (inR(W.koChest, .3)) return { kind: 'ko' };
    if (inR(W.silo)) return { kind: 'silo' };
    for (const pt of W.patches) if (inR(pt, .2)) return { kind: 'patch', id: pt.r.id };
    return null;
  }
  function select(sel, center) {
    G.sel = sel;
    if (sel && sel.kind === 'patch') T.ui.mapRoom = sel.id;
    if (center && sel) {
      const W = G.world;
      let o = sel.kind === 'agent' ? W.machines.find(m => m.a.id === sel.id) : sel.kind === 'forge' ? W.forge : sel.kind === 'silo' ? W.silo : sel.kind === 'ok' ? W.okChest : sel.kind === 'ko' ? W.koChest : W.patches.find(p => p.r.id === sel.id);
      if (o) {
        const vw = G.canvas.width / G.dpr / G.cam.z, vh = G.canvas.height / G.dpr / G.cam.z;
        const ox = (o.x + o.w / 2) * TS, oy = (o.y + o.h / 2) * TS;
        if (ox < G.cam.x + vw * .15 || ox > G.cam.x + vw * .7 || oy < G.cam.y + vh * .15 || oy > G.cam.y + vh * .7) {
          G.cam.x = ox - vw * .4; G.cam.y = oy - vh * .45; G.userMoved = true;
        }
      }
    }
    G.dirty = true;
    renderHud();
  }
  function bindCanvas() {
    const cv = G.canvas;
    cv.addEventListener('pointerdown', (e) => { G.drag = { x: e.clientX, y: e.clientY, cx: G.cam.x, cy: G.cam.y, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (G.drag) {
        const dx = e.clientX - G.drag.x, dy = e.clientY - G.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) G.drag.moved = true;
        if (G.drag.moved) { G.cam.x = G.drag.cx - dx / G.cam.z; G.cam.y = G.drag.cy - dy / G.cam.z; G.userMoved = true; G.dirty = true; }
      } else {
        const hv = hit(worldAt(e));
        cv.style.cursor = hv ? 'pointer' : 'grab';
      }
    });
    cv.addEventListener('pointerup', (e) => {
      const d = G.drag; G.drag = null;
      if (d && !d.moved) select(hit(worldAt(e)), false);
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = worldAt(e), z = Math.max(.3, Math.min(5, G.cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const r = G.canvas.getBoundingClientRect();
      G.cam.z = z; G.cam.x = p.x - (e.clientX - r.left) / z; G.cam.y = p.y - (e.clientY - r.top) / z;
      G.userMoved = true; G.dirty = true;
    }, { passive: false });
    G.mini.addEventListener('click', (e) => {
      const W = G.world, r = G.mini.getBoundingClientRect();
      const s = Math.min(G.mini.width / (W.w * TS), G.mini.height / (W.h * TS)) * (r.width / G.mini.width);
      const vw = G.canvas.width / G.dpr / G.cam.z, vh = G.canvas.height / G.dpr / G.cam.z;
      G.cam.x = (e.clientX - r.left) / s - vw / 2; G.cam.y = (e.clientY - r.top) / s - vh / 2;
      G.userMoved = true; G.dirty = true;
    });
    if (G.keysBound) return; // la fenetre et le clavier ne s'abonnent qu'une fois, meme si on revient sur ce template
    G.keysBound = true;
    window.addEventListener('resize', () => { if (G.canvas.isConnected) { resize(); G.dirty = true; } });
    document.addEventListener('keydown', (e) => {
      if (!G.canvas.isConnected) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const W = G.world; if (!W) return;
      if (/^[1-9]$/.test(e.key)) { const m = W.machines[+e.key - 1]; if (m) { select({ kind: 'agent', id: m.a.id }, true); e.preventDefault(); } }
      else if (e.key === 'Escape') select(null);
      else if (e.key === 'f' || e.key === 'F') select({ kind: 'forge' }, true);
      else if (e.key === 'v' || e.key === 'V') select({ kind: 'silo' }, true);
      else if (e.key === 'j' || e.key === 'J') select({ kind: G.M.builds.some(b => !b.ok) ? 'ko' : 'ok' }, true);
      else if (e.key === 'Home' || e.key === '0') { G.userMoved = false; fit(); G.dirty = true; }
      else if (e.key.startsWith('Arrow')) {
        const s = 60 / G.cam.z;
        if (e.key === 'ArrowLeft') G.cam.x -= s; if (e.key === 'ArrowRight') G.cam.x += s; if (e.key === 'ArrowUp') G.cam.y -= s; if (e.key === 'ArrowDown') G.cam.y += s;
        G.userMoved = true; G.dirty = true; e.preventDefault();
      }
    });
  }

  // ---------- HUD ----------
  const dotFor = (st) => ({ waiting: 'warn', idle: 'ok', working: 'blue', ready: 'grey', silent: 'grey', ended: 'grey' }[st] || 'grey');
  const btn = (text, onclick, cls = '', attrs = {}) => h('button', { type: 'button', class: 'us-btn ' + cls, onclick, ...attrs }, text);

  function topLeft(M) {
    const c = M.campaign;
    const e = M.editor;
    return [
      h('div', { class: 'us-panel us-research', role: 'button', tabindex: 0, title: 'Voir la version (V)', onclick: () => select({ kind: 'silo' }, true), onkeydown: (ev) => { if (ev.key === 'Enter') select({ kind: 'silo' }, true); } },
        c ? [
          h('div', { class: 'us-ptitle' }, c.won ? `${c.name} : fusée lancée` : `Version ${c.name}`),
          h('div', { class: 'us-bar' }, h('i', { style: `width:${c.won ? 100 : c.pct}%` })),
          h('div', { class: 'us-research-line' }, c.won ? 'Version validée.' : `${c.proven} sur ${c.total} features prêtes`, c.next ? h('span', { class: `us-t-${c.next.tone}` }, c.next.text) : null)]
          : [h('div', { class: 'us-ptitle' }, 'Aucune version en cours'), h('div', { class: 'us-research-line' }, 'Le silo attend sa fusée.'), btn('Préparer une version', (ev) => { ev.stopPropagation(); T.act.openBuilder(); }, 'us-go')]),
      h('div', { class: 'us-panel us-status' },
        h('span', { class: 'us-live ' + (M.demo ? 'demo' : M.connected ? 'on' : 'off') }, M.demo ? 'Démo' : M.connected ? 'En direct' : 'Tour injoignable'),
        h('span', null, e.plugin ? [h('b', null, e.map || 'aucune map'), e.pie ? ', partie lancée' : '', e.liveCoding.compiling ? ', Live Coding compile' : '',
          e.dirty ? h('span', { class: 'us-t-warn', title: e.dirtyNames.join(', ') }, `, ${T.plural(e.dirty, 'asset non sauvegardé', 'assets non sauvegardés')}`) : ''] : `Éditeur ${e.text}`)),
    ];
  }

  function alertsPanel(M) {
    const icon = (tone) => h('span', { class: `us-tri us-tri-${tone}`, 'aria-hidden': 'true' });
    return h('div', { class: 'us-panel us-alerts' },
      h('div', { class: 'us-ptitle' }, M.attention.length ? `Alertes (${M.attention.length})` : 'Aucune alerte'),
      M.attention.length ? h('ul', null, M.attention.map(x => h('li', null,
        h('button', { type: 'button', class: `us-alert us-a-${x.tone}`, onclick: () => x.agent ? select({ kind: 'agent', id: x.agent.id }, true) : x.feature ? select({ kind: 'silo' }, true) : null },
          icon(x.tone), h('span', null, h('b', null, x.title), x.text ? h('small', null, x.text) : null)))))
        : h('p', { class: 'us-dim' }, 'Toutes les machines tournent sans toi.'));
  }

  function quickbar(M) {
    const W = G.world;
    return h('div', { class: 'us-panel us-quick' },
      h('div', { class: 'us-slots' }, (W ? W.machines : []).slice(0, 9).map((m, i) => {
        const sel = G.sel && G.sel.kind === 'agent' && G.sel.id === m.a.id;
        return h('button', { type: 'button', class: `us-slot us-s-${dotFor(m.a.st)}${sel ? ' sel' : ''}`, title: `${m.a.name} : ${m.a.stText} (touche ${i + 1})`, onclick: () => select({ kind: 'agent', id: m.a.id }, true) },
          T.avatar(m.a.look, m.a.st === 'ended' ? 'ended' : m.a.st, 34), h('kbd', null, String(i + 1)));
      })),
      h('div', { class: 'us-cmds' },
        btn('Forge', () => select({ kind: 'forge' }, true), '', { title: 'Touche F' }),
        btn('Version', () => select({ kind: 'silo' }, true), '', { title: 'Touche V' }),
        btn('Journal', () => select({ kind: G.M.builds.some(b => !b.ok) ? 'ko' : 'ok' }, true), '', { title: 'Touche J' }),
        btn(T.ui.showEnded ? 'Masquer terminées' : `Terminées (${M.endedCount})`, () => T.act.toggleEnded(), '', { disabled: !M.endedCount && !T.ui.showEnded }),
        btn('Recadrer', () => { G.userMoved = false; fit(); G.dirty = true; }, '', { title: 'Touche 0' })));
  }

  function rowsOf(pairs) { return h('dl', { class: 'us-dl' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])); }
  function resultTxt(b) { return b ? [h('span', { class: b.ok ? 'us-t-ok' : 'us-t-ko' }, b.ok ? 'réussi' : 'en échec'), ' ', b.summary || '', ', ', T.agoEl(b.endedAt)] : null; }

  function entityPanel(M) {
    const s = G.sel;
    if (!s) return null;
    const close = btn('Fermer', () => select(null), 'us-x', { 'aria-label': 'Fermer la fiche', title: 'Échap' });
    let title, body;
    if (s.kind === 'agent') {
      const a = M.agents.find(x => x.id === s.id);
      if (!a) return null;
      title = a.name;
      body = [
        h('div', { class: 'us-who' }, h('button', { type: 'button', class: 'us-portrait', title: 'Personnaliser', onclick: () => T.act.openChar(a.id) }, T.avatar(a.look, a.st, 88)),
          h('div', null, h('div', { class: 'us-dim' }, a.role || a.where),
            h('div', { class: `us-state us-s-${dotFor(a.st)}` }, a.holds ? `${a.stText}, à la forge` : a.queuePos ? `${a.stText}, ${a.queuePos}e devant la forge` : a.stText),
            h('div', { class: 'us-dim' }, 'vu ', T.agoEl(a.lastSeen)))),
        a.ask ? h('p', { class: 'us-ask' }, h('b', null, 'Sa question : '), a.ask, h('small', null, 'Réponds dans sa session Claude Code.')) : null,
        a.said ? h('p', { class: 'us-said' }, h('b', null, 'Il a fini : '), a.said) : null,
        rowsOf([
          a.prompt && ['Demande', a.prompt],
          a.tool && ['Fait', [h('b', null, a.tool.name), ' ', a.tool.summary, ', ', T.agoEl(a.tool.at)]],
          a.roomName && ['Gisement', a.roomName],
          a.subs && ['Aides', T.plural(a.subs, 'sous-agent', 'sous-agents')],
          a.lastBuild && ['Compilation', resultTxt(a.lastBuild)],
          a.lastTest && ['Tests', resultTxt(a.lastTest)],
          a.docs && ['Doc UE', h('span', { class: a.docs.tone === 'warn' ? 'us-t-warn' : a.docs.tone === 'ok' ? 'us-t-ok' : 'us-dim' }, a.docs.text)],
        ]),
        h('div', { class: 'us-actions' }, btn('Personnage', () => T.act.openChar(a.id)), a.st === 'ended' || a.st === 'silent' ? btn('Retirer', () => { T.act.forget(a.id); select(null); }, 'us-danger') : null),
      ];
    } else if (s.kind === 'patch') {
      const r = M.inv && T.room(M.inv, s.id);
      if (!r) return null;
      title = `Gisement ${r.name}`;
      body = [
        h('p', null, h('b', null, T.num(r.count)), ' éléments. ', r.recent ? h('span', { class: 'us-t-warn' }, `${r.recent} modifiés ces 3 derniers jours : la foreuse tourne.`) : 'Rien de modifié ces 3 derniers jours.'),
        r.workers.length ? h('p', null, 'Y travaille : ', h('b', null, r.workers.join(', '))) : null,
        rowsOf([['Rangé dans', r.folders.slice(0, 5).map(f => `${f.name} (${T.num(f.n)})`).join(', ')], ['Derniers', r.latest.slice(0, 5).map(l => l.name).join(', ')]]),
        h('div', { class: 'us-actions' }, btn('Recompter le projet', T.act.refreshMap)),
      ];
    } else if (s.kind === 'forge') {
      const L = M.lock;
      title = 'La forge';
      body = [
        h('p', { class: 'us-dim' }, 'Un seul build, test ou package Unreal à la fois sur le PC. Les autres attendent sur le tapis.'),
        L ? [h('p', null, h('b', null, `${L.kindText} de ${L.agent ? L.agent.name : L.label}`), L.target ? ` (${L.target})` : '', ', depuis ', T.forEl(L.since)),
          h('code', { class: 'us-code' }, L.command), h('div', { class: 'us-actions' }, btn('Libérer la forge', T.act.release, 'us-danger', { title: 'Si le build est bloqué' }))]
          : h('p', { class: 'us-t-ok' }, 'Libre : le prochain agent qui compile passe tout de suite.'),
        M.queue.length ? [h('div', { class: 'us-sub' }, 'Sur le tapis'), h('ol', { class: 'us-list' }, M.queue.map(q => h('li', null, h('b', null, q.agent ? q.agent.name : q.label), ` : ${T.lower(q.kindText)}, attend depuis `, T.forEl(q.since))))] : null,
        M.chantiers.length ? [h('div', { class: 'us-sub' }, 'Zones réservées par les agents'), h('ul', { class: 'us-list' }, M.chantiers.map(x => h('li', null, h('b', null, x.file), ` ${x.text} `, h('span', { class: 'us-dim' }, T.agoEl(x.mtime)))))] : null,
      ];
    } else if (s.kind === 'ok' || s.kind === 'ko') {
      const ok = s.kind === 'ok';
      const list = M.builds.filter(b => b.ok === ok);
      title = ok ? 'Coffre des builds réussis' : 'Coffre des échecs';
      body = [
        h('div', { class: 'us-actions' }, btn(ok ? 'Voir les échecs' : 'Voir les réussis', () => select({ kind: ok ? 'ko' : 'ok' }))),
        list.length ? h('ul', { class: 'us-builds' }, list.map(b => h('li', null,
          h('button', { type: 'button', class: 'us-build', 'aria-expanded': String(T.ui.openBuilds.has(b.id)), onclick: () => T.act.toggleBuild(b.id) },
            h('span', { class: 'us-time' }, T.clock(b.endedAt)), h('span', null, h('b', null, `${b.kindText}${b.detail ? ' ' + b.detail : ''}`), h('small', null, `${b.agent ? b.agent.name : b.label}, ${b.summary}${b.how ? ', ' + b.how : ''}`)), h('span', { class: 'us-time' }, T.dur(b.durationMs))),
          T.ui.openBuilds.has(b.id) ? h('div', { class: 'us-errs' }, h('code', { class: 'us-code' }, b.command), b.lines.length ? h('pre', null, b.lines.join('\n')) : h('span', { class: 'us-dim' }, 'Aucune ligne d\'erreur relevée.'), b.waitMs > 1000 ? h('span', { class: 'us-dim' }, `A attendu ${T.dur(b.waitMs)} devant la forge.`) : null) : null)))
          : h('p', { class: 'us-dim' }, ok ? 'Aucun build réussi pour l\'instant.' : 'Aucun échec récent.'),
      ];
    } else if (s.kind === 'silo') {
      const c = M.campaign;
      title = c ? `Silo : ${c.name}` : 'Silo à fusée';
      if (!c) body = [h('p', null, 'Chaque version est une fusée : ses features en sont les pièces, et l\'épreuve finale (le package) est le lancement.'), h('div', { class: 'us-actions' }, btn('Préparer une version', T.act.openBuilder, 'us-go'))];
      else if (c.won) body = [
        h('p', { class: 'us-t-ok' }, h('b', null, 'Fusée lancée : version validée.')),
        rowsOf([['Développement', T.dur(c.wonAt - c.createdAt)], ['Features', String(c.features.length)], ['Builds et tests', String(c.stats.builds)], ['Échecs corrigés', String(c.stats.failures)], ['Agents', String(c.stats.agents)], c.commit && ['Commit', `${c.commit.sha}${c.commit.dirty ? `, ${c.commit.dirty} fichiers non commités` : ''}`]]),
        h('div', { class: 'us-actions' }, btn('Ranger', T.act.archive), btn('Préparer la suivante', T.act.next, 'us-go'))];
      else body = [
        h('div', { class: 'us-bar' }, h('i', { style: `width:${c.pct}%` })),
        c.next ? h('p', { class: `us-next us-t-${c.next.tone}` }, c.next.text) : null,
        h('ul', { class: 'us-feats' },
          c.features.map(f => h('li', { class: `us-f-${f.status}` },
            h('span', { class: 'us-chip' }, f.statusText),
            h('div', null, h('b', null, f.title), f.checks.map(k => h('small', null, `${k.text} : `, h('span', { class: k.ok === true ? 'us-t-ok' : k.ok === false ? 'us-t-ko' : 'us-dim' }, k.verb), k.detail ? `, ${k.detail}` : '', k.at ? [', ', T.agoEl(k.at)] : ''))),
            f.manual ? btn(f.manual.done ? 'Annuler' : 'Je l\'ai testée', () => T.act.manual(f.id, !f.manual.done), f.manual.done ? '' : 'us-go') : null)),
          h('li', { class: `us-f-${c.final.status}` }, h('span', { class: 'us-chip' }, c.final.statusText),
            h('div', null, h('b', null, 'Lancement : épreuve finale'), c.final.locked ? h('small', null, 'Se débloque quand toutes les features sont prêtes.') : null,
              c.final.checks.map(k => h('small', null, `${k.text} : `, h('span', { class: k.ok === true ? 'us-t-ok' : k.ok === false ? 'us-t-ko' : 'us-dim' }, k.verb)))))),
        h('div', { class: 'us-actions' }, btn('Abandonner la version', T.act.abandon, 'us-danger'))];
      if (M.past.length) body.push(h('p', { class: 'us-dim' }, 'Fusées précédentes : ', M.past.slice(0, 6).map(p => p.won ? `${p.name} (lancée)` : `${p.name} (abandonnée)`).join(', ')));
    }
    return h('section', { class: 'us-panel us-entity', 'aria-label': title }, h('div', { class: 'us-ehead' }, h('h2', null, title), close), h('div', { class: 'us-ebody' }, body));
  }

  function projectsPanel(M) {
    return h('div', { class: 'us-panel us-projects' },
      M.projects.length ? M.projects.map(p => h('span', { class: 'us-proj', title: p.uproject }, h('b', null, p.name), ` UE ${p.engine || '?'}`, btn('✕', () => T.act.disconnect(p), 'us-mini', { 'aria-label': `Déconnecter ${p.name}`, title: 'Déconnecter' })))
        : h('span', { class: 'us-dim' }, 'Aucun projet Unreal connecté.'),
      M.inventories.length > 1 ? M.inventories.map(i => btn(i.project, () => { T.ui.mapProject = i.project; T.rerender(); }, i.project === (M.inv && M.inv.project) ? 'us-go' : '')) : null,
      btn(M.projects.length ? 'Connecter un projet' : 'Connecter un projet Unreal', T.act.openProjects, M.projects.length ? '' : 'us-go'));
  }

  function renderHud() {
    const M = G.M; if (!M) return;
    G.hud.tl.replaceChildren(...topLeft(M));
    G.hud.alerts.replaceChildren(alertsPanel(M));
    G.hud.quick.replaceChildren(quickbar(M));
    const ent = entityPanel(M);
    G.hud.entity.replaceChildren(...(ent ? [ent] : []));
    G.hud.entity.hidden = !ent;
    G.hud.projects.replaceChildren(projectsPanel(M));
    if (!M.inv) G.hud.empty.replaceChildren(h('p', null, M.projects.length ? 'La tour compte le projet : les gisements apparaissent dans un instant.' : 'Connecte un projet Unreal : ses domaines deviennent les gisements de l\'usine.'));
    G.hud.empty.hidden = !!M.inv;
  }

  function build(root) {
    G.canvas = h('canvas', { class: 'us-canvas', role: 'img', 'aria-label': 'L\'usine : agents, forge et version, en direct' });
    G.mini = h('canvas', { class: 'us-mini', width: 220, height: 120, 'aria-label': 'Mini-carte : clique pour déplacer la vue' });
    G.ctx = G.canvas.getContext('2d');
    G.hud = {
      tl: h('div', { class: 'us-tl' }), alerts: h('div', { class: 'us-alertbox' }), quick: h('div', { class: 'us-quickbox' }),
      entity: h('div', { class: 'us-entitybox' }), projects: h('div', { class: 'us-projbox' }), empty: h('div', { class: 'us-emptymap' }),
    };
    root.replaceChildren(h('div', { class: 'us-app' },
      h('div', { class: 'us-stage' }, G.canvas, G.hud.empty),
      h('header', { class: 'us-top' }, h('span', { class: 'us-brand' }, 'Alkatrazz Tower'), h('span', { class: 'us-sub2' }, 'l\'usine'), h('span', { class: 'us-grow' }), T.switcher()),
      h('div', { class: 'us-left' }, G.hud.tl, G.hud.entity),
      h('div', { class: 'us-right' }, h('div', { class: 'us-panel us-minibox' }, G.mini, h('small', { class: 'us-dim' }, 'Glisse pour bouger, molette pour zoomer, 1 à 9 pour un agent')), G.hud.alerts, G.hud.projects),
      G.hud.quick));
    bindCanvas();
    G.built = true;
    requestAnimationFrame(() => { resize(); G.dirty = true; });
    if (!G.looping) { G.looping = true; requestAnimationFrame(frame); }
  }

  function render(root, M) {
    G.M = M;
    if (!G.built || !root.contains(G.canvas)) build(root);
    const prev = G.world;
    G.world = layout(M);
    if (G.sel && G.sel.kind === 'agent' && !M.agents.some(a => a.id === G.sel.id)) G.sel = null;
    if (!G.userMoved && (!prev || prev.w !== G.world.w)) fit();
    G.dirty = true;
    renderHud();
  }

  T.register({ id: 'usine', render });
})();
