'use strict';
// La bibliotheque des skills : tous les skills Claude Code installes sur le PC, s'ils sont valides, et
// combien de fois les sessions s'en servent vraiment. Lecture seule, sauf « Ajouter un skill » (create).
//
// Ou Claude Code les trouve :
//   - perso   : <config>/skills/<nom>/SKILL.md (config = CLAUDE_CONFIG_DIR, sinon ~/.claude) ;
//   - compte  : <config>/skills/synced/<compte>/<nom>/SKILL.md, synchronises depuis claude.ai ;
//   - projet  : <projet>/.claude/skills/<nom>/SKILL.md ;
//   - plugin  : <dossier du plugin>/skills/<nom>/SKILL.md, appele « plugin:nom ». Le plugin est installe
//     (plugins/installed_plugins.json, plugins/cache, plugins/synced) et active dans un settings.json
//     (« enabledPlugins », global ou d'un projet).
// L'usage se lit dans les journaux des sessions (<config>/projects/**/*.jsonl) : un appel de l'outil
// Skill, ou une commande /nom tapee par l'utilisateur.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const WINDOW_DAYS = 30;
const DESC_MAX = 1024;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const readText = (f, max = 256 * 1024) => { try { return fs.readFileSync(f, 'utf8').slice(0, max); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---- en-tete YAML du SKILL.md -----------------------------------------------------------------
// Assez de YAML pour un en-tete de skill : « cle: valeur », valeurs entre guillemets, blocs > et |,
// lignes de continuation. Releve ce qui ferait echouer la lecture de Claude Code.
function parseSkill(text) {
  const out = { fm: null, body: '', problems: [] };
  const src = String(text || '').replace(/^\uFEFF/, '');
  const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) { out.body = src; return out; }
  out.body = src.slice(m[0].length);
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:(?:\s+(.*)|\s*)$/);
    if (!kv) {
      if (/^\s/.test(line) || /^\s*-/.test(line)) continue; // suite d'une liste ou d'un bloc deja lu
      out.problems.push({ level: 'ko', text: `ligne ${i + 2} illisible : « ${short(line, 60)} »` });
      continue;
    }
    const key = kv[1].toLowerCase();
    let v = (kv[2] || '').trim();
    if (/^[>|][+-]?$/.test(v)) { // bloc : les lignes indentees qui suivent
      const fold = v[0] === '>';
      const parts = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim());
      v = fold ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n').trim();
    } else if (/^["']/.test(v)) {
      const q = v[0];
      let raw = v;
      while (!closed(raw, q) && i + 1 < lines.length) raw += ' ' + lines[++i].trim();
      if (!closed(raw, q)) { out.problems.push({ level: 'ko', text: `guillemet ${q} jamais fermé pour « ${key} »` }); v = raw.slice(1); }
      else {
        const end = raw.lastIndexOf(q);
        if (raw.slice(end + 1).trim() && !/^\s*#/.test(raw.slice(end + 1))) out.problems.push({ level: 'ko', text: `texte après le guillemet fermant de « ${key} »` });
        v = raw.slice(1, end);
        v = q === '"' ? v.replace(/\\(["\\nt])/g, (_, c) => ({ n: '\n', t: '\t' }[c] || c)) : v.replace(/''/g, "'");
      }
    } else {
      // valeur sans guillemets : les lignes plus indentees qui suivent la prolongent
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*-\s/.test(lines[i + 1])) v += ' ' + lines[++i].trim();
      if (/:\s/.test(v)) out.problems.push({ level: 'warn', text: `« ${key} » contient « : » sans guillemets, ce que le YAML strict refuse : mets la valeur entre guillemets pour être sûr qu'elle soit lue` });
      else if (/^[*&!%@`[{]/.test(v)) out.problems.push({ level: 'ko', text: `« ${key} » commence par « ${v[0]} » sans guillemets : l'en-tête YAML est invalide` });
      if (/\s#/.test(v)) out.problems.push({ level: 'warn', text: `« ${key} » contient « # » sans guillemets : la fin est lue comme un commentaire` });
      v = v.replace(/\s#.*$/, '').trim();
    }
    fm[key] = v;
  }
  out.fm = fm;
  return out;
}
function closed(raw, q) {
  if (q === "'") return raw.replace(/''/g, '').slice(1).includes("'");
  for (let k = 1; k < raw.length; k++) { if (raw[k] === '\\') k++; else if (raw[k] === '"') return true; }
  return false;
}

// ---- un skill : lecture et verification -------------------------------------------------------
// issues : [{ level: 'ko'|'warn', text }] ; ko = Claude Code ne peut pas s'en servir correctement.
function readSkill(dir, base) {
  const folder = path.basename(dir);
  const s = { ...base, folder, dir, file: path.join(dir, 'SKILL.md'), name: folder, description: '', issues: [], files: 0 };
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* dossier parti */ }
  s.files = names.length;
  const real = names.find(n => n === 'SKILL.md') || names.find(n => n.toLowerCase() === 'skill.md');
  if (!real) { s.issues.push({ level: 'ko', text: 'Pas de SKILL.md dans le dossier : Claude Code ne voit pas ce skill.' }); return s; }
  if (real !== 'SKILL.md') s.issues.push({ level: 'warn', text: `Le fichier s'appelle ${real} : renomme-le SKILL.md (en majuscules), sinon il n'est pas vu hors de Windows.` });
  s.file = path.join(dir, real);
  const text = readText(s.file);
  if (text == null) { s.issues.push({ level: 'ko', text: 'SKILL.md illisible.' }); return s; }
  try { s.mtime = fs.statSync(s.file).mtimeMs; } catch { /* tant pis */ }
  const p = parseSkill(text);
  if (!p.fm) { s.issues.push({ level: 'ko', text: 'Pas d\'en-tête (--- name, description ---) en haut du SKILL.md : Claude ne sait pas quand l\'utiliser.' }); return s; }
  for (const pb of p.problems) s.issues.push({ level: pb.level, text: `En-tête : ${pb.text}.` });
  const fm = p.fm;
  if (fm.name) s.name = fm.name;
  s.description = short(fm.description, 400);
  if (!fm.description) s.issues.push({ level: 'ko', text: 'Pas de description : Claude ne sait pas quand l\'utiliser, il ne le déclenchera pas tout seul.' });
  else if (fm.description.length > DESC_MAX) s.issues.push({ level: 'warn', text: `Description de ${fm.description.length} caractères : au-delà de ${DESC_MAX}, elle est coupée.` });
  else if (fm.description.length < 30) s.issues.push({ level: 'warn', text: 'Description très courte : dis quand l\'utiliser (« Utilise ce skill quand... ») pour qu\'il se déclenche.' });
  if (fm.name && !NAME_RE.test(fm.name)) s.issues.push({ level: 'warn', text: `Nom « ${short(fm.name, 40)} » : seulement minuscules, chiffres et tirets, 64 caractères au plus.` });
  else if (fm.name && fm.name !== folder) s.issues.push({ level: 'warn', text: `Son en-tête dit « ${fm.name} » mais son dossier s'appelle « ${folder} » : garde le même nom pour ne pas le chercher sous deux noms.` });
  if (fm['disable-model-invocation'] === 'true') s.manual = true;
  if (!p.body.trim()) s.issues.push({ level: 'warn', text: 'Rien sous l\'en-tête : le skill n\'apprend rien à Claude une fois chargé.' });
  // fichiers cites par un lien relatif [texte](chemin) qui n'existent pas
  const missing = new Set();
  const prose = p.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const lm of prose.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const rel = lm[1];
    if (/^[a-z]+:/i.test(rel) || rel.startsWith('/') || rel.startsWith('#')) continue;
    let target;
    try { target = path.resolve(dir, decodeURIComponent(rel)); } catch { continue; }
    if (!target.startsWith(dir + path.sep) && target !== dir) continue;
    if (!fs.existsSync(target)) missing.add(rel);
  }
  if (missing.size) s.issues.push({ level: 'warn', text: `Fichiers cités introuvables : ${[...missing].slice(0, 5).join(', ')}${missing.size > 5 ? '…' : ''}.` });
  return s;
}

// ---- plugins ----------------------------------------------------------------------------------
// Chaque plugin vu sur le disque : { id: 'plugin@marche', name, path, source }.
function pluginInstalls(cfg) {
  const found = new Map();
  const add = (id, p, source) => {
    if (!p || !fs.existsSync(p)) return;
    const prev = found.get(id);
    if (prev && prev.mtime >= mtimeOf(p)) return;
    found.set(id, { id, name: id.split('@')[0], path: p, source, mtime: mtimeOf(p) });
  };
  const inst = readJson(path.join(cfg, 'plugins', 'installed_plugins.json'));
  if (inst && inst.plugins && typeof inst.plugins === 'object') {
    for (const [id, v] of Object.entries(inst.plugins)) for (const e of [].concat(v || [])) if (e && e.installPath) add(id, e.installPath, 'installé');
  }
  // cache : <marche>/<plugin>/<version>/ ; on garde la version la plus recente
  const cache = path.join(cfg, 'plugins', 'cache');
  for (const mkt of dirs(cache)) for (const pl of dirs(path.join(cache, mkt))) {
    const id = `${pl}@${mkt}`;
    if (found.has(id)) continue;
    const vers = dirs(path.join(cache, mkt, pl)).map(v => path.join(cache, mkt, pl, v)).sort((a, b) => mtimeOf(b) - mtimeOf(a));
    if (vers[0]) add(id, vers[0], 'installé');
  }
  // plugins du compte claude.ai : synced/<compte>/<plugin>/
  const synced = path.join(cfg, 'plugins', 'synced');
  for (const b of dirs(synced)) for (const pl of dirs(path.join(synced, b))) {
    const meta = readJson(path.join(synced, b, `${pl}.meta.json`)) || {};
    const man = readJson(path.join(synced, b, pl, '.claude-plugin', 'plugin.json')) || {};
    add(`${man.name || pl}@${meta.marketplace_name || 'claude.ai'}`, path.join(synced, b, pl), 'compte');
  }
  return [...found.values()];
}
function mtimeOf(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

// enabledPlugins d'un settings.json (et de son settings.local.json)
function enabledIn(dir, file = 'settings') {
  const out = {};
  for (const f of [`${file}.json`, `${file}.local.json`]) {
    const j = readJson(path.join(dir, f));
    if (j && j.enabledPlugins && typeof j.enabledPlugins === 'object') Object.assign(out, j.enabledPlugins);
  }
  return out;
}

// ---- inventaire complet -----------------------------------------------------------------------
// projects : [{ name, root }]. Renvoie { skills, plugins, roots } sans l'usage (voir withUsage).
function scan({ cfg = configDir(), projects = [] } = {}) {
  const skills = [];
  const skillDirs = (parent, base) => { for (const d of dirs(parent)) if (!d.startsWith('.') && d !== 'synced') skills.push(readSkill(path.join(parent, d), base)); };
  skillDirs(path.join(cfg, 'skills'), { scope: 'perso', where: 'Perso' });
  for (const b of dirs(path.join(cfg, 'skills', 'synced'))) skillDirs(path.join(cfg, 'skills', 'synced', b), { scope: 'compte', where: 'Compte claude.ai' });
  const seenRoots = new Set();
  const projs = [];
  for (const p of projects) {
    if (!p || !p.root) continue;
    const k = path.resolve(p.root).toLowerCase();
    if (seenRoots.has(k)) continue;
    seenRoots.add(k);
    projs.push({ name: p.name || path.basename(p.root), root: path.resolve(p.root) });
    skillDirs(path.join(p.root, '.claude', 'skills'), { scope: 'projet', where: p.name || path.basename(p.root), project: p.name || path.basename(p.root), root: path.resolve(p.root) });
  }
  // plugins : installes, et ou ils sont actives
  const globalOn = enabledIn(cfg);
  const projOn = projs.map(p => ({ p, on: enabledIn(path.join(p.root, '.claude')) }));
  const installs = pluginInstalls(cfg);
  const plugins = [];
  const ids = new Set([...installs.map(i => i.id), ...Object.keys(globalOn), ...projOn.flatMap(x => Object.keys(x.on))]);
  for (const id of ids) {
    const inst = installs.find(i => i.id === id);
    const where = [];
    if (globalOn[id] === true) where.push('partout');
    for (const x of projOn) if (x.on[id] === true) where.push(x.p.name);
    const off = globalOn[id] === false || projOn.some(x => x.on[id] === false);
    const pl = { id, name: id.split('@')[0], market: id.split('@')[1] || '', installed: !!inst, source: inst ? inst.source : '', enabled: where, skills: 0, issues: [] };
    if (inst && inst.source === 'compte') pl.enabled = where.length ? where : ['compte claude.ai'];
    if (!inst) pl.issues.push({ level: 'warn', text: `Activé (${where.join(', ') || 'désactivé'}) mais pas encore téléchargé : Claude Code l'installe à la prochaine session ouverte là où il est activé, si son marché est connu.` });
    else if (!pl.enabled.length) pl.issues.push({ level: 'warn', text: off ? 'Installé mais désactivé : ses skills ne sont proposés à aucune session.' : 'Installé mais activé nulle part : ses skills ne sont proposés à aucune session.' });
    if (inst) {
      const sdir = path.join(inst.path, 'skills');
      for (const d of dirs(sdir)) {
        if (d.startsWith('.')) continue;
        const s = readSkill(path.join(sdir, d), { scope: 'plugin', where: `Plugin ${pl.name}`, plugin: pl.name, pluginId: id });
        s.call = `${pl.name}:${s.folder}`;
        if (!pl.enabled.length) s.issues.push({ level: 'warn', text: `Son plugin ${pl.name} n'est activé nulle part.` });
        skills.push(s);
        pl.skills++;
      }
    }
    plugins.push(pl);
  }
  // meme nom a deux endroits (hors plugins, qui ont leur prefixe)
  const byName = new Map();
  for (const s of skills) { if (!s.call) s.call = s.folder; if (s.scope !== 'plugin') { const k = s.folder.toLowerCase(); byName.set(k, [...(byName.get(k) || []), s]); } }
  for (const list of byName.values()) if (list.length > 1) {
    for (const s of list) s.issues.push({ level: 'warn', text: `Même nom qu'un autre skill (${list.filter(x => x !== s).map(x => x.where).join(', ')}) : une session qui voit les deux n'en garde qu'un.` });
  }
  for (const s of skills) s.id = `${s.scope}:${s.pluginId || s.project || ''}:${s.folder}`;
  return { skills, plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)), roots: projs };
}

// ---- usage : lu dans les journaux des sessions ------------------------------------------------
// Par journal : ou on en est, et les appels de skills trouves { skill, at, session, cwd, how }.
const journals = new Map();
const yieldNow = () => new Promise(r => setImmediate(r));

// Ce qu'une ligne du journal dit des skills : appels de l'outil Skill (ou de l'ancien SlashCommand),
// et commandes /nom tapees par l'utilisateur.
function callsIn(line) {
  if (!line.includes('Skill') && !line.includes('SlashCommand') && !line.includes('command-name')) return [];
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (!o || typeof o !== 'object' || !o.message) return [];
  const at = Date.parse(o.timestamp) || 0, session = o.sessionId || '', cwd = o.cwd || '';
  const out = [];
  const content = Array.isArray(o.message.content) ? o.message.content : [o.message.content];
  for (const c of content) {
    if (o.type === 'assistant' && c && c.type === 'tool_use' && c.input) {
      if (c.name === 'Skill') { const n = c.input.skill || c.input.command || c.input.name; if (n) out.push({ skill: String(n).replace(/^\//, '').split(/\s/)[0], how: 'auto' }); }
      else if (c.name === 'SlashCommand' && c.input.command) out.push({ skill: String(c.input.command).replace(/^\//, '').split(/\s/)[0], how: 'auto' });
    } else if (o.type === 'user') {
      const t = typeof c === 'string' ? c : c && c.type === 'text' ? c.text : '';
      const cm = t && t.match(/<command-name>\/?([^<\s]+)<\/command-name>/);
      if (cm) out.push({ skill: cm[1], how: 'tapé' });
    }
  }
  return out.map(x => ({ ...x, at, session, cwd }));
}

// Les appels de sous-agents (outil Agent, ancien Task) : leur type, et les tokens qu'ils ont coutes,
// lus dans le resultat de l'appel quand il revient. j.agents : [{ type, at, session, cwd, what, tokens }].
function agentCallsIn(line, j) {
  if (!line.includes('"subagent_type"') && !line.includes('"totalTokens"')) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  if (!o || typeof o !== 'object' || !o.message || !Array.isArray(o.message.content)) return;
  for (const c of o.message.content) {
    if (!c) continue;
    if (o.type === 'assistant' && c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task') && c.input) {
      const call = { type: String(c.input.subagent_type || 'general-purpose'), at: Date.parse(o.timestamp) || 0, session: o.sessionId || '', cwd: o.cwd || '', what: short(c.input.description, 80), tokens: 0 };
      j.agents.push(call);
      if (c.id) j.pending.set(c.id, call);
    } else if (o.type === 'user' && c.type === 'tool_result' && j.pending.has(c.tool_use_id)) {
      const r = o.toolUseResult;
      const n = r && typeof r === 'object' ? Number(r.totalTokens) || 0 : 0;
      if (n || (r && r.status && r.status !== 'async_launched')) { j.pending.get(c.tool_use_id).tokens = n; j.pending.delete(c.tool_use_id); }
    }
  }
}

async function readJournal(file, st) {
  let j = journals.get(file);
  if (!j || st.size < j.offset) { j = { offset: 0, rest: '', dec: new StringDecoder('utf8'), calls: [], agents: [], pending: new Map() }; journals.set(file, j); }
  j.mtime = st.mtimeMs;
  let h;
  try {
    h = await fs.promises.open(file, 'r');
    while (st.size > j.offset) {
      const len = Math.min(st.size - j.offset, 1 << 20);
      const { bytesRead, buffer } = await h.read(Buffer.alloc(len), 0, len, j.offset);
      if (!bytesRead) break;
      j.offset += bytesRead;
      const lines = (j.rest + j.dec.write(buffer.slice(0, bytesRead))).split('\n');
      j.rest = lines.pop();
      for (const l of lines) { for (const c of callsIn(l)) j.calls.push(c); agentCallsIn(l, j); }
      await yieldNow();
    }
  } catch { /* journal illisible : on garde ce qu'on a */ } finally { if (h) await h.close().catch(() => {}); }
}

// Les journaux modifies dans la fenetre : <config>/projects/<dossier>/*.jsonl, et les journaux des
// sous-agents (<session>/subagents/*.jsonl).
function journalFiles(root, since) {
  const out = [];
  const walk = (d, depth) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth > 0) walk(f, depth - 1); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      try { const st = fs.statSync(f); if (st.mtimeMs >= since) out.push({ f, st }); } catch { /* parti */ }
    }
  };
  walk(root, 3);
  return out;
}

let reading = null;
async function readJournals({ cfg = configDir(), now = Date.now(), days = WINDOW_DAYS } = {}) {
  if (reading) return reading;
  reading = (async () => {
    for (const { f, st } of journalFiles(path.join(cfg, 'projects'), now - days * 86400_000)) {
      const j = journals.get(f);
      if (j && j.offset === st.size && j.mtime === st.mtimeMs) continue;
      await readJournal(f, st);
    }
  })();
  try { return await reading; } finally { reading = null; }
}
async function readUsage(o = {}) {
  await readJournals(o);
  const since = (o.now || Date.now()) - (o.days || WINDOW_DAYS) * 86400_000;
  const calls = [];
  for (const j of journals.values()) for (const c of j.calls) if (c.at >= since) calls.push(c);
  return calls;
}
// Les appels de sous-agents des 30 derniers jours (lib/agents.js), lus dans les memes journaux.
async function readAgentUsage(o = {}) {
  await readJournals(o);
  const since = (o.now || Date.now()) - (o.days || WINDOW_DAYS) * 86400_000;
  const calls = [];
  for (const j of journals.values()) for (const c of j.agents) if (c.at >= since) calls.push(c);
  return calls;
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Rattache chaque appel a son skill. Un appel « plugin:nom » va au skill de ce plugin ; un nom seul
// va au skill perso, du compte ou du projet de ce nom (celui du projet de la session s'il y en a un).
function withUsage(inv, calls, { now = Date.now(), days = WINDOW_DAYS } = {}) {
  const skills = inv.skills.map(s => ({ ...s, uses: 0, sessions: 0, lastAt: 0, typed: 0, usedIn: [] }));
  const index = new Map();
  const put = (k, s) => { k = k.toLowerCase(); index.set(k, [...(index.get(k) || []), s]); };
  for (const s of skills) {
    if (s.scope === 'plugin') { put(s.call, s); put(`${s.plugin}:${s.name}`, s); } else { put(s.folder, s); if (s.name !== s.folder) put(s.name, s); }
  }
  const sess = new Map();
  const unknown = new Map();
  for (const c of calls) {
    const key = c.skill.toLowerCase();
    let list = index.get(key);
    if (!list && !key.includes(':')) list = skills.filter(s => s.scope === 'plugin' && s.folder.toLowerCase() === key);
    if (!list || !list.length) {
      if (c.how === 'auto') { const u = unknown.get(c.skill) || { name: c.skill, uses: 0, lastAt: 0 }; u.uses++; u.lastAt = Math.max(u.lastAt, c.at); unknown.set(c.skill, u); }
      continue;
    }
    const cwd = norm(c.cwd);
    const home = inv.roots.find(r => cwd === norm(r.root) || cwd.startsWith(norm(r.root) + '/'));
    const s = list.find(x => x.root && home && norm(x.root) === norm(home.root)) || list.find(x => x.scope !== 'projet') || list[0];
    s.uses++;
    if (c.how === 'tapé') s.typed++;
    s.lastAt = Math.max(s.lastAt, c.at);
    if (!sess.has(s.id)) sess.set(s.id, new Set());
    sess.get(s.id).add(c.session);
    const where = home ? home.name : path.basename(cwd) || '?';
    if (!s.usedIn.includes(where)) s.usedIn.push(where);
  }
  for (const s of skills) {
    s.sessions = sess.has(s.id) ? sess.get(s.id).size : 0;
    s.usedIn = s.usedIn.slice(0, 6);
    s.status = s.issues.some(i => i.level === 'ko') ? 'ko' : s.issues.length ? 'warn' : s.uses ? 'ok' : 'unused';
    delete s.dir; delete s.root;
  }
  const rank = { ko: 0, warn: 1, unused: 2, ok: 3 };
  skills.sort((a, b) => rank[a.status] - rank[b.status] || b.uses - a.uses || a.call.localeCompare(b.call));
  const count = (st) => skills.filter(s => s.status === st).length;
  return {
    scannedAt: now, days, skills, plugins: inv.plugins,
    unknown: [...unknown.values()].sort((a, b) => b.uses - a.uses).slice(0, 12),
    projects: inv.roots.map(r => r.name),
    total: skills.length, ko: count('ko'), warn: count('warn'), unused: count('unused'), ok: count('ok'),
    calls: calls.length,
  };
}

// ---- ajouter un skill -------------------------------------------------------------------------
function template({ name, description, body }) {
  const title = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const head = `---\nname: ${name}\ndescription: ${JSON.stringify(String(description || '').replace(/\s+/g, ' ').trim())}\n---\n\n# ${title}\n\n`;
  if (String(body || '').trim()) return head + String(body).trim().replace(/\r\n/g, '\n') + '\n';
  return head +
    '## Quand l\'utiliser\n\n- (les situations où ce skill sert, en une ligne chacune)\n\n' +
    '## Étapes\n\n1. (ce que Claude fait d\'abord)\n2. (puis)\n3. (puis)\n\n' +
    '## À vérifier avant de finir\n\n- (ce qui doit être vrai pour dire que c\'est fait)\n';
}

// target : { scope: 'perso' } ou { scope: 'projet', root }. text : un SKILL.md complet (ex. recupere
// d'une adresse et montre a l'utilisateur) ; sinon le modele, rempli avec name et description.
function create({ cfg = configDir(), scope, root, name, description, body, text }) {
  name = String(name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) return { ok: false, error: 'Nom : minuscules, chiffres et tirets seulement (ex. revue-blueprints), 64 caractères au plus.' };
  let parent;
  if (scope === 'perso') parent = path.join(cfg, 'skills');
  else if (scope === 'projet' && root) parent = path.join(root, '.claude', 'skills');
  else return { ok: false, error: 'Choisis où le ranger : perso, ou un projet.' };
  const dir = path.join(parent, name);
  if (fs.existsSync(dir)) return { ok: false, error: `Un skill « ${name} » existe déjà là : ${dir}` };
  let out;
  if (text != null) {
    out = String(text);
    if (out.length > 200_000) return { ok: false, error: 'SKILL.md trop gros (200 Ko au plus).' };
    if (!parseSkill(out).fm) return { ok: false, error: 'Ce texte n\'a pas d\'en-tête de skill (--- name, description ---).' };
  } else {
    if (!String(description || '').trim()) return { ok: false, error: 'Écris quand Claude doit s\'en servir : c\'est ce qui le déclenche.' };
    if (String(body || '').length > 100_000) return { ok: false, error: 'Texte trop long (100 Ko au plus).' };
    out = template({ name, description, body });
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), out);
  } catch (e) { return { ok: false, error: `Écriture impossible : ${e.message}` }; }
  return { ok: true, path: path.join(dir, 'SKILL.md') };
}

// Une adresse GitHub vers le SKILL.md brut : page d'un fichier (blob), d'un dossier (tree), ou brut.
function rawUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'github.com') {
    const p = u.pathname.split('/').filter(Boolean); // owner repo blob|tree ref ...path
    if (p.length >= 5 && (p[2] === 'blob' || p[2] === 'tree')) {
      let rest = p.slice(4).join('/');
      if (p[2] === 'tree' || !/\.md$/i.test(rest)) rest = rest ? `${rest}/SKILL.md` : 'SKILL.md';
      return `https://raw.githubusercontent.com/${p[0]}/${p[1]}/${p[3]}/${rest}`;
    }
    return null;
  }
  return u.href;
}

// Telecharge un SKILL.md pour le montrer avant de l'installer. Rien n'est ecrit ici.
async function fetchSkill(input, { fetchFn = globalThis.fetch } = {}) {
  const url = rawUrl(input);
  if (!url) return { ok: false, error: 'Colle une adresse https : la page GitHub du SKILL.md ou de son dossier, ou le fichier brut.' };
  let text;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    const r = await fetchFn(url, { signal: ctl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, error: `L'adresse répond ${r.status} (${url}).` };
    text = await r.text();
  } catch (e) { return { ok: false, error: `Téléchargement impossible : ${e.message}` }; }
  if (text.length > 200_000) return { ok: false, error: 'Fichier trop gros pour un SKILL.md (200 Ko au plus).' };
  const p = parseSkill(text);
  if (!p.fm) return { ok: false, error: 'Ce fichier n\'est pas un SKILL.md : pas d\'en-tête --- name, description ---.', url };
  const name = String(p.fm.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  const links = [...p.body.matchAll(/\]\(([^)\s#]+)\)/g)].map(m => m[1]).filter(r => !/^[a-z]+:/i.test(r) && !r.startsWith('/') && !r.startsWith('#'));
  return { ok: true, url, text, name, description: short(p.fm.description, 400), problems: p.problems.map(x => x.text), links: [...new Set(links)].slice(0, 10) };
}

// Le SKILL.md d'un skill de l'inventaire (par son id), pour le lire dans la tour.
function readFileOf(inv, id) {
  const s = inv && inv.skills.find(x => x.id === id);
  if (!s) return { ok: false, error: 'skill introuvable' };
  const text = readText(s.file, 64 * 1024);
  return text == null ? { ok: false, error: 'SKILL.md illisible' } : { ok: true, path: s.file, text };
}

module.exports = { parseSkill, readSkill, scan, callsIn, agentCallsIn, readUsage, readAgentUsage, pluginInstalls, enabledIn, withUsage, create, template, rawUrl, fetchSkill, readFileOf, configDir, WINDOW_DAYS, NAME_RE };
