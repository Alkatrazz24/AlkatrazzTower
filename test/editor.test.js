'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TowerState } = require('../server/state');

function clock() { let t = 1_000_000; const f = () => t; f.add = (ms) => { t += ms; }; return f; }

test('etat envoye par le plugin, vivant 15 s', () => {
  const now = clock();
  const s = new TowerState(now);
  s.editorState({ project: 'ConquerTheBackrooms', map: 'L_Raid', pie: true, dirty: 3, liveCoding: { enabled: true, compiling: false } });
  assert.strictEqual(s.liveEditor('conquerthebackrooms').map, 'L_Raid');
  assert.strictEqual(s.liveEditor('ConquerTheBackrooms').liveCoding.enabled, true);
  now.add(16_000);
  assert.strictEqual(s.liveEditor('ConquerTheBackrooms'), null, 'plus de nouvelles : editeur considere ferme');
  assert.strictEqual(s.editorState({}), false, 'sans projet, rien');
});

test('un agent qui modifie l\'asset que l\'humain ouvre est signale', () => {
  const now = clock();
  const s = new TowerState(now);
  const file = String.raw`C:\p\Content\CTB\Weapons\BP_Lampe.uasset`;
  s.event({ session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file } });
  s.event({ session_id: 'B', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: file } });
  const hits = s.agentsOnAsset('C:/p/Content/CTB/Weapons/BP_Lampe');
  assert.deepStrictEqual(hits.map(h => h.sessionId), ['A'], 'lire ne compte pas, modifier oui');
  now.add(31 * 60_000);
  assert.strictEqual(s.agentsOnAsset(file).length, 0, 'au-dela de 30 min, plus d\'alerte');
});

test('le fil de l\'editeur reste petit et filtre par projet', () => {
  const s = new TowerState(() => 5000);
  s.event({ session_id: 'A', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Autoriser Build.bat ?' });
  s.agents.A.project = { name: 'CTB', root: 'C:/p' };
  s.event({ session_id: 'B', hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  s.agents.B.project = { name: 'Autre', root: 'C:/q' };
  const t = s.acquire({ sessionId: 'editor:CTB', kind: 'livecoding' });
  assert.strictEqual(t.granted, true);
  const f = s.editorFeed('CTB');
  assert.deepStrictEqual(f.agents.map(a => a.sessionId), ['A']);
  assert.strictEqual(f.agents[0].message, 'Autoriser Build.bat ?');
  assert.strictEqual(f.lock.label, 'Editeur Unreal (CTB)');
  assert.ok(JSON.stringify(f).length < 2000);
});
