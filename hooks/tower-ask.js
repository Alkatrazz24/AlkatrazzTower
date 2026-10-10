#!/usr/bin/env node
'use strict';
// Hook des questions : quand un agent pose une question a ali (AskUserQuestion) ou demande une
// permission, la question part dans la tour, et ali y repond d'un clic.
//
// Branche sur PreToolUse (AskUserQuestion) et PermissionRequest (voir scripts/install-hooks.js).
// Le hook attend la reponse de la tour au plus TOWER_ASK_WAIT secondes (10 min par defaut) :
//   - reponse dans la tour : la question ne s'affiche pas dans la fenetre, l'agent recoit la reponse ;
//   - « Dans sa fenetre », delai depasse, tour eteinte ou erreur : le hook sort sans rien dire et la
//     question s'affiche dans la fenetre comme d'habitude.
// Il sort toujours avec le code 0 et n'ecrit sur stdout que la reponse d'ali.
//
// Seules les sessions lancees par la tour (panneau Taches) passent par lui : elles portent TOWER_ASK=1
// (lib/taches.js). Une session ouverte a la main, ou celle du fil PC, garde ses questions dans sa
// fenetre, sans attente. Pour l'activer ailleurs, lancer claude avec TOWER_ASK=1.

const { post } = require('../lib/client');

const WAIT_S = Math.max(5, Number(process.env.TOWER_ASK_WAIT) || 600);
const POLL_MS = 20_000;

function quit() { process.exit(0); }
setTimeout(quit, (WAIT_S + 30) * 1000).unref();
process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);

// Ce que l'agent recoit quand ali a repondu dans la tour.
function output(ev, ans) {
  if (ev.hook_event_name === 'PermissionRequest') {
    const decision = ans.decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'ali a refusé depuis Alkatrazz Tower. Ne relance pas cette action : demande à ali ce qui lui convient, ou fais autrement.' };
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  // AskUserQuestion : la reponse arrive comme raison du refus de l'outil, que l'agent lit.
  const lines = Object.entries(ans.answers || {}).map(([q, a]) => `- « ${q} » : ${a}`);
  const permissionDecisionReason = `ali a répondu depuis Alkatrazz Tower (la question ne s'affiche donc pas ici, ne la repose pas) :\n${lines.join('\n')}\nContinue avec ces réponses.`;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason } };
}

// La question telle que la tour l'affiche.
function request(ev) {
  const ti = ev.tool_input && typeof ev.tool_input === 'object' ? ev.tool_input : {};
  const base = { sessionId: ev.session_id, cwd: ev.cwd };
  if (ev.hook_event_name === 'PermissionRequest') {
    const { toolSummary } = require('../server/state');
    return { ...base, kind: 'permission', tool: ev.tool_name || '', summary: toolSummary(ev.tool_name, ti) };
  }
  return { ...base, kind: 'question', questions: Array.isArray(ti.questions) ? ti.questions : [] };
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  let ev;
  try { ev = JSON.parse(raw.replace(/^﻿/, '')); } catch { return quit(); }
  if (!ev || !ev.session_id || process.env.TOWER_OFF === '1' || process.env.TOWER_ASK !== '1') return quit();
  const isPerm = ev.hook_event_name === 'PermissionRequest';
  if (!isPerm && !(ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion')) return quit();
  // AskUserQuestion passe par sa propre permission : on n'ouvre pas deux fois la meme question.
  if (isPerm && ev.tool_name === 'AskUserQuestion') return quit();

  const opened = await post('/api/ask/open', request(ev), 800);
  if (!opened || !opened.id) return quit();
  const deadline = Date.now() + WAIT_S * 1000;
  let misses = 0;
  while (Date.now() < deadline) {
    const left = Math.min(POLL_MS, deadline - Date.now());
    const st = await post('/api/ask/wait', { id: opened.id, timeoutMs: left }, left + 5000);
    if (!st) { // tour qui redemarre : on reessaie un peu, puis la question passe dans la fenetre
      if (++misses >= 5) return quit();
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    misses = 0;
    if (st.lost) return quit();
    if (st.answered) {
      if (st.decision === 'window') return quit();
      process.stdout.write(JSON.stringify(output(ev, st)), quit);
      return;
    }
  }
  await post('/api/ask/close', { id: opened.id }, 800);
  quit();
}

if (require.main === module) main().catch(quit);

module.exports = { output, request };
