'use strict';
// Le quartier des agents : tous les agents que Claude Code peut appeler sur le PC, ce que dit leur fichier,
// les skills qu'ils prechargent ou citent, et ce que la tour a vu d'eux (appels, tokens, dernier usage).
// Lecture seule : aucun fichier d'agent n'est ecrit.
//
// Ou Claude Code les trouve :
//   - integres : general-purpose, Explore, Plan, claude, statusline-setup, claude-code-guide ;
//   - perso    : <config>/agents/*.md (tous les projets) ;
//   - projet   : <projet>/.claude/agents/*.md (ce projet seulement ; il passe avant un agent perso du meme nom) ;
//   - plugin   : <dossier du plugin>/agents/*.md, appele « plugin:nom », la ou le plugin est active.
// L'acces aux skills (doc Claude Code, page sub-agents) : un sous-agent appelle les skills perso, du projet
// et des plugins par l'outil Skill, sauf si « tools: » ne le contient pas ou si « disallowedTools: » le
// retire. « skills: » ne donne pas l'acces : il precharge le texte complet de ces skills au demarrage.

const fs = require('fs');
const path = require('path');
const skillsLib = require('./skills');
const equipe = require('./equipe');

const short = (s, n) => { s = String(s || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const readText = (f, max = 64 * 1024) => { try { return fs.readFileSync(f, 'utf8').slice(0, max); } catch { return null; } };
const mdFiles = (d) => { try { return fs.readdirSync(d).filter(n => n.toLowerCase().endsWith('.md')).sort(); } catch { return []; } };

const BUILTIN_SECTION = 'Intégrés à Claude Code';
// [nom, a quoi il sert, ses outils, son modele, peut-il appeler un skill]
const BUILTIN = [
  ['general-purpose', 'Agent polyvalent pour les tâches en plusieurs étapes : chercher, comprendre puis modifier le code.', null, 'celui de la session', true],
  ['Explore', 'Recherche dans le code sans rien modifier (Write et Edit refusés). Claude l\'envoie fouiller pour garder sa propre mémoire libre.', ['lecture seule'], 'opus', null],
  ['Plan', 'Recherche pour préparer un plan, en mode plan. Lecture seule.', ['lecture seule'], 'celui de la session', null],
  ['claude', 'Agent fourre-tout quand aucun autre ne convient, avec tous les outils.', null, 'celui de la session', true],
  ['statusline-setup', 'Configure la barre d\'état quand tu tapes /statusline.', ['Read', 'Edit'], 'sonnet', false],
  ['claude-code-guide', 'Répond aux questions sur Claude Code lui-même.', ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'], 'haiku', false],
];

// ---- en-tete d'un agent -----------------------------------------------------------------------
// Les valeurs simples par lib/skills.js ; les listes (« tools: a, b », « [a, b] » ou lignes « - a »)
// ici, pour tools, disallowedTools, skills et mcpServers.
function listOf(block, key) {
  const lines = block.split(/\r?\n/);
  const i = lines.findIndex(l => new RegExp(`^${key}\\s*:`, 'i').test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(/^[^:]*:/, '').trim();
  let items = [];
  if (inline) items = inline.replace(/^\[|\]$/g, '').split(',');
  else for (let k = i + 1; k < lines.length && /^\s+-|^-/.test(lines[k]); k++) items.push(lines[k].replace(/^\s*-\s*/, ''));
  return items.map(x => x.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
}

// Les skills que le texte de l'agent lui demande d'ouvrir : « Skills utiles : a, b », « la skill `x` ».
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)?$/;
function citedSkills(body) {
  const out = new Set();
  for (const m of body.matchAll(/skills?\s+(?:utiles|à charger|a charger|to use|useful)\s*:\s*([\s\S]*?)(?:\.(?:\s|$)|\n\s*\n|$)/gi)) {
    for (const t of m[1].split(/[,;\s]+/)) { const n = t.replace(/[`*()]/g, '').toLowerCase(); if (SKILL_NAME.test(n) && n.includes('-')) out.add(n); }
  }
  for (const m of body.matchAll(/skills?\s+`\/?([a-z0-9][a-z0-9:-]*)`/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

function readAgent(file, base) {
  const a = { ...base, file, name: path.basename(file).replace(/\.md$/i, ''), description: '', issues: [], preload: [], cites: [], tools: null, disallowed: [] };
  const text = readText(file);
  if (text == null) { a.issues.push({ level: 'ko', text: 'Fichier illisible.' }); return a; }
  try { a.mtime = fs.statSync(file).mtimeMs; } catch { /* tant pis */ }
  const src = text.replace(/^﻿/, '');
  const p = skillsLib.parseSkill(src);
  if (!p.fm) { a.issues.push({ level: 'ko', text: 'Pas d\'en-tête (--- name, description ---) en haut du fichier : Claude Code ne le charge pas comme agent.' }); return a; }
  for (const pb of p.problems) a.issues.push({ level: pb.level, text: `En-tête : ${pb.text}.` });
  const fm = p.fm, block = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)[1];
  if (fm.name) a.name = short(fm.name, 60);
  a.description = short(fm.description, 400);
  if (!fm.description) a.issues.push({ level: 'ko', text: 'Pas de description : Claude ne sait pas quand l\'appeler.' });
  a.model = fm.model || '';
  a.color = fm.color || '';
  a.permissionMode = fm.permissionmode || '';
  a.background = fm.background === 'true';
  a.memory = fm.memory || '';
  a.tools = listOf(block, 'tools');
  a.disallowed = listOf(block, 'disallowedTools') || [];
  a.preload = (listOf(block, 'skills') || []).map(n => ({ name: n }));
  a.mcp = listOf(block, 'mcpServers') || [];
  const wanted = short(fm.section, 40);
  a.section = wanted ? (equipe.SECTIONS.find(s => s.toLowerCase() === wanted.toLowerCase()) || wanted) : equipe.guessSection(a.name);
  const pre = new Set(a.preload.map(x => x.name.toLowerCase()));
  a.cites = citedSkills(p.body).filter(n => !pre.has(n)).map(n => ({ name: n }));
  if (!p.body.trim()) a.issues.push({ level: 'warn', text: 'Rien sous l\'en-tête : l\'agent n\'a pas de consignes.' });
  return a;
}

// Peut-il appeler l'outil Skill ? null = on ne sait pas (agents integres en lecture seule).
function canSkill(a) {
  if (a.tools && !a.tools.some(t => /^skill(\(|$)/i.test(t))) return false;
  if (a.disallowed.some(t => /^skill$/i.test(t))) return false;
  return true;
}

// ---- inventaire -------------------------------------------------------------------------------
// projects : [{ name, root }] ; skills : l'inventaire de lib/skills.js (pour verifier les skills cites).
function scan({ cfg = skillsLib.configDir(), projects = [], skills = null } = {}) {
  const agents = BUILTIN.map(([name, description, tools, model, can]) => ({
    scope: 'integre', where: 'Claude Code', section: BUILTIN_SECTION, name, call: name, description, model, tools, disallowed: [],
    preload: [], cites: [], canSkill: can, issues: [], builtin: true,
  }));
  for (const f of mdFiles(path.join(cfg, 'agents'))) agents.push(readAgent(path.join(cfg, 'agents', f), { scope: 'perso', where: 'Perso' }));
  const roots = [];
  const seen = new Set();
  for (const p of projects) {
    if (!p || !p.root) continue;
    const root = path.resolve(p.root), k = root.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const name = p.name || path.basename(root);
    roots.push({ name, root });
    const dir = path.join(root, '.claude', 'agents');
    for (const f of mdFiles(dir)) agents.push(readAgent(path.join(dir, f), { scope: 'projet', where: name, project: name, root }));
  }
  // agents des plugins installes ; actives la ou leurs skills le sont (inventaire des skills)
  const enabled = new Map(((skills && skills.plugins) || []).map(pl => [pl.id, pl.enabled]));
  for (const inst of skillsLib.pluginInstalls(cfg)) {
    const dir = path.join(inst.path, 'agents');
    for (const f of mdFiles(dir)) {
      const a = readAgent(path.join(dir, f), { scope: 'plugin', where: `Plugin ${inst.name}`, plugin: inst.name, pluginId: inst.id });
      a.call = `${inst.name}:${a.name}`;
      const on = enabled.get(inst.id) || [];
      a.enabledIn = on;
      if (!on.length) a.issues.push({ level: 'warn', text: `Son plugin ${inst.name} n'est activé nulle part : aucune session ne peut l'appeler.` });
      agents.push(a);
    }
  }
  // skills prechargees et citees : existent-elles la ou l'agent travaille ?
  const all = (skills && skills.skills) || [];
  const known = (a, n) => {
    n = n.toLowerCase();
    return all.some(s => {
      if (s.scope === 'projet' && a.scope === 'projet' && s.root && path.resolve(s.root).toLowerCase() !== path.resolve(a.root).toLowerCase()) return false;
      return [s.call, s.folder, s.name].filter(Boolean).some(x => x.toLowerCase() === n) || (s.scope === 'plugin' && `${s.plugin}:${s.folder}`.toLowerCase() === n);
    });
  };
  for (const a of agents) {
    if (!a.call) a.call = a.name;
    if (a.builtin) continue;
    a.canSkill = canSkill(a);
    if (skills) {
      for (const x of a.preload) x.ok = known(a, x.name);
      for (const x of a.cites) x.ok = known(a, x.name);
      const lostPre = a.preload.filter(x => !x.ok).map(x => x.name), lostCite = a.cites.filter(x => !x.ok).map(x => x.name);
      if (lostPre.length) a.issues.push({ level: 'warn', text: `Précharge ${lostPre.join(', ')}, introuvable${lostPre.length > 1 ? 's' : ''} ici : Claude Code l'ignore sans prévenir.` });
      if (lostCite.length) a.issues.push({ level: 'warn', text: `Ses consignes citent ${lostCite.join(', ')}, qui n'${lostCite.length > 1 ? 'existent' : 'existe'} pas ici.` });
    }
    if (!a.canSkill && (a.cites.length || a.preload.length)) {
      a.issues.push({ level: 'warn', text: a.tools ? `Sa liste « tools: » n'a pas Skill : il ne peut appeler aucun skill, alors que ses consignes en citent. Ajoute Skill à tools.` : 'Skill est dans « disallowedTools: » : il ne peut appeler aucun skill, alors que ses consignes en citent.' });
    }
  }
  // un agent du projet du meme nom remplace l'agent perso (et l'integre) dans ce projet
  for (const a of agents) {
    if (a.scope !== 'projet') continue;
    const twins = agents.filter(b => b !== a && (b.scope === 'perso' || b.scope === 'integre') && b.name.toLowerCase() === a.name.toLowerCase());
    for (const b of twins) (b.hiddenIn = b.hiddenIn || []).push(a.project);
  }
  for (const a of agents) {
    if (a.hiddenIn && a.scope === 'perso') a.issues.push({ level: 'warn', text: `Dans ${a.hiddenIn.join(', ')}, un agent du projet porte le même nom et passe avant lui.` });
    a.id = `${a.scope}:${a.pluginId || a.project || ''}:${a.name}`;
  }
  return { agents, roots };
}

// ---- usage : les appels des 30 derniers jours (lib/skills.js readAgentUsage) ------------------
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function withUsage(inv, calls, { now = Date.now(), days = skillsLib.WINDOW_DAYS } = {}) {
  const agents = inv.agents.map(a => ({ ...a, uses: 0, sessions: 0, lastAt: 0, tokens: 0, usedIn: [], recent: [] }));
  const sess = new Map();
  const unknown = new Map();
  for (const c of calls) {
    const key = c.type.toLowerCase();
    const cwd = norm(c.cwd);
    const home = inv.roots.find(r => cwd === norm(r.root) || cwd.startsWith(norm(r.root) + '/'));
    const list = agents.filter(a => a.call.toLowerCase() === key || (a.scope === 'plugin' && a.name.toLowerCase() === key));
    // dans un projet, son agent passe avant l'agent perso, qui passe avant l'integre
    const a = list.find(x => x.scope === 'projet' && home && norm(x.root) === norm(home.root))
      || list.find(x => x.scope === 'perso') || list.find(x => x.scope === 'plugin') || list.find(x => x.scope === 'integre');
    if (!a) { const u = unknown.get(c.type) || { name: c.type, uses: 0, lastAt: 0 }; u.uses++; u.lastAt = Math.max(u.lastAt, c.at); unknown.set(c.type, u); continue; }
    a.uses++;
    a.tokens += c.tokens || 0;
    a.lastAt = Math.max(a.lastAt, c.at);
    if (!sess.has(a.id)) sess.set(a.id, new Set());
    sess.get(a.id).add(c.session);
    const where = home ? home.name : path.basename(cwd) || '?';
    if (!a.usedIn.includes(where)) a.usedIn.push(where);
    a.recent.push({ at: c.at, what: c.what || '', tokens: c.tokens || 0, where });
  }
  for (const a of agents) {
    a.sessions = sess.has(a.id) ? sess.get(a.id).size : 0;
    a.usedIn = a.usedIn.slice(0, 6);
    a.recent = a.recent.sort((x, y) => y.at - x.at).slice(0, 5);
    a.status = a.issues.some(i => i.level === 'ko') ? 'ko' : a.issues.length ? 'warn' : a.uses ? 'ok' : 'unused';
    delete a.root;
  }
  const order = [BUILTIN_SECTION, ...equipe.SECTIONS, equipe.OTHER];
  const rank = (s) => { const i = order.indexOf(s); return i < 0 ? order.length : i; };
  agents.sort((x, y) => rank(x.section) - rank(y.section) || x.section.localeCompare(y.section) || x.call.localeCompare(y.call));
  const count = (st) => agents.filter(a => a.status === st).length;
  return {
    scannedAt: now, days, agents, projects: inv.roots.map(r => r.name),
    unknown: [...unknown.values()].sort((a, b) => b.uses - a.uses).slice(0, 12),
    total: agents.length, ko: count('ko'), warn: count('warn'), unused: count('unused'), ok: count('ok'), calls: calls.length,
  };
}

// Le fichier d'un agent de l'inventaire (par son id), pour le lire dans la tour.
function readFileOf(inv, id) {
  const a = inv && inv.agents.find(x => x.id === id);
  if (!a) return { ok: false, error: 'agent introuvable' };
  if (a.builtin) return { ok: false, error: 'Agent intégré à Claude Code : il n\'a pas de fichier sur le PC.' };
  const text = readText(a.file);
  return text == null ? { ok: false, error: 'fichier illisible' } : { ok: true, path: a.file, text };
}

module.exports = { scan, withUsage, readAgent, readFileOf, citedSkills, canSkill, BUILTIN_SECTION };
