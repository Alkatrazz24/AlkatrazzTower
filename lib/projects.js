'use strict';
// Trouver les projets Unreal du PC (.uproject) pour que l'utilisateur choisisse ceux a connecter.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { engineVersion } = require('./unreal');

const SKIP = new Set(['node_modules', '.git', '.svn', 'saved', 'intermediate', 'binaries', 'deriveddatacache', 'content',
  'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'appdata', 'system volume information',
  'epic games', 'steam', 'steamlibrary', 'msys64', 'perflogs']);

function describe(uproject) {
  const root = path.dirname(uproject);
  return { name: path.basename(uproject, '.uproject'), root, uproject, engine: engineVersion(uproject) };
}

// Parcours limite en profondeur et en temps : on cherche, on ne fouille pas le disque entier.
function scan({ roots, budgetMs = 4000, maxDepth } = {}) {
  const home = os.homedir();
  const starts = roots || [
    [path.join(home, 'Documents'), 4],
    [path.join(home, 'Desktop'), 3],
    [path.join(home, 'source'), 3],
    [home, 1],
    ...['C', 'D', 'E', 'F', 'G'].map(l => [`${l}:\\`, 2]),
  ];
  const deadline = Date.now() + budgetMs;
  const found = new Map();
  const seen = new Set();
  const walk = (dir, depth) => {
    if (Date.now() > deadline || depth < 0) return;
    let key;
    try { key = fs.realpathSync(dir).toLowerCase(); } catch { return; }
    if (seen.has(key)) return;
    seen.add(key);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.uproject')) {
        const p = path.join(dir, e.name);
        found.set(p.toLowerCase(), describe(p));
      }
    }
    if (entries.some(e => e.isFile() && e.name.toLowerCase().endsWith('.uproject'))) return; // un projet : on ne descend pas dedans
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name.toLowerCase())) continue;
      walk(path.join(dir, e.name), depth - 1);
    }
  };
  for (const [dir, depth] of starts) {
    if (fs.existsSync(dir)) walk(dir, maxDepth != null ? maxDepth : depth);
  }
  return { projects: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), complete: Date.now() <= deadline };
}

// Un chemin colle par l'utilisateur : le .uproject lui-meme ou son dossier.
function resolve(input) {
  const p = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return null;
  try {
    const st = fs.statSync(p);
    if (st.isFile() && p.toLowerCase().endsWith('.uproject')) return describe(path.resolve(p));
    if (st.isDirectory()) {
      const f = fs.readdirSync(p).find(n => n.toLowerCase().endsWith('.uproject'));
      if (f) return describe(path.resolve(p, f));
    }
  } catch { /* chemin introuvable */ }
  return null;
}

module.exports = { scan, resolve, describe };
