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

// Seule la page de la tour agit sur la tour : une autre page web ne peut ni repondre a une question
// a la place d'ali, ni autoriser une permission, ni lire l'etat par un domaine qui pointe sur 127.0.0.1.
function req(method, p, headers, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(data), ...headers } }, (x) => {
      let raw = ''; x.on('data', c => { raw += c; }); x.on('end', () => res({ status: x.statusCode, body: raw }));
    });
    r.on('error', rej);
    r.end(data);
  });
}

test('une autre page web ne peut pas repondre a la place d\'ali', async () => {
  const opened = JSON.parse((await req('POST', '/api/ask/open', {}, { sessionId: 'sec', kind: 'permission', tool: 'Bash', summary: 'rm -rf' })).body);
  assert.ok(opened.id);
  const answer = { id: opened.id, decision: 'allow' };
  for (const origin of ['https://site-malveillant.example', 'http://localhost:3000', 'http://127.0.0.1.evil.example:' + PORT, 'null']) {
    assert.strictEqual((await req('POST', '/api/ask/answer', { Origin: origin }, answer)).status, 403, origin);
  }
  assert.strictEqual((await req('GET', '/api/state', { Host: `evil.example:${PORT}` })).status, 403);
  assert.strictEqual((await req('POST', '/api/ask/answer', { Host: `evil.example:${PORT}` }, answer)).status, 403);
  // la page de la tour, elle, repond
  const ok = await req('POST', '/api/ask/answer', { Origin: `http://127.0.0.1:${PORT}` }, answer);
  assert.deepStrictEqual([ok.status, JSON.parse(ok.body).ok], [200, true]);
  assert.strictEqual((await req('GET', '/api/health', { Host: `localhost:${PORT}` })).status, 200);
});

// Le hook de la tour, comme Claude Code l'appelle : l'evenement en JSON sur stdin.
function hook(ev) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'hooks', 'tower-hook.js')], { env });
    let out = '';
    p.stdout.on('data', c => { out += c; });
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify(ev));
  });
}

test('doc obligatoire : le hook fait continuer la session qui a modifie le jeu sans doc', { timeout: 30_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-docjeu-'));
  fs.writeFileSync(path.join(root, 'Jeu.uproject'), JSON.stringify({ EngineAssociation: '5.8' }));
  const base = { session_id: 'doc-int', cwd: root };
  const start = await hook({ ...base, hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'ctb-son' });
  assert.match(JSON.parse(start.out).hookSpecificOutput.additionalContext, /doc obligatoire/);
  await hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'Source', 'Jeu', 'A.cpp') } });
  const stop = await hook({ ...base, hook_event_name: 'Stop' });
  assert.strictEqual(stop.code, 0);
  const out = JSON.parse(stop.out);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /Source\/Jeu\/A\.cpp/);
  // deuxieme fin (stop_hook_active) : la tour la laisse passer
  assert.strictEqual((await hook({ ...base, hook_event_name: 'Stop', stop_hook_active: true })).out, '');
  await hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(root, 'docs', 'A.md') } });
  assert.strictEqual((await hook({ ...base, hook_event_name: 'Stop' })).out, '');
});
