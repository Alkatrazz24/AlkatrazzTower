#!/usr/bin/env node
'use strict';
// tower-run -- lance une commande Unreal sous le verrou de la tour.
//
// Le hook y envoie les builds tout seul ; on peut aussi l'appeler a la main :
//   node bin/tower-run.js --shell powershell --kind build -- & "...\Build.bat" ...
//
// Si la tour ne repond pas, la commande part sans verrou : un build ne doit jamais rester bloque
// parce que la tour est eteinte. Le code de sortie rendu est celui de la commande.

const { spawn, execFile } = require('child_process');
const { post } = require('../lib/client');
const { parseOutput, testsFromAbslog, testsFromProjectLogs } = require('../lib/results');
const { findProject, buildTarget, testFilter } = require('../lib/detect');

const HEARTBEAT_MS = 5000;
const NOTICE_MS = 30_000;
const KEEP_BYTES = 4 * 1024 * 1024;

function parseArgs(argv) {
  const o = { shell: process.platform === 'win32' ? 'powershell' : 'bash', session: process.env.TOWER_SESSION || '', kind: 'build', cmd: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shell') o.shell = argv[++i];
    else if (a === '--session') o.session = argv[++i];
    else if (a === '--kind') o.kind = argv[++i];
    else if (a === '--b64') o.cmd = Buffer.from(argv[++i] || '', 'base64').toString('utf8');
    else if (a === '--') { o.cmd = argv.slice(i + 1).join(' '); break; }
  }
  return o;
}

function say(msg) { process.stdout.write(`[tour] ${msg}\n`); }

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function holderText(st) {
  if (!st || !st.holder) return '';
  return `, derriere ${st.holder.label} (${st.holder.kind}, depuis ${ago(Date.now() - st.holder.since)})`;
}

// Attend son tour. Renvoie le ticket, ou null pour lancer sans verrou.
async function takeLock(o) {
  const project = findProject(process.cwd());
  const req = {
    sessionId: o.session, kind: o.kind, command: o.cmd, cwd: process.cwd(), pid: process.pid,
    target: buildTarget(o.cmd, project && project.name), testFilter: testFilter(o.cmd),
  };
  let st = await post('/api/lock/acquire', req, 1500);
  if (!st) return null;
  if (st.granted) return st.ticket;

  say(`build en file d'attente, position ${st.position}${holderText(st)}. J'attends mon tour.`);
  const start = Date.now();
  let lastNotice = start, lastPos = st.position;
  for (;;) {
    const next = await post('/api/lock/wait', { ticket: st.ticket }, 25_000);
    if (!next) {
      say('la tour ne repond plus : je lance sans verrou.');
      return null;
    }
    if (next.granted) {
      say(`a mon tour apres ${ago(Date.now() - start)} d'attente.`);
      return next.ticket;
    }
    if (next.lost) {
      // Ticket perdu (tour redemarree, attente trop longue sans signe de vie) : on en reprend un.
      const again = await post('/api/lock/acquire', req, 1500);
      if (!again) { say('la tour ne repond plus : je lance sans verrou.'); return null; }
      if (again.granted) return again.ticket;
      st = again;
      continue;
    }
    const now = Date.now();
    if (next.position !== lastPos || now - lastNotice >= NOTICE_MS) {
      say(`toujours en file, position ${next.position}${holderText(next)}, attente ${ago(now - start)}.`);
      lastNotice = now;
      lastPos = next.position;
    }
  }
}

function spawnShell(o) {
  if (o.shell === 'powershell' || o.shell === 'pwsh') {
    const exe = process.env.TOWER_POWERSHELL || (o.shell === 'pwsh' ? 'pwsh.exe' : 'powershell.exe');
    // powershell -Command rend 1 pour tout echec, pas le code du programme : on rend nous-memes
    // celui du dernier programme natif (Build.bat, UnrealEditor-Cmd...), comme l'aurait vu l'agent.
    // Avec -EncodedCommand, PowerShell ecrit ses erreurs en CLIXML sur stderr : on les ramene en
    // texte simple nous-memes, et on coupe les barres de progression (meme raison).
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      '$__towerFail = $false',
      `& {\n${o.cmd}\n} 2>&1 | ForEach-Object {`,
      '  if ($_ -is [System.Management.Automation.ErrorRecord]) {',
      "    if ($_.FullyQualifiedErrorId -notlike 'NativeCommandError*') { $__towerFail = $true }",
      '    [Console]::Error.WriteLine($_.ToString())',
      '  } else { $_ }',
      '}',
      'if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } elseif ($__towerFail) { exit 1 } else { exit 0 }',
    ].join('\n');
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    return spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  }
  const exe = process.env.TOWER_BASH || 'bash';
  return spawn(exe, ['-c', o.cmd], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else try { child.kill('SIGTERM'); } catch { /* deja mort */ }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.cmd.trim()) { say('aucune commande a lancer.'); process.exit(2); }

  const ticket = process.env.TOWER_NO_LOCK === '1' ? null : await takeLock(o);

  let beat = null;
  if (ticket) {
    let warned = false;
    beat = setInterval(async () => {
      const r = await post('/api/lock/heartbeat', { ticket }, 2000);
      if (r && r.ok === false && !warned) { warned = true; say('verrou perdu (la tour a redemarre ?) : le build continue.'); }
    }, HEARTBEAT_MS);
  }

  const started = Date.now();
  const child = spawnShell(o);
  const chunks = [];
  let kept = 0;
  const keep = (buf) => {
    chunks.push(buf);
    kept += buf.length;
    while (kept > KEEP_BYTES && chunks.length > 1) kept -= chunks.shift().length;
  };
  child.stdout.on('data', (b) => { process.stdout.write(b); keep(b); });
  child.stderr.on('data', (b) => { process.stderr.write(b); keep(b); });

  const stop = () => { killTree(child); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);

  const code = await new Promise((resolve) => {
    child.on('error', (e) => { say(`impossible de lancer ${o.shell} : ${e.message}`); resolve(127); });
    child.on('close', (c) => resolve(c === null ? 1 : c));
  });
  if (beat) clearInterval(beat);

  const text = Buffer.concat(chunks).toString('latin1');
  const result = parseOutput(text, code, o.kind);
  // Les chemins des tests (pour les campagnes) sont dans le journal : -abslog, ou Saved/Logs du projet.
  if (!result.tests || !result.tests.passedPaths || !result.tests.passedPaths.length) {
    const project = findProject(process.cwd());
    const t = testsFromAbslog(o.cmd, started) || (o.kind === 'test' && project ? testsFromProjectLogs(project.root, started) : null);
    if (t) {
      const honest = !result.tests || result.tests.total === t.total;
      if (!result.tests) { result.ok = t.failed === 0; result.summary = `${t.passed}/${t.total} tests`; }
      if (honest) result.tests = t;
    }
  }
  result.durationMs = Date.now() - started;

  if (ticket) {
    const r = await post('/api/lock/release', { ticket, result }, 2000);
    say(`${r ? 'verrou rendu' : 'tour injoignable, verrou laisse a expirer'} - ${result.ok ? 'OK' : 'ECHEC'} - ${result.summary} - ${ago(result.durationMs)}`);
  }
  process.exit(code);
}

if (require.main === module) {
  main().catch((e) => { say(`erreur interne : ${e.message}`); process.exit(1); });
}

module.exports = { parseArgs };
