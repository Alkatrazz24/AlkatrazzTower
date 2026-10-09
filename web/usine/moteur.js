'use strict';
// Moteur commun des templates « usine » : la tour comme une usine vue de dessus, facon jeu de gestion
// d'usine. Chaque template (web/templates/<id>.js) n'apporte qu'un monde : couleurs, terrain, decor,
// eclairage. Le jeu tourne en fond, en direct :
//   - chaque domaine du projet (Blueprints, Sons...) est un gisement ; une foreuse y tourne quand
//     il a bouge ces 3 derniers jours ;
//   - chaque agent est une machine d'assemblage avec son personnage ; elle tourne quand il travaille,
//     une alerte clignote au-dessus quand il attend ta reponse, un tapis l'alimente depuis le gisement
//     du fichier qu'il touche ;
//   - le tapis principal mene a la forge : une seule caisse dedans a la fois, les autres attendent
//     sur le tapis ; a la sortie, un coffre des builds reussis et un coffre des echecs ;
//   - la version a sortir est le silo a fusee : chaque feature prete est une piece de la fusee,
//     l'epreuve finale est le lancement.
// Par-dessus, un HUD : compteurs en haut, version a gauche, mini-carte et alertes a droite, barre
// rapide en bas, et la fiche de ce qu'on a selectionne (clic sur le jeu, ou touches 1 a 9).

(function () {
  const T = window.Tower, h = T.h;
  const TS = 16; // taille d'une case en pixels du monde
  const MARGIN = 40; // cases de terrain precalculees autour de l'usine
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE = {
    bg: '#2d2a25', ground: '#3a3530', ground2: '#353029', grid: 'rgba(0,0,0,.18)', concrete: '#57544e', concrete2: '#4f4c46',
    stripeA: '#d9b02b', stripeB: '#2b2722',
    belt: '#c9a227', beltDark: '#6b5615', steel: '#8b8f94', steelDark: '#4b4f55', steelLight: '#b9bdc2', machine: '#7d8288',
    forge: '#8a5a3c', forgeLight: '#a77455', forgeDark: '#4a2f20',
    fire: '#ff8a1f', fireHot: '#ffd166', ok: '#5fbf4a', ko: '#e0533d', warn: '#f2b233', blue: '#59a8e8', ghost: 'rgba(110,170,255,.55)',
    text: '#f1ede4', shadow: 'rgba(0,0,0,.45)', labelBg: 'rgba(20,20,22,.8)', wire: 'rgba(40,30,20,.75)', pole: '#6b4f33',
    select: '#ffd23f', mini: '#16140f',
  };
  let TH = null, COL = BASE, SC = false; // monde courant ; SC : dessin facon plan d'ingenieur
  let MODE = {}; // fonctionnement courant (web/templates/<id>.js) : ce que montre le HUD et comment on s'en sert

  // ---------- etat du jeu (garde d'un rendu a l'autre) ----------
  const G = {
    built: false, canvas: null, ctx: null, mini: null, hud: {}, M: null, world: null,
    cam: { x: 0, y: 0, z: 2 }, goal: null, userMoved: false, dpr: 1,
    sel: null, // { kind: 'agent'|'patch'|'forge'|'ok'|'ko'|'silo', id }
    imgs: new Map(), t: 0, last: 0, prev: 0, drag: null, hover: null, terrain: null, lights: [], emit: [],
  };

  // ---------- outils ----------
  function rnd(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function hash(str) { let x = 2166136261; for (const c of String(str)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }
  function h2(x, y) { let k = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0; k = Math.imul(k ^ (k >>> 13), 1274126177) >>> 0; return (k ^ (k >>> 16)) >>> 0; }
  function vnoise(x, y, s) {
    const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const r = (a, b) => (h2(a, b) & 1023) / 1023, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = r(ix, iy) + (r(ix + 1, iy) - r(ix, iy)) * sx, b = r(ix, iy + 1) + (r(ix + 1, iy + 1) - r(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  }
  // Bruit doux entre 0 et 1, utilise par les mondes pour leur terrain.
  function fbm(x, y) { return vnoise(x, y, 13) * .62 + vnoise(x + 91, y + 37, 5) * .28 + vnoise(x, y, 2) * .1; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shade = (c, k) => window.Avatar.shade(c, k);

  // ---------- personnages : SVG -> image pour le canvas ----------
  // Un monde peut teinter les personnages (le plan les dessine en bleu) : la teinte est appliquee une
  // fois par personnage dans une petite image, pas a chaque image du jeu.
  function avatarImg(look, state) {
    const key = JSON.stringify(look) + state;
    let im = G.imgs.get(key);
    if (!im) {
      im = new Image();
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.Avatar.render(look, { state, size: 88 }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
      G.imgs.set(key, im);
    }
    if (!TH || !TH.avatarFilter || !im.complete || !im.naturalWidth) return im;
    const fk = key + '|' + TH.avatarFilter;
    let cv = G.imgs.get(fk);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = 44; cv.height = 70;
      const c = cv.getContext('2d'); c.filter = TH.avatarFilter; c.drawImage(im, 0, 0, 44, 70);
      cv.complete = true; cv.naturalWidth = 44;
      G.imgs.set(fk, cv);
    }
    return cv;
  }

  // ---------- plan de l'usine ----------
  function layout(M) {
    const shown = M.agents.filter(a => a.st !== 'ended' || T.ui.showEnded);
    const order = { waiting: 0, idle: 1, working: 2, ready: 3, silent: 4, ended: 5 };
    shown.sort((a, b) => (order[a.st] - order[b.st]) || a.name.localeCompare(b.name));
    const n = Math.max(shown.length, 1);
    const pitch = 6, x0 = 4;
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
    // Poteaux electriques : un par machine, puis la forge et le silo.
    const poles = machines.map(m => ({ x: m.x + 3.5, y: m.y - .6 }));
    poles.push({ x: forge.x - .6, y: forge.y - .6 }, { x: silo.x - .8, y: silo.y - .2 });
    // Lampadaires au bord de la dalle (ils eclairent la nuit).
    const lamps = [];
    for (let x = 3; x < width - 2; x += 8) lamps.push({ x, y: 8.4 }, { x: x + 4, y: 21.5 });
    const you = { x: silo.x - 2.2, y: silo.y + silo.h - 1 };
    return { machines, forge, beltY, okChest, koChest, silo, patches, poles, lamps, you, w: width, h: 23, x0 };
  }

  // ---------- terrain : calcule une fois par taille d'usine, hors de la boucle ----------
  function buildTerrain(W) {
    const x0 = -MARGIN, y0 = -MARGIN, cols = W.w + 2 * MARGIN, rows = W.h + 2 * MARGIN;
    const cv = document.createElement('canvas');
    cv.width = cols * TS; cv.height = rows * TS;
    const c = cv.getContext('2d');
    c.translate(-x0 * TS, -y0 * TS);
    const anim = [];
    for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x0 + cols; x++) {
      const inside = x >= 1 && x < W.w - 1 && y >= 8 && y < 22;
      if (inside) continue;
      let r = TH.tile ? TH.tile(x, y, fbm(x, y), h2(x, y)) : (h2(x, y) & 7) < 2 ? COL.ground2 : COL.ground;
      // ni eau ni lave sous les gisements ni au ras de l'usine : on y pose le sol du monde
      if (r.anim && x >= -1 && x <= W.w && y >= -1 && y <= W.h) r = TH.safe || COL.ground;
      const color = typeof r === 'string' ? r : r.c;
      c.fillStyle = color; c.fillRect(x * TS, y * TS, TS, TS);
      if (r.anim) anim.push({ x, y, kind: r.anim, c: color });
    }
    // Decor hors de l'usine (arbres, rochers...), a l'ecart des gisements et de la dalle.
    if (TH.deco) for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x0 + cols; x++) {
      if (x >= 0 && x < W.w && y >= 0 && y < W.h) continue;
      if (anim.length && TH.tile && TH.tile(x, y, fbm(x, y), h2(x, y)).anim) continue;
      TH.deco(c, x * TS, y * TS, fbm(x, y), h2(x, y));
    }
    // Dalle sous la ligne de production.
    if (!SC) {
      c.fillStyle = COL.concrete; c.fillRect(TS, 8 * TS, (W.w - 2) * TS, 14 * TS);
      for (let y = 8; y < 22; y++) for (let x = 1; x < W.w - 1; x++) if ((h2(x, y) & 7) === 0) { c.fillStyle = COL.concrete2; c.fillRect(x * TS, y * TS, TS, TS); }
      c.strokeStyle = COL.grid; c.lineWidth = 1;
      for (let x = 1; x < W.w; x++) { c.beginPath(); c.moveTo(x * TS + .5, 8 * TS); c.lineTo(x * TS + .5, 22 * TS); c.stroke(); }
      for (let y = 8; y <= 22; y++) { c.beginPath(); c.moveTo(TS, y * TS + .5); c.lineTo((W.w - 1) * TS, y * TS + .5); c.stroke(); }
      for (let x = 1; x < W.w - 1; x++) { c.fillStyle = x % 2 ? COL.stripeA : COL.stripeB; c.fillRect(x * TS, 8 * TS - 3, TS, 3); c.fillRect(x * TS, 22 * TS, TS, 3); }
    } else {
      c.fillStyle = COL.concrete; c.fillRect(TS, 8 * TS, (W.w - 2) * TS, 14 * TS);
      c.strokeStyle = COL.grid; c.lineWidth = 1;
      for (let x = 1; x < W.w; x++) { c.beginPath(); c.moveTo(x * TS + .5, 8 * TS); c.lineTo(x * TS + .5, 22 * TS); c.stroke(); }
      for (let y = 8; y <= 22; y++) { c.beginPath(); c.moveTo(TS, y * TS + .5); c.lineTo((W.w - 1) * TS, y * TS + .5); c.stroke(); }
      c.strokeStyle = COL.steelLight; c.setLineDash([8, 6]); c.lineWidth = 1.5; c.strokeRect(TS + .5, 8 * TS + .5, (W.w - 2) * TS, 14 * TS); c.setLineDash([]);
    }
    G.terrain = { cv, x0, y0, cols, rows, anim, w: W.w, theme: TH.id };
  }

  // ---------- dessin ----------
  function box(c, x, y, w, hgt, body, light, dark) {
    if (SC) {
      c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x, y, w, hgt);
      c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.strokeRect(x + .75, y + .75, w - 1.5, hgt - 1.5);
      c.strokeStyle = 'rgba(232,241,255,.35)'; c.lineWidth = 1; c.strokeRect(x + 3.5, y + 3.5, w - 7, hgt - 7);
      return;
    }
    c.fillStyle = COL.shadow; c.fillRect(x + 4, y + 5, w, hgt);
    c.fillStyle = dark; c.fillRect(x, y, w, hgt);
    c.fillStyle = body; c.fillRect(x + 2, y + 2, w - 4, hgt - 5);
    c.fillStyle = light; c.fillRect(x + 2, y + 2, w - 4, 2);
  }

  function gear(c, cx, cy, r, a, color) {
    c.save(); c.translate(cx, cy); c.rotate(a);
    if (SC) {
      c.strokeStyle = color; c.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) { c.rotate(Math.PI / 4); c.strokeRect(-2, -r - 3, 4, 4); }
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(0, 0, r * .38, 0, Math.PI * 2); c.stroke();
      c.restore(); return;
    }
    c.fillStyle = color;
    for (let i = 0; i < 8; i++) { c.rotate(Math.PI / 4); c.fillRect(-2, -r - 3, 4, 5); }
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = COL.steelDark; c.beginPath(); c.arc(0, 0, r * .38, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function light(x, y, r, color, k = 1) { G.lights.push({ x, y, r, color, k }); }

  function drawPatch(c, p, t) {
    const rand = rnd(hash(p.r.id));
    c.fillStyle = SC ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.18)';
    c.fillRect(p.x * TS - 2, p.y * TS - 2, p.w * TS + 4, p.h * TS + 4);
    if (SC) { c.strokeStyle = p.r.color; c.lineWidth = 1; c.setLineDash([3, 3]); c.strokeRect(p.x * TS - 1.5, p.y * TS - 1.5, p.w * TS + 3, p.h * TS + 3); c.setLineDash([]); }
    const dots = Math.min(90, 10 + p.w * p.h * 2);
    for (let i = 0; i < dots; i++) {
      const x = p.x * TS + rand() * p.w * TS, y = p.y * TS + rand() * p.h * TS, s = 2 + Math.floor(rand() * 4);
      c.fillStyle = shade(p.r.color, rand() * .5 - .3);
      if (SC) c.fillRect(Math.floor(x), Math.floor(y), 2, 2); else c.fillRect(Math.floor(x), Math.floor(y), s, s);
    }
    if (p.r.recent) { // une foreuse qui tourne
      const dx = (p.x + p.w / 2 - 1) * TS, dy = (p.y + p.h - 2.4) * TS;
      box(c, dx, dy, 2 * TS, 2 * TS, COL.steel, COL.steelLight, COL.steelDark);
      const a = reduced ? 0 : t * 4;
      c.save(); c.translate(dx + TS, dy + TS - 1); c.rotate(a);
      if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.strokeRect(-9, -2, 18, 4); c.strokeRect(-2, -9, 4, 18); }
      else { c.fillStyle = COL.steelDark; c.fillRect(-9, -2, 18, 4); c.fillRect(-2, -9, 4, 18); }
      c.restore();
      G.emit.push(() => { c.fillStyle = COL.warn; c.fillRect(dx + 3, dy + 3, 4, 4); });
      light(dx + TS, dy + TS, 34, COL.warn, .5);
      // eclats de minerai qui sautent
      if (!reduced && !SC) for (let i = 0; i < 3; i++) {
        const q = (t * 1.3 + i / 3) % 1, ang = hash(p.r.id + i) % 628 / 100;
        c.fillStyle = shade(p.r.color, .2); c.fillRect(dx + TS + Math.cos(ang) * q * 16, dy + TS + Math.sin(ang) * q * 10 - Math.sin(q * Math.PI) * 8, 2, 2);
      }
    }
  }

  function drawMachine(c, m, t) {
    const a = m.a, x = m.x * TS, y = m.y * TS, w = m.w * TS, hh = m.h * TS;
    if (a.st === 'ended') { // fantome bleu : la machine a ete demontee
      c.strokeStyle = COL.ghost; c.setLineDash([4, 3]); c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, hh - 2); c.setLineDash([]);
      c.fillStyle = 'rgba(110,170,255,.12)'; c.fillRect(x, y, w, hh);
      return;
    }
    const on = a.st === 'working' || a.holds;
    box(c, x, y, w, hh, a.st === 'silent' ? shade(COL.machine, -.15) : COL.machine, COL.steelLight, COL.steelDark);
    gear(c, x + w / 2, y + hh / 2 - 2, 11, on && !reduced ? t * 2.2 : 0.3, on ? COL.steelLight : shade(COL.steelLight, -.2));
    // bras articule qui pose les pieces sur le tapis : il se balance quand la machine tourne
    const ax = x + w / 2, ay = y + hh;
    const swing = on && !reduced ? Math.sin(t * 3 + m.x) * .5 : 0;
    c.save(); c.translate(ax, ay); c.rotate(swing);
    if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.strokeRect(-2, 0, 4, TS * 2.2); }
    else { c.fillStyle = COL.steelDark; c.fillRect(-2, 0, 4, TS * 2.2); c.fillStyle = COL.warn; c.fillRect(-4, TS * 2.2 - 4, 8, 4); }
    c.restore();
    // voyant d'etat (lumineux : il reste visible la nuit)
    const lamp = a.st === 'waiting' ? COL.warn : a.st === 'idle' ? COL.ok : on ? COL.blue : '#6f747a';
    c.fillStyle = '#1e1f22'; c.fillRect(x + w - 10, y + 5, 6, 6);
    G.emit.push(() => { c.fillStyle = lamp; c.fillRect(x + w - 9, y + 6, 4, 4); });
    light(x + w / 2, y + hh / 2, on ? 60 : 40, on ? COL.blue : lamp, on ? .9 : .6);
    if (TH.machineOverlay) TH.machineOverlay(c, x, y, w, hh, a, on, t);
    // fumee quand ca tourne
    if (on && !reduced && !SC) for (let i = 0; i < 3; i++) {
      const p = ((t * .6 + i / 3) % 1);
      c.fillStyle = TH.smoke ? TH.smoke(1 - p) : `rgba(200,200,200,${.35 * (1 - p)})`;
      const s = 4 + p * 8;
      c.fillRect(x + 8 - s / 2 + p * 6, y - p * 26, s, s);
    }
  }

  // Tapis : chevrons qui avancent, et des pieces posees dessus quand il roule.
  function belt(c, x1, x2, y, t, moving, items) {
    const yy = y * TS - 6;
    if (SC) {
      c.strokeStyle = COL.belt; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x1 * TS, yy + .75); c.lineTo(x2 * TS, yy + .75); c.moveTo(x1 * TS, yy + 11.25); c.lineTo(x2 * TS, yy + 11.25); c.stroke();
    } else {
      c.fillStyle = COL.beltDark; c.fillRect(x1 * TS, yy, (x2 - x1) * TS, 12);
      c.fillStyle = COL.belt; c.fillRect(x1 * TS, yy + 2, (x2 - x1) * TS, 8);
    }
    const off = moving && !reduced ? (t * 24) % 8 : 0;
    c.fillStyle = SC ? COL.belt : COL.beltDark;
    for (let x = x1 * TS + off; x < x2 * TS - 4; x += 8) { c.fillRect(Math.floor(x), yy + 3, 2, 2); c.fillRect(Math.floor(x) + 2, yy + 5, 2, 2); c.fillRect(Math.floor(x), yy + 7, 2, 2); }
    if (moving && items) {
      const len = (x2 - x1) * TS, step = 22;
      for (let d = (reduced ? 0 : (t * 24) % step); d < len - 6; d += step) { c.fillStyle = items; c.fillRect(Math.floor(x1 * TS + d), yy + 3, 5, 5); }
    }
  }
  function vbelt(c, x, y1, y2, t, color) {
    const xx = x * TS - 3;
    if (SC) { c.strokeStyle = COL.belt; c.lineWidth = 1; c.strokeRect(xx + .5, y1 * TS, 5, (y2 - y1) * TS); }
    else { c.fillStyle = COL.beltDark; c.fillRect(xx, y1 * TS, 6, (y2 - y1) * TS); c.fillStyle = COL.belt; c.fillRect(xx + 1, y1 * TS, 4, (y2 - y1) * TS); }
    if (!reduced) for (let i = 0; i < 3; i++) {
      const p = (t * .35 + i / 3) % 1;
      c.fillStyle = color; c.fillRect(xx + 1, (y1 + (y2 - y1) * p) * TS - 2, 4, 4);
    }
  }
  function hbelt(c, xa, xb, y) {
    const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb);
    if (SC) { c.strokeStyle = COL.belt; c.lineWidth = 1; c.strokeRect(x1 * TS, y * TS - 2.5, (x2 - x1) * TS + 3, 5); return; }
    c.fillStyle = COL.beltDark; c.fillRect(x1 * TS, y * TS - 3, (x2 - x1) * TS + 3, 6);
    c.fillStyle = COL.belt; c.fillRect(x1 * TS, y * TS - 2, (x2 - x1) * TS + 3, 4);
  }

  function crate(c, x, y, look) {
    if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.2; c.strokeRect(x - 6.5, y - 6.5, 13, 11); c.beginPath(); c.moveTo(x - 6, y - 6); c.lineTo(x + 6, y + 4); c.stroke(); return; }
    c.fillStyle = COL.shadow; c.fillRect(x - 6, y - 4, 14, 12);
    c.fillStyle = '#a0723c'; c.fillRect(x - 7, y - 7, 14, 12);
    c.fillStyle = '#7a5428'; c.fillRect(x - 7, y - 2, 14, 2); c.fillRect(x - 1, y - 7, 2, 12);
    c.fillStyle = (look && look.shirt) || COL.blue; c.fillRect(x - 5, y - 5, 4, 3);
  }

  function drawForge(c, W, t) {
    const f = W.forge, x = f.x * TS, y = f.y * TS, w = f.w * TS, hh = f.h * TS;
    const lit = !!G.M.lock;
    box(c, x, y, w, hh, COL.forge, COL.forgeLight, COL.forgeDark);
    if (!SC) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x + 3 + k * 15 + (r % 2) * 7, y + 6 + r * 13, 12, 1); }
    c.fillStyle = SC ? 'rgba(0,0,0,.25)' : '#1b120d'; c.fillRect(x + 14, y + 22, w - 28, 26);
    if (lit) {
      const fl = reduced ? 1 : .75 + .25 * Math.sin(t * 13) * Math.sin(t * 7.3);
      G.emit.push(() => {
        c.globalAlpha = fl; c.fillStyle = COL.fire; c.fillRect(x + 16, y + 30, w - 32, 16);
        c.fillStyle = COL.fireHot; c.fillRect(x + 22, y + 36, w - 44, 8); c.globalAlpha = 1;
      });
      light(x + w / 2, y + hh / 2 + 6, 120 * fl, COL.fire, 1.2);
      if (!TH.dark && !SC) {
        const g = c.createRadialGradient(x + w / 2, y + hh / 2, 4, x + w / 2, y + hh / 2, 70);
        g.addColorStop(0, 'rgba(255,140,40,.28)'); g.addColorStop(1, 'rgba(255,140,40,0)');
        c.fillStyle = g; c.fillRect(x - 60, y - 60, w + 120, hh + 120);
      }
    }
    // cheminee
    if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.strokeRect(x + w - 16, y - 12, 10, 14); }
    else { c.fillStyle = COL.forgeDark; c.fillRect(x + w - 16, y - 12, 10, 16); }
    if (lit && !reduced && !SC) for (let i = 0; i < 4; i++) {
      const p = (t * .5 + i / 4) % 1;
      c.fillStyle = TH.smoke ? TH.smoke((1 - p) * 1.3) : `rgba(90,90,90,${.5 * (1 - p)})`;
      c.fillRect(x + w - 15 + p * 12, y - 14 - p * 34, 6 + p * 10, 6 + p * 10);
    }
  }

  function drawChest(c, ch, ok, count) {
    const x = ch.x * TS, y = ch.y * TS, w = ch.w * TS;
    box(c, x, y, w, w, ok ? '#58704a' : '#7a3a32', ok ? '#7c9a6a' : '#a3544a', '#2a2620');
    if (SC) { c.strokeStyle = ok ? COL.ok : COL.ko; c.lineWidth = 1.5; c.strokeRect(x + 6, y + 6, w - 12, w - 12); return; }
    c.fillStyle = '#2a2620'; c.fillRect(x + 2, y + w / 2 - 2, w - 4, 3);
    c.fillStyle = '#d9b02b'; c.fillRect(x + w / 2 - 3, y + w / 2 - 4, 6, 6);
    // une petite pile qui grandit avec le nombre de builds
    for (let i = 0; i < Math.min(count, 6); i++) { c.fillStyle = ok ? '#a8d68f' : '#e8907f'; c.fillRect(x + w + 2, y + w - 5 - i * 4, 6, 3); }
  }

  function drawSilo(c, W, t) {
    const s = W.silo, x = s.x * TS, y = s.y * TS, w = s.w * TS;
    const camp = G.M.campaign;
    box(c, x, y, w, w, shade(COL.steel, -.1), COL.steelLight, COL.steelDark);
    c.fillStyle = SC ? 'rgba(0,0,0,.2)' : '#26282b'; c.beginPath(); c.arc(x + w / 2, y + w / 2, w * .34, 0, Math.PI * 2); c.fill();
    c.strokeStyle = COL.stripeA; c.lineWidth = SC ? 1.5 : 3; c.setLineDash([6, 5]); c.beginPath(); c.arc(x + w / 2, y + w / 2, w * .4, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    light(x + w / 2, y + w / 2, 90, '#cfe3ff', .7);
    if (!camp) return;
    const p = camp.won ? 1 : camp.total ? camp.proven / camp.total : 0;
    const cx = x + w / 2, cy = y + w / 2;
    // Lancement : la fusee decolle pendant la minute qui suit la victoire, puis le pad reste vide et etoile.
    const since = camp.won ? (Date.now() - (camp.wonAt || 0)) / 1000 : -1;
    if (camp.won && since >= 0 && since < 60 && !reduced) {
      const k = (since % 12) / 12, lift = k < .15 ? 0 : Math.pow((k - .15) / .85, 2) * 900;
      rocket(c, cx, cy + 18 - 48 - lift, 48);
      if (k >= .1) {
        G.emit.push(() => { for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? COL.fireHot : COL.fire; c.fillRect(cx - 5 + (i % 3) * 3, cy + 18 - lift + i * 5, 4, 8 + (i % 2) * 6); } });
        light(cx, cy + 18 - lift, 140, COL.fireHot, 1.4);
        if (!SC) for (let i = 0; i < 8; i++) { const q = (t * .8 + i / 8) % 1; c.fillStyle = `rgba(210,210,210,${.45 * (1 - q)})`; c.fillRect(cx - 30 + i * 8 - q * 10, cy + 10 - q * 14, 10 + q * 14, 10 + q * 14); }
      }
    } else if (camp.won) {
      c.fillStyle = COL.ok; star(c, cx, cy, 16);
    } else {
      // la fusee sort du puits a mesure que les features sont pretes
      const rh = 18 + p * 30;
      c.save(); c.beginPath(); c.arc(cx, cy, w * .34, 0, Math.PI * 2); c.clip();
      rocket(c, cx, cy + 18 - rh, rh);
      c.restore();
    }
    const gx = x + 8, gy = y + w - 12, gw = w - 16;
    c.fillStyle = '#1e1f22'; c.fillRect(gx, gy, gw, 6);
    G.emit.push(() => { c.fillStyle = camp.won ? COL.ok : COL.blue; c.fillRect(gx + 1, gy + 1, Math.round((gw - 2) * p), 4); });
  }
  function rocket(c, cx, top, hgt) {
    if (SC) {
      c.strokeStyle = COL.text; c.lineWidth = 1.5; c.strokeRect(cx - 7, top, 14, hgt);
      c.beginPath(); c.moveTo(cx - 7, top); c.lineTo(cx, top - 12); c.lineTo(cx + 7, top); c.stroke(); return;
    }
    c.fillStyle = '#e8e4da'; c.fillRect(cx - 7, top, 14, hgt);
    c.fillStyle = '#c9c4b8'; c.fillRect(cx + 3, top, 4, hgt);
    c.fillStyle = COL.ko; c.beginPath(); c.moveTo(cx - 7, top); c.lineTo(cx, top - 12); c.lineTo(cx + 7, top); c.fill();
    c.fillRect(cx - 11, top + hgt - 10, 4, 10); c.fillRect(cx + 7, top + hgt - 10, 4, 10);
    c.fillStyle = '#3c3f43'; c.fillRect(cx - 3, top + 8, 6, 5);
  }
  function star(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    c.closePath(); c.fill();
  }

  // Poteaux et fils electriques : la machine qui tourne a du courant, le fil vibre.
  function drawPoles(c, W, t) {
    const P = W.poles;
    c.strokeStyle = SC ? 'rgba(232,241,255,.5)' : COL.wire; c.lineWidth = 1;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const ax = a.x * TS, ay = a.y * TS - 14, bx = b.x * TS, by = b.y * TS - 14;
      c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2, Math.max(ay, by) + 10, bx, by); c.stroke();
    }
    for (const p of P) {
      const x = p.x * TS, y = p.y * TS;
      if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 14); c.moveTo(x - 4, y - 13); c.lineTo(x + 4, y - 13); c.stroke(); continue; }
      c.fillStyle = COL.shadow; c.fillRect(x + 1, y - 1, 6, 3);
      c.fillStyle = COL.pole; c.fillRect(x - 1, y - 15, 3, 16); c.fillRect(x - 5, y - 15, 11, 2);
    }
  }
  function drawLamps(c, W, t) {
    if (!TH.lamps) return;
    for (const l of W.lamps) {
      const x = l.x * TS, y = l.y * TS;
      c.fillStyle = COL.shadow; c.fillRect(x - 2, y + 1, 7, 3);
      c.fillStyle = COL.steelDark; c.fillRect(x, y - 9, 3, 10);
      G.emit.push(() => { c.fillStyle = TH.lamps; c.fillRect(x - 1, y - 12, 5, 4); });
      light(x + 1, y - 6, 90, TH.lamps, .9);
    }
  }

  // Coins de selection facon jeu : quatre equerres qui respirent autour de l'element choisi.
  function brackets(c, b, t) {
    const pad = 4 + (reduced ? 0 : Math.sin(t * 5) * 1.5), x = b.x * TS - pad, y = b.y * TS - pad, w = b.w * TS + pad * 2, hh = b.h * TS + pad * 2, k = 8;
    c.strokeStyle = COL.select; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, y + k); c.lineTo(x, y); c.lineTo(x + k, y);
    c.moveTo(x + w - k, y); c.lineTo(x + w, y); c.lineTo(x + w, y + k);
    c.moveTo(x + w, y + hh - k); c.lineTo(x + w, y + hh); c.lineTo(x + w - k, y + hh);
    c.moveTo(x + k, y + hh); c.lineTo(x, y + hh); c.lineTo(x, y + hh - k);
    c.stroke();
  }
  function boundsOf(sel) {
    const W = G.world; if (!sel || !W) return null;
    if (sel.kind === 'agent') {
      const m = W.machines.find(q => q.a.id === sel.id);
      if (m) return { x: m.x - 1.5, y: m.y - .3, w: m.w + 1.5, h: m.h + .3 };
      const L = G.M.lock; return L && L.agent && L.agent.id === sel.id ? W.forge : null;
    }
    if (sel.kind === 'forge') return W.forge;
    if (sel.kind === 'silo') return W.silo;
    if (sel.kind === 'ok') return W.okChest;
    if (sel.kind === 'ko') return W.koChest;
    if (sel.kind === 'patch') return W.patches.find(p => p.r.id === sel.id) || null;
    return null;
  }

  function drawWorld(c, W, t) {
    const M = G.M;
    // terrain precalcule, puis les cases animees (lave, eau) visibles a l'ecran
    const R = G.terrain;
    c.drawImage(R.cv, R.x0 * TS, R.y0 * TS);
    if (TH.animTile && R.anim.length) {
      const vw = G.canvas.width / G.dpr / G.cam.z, vh = G.canvas.height / G.dpr / G.cam.z;
      const x0 = G.cam.x / TS - 1, y0 = G.cam.y / TS - 1, x1 = (G.cam.x + vw) / TS + 1, y1 = (G.cam.y + vh) / TS + 1;
      for (const a of R.anim) if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) TH.animTile(c, a, t, G.emit, light);
    }
    for (const p of W.patches) drawPatch(c, p, t);
    // tapis d'alimentation : du gisement touche jusqu'a la machine de l'agent qui y travaille
    W.machines.forEach((m, i) => {
      if (m.a.st !== 'working' || !m.a.room) return;
      const p = W.patches.find(q => q.r.id === m.a.room);
      if (!p) return;
      const px = p.x + p.w / 2, mx = m.x + 1.5, lane = 7 + (i % 3) * .5;
      vbelt(c, px, p.y + p.h, lane, t, p.r.color);
      hbelt(c, px, mx, lane);
      vbelt(c, mx, lane, m.y, t, p.r.color);
    });
    // tapis principal vers la forge, puis sorties vers les coffres
    const busy = !!M.lock;
    belt(c, W.x0 - 1, W.forge.x, W.beltY + .5, t, busy || M.queue.length > 0);
    belt(c, W.forge.x + W.forge.w, W.okChest.x, W.okChest.y + 1, t, busy);
    belt(c, W.forge.x + W.forge.w, W.koChest.x, W.koChest.y + 1, t, busy);
    if (SC) { c.strokeStyle = COL.belt; c.lineWidth = 1; c.strokeRect((W.forge.x + W.forge.w + 1.5) * TS - 3, (W.okChest.y + 1) * TS, 6, (W.koChest.y - W.okChest.y) * TS); }
    else { c.fillStyle = COL.beltDark; c.fillRect((W.forge.x + W.forge.w + 1.5) * TS - 3, (W.okChest.y + 1) * TS, 6, (W.koChest.y - W.okChest.y) * TS); }
    drawLamps(c, W, t);
    for (const m of W.machines) drawMachine(c, m, t);
    // caisses en attente sur le tapis, devant la forge
    M.queue.forEach((q, i) => crate(c, (W.forge.x - 1 - i * 1.6) * TS, (W.beltY + .5) * TS, q.agent && q.agent.look));
    drawForge(c, W, t);
    const okN = M.builds.filter(b => b.ok).length, koN = M.builds.length - okN;
    drawChest(c, W.okChest, true, okN);
    drawChest(c, W.koChest, false, koN);
    // le dernier build termine roule vers son coffre pendant quelques secondes
    const last = M.builds[0];
    if (last && !reduced) {
      const age = (Date.now() - last.endedAt) / 1000;
      if (age >= 0 && age < 4) {
        const ch = last.ok ? W.okChest : W.koChest, k = age / 4;
        crate(c, (W.forge.x + W.forge.w + k * (ch.x - W.forge.x - W.forge.w)) * TS, (ch.y + 1) * TS, last.agent && last.agent.look);
      }
    }
    drawSilo(c, W, t);
    drawPoles(c, W, t);
    // personnages : devant leur machine ; celui qui compile a la forge
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
    }
    // selection
    const b = boundsOf(G.sel);
    if (b) brackets(c, b, t);
    const hv = G.hover && (!G.sel || G.hover.kind !== G.sel.kind || G.hover.id !== G.sel.id) ? boundsOf(G.hover) : null;
    if (hv) { c.globalAlpha = .45; brackets(c, hv, 0); c.globalAlpha = 1; }
  }

  // Alertes facon jeu, dessinees apres la nuit pour rester visibles : triangle qui clignote au-dessus des machines.
  function drawAlerts(c, W, t) {
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

  // Nuit, volcan, banquise : une couche d'ombre percee par les lumieres, puis un halo colore.
  function drawLighting(c) {
    const cv = G.canvas, z = G.cam.z * G.dpr;
    if (!G.lightCv || G.lightCv.width !== cv.width || G.lightCv.height !== cv.height) {
      G.lightCv = document.createElement('canvas'); G.lightCv.width = cv.width; G.lightCv.height = cv.height;
    }
    const L = G.lightCv, l = L.getContext('2d');
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, L.width, L.height);
    l.fillStyle = TH.dark; l.fillRect(0, 0, L.width, L.height);
    l.globalCompositeOperation = 'destination-out';
    const S = (x, y) => [(x - G.cam.x) * z, (y - G.cam.y) * z];
    for (const s of G.lights) {
      const [x, y] = S(s.x, s.y), r = s.r * z;
      if (x < -r || y < -r || x > L.width + r || y > L.height + r) continue;
      const g = l.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${Math.min(1, s.k)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g; l.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(L, 0, 0);
    c.globalCompositeOperation = 'lighter';
    for (const s of G.lights) {
      const [x, y] = S(s.x, s.y), r = s.r * z * .8;
      if (x < -r || y < -r || x > cv.width + r || y > cv.height + r) continue;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexA(s.color, .22 * Math.min(1, s.k) * (TH.glow || 1))); g.addColorStop(1, hexA(s.color, 0));
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.restore();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a.toFixed(3)})`;
  }

  // Textes en coordonnees ecran (nets a tout zoom).
  function label(c, text, sx, sy, opts = {}) {
    c.font = `${opts.weight || 600} ${opts.size || 13}px ${TH.labelFont || '"Barlow Condensed", "Segoe UI", sans-serif'}`;
    const w = c.measureText(text).width + 10;
    c.fillStyle = opts.bg || COL.labelBg;
    c.fillRect(Math.round(sx - w / 2), Math.round(sy - 9), Math.round(w), 18);
    if (opts.edge) { c.fillStyle = opts.edge; c.fillRect(Math.round(sx - w / 2), Math.round(sy + 7), Math.round(w), 2); }
    c.fillStyle = opts.color || COL.text; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, Math.round(sx), Math.round(sy));
  }
  function drawLabels(c, W) {
    const z = G.cam.z, S = (x, y) => [(x * TS - G.cam.x) * z, (y * TS - G.cam.y) * z];
    const small = z < 1.4;
    if (z >= .9) for (const p of W.patches) {
      const [sx, sy] = S(p.x + p.w / 2, p.y + p.h + .9);
      label(c, small ? p.r.name : `${p.r.name} ${T.num(p.r.count)}${p.r.recent ? '  +' + p.r.recent : ''}`, sx, sy, { edge: p.r.color, size: small ? 11 : 13 });
    }
    for (const m of W.machines) {
      const [sx, sy] = S(m.x + 1.5, m.y + m.h + .7);
      const sel = G.sel && G.sel.kind === 'agent' && G.sel.id === m.a.id;
      label(c, m.a.name, sx, sy, { edge: m.a.st === 'waiting' ? COL.warn : m.a.st === 'idle' ? COL.ok : m.a.st === 'working' ? COL.blue : '#777', color: sel ? COL.select : COL.text, size: small ? 11 : 14, weight: 700 });
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
  function view() { return { vw: G.canvas.width / G.dpr / G.cam.z, vh: G.canvas.height / G.dpr / G.cam.z }; }
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
    // Sur grand ecran, le HUD du mode prend des bords : on cadre l'usine dans la zone libre.
    const P = wide && MODE.pads ? MODE.pads(!!G.sel) : { l: 8, r: 8, t: 8, b: 8 };
    const padL = P.l, padR = P.r, padT = P.t, padB = P.b;
    const z = Math.min((vw - padL - padR) / (W.w * TS), (vh - padT - padB) / (W.h * TS));
    G.cam.z = Math.max(.35, Math.min(4, z));
    G.cam.x = W.w * TS / 2 - (padL + (vw - padL - padR) / 2) / G.cam.z;
    if (!wide && G.cam.z < .8) { // telephone : l'usine entiere serait illisible, on part des premieres machines
      G.cam.z = .8; G.cam.x = (W.x0 - 2.5) * TS;
    }
    G.cam.y = W.h * TS / 2 - (padT + (vh - padT - padB) / 2) / G.cam.z;
    G.goal = null;
  }
  // La camera ne s'eloigne jamais au point de perdre l'usine de vue.
  function clampCam() {
    const W = G.world; if (!W) return;
    const { vw, vh } = view();
    G.cam.x = clamp(G.cam.x, -vw + 6 * TS, W.w * TS - 6 * TS);
    G.cam.y = clamp(G.cam.y, -vh + 4 * TS, W.h * TS - 4 * TS);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!G.world || document.hidden || !G.canvas.isConnected) return;
    if (reduced && now - G.last < 1000 && !G.dirty) return;
    const dt = Math.min(.1, (now - (G.prev || now)) / 1000); G.prev = now;
    G.last = now; G.dirty = false;
    G.t = now / 1000;
    if (G.goal) { // glissement doux vers ce qu'on vient de choisir
      const k = reduced ? 1 : Math.min(1, dt * 7);
      G.cam.x += (G.goal.x - G.cam.x) * k; G.cam.y += (G.goal.y - G.cam.y) * k;
      if (Math.abs(G.goal.x - G.cam.x) + Math.abs(G.goal.y - G.cam.y) < .5) G.goal = null;
    }
    clampCam();
    if (!G.terrain || G.terrain.w !== G.world.w || G.terrain.theme !== TH.id) buildTerrain(G.world);
    const c = G.ctx, cv = G.canvas;
    G.lights = []; G.emit = [];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COL.bg; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(G.dpr * G.cam.z, 0, 0, G.dpr * G.cam.z, -G.cam.x * G.cam.z * G.dpr, -G.cam.y * G.cam.z * G.dpr);
    c.imageSmoothingEnabled = false;
    drawWorld(c, G.world, G.t);
    if (TH.dark) {
      drawLighting(c);
      c.setTransform(G.dpr * G.cam.z, 0, 0, G.dpr * G.cam.z, -G.cam.x * G.cam.z * G.dpr, -G.cam.y * G.cam.z * G.dpr);
    }
    for (const f of G.emit) f();
    drawAlerts(c, G.world, G.t);
    if (TH.overlay) { c.setTransform(1, 0, 0, 1, 0, 0); TH.overlay(c, cv.width, cv.height, G.t); }
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    drawLabels(c, G.world);
    drawMini();
  }

  function drawMini() {
    const m = G.mini; if (!m || !G.world || !m.isConnected) return;
    const W = G.world, c = m.getContext('2d');
    const mh = Math.max(40, Math.min(160, Math.round(m.width * W.h / W.w)));
    if (m.height !== mh) m.height = mh;
    const s = Math.min(m.width / (W.w * TS), m.height / (W.h * TS));
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COL.mini; c.fillRect(0, 0, m.width, m.height);
    c.setTransform(s, 0, 0, s, 0, 0);
    c.fillStyle = COL.concrete; c.fillRect(TS, 8 * TS, (W.w - 2) * TS, 14 * TS);
    for (const p of W.patches) { c.fillStyle = p.r.color; c.fillRect(p.x * TS, p.y * TS, p.w * TS, p.h * TS); }
    for (const mm of W.machines) { c.fillStyle = mm.a.st === 'waiting' ? COL.warn : mm.a.st === 'idle' ? COL.ok : mm.a.st === 'working' ? COL.blue : '#777'; c.fillRect(mm.x * TS, mm.y * TS, mm.w * TS, mm.h * TS); }
    c.fillStyle = G.M.lock ? COL.fire : COL.forge; c.fillRect(W.forge.x * TS, W.forge.y * TS, W.forge.w * TS, W.forge.h * TS);
    c.fillStyle = COL.steelLight; c.fillRect(W.silo.x * TS, W.silo.y * TS, W.silo.w * TS, W.silo.h * TS);
    const { vw, vh } = view();
    c.strokeStyle = '#fff'; c.lineWidth = 2 / s; c.strokeRect(Math.max(G.cam.x, 0), Math.max(G.cam.y, 0), Math.min(vw, W.w * TS - Math.max(G.cam.x, 0)), Math.min(vh, W.h * TS - Math.max(G.cam.y, 0)));
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
  // Infobulle facon jeu : le nom de ce qu'on survole et son etat en une ligne.
  function tipOf(s) {
    const M = G.M;
    if (s.kind === 'agent') { const a = M.agents.find(x => x.id === s.id); return a && [a.name, a.holds ? `${a.stText}, à la forge` : a.stText]; }
    if (s.kind === 'forge') return ['Forge', M.lock ? `${M.lock.kindText} de ${M.lock.agent ? M.lock.agent.name : M.lock.label}` : 'Libre'];
    if (s.kind === 'ok') return ['Coffre des réussis', T.plural(M.builds.filter(b => b.ok).length, 'build', 'builds')];
    if (s.kind === 'ko') return ['Coffre des échecs', T.plural(M.builds.filter(b => !b.ok).length, 'build', 'builds')];
    if (s.kind === 'silo') return ['Silo à fusée', M.campaign ? `${M.campaign.name} : ${M.campaign.proven} sur ${M.campaign.total}` : 'Aucune version'];
    if (s.kind === 'patch') { const r = M.inv && T.room(M.inv, s.id); return r && [`Gisement ${r.name}`, `${T.num(r.count)} éléments${r.recent ? `, ${r.recent} modifiés` : ''}`]; }
    return null;
  }
  function showTip(e, s) {
    const tip = G.hud.tip, info = s && tipOf(s);
    if (!info) { tip.hidden = true; return; }
    tip.replaceChildren(h('b', null, info[0]), h('span', null, info[1]));
    tip.hidden = false;
    const r = G.canvas.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 16, r.width - 220) + 'px';
    tip.style.top = (e.clientY - r.top + 18) + 'px';
  }
  function center(sel) {
    const b = boundsOf(sel); if (!b) return;
    const { vw, vh } = view();
    const ox = (b.x + b.w / 2) * TS, oy = (b.y + b.h / 2) * TS;
    const wide = G.canvas.width / G.dpr > 900;
    // sur grand ecran, la fiche couvre la gauche : on cale l'element dans la partie libre
    const fx = wide ? .58 : .5;
    if (ox < G.cam.x + vw * .32 || ox > G.cam.x + vw * .74 || oy < G.cam.y + vh * .18 || oy > G.cam.y + vh * .72) {
      G.goal = { x: ox - vw * fx, y: oy - vh * .45 }; G.userMoved = true;
    }
  }
  function select(sel, ctr) {
    const had = !!G.sel;
    G.sel = sel;
    if (sel && sel.kind === 'patch') T.ui.mapRoom = sel.id;
    if (!G.userMoved && had !== !!sel) fit();
    if (ctr && sel) center(sel);
    G.dirty = true;
    renderHud();
  }
  function bindCanvas() {
    const cv = G.canvas;
    cv.addEventListener('pointerdown', (e) => { G.drag = { x: e.clientX, y: e.clientY, cx: G.cam.x, cy: G.cam.y, moved: false }; G.goal = null; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (G.drag) {
        const dx = e.clientX - G.drag.x, dy = e.clientY - G.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) G.drag.moved = true;
        if (G.drag.moved) { G.cam.x = G.drag.cx - dx / G.cam.z; G.cam.y = G.drag.cy - dy / G.cam.z; G.userMoved = true; G.dirty = true; G.hud.tip.hidden = true; }
      } else {
        const hv = hit(worldAt(e));
        cv.style.cursor = hv ? 'pointer' : 'grab';
        if (JSON.stringify(hv) !== JSON.stringify(G.hover)) { G.hover = hv; G.dirty = true; }
        showTip(e, hv);
      }
    });
    cv.addEventListener('pointerleave', () => { G.hover = null; G.hud.tip.hidden = true; G.dirty = true; });
    cv.addEventListener('pointerup', (e) => {
      const d = G.drag; G.drag = null;
      if (d && !d.moved) select(hit(worldAt(e)), false);
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = worldAt(e), z = Math.max(.3, Math.min(5, G.cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const r = G.canvas.getBoundingClientRect();
      G.cam.z = z; G.cam.x = p.x - (e.clientX - r.left) / z; G.cam.y = p.y - (e.clientY - r.top) / z;
      G.userMoved = true; G.dirty = true; G.goal = null;
    }, { passive: false });
    G.mini.addEventListener('click', (e) => {
      const W = G.world, r = G.mini.getBoundingClientRect();
      const s = Math.min(G.mini.width / (W.w * TS), G.mini.height / (W.h * TS)) * (r.width / G.mini.width);
      const { vw, vh } = view();
      G.goal = { x: (e.clientX - r.left) / s - vw / 2, y: (e.clientY - r.top) / s - vh / 2 };
      G.userMoved = true; G.dirty = true;
    });
    if (G.keysBound) return; // la fenetre et le clavier ne s'abonnent qu'une fois, meme si on revient sur ce template
    G.keysBound = true;
    window.addEventListener('resize', () => { if (G.canvas.isConnected) { resize(); G.dirty = true; } });
    document.addEventListener('keydown', (e) => {
      if (!G.canvas.isConnected || document.querySelector('dialog[open]')) return;
      if (MODE.onKey && MODE.onKey(e, api)) { e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
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
        G.userMoved = true; G.dirty = true; G.goal = null; e.preventDefault();
      }
    });
  }

  // ---------- HUD commun : barre du haut et fiche ; le reste appartient au mode ----------
  const dotFor = (st) => ({ waiting: 'warn', idle: 'ok', working: 'blue', ready: 'grey', silent: 'grey', ended: 'grey' }[st] || 'grey');
  const btn = (text, onclick, cls = '', attrs = {}) => h('button', { type: 'button', class: 'us-btn ' + cls, onclick, ...attrs }, text);

  // Compteurs facon jeu de gestion : ce qui tourne, ce qui t'attend, ce qui est sorti.
  function counters(M) {
    const ok = M.builds.filter(b => b.ok).length;
    const item = (cls, n, text, title, onclick) => h('button', { type: 'button', class: `us-r us-r-${cls}`, title, onclick, disabled: !onclick }, h('i', { 'aria-hidden': 'true' }), h('b', null, String(n)), h('span', null, text));
    const firstWaiting = M.agents.find(a => a.st === 'waiting');
    return [
      item('blue', M.counts.working, 'au travail', 'Agents qui travaillent'),
      item('warn', M.counts.waiting, M.counts.waiting > 1 ? 't\'attendent' : 't\'attend', 'Agents qui attendent ta réponse', firstWaiting ? () => select({ kind: 'agent', id: firstWaiting.id }, true) : null),
      item('fire', M.queue.length + (M.lock ? 1 : 0), 'à la forge', 'Builds en cours et en attente', () => select({ kind: 'forge' }, true)),
      item('ok', ok, 'réussis', 'Builds réussis récents', () => select({ kind: 'ok' }, true)),
      item('ko', M.builds.length - ok, 'échecs', 'Builds en échec récents', () => select({ kind: 'ko' }, true)),
    ];
  }

  // Petites etiquettes de la barre du haut : direct ou demo, version en cours, projet connecte.
  function chips(M) {
    const c = M.campaign;
    return [
      h('span', { class: 'us-live ' + (M.demo ? 'demo' : M.connected ? 'on' : 'off') }, M.demo ? 'Démo' : M.connected ? 'En direct' : 'Tour injoignable'),
      c ? h('button', { type: 'button', class: 'us-chip2', title: 'Voir la version (V)', onclick: () => select({ kind: 'silo' }, true) }, h('b', null, c.name), c.won ? ' lancée' : ` ${c.proven}/${c.total}`) : null,
      h('button', { type: 'button', class: 'us-chip2', title: 'Projets Unreal connectés', onclick: T.act.openProjects },
        M.projects.length ? [h('b', null, M.projects[0].name), M.projects.length > 1 ? ` +${M.projects.length - 1}` : ` UE ${M.projects[0].engine || '?'}`] : 'Connecter un projet'),
    ];
  }

  function rowsOf(pairs) { return h('dl', { class: 'us-dl' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])); }
  function resultTxt(b) { return b ? [h('span', { class: b.ok ? 'us-t-ok' : 'us-t-ko' }, b.ok ? 'réussi' : 'en échec'), ' ', b.summary || '', ', ', T.agoEl(b.endedAt)] : null; }

  // La version : liste des features et de leurs preuves, reutilisee par la fiche du silo et par le mode « La version ».
  function featureList(c) {
    const verb = (k) => h('span', { class: k.ok === true ? 'us-t-ok' : k.ok === false ? 'us-t-ko' : 'us-dim' }, k.verb);
    return h('ul', { class: 'us-feats' },
      c.features.map(f => h('li', { class: `us-f-${f.status}` },
        h('span', { class: 'us-chip' }, f.statusText),
        h('div', null, h('b', null, f.title), f.checks.map(k => h('small', null, `${k.text} : `, verb(k), k.detail ? `, ${k.detail}` : '', k.at ? [', ', T.agoEl(k.at)] : ''))),
        f.manual ? btn(f.manual.done ? 'Annuler' : 'Je l\'ai testée', () => T.act.manual(f.id, !f.manual.done), f.manual.done ? '' : 'us-go') : null)),
      h('li', { class: `us-f-${c.final.status}` }, h('span', { class: 'us-chip' }, c.final.statusText),
        h('div', null, h('b', null, 'Lancement : épreuve finale'), c.final.locked ? h('small', null, 'Se débloque quand toutes les features sont prêtes.') : null,
          c.final.checks.map(k => h('small', null, `${k.text} : `, verb(k))))));
  }
  function wonRows(c) {
    return rowsOf([['Développement', T.dur(c.wonAt - c.createdAt)], ['Features', String(c.features.length)], ['Builds et tests', String(c.stats.builds)], ['Échecs corrigés', String(c.stats.failures)], ['Agents', String(c.stats.agents)], c.commit && ['Commit', `${c.commit.sha}${c.commit.dirty ? `, ${c.commit.dirty} fichiers non commités` : ''}`]]);
  }
  function buildList(list) {
    return h('ul', { class: 'us-builds' }, list.map(b => h('li', null,
      h('button', { type: 'button', class: 'us-build', 'aria-expanded': String(T.ui.openBuilds.has(b.id)), onclick: () => T.act.toggleBuild(b.id) },
        h('span', { class: 'us-time' }, T.clock(b.endedAt)), h('span', null, h('b', null, `${b.kindText}${b.detail ? ' ' + b.detail : ''}`), h('small', null, `${b.agent ? b.agent.name : b.label}, ${b.summary}${b.how ? ', ' + b.how : ''}`)), h('span', { class: 'us-time' }, T.dur(b.durationMs))),
      T.ui.openBuilds.has(b.id) ? h('div', { class: 'us-errs' }, h('code', { class: 'us-code' }, b.command), b.lines.length ? h('pre', null, b.lines.join('\n')) : h('span', { class: 'us-dim' }, 'Aucune ligne d\'erreur relevée.'), b.waitMs > 1000 ? h('span', { class: 'us-dim' }, `A attendu ${T.dur(b.waitMs)} devant la forge.`) : null) : null)));
  }

  // Fiche de ce qu'on a selectionne dans le jeu.
  function entityPanel(M) {
    const s = G.sel;
    if (!s || (MODE.noFiche && MODE.noFiche.includes(s.kind))) return null;
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
        list.length ? buildList(list) : h('p', { class: 'us-dim' }, ok ? 'Aucun build réussi pour l\'instant.' : 'Aucun échec récent.'),
      ];
    } else if (s.kind === 'silo') {
      const c = M.campaign;
      title = c ? `Silo : ${c.name}` : 'Silo à fusée';
      if (!c) body = [h('p', null, 'Chaque version est une fusée : ses features en sont les pièces, et l\'épreuve finale (le package) est le lancement.'), h('div', { class: 'us-actions' }, btn('Préparer une version', T.act.openBuilder, 'us-go'))];
      else if (c.won) body = [h('p', { class: 'us-t-ok' }, h('b', null, 'Fusée lancée : version validée.')), wonRows(c), h('div', { class: 'us-actions' }, btn('Ranger', T.act.archive), btn('Préparer la suivante', T.act.next, 'us-go'))];
      else body = [
        h('div', { class: 'us-bar' }, h('i', { style: `width:${c.pct}%` })),
        c.next ? h('p', { class: `us-next us-t-${c.next.tone}` }, c.next.text) : null,
        featureList(c),
        h('div', { class: 'us-actions' }, btn('Abandonner la version', T.act.abandon, 'us-danger'))];
    }
    return h('section', { class: 'us-panel us-entity', 'aria-label': title }, h('div', { class: 'us-ehead' }, h('h2', null, title), close), h('div', { class: 'us-ebody' }, body));
  }

  // ---------- ambiance (decor) : independante du fonctionnement ----------
  const WORLDS = [['jour', 'Jour'], ['nuit', 'Nuit'], ['plan', 'Plan'], ['volcan', 'Volcan'], ['banquise', 'Banquise']];
  function chosenWorld() {
    const q = new URLSearchParams(location.search).get('w') || location.hash.slice(1).split('.').find(x => WORLDS.some(w => w[0] === x));
    if (q && WORLDS.some(w => w[0] === q)) return q;
    try { const s = localStorage.getItem('tower.world'); if (s && WORLDS.some(w => w[0] === s)) return s; } catch { /* stockage bloque */ }
    return 'jour';
  }
  let worldLink = null, worldWait = null;
  function loadWorld(id, then) {
    if (TH && TH.id === id) { if (then) then(); return; }
    worldWait = then;
    const link = h('link', { rel: 'stylesheet', href: `usine/mondes/${id}.css` });
    document.head.append(link);
    if (worldLink) worldLink.remove();
    worldLink = link;
    const s = document.createElement('script'); s.src = `usine/mondes/${id}.js`; document.body.append(s);
  }
  function worldSwitch() {
    const sel = h('select', { 'aria-label': 'Ambiance du jeu', onchange: (e) => {
      try { localStorage.setItem('tower.world', e.target.value); } catch { /* stockage bloque */ }
      loadWorld(e.target.value, () => { G.dirty = true; G.canvas.setAttribute('aria-label', `L'usine (${TH.name}) : agents, forge et version, en direct`); renderHud(); });
    } }, WORLDS.map(([id, name]) => h('option', { value: id, selected: TH && TH.id === id }, name)));
    return h('label', { class: 'tw-switch' }, h('span', null, 'Ambiance'), sel);
  }

  // ---------- montage ----------
  // Le mode recoit cette boite a outils pour construire son HUD.
  const api = {
    h, T, btn, dotFor, rowsOf, resultTxt, featureList, wonRows, buildList, counters,
    select, center, refit: () => { G.userMoved = false; fit(); G.dirty = true; },
    get M() { return G.M; }, get sel() { return G.sel; }, get world() { return G.world; }, get mini() { return G.mini; },
    rerender: () => renderHud(),
  };

  function same(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
  function renderHud() {
    const M = G.M; if (!M) return;
    G.hud.chips.replaceChildren(...chips(M).filter(Boolean));
    G.hud.res.replaceChildren(...(MODE.counters ? counters(M) : []));
    const ent = entityPanel(M);
    G.hud.entity.replaceChildren(...(ent ? [ent] : []));
    G.hud.entity.hidden = !ent;
    G.app.classList.toggle('us-has-sel', !!ent);
    // Un mode peut rendre les memes noeuds d'une fois sur l'autre (un champ de saisie garde alors son focus).
    const nodes = (MODE.hud ? MODE.hud(M, api) : []).filter(Boolean);
    if (!same(nodes, [...G.hud.mode.children])) G.hud.mode.replaceChildren(...nodes);
    if (!M.inv) G.hud.empty.replaceChildren(h('p', null, M.projects.length ? 'La tour compte le projet : les gisements apparaissent dans un instant.' : 'Connecte un projet Unreal : ses domaines deviennent les gisements de l\'usine.'));
    G.hud.empty.hidden = !!M.inv;
  }

  function build(root) {
    G.canvas = h('canvas', { class: 'us-canvas', role: 'img', 'aria-label': `L'usine (${TH.name}) : agents, forge et version, en direct` });
    G.mini = h('canvas', { class: 'us-mini', width: 220, height: 120, 'aria-label': 'Mini-carte : clique pour déplacer la vue' });
    G.ctx = G.canvas.getContext('2d');
    G.hud = {
      chips: h('span', { class: 'us-chips' }), res: h('div', { class: 'us-res', 'aria-label': 'Compteurs' }),
      mode: h('div', { class: 'us-hud' }), entity: h('div', { class: 'us-entitybox' }), empty: h('div', { class: 'us-emptymap' }),
      tip: h('div', { class: 'us-tip', hidden: true, 'aria-hidden': 'true' }),
    };
    G.app = h('div', { class: `us-app us-m-${MODE.id}` },
      h('div', { class: 'us-stage' }, G.canvas, G.hud.empty, G.hud.tip),
      h('header', { class: 'us-top' }, h('span', { class: 'us-brand' }, 'Alkatrazz Tower'), h('span', { class: 'us-sub2' }, MODE.name), G.hud.chips, G.hud.res, h('span', { class: 'us-grow' }), T.switcher('Fonctionnement'), worldSwitch()),
      G.hud.mode,
      G.hud.entity);
    root.replaceChildren(G.app);
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
    if (MODE.follow && G.sel && !G.drag) center(G.sel);
    G.dirty = true;
    renderHud();
  }

  // web/usine/mondes/<id>.js appelle Usine.world({...}) ; web/templates/<id>.js appelle Usine.mode({...}).
  window.Usine = {
    TS, fbm, h2, shade, hexA, reduced,
    world(theme) {
      TH = theme;
      COL = Object.assign({}, BASE, theme.col || {});
      SC = !!theme.schematic;
      G.terrain = null; G.imgs.forEach((v, k) => { if (k.includes('|')) G.imgs.delete(k); });
      const then = worldWait; worldWait = null;
      if (then) then();
    },
    mode(def) {
      MODE = def;
      loadWorld(chosenWorld(), () => T.register({ id: def.id, render }));
    },
  };
})();
