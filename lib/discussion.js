'use strict';
// Discuter avec une session depuis la tour : la conversation est lue dans le journal de Claude Code
// (le transcript .jsonl que le hook donne a la tour), lecture seule. Seuls les messages qu'on lit dans
// une conversation sont gardes : tes demandes et ce que l'agent t'ecrit. Pas les outils, pas les
// sous-agents, pas les messages que Claude Code ajoute lui-meme.

const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TAIL = 2 * 1024 * 1024; // la fin du journal suffit : un journal peut peser des dizaines de Mo

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n');
}

// Une ligne du journal -> { who: 'toi' | 'agent', text, at } ou null.
function lineToMsg(line) {
  if (!line || (!line.includes('"user"') && !line.includes('"assistant"'))) return null;
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || o.isSidechain || o.isMeta || !o.message) return null;
  const at = Date.parse(o.timestamp) || 0;
  if (o.type === 'user' && o.message.role === 'user') {
    const c = o.message.content;
    if (Array.isArray(c) && c.some(x => x && x.type === 'tool_result')) return null;
    const text = textOf(c).trim();
    // Messages injectes par Claude Code (commandes, rappels, fin de tache de fond) : pas une demande.
    if (!text || /^<[a-z_-]+[\s>]/i.test(text) || /^\[Request interrupted/.test(text)) return null;
    return { who: 'toi', text: text.slice(0, 8000), at };
  }
  if (o.type === 'assistant') {
    const text = textOf(o.message.content).trim();
    return text ? { who: 'agent', text: text.slice(0, 8000), at, id: o.message.id || o.uuid } : null;
  }
  return null;
}

// Les derniers messages de la conversation (n au plus). Un message de l'agent ecrit en plusieurs
// lignes du journal (un bloc de texte par ligne) est recolle.
function readChat(file, n = 60) {
  let fd;
  try {
    const st = fs.statSync(file);
    fd = fs.openSync(file, 'r');
    const len = Math.min(st.size, TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    let lines = buf.toString('utf8').split(/\r?\n/);
    if (len < st.size) lines = lines.slice(1); // premiere ligne coupee
    const out = [];
    for (const l of lines) {
      const m = lineToMsg(l);
      if (!m) continue;
      const last = out[out.length - 1];
      if (m.who === 'agent' && last && last.who === 'agent' && m.id && last.id === m.id) { last.text += '\n' + m.text; continue; }
      out.push(m);
    }
    return { ok: true, messages: out.slice(-n).map(({ id, ...m }) => m), size: st.size };
  } catch {
    return { ok: false, error: 'Journal de la session illisible.', messages: [] };
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* deja ferme */ } }
}

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
