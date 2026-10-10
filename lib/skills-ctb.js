'use strict';
// Installer dans un projet Unreal (CTB) les skills dont disposent les sessions du projet Alkatrazz Tower,
// plus ceux de ponytail. Chaque skill est copie dans <projet>/.claude/skills/<nom>/, depuis sa source
// publique sur GitHub (ou depuis vendor/ pour ceux d'Epic, MIT), sauf s'il y est deja ou si une session
// du projet l'a deja par ailleurs (perso, compte claude.ai, plugin active). Rien n'est ecrase, rien
// n'est commite dans le git du projet. Utilise par scripts/skills-ctb.js.

const fs = require('fs');
const path = require('path');
const skills = require('./skills');

const ROOT = path.resolve(__dirname, '..');
const gh = (repo, dir, ref = 'main') => ({ repo, ref, dir });

// Ce qu'on installe : nom du dossier, source, plugin d'origine (pour reconnaitre un plugin deja actif).
const CATALOG = [
  ...['docx', 'pdf', 'pptx', 'xlsx', 'skill-creator', 'canvas-design', 'theme-factory', 'web-artifacts-builder', 'doc-coauthoring']
    .map(n => ({ name: n, group: 'Anthropic (documents et outils)', from: gh('anthropics/skills', `skills/${n}`) })),
  { name: 'frontend-design', group: 'Plugin frontend-design', plugin: 'frontend-design', from: gh('anthropics/claude-plugins-official', 'plugins/frontend-design/skills/frontend-design') },
  ...['accessibility-review', 'design-critique', 'design-handoff', 'design-system', 'research-synthesis', 'user-research', 'ux-copy']
    .map(n => ({ name: n, group: 'Plugin design', plugin: 'design', from: gh('anthropics/knowledge-work-plugins', `design/skills/${n}`) })),
  ...['unreal-mcp', 'create-toolset', 'unreal-skill']
    .map(n => ({ name: n, group: 'Plugin Unreal d\'Epic (MCP de l\'editeur)', plugin: 'unreal-engine-skills-for-claude-code', local: path.join(ROOT, 'vendor', 'unreal-mcp-skills', 'skills', n) })),
  ...['ponytail', 'ponytail-review', 'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help']
    .map(n => ({ name: n, group: 'ponytail (sans ses hooks)', plugin: 'ponytail', from: gh('DietrichGebert/ponytail', `skills/${n}`), manual: n === 'ponytail' })),
];

// Ce qu'on n'installe pas, et pourquoi (affiche par le script).
const SKIPPED = [
  { names: ['simplify', 'code-review', 'security-review', 'init', 'loop', 'run', 'update-config', 'keybindings-help', 'fewer-permission-prompts', 'claude-api', 'plugin-authoring', 'workflow-authoring', 'dataviz'],
    why: 'integres a Claude Code : une session CTB les a deja' },
  { names: ['artifact-design', 'artifact-capabilities', 'artifact-diagramming', 'session-start-hook'], why: 'servent aux sessions cloud de claude.ai (Artifacts, demarrage cloud), pas a une session locale' },
  { names: ['docs', 'google-workspace', 'import-memory', 'morning'], why: 'demandent des connecteurs ou la memoire de claude.ai, absents d\'une session locale' },
  { names: ['deep-research', 'learn', 'chrome-browser', 'built-in-browser', 'computer-use'], why: 'skills du compte claude.ai non publies sur GitHub : presents dans CTB seulement si Claude Code synchronise ton compte (la bibliotheque de la tour le montre)' },
  { names: ['cowork-plugin-customizer', 'create-cowork-plugin'], why: 'ne marchent que dans Cowork' },
  { names: ['ai-tools-setup', 'computer-health-check', 'desktop-commander-overview', 'knowledge-base', 'obsidian-vault', 'terminal'], why: 'pilotent le serveur MCP Desktop Commander : sans ce plugin active, ces skills ne servent a rien' },
  { names: ['graphify'], why: 'exclu de CTB (decision d\'ali du 2026-10-09)' },
];

const MAX_FILES = 600, MAX_BYTES = 30 * 1024 * 1024;

// Ou en est chaque skill du catalogue pour ce projet.
//   present   : deja dans <projet>/.claude/skills
//   available : une session du projet l'a deja (perso, compte, plugin active partout ou pour ce projet)
//   install   : a copier
function plan({ root, cfg = skills.configDir(), only = null } = {}) {
  const name = path.basename(root);
  const inv = skills.scan({ cfg, projects: [{ name, root }] });
  const enabled = (p) => p && (p.enabled.includes('partout') || p.enabled.includes(name) || p.source === 'compte');
  const items = [];
  for (const it of CATALOG) {
    if (only && !only.includes(it.name)) continue;
    const dest = path.join(root, '.claude', 'skills', it.name);
    let status = 'install', where = '';
    if (fs.existsSync(dest)) { status = 'present'; where = `.claude/skills/${it.name}`; }
    else {
      const own = inv.skills.find(s => (s.scope === 'perso' || s.scope === 'compte') && s.folder === it.name);
      const pl = it.plugin && inv.plugins.find(p => p.name === it.plugin && p.installed);
      if (own) { status = 'available'; where = own.where; }
      else if (pl && enabled(pl) && inv.skills.some(s => s.scope === 'plugin' && s.plugin === it.plugin && s.folder === it.name)) { status = 'available'; where = `plugin ${it.plugin} (${pl.enabled.join(', ')})`; }
    }
    items.push({ ...it, dest, status, where, source: it.local ? `vendor/${path.relative(path.join(ROOT, 'vendor'), it.local).replace(/\\/g, '/')}` : `https://github.com/${it.from.repo}/tree/${it.from.ref}/${it.from.dir}` });
  }
  return { root, items, skipped: SKIPPED };
}

// ---- telechargement ----------------------------------------------------------------------------
async function getJson(url, fetchFn) {
  const r = await fetchFn(url, { headers: { 'User-Agent': 'alkatrazz-tower', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  return r.json();
}
// Les fichiers d'un dossier d'un depot GitHub : un appel a l'arbre du depot (garde en cache), puis un
// telechargement brut par fichier.
async function githubFiles(from, fetchFn, trees) {
  const key = `${from.repo}@${from.ref}`;
  if (!trees.has(key)) trees.set(key, getJson(`https://api.github.com/repos/${from.repo}/git/trees/${from.ref}?recursive=1`, fetchFn));
  const tree = await trees.get(key);
  const pre = from.dir.replace(/\/$/, '') + '/';
  const blobs = (tree.tree || []).filter(e => e.type === 'blob' && e.path.startsWith(pre));
  if (!blobs.length) throw new Error(`dossier introuvable : ${from.repo}/${from.dir}`);
  if (blobs.length > MAX_FILES) throw new Error(`trop de fichiers (${blobs.length})`);
  const out = [];
  let bytes = 0;
  for (const b of blobs) {
    const r = await fetchFn(`https://raw.githubusercontent.com/${from.repo}/${from.ref}/${b.path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'User-Agent': 'alkatrazz-tower' } });
    if (!r.ok) throw new Error(`${b.path} : ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    bytes += buf.length;
    if (bytes > MAX_BYTES) throw new Error('dossier trop gros');
    out.push({ rel: b.path.slice(pre.length), buf });
  }
  return out;
}
function localFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else out.push({ rel: path.relative(dir, f).replace(/\\/g, '/'), buf: fs.readFileSync(f) });
    }
  };
  walk(dir);
  return out;
}

// ponytail se declenche sinon sur toute tache de code : on le laisse a la main (/ponytail).
function makeManual(text) {
  if (/^disable-model-invocation\s*:/m.test(text.split(/\r?\n---/)[0])) return text;
  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, '$1\ndisable-model-invocation: true$2');
}

// Copie un skill : dossier temporaire a cote, verification du SKILL.md, puis renommage. Jamais par-dessus.
async function installOne(it, { fetchFn = globalThis.fetch, trees = new Map(), auto = false } = {}) {
  if (fs.existsSync(it.dest)) return { ok: false, error: 'existe deja' };
  const files = it.local ? localFiles(it.local) : await githubFiles(it.from, fetchFn, trees);
  const skill = files.find(f => f.rel === 'SKILL.md');
  if (!skill) throw new Error('pas de SKILL.md');
  let text = skill.buf.toString('utf8');
  if (!skills.parseSkill(text).fm) throw new Error('SKILL.md sans en-tete');
  if (it.manual && !auto) { text = makeManual(text); skill.buf = Buffer.from(text, 'utf8'); }
  const tmp = fs.mkdtempSync(path.join(path.dirname(it.dest), `.${it.name}-`));
  try {
    for (const f of files) {
      const target = path.resolve(tmp, f.rel);
      if (!target.startsWith(tmp + path.sep)) throw new Error(`chemin refuse : ${f.rel}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.buf);
    }
    fs.renameSync(tmp, it.dest);
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
  return { ok: true, files: files.length };
}

async function apply(p, opts = {}) {
  const trees = new Map();
  const results = [];
  for (const it of p.items) {
    if (it.status !== 'install') continue;
    fs.mkdirSync(path.dirname(it.dest), { recursive: true });
    try { results.push({ name: it.name, ...(await installOne(it, { ...opts, trees })) }); }
    catch (e) { results.push({ name: it.name, ok: false, error: e.message }); }
  }
  return results;
}

module.exports = { CATALOG, SKIPPED, plan, apply, installOne, makeManual };
