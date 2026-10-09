'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { docRead, docsContext, docLinks } = require('../lib/unreal');
const { TowerState } = require('../server/state');

test('reconnait une lecture de la doc Unreal ou des en-tetes du moteur', () => {
  assert.strictEqual(docRead('WebFetch', { url: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/logging-in-unreal-engine?application_version=5.8' }).kind, 'doc');
  assert.strictEqual(docRead('Read', { file_path: String.raw`C:\Program Files\Epic Games\UE_5.8\Engine\Source\Runtime\Engine\Classes\GameFramework\Actor.h` }).kind, 'source');
  assert.strictEqual(docRead('Grep', { pattern: 'UCLASS', path: String.raw`C:\Program Files\Epic Games\UE_5.8\Engine\Plugins\Runtime\GameplayAbilities` }).kind, 'source');
  assert.strictEqual(docRead('Bash', { command: 'grep -rn "BeginPlay" "/c/Program Files/Epic Games/UE_5.8/Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h"' }).kind, 'source');
  assert.strictEqual(docRead('Read', { file_path: 'C:/projet/Source/Arme.cpp' }), null);
  assert.strictEqual(docRead('WebFetch', { url: 'https://example.com' }), null);
});

test('consigne de debut de session : version du projet et liens epingles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-ue-'));
  const up = path.join(dir, 'Jeu.uproject');
  fs.writeFileSync(up, JSON.stringify({ EngineAssociation: '5.8' }));
  const txt = docsContext({ name: 'Jeu', root: dir, uproject: up });
  assert.match(txt, /Unreal Engine 5\.8 detecte : Jeu/);
  assert.match(txt, /AVANT toute modification/);
  assert.match(txt, /unreal-engine-5-8-documentation\?application_version=5\.8/);
  assert.ok(docLinks('5.8').every(([, u]) => u.endsWith('?application_version=5.8')));
});

test('la fiche compte les lectures de doc et les modifications', () => {
  const s = new TowerState(() => 1000);
  const ev = (e) => s.event({ session_id: 'S', hook_event_name: 'PostToolUse', ...e });
  ev({ tool_name: 'Edit', tool_input: { file_path: 'C:/p/Source/A.cpp' } });
  ev({ tool_name: 'WebFetch', tool_input: { url: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/API' } });
  assert.strictEqual(s.agents.S.edits, 1);
  assert.strictEqual(s.agents.S.docs.count, 1);
});
