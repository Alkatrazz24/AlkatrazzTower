'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inventory, roomForPath } = require('../lib/inventory');
const { TowerState } = require('../server/state');

test('piece d\'un fichier touche par un agent', () => {
  assert.strictEqual(roomForPath(String.raw`C:\p\Source\Jeu\Armes\Lampe.cpp`), 'code');
  assert.strictEqual(roomForPath(String.raw`C:\p\Source\Jeu\Tests\LampeTests.cpp`), 'tests');
  assert.strictEqual(roomForPath('C:/p/Content/Jeu/Anims/AM_Recharge.uasset'), 'animations');
  assert.strictEqual(roomForPath('C:/p/Content/Jeu/UI/WBP_Menu.uasset'), 'interface');
  assert.strictEqual(roomForPath('C:/p/Content/Jeu/Maps/Raid.umap'), 'niveaux');
  assert.strictEqual(roomForPath('C:/p/Content/Jeu/Audio/Pas.uasset'), 'sons', 'sans prefixe, le dossier decide');
  assert.strictEqual(roomForPath('C:/p/README.md'), null);
});

test('inventaire d\'un petit projet', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-inv-'));
  const w = (rel, txt = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
  w('Jeu.uproject', '{"EngineAssociation":"5.8"}');
  w('Content/Jeu/BP_Porte.uasset'); w('Content/Jeu/BP_Lampe.uasset');
  w('Content/Jeu/Anims/AM_Tir.uasset'); w('Content/Pack/T_Mur.uasset');
  w('Content/Jeu/Maps/Raid.umap');
  w('Content/Jeu/Mystere.uasset', 'entete\u0000Blueprint\u0000BlueprintGeneratedClass\u0000StaticMesh\u0000');
  w('Content/__ExternalActors__/Raid/A1.uasset');
  w('Source/Jeu/Lampe.cpp', 'UCLASS()\nclass ULampe {};\n');
  w('Source/Jeu/Tests/LampeTests.cpp', 'IMPLEMENT_SIMPLE_AUTOMATION_TEST(A, "Jeu.Lampe.A", 0)\nIMPLEMENT_SIMPLE_AUTOMATION_TEST(B, "Jeu.Lampe.B", 0)\n');
  const inv = inventory({ name: 'Jeu', root, engine: '5.8' });
  const n = (id) => inv.rooms[id].count;
  assert.strictEqual(inv.assets, 6, 'les morceaux de World Partition ne comptent pas');
  assert.strictEqual(n('blueprints'), 3, 'le Blueprint sans prefixe est reconnu a son en-tete');
  assert.strictEqual(n('animations'), 1);
  assert.strictEqual(n('textures'), 1);
  assert.strictEqual(n('niveaux'), 1);
  assert.strictEqual(n('code'), 1);
  assert.strictEqual(n('tests'), 2, 'deux tests dans un fichier');
  assert.deepStrictEqual([inv.code.classes, inv.code.tests], [1, 2]);
  assert.strictEqual(inv.rooms.blueprints.recent, 3);
  assert.deepStrictEqual(inv.rooms.blueprints.folders[0], { name: 'Jeu', n: 3 });
});

test('l\'agent est place devant la piece du fichier qu\'il touche', () => {
  const s = new TowerState(() => 1);
  s.event({ session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/p/Source/Jeu/Lampe.cpp' } });
  assert.strictEqual(s.agents.A.room, 'code');
  s.event({ session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'x', path: 'C:/p/Content/Jeu/Anims' } });
  assert.strictEqual(s.agents.A.room, 'animations');
  s.event({ session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
  assert.strictEqual(s.agents.A.room, 'animations', 'une commande sans fichier ne le deplace pas');
});
