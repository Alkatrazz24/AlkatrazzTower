'use strict';
// Alkatrazz Tower -- serveur local. Aucune dependance npm.
//   node server/server.js            (port 4777, ou TOWER_PORT)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { TowerState } = require('./state');
const { Worker } = require('worker_threads');
const projectsLib = require('../lib/projects');

const PORT = Number(process.env.TOWER_PORT) || 4777;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.TOWER_DATA || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WEB = path.join(ROOT, 'web');

// Version de la page : change des qu'un fichier de web/ change. Une page restee ouverte (onglet de
// l'editeur Unreal, navigateur) la recoit a chaque connexion et se recharge quand elle differe.
function webVersion(dir = WEB) {
  const h = require('crypto').createHash('sha1');
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { try { const st = fs.statSync(f); h.update(`${path.relative(dir, f)}:${st.size}:${st.mtimeMs}\n`); } catch { /* fichier parti */ } }
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}
const WEB_VERSION = webVersion();
const WAIT_MS = 20_000;

const state = new TowerState();

// ---- persistance --------------------------------------------------------------------------------

try { state.load(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch { /* premier lancement */ }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state.toJSON()));
      fs.renameSync(tmp, STATE_FILE);
    } catch (e) { console.error('[tower] sauvegarde impossible :', e.message); }
  }, 1000);
}

// ---- flux en direct (SSE) -----------------------------------------------------------------------

const clients = new Set();
let pushTimer = null;
function pushAll() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const data = `data: ${JSON.stringify(state.snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  }, 100);
}

// Les tickets en attente de leur tour (long-poll /api/lock/wait).
const waiters = new Map(); // ticket -> [resolve]
function wakeWaiters() {
  for (const [ticket, list] of waiters) {
    const st = state.ticketStatus(ticket);
    if (st.granted || st.lost) {
      waiters.delete(ticket);
      for (const fn of list) fn(st);
    }
  }
}

state.onChange(() => { scheduleSave(); pushAll(); wakeWaiters(); });

// Victoire : on note le commit Git du projet, comme un point de sauvegarde.
state.onVictory = (c) => {
  const agent = Object.values(state.agents).find(a => a.project && a.project.name.toLowerCase() === c.project.toLowerCase());
  if (!agent) return;
  const root = agent.project.root;
  execFile('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { windowsHide: true, timeout: 5000 }, (err, sha) => {
    if (err) return;
    execFile('git', ['-C', root, 'status', '--porcelain'], { windowsHide: true, timeout: 10000 }, (err2, dirty) => {
      c.commit = { sha: String(sha).trim(), dirty: err2 ? null : String(dirty).split(/\r?\n/).filter(Boolean).length };
      state.changed();
    });
  });
};

// ---- sondes : editeur ouvert, verrous de domaine ------------------------------------------------

function probeEditor() {
  if (process.platform !== 'win32') return;
  execFile('tasklist', ['/FI', 'IMAGENAME eq UnrealEditor.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    if (err) return;
    const count = (String(out).match(/"UnrealEditor\.exe"/gi) || []).length;
    const was = state.editor;
    const plugin = Object.values(state.editors).some(e => Date.now() - e.lastSeen < 15_000);
    state.editor = { open: count > 0 || plugin, count: Math.max(count, plugin ? 1 : 0), checkedAt: Date.now(), plugin };
    if (was.open !== state.editor.open || was.count !== count) state.changed();
  });
}

function probeChantiers() {
  const roots = new Map();
  for (const a of Object.values(state.agents)) if (a.project) roots.set(a.project.name, a.project.root);
  for (const p of state.projects) roots.set(p.name, p.root);
  const next = {};
  for (const [name, root] of roots) {
    const dir = path.join(root, 'Saved', 'chantiers');
    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt')).map(f => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { file: f.replace(/\.txt$/i, ''), text: fs.readFileSync(p, 'utf8').slice(0, 400).trim(), mtime: st.mtimeMs };
      });
    } catch { /* pas de dossier chantiers */ }
    if (files.length) next[name] = files;
  }
  if (JSON.stringify(next) !== JSON.stringify(state.chantiers)) { state.chantiers = next; state.changed(); }
}

// ---- inventaire des projets pour la carte ----------------------------------------------------

const scanning = new Set();
function inventoryOf(project) {
  if (scanning.has(project.root)) return;
  scanning.add(project.root);
  const w = new Worker(`const { parentPort, workerData } = require('worker_threads');
    parentPort.postMessage(require(${JSON.stringify(path.join(ROOT, 'lib', 'inventory.js'))}).inventory(workerData));`, { eval: true, workerData: project });
  const done = () => scanning.delete(project.root);
  w.once('message', (inv) => { done(); state.inventories[project.name] = inv; state.changed(); });
  w.once('error', (e) => { done(); console.error('[tower] inventaire impossible :', e.message); });
  setTimeout(() => { w.terminate(); done(); }, 120_000).unref();
}
function knownProjects() {
  const m = new Map();
  for (const p of state.projects) m.set(p.root.toLowerCase(), p);
  for (const a of Object.values(state.agents)) {
    if (!a.project || m.has(a.project.root.toLowerCase())) continue;
    const p = projectsLib.resolve(a.project.root);
    if (p) m.set(p.root.toLowerCase(), p);
  }
  return [...m.values()];
}
const pendingInv = new Map();
function scheduleInventory(p) {
  if (pendingInv.has(p.root)) return;
  pendingInv.set(p.root, setTimeout(() => { pendingInv.delete(p.root); inventoryOf(p); }, 5000));
}
function refreshInventories(force) {
  for (const p of knownProjects()) {
    const inv = state.inventories[p.name];
    if (force || !inv || Date.now() - inv.scannedAt > 10 * 60_000 || inv.root !== p.root) inventoryOf(p);
  }
}
setInterval(() => refreshInventories(false), 60_000).unref();
setTimeout(() => refreshInventories(false), 1500).unref();

setInterval(() => { state.expire(); }, 2000).unref();
setInterval(probeEditor, 10_000).unref();
setInterval(probeChantiers, 10_000).unref();
probeEditor();
probeChantiers();

// ---- HTTP ---------------------------------------------------------------------------------------

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// Refuse les requetes venues d'une autre origine (une page web quelconque ouverte dans le navigateur).
function foreignOrigin(req) {
  const o = req.headers.origin;
  if (!o) return false;
  return !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// Tutos : scenarios joues sur la vraie tour et le vrai projet, sans rien y ecrire (lib/tuto.js).
const tuto = require('../lib/tuto').create(state, { projects: knownProjects });

// Taches pretes a lancer (lib/taches.js) et tokens lus dans le journal de chaque session (lib/usage.js).
const taches = require('../lib/taches').create(state);
const usage = require('../lib/usage');
const usageTimers = new Map();
function usageSoon(sid, ms = 2500) {
  const a = state.agents[sid];
  if (!a || !a.transcript || usageTimers.has(sid)) return;
  usageTimers.set(sid, setTimeout(async () => {
    usageTimers.delete(sid);
    const cur = state.agents[sid];
    if (!cur || !cur.transcript) return;
    const u = await usage.usageOf(cur.transcript, cur.model).catch(() => null);
    if (u && (!cur.usage || u.total !== cur.usage.total || u.context !== cur.usage.context)) state.setUsage(sid, u);
  }, ms));
}
// Au demarrage, on relit les journaux des sessions encore ouvertes.
for (const a of Object.values(state.agents)) if (a.status !== 'ended') usageSoon(a.sessionId, 4000);

function projectFor(name) {
  const all = knownProjects();
  return (name && all.find(p => p.name.toLowerCase() === String(name).toLowerCase())) || all.find(p => /ctb|conquer/i.test(p.name)) || all[0] || null;
}

const routes = {
  'GET /api/health': () => ({ ok: true, name: 'alkatrazz-tower', pid: process.pid }),
  'GET /api/state': () => state.snapshot(),

  'POST /api/event': (b) => { const ok = state.event(b); if (ok) usageSoon(String(b.session_id)); return { ok }; },

  'POST /api/lock/acquire': (b) => {
    const st = state.acquire({
      sessionId: b.sessionId, kind: b.kind, command: b.command, cwd: b.cwd, pid: b.pid,
      target: b.target, testFilter: b.testFilter,
    });
    // tower-run previent l'agent si l'editeur de ce projet est ouvert (Build.bat de la cible
    // Editeur echoue alors avec le code 6 quand Live Coding est actif).
    const project = b.cwd ? (require('../lib/detect').findProject(b.cwd) || {}).name : null;
    const ed = state.liveEditor(project);
    if (ed) st.editor = { open: true, liveCoding: ed.liveCoding, pie: ed.pie, dirty: ed.dirty, map: ed.map };
    return st;
  },
  'POST /api/lock/heartbeat': (b) => ({ ok: state.touch(b.ticket) }),
  'POST /api/lock/release': (b) => ({ ok: state.release(b.ticket, b.result || {}) }),
  'POST /api/lock/force-release': () => ({ ok: state.forceRelease() }),
  'POST /api/report': (b) => { state.report(b.entry || {}, b.result || {}); return { ok: true }; },
  'POST /api/agents/forget': (b) => ({ ok: state.forget(b.sessionId) }),

  // Personnages
  'GET /api/characters': () => Object.values(state.characters).map(c => ({
    ...c, agents: Object.values(state.agents).filter(a => a.characterId === c.id && a.status !== 'ended').map(a => a.sessionId),
  })),
  'POST /api/characters': (b) => ({ ok: true, character: state.createCharacter(b) }),
  'POST /api/characters/update': (b) => {
    const c = state.updateCharacter(b);
    return c ? { ok: true, character: c } : { ok: false, error: 'personnage introuvable (id, name ou sessionId)' };
  },
  'POST /api/characters/delete': (b) => ({ ok: state.deleteCharacter(b.id) }),
  'POST /api/agents/character': (b) => ({ ok: state.setAgentCharacter(b.sessionId, b.characterId) }),

  // Projets Unreal connectes
  'POST /api/projects/connect': (b) => {
    const p = projectsLib.resolve(b.uproject || b.path);
    if (!p) return { ok: false, error: 'aucun .uproject a cet endroit' };
    state.connectProject(p);
    inventoryOf(p);
    return { ok: true, project: p };
  },
  'POST /api/projects/disconnect': (b) => ({ ok: state.disconnectProject(b.uproject) }),
  'POST /api/inventory/refresh': () => { refreshInventories(true); return { ok: true }; },

  // Plugin Unreal (unreal/AlkatrazzTower)
  'POST /api/editor/state': (b) => ({ ok: state.editorState(b) }),
  'GET /api/editor/feed': (b, url) => state.editorFeed(url.searchParams.get('project')),
  'POST /api/editor/asset-opened': (b) => ({ ok: true, agents: state.agentsOnAsset(b.file, b.package) }),
  'POST /api/editor/assets-changed': (b) => {
    // Un asset ajoute, renomme, supprime ou sauvegarde : on recompte le projet (0,3 s) sous 5 s.
    const p = knownProjects().find(x => x.name.toLowerCase() === String(b.project || '').toLowerCase());
    if (p) scheduleInventory(p);
    const ed = state.editors[p ? p.name : b.project];
    if (ed && b.saved) { ed.lastSaved = { asset: String(b.saved).slice(0, 200), at: Date.now() }; state.changed(); }
    return { ok: !!p };
  },

  'POST /api/tasks/save': (b) => taches.save(b),
  'POST /api/tasks/delete': (b) => ({ ok: taches.remove(b.id) }),

  'GET /api/tuto': () => tuto.info(),
  'POST /api/tuto/start': (b) => tuto.start(b),
  'POST /api/tuto/answer': () => ({ ok: tuto.answer() }),
  'POST /api/tuto/clean': () => ({ ok: tuto.clean() }),

  'POST /api/campaigns': (b) => {
    try { return { ok: true, campaign: state.createCampaign(b) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
  'POST /api/campaigns/manual': (b) => ({ ok: state.manualProof(b.id, b.featureId, b.ok !== false) }),
  'POST /api/campaigns/archive': (b) => ({ ok: state.archiveCampaign(b.id) }),
  'POST /api/campaigns/delete': (b) => ({ ok: state.deleteCampaign(b.id) }),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const key = `${req.method} ${url.pathname}`;

  if (req.method === 'POST' && foreignOrigin(req)) return send(res, 403, { error: 'origine refusee' });

  if (key === 'GET /api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\nevent: version\ndata: ${JSON.stringify(WEB_VERSION)}\n\n`);
    res.write(`data: ${JSON.stringify(state.snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (key === 'POST /api/lock/wait') {
    const b = await readBody(req);
    if (!b || !b.ticket) return send(res, 400, { error: 'ticket manquant' });
    state.touch(b.ticket);
    const st = state.ticketStatus(b.ticket);
    if (st.granted || st.lost) return send(res, 200, st);
    let done = false;
    const finish = (s) => { if (done) return; done = true; clearTimeout(timer); send(res, 200, s); };
    const timer = setTimeout(() => {
      const list = waiters.get(b.ticket) || [];
      waiters.set(b.ticket, list.filter(f => f !== finish));
      finish(state.ticketStatus(b.ticket));
    }, Math.min(Number(b.timeoutMs) || WAIT_MS, WAIT_MS));
    const list = waiters.get(b.ticket) || [];
    list.push(finish);
    waiters.set(b.ticket, list);
    req.on('close', () => { if (!done) { done = true; clearTimeout(timer); } });
    return;
  }

  if (key === 'POST /api/tasks/launch') {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'JSON invalide' });
    const r = await taches.launch({ id: b.id, project: projectFor(b.project), background: !!b.background }).catch(e => ({ ok: false, error: e.message }));
    return send(res, 200, r);
  }

  if (key === 'GET /api/projects/scan') {
    const w = new Worker(`const { parentPort } = require('worker_threads');
      parentPort.postMessage(require(${JSON.stringify(path.join(ROOT, 'lib', 'projects.js'))}).scan());`, { eval: true });
    let done = false;
    const finish = (code, body) => { if (!done) { done = true; send(res, code, body); } };
    w.once('message', (m) => finish(200, m));
    w.once('error', (e) => finish(500, { error: e.message }));
    setTimeout(() => { w.terminate(); finish(200, { projects: [], complete: false }); }, 10_000).unref();
    return;
  }

  const route = routes[key];
  if (route) {
    const b = req.method === 'POST' ? await readBody(req) : {};
    if (b === null) return send(res, 400, { error: 'JSON invalide' });
    try { return send(res, 200, route(b, url)); } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) return send(res, 404, 'introuvable', 'text/plain');
    return fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'introuvable', 'text/plain');
      send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
    });
  }
  send(res, 404, { error: 'route inconnue' });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[tower] le port ${PORT} est deja pris : la tour tourne peut-etre deja (http://${HOST}:${PORT}).`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`[tower] Alkatrazz Tower en ecoute sur http://${HOST}:${PORT}`);
});

function shutdown() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state.toJSON()));
  } catch { /* tant pis */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, state };
