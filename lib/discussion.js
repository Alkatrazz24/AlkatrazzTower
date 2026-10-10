'use strict';
// Discuter avec une session depuis la tour. La discussion est lue dans les journaux de Claude Code
// (le transcript .jsonl que le hook donne a la tour, et ceux de ses sous-agents), lecture seule :
//   - toi : tes messages ;
//   - chef : ce que la session t'ecrit, et ses actions ;
//   - mission : ce que le chef confie a un agent (outil Agent) ;
//   - agent : ce qu'un agent dit et fait pendant sa mission, puis son rapport.
// Les messages que Claude Code ajoute lui-meme (rappels, commandes) ne sont pas montres.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TAIL = 2 * 1024 * 1024; // la fin du journal suffit : un journal peut peser des dizaines de Mo
const SUB_TAIL = 256 * 1024;
const MAX_SUBS = 12; // sous-agents lus : les plus recents
const CUT = 4000;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n');
}
const clip = (s, n = CUT) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function toolLine(name, input) {
  const { toolSummary } = require('../server/state');
  return `${name}${input ? ' ' + toolSummary(name, input) : ''}`.trim();
}
// Le rapport d'un agent tel qu'il revient au chef, sans l'enveloppe que Claude Code met parfois autour.
function reportText(content) {
  let t = typeof content === 'string' ? content : textOf(content);
  const m = /The report follows:\s*\n/.exec(t);
  if (m) t = t.slice(m.index + m[0].length).replace(/^ {2}/gm, '');
  return t.replace(/\n*agentId: [\s\S]*$/, '').trim();
}

function tailLines(file, max) {
  let fd;
  try {
    const st = fs.statSync(file);
    fd = fs.openSync(file, 'r');
    const len = Math.min(st.size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    const lines = buf.toString('utf8').split(/\r?\n/);
    return { lines: len < st.size ? lines.slice(1) : lines, size: st.size, mtime: st.mtimeMs };
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* deja ferme */ } }
}

// Les lignes du journal principal -> messages. missions : id d'outil -> type d'agent.
function mainMsgs(lines, missions) {
  const out = [];
  for (const line of lines) {
    if (!line || (!line.includes('"user"') && !line.includes('"assistant"'))) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.isSidechain || o.isMeta || !o.message) continue;
    const at = Date.parse(o.timestamp) || 0;
    const c = o.message.content;
    if (o.type === 'user' && o.message.role === 'user') {
      if (Array.isArray(c) && c.some(x => x && x.type === 'tool_result')) {
        // Le rapport d'un agent revient au chef comme resultat de l'outil Agent.
        for (const r of c) {
          if (!r || r.type !== 'tool_result' || !missions.has(r.tool_use_id)) continue;
          const tur = o.toolUseResult || {};
          const agent = tur.agentType || missions.get(r.tool_use_id);
          const bg = tur.status && tur.status !== 'completed';
          const text = bg ? 'Lancé en fond : il rendra son rapport plus tard.' : reportText(r.content);
          if (text) out.push({ who: 'agent', kind: bg ? 'action' : 'rapport', agent, text: clip(text), at });
        }
        continue;
      }
      const text = textOf(c).trim();
      // Messages injectes par Claude Code (commandes, rappels, fin de tache de fond) : pas une demande.
      if (!text || /^<[a-z_-]+[\s>]/i.test(text) || /^\[Request interrupted/.test(text)) continue;
      out.push({ who: 'toi', kind: 'text', text: clip(text, 8000), at });
      continue;
    }
    if (o.type !== 'assistant' || !Array.isArray(c)) continue;
    const id = o.message.id || o.uuid;
    for (const b of c) {
      if (!b) continue;
      if (b.type === 'text' && b.text && b.text.trim()) {
        const last = out[out.length - 1];
        if (last && last.who === 'chef' && last.kind === 'text' && last.id === id) last.text += '\n' + b.text.trim();
        else out.push({ who: 'chef', kind: 'text', text: clip(b.text, 8000), at, id });
      } else if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) {
        const i = b.input || {};
        const agent = i.subagent_type || 'general-purpose';
        missions.set(b.id, agent);
        out.push({ who: 'mission', kind: 'mission', agent, text: clip(`${i.description ? i.description + '\n\n' : ''}${i.prompt || ''}`), at });
      } else if (b.type === 'tool_use' && b.name) {
        out.push({ who: 'chef', kind: 'action', text: toolLine(b.name, b.input), at });
      }
    }
  }
  return out;
}

// Ce que disent et font les sous-agents : <journal sans .jsonl>/subagents/agent-*.jsonl.
function subMsgs(file) {
  const dir = path.join(file.replace(/\.jsonl$/i, ''), 'subagents');
  let names;
  try { names = fs.readdirSync(dir).filter(n => /^agent-.*\.jsonl$/.test(n)); } catch { return []; }
  const files = names.map(n => { try { return { n, m: fs.statSync(path.join(dir, n)).mtimeMs }; } catch { return null; } }).filter(Boolean)
    .sort((a, b) => b.m - a.m).slice(0, MAX_SUBS);
  const out = [];
  for (const { n } of files) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, n.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch { /* pas de fiche */ }
    let t;
    try { t = tailLines(path.join(dir, n), SUB_TAIL); } catch { continue; }
    const agent = meta.agentType || 'agent';
    const mine = [];
    for (const line of t.lines) {
      if (!line.includes('"assistant"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
      const at = Date.parse(o.timestamp) || 0;
      for (const b of o.message.content) {
        if (b && b.type === 'text' && b.text && b.text.trim()) mine.push({ who: 'agent', kind: 'text', agent, text: clip(b.text), at });
        else if (b && b.type === 'tool_use' && b.name) mine.push({ who: 'agent', kind: 'action', agent, text: toolLine(b.name, b.input), at });
      }
    }
    // Son dernier texte est son rapport : il arrive deja par le chef.
    for (let i = mine.length - 1; i >= 0; i--) if (mine[i].kind === 'text') { mine.splice(i, 1); break; }
    out.push(...mine);
  }
  return out;
}

// Les derniers messages de la discussion (n au plus), journal principal et sous-agents, dans l'ordre.
function readChat(file, n = 60) {
  let t;
  try { t = tailLines(file, TAIL); } catch { return { ok: false, error: 'Journal de la session illisible.', messages: [] }; }
  const all = [...mainMsgs(t.lines, new Map()), ...subMsgs(file)];
  all.forEach((m, i) => { m.i = i; });
  all.sort((a, b) => (a.at - b.at) || (a.i - b.i));
  return { ok: true, messages: all.slice(-n).map(({ id, i, ...m }) => m), size: t.size };
}

const lineToMsg = (line) => mainMsgs([line], new Map())[0] || null;

// ---- envoyer un message ------------------------------------------------------------------------
// Chaque message relance la session sans fenetre : claude -p --resume <id>, le message sur l'entree
// standard (aucun souci de guillemets). Un seul processus a la fois par session : ce que tu ecris
// pendant qu'elle travaille attend son tour. La session garde tout son historique d'un message a l'autre.
//
// Sans fenetre, Claude Code ne peut rien demander lui-meme : --permission-prompts none fait passer
// chaque autorisation par le hook PermissionRequest (hooks/tower-ask.js), et tu reponds dans la tour.
// L'outil AskUserQuestion n'existe pas dans ce mode : l'agent pose ses questions dans la discussion.
const ARGS = ['--permission-prompts', 'none', '--output-format', 'stream-json', '--verbose'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 20_000;

function create(state, { launchEnv, run } = {}) {
  const procs = new Map(); // session -> processus en cours
  const queue = new Map(); // session -> messages en attente

  // Lance claude dans le dossier du projet. run est remplace dans les tests.
  run = run || ((args, cwd, input) => {
    const win = process.platform === 'win32';
    const child = win
      ? spawn('cmd.exe', ['/d', '/s', '/c', 'claude', ...args], { cwd, windowsHide: true, env: launchEnv ? launchEnv() : process.env })
      : spawn('claude', args, { cwd, env: launchEnv ? launchEnv() : process.env });
    child.stdin.end(input, 'utf8');
    return child;
  });

  function chatOf(a) {
    if (!a.chat) a.chat = { mode: 'tour', busy: false, queued: 0, error: '', at: 0 };
    return a.chat;
  }

  function go(sessionId) {
    const a = state.agents[sessionId];
    const q = queue.get(sessionId) || [];
    if (!a || procs.has(sessionId) || !q.length) return;
    const { text, fresh } = q.shift();
    const c = chatOf(a);
    c.queued = q.length;
    c.busy = true;
    c.error = '';
    c.at = state.now();
    a.status = 'working';
    a.lastSeen = state.now();
    const args = ['-p', ...(fresh ? ['--session-id', sessionId] : ['--resume', sessionId]), ...ARGS];
    let child, err = '', out = '';
    try { child = run(args, a.cwd, text); } catch (e) { c.busy = false; c.error = `Claude Code ne démarre pas : ${e.message}`; a.status = 'idle'; state.changed(); return; }
    procs.set(sessionId, child);
    if (child.stderr) child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    // La derniere ligne « result » dit si le tour a echoue (credit, contexte plein...).
    if (child.stdout) child.stdout.on('data', d => { out = (out + d).slice(-20000); });
    const done = (code) => {
      if (procs.get(sessionId) !== child) return;
      procs.delete(sessionId);
      const cur = state.agents[sessionId];
      if (cur) {
        const k = chatOf(cur);
        k.busy = false;
        let res = null;
        for (const l of out.split(/\r?\n/).reverse()) { if (l.startsWith('{"type":"result"')) { try { res = JSON.parse(l); } catch { /* ligne coupee */ } break; } }
        if (k.stopped) { k.stopped = false; k.error = 'Arrêté depuis la tour.'; }
        else if (code && code !== 0 || (res && res.is_error)) k.error = String((res && (res.result || res.subtype)) || err.trim().split(/\r?\n/).pop() || `Claude Code s'est arrêté (code ${code}).`).slice(0, 300);
        if (cur.status === 'working') cur.status = 'idle';
        cur.lastSeen = state.now();
      }
      state.changed();
      go(sessionId);
    };
    child.on('error', (e) => { err += e.message; done(1); });
    child.on('close', done);
    state.changed();
  }

  // Une nouvelle session, sans fenetre : la tour choisit son id pour la retrouver tout de suite.
  function start({ cwd, text, label }) {
    if (!cwd) return { ok: false, error: 'Aucun projet connecté : connecte d\'abord ton projet.' };
    const t = String(text || '').trim().slice(0, MAX_TEXT);
    if (!t) return { ok: false, error: 'Le message est vide.' };
    const id = crypto.randomUUID();
    const a = state.agent(id, cwd);
    chatOf(a);
    if (label) a.label = String(label).slice(0, 60);
    a.prompt = t.slice(0, 240);
    queue.set(id, [{ text: t, fresh: true }]);
    go(id);
    return { ok: true, sessionId: id };
  }

  // Ce qu'on peut faire avec une session : discuter dans la tour (sa session sans fenetre, ou une
  // session fermee qu'on reprend ici), ou seulement lire (elle tourne dans une fenetre).
  function canChat(a) {
    if (!a || !UUID.test(a.sessionId) || !a.cwd) return false;
    return !!(a.chat && a.chat.mode === 'tour') || a.status === 'ended';
  }

  function send(sessionId, text) {
    const a = state.agents[sessionId];
    if (!a) return { ok: false, error: 'Session inconnue.' };
    if (!canChat(a)) return { ok: false, error: 'Cette session est ouverte dans sa fenêtre : écris-lui là-bas, ou ferme la fenêtre pour la reprendre ici.' };
    const t = String(text || '').trim().slice(0, MAX_TEXT);
    if (!t) return { ok: false, error: 'Le message est vide.' };
    const c = chatOf(a);
    c.mode = 'tour';
    delete a.hidden;
    const q = queue.get(sessionId) || [];
    q.push({ text: t, fresh: false });
    queue.set(sessionId, q);
    const waits = procs.has(sessionId);
    if (!waits) go(sessionId);
    c.queued = (queue.get(sessionId) || []).length;
    state.changed();
    return { ok: true, queued: waits };
  }

  // Arreter le tour en cours (et vider la file) : la session garde son historique.
  function stop(sessionId) {
    const child = procs.get(sessionId);
    queue.delete(sessionId);
    const a = state.agents[sessionId];
    if (a && a.chat) a.chat.queued = 0;
    if (!child) { state.changed(); return { ok: false, error: 'Rien ne tourne.' }; }
    if (a) chatOf(a).stopped = true;
    try {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
      else child.kill();
    } catch { /* deja fini */ }
    return { ok: true };
  }

  function read(sessionId, n) {
    const a = state.agents[sessionId];
    if (!a) return { ok: false, error: 'Session inconnue.', messages: [] };
    if (!a.transcript) return { ok: true, messages: [], waiting: true };
    return readChat(a.transcript, n);
  }

  return { start, send, stop, read, canChat, busy: (id) => procs.has(id) };
}

module.exports = { readChat, lineToMsg, create, ARGS };
