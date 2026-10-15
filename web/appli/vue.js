'use strict';
// « Vue » : la tour en coupe, en pixel art, comme les bureaux d'agents d'OpenClaw et Hermes. Chaque etage a
// ses salles : la direction (Chef, Conseil, Forge), une salle par session qui tourne, les sujets en sommeil et
// les taches, puis les services (Skills, Agents, Documentation, Depots, Sauvegarde). Les agents se placent
// selon ce qu'ils font : au bureau quand ils travaillent, debout avec un « ! » quand ils t'attendent, sur le
// canape quand ils ont fini, endormis quand ils ne disent plus rien. Lecture seule : un clic sur une salle
// ouvre sa conversation ou sa fiche dans l'appli. Tout vient de l'etat de la tour (web/core.js).
// Charge a la demande par web/appli/moteur.js (bouton « Vue »).

(function () {
  const T = window.Tower, h = T.h;
  const A = window.Appli, F = window.Fiches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage bloque */ } },
  };
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- la scene, en pixels du dessin (la page l'agrandit sans flou) ----------
  const MX = 16, WALL = 3, SHAFT = 20, IW = 420, ROOF = 42, RH = 54, SLAB = 6, FH = RH + SLAB, GROUND = 20;
  const SW = MX * 2 + WALL * 3 + SHAFT + IW;
  const RX = MX + WALL + SHAFT + WALL; // debut des salles
  const PER_FLOOR = 4; // sessions par etage

  const hash = (s) => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  const pick = (arr, s) => arr[hash(s) % arr.length];
  const SHIRTS = ['#4f86c6', '#c65f4f', '#5aa469', '#9a6fc4', '#d0913c', '#3fa3a3', '#c45d93', '#6b7bd6', '#8c9b3e', '#d06c3a'];
  const HAIRS = ['#2b1d14', '#5a3a22', '#a8642c', '#e0c068', '#1d1d24', '#7a7f88', '#8a2f2a'];
  const SKINS = ['#f2c9a0', '#d9a77a', '#a8734c', '#7a4f33'];
  const PANTS = ['#2d3442', '#3a3026', '#24323a', '#3b2d40'];
  const nameOf = (a) => a.label || a.salle || a.name;
  const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  function look(seed, shirt) {
    return { shirt: shirt || pick(SHIRTS, seed + 's'), hair: pick(HAIRS, seed + 'h'), skin: pick(SKINS, seed + 'k'), pants: pick(PANTS, seed + 'p') };
  }

  // ---------- ce que montre la tour : etages, salles, personnages ----------
  // Une salle : { key, kind, x, y, w, title, tip[], open(), tone, dim, more, ... }.
  // Un personnage : { key, x, fy, pose, look, mark, small } ; x et fy (le sol sous ses pieds) sont des cibles :
  // le dessin l'y emmene en marchant.
  function split(y, list) {
    const total = list.reduce((s, r) => s + (r.weight || 1), 0);
    const free = IW - WALL * (list.length - 1);
    let x = RX;
    return list.map((r, i) => {
      const w = i === list.length - 1 ? RX + IW - x : Math.round(free * (r.weight || 1) / total);
      const room = { ...r, x, y, w };
      x += w + WALL;
      return room;
    });
  }
  function sessionsOf(M) {
    return M.agents.filter(a => !a.old && a.kind !== 'chef')
      .sort((x, y) => (x.raw.firstSeen || 0) - (y.raw.firstSeen || 0) || String(x.id).localeCompare(String(y.id)));
  }
  function layout(M) {
    const floors = [];
    const chefA = M.chef && M.chef.session ? M.agents.find(x => x.id === M.chef.session.id) : null;
    const K = F.conseilOf(M), run = K && K.runs && K.runs[0];
    const wait = M.chef ? M.chef.envois.filter(e => e.status === 'proposé').length : 0;
    floors.push([
      { key: 'chef', kind: 'chef', weight: 1.25, title: 'Chef', a: chefA, has: !!M.chef, envois: M.chef ? M.chef.envois : [], wait, sleeping: !chefA,
        tone: chefA && chefA.st === 'waiting' || wait ? 'warn' : '', open: () => A.nav.conv('chef'),
        tip: [chefA ? `Chef : ${chefA.stText}` : M.chef ? 'Chef en sommeil : écris-lui pour le réveiller' : 'Pas de Chef : connecte ton projet Unreal',
          wait ? `${T.plural(wait, 'envoi attend', 'envois attendent')} ton accord` : '', chefA && chefA.tool ? `${chefA.tool.name} ${clip(chefA.tool.summary, 60)}` : ''] },
      { key: 'conseil', kind: 'conseil', weight: 1.25, title: 'Conseil', run, live: F.isLive(run), open: () => A.nav.conv('conseil'),
        tip: [run && F.isLive(run) ? `Délibère : ${clip(run.question, 90)}` : run && run.decision ? `Dernier verdict : ${clip(run.decision, 90)}` : 'Cinq avis et un président, pour un vrai choix.'] },
      { key: 'forge', kind: 'forge', weight: 1.5, title: 'Forge', lock: M.lock, queue: M.queue, last: M.builds[0] || null, open: () => A.nav.sheet('forge'),
        tone: M.lock ? 'blue' : '',
        tip: [M.lock ? `${M.lock.kindText} de ${M.lock.agent ? nameOf(M.lock.agent) : M.lock.label}` : 'Libre : le prochain build passe tout de suite.',
          M.queue.length ? `${M.queue.length} dans la file` : '', M.builds[0] ? `Dernier : ${M.builds[0].kindText} ${M.builds[0].ok ? 'réussi' : 'échoué'}` : ''] },
    ]);
    const sess = sessionsOf(M);
    if (!sess.length) floors.push([{ key: 'vide', kind: 'vide', title: 'Aucune session', open: () => A.nav.conv('chef'), dim: true, tip: ['Aucune session ne tourne : écris au Chef ou lance une tâche.'] }]);
    for (let i = 0; i < sess.length; i += PER_FLOOR) {
      const row = sess.slice(i, i + PER_FLOOR).map(a => ({ key: 's:' + a.id, kind: 'session', title: nameOf(a), a, open: () => A.nav.conv(a.id),
        tone: a.st === 'waiting' ? 'warn' : a.st === 'idle' ? 'ok' : a.st === 'working' ? 'blue' : '', dim: a.st === 'silent' || a.st === 'ready',
        more: a.subList.length > 3 ? `+${a.subList.length - 3}` : '', tip: sessionTip(a) }));
      // un etage pas plein garde des salles de la meme largeur ; le reste est un couloir
      while (row.length < PER_FLOOR && sess.length > PER_FLOOR) row.push({ key: 'couloir:' + i + ':' + row.length, kind: 'couloir', title: '', dim: true });
      floors.push(row);
    }
    const sleep = [...(M.sujets || []), ...(M.features || []).filter(f => !f.done)].filter(z => !z.session);
    const tasks = (M.S && M.S.tasks) || [];
    floors.push([
      { key: 'sujets', kind: 'sujets', weight: 2.2, title: 'Sujets en sommeil', sleep, open: () => A.nav.sheet('sujets'), dim: !sleep.length,
        tip: sleep.length ? [`${T.plural(sleep.length, 'sujet dort', 'sujets dorment')} : écris-leur pour les réveiller`, ...sleep.slice(0, 8).map(z => `· ${z.title}`), sleep.length > 8 ? `et ${sleep.length - 8} autres` : ''] : [(M.sujets || []).length ? 'Tous les sujets sont réveillés.' : 'Pas encore de sujets : connecte ton projet Unreal.'] },
      { key: 'taches', kind: 'taches', weight: 1, title: 'Tâches', tasks, open: () => A.nav.sheet('taches'),
        tip: [tasks.length ? T.plural(tasks.length, 'tâche prête à lancer', 'tâches prêtes à lancer') : 'Consignes prêtes à lancer', ...tasks.slice(0, 6).map(t => `· ${t.title}`)] },
    ]);
    const skills = ((M.S && M.S.skills && M.S.skills.skills) || []);
    const roster = ((M.S && M.S.roster && M.S.roster.agents) || []);
    const busy = new Set(M.liveAgents.flatMap(a => a.subList.map(s => s.type)));
    const debts = F.docDebts(M);
    // l'etat de chaque service, dit comme dans le tableau de bord
    const HR = Object.fromEntries(A.health(M).map(r => [r[0], r]));
    const say = (k) => { const r = HR[k]; return r ? r[3].charAt(0).toUpperCase() + r[3].slice(1) : ''; };
    const tone = (k) => { const t = HR[k] && HR[k][2]; return t === 'ko' || t === 'warn' || t === 'blue' ? t : ''; };
    const svT = tone('sauvegarde');
    floors.push([
      { key: 'skills', kind: 'skills', title: 'Skills', skills, open: () => A.nav.sheet('skills'), tone: tone('skills'), tip: [say('skills')] },
      { key: 'agents', kind: 'agents', title: 'Agents', roster, busy, open: () => A.nav.sheet('roster'), tone: tone('roster'),
        tip: [say('roster'), busy.size ? `Au travail : ${[...busy].slice(0, 6).join(', ')}` : 'Aucun sous-agent appelé en ce moment'] },
      { key: 'docs', kind: 'docs', title: 'Documentation', debts, open: () => A.nav.sheet('docs'), tone: tone('docs'), tip: [say('docs')] },
      { key: 'git', kind: 'git', title: 'Dépôts', ko: tone('git') === 'ko', open: () => A.nav.sheet('git'), tone: tone('git'), tip: [say('git')] },
      { key: 'sauvegarde', kind: 'sauvegarde', title: 'Sauvegarde', ko: svT === 'ko', busy: svT === 'blue', none: !HR.sauvegarde || HR.sauvegarde[2] === 'grey',
        open: () => A.nav.sheet('sauvegarde'), tone: svT, tip: [say('sauvegarde')] },
    ]);
    const rooms = floors.flatMap((list, i) => split(ROOF + i * FH, list));
    const SH = ROOF + floors.length * FH + GROUND;
    const actors = [];
    for (const r of rooms) placeActors(r, actors, M);
    return { rooms, actors, floors: floors.length, SH, connected: M.connected || M.demo, alert: M.attention.length };
  }
  function sessionTip(a) {
    const subs = {};
    for (const s of a.subList) subs[s.type] = (subs[s.type] || 0) + 1;
    return [
      `${a.stText}${a.project ? ' · ' + a.project : ''}`,
      a.st === 'waiting' && (a.ask || a.pending) ? clip(a.ask || (a.pending.questions ? (a.pending.questions[0] || {}).question : `${a.pending.tool || ''} ${a.pending.summary || ''}`), 120) : '',
      a.st === 'idle' && a.said ? clip(a.said, 120) : '',
      a.tool && a.st === 'working' ? `${a.tool.name} ${clip(a.tool.summary, 60)}` : '',
      a.subList.length ? `Sous-agents : ${Object.entries(subs).map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(', ')}` : '',
      a.holds ? 'Tient la forge' : a.queuePos ? `${a.queuePos}e dans la file de la forge` : '',
      a.error ? `Erreur : ${clip(a.error, 80)}` : '',
    ];
  }
  // la place de chacun dans sa salle
  function placeActors(r, out, M) {
    const fy = r.y + RH - 4;
    if (r.kind === 'session') {
      const a = r.a, lk = look(a.id);
      const desk = r.x + 24, sofa = r.x + r.w - 15;
      if (a.st === 'working') out.push({ key: a.id, x: desk, fy, pose: 'sit', look: lk, typing: true });
      else if (a.st === 'silent') out.push({ key: a.id, x: desk, fy, pose: 'sit', look: lk, mark: 'z' });
      else if (a.st === 'waiting') out.push({ key: a.id, x: r.x + 36, fy, pose: 'stand', look: lk, mark: '!' });
      else if (a.st === 'idle') out.push({ key: a.id, x: sofa, fy, pose: 'sofa', look: lk, mark: 'ok' });
      else out.push({ key: a.id, x: sofa, fy, pose: 'sofa', look: lk });
      // les sous-agents autour de la petite table
      const mid = r.x + Math.round(r.w * 0.56);
      a.subList.slice(0, 3).forEach((s, i) => out.push({ key: a.id + '/' + s.id, x: mid + [-9, 9, 0][i], fy: fy - (i === 2 ? 0 : 0), pose: 'stand', small: true,
        look: look(s.id, pick(SHIRTS, s.section || s.type)), behind: i === 2, talk: i }));
    } else if (r.kind === 'chef') {
      const lk = { ...look('chef'), shirt: '#d8a531' };
      const a = r.a;
      if (!r.has) return; // pas de projet connecte : pas encore de chef
      if (!a) out.push({ key: 'chef', x: r.x + 30, fy, pose: 'sit', look: lk, mark: 'z', chef: true });
      else if (a.st === 'waiting') out.push({ key: 'chef', x: r.x + 44, fy, pose: 'stand', look: lk, mark: '!', chef: true });
      else out.push({ key: 'chef', x: r.x + 30, fy, pose: 'sit', look: lk, typing: a.st === 'working', mark: r.wait ? '!' : a.st === 'idle' ? 'ok' : a.st === 'silent' ? 'z' : '', chef: true });
    } else if (r.kind === 'conseil' && r.live) {
      const x0 = r.x + 22, step = Math.max(12, Math.floor((r.w - 56) / 4));
      for (let i = 0; i < 5; i++) out.push({ key: 'k' + i, x: x0 + i * step, fy, pose: 'sit', look: look('conseil' + i), talk: i });
      out.push({ key: 'kp', x: r.x + r.w - 12, fy, pose: 'stand', look: { ...look('president'), shirt: '#7a4fc4' }, mark: '…' });
    } else if (r.kind === 'forge') {
      if (r.lock) {
        const ag = r.lock.agent;
        out.push({ key: 'forge:' + (ag ? ag.id : 'x'), x: r.x + r.w - 46, fy, pose: 'stand', look: look(ag ? ag.id : r.lock.label), hammer: true });
      }
      r.queue.slice(0, 4).forEach((q, i) => out.push({ key: 'q:' + (q.agent ? q.agent.id : i), x: r.x + 12 + i * 11, fy, pose: 'stand', look: look(q.agent ? q.agent.id : q.label), small: true }));
    } else if (r.kind === 'sujets') {
      const beds = Math.max(1, Math.floor((r.w - 8) / 28));
      r.beds = beds;
      r.more = r.sleep.length > beds ? `+${r.sleep.length - beds}` : '';
      r.sleep.slice(0, beds).forEach((z, i) => out.push({ key: 'z:' + z.id, x: r.x + 6 + i * 28, fy, pose: 'bed', look: look(z.id, z.kind === 'feature' ? '#c45d93' : '#4f86c6'), mark: i % 2 ? '' : 'z' }));
    }
  }

  // ---------- dessin ----------
  let ctx = null;
  const px = (x, y, w, hh, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh)); };
  function night() { return document.documentElement.dataset.theme !== 'clair'; }
  const WALLS = { session: ['#c9b48f', '#b49d76'], chef: ['#b7a07a', '#9e8762'], conseil: ['#8f7aa8', '#7a6593'], forge: ['#8a6f5c', '#6f5646'],
    sujets: ['#6f86a8', '#5b7092'], taches: ['#a9b07f', '#929a69'], skills: ['#a07e5e', '#8a6a4c'], agents: ['#7f97a0', '#6a818a'],
    docs: ['#b3a58a', '#9c8e73'], git: ['#6f8a7a', '#5a7465'], sauvegarde: ['#8a8f99', '#747a84'], vide: ['#9aa0a8', '#858b93'], couloir: ['#6b6f76', '#5c6067'] };

  function sky(SH, t) {
    const g = ctx.createLinearGradient(0, 0, 0, SH);
    if (night()) { g.addColorStop(0, '#070b18'); g.addColorStop(1, '#18213b'); } else { g.addColorStop(0, '#7db7f0'); g.addColorStop(1, '#cfe6fb'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SW, SH);
    if (night()) {
      for (let i = 0; i < 70; i++) {
        const x = hash('sx' + i) % SW, y = hash('sy' + i) % (SH - GROUND);
        const tw = calm ? 1 : (Math.sin(t * 1.3 + i) + 1) / 2;
        px(x, y, 1, 1, `rgba(220,230,255,${0.25 + 0.55 * tw})`);
      }
      px(SW - 40, 10, 8, 8, '#e8e4c8'); px(SW - 37, 10, 5, 5, '#070b18'); // la lune
    } else {
      for (let i = 0; i < 5; i++) {
        const x = ((hash('cx' + i) % SW) + (calm ? 0 : t * (2 + i % 3))) % (SW + 40) - 30, y = 6 + (hash('cy' + i) % (SH * 0.6));
        px(x, y, 22, 4, 'rgba(255,255,255,.85)'); px(x + 5, y - 3, 12, 3, 'rgba(255,255,255,.85)');
      }
    }
  }
  function tower(L, t) {
    const top = ROOF - 10, bottom = ROOF + L.floors * FH;
    // facade
    px(MX, top, SW - MX * 2, bottom - top, night() ? '#2a2f3a' : '#59606d');
    // toit : parapet, enseigne, antenne
    px(MX - 2, top - 3, SW - MX * 2 + 4, 4, night() ? '#3a4150' : '#6d7583');
    const sx = SW / 2 - 70;
    px(sx, 8, 140, 18, '#1b1f27'); px(sx + 1, 9, 138, 16, '#232a36');
    px(sx + 20, 26, 3, top - 26, '#3a4150'); px(sx + 117, 26, 3, top - 26, '#3a4150');
    const ax = SW - MX - 30;
    px(ax, 2, 2, top - 2, '#4b5262'); px(ax - 4, 10, 10, 1, '#4b5262'); px(ax - 3, 16, 8, 1, '#4b5262');
    const blink = calm || Math.floor(t * 1.2) % 2 === 0;
    px(ax - 1, 0, 4, 3, L.connected ? (blink ? '#ff4d4d' : '#6b2222') : '#555');
    // ascenseur
    const shx = MX + WALL;
    px(shx, ROOF, SHAFT, bottom - ROOF, '#14171d');
    px(shx + SHAFT / 2 - 1, ROOF, 1, bottom - ROOF, '#2c313b'); px(shx + SHAFT / 2 + 1, ROOF, 1, bottom - ROOF, '#2c313b');
    const nf = L.floors, cyc = calm ? 0 : t / 5;
    const fA = Math.floor(cyc) % nf, fB = (Math.floor(cyc) + 1) % nf, k = Math.min(1, (cyc % 1) * 2.5);
    const ease = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const cy = ROOF + (fA + (fB - fA) * ease) * FH + RH - 26;
    px(shx + 2, cy, SHAFT - 4, 26, '#8b93a3'); px(shx + 4, cy + 3, SHAFT - 8, 20, '#c9d1de'); px(shx + SHAFT / 2, cy + 3, 1, 20, '#8b93a3');
    // dalles entre les etages
    for (let i = 0; i <= L.floors; i++) px(MX, ROOF + i * FH - SLAB, SW - MX * 2, SLAB, night() ? '#3d4452' : '#7a8290');
    // le sol, la porte d'entree
    px(0, bottom, SW, GROUND, night() ? '#1d2a1f' : '#5d8a4f');
    px(0, bottom, SW, 3, night() ? '#2d3b2f' : '#76a463');
    px(shx + 3, bottom - 2, SHAFT - 6, 2, '#c9a24a');
  }
  function lamp(r, on) {
    const cx = r.x + Math.round(r.w / 2);
    px(cx - 4, r.y, 8, 2, '#3a3f48');
    px(cx - 3, r.y + 2, 6, 2, on ? '#ffe9a8' : '#6b6f76');
    if (on) {
      const g = ctx.createRadialGradient(cx, r.y + 4, 2, cx, r.y + 20, r.w * 0.7);
      g.addColorStop(0, 'rgba(255,230,160,.28)'); g.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, RH);
    }
  }
  function roomShell(r) {
    const [wa, wb] = WALLS[r.kind] || WALLS.session;
    px(r.x, r.y, r.w, RH, wa);
    for (let yy = r.y + 6; yy < r.y + RH - 16; yy += 8) px(r.x, yy, r.w, 1, wb); // papier peint a rayures
    px(r.x, r.y + RH - 16, r.w, 12, wb); // soubassement
    px(r.x, r.y + RH - 16, r.w, 1, 'rgba(0,0,0,.18)');
    px(r.x, r.y + RH - 4, r.w, 4, '#6b4a2f'); // parquet
    for (let xx = r.x + (hash(r.key) % 9); xx < r.x + r.w; xx += 9) px(xx, r.y + RH - 4, 1, 4, '#5a3d26');
    px(r.x + r.w, r.y, WALL, RH, night() ? '#2a2f3a' : '#59606d');
  }
  function desk(x, fy, w, screen, t) {
    px(x, fy - 10, w, 2, '#7a5634'); px(x + 1, fy - 8, 2, 8, '#5d4127'); px(x + w - 3, fy - 8, 2, 8, '#5d4127');
    px(x + 3, fy - 8, w - 6, 4, '#6a4a2d');
    const mx = x + 2; // l'ecran a gauche, l'agent a cote
    px(mx + 5, fy - 12, 2, 2, '#2b2f36'); px(mx, fy - 21, 12, 9, '#2b2f36');
    const col = screen === 'on' ? '#4aa3ff' : screen === 'ko' ? '#d94a4a' : screen === 'wait' ? '#f0c040' : '#20242b';
    px(mx + 1, fy - 20, 10, 7, col);
    if (screen === 'on') for (let i = 0; i < 3; i++) px(mx + 2, fy - 19 + i * 2, 2 + ((hash(i + '') + Math.floor(t * 4) * (i + 1)) % 7), 1, '#d6ecff');
  }
  function sofa(x, fy, w, col = '#8a3b3b') {
    px(x, fy - 12, w, 6, col); px(x, fy - 6, w, 5, shade(col, -20)); px(x - 2, fy - 9, 3, 8, shade(col, -30)); px(x + w - 1, fy - 9, 3, 8, shade(col, -30));
    px(x + 1, fy - 1, 2, 1, '#2a1d14'); px(x + w - 3, fy - 1, 2, 1, '#2a1d14');
  }
  function plant(x, fy) { px(x, fy - 5, 6, 5, '#9a5b3a'); px(x - 1, fy - 11, 8, 6, '#3f8f4f'); px(x + 1, fy - 14, 4, 3, '#53a862'); }
  function table(x, fy, w) { px(x, fy - 8, w, 2, '#8a6440'); px(x + w / 2 - 1, fy - 6, 2, 6, '#5d4127'); px(x + w / 2 - 4, fy - 1, 8, 1, '#5d4127'); }
  function shade(hex, d) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, v + d));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  function shelf(x, y, w, rows, books) {
    px(x, y, w, rows * 9 + 2, '#5d4127');
    let k = 0;
    for (let r = 0; r < rows; r++) {
      px(x + 1, y + 1 + r * 9, w - 2, 8, '#3a2818');
      for (let bx = x + 2; bx < x + w - 3 && k < books.length; bx += 3, k++) px(bx, y + 2 + r * 9 + (k % 3 === 0 ? 1 : 0), 2, 7 - (k % 3 === 0 ? 1 : 0), books[k]);
    }
    return k;
  }

  function drawRoom(r, t, L) {
    roomShell(r);
    const fy = r.y + RH - 4;
    let lit = true;
    if (r.kind === 'session') {
      const a = r.a;
      desk(r.x + 6, fy, 22, a.st === 'working' ? 'on' : a.st === 'waiting' ? 'wait' : a.error && a.st !== 'idle' ? 'ko' : 'off', t);
      table(r.x + Math.round(r.w * 0.56) - 7, fy, 14);
      sofa(r.x + r.w - 26, fy, 22, pick(['#8a3b3b', '#3b5f8a', '#4f7a3b', '#7a5a2f'], a.id));
      if (r.w > 90) plant(r.x + r.w - 34, fy);
      lit = a.st !== 'silent' && a.st !== 'ready';
    } else if (r.kind === 'chef') {
      // le tableau des envois : un post-it par demande confiee
      px(r.x + 50, r.y + 10, Math.min(60, r.w - 58), 22, '#e9e6dc'); px(r.x + 50, r.y + 10, Math.min(60, r.w - 58), 1, '#9a978e');
      r.envois.slice(0, 10).forEach((e, i) => px(r.x + 53 + (i % 5) * 11, r.y + 13 + Math.floor(i / 5) * 9, 8, 7,
        e.status === 'proposé' ? '#f0c040' : e.status === 'envoyé' ? '#6ea8fe' : '#7fd19b'));
      desk(r.x + 10, fy, 28, r.a && r.a.st === 'working' ? 'on' : r.a && r.a.st === 'waiting' ? 'wait' : 'off', t);
      plant(r.x + r.w - 12, fy);
      lit = !!r.a;
    } else if (r.kind === 'conseil') {
      const x0 = r.x + 14, w = r.w - 40;
      for (let i = 0; i < 5; i++) { const cx = r.x + 22 + i * Math.max(12, Math.floor((r.w - 56) / 4)); px(cx - 3, fy - 14, 6, 8, '#4a3560'); }
      px(x0, fy - 9, w, 3, '#5d3f7a'); px(x0 + 2, fy - 6, 2, 6, '#3f2a55'); px(x0 + w - 4, fy - 6, 2, 6, '#3f2a55');
      if (r.run && !r.live && r.run.decision) { px(x0 + w / 2 - 4, fy - 11, 8, 2, '#f1ead2'); }
      // vitrail
      px(r.x + r.w / 2 - 8, r.y + 8, 16, 18, '#2f2440');
      px(r.x + r.w / 2 - 7, r.y + 9, 7, 8, '#b48ee8'); px(r.x + r.w / 2 + 1, r.y + 9, 6, 8, '#6ea8fe'); px(r.x + r.w / 2 - 7, r.y + 18, 14, 7, '#f0c040');
      lit = r.live;
    } else if (r.kind === 'forge') {
      const fx = r.x + r.w - 26;
      px(fx, fy - 30, 22, 30, '#6a3b2a');
      for (let yy = fy - 28; yy < fy; yy += 4) px(fx, yy, 22, 1, '#55301f');
      px(fx + 4, fy - 16, 14, 12, '#1d1210');
      const heat = r.lock ? 0.6 + 0.4 * Math.abs(Math.sin(t * 3)) : 0.25;
      px(fx + 5, fy - 15, 12, 11, `rgba(255,${Math.round(120 + 80 * heat)},40,${heat})`);
      px(fx + 6, fy - 46, 10, 16, '#4a2a1f');
      // l'enclume
      px(r.x + r.w - 58, fy - 9, 14, 3, '#3c4048'); px(r.x + r.w - 54, fy - 6, 6, 6, '#2c3038');
      // le voyant du dernier build
      const lc = !r.last ? '#6b6f76' : r.last.ok ? '#5bc28a' : '#ff6b6b';
      px(r.x + 6, r.y + 6, 6, 6, '#2b2f36'); px(r.x + 7, r.y + 7, 4, 4, lc);
      if (r.lock) { const g = ctx.createRadialGradient(fx + 11, fy - 10, 2, fx + 11, fy - 10, 40); g.addColorStop(0, 'rgba(255,140,40,.35)'); g.addColorStop(1, 'rgba(255,140,40,0)'); ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, RH); }
      lit = !!r.lock || !!r.queue.length;
    } else if (r.kind === 'sujets') {
      for (let i = 0; i < (r.beds || 1); i++) {
        const bx = r.x + 4 + i * 28;
        px(bx, fy - 6, 24, 4, '#7a5634'); px(bx, fy - 12, 2, 12, '#5d4127'); px(bx + 22, fy - 9, 2, 9, '#5d4127'); px(bx + 2, fy - 2, 1, 2, '#5d4127');
        px(bx + 2, fy - 9, 20, 3, '#d9d4c7');
      }
      lit = false;
    } else if (r.kind === 'taches') {
      const w = r.w - 16;
      px(r.x + 8, r.y + 8, w, 26, '#9a6b3e'); px(r.x + 9, r.y + 9, w - 2, 24, '#c49a62');
      r.tasks.slice(0, 12).forEach((tk, i) => px(r.x + 11 + (i % 4) * Math.floor((w - 6) / 4), r.y + 11 + Math.floor(i / 4) * 7, 7, 5, tk.readonly ? '#f1ead2' : '#ffe08a'));
      table(r.x + r.w / 2 - 8, fy, 16);
      lit = false;
    } else if (r.kind === 'skills') {
      const books = r.skills.map(s => (s.issues || []).some(i => i.level === 'ko') ? '#d94a4a' : pick(['#4f86c6', '#5aa469', '#d0913c', '#9a6fc4', '#3fa3a3', '#c9b06a'], s.id || s.name));
      const w = Math.floor((r.w - 12) / 2);
      const k = shelf(r.x + 4, r.y + 10, w, 4, books);
      shelf(r.x + 8 + w, r.y + 10, w, 4, books.slice(k));
      lit = r.skills.some(s => s.lastAt && Date.now() - s.lastAt < 3600000);
    } else if (r.kind === 'agents') {
      const n = Math.max(1, Math.floor((r.w - 6) / 8));
      for (let i = 0; i < n; i++) {
        const ag = r.roster[i];
        const x = r.x + 4 + i * 8;
        const on = ag && r.busy.has(ag.call || ag.name);
        px(x, fy - 30, 7, 30, ag ? (on ? '#4a7fd0' : '#6d7a86') : '#555b63');
        px(x + 1, fy - 28, 5, 1, '#3a434c'); px(x + 1, fy - 26, 5, 1, '#3a434c');
        px(x + 5, fy - 16, 1, 3, '#c9d1de');
        if (ag && ag.status === 'warn') px(x + 2, fy - 22, 3, 3, '#f0a73a');
        if (on) px(x + 2, fy - 8, 3, 2, '#bfe0ff');
      }
      r.more = r.roster.length > n ? `+${r.roster.length - n}` : '';
      lit = r.busy.size > 0;
    } else if (r.kind === 'docs') {
      for (let i = 0; i < 2; i++) { const x = r.x + 4 + i * 14; px(x, fy - 26, 12, 26, '#7d8590'); for (let d = 0; d < 3; d++) { px(x + 1, fy - 25 + d * 8, 10, 7, '#9aa3ae'); px(x + 5, fy - 22 + d * 8, 3, 1, '#4b5262'); } }
      table(r.x + r.w - 26, fy, 20);
      const pile = r.debts && r.debts.length ? '#ff8f8f' : '#f1ead2';
      for (let i = 0; i < 4; i++) px(r.x + r.w - 23 + (i % 2), fy - 9 - i * 2, 12, 2, pile);
      lit = !!(r.debts && r.debts.length);
    } else if (r.kind === 'git') {
      // le graphe des branches au mur
      const gx = r.x + 6, gy = r.y + 10, gw = r.w - 30;
      px(gx - 1, gy - 2, gw + 2, 24, '#203028');
      px(gx, gy + 4, gw, 1, '#6ea8fe');
      px(gx + 10, gy + 10, gw - 22, 1, '#5bc28a'); px(gx + 10, gy + 5, 1, 5, '#5bc28a'); px(gx + gw - 12, gy + 5, 1, 5, '#5bc28a');
      px(gx + 20, gy + 16, gw - 40, 1, '#f0a73a'); px(gx + 20, gy + 11, 1, 5, '#f0a73a');
      for (let i = 0; i < 5; i++) px(gx + 2 + i * Math.floor(gw / 5), gy + 3, 3, 3, '#cfe0ff');
      // la baie de serveurs
      const sx = r.x + r.w - 20;
      px(sx, fy - 34, 16, 34, '#22262d');
      for (let i = 0; i < 5; i++) {
        px(sx + 2, fy - 32 + i * 6, 12, 4, '#2f343c');
        const on = calm || (Math.floor(t * 3 + i * 1.7) % 3) !== 0;
        px(sx + 3, fy - 31 + i * 6, 2, 2, r.ko && i === 0 ? '#ff4d4d' : on ? '#5bc28a' : '#24402f');
      }
    } else if (r.kind === 'sauvegarde') {
      const cx = r.x + Math.round(r.w / 2) - 4, cy = fy - 22;
      px(cx - 16, cy - 16, 32, 34, '#5c616b'); px(cx - 14, cy - 14, 28, 30, '#7d838e');
      ctx.fillStyle = '#9aa1ad'; ctx.beginPath(); ctx.arc(cx, cy + 1, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5c616b'; ctx.beginPath(); ctx.arc(cx, cy + 1, 4, 0, Math.PI * 2); ctx.fill();
      const ang = calm ? 0 : t * (r.busy ? 3 : 0.6);
      px(cx + Math.cos(ang) * 7 - 1, cy + 1 + Math.sin(ang) * 7 - 1, 2, 2, '#3a3f48');
      px(r.x + r.w - 12, r.y + 6, 6, 6, '#2b2f36'); px(r.x + r.w - 11, r.y + 7, 4, 4, r.ko ? '#ff6b6b' : r.busy ? '#6ea8fe' : r.none ? '#6b6f76' : '#5bc28a');
      for (let i = 0; i < 3; i++) px(r.x + 4 + i * 2, fy - 8 - i * 7, 12, 7, i % 2 ? '#a07e5e' : '#8a6a4c');
    } else if (r.kind === 'couloir') {
      plant(r.x + Math.round(r.w / 2) - 3, fy);
      lit = false;
    } else if (r.kind === 'vide') {
      desk(r.x + 30, fy, 26, 'off', t); sofa(r.x + r.w - 60, fy, 26);
      lit = false;
    }
    lamp(r, lit);
    if (!lit) px(r.x, r.y, r.w, RH, night() ? 'rgba(4,8,20,.45)' : 'rgba(30,40,60,.18)');
  }

  // un personnage, debout, assis, couche ou en marche ; x est le milieu, fy le sol
  function person(p, t) {
    const L = p.look, s = p.small ? 1 : 1;
    const bob = calm ? 0 : (p.pose === 'stand' && !p.walking ? (Math.floor(t * 2 + hash(p.key) % 7) % 2) : 0);
    if (p.pose === 'bed') {
      const x = Math.round(p.x), y = p.fy - 9;
      px(x + 2, y - 4, 5, 5, L.skin); px(x + 2, y - 4, 5, 2, L.hair); px(x + 3, y - 1, 1, 1, '#2a1d14');
      px(x + 7, y - 3, 15, 4, L.shirt); px(x + 7, y - 3, 15, 1, shade(L.shirt, 25));
      return;
    }
    const seated = p.pose === 'sit' || p.pose === 'sofa';
    const lift = p.pose === 'sofa' ? 7 : p.pose === 'sit' ? 6 : 0;
    const H = p.small ? 12 : 14;
    const x = Math.round(p.x) - 4;
    const top = Math.round(p.fy) - H - lift + (seated ? 3 : 0) - bob;
    // tete
    px(x + 1, top, 6, 2, L.hair); px(x + 1, top + 2, 6, 3, L.skin); px(x + 1, top + 2, 1, 2, L.hair); px(x + 6, top + 2, 1, 1, L.hair);
    const blinkEye = !calm && (Math.floor(t * 3 + hash(p.key) % 11) % 17 === 0);
    if (p.mark !== 'z' && !blinkEye) { px(x + 2, top + 3, 1, 1, '#1d1d24'); px(x + 5, top + 3, 1, 1, '#1d1d24'); }
    else px(x + 2, top + 3, 4, 1, shade(L.skin, -40));
    // corps et bras
    const bodyH = p.small ? 4 : 5;
    px(x + 1, top + 5, 6, bodyH, L.shirt);
    if (p.chef) { px(x + 4, top + 5, 1, 3, '#7a1f1f'); }
    const armY = top + 5;
    const typing = p.typing && !calm ? Math.floor(t * 8 + hash(p.key) % 3) % 2 : 0;
    const hammer = p.hammer && !calm ? Math.floor(t * 4) % 2 : 0;
    px(x, armY + typing, 1, bodyH - 1, shade(L.shirt, -25)); px(x + 7, armY + (typing ? 0 : 1) - hammer * 3, 1, bodyH - 1, shade(L.shirt, -25));
    px(x, armY + bodyH - 1 + typing, 1, 1, L.skin); px(x + 7, armY + bodyH - (typing ? 1 : 0) - hammer * 3, 1, 1, L.skin);
    if (p.hammer) { px(x + 8, armY - 3 - hammer * 3, 1, 5, '#6a4a2d'); px(x + 7, armY - 4 - hammer * 3, 3, 2, '#9aa1ad'); if (hammer === 0 && !calm) px(x + 9, armY + 1, 1, 1, '#ffcf5a'); }
    // jambes
    const ly = top + 5 + bodyH;
    if (seated) px(x + 1, ly, 6, 2, L.pants);
    else {
      const step = p.walking && !calm ? Math.floor(t * 8) % 2 : 0;
      const legH = Math.round(p.fy) - ly + (bob ? 0 : 0) - 1 + bob;
      px(x + 1, ly, 6, 1, L.pants);
      px(x + 1, ly + 1, 2, legH - 1 - step, L.pants); px(x + 5, ly + 1, 2, legH - 1 - (1 - step) * (p.walking ? 1 : 0), L.pants);
      px(x + 1, Math.round(p.fy) - 1 - step, 2, 1, '#1d1d24'); px(x + 5, Math.round(p.fy) - 1 - (p.walking ? 1 - step : 0), 2, 1, '#1d1d24');
    }
    if (p.mark) mark(p.mark, x + 4, top - 2, t, p.key);
    if (p.talk != null && !calm && Math.floor(t * 1.5 + p.talk * 1.3) % 4 === 0) { px(x + 8, top - 4, 5, 3, '#f4f1e8'); px(x + 9, top - 1, 1, 1, '#f4f1e8'); }
  }
  // ce qui flotte au-dessus d'une tete
  function mark(kind, cx, y, t, key) {
    const up = calm ? 0 : Math.floor(t * 2.5) % 2;
    if (kind === '!') {
      px(cx - 3, y - 10 - up, 7, 9, '#f0c040'); px(cx - 2, y - 11 - up, 5, 1, '#f0c040'); px(cx - 2, y - 1 - up, 5, 1, '#f0c040');
      px(cx, y - 9 - up, 1, 4, '#1d1406'); px(cx, y - 4 - up, 1, 1, '#1d1406');
    } else if (kind === 'ok') {
      px(cx - 3, y - 9, 7, 7, '#5bc28a'); px(cx - 2, y - 6, 1, 1, '#fff'); px(cx - 1, y - 5, 1, 1, '#fff'); px(cx, y - 6, 1, 1, '#fff'); px(cx + 1, y - 7, 1, 1, '#fff');
    } else if (kind === 'z') {
      const k = calm ? 0 : (t * 0.8 + (hash(key) % 10) / 10) % 1;
      const zx = cx + 3 + Math.round(k * 4), zy = y - 3 - Math.round(k * 8);
      const c = `rgba(190,215,255,${1 - k * 0.7})`;
      px(zx, zy, 3, 1, c); px(zx + 1, zy + 1, 1, 1, c); px(zx, zy + 2, 3, 1, c);
    } else if (kind === '…') {
      px(cx - 4, y - 7, 9, 5, '#f4f1e8'); for (let i = 0; i < 3; i++) if (calm || Math.floor(t * 3) % 3 >= i) px(cx - 3 + i * 3, y - 5, 1, 1, '#4a3560');
    }
  }

  // ---------- la boucle ----------
  const V = { open: false, L: null, pos: new Map(), raf: 0, last: 0, M: null };
  let G = null;
  function frame(now) {
    V.raf = 0;
    if (!V.open || !V.L) return;
    if (!calm) V.raf = requestAnimationFrame(frame);
    if (now - V.last < 80 && !calm) return; // une douzaine d'images par seconde : l'allure du pixel art
    V.last = now;
    const t = now / 1000;
    const L = V.L;
    ctx.clearRect(0, 0, SW, L.SH);
    sky(L.SH, t);
    tower(L, t);
    for (const r of L.rooms) drawRoom(r, t, L);
    // les personnages marchent vers leur place ; derriere la table d'abord
    const seen = new Set();
    const list = [...L.actors].sort((a, b) => (b.behind ? 1 : 0) - (a.behind ? 1 : 0));
    for (const p of list) {
      seen.add(p.key);
      let cur = V.pos.get(p.key);
      if (!cur || cur.fy !== p.fy || calm || Math.abs(cur.x - p.x) > 80) cur = { x: p.x, fy: p.fy };
      const d = p.x - cur.x;
      const walking = Math.abs(d) > 0.6;
      if (walking) cur.x += Math.sign(d) * Math.min(Math.abs(d), 1.6);
      V.pos.set(p.key, cur);
      person({ ...p, x: cur.x, pose: walking ? 'stand' : p.pose, walking, mark: walking ? '' : p.mark, typing: !walking && p.typing }, t);
      // devant le bureau, le dossier de la chaise
      if (p.pose === 'sit' && !walking) px(Math.round(cur.x) - 5, p.fy - 7, 10, 2, '#3a3f48');
    }
    for (const k of V.pos.keys()) if (!seen.has(k)) V.pos.delete(k);
  }
  function kick() { if (V.open && !V.raf) V.raf = requestAnimationFrame(frame); }

  // ---------- la page : la scene, une etiquette par salle, une bulle d'aide ----------
  function build() {
    G = {};
    G.canvas = h('canvas', { class: 'vu-canvas', width: SW, height: 400, 'aria-hidden': 'true' });
    ctx = G.canvas.getContext('2d');
    G.hits = h('div', { class: 'vu-hits' });
    G.sign = h('div', { class: 'vu-sign', 'aria-hidden': 'true' }, 'ALKATRAZZ TOWER');
    G.scene = h('div', { class: 'vu-scene' }, G.canvas, G.sign, G.hits);
    G.tip = h('div', { class: 'vu-tip', role: 'status', hidden: true });
    G.close = h('button', { type: 'button', class: 'us-btn vu-x', onclick: () => close(), title: 'Échap' }, 'Fermer');
    G.legend = h('ul', { class: 'vu-legend', 'aria-label': 'Légende' },
      h('li', null, h('i', { class: 'vu-k vu-k-blue' }), 'au bureau : travaille'),
      h('li', null, h('i', { class: 'vu-k vu-k-warn' }), '« ! » : t\'attend'),
      h('li', null, h('i', { class: 'vu-k vu-k-ok' }), 'sur le canapé : a fini'),
      h('li', null, h('i', { class: 'vu-k vu-k-grey' }), '« z » : silencieux ou en sommeil'));
    G.count = h('span', { class: 'vu-count' });
    G.box = h('div', { class: 'vu', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'La tour en direct' },
      h('header', { class: 'vu-head' }, h('h2', null, 'La tour en direct'), G.count, G.legend, G.close),
      h('div', { class: 'vu-stage' }, G.scene),
      h('p', { class: 'vu-foot' }, 'Clique une salle pour ouvrir sa conversation ou sa fiche.'),
      G.tip);
    document.body.append(G.box);
    G.box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { // le focus reste dans la vue
        const f = [...G.box.querySelectorAll('button')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    window.addEventListener('resize', fit);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  }
  // la scene garde ses proportions et prend toute la place possible
  function fit() {
    if (!G || !V.L) return;
    const st = G.box.querySelector('.vu-stage');
    const r = st.getBoundingClientRect();
    const k = Math.max(0.6, Math.min((r.width - 8) / SW, (r.height - 8) / V.L.SH));
    G.scene.style.width = `${Math.floor(SW * k)}px`;
    G.scene.style.height = `${Math.floor(V.L.SH * k)}px`;
    G.scene.style.setProperty('--vu-k', k.toFixed(3));
  }
  const pct = (v, total) => `${(100 * v / total).toFixed(3)}%`;
  function hitsFor(L) {
    const old = new Map([...G.hits.children].map(b => [b.dataset.key, b]));
    const keep = [];
    for (const r of L.rooms) {
      if (r.kind === 'couloir') continue;
      let b = old.get(r.key);
      if (!b) {
        b = h('button', { type: 'button', class: 'vu-room', 'data-key': r.key }, h('span', { class: 'vu-plaque' }), h('span', { class: 'vu-more' }));
        b.addEventListener('click', () => { const room = V.L.rooms.find(x => x.key === b.dataset.key); if (room && room.open) { close(); room.open(); } });
        b.addEventListener('pointerenter', () => tipShow(b));
        b.addEventListener('pointerleave', tipHide);
        b.addEventListener('focus', () => tipShow(b));
        b.addEventListener('blur', tipHide);
      }
      Object.assign(b.style, { left: pct(r.x, SW), top: pct(r.y, L.SH), width: pct(r.w, SW), height: pct(RH, L.SH) });
      b.className = `vu-room${r.tone ? ' vu-t-' + r.tone : ''}${r.dim ? ' vu-dim' : ''}`;
      b.querySelector('.vu-plaque').textContent = r.title;
      b.querySelector('.vu-more').textContent = r.more || '';
      const lines = (r.tip || []).filter(Boolean);
      b.dataset.tip = JSON.stringify([r.title, ...lines]);
      b.setAttribute('aria-label', [r.title, ...lines].join('. '));
      keep.push(b);
    }
    G.hits.replaceChildren(...keep);
    if (G.tipFor && G.tip && !G.tip.hidden) { const b = keep.find(x => x.dataset.key === G.tipFor); if (b) tipShow(b); else tipHide(); }
  }
  function tipShow(b) {
    const [title, ...lines] = JSON.parse(b.dataset.tip || '[]');
    G.tipFor = b.dataset.key;
    G.tip.replaceChildren(h('b', null, title), ...lines.map(l => h('span', null, l)));
    G.tip.hidden = false;
    const r = b.getBoundingClientRect(), box = G.box.getBoundingClientRect(), tw = G.tip.offsetWidth, th = G.tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2 - box.left, y = r.bottom + 6 - box.top;
    if (y + th > box.height - 4) y = r.top - th - 6 - box.top;
    x = Math.max(6, Math.min(box.width - tw - 6, x));
    G.tip.style.left = `${Math.round(x)}px`;
    G.tip.style.top = `${Math.round(Math.max(6, y))}px`;
  }
  function tipHide() { if (G) { G.tip.hidden = true; G.tipFor = null; } }

  function update(M) {
    V.M = M;
    if (!V.open) return;
    const prevH = V.L ? V.L.SH : 0;
    V.L = layout(M);
    if (G.canvas.height !== V.L.SH) G.canvas.height = V.L.SH;
    G.sign.style.left = pct(SW / 2 - 70, SW); G.sign.style.top = pct(8, V.L.SH); G.sign.style.width = pct(140, SW); G.sign.style.height = pct(18, V.L.SH);
    const c = M.counts;
    G.count.textContent = [c.working && `${c.working} au travail`, c.waiting && `${c.waiting} t'attend${c.waiting > 1 ? 'ent' : ''}`, c.idle && `${c.idle} fini${c.idle > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'calme';
    hitsFor(V.L);
    if (prevH !== V.L.SH) fit();
    if (calm) { V.last = 0; frame(performance.now()); } else kick();
  }
  function open(M) {
    if (!G) build();
    V.open = true;
    store.set('appli.vue', 'ouverte');
    G.box.hidden = false;
    document.documentElement.classList.add('vu-on');
    const app = document.getElementById('app'); if (app) app.inert = true;
    V.back = document.activeElement;
    update(M || V.M || A.M);
    fit();
    G.close.focus({ preventScroll: true });
  }
  function close() {
    if (!V.open) return;
    V.open = false;
    store.set('appli.vue', '');
    tipHide();
    G.box.hidden = true;
    document.documentElement.classList.remove('vu-on');
    const app = document.getElementById('app'); if (app) app.inert = false;
    if (V.raf) cancelAnimationFrame(V.raf);
    V.raf = 0;
    if (V.back && document.contains(V.back)) V.back.focus({ preventScroll: true });
  }
  window.Vue = { open, close, update, get isOpen() { return V.open; }, wasOpen: () => store.get('appli.vue') === 'ouverte' };
})();
