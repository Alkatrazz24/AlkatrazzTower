'use strict';
// Revue v1 : la tour tient face aux requetes abimees, ne perd pas une reponse d'ali et garde un
// state.json illisible au lieu de l'ecraser.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = String(48000 + Math.floor(Math.random() * 900));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-robuste-'));
// Un state.json abime avant le demarrage : la tour doit le mettre de cote.
fs.writeFileSync(path.join(DATA, 'state.json'), '{"agents": {"A": tronque');
const env = { ...process.env, TOWER_PORT: PORT, TOWER_DATA: DATA };

function call(method, p, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json' } : {} }, (resp) => {
      let d = ''; resp.on('data', c => { d += c; }); resp.on('end', () => res({ code: resp.statusCode, body: d ? JSON.parse(d) : null }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

function raw(text) {
  return new Promise((res) => {
    const s = net.connect(Number(PORT), '127.0.0.1', () => s.end(text));
    let d = ''; s.on('data', c => { d += c; }); s.on('close', () => res(d)); s.on('error', () => res(d));
  });
}

let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await call('GET', '/api/health'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('serveur pas demarre');
});
test.after(() => server && server.kill());

test('un state.json illisible est garde a cote, pas ecrase', () => {
  const kept = fs.readdirSync(DATA).filter(f => f.startsWith('state.json.abime-'));
  assert.strictEqual(kept.length, 1);
  assert.match(fs.readFileSync(path.join(DATA, kept[0]), 'utf8'), /tronque/);
});

test('une adresse abimee ne fait pas tomber la tour', async () => {
  const r = await raw(`GET //[ HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`);
  assert.match(r, /^HTTP\/1\.1 400/);
  assert.strictEqual((await call('GET', '/api/health')).body.ok, true);
});

test('une reponse donnee entre deux attentes du hook n\'est pas perdue', async () => {
  const { body: { id } } = await call('POST', '/api/ask/open', { sessionId: 'R1', kind: 'permission', tool: 'Bash' });
  assert.ok(id);
  // Une premiere attente qui expire sans reponse...
  assert.deepStrictEqual((await call('POST', '/api/ask/wait', { id, timeoutMs: 200 })).body, { pending: true });
  // ...ali repond avant que le hook ne revienne...
  assert.strictEqual((await call('POST', '/api/ask/answer', { id, decision: 'allow' })).body.ok, true);
  await new Promise(r => setTimeout(r, 50));
  // ...et le hook la recoit quand meme.
  const st = (await call('POST', '/api/ask/wait', { id, timeoutMs: 200 })).body;
  assert.strictEqual(st.decision, 'allow');
});

test('un identifiant de session « __proto__ » est refuse', () => {
  const { TowerState } = require('../server/state');
  const s = new TowerState();
  assert.strictEqual(s.event({ session_id: '__proto__', hook_event_name: 'UserPromptSubmit' }), false);
  assert.strictEqual(s.openAsk({ sessionId: '__proto__', kind: 'permission' }), null);
  assert.strictEqual(s.editorState({ project: '__proto__' }), false);
  assert.strictEqual(({}).status, undefined);
  assert.strictEqual(Object.getPrototypeOf(s.agents), Object.prototype);
});

test('tower-run reste en ASCII', () => {
  const { ascii } = require('../bin/tower-run');
  assert.strictEqual(ascii('derrière Comète · fin…'), 'derriere Comete ? fin...');
});
