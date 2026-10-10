'use strict';
// Suivi d'une tache lancee depuis la tour : ce que l'agent a fait (journal tire des hooks), ce qu'il
// reste a faire et ses questions (bloc « ## Suivi » qu'il ecrit a la fin, demande par la consigne),
// et les fichiers qu'il a ecrits dans Saved/Tour (rapports, plans), lisibles depuis la page.

const fs = require('fs');
const path = require('path');

// Ajoute a toute consigne de tache (de base ou perso) : la tour lit ce bloc dans le dernier message.
const CONSIGNE = `Pour finir, termine ton dernier message par ce bloc, tel quel, que la tour affiche à ali :

## Suivi
Fait :
- (ce que tu as fait, une ligne par point)
À faire :
- (ce qu'il reste à faire, du plus utile au moins utile)
Questions pour ali :
- (ce dont tu as besoin de sa part, ou « aucune »)
Rapport : (chemin du fichier que tu as écrit, ou « aucun »)`;

const MAX_ITEMS = 12;
const MAX_FILES = 20;
const MAX_STEPS = 30;
const MAX_READ = 300_000;

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const isTowerFile = (p) => /(^|[\\/])Saved[\\/]Tour[\\/]/i.test(String(p || ''));
const empty = (s) => /^(aucune?s?|rien|néant|neant|none|-|\.)\.?$/i.test(String(s).trim()) || /^\(.*\)$/.test(String(s).trim());

// Lit le bloc « ## Suivi » d'un message. null s'il n'y en a pas.
function parse(text) {
  const src = String(text || '');
  const m = /^[ \t]*#{1,4}[ \t]*suivi\b.*$/im.exec(src);
  if (!m) return null;
  const out = { fait: [], afaire: [], questions: [], rapport: '' };
  let cur = null;
  for (const raw of src.slice(m.index + m[0].length).split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, '').trim();
    if (!line) continue;
    if (/^#{1,4}\s/.test(line)) break; // titre suivant : fin du bloc
    const sec = /^(fait|[aà] faire|questions?(?:\s+pour\s+[^:]*)?|rapports?)\s*:\s*(.*)$/i.exec(line);
    if (sec) {
      const k = sec[1].toLowerCase();
      cur = k.startsWith('fait') ? 'fait' : /faire$/.test(k) ? 'afaire' : k.startsWith('question') ? 'questions' : 'rapport';
      const v = sec[2].trim();
      if (cur === 'rapport') { if (v && !empty(v)) out.rapport = clip(v.replace(/^`|`$/g, ''), 300); }
      else if (v && !empty(v)) out[cur].push(clip(v, 300));
      continue;
    }
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    const v = item ? item[1] : line;
    if (!cur || empty(v)) continue;
    if (cur === 'rapport') { if (!out.rapport) out.rapport = clip(v.replace(/^`|`$/g, ''), 300); continue; }
    if (out[cur].length < MAX_ITEMS) out[cur].push(clip(v, 300));
  }
  return out.fait.length || out.afaire.length || out.questions.length || out.rapport ? out : null;
}

function start(id, title, at) {
  return { id, title, at, doneAt: null, counts: { reads: 0, edits: 0, cmds: 0 }, files: [], steps: [], questions: [], last: '', suivi: null };
}

// Met a jour le suivi de la tache d'un agent avec un evenement de hook.
function track(task, ev, t) {
  if (!task) return;
  // Tache suivie avant l'arrivee du suivi (etat enregistre par une ancienne version de la tour).
  if (!task.counts) Object.assign(task, { ...start(task.id, task.title, task.at), ...task, counts: { reads: 0, edits: 0, cmds: 0 } });
  const name = ev.tool_name || '';
  const input = ev.tool_input || {};
  switch (ev.hook_event_name) {
    case 'UserPromptSubmit':
      if (task.at !== t) task.doneAt = null; // ali a repondu : la tache reprend
      break;
    case 'PostToolUse': {
      if (/^(Read|Grep|Glob|LS)$/.test(name)) task.counts.reads++;
      else if (/^(Bash|PowerShell)$/.test(name)) {
        task.counts.cmds++;
        const cmd = clip(input.command, 140);
        if (cmd) task.steps = [...task.steps, { text: cmd, at: t }].slice(-MAX_STEPS);
      } else if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) {
        const p = String(input.file_path || input.notebook_path || input.path || '');
        if (!p) break;
        if (!isTowerFile(p)) task.counts.edits++;
        const prev = task.files.find(f => f.path === p);
        if (prev) { prev.at = t; prev.n = (prev.n || 1) + 1; if (name === 'Write' && prev.tool !== 'Write') prev.tool = name; }
        else task.files = [...task.files, { path: p, tool: name, at: t, tower: isTowerFile(p), n: 1 }].slice(-MAX_FILES);
      }
      break;
    }
    case 'Notification':
      if (ev.notification_type !== 'idle_prompt' && ev.message) {
        const q = clip(ev.message, 240);
        if (!task.questions.length || task.questions[task.questions.length - 1].text !== q) task.questions = [...task.questions, { text: q, at: t }].slice(-8);
      }
      break;
    case 'Stop': {
      task.doneAt = t;
      const msg = String(ev.last_assistant_message || '');
      if (msg) {
        task.last = msg.length > 4000 ? msg.slice(0, 3999) + '…' : msg;
        const s = parse(msg);
        if (s) task.suivi = s;
      }
      break;
    }
    case 'SessionEnd':
      if (!task.doneAt) task.doneAt = t;
      break;
    default:
      break;
  }
}

// Fichier ecrit par l'agent dans Saved/Tour de son projet, a lire depuis la page. Rien d'autre.
function readFile(agent, rel) {
  const task = agent && agent.task;
  if (!task) return { ok: false, error: 'Cet agent n\'a pas de tâche.' };
  const known = (task.files || []).some(f => f.path === rel) || (task.suivi && task.suivi.rapport === rel);
  if (!known) return { ok: false, error: 'Fichier inconnu pour cette tâche.' };
  const root = agent.project && agent.project.root ? agent.project.root : agent.cwd;
  if (!root) return { ok: false, error: 'Dossier du projet inconnu.' };
  const base = path.resolve(root, 'Saved', 'Tour');
  const abs = path.resolve(agent.cwd || root, rel);
  if (!abs.toLowerCase().startsWith(base.toLowerCase() + path.sep)) return { ok: false, error: 'Seuls les fichiers de Saved/Tour se lisent ici.' };
  if (!/\.(md|txt|log|json)$/i.test(abs)) return { ok: false, error: 'Type de fichier non lisible ici.' };
  try {
    const st = fs.statSync(abs);
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return { ok: true, path: rel, text: buf.toString('utf8'), cut: st.size > MAX_READ, mtime: st.mtimeMs };
  } catch (e) {
    return { ok: false, error: e.code === 'ENOENT' ? 'Le fichier n\'existe plus.' : e.message };
  }
}

module.exports = { CONSIGNE, parse, start, track, readFile, isTowerFile };
