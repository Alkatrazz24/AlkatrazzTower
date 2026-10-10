'use strict';
// Moteur commun des templates : la tour vue de dessus, facon jeu de gestion, comme un batiment.
// Chaque template (web/templates/<id>.js) apporte un fonctionnement (le HUD), chaque ambiance
// (web/usine/mondes/<id>.js) un monde : couleurs, terrain, decor, eclairage. Le jeu tourne en direct :
//   - chaque session Claude Code est une salle ; son agent y est assis a son bureau (un personnage en
//     pixels), ses sous-agents autour d'une table. L'ecran defile quand il travaille, une alerte
//     clignote quand il attend ta reponse ;
//   - les salles bordent un couloir et sont regroupees en ailes, une par projet (ou par dossier) ;
//   - au bout du couloir, la forge : un seul build a la fois, les autres agents font la queue devant
//     sa porte ; dedans, un coffre des builds reussis et un coffre des echecs ;
//   - en face, la salle de lancement : la version a sortir est une fusee, chaque feature prete l'eleve,
//     l'epreuve finale est le lancement ;
//   - a cote, la bibliotheque : un livre par skill installe, rouge s'il est casse, poussiereux s'il ne
//     sert jamais ;
//   - en face, le quartier des agents : un casier par agent que Claude Code peut appeler, range par
//     section ; ouvert quand l'agent est parti travailler dans une salle.
// Par-dessus, un HUD : compteurs en haut, version a gauche, mini-carte et alertes a droite, barre
// rapide en bas, et la fiche de ce qu'on a selectionne (clic sur le jeu, ou touches 1 a 9).

(function () {
  const T = window.Tower, h = T.h;
  const TS = 16; // taille d'une case en pixels du monde
  const MARGIN = 40; // cases de terrain precalculees autour du batiment
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE = {
    bg: '#2d2a25', ground: '#3a3530', ground2: '#353029', grid: 'rgba(0,0,0,.18)', concrete: '#57544e', concrete2: '#4f4c46',
    stripeA: '#d9b02b', stripeB: '#2b2722',
    belt: '#c9a227', beltDark: '#6b5615', steel: '#8b8f94', steelDark: '#4b4f55', steelLight: '#b9bdc2', machine: '#7d8288',
    forge: '#8a5a3c', forgeLight: '#a77455', forgeDark: '#4a2f20',
    fire: '#ff8a1f', fireHot: '#ffd166', ok: '#5fbf4a', ko: '#e0533d', warn: '#f2b233', blue: '#59a8e8', ghost: 'rgba(110,170,255,.55)',
    text: '#f1ede4', shadow: 'rgba(0,0,0,.45)', labelBg: 'rgba(20,20,22,.8)', wire: 'rgba(40,30,20,.75)', pole: '#6b4f33',
    select: '#ffd23f', mini: '#16140f',
    wall: '#8d8f93', wallLight: '#b4b6b9', wallDark: '#505256', floor: '#a47d4f', floorLine: '#7a5a35',
    hall: '#6f6c66', carpet: '#7d2e2e', carpetEdge: '#c9a227', desk: '#6e4a2a', deskLight: '#94663b', deskDark: '#40291a',
    screen: '#14202c', table: '#5d4127',
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

  // ---------- plan du batiment ----------
  // Un couloir horizontal ; de part et d'autre, une salle par session, regroupees en ailes (une par
  // projet). Au bout du couloir, la forge (en bas) et la salle de lancement de la version (en haut).
  const ROOM_H = 7, CY = 9, CH = 3; // hauteur des salles, haut du couloir, hauteur du couloir
  const TOP = CY - ROOM_H, BOT = CY + CH; // y des salles du haut et du bas
  const MAX_SUBS = 6; // sous-agents dessines par salle ; au-dela, « +n »
  const ORDER = { waiting: 0, idle: 1, working: 2, ready: 3, silent: 4, ended: 5 };
  function roomW(a) {
    const n = Math.min(MAX_SUBS, (a.subList || []).length);
    return n ? Math.max(7, Math.round(6.2 + Math.ceil(n / 2) * 1.7)) : 6;
  }
  function layout(M) {
    const shown = M.agents.filter(a => a.st !== 'ended' || T.ui.showEnded);
    // Ailes : un projet Unreal, sinon le dossier de la session. L'aile qui a le plus urgent passe en premier.
    const wings = new Map();
    for (const a of shown) {
      const k = a.project || a.where || 'Autres';
      if (!wings.has(k)) wings.set(k, []);
      wings.get(k).push(a);
    }
    const byState = (a, b) => (ORDER[a.st] - ORDER[b.st]) || a.name.localeCompare(b.name);
    const list = [...wings].map(([name, as]) => ({ name, as: as.sort(byState), project: !!as[0].project }));
    list.sort((p, q) => byState(p.as[0], q.as[0]) || p.name.localeCompare(q.name));
    const machines = [], fillers = [], wingList = [];
    let x = 3;
    for (const wg of list) {
      const x0w = x;
      let tx = x, bx = x;
      for (const a of wg.as) {
        const w = roomW(a), top = tx <= bx;
        machines.push({ a, x: top ? tx : bx, y: top ? TOP : BOT, w, h: ROOM_H, top, wing: wg.name });
        if (top) tx += w; else bx += w;
      }
      const end = Math.max(tx, bx);
      // la rangee la plus courte se termine par une reserve, pour que l'aile reste d'un seul bloc
      if (tx < end) fillers.push({ x: tx, y: TOP, w: end - tx, h: ROOM_H });
      if (bx < end) fillers.push({ x: bx, y: BOT, w: end - bx, h: ROOM_H });
      wingList.push({ name: wg.name, project: wg.project, x: x0w, w: end - x0w });
      x = end + 1;
    }
    fillers.push({ x: 1, y: TOP, w: 2, h: ROOM_H }, { x: 1, y: BOT, w: 2, h: ROOM_H }); // le hall d'entree
    if (!machines.length) { fillers.push({ x, y: TOP, w: 6, h: ROOM_H, free: true }, { x, y: BOT, w: 6, h: ROOM_H, free: true }); x += 7; }
    // Gap d'un pas entre les ailes : un pilier plein.
    const pillars = wingList.slice(1).map(wg => wg.x - 1);
    const fx = x;
    const froom = { x: fx, y: BOT, w: 10, h: ROOM_H, door: fx + 1.2 };
    const forge = { x: fx + 1, y: BOT + 1.8, w: 4, h: 4 };
    const okChest = { x: fx + 7.2, y: BOT + 1.4, w: 2, h: 2 }, koChest = { x: fx + 7.2, y: BOT + 4.2, w: 2, h: 2 };
    const vroom = { x: fx, y: TOP, w: 10, h: ROOM_H };
    const silo = { x: fx + 2, y: TOP + .5, w: 6, h: 6 };
    // la bibliotheque des skills, apres la salle de lancement ; le quartier des agents en face
    const lroom = { x: fx + 10, y: TOP, w: 8, h: ROOM_H };
    const aroom = { x: fx + 10, y: BOT, w: 8, h: ROOM_H };
    const right = fx + 18;
    const hall = { x: 1, y: CY, w: right - 1, h: CH };
    // Plafonniers du couloir : ils eclairent la nuit.
    const lamps = [];
    for (let lx = 2.5; lx < right - 1; lx += 6) lamps.push({ x: lx, y: CY + 1.5 });
    const you = { x: 1.2, y: CY + .1 };
    return { machines, fillers, wings: wingList, pillars, forge, froom, okChest, koChest, silo, vroom, lroom, aroom, hall, lamps, you, w: right + 2, h: BOT + ROOM_H + 2, x0: 3 };
  }

  // ---------- terrain : calcule une fois par taille de batiment, hors de la boucle ----------
  const inBase = (x, y, W) => x >= 0 && x < W.w - 1 && y >= 1 && y < W.h - 1;
  function buildTerrain(W) {
    const x0 = -MARGIN, y0 = -MARGIN, cols = W.w + 2 * MARGIN, rows = W.h + 2 * MARGIN;
    const cv = document.createElement('canvas');
    cv.width = cols * TS; cv.height = rows * TS;
    const c = cv.getContext('2d');
    c.translate(-x0 * TS, -y0 * TS);
    const anim = [];
    for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x0 + cols; x++) {
      if (inBase(x, y, W)) continue;
      let r = TH.tile ? TH.tile(x, y, fbm(x, y), h2(x, y)) : (h2(x, y) & 7) < 2 ? COL.ground2 : COL.ground;
      // ni eau ni lave au ras du batiment : on y pose le sol du monde
      if (r.anim && x >= -2 && x <= W.w + 1 && y >= -1 && y <= W.h) r = TH.safe || COL.ground;
      const color = typeof r === 'string' ? r : r.c;
      c.fillStyle = color; c.fillRect(x * TS, y * TS, TS, TS);
      if (r.anim) anim.push({ x, y, kind: r.anim, c: color });
    }
    // Decor autour du batiment (arbres, rochers...), a l'ecart de ses murs.
    if (TH.deco) for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x0 + cols; x++) {
      if (x >= -1 && x < W.w && y >= 0 && y < W.h) continue;
      if (anim.length && TH.tile && TH.tile(x, y, fbm(x, y), h2(x, y)).anim) continue;
      TH.deco(c, x * TS, y * TS, fbm(x, y), h2(x, y));
    }
    // Soubassement du batiment : une dalle qui deborde d'une case.
    c.fillStyle = COL.concrete; c.fillRect(0, TS, (W.w - 1) * TS, (W.h - 2) * TS);
    if (!SC) {
      for (let y = 1; y < W.h - 1; y++) for (let x = 0; x < W.w - 1; x++) if ((h2(x, y) & 7) === 0) { c.fillStyle = COL.concrete2; c.fillRect(x * TS, y * TS, TS, TS); }
      c.fillStyle = COL.shadow; c.fillRect(TS, (W.h - 1) * TS, (W.w - 1) * TS, 4); c.fillRect((W.w - 1) * TS, 2 * TS, 4, (W.h - 3) * TS);
    } else {
      c.strokeStyle = COL.steelLight; c.setLineDash([8, 6]); c.lineWidth = 1.5; c.strokeRect(.5, TS + .5, (W.w - 1) * TS, (W.h - 2) * TS); c.setLineDash([]);
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

  function light(x, y, r, color, k = 1) { G.lights.push({ x, y, r, color, k }); }

  // ---------- sous-agents : une allure tiree de leur type (deux « Explore » se ressemblent) ----------
  const SUB_SHIRT = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const SUB_TOOL = { explore: 'pioche', plan: 'pinceau', 'general-purpose': 'cle', 'code-reviewer': 'epee' };
  function subLook(s) {
    const k = hash(s.type), j = hash(s.id);
    return {
      skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][j % 5], hair: ['#2b1d0e', '#5a3825', '#a0522d', '#e6be8a', '#111111'][(j >>> 3) % 5],
      hairStyle: ['court', 'long', 'chauve', 'queue'][(j >>> 6) % 4], shirt: SUB_SHIRT[k % SUB_SHIRT.length], shirtStyle: ['uni', 'rayures', 'salopette'][(k >>> 4) % 3],
      pants: '#374151', hat: 'casquette', hatColor: shade(SUB_SHIRT[k % SUB_SHIRT.length], -.3),
      tool: SUB_TOOL[String(s.type).toLowerCase()] || ['marteau', 'cle', 'clavier', 'pioche'][(k >>> 8) % 4],
    };
  }
  const subsOf = (a) => (a.subList || []).slice().sort((p, q) => p.type.localeCompare(q.type) || p.id.localeCompare(q.id));

  // Un personnage, coin haut gauche en (x, y), avec son ombre. s : echelle (agent 1,3 ; sous-agent plus petit).
  const BIG = 1.3, SUB = 1.05;
  function person(c, look, st, x, y, t, s = BIG) {
    const im = avatarImg(look, st), w = 22 * s, hh = 35 * s;
    const bob = st === 'working' && !reduced ? Math.round(Math.sin(t * 9 + x) * 1) : 0;
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + w / 2, y + hh - 1, 8 * s, 2.6 * s, 0, 0, Math.PI * 2); c.fill();
    if (im.complete && im.naturalWidth) c.drawImage(im, x, y - 2 + bob, w, hh);
  }

  // ---------- batiment : sols, murs, portes ----------
  // Plancher de bois en lattes decalees.
  function planks(c, x, y, w, hh, color = COL.floor) {
    if (SC) { c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x, y, w, hh); return; }
    c.fillStyle = color; c.fillRect(x, y, w, hh);
    for (let yy = 0; yy < hh; yy += 5) {
      const row = Math.floor((y + yy) / 5), off = h2(row, 7) % 24;
      if (h2(row, 3) % 5 === 0) { c.fillStyle = shade(color, -.06); c.fillRect(x, y + yy, w, Math.min(5, hh - yy)); }
      c.fillStyle = COL.floorLine; c.fillRect(x, y + yy, w, 1);
      for (let xx = off; xx < w; xx += 24) c.fillRect(Math.floor(x + xx), y + yy, 1, Math.min(5, hh - yy));
    }
  }
  // Dalles de pierre (couloir, forge).
  function flags(c, x, y, w, hh, base) {
    if (SC) { c.fillStyle = 'rgba(255,255,255,.035)'; c.fillRect(x, y, w, hh); return; }
    c.fillStyle = base; c.fillRect(x, y, w, hh);
    for (let ty = 0; ty < hh; ty += TS) for (let tx = 0; tx < w; tx += TS) {
      const k = h2(Math.floor((x + tx) / TS), Math.floor((y + ty) / TS));
      if (k % 3 === 0) { c.fillStyle = shade(base, k % 2 ? -.05 : .04); c.fillRect(x + tx, y + ty, Math.min(TS, w - tx), Math.min(TS, hh - ty)); }
    }
    c.fillStyle = COL.grid;
    for (let tx = TS; tx < w; tx += TS) c.fillRect(x + tx, y, 1, hh);
    for (let ty = TS; ty < hh; ty += TS) c.fillRect(x, y + ty, w, 1);
  }
  const WALL = 5; // epaisseur d'un mur, en pixels
  function wallSeg(c, x, y, w, hh) {
    if (w <= 0 || hh <= 0) return;
    c.fillStyle = COL.wallDark; c.fillRect(x, y, w, hh);
    c.fillStyle = COL.wall; c.fillRect(x, y, w - (hh > w ? 1 : 0), hh - (w >= hh ? 1 : 0));
    c.fillStyle = COL.wallLight; if (w >= hh) c.fillRect(x, y, w, 1); else c.fillRect(x, y, 1, hh);
    c.fillStyle = COL.wallDark; // joints entre les pierres
    if (w >= hh) for (let k = (Math.floor(x) % 9) + 6; k < w; k += 9) c.fillRect(x + k, y + 1, 1, hh - 2);
    else for (let k = (Math.floor(y) % 9) + 6; k < hh; k += 9) c.fillRect(x + 1, y + k, w - 2, 1);
  }
  // Murs d'une piece (en cases), avec une porte : { side: 'top'|'bottom', x, w, open }.
  function walls(c, R, door) {
    const x = R.x * TS, y = R.y * TS, w = R.w * TS, hh = R.h * TS;
    if (SC) {
      c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.strokeRect(x + .75, y + .75, w - 1.5, hh - 1.5);
      if (door) {
        const dx = door.x * TS, dw = door.w * TS, dy = door.side === 'top' ? y : y + hh;
        c.fillStyle = COL.bg; c.fillRect(dx, dy - 2, dw, 4);
        if (!door.open) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.beginPath(); c.moveTo(dx, dy); c.lineTo(dx + dw, dy); c.stroke(); }
      }
      return;
    }
    wallSeg(c, x, y + WALL, WALL, hh - 2 * WALL); wallSeg(c, x + w - WALL, y + WALL, WALL, hh - 2 * WALL);
    for (const side of ['top', 'bottom']) {
      const yy = side === 'top' ? y : y + hh - WALL;
      if (door && door.side === side) {
        const dx = door.x * TS, dw = door.w * TS;
        wallSeg(c, x, yy, dx - x, WALL); wallSeg(c, dx + dw, yy, x + w - dx - dw, WALL);
        c.fillStyle = COL.deskDark; c.fillRect(dx, yy, dw, WALL); // seuil
        c.fillStyle = COL.floorLine; c.fillRect(dx + 1, yy + 1, dw - 2, WALL - 2);
        if (!door.open) { c.fillStyle = COL.desk; c.fillRect(dx, yy, dw, WALL); c.fillStyle = COL.deskLight; c.fillRect(dx + 1, yy + 1, dw - 2, 1); }
      } else wallSeg(c, x, yy, w, WALL);
    }
  }

  function drawHall(c, W, t) {
    const H = W.hall, x = H.x * TS, y = H.y * TS, w = H.w * TS, hh = H.h * TS;
    flags(c, x, y, w, hh, COL.hall);
    if (!SC) { // tapis rouge le long du couloir, jusqu'a la forge
      c.fillStyle = COL.carpet; c.fillRect(x + TS, y + hh / 2 - 9, w - 2 * TS, 18);
      c.fillStyle = COL.carpetEdge; c.fillRect(x + TS, y + hh / 2 - 9, w - 2 * TS, 2); c.fillRect(x + TS, y + hh / 2 + 7, w - 2 * TS, 2);
      wallSeg(c, x + w - WALL, y, WALL, hh); // fond du couloir
      c.fillStyle = COL.carpetEdge; c.fillRect(0, y + hh / 2 - 9, x + TS, 18); // paillasson de l'entree
      c.fillStyle = shade(COL.carpetEdge, -.35); for (let k = 2; k < x + TS; k += 4) c.fillRect(k, y + hh / 2 - 7, 2, 14);
    } else {
      c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w, y + hh); c.stroke();
      c.setLineDash([3, 4]); c.strokeStyle = 'rgba(232,241,255,.35)'; c.beginPath(); c.moveTo(x, y + hh / 2); c.lineTo(x + w, y + hh / 2); c.stroke(); c.setLineDash([]);
    }
    // les ailes : une arche au debut de chacune
    for (const wg of W.wings) {
      const ax = wg.x * TS - (wg === W.wings[0] ? 0 : TS / 2);
      if (SC) { c.strokeStyle = 'rgba(232,241,255,.4)'; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(ax, y); c.lineTo(ax, y + hh); c.stroke(); c.setLineDash([]); continue; }
      wallSeg(c, ax - 3, y, 6, 6); wallSeg(c, ax - 3, y + hh - 6, 6, 6);
    }
  }
  // Reserve : une piece sans porte qui ferme la rangee d'une aile ; « libre » quand il n'y a encore aucune session.
  function drawFiller(c, f) {
    const x = f.x * TS, y = f.y * TS, w = f.w * TS, hh = f.h * TS;
    if (f.free) { planks(c, x, y, w, hh); walls(c, f, { side: f.y === TOP ? 'bottom' : 'top', x: f.x + f.w - 2.2, w: 1.6, open: false }); return; }
    flags(c, x, y, w, hh, shade(COL.hall, -.12));
    walls(c, f, null);
    if (SC || w < 2 * TS) return;
    for (let i = 0; i < Math.min(3, Math.floor(f.w / 2)); i++) { // caisses rangees le long du mur
      const cx = x + 10 + i * 22, cy = f.y === TOP ? y + 9 : y + hh - 25;
      c.fillStyle = COL.shadow; c.fillRect(cx + 2, cy + 3, 16, 14);
      c.fillStyle = '#a0723c'; c.fillRect(cx, cy, 16, 14);
      c.fillStyle = '#7a5428'; c.fillRect(cx, cy + 6, 16, 2); c.fillRect(cx + 7, cy, 2, 14);
    }
  }
  function pillar(c, x, y) {
    if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1.5; c.strokeRect(x * TS + .75, y * TS + .75, TS - 1.5, ROOM_H * TS - 1.5); return; }
    c.fillStyle = COL.wallDark; c.fillRect(x * TS, y * TS, TS, ROOM_H * TS);
    for (let r = 0; r < ROOM_H * 2; r++) { c.fillStyle = r % 2 ? COL.wall : shade(COL.wall, -.08); c.fillRect(x * TS + 1, y * TS + r * 8 + 1, TS - 2, 7); }
  }

  // ---------- la salle d'une session ----------
  // Le bureau de l'agent principal a gauche (il est assis derriere, son ecran a cote), la table des
  // sous-agents a droite, la porte sur le couloir. Hors de sa salle quand il est a la forge ou dans la file.
  function roomDoor(m) { return { side: m.top ? 'bottom' : 'top', x: m.x + m.w - 2.2, w: 1.6 }; }
  function drawRoom(c, m, t, away) {
    const a = m.a, x = m.x * TS, y = m.y * TS, w = m.w * TS, hh = m.h * TS;
    if (a.st === 'ended') { // salle fermee : contour bleu en pointilles
      c.fillStyle = 'rgba(110,170,255,.1)'; c.fillRect(x, y, w, hh);
      c.strokeStyle = COL.ghost; c.setLineDash([4, 3]); c.lineWidth = 2; c.strokeRect(x + 2, y + 2, w - 4, hh - 4); c.setLineDash([]);
      return;
    }
    const on = a.st === 'working' || a.holds;
    planks(c, x, y, w, hh, a.st === 'silent' ? shade(COL.floor, -.18) : COL.floor);
    const subs = subsOf(a), shown = subs.slice(0, MAX_SUBS);
    // tapis sous la table des sous-agents
    if (shown.length && !SC) { c.fillStyle = shade(COL.carpet, .1); c.fillRect(x + 4.3 * TS, y + 1.6 * TS, w - 4.9 * TS, 4.5 * TS); c.fillStyle = shade(COL.carpet, -.15); c.fillRect(x + 4.3 * TS + 3, y + 1.6 * TS + 3, w - 4.9 * TS - 6, 4.5 * TS - 6); }
    else if (!SC) { // une plante dans le coin
      const px = x + w - 1.4 * TS, py = m.top ? y + .9 * TS : y + hh - 2.2 * TS;
      c.fillStyle = '#8a5a3c'; c.fillRect(px + 3, py + 10, 12, 9);
      c.fillStyle = '#3f8f3a'; c.fillRect(px, py + 2, 8, 9); c.fillRect(px + 8, py, 9, 10); c.fillStyle = '#56a84a'; c.fillRect(px + 4, py - 3, 8, 8);
    }
    walls(c, m, Object.assign(roomDoor(m), { open: true }));
    // l'agent, assis derriere son bureau
    if (!away) person(c, a.look, poseOf(a), x + 1.0 * TS, y + .4 * TS, t);
    const dx = x + .6 * TS, dy = y + 2.5 * TS, dw = 3.7 * TS, dh = 1.1 * TS;
    box(c, dx, dy, dw, dh, COL.desk, COL.deskLight, COL.deskDark);
    // ecran : il defile quand l'agent travaille, orange quand il t'attend
    const sx = dx + 2.4 * TS, sy = dy - .95 * TS, sw = 1.1 * TS, sh = .85 * TS;
    if (!SC) { c.fillStyle = '#26282b'; c.fillRect(sx + sw / 2 - 2, sy + sh, 4, .2 * TS); c.fillRect(sx - 1, sy - 1, sw + 2, sh + 2); }
    const scr = a.st === 'waiting' ? COL.warn : a.st === 'idle' ? COL.ok : on ? COL.blue : null;
    if (SC) { c.strokeStyle = COL.steelLight; c.lineWidth = 1; c.strokeRect(sx + .5, sy + .5, sw - 1, sh - 1); }
    else { c.fillStyle = COL.screen; c.fillRect(sx, sy, sw, sh); }
    if (scr) G.emit.push(() => {
      c.globalAlpha = .9; c.fillStyle = scr; c.fillRect(sx + 1, sy + 1, sw - 2, sh - 2); c.globalAlpha = 1;
      c.fillStyle = COL.screen;
      const off = on && !reduced ? Math.floor(t * 6) % 4 : 0;
      for (let k = 0; k < 4; k++) c.fillRect(sx + 3, sy + 2 + ((k + off) % 4) * 3, 4 + (h2(k + off, m.x) % 9), 1);
    });
    if (TH.machineOverlay) TH.machineOverlay(c, dx, dy, dw, dh, a, on, t);
    // les sous-agents autour de la table : une rangee derriere, une devant
    if (shown.length) {
      const tx = x + 4.6 * TS, tw = w - 5.4 * TS, ty = y + 3.35 * TS;
      const spot = (i) => ({ px: tx + 1 + Math.floor(i / 2) * 1.7 * TS, py: y + (i % 2 ? 3.85 : 1.45) * TS });
      const sst = a.st === 'working' ? 'working' : 'ready';
      shown.forEach((s, i) => { if (i % 2 === 0) { const p = spot(i); person(c, subLook(s), sst, p.px, p.py, t, SUB); } });
      box(c, tx, ty, tw, .85 * TS, COL.table, shade(COL.table, .2), shade(COL.table, -.35));
      if (!SC) for (let i = 0; i < shown.length; i++) { c.fillStyle = '#e8e4da'; c.fillRect(tx + 6 + Math.floor(i / 2) * 1.7 * TS + (i % 2) * 7, ty + 4, 6, 5); } // feuilles sur la table
      shown.forEach((s, i) => { if (i % 2 === 1) { const p = spot(i); person(c, subLook(s), sst, p.px, p.py, t, SUB); } });
    }
    // voyant d'etat a cote de la porte, et plafonnier (lumineux : ils restent visibles la nuit)
    const lamp = a.st === 'waiting' ? COL.warn : a.st === 'idle' ? COL.ok : on ? COL.blue : '#6f747a';
    const D = roomDoor(m), lx = (D.x + D.w) * TS + 3, ly = m.top ? y + hh - WALL : y;
    c.fillStyle = '#1e1f22'; c.fillRect(lx, ly - .5, 6, 6);
    G.emit.push(() => { c.fillStyle = lamp; c.fillRect(lx + 1, ly + .5, 4, 4); });
    light(x + w / 2, y + hh / 2, on ? 80 : 56, on ? COL.blue : '#ffe3a8', on ? .95 : .7);
    light(lx + 3, ly + 2, 26, lamp, .8);
  }
  const poseOf = (a) => (a.holds ? 'working' : a.st);

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

  // Plafonniers du couloir (ils eclairent la nuit).
  function drawLamps(c, W) {
    if (!TH.lamps) return;
    for (const l of W.lamps) {
      const x = l.x * TS, y = l.y * TS;
      c.fillStyle = COL.steelDark; c.fillRect(x - 4, y - 2, 9, 4);
      G.emit.push(() => { c.fillStyle = TH.lamps; c.fillRect(x - 3, y - 1, 7, 2); });
      light(x, y, 70, TH.lamps, .8);
    }
  }

  // La forge : une salle au bout du couloir. Le four, les coffres des builds, et l'agent qui compile.
  function drawForgeRoom(c, W, t) {
    const R = W.froom, M = G.M;
    flags(c, R.x * TS, R.y * TS, R.w * TS, R.h * TS, shade(COL.hall, -.05));
    walls(c, R, { side: 'top', x: R.door, w: 1.6, open: true });
    drawForge(c, W, t);
    const okN = M.builds.filter(b => b.ok).length;
    drawChest(c, W.okChest, true, okN);
    drawChest(c, W.koChest, false, M.builds.length - okN);
    // le dernier build termine glisse jusqu'a son coffre pendant quelques secondes
    const last = M.builds[0];
    if (last && !reduced && !SC) {
      const age = (Date.now() - last.endedAt) / 1000;
      if (age >= 0 && age < 4) {
        const ch = last.ok ? W.okChest : W.koChest, k = age / 4, fx = (W.forge.x + W.forge.w) * TS, cx = fx + k * (ch.x * TS - fx), cy = (ch.y + 1) * TS;
        c.fillStyle = COL.shadow; c.fillRect(cx - 5, cy - 3, 12, 10);
        c.fillStyle = '#a0723c'; c.fillRect(cx - 6, cy - 6, 12, 10); c.fillStyle = '#7a5428'; c.fillRect(cx - 6, cy - 2, 12, 2);
      }
    }
    if (M.lock && M.lock.agent) person(c, M.lock.agent.look, 'working', (W.forge.x + W.forge.w + .2) * TS, (W.forge.y - .2) * TS, t);
    light((R.x + R.w / 2) * TS, (R.y + R.h / 2) * TS, 60, '#ffe3a8', .6);
  }
  // La salle de lancement : le pas de tir de la version au milieu.
  function drawVersionRoom(c, W, t) {
    const R = W.vroom, x = R.x * TS, y = R.y * TS, w = R.w * TS, hh = R.h * TS;
    flags(c, x, y, w, hh, shade(COL.hall, -.05));
    if (!SC) for (let i = 0; i < R.w * 2; i++) { c.fillStyle = i % 2 ? COL.stripeA : COL.stripeB; c.fillRect(x + i * 8, y + hh - WALL - 4, 8, 4); }
    walls(c, R, { side: 'bottom', x: R.x + .6, w: 1.2, open: true });
    drawSilo(c, W, t);
  }

  // La bibliotheque : un livre par skill sur les etageres du fond. Couleur vive : il sert ; poussiereux :
  // jamais appele en 30 jours ; orange : a revoir ; rouge : casse (Claude Code ne peut pas s'en servir).
  const BOOK = ['#2f6db5', '#3d8b4f', '#7a4fa3', '#1f8a8a', '#b5652f', '#5a6fb5', '#8a3d6b', '#4f7a2f'];
  function bookColor(s) { return s.status === 'ko' ? COL.ko : s.status === 'warn' ? COL.warn : s.status === 'unused' ? '#8a8172' : BOOK[hash(s.call) % BOOK.length]; }
  function drawLibrary(c, W, t) {
    const R = W.lroom, x = R.x * TS, y = R.y * TS, w = R.w * TS, hh = R.h * TS;
    const L = G.M.S.skills;
    planks(c, x, y, w, hh, shade(COL.floor, -.12));
    if (!SC) { c.fillStyle = shade(COL.carpet, -.05); c.fillRect(x + 1.6 * TS, y + 3.6 * TS, w - 3.2 * TS, 2.4 * TS); c.fillStyle = COL.carpetEdge; c.fillRect(x + 1.6 * TS, y + 3.6 * TS, w - 3.2 * TS, 1); c.fillRect(x + 1.6 * TS, y + 6 * TS - 1, w - 3.2 * TS, 1); }
    walls(c, R, { side: 'bottom', x: R.x + R.w - 2.2, w: 1.6, open: true });
    // etageres : trois rangees contre le mur du fond
    const sx = x + WALL + 3, sw = w - 2 * WALL - 6, rows = 3, rowH = 15, sy = y + WALL + 2;
    box(c, sx - 2, sy - 2, sw + 4, rows * rowH + 5, COL.deskDark, COL.desk, shade(COL.deskDark, -.3));
    const books = L ? L.skills : [];
    const per = Math.floor(sw / 5);
    books.slice(0, per * rows).forEach((b, i) => {
      const r = Math.floor(i / per), k = i % per;
      const bh = 9 + (hash(b.call) % 4), bx = sx + 1 + k * 5, by = sy + r * rowH + (rowH - 2 - bh);
      const col = bookColor(b);
      if (SC) { c.strokeStyle = col; c.lineWidth = 1; c.strokeRect(bx + .5, by + .5, 3, bh - 1); return; }
      c.fillStyle = col; c.fillRect(bx, by, 4, bh);
      c.fillStyle = shade(col, .25); c.fillRect(bx, by, 1, bh);
      if (b.status === 'unused') { c.fillStyle = 'rgba(230,225,210,.35)'; c.fillRect(bx, by, 4, 2); } // poussiere
    });
    if (!SC) for (let r = 1; r <= rows; r++) { c.fillStyle = COL.deskLight; c.fillRect(sx - 1, sy + r * rowH - 2, sw + 2, 2); }
    // un livre casse fait clignoter l'etagere
    if (L && L.ko && (reduced || Math.floor(t * 2) % 2 === 0)) light(x + w / 2, sy + 20, 40, COL.ko, .7);
    // pupitre de lecture et son livre ouvert, sous une lampe
    const tx = x + w / 2 - 1.3 * TS, ty = y + 4.1 * TS;
    box(c, tx, ty, 2.6 * TS, 1.1 * TS, COL.table, shade(COL.table, .2), shade(COL.table, -.35));
    if (!SC) { c.fillStyle = '#efe9da'; c.fillRect(tx + 11, ty + 4, 9, 8); c.fillRect(tx + 21, ty + 4, 9, 8); c.fillStyle = '#b9b09c'; c.fillRect(tx + 20, ty + 4, 1, 8); for (let k = 0; k < 3; k++) { c.fillRect(tx + 13, ty + 6 + k * 2, 5, 1); c.fillRect(tx + 23, ty + 6 + k * 2, 5, 1); } }
    light(x + w / 2, ty + 6, 70, '#ffe3a8', .9);
  }

  // Le quartier des agents : un casier par agent que Claude Code peut appeler, de la couleur de sa section,
  // contre le mur du fond. Ouvert : l'agent est parti travailler dans une salle. Pastille rouge : son fichier
  // est casse ; orange : a revoir ; terne : jamais appele en 30 jours.
  const SEC_COL = ['#c2410c', '#2563eb', '#16a34a', '#9333ea', '#0891b2', '#ca8a04', '#db2777', '#4d7c0f', '#7c3aed', '#0f766e', '#b45309', '#475569'];
  function rosterBusy(M, ag) {
    const k = ag.call.toLowerCase(), n = ag.name.toLowerCase();
    return M.agents.filter(a => a.st !== 'ended' && (ag.scope !== 'projet' || a.project === ag.project) && a.subList.some(x => { const t = String(x.type).toLowerCase(); return t === k || t === n; }));
  }
  function drawAgentsRoom(c, W, t) {
    const R = W.aroom, x = R.x * TS, y = R.y * TS, w = R.w * TS, hh = R.h * TS;
    const A = G.M.S.roster, list = A ? A.agents : [];
    planks(c, x, y, w, hh, shade(COL.floor, -.06));
    walls(c, R, { side: 'top', x: R.x + 1.2, w: 1.6, open: true });
    // banc au milieu de la piece
    const bx = x + w / 2 - 2 * TS, by = y + 2.4 * TS;
    box(c, bx, by, 4 * TS, .7 * TS, COL.table, shade(COL.table, .2), shade(COL.table, -.35));
    // casiers : trois rangees au plus contre le mur du fond
    const lw = 7, lh = 22, sx = x + WALL + 3, sw = w - 2 * WALL - 6, per = Math.max(1, Math.floor(sw / lw));
    const rows = Math.min(3, Math.max(1, Math.ceil(list.length / per)));
    const top = y + hh - WALL - 3 - rows * (lh + 2);
    box(c, sx - 2, top - 2, sw + 4, rows * (lh + 2) + 3, COL.steelDark, COL.steel, shade(COL.steelDark, -.3));
    let lit = 0;
    list.slice(0, per * rows).forEach((ag, i) => {
      const r = Math.floor(i / per), k = i % per, lx = sx + k * lw, ly = top + r * (lh + 2);
      const col = SEC_COL[hash(ag.section) % SEC_COL.length];
      const busy = rosterBusy(G.M, ag).length;
      if (SC) { c.strokeStyle = busy ? COL.blue : col; c.lineWidth = 1; c.strokeRect(lx + .5, ly + .5, lw - 2, lh - 1); return; }
      c.fillStyle = ag.status === 'unused' && !busy ? shade(col, -.35) : col; c.fillRect(lx, ly, lw - 1, lh);
      c.fillStyle = shade(col, .25); c.fillRect(lx, ly, 1, lh);
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(lx + 1, ly + 3, lw - 3, 1); c.fillRect(lx + 1, ly + 5, lw - 3, 1); c.fillRect(lx + lw - 3, ly + 10, 1, 3); // aerations, poignee
      if (busy) { // porte ouverte : le casier est vide, l'agent est parti travailler
        c.fillStyle = '#0d0d10'; c.fillRect(lx + 1, ly + 1, lw - 3, lh - 2);
        c.fillStyle = COL.blue; c.fillRect(lx + 1, ly + lh - 3, lw - 3, 1);
        c.fillStyle = shade(col, .35); c.fillRect(lx + lw - 2, ly - 2, 3, lh + 2); lit++;
      }
      if (ag.status === 'ko' || ag.status === 'warn') { c.fillStyle = ag.status === 'ko' ? COL.ko : COL.warn; c.fillRect(lx + 1, ly + lh - 4, 3, 3); }
    });
    if (lit && !SC) light(x + w / 2, top + 10, 46, COL.blue, .6);
    if (A && A.ko && (reduced || Math.floor(t * 2) % 2 === 0)) light(x + w / 2, top + 10, 36, COL.ko, .6);
    light(x + w / 2, by + 6, 64, '#ffe3a8', .8);
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
      if (m) return m;
      const L = G.M.lock; return L && L.agent && L.agent.id === sel.id ? W.froom : null;
    }
    if (sel.kind === 'forge') return W.froom;
    if (sel.kind === 'silo') return W.vroom;
    if (sel.kind === 'skills') return W.lroom;
    if (sel.kind === 'roster') return W.aroom;
    if (sel.kind === 'ok') return W.okChest;
    if (sel.kind === 'ko') return W.koChest;
    return null;
  }

  // Ceux qui attendent la forge font la queue dans le couloir, devant sa porte.
  function queueSpots(W) {
    return G.M.queue.map((q, i) => ({ q, x: W.froom.door - 1.9 - i * 1.9, y: CY + .1 }));
  }
  const ALI = { hat: 'casquette', hatColor: '#78a6ff', accessory: 'casque-audio', tool: 'clavier', shirt: '#334155' };

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
    drawHall(c, W, t);
    for (const f of W.fillers) drawFiller(c, f);
    for (const px of W.pillars) { pillar(c, px, TOP); pillar(c, px, BOT); }
    // un agent a la forge ou dans la file a quitte son bureau
    const away = new Set(M.queue.filter(q => q.agent).map(q => q.agent.id));
    if (M.lock && M.lock.agent) away.add(M.lock.agent.id);
    for (const m of W.machines) drawRoom(c, m, t, away.has(m.a.id));
    drawForgeRoom(c, W, t);
    drawVersionRoom(c, W, t);
    drawLibrary(c, W, t);
    drawAgentsRoom(c, W, t);
    drawLamps(c, W);
    // dans le couloir : la file devant la forge, et toi a l'entree
    const people = queueSpots(W).map(p => ({ look: p.q.agent ? p.q.agent.look : {}, st: 'ready', x: p.x * TS, y: p.y * TS }));
    people.push({ look: ALI, st: 'ready', x: W.you.x * TS, y: W.you.y * TS });
    people.sort((p, q) => p.x - q.x);
    for (const p of people) person(c, p.look, p.st, p.x, p.y, t);
    // selection
    const b = boundsOf(G.sel);
    if (b) brackets(c, b, t);
    const hv = G.hover && (!G.sel || G.hover.kind !== G.sel.kind || G.hover.id !== G.sel.id) ? boundsOf(G.hover) : null;
    if (hv) { c.globalAlpha = .45; brackets(c, hv, 0); c.globalAlpha = 1; }
  }

  // Alertes facon jeu, dessinees apres la nuit pour rester visibles : triangle qui clignote au-dessus de l'ecran.
  function drawAlerts(c, W, t) {
    for (const m of W.machines) {
      if (m.a.st !== 'waiting' && m.a.st !== 'idle') continue;
      const blink = reduced || Math.floor(t * 2) % 2 === 0;
      if (!blink && m.a.st === 'waiting') continue;
      const x = (m.x + 3.55) * TS, y = (m.y + .95) * TS;
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
    // trop long pour sa place : on coupe avec des points de suspension
    if (opts.max && c.measureText(text).width + 10 > opts.max) {
      while (text.length > 4 && c.measureText(text + '…').width + 10 > opts.max) text = text.slice(0, -1);
      text = text.trimEnd() + '…';
    }
    const w = c.measureText(text).width + 10;
    c.fillStyle = opts.bg || COL.labelBg;
    c.fillRect(Math.round(sx - w / 2), Math.round(sy - 9), Math.round(w), 18);
    if (opts.edge) { c.fillStyle = opts.edge; c.fillRect(Math.round(sx - w / 2), Math.round(sy + 7), Math.round(w), 2); }
    c.fillStyle = opts.color || COL.text; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, Math.round(sx), Math.round(sy));
  }
  const edgeOf = (a) => (a.st === 'waiting' ? COL.warn : a.st === 'idle' ? COL.ok : a.st === 'working' ? COL.blue : '#777');
  function drawLabels(c, W) {
    const z = G.cam.z, S = (x, y) => [(x * TS - G.cam.x) * z, (y * TS - G.cam.y) * z];
    const small = z < 1.4;
    // ailes : le nom du projet (ou du dossier) dans le couloir
    if (z >= .5) for (const wg of W.wings) {
      const [sx, sy] = S(wg.x + wg.w / 2, CY + 1.5);
      label(c, wg.name, sx, sy, { edge: wg.project ? COL.blue : '#999', size: small ? 11 : 13, max: wg.w * TS * z, color: COL.text, weight: 600, bg: 'rgba(20,20,22,.55)' });
    }
    // plaque de chaque salle, dehors contre le mur : ce que fait la session (son nom de salle)
    for (const m of W.machines) {
      const a = m.a, [sx, sy] = S(m.x + m.w / 2, m.top ? m.y - .55 : m.y + m.h + .55);
      const sel = G.sel && G.sel.kind === 'agent' && G.sel.id === a.id;
      label(c, a.salle || a.name, sx, sy, { edge: edgeOf(a), color: sel ? COL.select : COL.text, size: small ? 11 : 14, weight: 700, max: Math.max(70, (m.w - .3) * TS * z) });
      // le personnage, sous son bureau
      if (z >= 1.4 && a.st !== 'ended' && !a.holds && !a.queuePos) { const [nx, ny] = S(m.x + 2.45, m.y + 4.05); label(c, a.name, nx, ny, { size: 10, weight: 600, max: 3.6 * TS * z, bg: 'rgba(20,20,22,.6)' }); }
      const subs = subsOf(a);
      if (a.st === 'ended' || !subs.length) continue;
      // chaque sous-agent porte sa section (Animation, Interface...) ; sans section, son type
      if (z >= 1.6) subs.slice(0, MAX_SUBS).forEach((s, i) => {
        const [px, py] = S(m.x + 4.6 + .78 + Math.floor(i / 2) * 1.7, m.y + (i % 2 ? 6.35 : 1.2));
        label(c, s.section || s.type, px, py, { size: 10, weight: 600, max: 1.7 * TS * z, edge: s.section ? COL.blue : null });
      });
      if (subs.length > MAX_SUBS && z >= .9) { const [px, py] = S(m.x + m.w - 1, m.y + 3.75); label(c, `+${subs.length - MAX_SUBS}`, px, py, { size: 11, weight: 700 }); }
    }
    const L = G.M.lock;
    const [fx, fy] = S(W.froom.x + W.froom.w / 2, W.froom.y + W.froom.h + .55);
    label(c, L ? `Forge : ${L.agent ? L.agent.name : L.label}` : 'Forge libre', fx, fy, { edge: L ? COL.fire : '#777', weight: 700 });
    if (z >= 1.1) {
      const [ox, oy] = S(W.okChest.x + 1, W.okChest.y + W.okChest.h + .3);
      label(c, `Réussis ${G.M.builds.filter(b => b.ok).length}`, ox, oy, { edge: COL.ok, size: 11 });
      const [kx, ky] = S(W.koChest.x + 1, W.koChest.y + W.koChest.h + .3);
      label(c, `Échecs ${G.M.builds.filter(b => !b.ok).length}`, kx, ky, { edge: COL.ko, size: 11 });
    }
    if (z >= .8) queueSpots(W).forEach((p, i) => { if (p.q.agent) { const [qx, qy] = S(p.x + .9, CY + 2.75); label(c, i ? `${i + 1}e` : 'suivant', qx, qy, { size: 10, edge: COL.fire }); } });
    const camp = G.M.campaign;
    const [vx, vy] = S(W.vroom.x + W.vroom.w / 2, W.vroom.y - .55);
    label(c, camp ? (camp.won ? `${camp.name} lancée` : `Version ${camp.name} : ${camp.proven}/${camp.total}`) : 'Lancement : prépare une version', vx, vy, { edge: camp && camp.won ? COL.ok : COL.blue, weight: 700 });
    const SK = G.M.S.skills;
    const [bx, by] = S(W.lroom.x + W.lroom.w / 2, W.lroom.y - .55);
    label(c, !SK ? 'Skills : lecture…' : SK.ko ? `Skills : ${SK.ko} cassé${SK.ko > 1 ? 's' : ''}` : `Skills : ${SK.total}`, bx, by, { edge: !SK ? '#777' : SK.ko ? COL.ko : SK.warn ? COL.warn : COL.ok, weight: 700, max: Math.max(90, W.lroom.w * TS * z) });
    const AG = G.M.S.roster;
    const busyN = AG ? AG.agents.filter(ag => rosterBusy(G.M, ag).length).length : 0;
    const [ax, ay] = S(W.aroom.x + W.aroom.w / 2, W.aroom.y + W.aroom.h + .55);
    label(c, !AG ? 'Agents : lecture…' : busyN ? `Agents : ${busyN} actif${busyN > 1 ? 's' : ''}` : `Agents : ${AG.total}`, ax, ay, { edge: !AG ? '#777' : AG.ko ? COL.ko : busyN ? COL.blue : AG.warn ? COL.warn : COL.ok, weight: 700, max: Math.max(90, W.aroom.w * TS * z) });
    const [yx, yy] = S(W.you.x + .9, CY + 2.75);
    if (z >= 1.1) label(c, 'Toi', yx, yy, { size: 10, edge: COL.select });
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
    // Sur grand ecran, le HUD du mode prend des bords : on cadre le batiment dans la zone libre.
    const P = wide && MODE.pads ? MODE.pads(!!G.sel || !!G.side) : { l: 8, r: 8, t: 8, b: 8 };
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
  // La camera ne s'eloigne jamais au point de perdre le batiment de vue.
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
    c.fillStyle = COL.concrete; c.fillRect(0, TS, (W.w - 1) * TS, (W.h - 2) * TS);
    c.fillStyle = COL.hall; c.fillRect(W.hall.x * TS, W.hall.y * TS, W.hall.w * TS, W.hall.h * TS);
    for (const f of W.fillers) { c.fillStyle = COL.wallDark; c.fillRect(f.x * TS, f.y * TS, f.w * TS, f.h * TS); }
    for (const mm of W.machines) { c.fillStyle = mm.a.st === 'ended' ? COL.ghost : edgeOf(mm.a); c.fillRect(mm.x * TS + 6, mm.y * TS + 6, mm.w * TS - 12, mm.h * TS - 12); }
    c.fillStyle = G.M.lock ? COL.fire : COL.forge; c.fillRect(W.froom.x * TS + 6, W.froom.y * TS + 6, W.froom.w * TS - 12, W.froom.h * TS - 12);
    c.fillStyle = COL.steelLight; c.fillRect(W.vroom.x * TS + 6, W.vroom.y * TS + 6, W.vroom.w * TS - 12, W.vroom.h * TS - 12);
    c.fillStyle = G.M.S.skills && G.M.S.skills.ko ? COL.ko : COL.desk; c.fillRect(W.lroom.x * TS + 6, W.lroom.y * TS + 6, W.lroom.w * TS - 12, W.lroom.h * TS - 12);
    c.fillStyle = G.M.S.roster && G.M.S.roster.ko ? COL.ko : COL.steel; c.fillRect(W.aroom.x * TS + 6, W.aroom.y * TS + 6, W.aroom.w * TS - 12, W.aroom.h * TS - 12);
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
    for (const q of queueSpots(W)) if (q.q.agent && inR({ x: q.x, y: q.y, w: 1.8, h: 2.9 })) return { kind: 'agent', id: q.q.agent.id };
    for (const m of W.machines) if (inR(m)) return { kind: 'agent', id: m.a.id };
    const L = G.M.lock;
    if (L && L.agent && inR({ x: W.forge.x + W.forge.w + .2, y: W.forge.y - .2, w: 1.8, h: 2.9 })) return { kind: 'agent', id: L.agent.id };
    if (inR(W.okChest, .2)) return { kind: 'ok' };
    if (inR(W.koChest, .2)) return { kind: 'ko' };
    if (inR(W.froom)) return { kind: 'forge' };
    if (inR(W.vroom)) return { kind: 'silo' };
    if (inR(W.lroom)) return { kind: 'skills' };
    if (inR(W.aroom)) return { kind: 'roster' };
    return null;
  }
  // Infobulle facon jeu : le nom de ce qu'on survole et son etat en une ligne.
  function tipOf(s) {
    const M = G.M;
    if (s.kind === 'agent') {
      const a = M.agents.find(x => x.id === s.id);
      return a && [a.salle || a.name, [a.name, a.holds ? `${a.stText}, à la forge` : a.queuePos ? `${a.stText}, ${a.queuePos}e devant la forge` : a.stText,
        a.subs ? T.plural(a.subs, 'sous-agent', 'sous-agents') : ''].filter(Boolean).join(', ')];
    }
    if (s.kind === 'forge') return ['Forge', M.lock ? `${M.lock.kindText} de ${M.lock.agent ? M.lock.agent.name : M.lock.label}` : 'Libre'];
    if (s.kind === 'ok') return ['Coffre des réussis', T.plural(M.builds.filter(b => b.ok).length, 'build', 'builds')];
    if (s.kind === 'ko') return ['Coffre des échecs', T.plural(M.builds.filter(b => !b.ok).length, 'build', 'builds')];
    if (s.kind === 'skills') { const L = M.S.skills; return ['Bibliothèque des skills', L ? `${T.plural(L.total, 'skill', 'skills')}, ${L.ko} à réparer, ${L.unused} jamais utilisés` : 'Lecture en cours']; }
    if (s.kind === 'roster') { const A = M.S.roster; if (!A) return ['Quartier des agents', 'Lecture en cours']; const n = A.agents.filter(ag => rosterBusy(M, ag).length).length; return ['Quartier des agents', `${T.plural(A.total, 'agent', 'agents')}, ${n} au travail, ${A.ko + A.warn} à revoir`]; }
    if (s.kind === 'silo') return ['Salle de lancement', M.campaign ? `${M.campaign.name} : ${M.campaign.proven} sur ${M.campaign.total}` : 'Aucune version'];
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
      else if (e.key === 'Escape') { if (G.side) sideToggle(G.side, false); else select(null); }
      else if (e.key === 'f' || e.key === 'F') select({ kind: 'forge' }, true);
      else if (e.key === 'v' || e.key === 'V') select({ kind: 'silo' }, true);
      else if (e.key === 'b' || e.key === 'B') select({ kind: 'skills' }, true);
      else if (e.key === 'a' || e.key === 'A') select({ kind: 'roster' }, true);
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

  // La version : liste des features et de leurs preuves, reutilisee par la fiche de la salle de lancement et par le mode « La version ».
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
      title = a.salle || a.name;
      body = [
        h('div', { class: 'us-who' }, h('button', { type: 'button', class: 'us-portrait', title: 'Personnaliser', onclick: () => T.act.openChar(a.id) }, T.avatar(a.look, a.st, 88)),
          h('div', null, h('div', null, h('b', null, a.name), a.project || a.where ? h('span', { class: 'us-dim' }, ` · ${a.project || a.where}`) : null),
            h('div', { class: `us-state us-s-${dotFor(a.st)}` }, a.holds ? `${a.stText}, à la forge` : a.queuePos ? `${a.stText}, ${a.queuePos}e devant la forge` : a.stText),
            h('div', { class: 'us-dim' }, 'vu ', T.agoEl(a.lastSeen)))),
        a.pending ? askBox(a) : a.ask ? h('p', { class: 'us-ask' }, h('b', null, 'Sa question : '), a.ask, h('small', null, 'Réponds dans sa session Claude Code.')) : null,
        a.said ? h('p', { class: 'us-said' }, h('b', null, 'Il a fini : '), a.said) : null,
        rowsOf([
          a.prompt && ['Demande', a.prompt],
          a.tool && ['Dernière action', [h('b', null, a.tool.name), ' ', a.tool.summary, ', ', T.agoEl(a.tool.at)]],
          a.roomName && ['Domaine touché', a.roomName],
          a.subs && ['Dans sa salle', `${T.plural(a.subs, 'sous-agent', 'sous-agents')} : ${[...new Set(a.subList.map(x => (x.section ? `${x.type} (${x.section})` : x.type)))].join(', ')}`],
          a.lastBuild && ['Compilation', resultTxt(a.lastBuild)],
          a.lastTest && ['Tests', resultTxt(a.lastTest)],
          a.docs && ['Doc UE', h('span', { class: a.docs.tone === 'warn' ? 'us-t-warn' : a.docs.tone === 'ok' ? 'us-t-ok' : 'us-dim' }, a.docs.text)],
        ]),
        a.task ? [h('div', { class: 'us-sub' }, `Suivi : ${a.task.title}`), suiviBlock(a)] : null,
        usageBlock(a),
        h('div', { class: 'us-actions' }, btn('Renommer la salle', () => renameDialog(a), '', M.demo ? { disabled: true } : {}), btn('Personnage', () => T.act.openChar(a.id)), a.st === 'ended' || a.st === 'silent' ? btn('Retirer', () => { T.act.forget(a.id); select(null); }, 'us-danger') : null),
      ];
    } else if (s.kind === 'patch') {
      const r = M.inv && T.room(M.inv, s.id);
      if (!r) return null;
      title = `Domaine ${r.name}`;
      body = [
        h('p', null, h('b', null, T.num(r.count)), ' éléments. ', r.recent ? h('span', { class: 'us-t-warn' }, `${r.recent} modifiés ces 3 derniers jours.`) : 'Rien de modifié ces 3 derniers jours.'),
        r.workers.length ? h('p', null, 'Y travaille : ', h('b', null, r.workers.join(', '))) : null,
        rowsOf([['Rangé dans', r.folders.slice(0, 5).map(f => `${f.name} (${T.num(f.n)})`).join(', ')], ['Derniers', r.latest.slice(0, 5).map(l => l.name).join(', ')]]),
        h('div', { class: 'us-actions' }, btn('Recompter le projet', T.act.refreshMap)),
      ];
    } else if (s.kind === 'forge') {
      const L = M.lock;
      title = 'La forge';
      body = [
        h('p', { class: 'us-dim' }, 'Un seul build, test ou package Unreal à la fois sur le PC. Les autres font la queue dans le couloir, devant la porte.'),
        L ? [h('p', null, h('b', null, `${L.kindText} de ${L.agent ? L.agent.name : L.label}`), L.target ? ` (${L.target})` : '', ', depuis ', T.forEl(L.since)),
          h('code', { class: 'us-code' }, L.command), h('div', { class: 'us-actions' }, btn('Libérer la forge', T.act.release, 'us-danger', { title: 'Si le build est bloqué' }))]
          : h('p', { class: 'us-t-ok' }, 'Libre : le prochain agent qui compile passe tout de suite.'),
        M.queue.length ? [h('div', { class: 'us-sub' }, 'Dans la file'), h('ol', { class: 'us-list' }, M.queue.map(q => h('li', null, h('b', null, q.agent ? q.agent.name : q.label), ` : ${T.lower(q.kindText)}, attend depuis `, T.forEl(q.since))))] : null,
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
    } else if (s.kind === 'skills') {
      title = 'Bibliothèque des skills';
      body = skillsBody(M);
    } else if (s.kind === 'roster') {
      title = 'Quartier des agents';
      body = rosterBody(M);
    } else if (s.kind === 'silo') {
      const c = M.campaign;
      title = c ? `Lancement : ${c.name}` : 'Salle de lancement';
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
    const sel = h('select', { name: 'ambiance', 'aria-label': 'Ambiance du jeu', onchange: (e) => {
      try { localStorage.setItem('tower.world', e.target.value); } catch { /* stockage bloque */ }
      loadWorld(e.target.value, () => { G.dirty = true; G.canvas.setAttribute('aria-label', `La tour (${TH.name}) : une salle par session, ses agents, la forge et la version, en direct`); renderHud(); });
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
    side: (which, on) => sideToggle(which, on), launchTask, tok,
  };

  function same(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
  // ---------- tutos : de courts scenarios joues sur la vraie tour (lib/tuto.js) ----------
  // Le panneau prend la place de la fiche ; chaque etape se coche quand la tour la voit vraiment.
  const TUTO_WHERE = {
    agent: {
      atraiter: 'Quand il a fini, une carte « … a fini » arrive dans la liste à gauche.',
      equipe: 'Sa carte apparaît en bas, avec ce qu\'il fait et depuis quand.',
      version: 'Sa salle apparaît dans la tour ; la version n\'est pas touchée.',
      coupdoeil: 'La phrase du bas passe à « Tout tourne », puis une notification dit qu\'il a fini.',
      clavier: 'Tape son nom dans la barre du haut : Entrée ouvre sa fiche.',
    },
    question: {
      atraiter: 'Sa question arrive en haut de la liste à gauche, en orange.',
      equipe: 'Sa carte passe en orange : « attend ta réponse ».',
      version: 'Sa salle passe en orange ; l\'onglet du navigateur affiche (1).',
      coupdoeil: 'La phrase du bas dit « … t\'attend » et une notification s\'affiche.',
      clavier: 'La barre propose sa question en premier.',
    },
  };
  const TUTO_LOOK = {
    forge: 'Regarde le couloir : un agent entre dans la forge, le second fait la queue devant la porte.',
    echec: 'Le build finit au coffre rouge de la forge ; clique dessus pour lire l\'erreur.',
    vrai: 'Ouvre un terminal dans le dossier du projet, lance claude et demande : « Liste les dossiers de Content, sans rien modifier. »',
  };
  let tutoFocus = '';

  function tutoSteps(id, M, t) {
    const ag = (sid) => M.agents.find(a => a.id === sid);
    const proj = t.project;
    const builds = (pre) => M.builds.filter(b => String(b.raw.sessionId).startsWith(pre));
    if (id === 'agent') {
      const a = ag('tuto-agent');
      return [['Sa salle apparaît dans la tour', !!a], [`Elle est dans l\'aile de ${proj}`, !!a && a.project === proj],
        ['Il lit des fichiers : la fiche montre l\'outil', !!a && !!a.tool], ['Il a fini : la tour te le dit', !!a && a.st === 'idle']];
    }
    if (id === 'question') {
      const a = ag('tuto-question');
      const done = !!a && a.st === 'idle';
      return [['Sa salle apparaît dans la tour', !!a], ['Il attend ta réponse', !!a && (a.st === 'waiting' || done)], ['Tu as vu sa question', done]];
    }
    if (id === 'forge') {
      const bs = builds('tuto-forge'), b2 = bs.find(b => b.raw.sessionId === 'tuto-forge-b');
      const holdA = M.lock && M.lock.raw.sessionId === 'tuto-forge-a';
      return [['Le premier build prend la forge', holdA || bs.some(b => b.raw.sessionId === 'tuto-forge-a')],
        ['Le second attend son tour dans la file', M.queue.some(q => q.raw.sessionId === 'tuto-forge-b') || (!!b2 && b2.waitMs > 1000)],
        ['Les deux builds réussissent, l\'un après l\'autre', bs.filter(b => b.ok).length >= 2]];
    }
    if (id === 'echec') {
      const b = builds('tuto-echec')[0];
      return [['Le faux build passe à la forge', !!b || (!!M.lock && M.lock.raw.sessionId === 'tuto-echec')],
        ['Il échoue : le build va au coffre rouge', !!b && !b.ok], ['La tour a lu l\'erreur de compilation', !!b && b.lines.length > 0]];
    }
    const real = M.agents.find(a => !a.id.startsWith('tuto-') && a.project === proj && (a.raw.firstSeen || 0) >= t.startedAt);
    return [[`Un nouvel agent apparaît sur ${proj}`, !!real], ['Il travaille : la fiche montre son outil', !!real && !!real.tool], ['Il a fini', !!real && real.st === 'idle']];
  }

  // La camera va une fois vers ce que le tuto fait bouger.
  function tutoCamera(id, M) {
    const sid = { agent: 'tuto-agent', question: 'tuto-question' }[id];
    let key = '', sel = null;
    if (sid && M.agents.some(a => a.id === sid)) { key = id + sid; sel = { kind: 'agent', id: sid }; }
    else if (id === 'forge' || id === 'echec') { key = id; sel = { kind: 'forge' }; }
    else if (id === 'vrai') {
      const t = M.S.tuto && M.S.tuto.last;
      const real = t && M.agents.find(a => !a.id.startsWith('tuto-') && a.project === t.project && (a.raw.firstSeen || 0) >= t.startedAt);
      if (real) { key = id + real.id; sel = { kind: 'agent', id: real.id }; }
    }
    if (key && key !== tutoFocus) { tutoFocus = key; G.sel = sel; center(sel); G.dirty = true; }
  }

  async function tutoCall(path, body) {
    const r = await T.api(path, body);
    if (r && r.ok === false && r.error) T.toast(r.error);
    return r;
  }

  function tutoPanel(M) {
    const info = M.S.tuto || {};
    const list = info.list || [];
    const last = info.last, running = info.running;
    const proj = info.project;
    const close = btn('Fermer', () => tutoToggle(false), 'us-x', { 'aria-label': 'Fermer les tutos', title: 'Échap' });
    if (last) tutoCamera(last.id, M);
    const cards = list.map((x, i) => {
      const open = last && last.id === x.id;
      const steps = open ? tutoSteps(x.id, M, last) : [];
      const all = open && steps.every(s => s[1]);
      const off = M.demo || !proj ? { disabled: true } : {};
      const launch = (label, cls) => btn(label, () => { tutoFocus = ''; tutoCall('/api/tuto/start', { id: x.id }); }, cls, off);
      const head = h('div', { class: 'us-tuto-head' }, h('b', null, `${i + 1}. ${x.title}`),
        all ? h('span', { class: 'us-t-ok' }, 'Réussi') : open && running ? h('span', { class: 'us-dim' }, 'en cours') : open ? null : launch('Lancer', 'us-go'));
      const body = [h('p', { class: 'us-dim' }, x.text)];
      if (open) {
        const where = (TUTO_WHERE[x.id] && TUTO_WHERE[x.id][MODE.id]) || TUTO_LOOK[x.id];
        if (where) body.push(h('p', { class: 'us-tuto-where' }, where));
        body.push(h('ol', { class: 'us-tuto-steps' }, steps.map(([txt, ok]) => h('li', { class: ok ? 'ok' : '' }, h('i', { 'aria-hidden': 'true' }, ok ? '✓' : '·'), txt, ok ? h('span', { class: 'us-sr' }, ' (fait)') : null))));
        const a = M.agents.find(y => y.id === 'tuto-question');
        if (x.id === 'question' && a && a.st === 'waiting') body.push(btn('J\'ai vu', () => tutoCall('/api/tuto/answer'), 'us-go'));
      }
      if (open) body.push(launch('Rejouer', ''));
      return h('li', { class: 'us-tuto-card' + (open ? ' open' : '') + (all ? ' done' : '') }, head, body);
    });
    const intro = M.demo ? 'En démo, les tutos ne se lancent pas : ouvre la tour sur ton PC.'
      : !proj ? 'Connecte d\'abord ton projet Unreal (bouton du projet en haut) : les tutos se jouent dessus.'
      : `Des scénarios courts joués sur ta vraie tour, avec ${proj}. Rien n'est écrit dans le projet : les agents du tuto sont simulés et la forge lance un faux build. Chaque étape se coche quand la tour la voit.`;
    return h('section', { class: 'us-panel us-entity us-tuto', 'aria-label': 'Tutos' },
      h('div', { class: 'us-ehead' }, h('h2', null, proj ? `Tutos sur ${proj}` : 'Tutos'), close),
      h('div', { class: 'us-ebody' }, h('p', null, intro), h('ol', { class: 'us-tuto-list' }, cards),
        h('div', { class: 'us-tuto-foot' }, btn('Effacer les traces des tutos', () => { tutoFocus = ''; tutoCall('/api/tuto/clean'); G.sel = null; }, '', M.demo ? { disabled: true } : {}),
          h('span', { class: 'us-dim' }, 'Elles partent aussi seules au bout de 30 min et ne sont jamais sauvegardées.'))));
  }

  // ---------- taches : consignes pretes a lancer, et tokens de chaque session (lib/taches.js, lib/usage.js) ----------
  // 12 345 -> « 12,3 k » ; 1 234 567 -> « 1,23 M »
  function tok(n) {
    n = n || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: n < 1e4 ? 1 : 0 })} k`;
    return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M`;
  }
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // Le contexte : une jauge qui vire a l'orange puis au rouge quand la fenetre se remplit.
  function ctxBar(u) {
    const pct = u.contextPct || 0;
    return h('div', { class: 'us-ctx', title: `${tok(u.context)} tokens dans le contexte sur ${tok(u.window)}` },
      h('div', { class: 'us-bar' }, h('i', { class: pct >= 80 ? 'ko' : pct >= 55 ? 'warn' : '', style: `width:${Math.max(2, pct)}%` })),
      h('span', null, `${pct} % (${tok(u.context)} / ${tok(u.window)})`));
  }

  // Bloc « Tokens » de la fiche d'un agent : total, contexte, et ce que coute chaque action.
  function usageBlock(a) {
    const u = a.usage;
    if (!u) return h('p', { class: 'us-dim' }, 'Tokens : la tour les lira à la prochaine action de cet agent.');
    const max = Math.max(1, ...u.tools.map(t => t.out + t.ctx));
    return h('div', { class: 'us-usage' },
      h('div', { class: 'us-sub' }, 'Tokens de la session'),
      h('p', null, h('b', null, tok(u.total)), ` en ${T.plural(u.messages, 'réponse', 'réponses')} : `,
        h('span', { class: 'us-dim' }, `entrée ${tok(u.in)}, sortie ${tok(u.out)}, cache lu ${tok(u.cacheRead)}, cache écrit ${tok(u.cacheWrite)}`)),
      h('div', { class: 'us-sub' }, 'Contexte'), ctxBar(u),
      h('div', { class: 'us-sub' }, 'Par action'),
      h('ul', { class: 'us-tools' }, u.tools.slice(0, 6).map(t => h('li', null,
        h('b', null, t.name.replace(/^mcp__[^_]+__/, '')), h('span', { class: 'us-dim' }, t.calls ? T.plural(t.calls, 'appel', 'appels') : 'texte'),
        h('i', { style: `width:${Math.max(3, Math.round(100 * (t.out + t.ctx) / max))}%` }), h('span', null, tok(t.out + t.ctx)))))
    );
  }

  // ---------- question posee a ali, a laquelle il repond dans la tour (hooks/tower-ask.js) ----------
  const picks = new Map(); // id de question -> { question: [labels choisis] }
  async function sendAsk(a, body) {
    if ((G.M || {}).demo) { T.toast('Mode démo : la réponse part sur la vraie tour.'); return; }
    const r = await T.api('/api/ask/answer', { id: a.pending.id, ...body });
    if (r && r.ok === false && r.error) T.toast(r.error);
    else picks.delete(a.pending.id);
  }
  function askBox(a) {
    const k = a.pending;
    const later = btn('Dans sa fenêtre', () => sendAsk(a, { decision: 'window' }), '', { title: 'La question s\'affiche dans sa fenêtre Claude Code, tu y réponds là-bas' });
    if (k.kind === 'permission') {
      return h('div', { class: 'us-ask us-askq' },
        h('b', null, 'Il demande l\'autorisation'), h('p', null, h('code', null, k.tool), ' ', k.summary),
        h('div', { class: 'us-actions' }, btn('Autoriser', () => sendAsk(a, { decision: 'allow' }), 'us-go'), btn('Refuser', () => sendAsk(a, { decision: 'deny' })), later));
    }
    const sel = picks.get(k.id) || {};
    const one = k.questions.length === 1 && !k.questions[0].multiSelect;
    const choose = (q, label) => {
      if (one) return sendAsk(a, { answers: { [q.question]: label } });
      const cur = sel[q.question] || [];
      sel[q.question] = q.multiSelect ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : [label];
      picks.set(k.id, sel);
      renderHud();
    };
    const other = (q) => {
      const input = h('input', { type: 'text', name: `autre-${k.id}-${k.questions.indexOf(q)}`, placeholder: 'Autre réponse…', 'aria-label': `Autre réponse à « ${q.question} »`, maxlength: 300,
        onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); choose(q, input.value.trim()); } } });
      return h('div', { class: 'us-askother' }, input, btn(one ? 'Envoyer' : 'Choisir', () => { if (input.value.trim()) choose(q, input.value.trim()); }));
    };
    const ready = k.questions.every(q => (sel[q.question] || []).length);
    return h('div', { class: 'us-ask us-askq' },
      k.questions.map(q => h('fieldset', { class: 'us-askset' },
        h('legend', null, q.header ? h('span', { class: 'us-dim' }, `${q.header} · `) : null, q.question, q.multiSelect ? h('small', null, ' (plusieurs choix possibles)') : null),
        h('div', { class: 'us-askopts' }, q.options.map((o) => {
          const on = (sel[q.question] || []).includes(o.label);
          return h('button', { type: 'button', class: 'us-askopt' + (on ? ' on' : ''), 'aria-pressed': one ? null : String(on), title: o.description || o.label, onclick: () => choose(q, o.label) },
            h('b', null, o.label), o.description ? h('small', null, o.description) : null);
        })),
        other(q))),
      h('div', { class: 'us-actions' }, one ? null : btn('Envoyer mes réponses', () => sendAsk(a, { answers: Object.fromEntries(k.questions.map(q => [q.question, sel[q.question] || []])) }), 'us-go', ready ? {} : { disabled: true }), later),
      h('small', { class: 'us-dim' }, 'La session reprend dès que tu réponds. Sans réponse ici, la question passe dans sa fenêtre au bout de 10 minutes.'));
  }

  // ---------- suivi d'une tache lancee (lib/suivi.js) : ou il en est, ce qu'il a fait, ce qu'il reste ----------
  const shortPath = (p) => { const m = /(?:^|[\\/])Saved[\\/]Tour[\\/](.*)$/i.exec(p || ''); return (m ? m[1] : String(p || '').split(/[\\/]/).slice(-2).join('/')).replace(/\\/g, '/'); };
  function suiviState(a) {
    const k = a.task;
    if (a.st === 'waiting') return { tone: 'warn', text: 'Attend ta réponse dans sa fenêtre Claude Code', detail: a.ask };
    if (a.st === 'working') return { tone: 'blue', text: 'En cours', detail: a.tool ? `${a.tool.name} ${a.tool.summary}` : '' };
    if (a.st === 'ended' && !k.doneAt) return { tone: 'grey', text: 'Session fermée avant la fin' };
    if (k.doneAt || a.st === 'idle') {
      const v = k.verif && k.verif.state;
      if (v === 'fail') return { tone: 'ko', text: 'Fini, mais la vérification de la tour a échoué' };
      if (v === 'running') return { tone: 'blue', text: 'Fini : la tour vérifie (compilation et tests)' };
      if (v === 'waiting') return { tone: 'warn', text: 'Fini : ferme l\'éditeur pour que la tour lance les tests' };
      const q = k.suivi && k.suivi.questions.length;
      return { tone: 'ok', text: q ? 'Fini : il a des questions pour toi' : k.suivi && k.suivi.rapport ? 'Fini : à toi de lire le rapport' : 'Fini, à toi' };
    }
    return { tone: 'grey', text: a.stText };
  }
  // Ce que la tour a vu faire, quand l'agent n'a pas (encore) ecrit son bloc « Suivi ».
  function seenDone(a) {
    const k = a.task, c = k.counts || {};
    return [
      c.reads ? `A lu ${T.plural(c.reads, 'fichier ou recherche', 'fichiers ou recherches')}` : null,
      ...(k.files || []).filter(f => f.tower).map(f => `A écrit ${shortPath(f.path)}`),
      c.edits ? `A modifié le projet (${T.plural(c.edits, 'modification', 'modifications')})` : null,
      c.cmds ? `A lancé ${T.plural(c.cmds, 'commande', 'commandes')}` : null,
      a.lastBuild && a.lastBuild.endedAt > k.at ? `Compilation : ${a.lastBuild.ok ? 'réussie' : 'en échec'}` : null,
      a.lastTest && a.lastTest.endedAt > k.at ? `Tests : ${a.lastTest.summary || (a.lastTest.ok ? 'verts' : 'en échec')}` : null,
    ].filter(Boolean);
  }
  const bullets = (items) => h('ul', { class: 'us-suivi-list' }, items.map(x => h('li', null, x)));
  // ---------- verification de fin de tache (lib/verif.js) : la tour compile et lance les tests ----------
  const VERDICT = {
    ok: ['ok', 'Vérifiée par la tour : ça compile et les tests passent'],
    fail: ['ko', 'La vérification a échoué'],
    waiting: ['warn', 'Ferme l\'éditeur Unreal quand tu veux : la tour compilera la cible Éditeur et lancera les tests'],
    running: ['blue', 'Vérification en cours'],
    error: ['grey', 'Vérification impossible'],
  };
  const STEP_DOT = { ok: 'ok', fail: 'ko', running: 'blue', waiting: 'warn' };
  const testName = (p) => String(p).split('.').slice(-2).join('.');
  function stepText(s) {
    if (s.state === 'waiting') return 'attend que l\'éditeur soit fermé';
    if (s.state === 'todo') return 'à faire';
    if (s.state === 'running') return ['en cours depuis ', T.forEl(s.at)];
    if (s.state === 'skipped') return s.detail || 'pas lancée';
    const t = s.tests;
    if (t) {
      const old = (s.oldFailures || []).length;
      return `${t.passed}/${t.total} verts` + (old ? `, ${T.plural(old, 'test déjà rouge', 'tests déjà rouges')} avant la tâche` : '');
    }
    return s.ok ? 'réussie' : s.summary || 'en échec';
  }
  function verifBlock(a) {
    const k = a.task, v = k.verif;
    const running = v && v.state === 'running';
    const go = btn(v ? 'Revérifier' : 'Vérifier maintenant', async () => {
      const r = await T.api('/api/tasks/verify', { sessionId: a.id });
      if (r && r.ok === false && r.error) T.toast(r.error);
    }, '', M_demo() || running || a.st === 'working' ? { disabled: true } : { title: 'Compile le projet et lance la suite de tests sous le verrou de la forge' });
    const head = h('div', { class: 'us-sub' }, 'Vérification par la tour');
    if (!v) return [head, h('p', { class: 'us-dim' }, 'À la fin de la tâche, la tour compile le projet et lance les tests elle-même, sans jamais fermer ton éditeur.'), h('div', { class: 'us-actions' }, go)];
    const [tone, text] = VERDICT[v.state] || VERDICT.error;
    const bad = v.steps.filter(s => s.state === 'fail');
    return [head,
      h('div', { class: `us-state us-s-${tone}` }, text),
      h('ul', { class: 'us-verif' }, v.steps.map(s => h('li', null,
        h('span', { class: `us-dot us-d-${STEP_DOT[s.state] || 'grey'}` }), h('b', null, s.label), h('span', { class: 'us-dim' }, stepText(s))))),
      bad.map(s => [
        (s.newFailures || []).length ? [h('div', { class: 'us-dim' }, 'Tests cassés :'), bullets(s.newFailures.map(testName))] : null,
        (s.errorLines || []).length ? h('pre', { class: 'us-suivi-last' }, s.errorLines.join('\n')) : null]),
      v.state === 'fail' ? h('p', { class: 'us-dim' }, 'Dis-le à l\'agent dans sa fenêtre (ou relance la tâche) : il corrige, puis la tour revérifie à sa fin.') : null,
      h('div', { class: 'us-actions' }, go)];
  }
  const M_demo = () => !!(G.M || {}).demo;
  function suiviBlock(a) {
    const k = a.task;
    if (!k) return null;
    const st = suiviState(a), sv = k.suivi;
    const done = !!k.doneAt && a.st !== 'working' && a.st !== 'waiting';
    const fait = sv && sv.fait.length ? sv.fait : seenDone(a);
    const questions = [...(sv ? sv.questions : [])];
    if (a.st === 'waiting' && a.ask && !questions.includes(a.ask)) questions.unshift(a.ask);
    const files = (k.files || []).slice().reverse();
    if (sv && sv.rapport && !files.some(f => shortPath(f.path) === shortPath(sv.rapport))) files.unshift({ path: sv.rapport, tower: true });
    return h('div', { class: 'us-suivi' },
      h('div', { class: `us-state us-s-${st.tone}` }, st.text),
      h('div', { class: 'us-dim' }, `Lancée à ${T.clock(k.at)}, `, done ? `finie en ${T.dur(k.doneAt - k.at)}` : ['depuis ', T.forEl(k.at)]),
      st.detail && a.st !== 'waiting' ? h('p', { class: 'us-dim' }, st.detail) : null, // une question s'affiche plus bas
      h('div', { class: 'us-sub' }, 'Ce qu\'il a fait'),
      fait.length ? bullets(fait) : h('p', { class: 'us-dim' }, 'Rien encore : il commence.'),
      h('div', { class: 'us-sub' }, 'Ce qu\'il reste à faire'),
      sv && sv.afaire.length ? bullets(sv.afaire)
        : h('p', { class: 'us-dim' }, done ? 'Il n\'a pas laissé de liste : lis son dernier message ci-dessous.' : 'Il le dira en finissant.'),
      questions.length ? [h('div', { class: 'us-sub' }, 'Ses questions pour toi'), bullets(questions), h('p', { class: 'us-dim' }, 'Réponds dans sa fenêtre Claude Code : il reprend là où il en était.')] : null,
      files.length ? [h('div', { class: 'us-sub' }, 'Fichiers écrits'),
        h('ul', { class: 'us-suivi-files' }, files.map(f => h('li', null,
          h('span', null, shortPath(f.path)),
          f.tower ? btn('Lire', () => readFile(a, f.path), 'us-go', { title: 'Ouvre le fichier ici, dans la page' }) : h('span', { class: 'us-dim' }, 'dans le projet'))))] : null,
      done && !sv && k.last ? [h('div', { class: 'us-sub' }, 'Son dernier message'), h('p', { class: 'us-suivi-last' }, k.last)] : null,
      k.verif || (done && (k.counts || {}).edits) ? verifBlock(a) : null);
  }

  let readerDlg = null;
  function mdInline(s) {
    return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map(p => p.length > 4 && p.startsWith('**') && p.endsWith('**') ? h('b', null, p.slice(2, -2))
      : p.length > 2 && p.startsWith('`') && p.endsWith('`') ? h('code', null, p.slice(1, -1)) : p);
  }
  // Markdown simple (titres, listes, code, tableaux en bloc), construit en noeuds : aucun HTML du fichier n'est interprete.
  function mdView(text) {
    const out = [];
    let list = null, code = null, table = null;
    for (const line of String(text).split(/\r?\n/)) {
      if (/^\s*```/.test(line)) { if (code) { out.push(h('pre', null, code.join('\n'))); code = null; } else code = []; continue; }
      if (code) { code.push(line); continue; }
      if (/^\s*\|/.test(line)) { if (!table) { table = []; out.push(table); } if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) table.push(line.trim()); continue; }
      table = null;
      const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) { if (!list) { list = h('ul'); out.push(list); } list.append(h('li', null, mdInline(li[1]))); continue; }
      list = null;
      const hd = /^(#{1,6})\s+(.*)$/.exec(line);
      if (hd) out.push(h(hd[1].length <= 2 ? 'h3' : 'h4', null, mdInline(hd[2])));
      else if (line.trim()) out.push(h('p', null, mdInline(line)));
    }
    if (code) out.push(h('pre', null, code.join('\n')));
    return h('div', { class: 'us-md' }, out.map(x => Array.isArray(x) ? h('pre', { class: 'us-md-table' }, x.join('\n')) : x));
  }
  async function readFile(a, rel) {
    if ((G.M || {}).demo) { T.toast('Mode démo : le fichier se lit sur la vraie tour.'); return; }
    let r = null;
    try { r = await fetch(`/api/tasks/file?session=${encodeURIComponent(a.id)}&path=${encodeURIComponent(rel)}`).then(x => x.json()); } catch { /* r reste null */ }
    if (!r || !r.ok) { T.toast(r && r.error ? r.error : 'Lecture impossible.'); return; }
    if (!readerDlg) {
      readerDlg = h('dialog', { class: 'us-dialog us-reader', 'aria-label': 'Fichier de la tâche' });
      document.body.append(readerDlg);
    }
    readerDlg.replaceChildren(
      h('div', { class: 'us-ehead' }, h('h2', null, shortPath(r.path)), btn('Fermer', () => readerDlg.close(), 'us-x')),
      h('p', { class: 'us-dim' }, `${a.name}, « ${a.task.title} »${r.cut ? ' (début du fichier seulement)' : ''}`),
      mdView(r.text));
    readerDlg.showModal();
  }

  const suiviOpen = new Map();
  // Renommer une salle : le nom reste tant que tu ne l'effaces pas (vide = nom automatique).
  let renameDlg = null;
  function renameDialog(a) {
    if (!renameDlg) {
      const f = {};
      renameDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Renommer la salle' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const r = await T.api('/api/agents/rename', { sessionId: renameDlg.dataset.id, label: f.name.value });
          if (r && r.ok) renameDlg.close(); else if (r) f.err.textContent = r.error || 'Renommage impossible.';
        } },
          h('h2', null, 'Renommer la salle'),
          h('label', null, 'Nom de la salle', f.name = h('input', { name: 'salle', maxlength: 60, placeholder: 'ex. Coup de pied dans les portes' })),
          f.auto = h('p', { class: 'us-dim' }),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => renameDlg.close()), h('button', { type: 'submit', class: 'us-btn us-go' }, 'Renommer'))));
      renameDlg.f = f;
      document.body.append(renameDlg);
    }
    const f = renameDlg.f;
    renameDlg.dataset.id = a.id;
    f.name.value = a.label || a.salle || '';
    f.auto.textContent = 'Laisse vide pour revenir au nom automatique : la tâche lancée, le titre de la session dans Claude Code, sinon sa première demande.';
    f.err.textContent = '';
    renameDlg.showModal();
    f.name.select();
  }

  // L'equipe du projet : ses agents (.claude/agents), par section, et ou ils travaillent en ce moment.
  function equipePanel(M) {
    const close = btn('Fermer', () => sideToggle('equipe', false), 'us-x', { 'aria-label': 'Fermer l\'équipe', title: 'Échap' });
    const teams = Object.entries(M.S.team || {});
    const at = (proj, name) => M.agents.filter(a => a.st !== 'ended' && a.project === proj && a.subList.some(s => s.type.toLowerCase() === name.toLowerCase()));
    const open = (a) => { sideToggle('equipe', false); select({ kind: 'agent', id: a.id }, true); };
    const projBlock = ([proj, team]) => {
      const sections = [...new Set(team.map(x => x.section))];
      return [teams.length > 1 ? h('div', { class: 'us-sub' }, proj) : null,
        team.length ? h('ul', { class: 'us-tuto-list' }, sections.map(sec => h('li', { class: 'us-task' },
          h('div', { class: 'us-tuto-head' }, h('b', null, sec), h('span', { class: 'us-dim' }, T.plural(team.filter(x => x.section === sec).length, 'agent', 'agents'))),
          team.filter(x => x.section === sec).map(x => {
            const busy = at(proj, x.name);
            return h('div', { class: 'us-mem' },
              h('span', { class: `us-dot us-d-${busy.length ? 'blue' : 'none'}` }), h('code', null, x.name),
              busy.length ? h('span', null, ' au travail dans ', busy.map((a, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'us-link', onclick: () => open(a) }, `« ${a.salle} »`)])) : null,
              x.description ? h('small', { class: 'us-dim' }, x.description) : null);
          }))))
          : h('p', { class: 'us-dim' }, `Aucun agent dans ${proj}\\.claude\\agents. Chaque fichier .md de ce dossier est un agent que tes sessions peuvent appeler ; ajoute « section: Animation » dans son en-tête pour le ranger.`)];
    };
    return h('section', { class: 'us-panel us-entity us-taches', 'aria-label': 'Équipe' },
      h('div', { class: 'us-ehead' }, h('h2', null, 'Équipe'), close),
      h('div', { class: 'us-ebody' },
        h('p', null, 'Les agents spécialisés de ton projet, rangés par section. Quand une session en appelle un, il s\'assoit à la table de sa salle avec le nom de sa section.'),
        h('div', { class: 'us-actions' }, btn('Détails de chaque agent', () => { sideToggle('equipe', false); select({ kind: 'roster' }, true); }, '', { title: 'Le quartier des agents (touche A) : leur fichier, leurs skills, leurs appels et leurs tokens' })),
        teams.length ? teams.map(projBlock) : h('p', { class: 'us-dim' }, 'Connecte d\'abord ton projet Unreal (bouton du projet en haut).')));
  }

  // ---------- la bibliotheque des skills ----------
  // Ce qui est installe (perso, compte claude.ai, projets, plugins), ce qui cloche, ce qui sert. Le serveur
  // relit tout toutes les 2 minutes (lib/skills.js) ; « Ajouter un skill » ecrit un SKILL.md.
  const skillUi = { filter: null, open: new Set() };
  const STATUS_TXT = { ko: 'Cassé', warn: 'À revoir', unused: 'Jamais utilisé', ok: 'Utilisé' };
  const DOT = { ko: 'ko', warn: 'warn', unused: 'none', ok: 'ok' };
  function skillsBody(M) {
    const L = M.S.skills;
    if (!L) return [h('p', { class: 'us-dim' }, 'La tour lit les skills installés et les journaux des sessions…')];
    const todo = L.ko + L.warn;
    const filter = skillUi.filter || (todo ? 'todo' : 'all');
    const FILTERS = [['todo', 'À réparer', todo, (x) => x.status === 'ko' || x.status === 'warn'], ['unused', 'Jamais utilisés', L.unused, (x) => x.status === 'unused'],
      ['ok', 'Utilisés', L.ok, (x) => x.status === 'ok'], ['all', 'Tous', L.total, () => true]];
    const keep = FILTERS.find(f => f[0] === filter)[3];
    const shown = L.skills.filter(keep);
    const groups = [...new Set(shown.map(x => x.where))];
    const used = L.skills.filter(x => x.uses).length;
    const row = (x) => {
      const open = skillUi.open.has(x.id);
      return h('li', { class: `us-task us-skill us-sk-${x.status}` },
        h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(open), onclick: () => { if (open) skillUi.open.delete(x.id); else skillUi.open.add(x.id); renderHud(); } },
          h('span', { class: `us-dot us-d-${DOT[x.status]}` }), h('code', null, x.call),
          h('span', { class: `us-skst us-t-${x.status === 'ko' ? 'ko' : x.status === 'warn' ? 'warn' : x.status === 'ok' ? 'ok' : 'unused'}` }, x.uses ? `${x.uses}×` : STATUS_TXT[x.status])),
        x.issues.length ? h('ul', { class: 'us-skissues' }, x.issues.map(i => h('li', { class: i.level === 'ko' ? 'us-t-ko' : 'us-t-warn' }, i.text))) : null,
        open ? [
          x.description ? h('p', { class: 'us-dim' }, x.description) : h('p', { class: 'us-t-ko' }, 'Pas de description.'),
          h('p', null, x.uses ? [`${T.plural(x.uses, 'appel', 'appels')} dans ${T.plural(x.sessions, 'session', 'sessions')}`, x.typed ? ` (dont ${x.typed} tapé${x.typed > 1 ? 's' : ''} en /${x.call})` : '', ', le dernier ', T.agoEl(x.lastAt), x.usedIn.length ? `, dans ${x.usedIn.join(', ')}` : '', '.']
            : `Aucune session ne s'en est servie ces ${L.days} derniers jours.${x.manual ? ' Il ne se déclenche pas tout seul (disable-model-invocation) : tape /' + x.call + '.' : ''}`),
          h('div', { class: 'us-actions' }, btn('Lire le SKILL.md', () => skillFile(x), '', M.demo ? { disabled: true } : {}))] : null);
    };
    return [
      h('p', null, `${T.plural(L.total, 'skill installé', 'skills installés')} : ${used} utilisé${used > 1 ? 's' : ''} ces ${L.days} derniers jours, ${L.unused} jamais, `,
        h('span', { class: L.ko ? 'us-t-ko' : L.warn ? 'us-t-warn' : 'us-t-ok' }, todo ? `${todo} à réparer ou revoir` : 'aucun à réparer'), '.'),
      h('div', { class: 'us-actions' }, btn('Ajouter un skill', () => skillDialog(M), 'us-go', M.demo ? { disabled: true } : {}),
        btn('Relire', async () => { const r = await T.api('/api/skills/refresh'); if (r) T.toast(r.ok ? 'Skills relus.' : 'Lecture impossible.'); }),
        h('span', { class: 'us-dim' }, 'lu ', T.agoEl(L.scannedAt))),
      h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Filtrer les skills' }, FILTERS.map(([id, text, n]) =>
        h('button', { type: 'button', class: 'us-chip2' + (filter === id ? ' on' : ''), 'aria-pressed': String(filter === id), onclick: () => { skillUi.filter = id; renderHud(); } }, `${text} (${n})`))),
      shown.length ? groups.map(g => [h('div', { class: 'us-sub' }, `${g} (${shown.filter(x => x.where === g).length})`), h('ul', { class: 'us-tuto-list' }, shown.filter(x => x.where === g).map(row))])
        : h('p', { class: 'us-t-ok' }, filter === 'todo' ? 'Rien à réparer : chaque skill a un en-tête lisible et une description.' : 'Aucun.'),
      L.plugins.length ? [h('div', { class: 'us-sub' }, 'Plugins'), h('ul', { class: 'us-tuto-list' }, L.plugins.map(p => h('li', { class: 'us-task' },
        h('div', { class: 'us-tuto-head' }, h('b', null, p.name), h('span', { class: 'us-dim' }, p.installed ? T.plural(p.skills, 'skill', 'skills') : 'pas téléchargé')),
        h('small', { class: p.enabled.length ? 'us-dim' : 'us-t-warn' }, p.enabled.length ? `Activé : ${p.enabled.join(', ')}` : 'Activé nulle part'),
        p.issues.map(i => h('small', { class: i.level === 'ko' ? 'us-t-ko' : 'us-t-warn' }, i.text)))))] : null,
      L.unknown.length ? [h('div', { class: 'us-sub' }, 'Appelés mais pas sur le disque'),
        h('p', { class: 'us-dim' }, 'Souvent des skills intégrés à Claude Code (simplify, code-review…) : rien à réparer s\'ils ont marché. Sinon, le skill a été supprimé ou renommé.'),
        h('ul', { class: 'us-list' }, L.unknown.map(u => h('li', null, h('code', null, u.name), ` ${u.uses}×, le dernier `, T.agoEl(u.lastAt))))] : null,
      h('div', { class: 'us-sub' }, 'Où Claude Code les cherche'),
      h('p', { class: 'us-dim' }, 'Perso : ~/.claude/skills (tous tes projets). Projet : <projet>/.claude/skills. Compte : ceux de claude.ai. Plugin : appelé « plugin:nom », seulement là où le plugin est activé. Chaque skill est un dossier avec un SKILL.md : un en-tête (name, description) puis ses consignes. La description décide quand Claude le charge.'),
    ];
  }

  // ---------- le quartier des agents ----------
  // Tous les agents que Claude Code peut appeler sur le PC (integres, perso, projets, plugins), rangés par
  // section : ce que dit leur fichier, les skills qu'ils prechargent ou citent, leurs appels et leurs tokens
  // sur 30 jours (lib/agents.js), et la salle ou ils travaillent en ce moment.
  const rosterUi = { filter: 'all', open: new Set() };
  const SCOPE_TXT = { integre: 'intégré', perso: 'perso', projet: 'projet', plugin: 'plugin' };
  function rosterBody(M) {
    const A = M.S.roster;
    if (!A) return [h('p', { class: 'us-dim' }, 'La tour lit les agents installés et les journaux des sessions…')];
    const busyOf = new Map(A.agents.map(ag => [ag.id, rosterBusy(M, ag)]));
    const todo = A.ko + A.warn, working = A.agents.filter(ag => busyOf.get(ag.id).length).length;
    const FILTERS = [['all', 'Tous', A.total, () => true], ['busy', 'Au travail', working, (x) => busyOf.get(x.id).length], ['todo', 'À revoir', todo, (x) => x.status === 'ko' || x.status === 'warn'],
      ['unused', 'Jamais appelés', A.unused, (x) => !x.uses]];
    const f = FILTERS.find(x => x[0] === rosterUi.filter) || FILTERS[0];
    const shown = A.agents.filter(f[3]);
    const sections = [...new Set(shown.map(x => x.section))];
    const count = (sc) => A.agents.filter(x => x.scope === sc).length;
    const open = (a) => select({ kind: 'agent', id: a.id }, true);
    const skillList = (list) => list.length ? list.map((x, i) => [i ? ', ' : '', h('code', { class: x.ok === false ? 'us-t-warn' : '', title: x.ok === false ? 'introuvable sur le PC' : '' }, x.name), x.ok === false ? ' (absent)' : '']) : null;
    const where = (x) => x.scope === 'integre' ? 'Intégré à Claude Code, pas de fichier' : x.scope === 'perso' ? 'Perso : ~/.claude/agents, tous tes projets' : x.scope === 'projet' ? `Projet ${x.project} : .claude/agents, ce projet seulement` : `Plugin ${x.plugin}${x.enabledIn && x.enabledIn.length ? `, activé : ${x.enabledIn.join(', ')}` : ''}`;
    const canTxt = (x) => x.canSkill === true ? (x.preload.length ? 'Oui, et il en précharge' : 'Oui, par l\'outil Skill, quand il en a besoin') : x.canSkill === false ? h('span', { class: 'us-t-warn' }, x.tools ? 'Non : Skill n\'est pas dans sa liste « tools: »' : 'Non : Skill est dans « disallowedTools: »') : 'Agent en lecture seule, la doc ne le précise pas';
    const row = (x) => {
      const isOpen = rosterUi.open.has(x.id), busy = busyOf.get(x.id);
      const dot = x.status === 'ko' ? 'ko' : busy.length ? 'blue' : x.status === 'warn' ? 'warn' : x.uses ? 'ok' : 'none';
      return h('li', { class: `us-task us-skill us-sk-${x.status}` },
        h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(isOpen), onclick: () => { if (isOpen) rosterUi.open.delete(x.id); else rosterUi.open.add(x.id); renderHud(); } },
          h('span', { class: `us-dot us-d-${dot}` }), h('code', null, x.call), h('span', { class: 'us-dim us-scope' }, x.scope === 'projet' ? x.project : SCOPE_TXT[x.scope]),
          h('span', { class: `us-skst us-t-${busy.length ? 'info' : x.uses ? 'ok' : 'unused'}` }, busy.length ? 'au travail' : x.uses ? `${x.uses}×` : 'jamais')),
        busy.length ? h('small', null, 'Au travail dans ', busy.map((a, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'us-link', onclick: () => open(a) }, `« ${a.salle} »`)])) : null,
        x.issues.length ? h('ul', { class: 'us-skissues' }, x.issues.map(i => h('li', { class: i.level === 'ko' ? 'us-t-ko' : 'us-t-warn' }, i.text))) : null,
        isOpen ? [
          x.description ? h('p', { class: 'us-dim' }, x.description) : null,
          rowsOf([
            ['Où', where(x)],
            ['Modèle', x.model || 'celui de la session'],
            ['Outils', x.tools ? x.tools.join(', ') : 'tous ceux de la session'],
            x.disallowed.length && ['Interdits', x.disallowed.join(', ')],
            ['Skills', canTxt(x)],
            x.preload.length && ['Préchargés', skillList(x.preload)],
            x.cites.length && ['Cités', skillList(x.cites)],
            x.mcp && x.mcp.length && ['Serveurs MCP', x.mcp.join(', ')],
            x.permissionMode && ['Permissions', x.permissionMode],
            ['Appels', x.uses ? [`${T.plural(x.uses, 'appel', 'appels')} dans ${T.plural(x.sessions, 'session', 'sessions')}`, x.tokens ? `, ${tok(x.tokens)} tokens` : '', ', le dernier ', T.agoEl(x.lastAt), x.usedIn.length ? `, dans ${x.usedIn.join(', ')}` : ''] : `aucun ces ${A.days} derniers jours`],
          ]),
          x.recent.length ? h('ul', { class: 'us-list' }, x.recent.map(r => h('li', null, r.what ? `${r.what} ` : '', h('span', { class: 'us-dim' }, r.tokens ? `${tok(r.tokens)} tokens, ` : '', T.agoEl(r.at))))) : null,
          x.builtin ? null : h('div', { class: 'us-actions' }, btn('Lire son fichier', () => fileView(x.call, x.file, '/api/roster/file?id=' + encodeURIComponent(x.id)), '', M.demo ? { disabled: true } : {}))] : null);
    };
    return [
      h('p', null, `${T.plural(A.total, 'agent', 'agents')} que tes sessions peuvent appeler : ${count('integre')} intégrés, ${count('perso')} perso, ${count('projet')} dans tes projets, ${count('plugin')} de plugins. `,
        h('span', { class: working ? 'us-t-info' : 'us-dim' }, working ? `${working} au travail` : 'aucun au travail'), ', ',
        h('span', { class: A.ko ? 'us-t-ko' : todo ? 'us-t-warn' : 'us-t-ok' }, todo ? `${todo} à revoir` : 'aucun à revoir'), '.'),
      h('div', { class: 'us-actions' }, btn('Relire', async () => { const r = await T.api('/api/roster/refresh'); if (r) T.toast(r.ok ? 'Agents relus.' : 'Lecture impossible.'); }),
        h('span', { class: 'us-dim' }, 'lu ', T.agoEl(A.scannedAt))),
      h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Filtrer les agents' }, FILTERS.map(([id, text, n]) =>
        h('button', { type: 'button', class: 'us-chip2' + (f[0] === id ? ' on' : ''), 'aria-pressed': String(f[0] === id), onclick: () => { rosterUi.filter = id; renderHud(); } }, `${text} (${n})`))),
      shown.length ? sections.map(sec => [h('div', { class: 'us-sub' }, `${sec} (${shown.filter(x => x.section === sec).length})`), h('ul', { class: 'us-tuto-list' }, shown.filter(x => x.section === sec).map(row))])
        : h('p', { class: 'us-dim' }, 'Aucun.'),
      A.unknown.length ? [h('div', { class: 'us-sub' }, 'Appelés mais pas sur le disque'),
        h('p', { class: 'us-dim' }, 'Un agent supprimé ou renommé, ou un agent d\'un projet que la tour ne connaît pas.'),
        h('ul', { class: 'us-list' }, A.unknown.map(u => h('li', null, h('code', null, u.name), ` ${u.uses}×, le dernier `, T.agoEl(u.lastAt))))] : null,
      h('div', { class: 'us-sub' }, 'Les agents et les skills'),
      h('p', { class: 'us-dim' }, 'Un agent appelle tout seul les skills perso, du projet et des plugins activés, par l\'outil Skill, sauf si sa liste « tools: » ne contient pas Skill. « skills: » dans son en-tête ne donne pas l\'accès : il précharge le texte complet de ces skills dès son démarrage, pour qu\'il les suive sans avoir à les chercher. Un skill seulement cité dans ses consignes est ouvert s\'il y pense.'),
    ];
  }

  let fileDlg = null, fileDlg_h2, fileDlg_path, fileDlg_pre;
  function skillFile(x) { return fileView(x.call, x.file, '/api/skills/file?id=' + encodeURIComponent(x.id)); }
  async function fileView(title, file, url) {
    if (!fileDlg) {
      fileDlg = h('dialog', { class: 'us-dialog us-wide', 'aria-label': 'SKILL.md' },
        h('form', { method: 'dialog' }, fileDlg_h2 = h('h2', null), fileDlg_path = h('p', { class: 'us-dim us-path' }), fileDlg_pre = h('pre', { class: 'us-code us-skilltext' }),
          h('div', { class: 'us-actions' }, h('button', { type: 'submit', class: 'us-btn' }, 'Fermer'))));
      document.body.append(fileDlg);
    }
    fileDlg_h2.textContent = title;
    fileDlg_path.textContent = file;
    fileDlg_pre.textContent = 'Lecture…';
    fileDlg.showModal();
    try {
      const r = await fetch(url).then(res => res.json());
      fileDlg_pre.textContent = r && r.ok ? r.text : (r && r.error) || 'Lecture impossible.';
    } catch { fileDlg_pre.textContent = 'Tour injoignable.'; }
  }

  // Ajouter un skill : depuis le modele (nom, quand s'en servir, consignes), ou depuis une adresse GitHub.
  // Un skill recupere dehors est montre en entier, et ne s'installe qu'une fois lu et confirme.
  let skillDlg = null;
  function skillDialog(M) {
    const L = M.S.skills || { projects: [] };
    if (!skillDlg) {
      const f = {};
      const setMode = (m) => {
        f.mode = m;
        f.tabTpl.setAttribute('aria-pressed', String(m === 'tpl')); f.tabUrl.setAttribute('aria-pressed', String(m === 'url'));
        f.tabTpl.classList.toggle('on', m === 'tpl'); f.tabUrl.classList.toggle('on', m === 'url');
        f.tpl.hidden = m !== 'tpl'; f.url.hidden = m !== 'url';
        f.err.textContent = '';
        f.submit.textContent = m === 'tpl' ? 'Créer le skill' : 'Installer ce skill';
        f.submit.disabled = m === 'url' && !(f.got && f.ok.checked);
      };
      const fetchIt = async () => {
        f.err.textContent = ''; f.preview.hidden = true; f.got = null; setMode('url');
        f.fetchBtn.disabled = true; f.fetchBtn.textContent = 'Récupération…';
        const r = await T.api('/api/skills/fetch', { url: f.addr.value });
        f.fetchBtn.disabled = false; f.fetchBtn.textContent = 'Récupérer';
        if (!r || !r.ok) { f.err.textContent = (r && r.error) || 'Tour injoignable.'; return; }
        f.got = r;
        f.from.textContent = r.url;
        f.text.textContent = r.text;
        if (!f.name.value) f.name.value = r.name;
        f.notes.replaceChildren(...[
          ...r.problems.map(p => h('li', { class: 'us-t-warn' }, `En-tête : ${p}.`)),
          r.links.length ? h('li', { class: 'us-t-warn' }, `Il cite aussi ${r.links.join(', ')} : seul SKILL.md est copié, ces fichiers manqueront.`) : null,
          h('li', { class: 'us-dim' }, 'Un skill donne des consignes à Claude dans tes sessions : lis-le en entier avant de l\'installer.')].filter(Boolean));
        f.ok.checked = false;
        f.preview.hidden = false;
        setMode('url');
      };
      skillDlg = h('dialog', { class: 'us-dialog us-wide', 'aria-label': 'Ajouter un skill' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const where = f.where.value;
          const body = { scope: where === '__perso' ? 'perso' : 'projet', project: where === '__perso' ? undefined : where, name: f.name.value.trim() };
          if (f.mode === 'tpl') Object.assign(body, { description: f.desc.value, body: f.steps.value });
          else { if (!f.got || !f.ok.checked) { f.err.textContent = 'Récupère le skill et lis-le avant de l\'installer.'; return; } body.text = f.got.text; }
          const r = await T.api('/api/skills/create', body);
          if (r && r.ok) { skillDlg.close(); skillUi.filter = 'all'; T.toast(`Skill créé : ${r.path}`); } else if (r) f.err.textContent = r.error || 'Création impossible.';
        } },
          h('h2', null, 'Ajouter un skill'),
          h('div', { class: 'us-filters', role: 'group', 'aria-label': 'Comment' },
            f.tabTpl = h('button', { type: 'button', class: 'us-chip2', onclick: () => setMode('tpl') }, 'Partir d\'un modèle'),
            f.tabUrl = h('button', { type: 'button', class: 'us-chip2', onclick: () => setMode('url') }, 'Depuis GitHub')),
          h('label', null, 'Où le ranger', f.where = h('select', { class: 'us-select', name: 'skill-where' })),
          h('label', null, 'Nom (minuscules et tirets)', f.name = h('input', { maxlength: 64, name: 'skill-name', pattern: '[a-z0-9][a-z0-9\\-]*', required: true, placeholder: 'ex. lecture-logs-build', autocomplete: 'off' })),
          f.tpl = h('div', { class: 'us-dlgpart' },
            h('label', null, 'Quand Claude doit-il s\'en servir ?', f.desc = h('textarea', { name: 'skill-description', rows: 3, maxlength: 1024, placeholder: 'Utilise ce skill quand un build Unreal échoue : lis le log complet avant de corriger.' })),
            h('p', { class: 'us-dim' }, 'C\'est la description : Claude la lit à chaque session pour décider de charger le skill. Dis quand, avec les mots que tu emploies.'),
            h('label', null, 'Ce qu\'il doit faire (facultatif, sinon un plan à compléter)', f.steps = h('textarea', { name: 'skill-body', rows: 6, maxlength: 100000, placeholder: '1. Ouvre le log complet du build, sans le couper.\n2. Trouve la première erreur.\n3. Corrige-la, puis relance un seul build.' }))),
          f.url = h('div', { class: 'us-dlgpart' },
            h('label', null, 'Adresse du skill', h('span', { class: 'us-row' }, f.addr = h('input', { type: 'url', name: 'skill-url', placeholder: 'https://github.com/…/skills/mon-skill', autocomplete: 'off' }), f.fetchBtn = btn('Récupérer', fetchIt))),
            h('p', { class: 'us-dim' }, 'La page GitHub du dossier du skill ou de son SKILL.md. Rien n\'est installé avant que tu l\'aies lu.'),
            f.preview = h('div', { class: 'us-dlgpart', hidden: true },
              f.from = h('p', { class: 'us-dim us-path' }), f.notes = h('ul', { class: 'us-skissues' }),
              f.text = h('pre', { class: 'us-code us-skilltext' }),
              h('label', { class: 'us-check' }, f.ok = h('input', { type: 'checkbox', name: 'skill-read', onchange: () => setMode('url') }), 'J\'ai lu ce SKILL.md et je veux l\'installer'))),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => skillDlg.close()), f.submit = h('button', { type: 'submit', class: 'us-btn us-go' }, 'Créer le skill'))));
      skillDlg.f = f; f.setMode = setMode;
      document.body.append(skillDlg);
    }
    const f = skillDlg.f;
    f.where.replaceChildren(h('option', { value: '__perso' }, 'Perso : ~/.claude/skills (tous tes projets)'), ...L.projects.map(p => h('option', { value: p }, `${p} : .claude/skills (ce projet seulement)`)));
    f.name.value = ''; f.desc.value = ''; f.steps.value = ''; f.addr.value = ''; f.preview.hidden = true; f.got = null;
    f.setMode('tpl');
    skillDlg.showModal();
    f.name.focus();
  }

  let taskDlg = null;
  function taskDialog(task) {
    if (!taskDlg) {
      const f = {};
      taskDlg = h('dialog', { class: 'us-dialog', 'aria-label': 'Tâche' },
        h('form', { method: 'dialog', onsubmit: async (e) => {
          e.preventDefault();
          const r = await T.api('/api/tasks/save', { id: taskDlg.dataset.id || undefined, title: f.title.value, text: f.text.value, prompt: f.prompt.value, readonly: f.ro.checked });
          if (r && r.ok) { taskDlg.close(); T.toast('Tâche enregistrée.'); } else if (r) f.err.textContent = r.error || 'Enregistrement impossible.';
        } },
          f.head = h('h2', null, 'Nouvelle tâche'),
          h('label', null, 'Titre', f.title = h('input', { maxlength: 80, required: true, placeholder: 'ex. Assets orphelins' })),
          h('label', null, 'En une ligne (facultatif)', f.text = h('input', { maxlength: 200, placeholder: 'ce que la tâche apporte' })),
          h('label', null, 'Consigne pour Claude Code', f.prompt = h('textarea', { rows: 10, maxlength: 8000, required: true, placeholder: 'Ce que l\'agent doit faire, étape par étape. {projet} est remplacé par le nom du projet, {date} par la date du jour.' })),
          h('label', { class: 'us-check' }, f.ro = h('input', { type: 'checkbox' }), 'Ne modifie pas le code : peut tourner en fond (lecture du projet, écriture dans Saved/Tour seulement)'),
          f.err = h('p', { class: 'us-t-ko' }),
          h('div', { class: 'us-actions' }, btn('Annuler', () => taskDlg.close()), h('button', { type: 'submit', class: 'us-btn us-go' }, 'Enregistrer'))));
      taskDlg.f = f;
      document.body.append(taskDlg);
    }
    const f = taskDlg.f;
    taskDlg.dataset.id = task && !task.builtin ? task.id : '';
    f.head.textContent = task && !task.builtin ? 'Modifier la tâche' : task ? `Copie de « ${task.title} »` : 'Nouvelle tâche';
    f.title.value = task ? (task.builtin ? `${task.title} (perso)` : task.title) : '';
    f.text.value = task ? task.text || '' : '';
    f.prompt.value = task ? task.prompt : '';
    f.ro.checked = !!(task && task.readonly);
    f.err.textContent = '';
    taskDlg.showModal();
    f.title.focus();
  }

  function promptText(t, proj) {
    const d = todayKey();
    const S = (G.M && G.M.S) || {};
    return `Tache de la tour [${t.id}] : ${t.title}\n\n${t.prompt.replace(/\{projet\}/g, proj || 'en cours').replace(/\{date\}/g, d)}\n${S.taskSuivi ? `\n${S.taskSuivi}\n` : ''}`;
  }
  async function copyPrompt(t, proj) {
    try { await navigator.clipboard.writeText(promptText(t, proj)); T.toast('Consigne copiée : colle-la dans une session Claude Code ouverte sur le projet.'); }
    catch { T.toast('Copie impossible dans ce navigateur.'); }
  }
  async function launchTask(t, proj, background = false) {
    const r = await T.api('/api/tasks/launch', { id: t.id, project: proj, background });
    if (r && r.ok) { suiviOpen.clear(); T.toast(background ? `« ${t.title} » tourne en fond : suis-la ici, dans « Suivi des tâches ».` : `Claude Code s'ouvre dans une nouvelle fenêtre avec « ${t.title} ». Suis-la ici, dans « Suivi des tâches ».`); }
    // Sans la commande claude (Claude Code utilise depuis l'application de bureau), on copie la consigne.
    else if (r && (r.code === 'noclaude' || /Windows/.test(r.error || ''))) {
      try { await navigator.clipboard.writeText(promptText(t, proj)); T.toast(`Consigne copiée : colle-la dans une session Claude Code ouverte sur ${proj || 'le projet'}.`); }
      catch { T.toast(r.error); }
    } else if (r && r.error) T.toast(r.error);
  }

  function tachesPanel(M) {
    const tasks = M.S.tasks || [];
    const proj = M.projects[0] ? M.projects[0].name : '';
    const close = btn('Fermer', () => sideToggle('taches', false), 'us-x', { 'aria-label': 'Fermer les tâches', title: 'Échap' });
    const runs = M.agents.filter(a => a.task).sort((x, y) => y.task.at - x.task.at).slice(0, 6);
    // En demo, les dates sont decalees a l'ouverture : « aujourd'hui » est le dernier jour du journal.
    const day = M.demo ? M.agents.flatMap(a => Object.keys((a.usage && a.usage.days) || {})).sort().pop() || todayKey() : todayKey();
    const today = M.agents.map(a => ({ a, n: a.usage && a.usage.days ? a.usage.days[day] || 0 : 0 })).filter(x => x.n).sort((x, y) => y.n - x.n);
    const sum = today.reduce((s, x) => s + x.n, 0);
    const card = (t) => h('li', { class: 'us-task' },
      h('div', { class: 'us-tuto-head' }, h('b', null, t.title), t.builtin ? null : h('span', { class: 'us-dim' }, 'perso')),
      t.text ? h('p', { class: 'us-dim' }, t.text) : null,
      h('div', { class: 'us-actions' },
        btn('Lancer', () => launchTask(t, proj), 'us-go', M.demo || !proj ? { disabled: true } : { title: 'Ouvre Claude Code dans une fenêtre, dans le dossier du projet, avec cette consigne' }),
        t.readonly ? btn('En fond', () => launchTask(t, proj, true), '', M.demo || !proj ? { disabled: true } : { title: 'Sans fenêtre : tu suis l\'agent dans la tour. Il lit le projet et écrit son rapport dans Saved/Tour, sans rien modifier d\'autre.' }) : null,
        btn('Copier la consigne', () => copyPrompt(t, proj)),
        t.builtin ? btn('Copier en perso', () => taskDialog(t), '', M.demo ? { disabled: true } : { title: 'Crée une tâche perso à partir de celle-ci' })
          : [btn('Modifier', () => taskDialog(t), '', M.demo ? { disabled: true } : {}),
            btn('Supprimer', () => { if (confirm(`Supprimer la tâche « ${t.title} » ?`)) T.api('/api/tasks/delete', { id: t.id }); }, 'us-danger', M.demo ? { disabled: true } : {})]));
    const open = (a) => { sideToggle('taches', false); select({ kind: 'agent', id: a.id }, true); };
    return h('section', { class: 'us-panel us-entity us-taches', 'aria-label': 'Tâches' },
      h('div', { class: 'us-ehead' }, h('h2', null, proj ? `Tâches sur ${proj}` : 'Tâches'), close),
      h('div', { class: 'us-ebody' },
        h('p', null, proj ? `« Lancer » ouvre Claude Code dans une fenêtre, dans le dossier de ${proj} : tu lui réponds et valides ses modifications. « En fond » le fait tourner sans fenêtre pour les tâches qui ne touchent pas au code. Dans les deux cas, la tour suit la session et ses tokens.`
          : 'Connecte d\'abord ton projet Unreal (bouton du projet en haut) : les tâches se lancent dans son dossier.'),
        h('ul', { class: 'us-tuto-list' }, tasks.map(card)),
        btn('Nouvelle tâche', () => taskDialog(null), 'us-go', M.demo ? { disabled: true } : {}),
        h('div', { class: 'us-sub' }, 'Suivi des tâches'),
        runs.length ? h('ul', { class: 'us-runs' }, runs.map((a, i) => {
          // La plus recente est ouverte d'office ; un clic ouvre ou ferme les autres.
          const isOpen = suiviOpen.has(a.id) ? suiviOpen.get(a.id) : i === 0;
          return h('li', { class: isOpen ? 'on' : '' },
            h('button', { type: 'button', class: 'us-runbtn', 'aria-expanded': String(isOpen), onclick: () => { suiviOpen.set(a.id, !isOpen); renderHud(); } },
              h('span', { class: `us-dot us-d-${dotFor(a.st)}` }), h('b', null, a.task.title), h('span', { class: 'us-dim' }, isOpen ? ` ${a.name}` : ` ${a.name}, ${T.lower(suiviState(a).text)}`)),
            a.usage ? h('span', null, tok(a.usage.total)) : null,
            isOpen ? [suiviBlock(a), h('div', { class: 'us-actions' }, btn('Voir l\'agent', () => open(a)))] : null);
        }))
          : h('p', { class: 'us-dim' }, 'Aucune pour l\'instant. Lance une tâche : son suivi s\'affiche ici et se met à jour tout seul.'),
        h('div', { class: 'us-sub' }, 'Tokens aujourd\'hui'),
        sum ? [h('p', null, h('b', null, tok(sum)), ` pour ${T.plural(today.length, 'session', 'sessions')}`),
          h('ul', { class: 'us-tools' }, today.slice(0, 6).map(x => h('li', null, h('b', null, x.a.name), h('span', { class: 'us-dim' }, x.a.task ? x.a.task.title : x.a.role || x.a.where),
            h('i', { style: `width:${Math.max(3, Math.round(100 * x.n / today[0].n))}%` }), h('span', null, tok(x.n)))))]
          : h('p', { class: 'us-dim' }, 'Rien de compté aujourd\'hui. La tour lit les journaux de Claude Code à chaque action des agents.')));
  }

  function sideToggle(which, on) {
    const open = on === undefined ? G.side !== which : on;
    if (!open && G.side !== which) return;
    G.side = open ? which : null;
    tutoFocus = '';
    if (which === 'tuto' && !open) G.sel = null;
    if (!G.userMoved) fit();
    G.dirty = true;
    renderHud();
  }

  function tutoToggle(on) { sideToggle('tuto', on); }

  function renderHud() {
    const M = G.M; if (!M) return;
    G.hud.chips.replaceChildren(...chips(M).filter(Boolean));
    G.hud.res.replaceChildren(...(MODE.counters ? counters(M) : []));
    const ent = G.side === 'tuto' ? tutoPanel(M) : G.side === 'taches' ? tachesPanel(M) : G.side === 'equipe' ? equipePanel(M) : entityPanel(M);
    // La fiche est refaite a chaque nouvelle donnee : on garde l'endroit ou on l'avait fait defiler.
    const was = G.hud.entity.firstChild, oldBody = was && was.querySelector('.us-ebody');
    G.hud.entity.replaceChildren(...(ent ? [ent] : []));
    if (oldBody && ent && ent.getAttribute('aria-label') === was.getAttribute('aria-label')) ent.querySelector('.us-ebody').scrollTop = oldBody.scrollTop;
    G.hud.entity.hidden = !ent;
    G.app.classList.toggle('us-has-sel', !!ent);
    // Un mode peut rendre les memes noeuds d'une fois sur l'autre (un champ de saisie garde alors son focus).
    const nodes = (MODE.hud ? MODE.hud(M, api) : []).filter(Boolean);
    if (!same(nodes, [...G.hud.mode.children])) G.hud.mode.replaceChildren(...nodes);
    const none = !G.world || !G.world.machines.length;
    if (none) G.hud.empty.replaceChildren(h('p', null, M.projects.length ? 'Aucune session ouverte. Lance Claude Code (ou une tâche) : sa salle apparaît ici, avec son personnage et ses sous-agents.' : 'Connecte ton projet Unreal (bouton en haut), puis lance Claude Code : chaque session aura sa salle ici.'));
    G.hud.empty.hidden = !none;
    G.hud.tutoBtn.classList.toggle('on', G.side === 'tuto');
    G.hud.taskBtn.classList.toggle('on', G.side === 'taches');
    G.hud.teamBtn.classList.toggle('on', G.side === 'equipe');
    G.hud.skillBtn.classList.toggle('on', !G.side && !!G.sel && G.sel.kind === 'skills');
    G.hud.skillBtn.classList.toggle('alert', !!(M.S.skills && M.S.skills.ko));
    G.hud.agentBtn.classList.toggle('on', !G.side && !!G.sel && G.sel.kind === 'roster');
    G.hud.agentBtn.classList.toggle('alert', !!(M.S.roster && M.S.roster.ko));
    G.hud.tutoBtn.classList.toggle('run', !!(M.S.tuto && M.S.tuto.running));
  }

  function build(root) {
    G.canvas = h('canvas', { class: 'us-canvas', role: 'img', 'aria-label': `La tour (${TH.name}) : une salle par session, ses agents, la forge et la version, en direct` });
    G.mini = h('canvas', { class: 'us-mini', width: 220, height: 120, 'aria-label': 'Mini-carte : clique pour déplacer la vue' });
    G.ctx = G.canvas.getContext('2d');
    G.hud = {
      chips: h('span', { class: 'us-chips' }), res: h('div', { class: 'us-res', 'aria-label': 'Compteurs' }),
      mode: h('div', { class: 'us-hud' }), entity: h('div', { class: 'us-entitybox' }), empty: h('div', { class: 'us-emptymap' }),
      tip: h('div', { class: 'us-tip', hidden: true, 'aria-hidden': 'true' }),
    };
    G.app = h('div', { class: `us-app us-m-${MODE.id}` },
      h('div', { class: 'us-stage' }, G.canvas, G.hud.empty, G.hud.tip),
      h('header', { class: 'us-top' }, h('span', { class: 'us-brand' }, 'Alkatrazz Tower'), h('span', { class: 'us-sub2' }, MODE.name), G.hud.chips, G.hud.res, h('span', { class: 'us-grow' }), G.hud.taskBtn = h('button', { type: 'button', class: 'us-chip2 us-tutobtn', title: 'Relecture, anomalies, idées de features, et tes propres tâches ; tokens de chaque session', onclick: () => sideToggle('taches') }, 'Tâches'), G.hud.teamBtn = h('button', { type: 'button', class: 'us-chip2 us-tutobtn', title: 'Les agents de ton projet, par section (animation, interface, menus...)', onclick: () => sideToggle('equipe') }, 'Équipe'), G.hud.skillBtn = h('button', { type: 'button', class: 'us-chip2 us-tutobtn', title: 'La bibliothèque : tous les skills installés, s\'ils marchent et s\'ils servent (touche B)', onclick: () => { if (G.side) sideToggle(G.side, false); select(G.sel && G.sel.kind === 'skills' ? null : { kind: 'skills' }, true); } }, 'Skills'), G.hud.agentBtn = h('button', { type: 'button', class: 'us-chip2 us-tutobtn', title: 'Le quartier des agents : tous les agents que Claude Code peut appeler, leur fichier, leurs skills, et ce qu\'ils ont fait (touche A)', onclick: () => { if (G.side) sideToggle(G.side, false); select(G.sel && G.sel.kind === 'roster' ? null : { kind: 'roster' }, true); } }, 'Agents'), G.hud.tutoBtn = h('button', { type: 'button', class: 'us-chip2 us-tutobtn', title: 'Des scénarios courts pour voir chaque partie de la tour marcher sur ton projet', onclick: () => tutoToggle() }, 'Tutos'), T.switcher('Fonctionnement'), worldSwitch()),
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
