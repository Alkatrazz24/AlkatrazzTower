'use strict';
// Alkatrazz Tower -- serveur local. Aucune dependance npm.
//   node server/server.js            (port 4777, ou TOWER_PORT)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { TowerState } = require('./state');

const PORT = Number(process.env.TOWER_PORT) || 4777;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.TOWER_DATA || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WEB = path.join(ROOT, 'web');
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

// ---- sondes : editeur ouvert, verrous de domaine ------------------------------------------------

function probeEditor() {
  if (process.platform !== 'win32') return;
  execFile('tasklist', ['/FI', 'IMAGENAME eq UnrealEditor.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    if (err) return;
    const count = (String(out).match(/"UnrealEditor\.exe"/gi) || []).length;
    const was = state.editor;
    state.editor = { open: count > 0, count, checkedAt: Date.now() };
    if (was.open !== state.editor.open || was.count !== count) state.changed();
  });
}

function probeChantiers() {
  const roots = new Map();
  for (const a of Object.values(state.agents)) if (a.project) roots.set(a.project.name, a.project.root);
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const routes = {
  'GET /api/health': () => ({ ok: true, name: 'alkatrazz-tower', pid: process.pid }),
  'GET /api/state': () => state.snapshot(),

  'POST /api/event': (b) => ({ ok: state.event(b) }),

  'POST /api/lock/acquire': (b) => state.acquire({
    sessionId: b.sessionId, kind: b.kind, command: b.command, cwd: b.cwd, pid: b.pid,
  }),
  'POST /api/lock/heartbeat': (b) => ({ ok: state.touch(b.ticket) }),
  'POST /api/lock/release': (b) => ({ ok: state.release(b.ticket, b.result || {}) }),
  'POST /api/lock/force-release': () => ({ ok: state.forceRelease() }),
  'POST /api/report': (b) => { state.report(b.entry || {}, b.result || {}); return { ok: true }; },
  'POST /api/agents/forget': (b) => ({ ok: state.forget(b.sessionId) }),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const key = `${req.method} ${url.pathname}`;

  if (req.method === 'POST' && foreignOrigin(req)) return send(res, 403, { error: 'origine refusee' });

  if (key === 'GET /api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(state.snapshot())}\n\n`);
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
