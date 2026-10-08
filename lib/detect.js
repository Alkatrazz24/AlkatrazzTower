'use strict';
// Reconnaitre une commande Unreal a verrouiller, et le projet d'un dossier.
// Partage par le hook (qui doit rester rapide) et par les tests.

const fs = require('fs');
const path = require('path');

// Programmes dont l'appel prend le verrou. Compare au nom de fichier, en minuscules.
const DEFAULT_PROGRAMS = [
  { re: /^build\.(bat|sh)$/, kind: 'build' },
  { re: /^unrealbuildtool(\.exe|\.dll)?$/, kind: 'build' },
  { re: /^runuat\.(bat|sh)$/, kind: 'package' },
  { re: /^unrealeditor(-win64-\w+)?-cmd(\.exe)?$/, kind: 'commandlet' },
  { re: /^cycle_editeur\.ps1$/, kind: 'build' },
  { re: /^tests\.ps1$/, kind: 'test' },
];

// Indices dans le texte, pour les appels par variable (`& $Cmd ... -ExecCmds=Automation RunTests`).
const CONTENT_HINTS = [
  { re: /-ExecCmds=["']?Automation\s+RunTests/i, kind: 'test' },
  { re: /RunUAT\.(bat|sh)[\s\S]*BuildCookRun|BuildCookRun[\s\S]*RunUAT\.(bat|sh)/i, kind: 'package' },
];

const MARK = 'tower-run.js';

// Decoupe une ligne de commande en segments de pipeline, sans casser les chaines entre guillemets.
function segments(cmd) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&' && cmd[i + 1] === '&') {
      out.push(cur); cur = '';
      if (cmd[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// Premier mot d'un segment, une fois retires `&`, `.`, `call`, `cmd /c` et les affectations VAR=x.
function program(seg) {
  let s = seg.replace(/^\(+/, '').trim();
  for (;;) {
    const before = s;
    s = s.replace(/^&\s*/, '').replace(/^\.\s+/, '').replace(/^call\s+/i, '')
      .replace(/^cmd(\.exe)?\s+\/[cC]\s+/i, '')
      .replace(/^(powershell|pwsh)(\.exe)?\s+(-\w+\s+)*?-File\s+/i, '')
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '');
    if (s === before) break;
  }
  const m = s.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  if (!m) return '';
  const tok = m[1] || m[2] || m[3];
  return tok.split(/[\\/]/).pop().toLowerCase();
}

// Renvoie { kind } si la commande doit passer par le verrou, sinon null.
function classify(cmd, programs = DEFAULT_PROGRAMS) {
  if (typeof cmd !== 'string' || !cmd.trim()) return null;
  if (cmd.includes(MARK)) return null; // deja emballee
  for (const seg of segments(cmd)) {
    const p = program(seg);
    for (const def of programs) if (def.re.test(p)) return { kind: def.kind, program: p };
  }
  for (const h of CONTENT_HINTS) if (h.re.test(cmd)) return { kind: h.kind, program: null };
  return null;
}

// Cible UBT d'un build : `Build.bat <Cible> Win64 ...`, ou celle de cycle_editeur.ps1.
function buildTarget(cmd, projectName) {
  const s = String(cmd || '');
  const m = s.match(/Build\.(?:bat|sh)["']?\s+["']?([A-Za-z_][\w]*)/i) || s.match(/UnrealBuildTool(?:\.exe|\.dll)?["']?\s+["']?([A-Za-z_][\w]*)/i);
  if (m && !/^-/.test(m[1])) return m[1];
  if (/cycle_editeur\.ps1/i.test(s) && projectName) {
    return /-Cible\s+["']?Jeu\b/i.test(s) ? projectName : `${projectName}Editor`;
  }
  return null;
}

// Filtre d'une suite de tests : `Automation RunTests <filtre>` ou `tests.ps1 -Filtre <filtre>`.
function testFilter(cmd) {
  const s = String(cmd || '');
  let m = s.match(/Automation\s+RunTests\s+([^;"'\s]+(?:\+[^;"'\s]+)*)/i);
  if (m) return m[1];
  if (/tests\.ps1/i.test(s)) {
    m = s.match(/-Filtre\s+["']?([^\s"';]+)/i);
    return m ? m[1] : 'CTB'; // filtre par defaut de tools\tests.ps1
  }
  return null;
}

// Cherche un .uproject en remontant depuis `dir` (6 niveaux au plus). Resultat mis en cache.
const projectCache = new Map();
function findProject(dir) {
  if (!dir) return null;
  if (projectCache.has(dir)) return projectCache.get(dir);
  let found = null, d = path.resolve(dir);
  for (let i = 0; i < 6 && d; i++) {
    try {
      const f = fs.readdirSync(d).find(n => n.toLowerCase().endsWith('.uproject'));
      if (f) { found = { name: f.replace(/\.uproject$/i, ''), root: d, uproject: path.join(d, f) }; break; }
    } catch { /* dossier illisible */ }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  projectCache.set(dir, found);
  return found;
}

module.exports = { classify, segments, program, findProject, buildTarget, testFilter, DEFAULT_PROGRAMS, MARK };
