'use strict';
// Repondre depuis la tour aux questions des agents (AskUserQuestion) et a leurs demandes de permission.

const test = require('node:test');
const assert = require('node:assert');
const { TowerState } = require('../server/state');
const ask = require('../hooks/tower-ask');
const { towerHooks, strip } = require('../scripts/install-hooks');

const Q = [{ question: 'Quel clip pour le coup de pied ?', header: 'Animation', multiSelect: false,
  options: [{ label: 'Mixamo Mma Kick', description: 'gratuit, a retargeter' }, { label: 'Pack Fab', description: 'payant' }] }];

test('une question ouverte par le hook met la salle en attente, avec ses options', () => {
  const s = new TowerState();
  const id = s.openAsk({ sessionId: 'K', kind: 'question', questions: Q });
  const a = s.agents.K;
  assert.strictEqual(a.status, 'waiting');
  assert.strictEqual(a.message, 'Quel clip pour le coup de pied ?');
  assert.deepStrictEqual(a.ask.questions[0].options.map(o => o.label), ['Mixamo Mma Kick', 'Pack Fab']);
  assert.deepStrictEqual(s.askStatus(id), { pending: true });
  assert.strictEqual(s.openAsk({ sessionId: 'K', kind: 'question', questions: [] }), null);
});

test('la reponse d\'ali arrive au hook une seule fois, et la session repart', () => {
  const s = new TowerState();
  const id = s.openAsk({ sessionId: 'K', kind: 'question', questions: Q });
  assert.strictEqual(s.answerAsk(id, { answers: {} }).ok, false); // il manque la reponse
  assert.deepStrictEqual(s.answerAsk(id, { answers: { 'Quel clip pour le coup de pied ?': 'Pack Fab' } }), { ok: true });
  assert.strictEqual(s.agents.K.status, 'working');
  assert.strictEqual(s.agents.K.ask, undefined);
  const st = s.askStatus(id);
  assert.strictEqual(st.answered, true);
  assert.deepStrictEqual(st.answers, { 'Quel clip pour le coup de pied ?': 'Pack Fab' });
  assert.deepStrictEqual(s.askStatus(id), { lost: true });
  assert.strictEqual(s.answerAsk(id, { answers: {} }).ok, false);
});

test('« Dans sa fenetre » : le hook rend la main, la question reste affichee sans boutons', () => {
  const s = new TowerState();
  const id = s.openAsk({ sessionId: 'K', kind: 'question', questions: Q });
  s.answerAsk(id, { decision: 'window' });
  assert.strictEqual(s.askStatus(id).decision, 'window');
  assert.strictEqual(s.agents.K.ask.window, true);
  assert.strictEqual(s.agents.K.status, 'waiting');
  // repondue dans la fenetre : l'outil a tourne, la question s'efface
  s.event({ session_id: 'K', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' });
  assert.strictEqual(s.agents.K.ask, undefined);
});

test('une permission : autoriser ou refuser depuis la tour', () => {
  const s = new TowerState();
  const id = s.openAsk({ sessionId: 'P', kind: 'permission', tool: 'PowerShell', summary: 'git status' });
  assert.match(s.agents.P.message, /Autorisation : PowerShell git status/);
  assert.strictEqual(s.answerAsk(id, { decision: 'peut-etre' }).ok, false);
  assert.ok(s.answerAsk(id, { decision: 'allow' }).ok);
  assert.strictEqual(s.askStatus(id).decision, 'allow');
});

test('ce que l\'agent recoit : la reponse en clair, ou la decision de permission', () => {
  const out = ask.output({ hook_event_name: 'PreToolUse' }, { answers: { 'Quel clip ?': 'Pack Fab' } });
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /ali a répondu depuis Alkatrazz Tower[\s\S]*« Quel clip \? » : Pack Fab/);
  assert.deepStrictEqual(ask.output({ hook_event_name: 'PermissionRequest' }, { decision: 'allow' }).hookSpecificOutput.decision, { behavior: 'allow' });
  assert.strictEqual(ask.output({ hook_event_name: 'PermissionRequest' }, { decision: 'deny' }).hookSpecificOutput.decision.behavior, 'deny');
  const r = ask.request({ hook_event_name: 'PermissionRequest', session_id: 'P', tool_name: 'Bash', tool_input: { command: 'rm -rf Saved/Tour' } });
  assert.deepStrictEqual([r.kind, r.tool, r.summary], ['permission', 'Bash', 'rm -rf Saved/Tour']);
});

test('les hooks installes : la question et les permissions passent par tower-ask, et se retirent avec le reste', () => {
  const h = towerHooks();
  assert.ok(h.PreToolUse.some(g => g.matcher === 'AskUserQuestion' && /tower-ask\.js/.test(g.hooks[0].command) && g.hooks[0].timeout >= 600));
  assert.ok(/tower-ask\.js/.test(h.PermissionRequest[0].hooks[0].command));
  const mine = { type: 'command', command: 'node mon-hook.js' };
  const left = strip({ ...h, PermissionRequest: [...h.PermissionRequest, { matcher: '*', hooks: [mine] }] });
  assert.deepStrictEqual(left, { PermissionRequest: [{ matcher: '*', hooks: [mine] }] });
});

test('le hook ne bloque jamais quand la tour est eteinte', async () => {
  const { execFile } = require('child_process');
  const path = require('path');
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const p = execFile(process.execPath, [path.join(__dirname, '..', 'hooks', 'tower-ask.js')], { env: { ...process.env, TOWER_PORT: '1' } }, (e) => resolve(e ? e.code : 0));
    p.stdin.end(JSON.stringify({ session_id: 'x', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: Q } }));
  });
  assert.strictEqual(code, 0);
  assert.ok(Date.now() - t0 < 3000);
});
