#!/usr/bin/env node
'use strict';
// Hook Claude Code unique de la tour. Branche sur tous les evenements (voir scripts/install-hooks.js).
//
// Regle d'or : ce hook ne gene JAMAIS un agent. Il sort toujours avec le code 0, abandonne au bout
// de 400 ms si la tour ne repond pas, et n'ecrit rien sur stdout sauf pour emballer un build.

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'bin', 'tower-run.js');
const BUDGET_MS = 400;

function quit() { process.exit(0); }
// Filet de securite : quoi qu'il arrive, on rend la main.
setTimeout(quit, 1500).unref();
process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);

// Garde seulement ce que la tour affiche : pas de contenu de fichier, pas de reponse d'outil.
function slim(ev) {
  // Heure de l'evenement : les hooks asynchrones peuvent arriver dans le desordre.
  const out = { ts: Date.now() };
  for (const k of ['session_id', 'cwd', 'hook_event_name', 'tool_name', 'prompt', 'message', 'notification_type',
    'source', 'reason', 'agent_id', 'agent_type', 'error', 'session_title', 'permission_mode', 'model']) {
    if (ev[k] !== undefined) out[k] = typeof ev[k] === 'string' ? ev[k].slice(0, 2000) : ev[k];
  }
  if (ev.last_assistant_message) out.last_assistant_message = String(ev.last_assistant_message).slice(0, 1000);
  const ti = ev.tool_input;
  if (ti && typeof ti === 'object') {
    out.tool_input = {};
    for (const k of ['command', 'file_path', 'pattern', 'url', 'description', 'prompt', 'subagent_type']) {
      if (typeof ti[k] === 'string') out.tool_input[k] = ti[k].slice(0, 500);
    }
  }
  return out;
}

function safeId(s) { return String(s || '').replace(/[^\w-]/g, '').slice(0, 80) || 'inconnu'; }

// Construit la commande qui passe par tower-run. La commande d'origine voyage en base64 :
// aucun probleme de guillemets, dans PowerShell comme dans Bash.
function wrap(tool, cmd, sessionId, kind) {
  const b64 = Buffer.from(cmd, 'utf8').toString('base64');
  const args = `--session ${safeId(sessionId)} --kind ${safeId(kind)} --b64 ${b64}`;
  if (tool === 'PowerShell') {
    return `& "${process.execPath}" "${RUNNER}" --shell powershell ${args}`;
  }
  const fwd = (p) => p.replace(/\\/g, '/');
  return `"${fwd(process.execPath)}" "${fwd(RUNNER)}" --shell bash ${args}`;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  let ev;
  try { ev = JSON.parse(raw); } catch { return quit(); }
  if (!ev || !ev.session_id) return quit();

  // Ne jamais traiter les evenements quand l'utilisateur coupe la tour : TOWER_OFF=1
  if (process.env.TOWER_OFF === '1') return quit();

  const { post } = require('../lib/client');
  const reply = await post('/api/event', slim(ev), BUDGET_MS);

  if (reply && ev.hook_event_name === 'PreToolUse' && (ev.tool_name === 'Bash' || ev.tool_name === 'PowerShell')) {
    const cmd = ev.tool_input && ev.tool_input.command;
    const { classify } = require('../lib/detect');
    const hit = classify(cmd);
    if (hit) {
      const updatedInput = Object.assign({}, ev.tool_input, { command: wrap(ev.tool_name, cmd, ev.session_id, hit.kind) });
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } }), quit);
      return;
    }
  }
  quit();
}

if (require.main === module) main().catch(quit);

module.exports = { wrap, slim };
