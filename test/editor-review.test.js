'use strict';
// Defauts trouves a la relecture du plugin Unreal, verrouilles par des tests.
const test = require('node:test');
const assert = require('node:assert');
const { TowerState } = require('../server/state');
const { slim } = require('../hooks/tower-hook');

test('le hook releve les chemins /Game/... cites par un appel MCP ou un script', () => {
  const ev = slim({
    session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'mcp__unreal-mcp__call_tool',
    tool_input: { toolset: 'BlueprintTools', method: 'AddVariable', args: { Blueprint: '/Game/CTB/Weapons/BP_Lampe.BP_Lampe', Name: 'Charge' } },
  });
  assert.deepStrictEqual(ev.game_paths, ['/Game/CTB/Weapons/BP_Lampe']);
  assert.strictEqual(slim({ session_id: 'A', tool_input: { command: 'git status' } }).game_paths, undefined);
});

test('ouvrir un asset qu\'un agent travaille par MCP declenche l\'alerte', () => {
  const s = new TowerState(() => 1000);
  s.event({ session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'mcp__unreal-mcp__call_tool', game_paths: ['/Game/CTB/Weapons/BP_Lampe'] });
  const hits = s.agentsOnAsset('C:/p/Content/CTB/Weapons/BP_Lampe.uasset', '/Game/CTB/Weapons/BP_Lampe');
  assert.deepStrictEqual(hits.map(h => h.sessionId), ['A']);
  assert.strictEqual(s.agentsOnAsset('C:/p/Content/CTB/Autre.uasset', '/Game/CTB/Autre').length, 0);
});

test('un ticket encore en file rendu avec son resultat est garde dans l\'historique', () => {
  const s = new TowerState(() => 1000);
  const agent = s.acquire({ sessionId: 'A', kind: 'build' });
  const lc = s.acquire({ sessionId: 'editor:CTB', kind: 'livecoding' });
  assert.strictEqual(lc.granted, false);
  s.release(lc.ticket, { ok: false, exitCode: 1, summary: 'echec de compilation' });
  assert.strictEqual(s.builds[0].kind, 'livecoding');
  assert.strictEqual(s.builds[0].how, 'unlocked');
  assert.strictEqual(s.ticketStatus(agent.ticket).granted, true, 'l\'agent garde la forge');
  assert.strictEqual(s.queue.length, 0);
});

test('le fil de l\'editeur ne donne que le dernier build de son projet', () => {
  const s = new TowerState(() => 1000);
  const a = s.acquire({ sessionId: 'A', kind: 'build' });
  s.lock.project = 'CTB';
  s.release(a.ticket, { ok: true, summary: 'compile' });
  const b = s.acquire({ sessionId: 'B', kind: 'build' });
  s.lock.project = 'Autre';
  s.release(b.ticket, { ok: false, summary: 'echec' });
  const feed = s.editorFeed('CTB');
  assert.strictEqual(feed.lastBuild.sessionId, 'A');
  assert.strictEqual(feed.lastBuild.project, 'CTB');
});
