'use strict';
// Lire le verdict d'un build, d'une suite de tests ou d'un paquet dans sa sortie.

const fs = require('fs');

// PowerShell lance par un autre processus avec 2>&1 sérialise ses flux Write-Host en CLIXML
// (« #< CLIXML <Objs ...><S S="Information">637 tests, 1 ECHEC(S)_x000D__x000A_</S>... »). On rend le texte.
function declixml(text) {
  const src = String(text || '');
  if (!/<Objs\b[^>]*schemas\.microsoft\.com\/powershell/i.test(src)) return src;
  const ent = (t) => t.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return src.replace(/#<\s*CLIXML\s*/g, '').replace(/<Objs\b[\s\S]*?(?:<\/Objs>|$)/g, (block) =>
    [...block.matchAll(/<S\b[^>]*>([\s\S]*?)<\/S>/g)].map(m => ent(m[1])).join('').replace(/\r?\n$/, ''));
}

function parseOutput(text, exitCode, kind) {
  text = declixml(text);
  const lines = String(text || '').split(/\r?\n/);
  const r = {
    exitCode,
    ok: exitCode === 0,
    errors: 0,
    warnings: 0,
    errorLines: [],
    tests: null,
    summary: '',
  };

  // UBT : "Result: Succeeded" / "Result: Failed"
  let ubt = null;
  for (const l of lines) {
    const m = l.match(/\bResult:\s*(Succeeded|Failed|Cancelled)\b/i);
    if (m) ubt = m[1].toLowerCase();
    const isError = /\b(error|erreur)\s+[A-Z]{1,3}\d{3,5}\s*:|:\s*(fatal )?error\s*:|^\s*error\s*:|BUILD FAILED/i.test(l)
      || /\bECHEC\b|ERROR:/.test(l); // en majuscules seulement : "0 echec" n'est pas une erreur
    if (isError && !/\b0 error/i.test(l)) {
      r.errors++;
      if (r.errorLines.length < 5) r.errorLines.push(l.trim().slice(0, 300));
    } else if (/\bwarning\s+[A-Z]{1,3}\d{3,5}\s*:|:\s*warning\s*:/i.test(l)) {
      r.warnings++;
    }
  }
  if (ubt === 'failed' || ubt === 'cancelled') r.ok = false;

  // Tests Unreal : lignes "Test Completed. Result={Success}" dans la sortie
  const tests = countTests(lines);
  // tests.ps1 : "140 tests, 0 echec" / "140 tests, 2 ECHEC(S)"
  const m = String(text || '').match(/(\d+)\s+tests,\s+(\d+)\s+(echec|ECHEC)/);
  // la ligne de tests.ps1 fait foi quand elle compte plus de tests que les lignes vues (sortie coupee)
  if (tests.total && !(m && +m[1] > tests.total)) {
    r.tests = tests;
    // UnrealEditor-Cmd rend 0 meme quand des tests echouent : les lignes du journal font foi.
    r.ok = tests.failed === 0 && ubt !== 'failed';
  } else if (m) {
    r.tests = { total: +m[1], failed: +m[2], passed: +m[1] - +m[2], failedNames: tests.failedNames || [] };
  }
  if (/LA SUITE A PLANTE/.test(text || '')) r.ok = false;
  if (r.tests && r.tests.failed > 0) r.ok = false;

  if (r.tests) r.summary = `${r.tests.passed}/${r.tests.total} tests`;
  else if (ubt) r.summary = ubt === 'succeeded' ? 'compile' : 'echec de compilation';
  else r.summary = exitCode === 0 ? 'termine' : `code ${exitCode}`;
  if (r.errors) r.summary += `, ${r.errors} erreur${r.errors > 1 ? 's' : ''}`;
  return r;
}

const MAX_PATHS = 3000;

function countTests(lines) {
  let total = 0, failed = 0;
  const failedNames = [], passedPaths = [], failedPaths = [];
  for (const l of lines) {
    if (!/Test Completed/.test(l)) continue;
    total++;
    const p = l.match(/Path=\{(.+?)\}/);
    if (!/Result=\{Success\}/.test(l)) {
      failed++;
      const n = l.match(/Name=\{(.+?)\}/);
      if (n && failedNames.length < 5) failedNames.push(n[1]);
      if (p && failedPaths.length < MAX_PATHS) failedPaths.push(p[1]);
    } else if (p && passedPaths.length < MAX_PATHS) {
      passedPaths.push(p[1]);
    }
  }
  return { total, failed, passed: total - failed, failedNames, passedPaths, failedPaths };
}

// Les suites lancees par un script (tools\tests.ps1) ecrivent leur journal dans Saved/Logs du
// projet : on y lit les lignes "Test Completed" des journaux modifies pendant la commande.
function testsFromProjectLogs(projectRoot, sinceMs) {
  if (!projectRoot) return null;
  const dir = require('path').join(projectRoot, 'Saved', 'Logs');
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.log')) continue;
      const file = require('path').join(dir, f);
      const st = fs.statSync(file);
      if (st.mtimeMs < sinceMs || st.size > 200 * 1024 * 1024) continue;
      const t = countTests(fs.readFileSync(file, 'utf8').split(/\r?\n/));
      if (t.total && (!best || t.total > best.total)) best = t;
    }
  } catch { return null; }
  return best;
}

// Si la commande ecrit son journal ailleurs (-abslog=...), les tests sont la-bas.
function testsFromAbslog(cmd, sinceMs) {
  const m = String(cmd).match(/-abslog=("([^"]+)"|(\S+))/i);
  if (!m) return null;
  const file = (m[2] || m[3]).replace(/^["']|["']$/g, '');
  if (file.includes('$')) return null; // variable PowerShell, chemin inconnu
  try {
    const st = fs.statSync(file);
    if (sinceMs && st.mtimeMs < sinceMs) return null;
    const t = countTests(fs.readFileSync(file, 'utf8').split(/\r?\n/));
    return t.total ? t : null;
  } catch { return null; }
}

module.exports = { parseOutput, declixml, countTests, testsFromAbslog, testsFromProjectLogs };
