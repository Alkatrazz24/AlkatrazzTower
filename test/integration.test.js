'use strict';
// Lance un vrai serveur sur un port libre et deux tower-run en meme temps.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = String(47000 + Math.floor(Math.random() * 900));
const env = { ...process.env, TOWER_PORT: PORT, TOWER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'tower-test-')) };

function get(p) {
  return new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej));
}

function run(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'tower-run.js'), ...args], { env: { ...env, ...extraEnv } });
    let out = '';
    p.stdout.on('data', c => { out += c; });
    p.stderr.on('data', c => { out += c; });
    p.on('close', (code) => resolve({ code, out, end: Date.now() }));
  });
}

// Une "commande de build" portable : node qui attend puis ecrit un verdict UBT.
function fakeBuild(ms, code) {
  const js = `setTimeout(()=>{console.log('Result: ${code === 0 ? 'Succeeded' : 'Failed'}');process.exit(${code})},${ms})`;
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const cmd = shell === 'powershell' ? `& "${process.execPath}" -e "${js}"` : `"${process.execPath}" -e "${js}"`;
  return ['--shell', shell, '--kind', 'build', '--b64', Buffer.from(cmd).toString('base64')];
}

let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await get('/api/health'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('serveur pas demarre');
});
test.after(() => server && server.kill());

test('deux builds simultanes passent l\'un apres l\'autre', { timeout: 60_000 }, async () => {
  const t0 = Date.now();
  const first = run([...fakeBuild(2500, 0).slice(0, 4), '--session', 'AAA', ...fakeBuild(2500, 0).slice(4)]);
  await new Promise(r => setTimeout(r, 600));
  const second = run([...fakeBuild(500, 3).slice(0, 4), '--session', 'BBB', ...fakeBuild(500, 3).slice(4)]);
  const [a, b] = await Promise.all([first, second]);
  assert.strictEqual(a.code, 0);
  assert.strictEqual(b.code, 3, 'le code de sortie d\'origine est rendu');
  assert.match(b.out, /file d'attente, position 1/);
  assert.ok(b.end - a.end >= 400, 'le second finit apres le premier');
  assert.ok(b.end - t0 >= 3000, 'le second a attendu');
  const st = await get('/api/state');
  assert.strictEqual(st.lock, null);
  assert.strictEqual(st.builds.length, 2);
  const bb = st.builds.find(x => x.sessionId === 'BBB');
  assert.strictEqual(bb.ok, false);
  assert.ok(bb.waitMs > 1000);
});

test('tour eteinte : la commande part sans verrou', { timeout: 30_000 }, async () => {
  const r = await run(fakeBuild(100, 0), { TOWER_PORT: '1' });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /Result: Succeeded/);
});
