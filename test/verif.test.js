'use strict';
// Verification de fin de tache : la tour compile et lance les tests quand une tache se termine.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const verif = require('../lib/verif');

const settle = () => new Promise(r => setTimeout(r, 30));

function project({ script = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-verif-'));
  fs.writeFileSync(path.join(root, 'CTB.uproject'), '{}');
  if (script) { fs.mkdirSync(path.join(root, 'tools')); fs.writeFileSync(path.join(root, 'tools', 'tests.ps1'), ''); }
  return root;
}

// Une tour, un projet, et des commandes simulees : chaque appel rend le resultat qu'on lui prepare.
function tower({ open = false, results = {}, script = true } = {}) {
  const root = project({ script });
  const s = new TowerState();
  s.projects = [{ name: 'CTB', root }];
  const ran = [];
  const editor = { open };
  const v = verif.create(s, {
    planFor: (a) => verif.plan(a.project, { engine: 'C:\\UE', testGroups: s.testGroups }),
    editorOpen: () => editor.open,
    run: async (cmd, o) => {
      ran.push(cmd);
      const step = /tests\.ps1|RunTests/.test(cmd) ? 'tests' : / CTBEditor /.test(cmd) ? 'editeur' : 'jeu';
      const r = results[step] || { ok: true, summary: 'compile' };
      s.report({ sessionId: o.session, kind: o.kind, project: 'CTB', command: cmd }, r);
      return r.ok ? 0 : 1;
    },
  });
  return { s, v, ran, editor, root };
}

// Une tache qui modifie le projet, puis finit avec son bloc « Suivi ».
function finishTask(s, root, sid = 'K') {
  s.event({ session_id: sid, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [perso-coup-de-pied] : lis la consigne' });
  s.event({ session_id: sid, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'Source', 'Porte.cpp') } });
  s.event({ session_id: sid, cwd: root, hook_event_name: 'Stop', last_assistant_message: 'Fini.\n\n## Suivi\nFait :\n- coup de pied\nÀ faire :\n- aucune\nQuestions pour ali :\n- aucune\nRapport : aucun' });
}

test('les commandes : scripts du projet d\'abord, sinon le moteur et le groupe de tests le plus vu', () => {
  const root = project();
  const p = verif.plan({ name: 'CTB', root }, { engine: 'C:\\UE' });
  assert.match(p.editor, /Build\.bat" CTBEditor Win64 Development "-project=.*CTB\.uproject" -waitmutex$/);
  assert.match(p.game, /Build\.bat" CTB Win64/);
  assert.match(p.tests, /tools\\tests\.ps1"$/);

  const bare = project({ script: false });
  assert.strictEqual(verif.plan({ name: 'CTB', root: bare }, { engine: 'C:\\UE' }).tests, null);
  const p2 = verif.plan({ name: 'CTB', root: bare }, { engine: 'C:\\UE', testGroups: { CTB: { 'Jeu.Portes': 3, 'CTB.Armes': 9, 'CTB.Armes.Tir': 4 } } });
  assert.match(p2.tests, /UnrealEditor-Cmd\.exe" ".*CTB\.uproject" "-ExecCmds=Automation RunTests CTB; Quit"/);
  assert.strictEqual(verif.plan({ name: 'X', root: os.tmpdir() + '/absent' }).error, 'Projet Unreal introuvable.');
});

test('editeur ferme : la fin de tache lance la cible Editeur puis les tests, et le verdict va sur la tache', async () => {
  const { s, ran, root } = tower({ results: { tests: { ok: true, summary: '10/10 tests', tests: { total: 10, failed: 0, passed: 10, passedPaths: [], failedPaths: [] } } } });
  finishTask(s, root);
  await settle();
  const v = s.agents.K.task.verif;
  assert.deepStrictEqual(v.steps.map(x => [x.id, x.state]), [['editeur', 'ok'], ['tests', 'ok']]);
  assert.strictEqual(v.state, 'ok');
  assert.strictEqual(v.auto, true);
  assert.strictEqual(ran.length, 2);
  assert.match(ran[0], /CTBEditor/);
  assert.strictEqual(s.builds[0].label, 'verif de fin de tache, ' + s.label('K'));
});

test('editeur ouvert : cible Jeu tout de suite, le reste attend qu\'il soit ferme, sans jamais le fermer', async () => {
  const { s, ran, root, editor } = tower({ open: true });
  finishTask(s, root);
  await settle();
  let v = s.agents.K.task.verif;
  assert.deepStrictEqual(v.steps.map(x => [x.id, x.state]), [['jeu', 'ok'], ['editeur', 'waiting'], ['tests', 'waiting']]);
  assert.strictEqual(v.state, 'waiting');
  assert.strictEqual(ran.length, 1);
  assert.doesNotMatch(ran[0], /CTBEditor|Stop-Process|cycle_editeur/);
  editor.open = false;
  s.editor = { open: false };
  s.changed();
  await settle();
  v = s.agents.K.task.verif;
  assert.deepStrictEqual(v.steps.map(x => x.state), ['ok', 'ok', 'ok']);
  assert.strictEqual(v.state, 'ok');
});

test('un build rouge arrete la verification ; un test deja rouge avant la tache ne la fait pas echouer', async () => {
  const red = { ok: false, summary: '9/10 tests', tests: { total: 10, failed: 1, passed: 9, passedPaths: [], failedPaths: ['CTB.Ragdoll.Tombe'] } };
  const a = tower({ results: { tests: red } });
  a.s.redTests.CTB = ['CTB.Ragdoll.Tombe'];
  finishTask(a.s, a.root);
  await settle();
  let v = a.s.agents.K.task.verif;
  assert.strictEqual(v.state, 'ok');
  assert.deepStrictEqual(v.steps[1].oldFailures, ['CTB.Ragdoll.Tombe']);
  assert.deepStrictEqual(v.steps[1].newFailures, []);

  const b = tower({ results: { tests: red } });
  finishTask(b.s, b.root);
  await settle();
  v = b.s.agents.K.task.verif;
  assert.strictEqual(v.state, 'fail');
  assert.deepStrictEqual(v.steps[1].newFailures, ['CTB.Ragdoll.Tombe']);
  assert.deepStrictEqual(b.s.redTests.CTB, ['CTB.Ragdoll.Tombe']); // retenu pour la prochaine fois

  const c = tower({ results: { editeur: { ok: false, summary: 'echec de compilation', errorLines: ['Porte.cpp(12): error C2065'] } } });
  finishTask(c.s, c.root);
  await settle();
  v = c.s.agents.K.task.verif;
  assert.deepStrictEqual(v.steps.map(x => x.state), ['fail', 'skipped']);
  assert.deepStrictEqual(v.steps[0].errorLines, ['Porte.cpp(12): error C2065']);
  assert.strictEqual(c.ran.length, 1);
});

test('pas de verification automatique pour une tache qui n\'a rien modifie, ni sans bloc Suivi ; le bouton la lance', async () => {
  const { s, v, ran, root } = tower();
  s.event({ session_id: 'R', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [relecture] : lis la consigne' });
  s.event({ session_id: 'R', cwd: root, hook_event_name: 'Stop', last_assistant_message: '## Suivi\nFait :\n- relu' });
  s.event({ session_id: 'N', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [perso-x] : go' });
  s.event({ session_id: 'N', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'Source', 'A.cpp') } });
  s.event({ session_id: 'N', cwd: root, hook_event_name: 'Stop', last_assistant_message: 'Une question : K ou F ?' });
  await settle();
  assert.strictEqual(ran.length, 0);
  assert.strictEqual(s.agents.N.task.verif, undefined);
  assert.deepStrictEqual(v.start('N'), { ok: true });
  await settle();
  assert.strictEqual(s.agents.N.task.verif.state, 'ok');
  assert.strictEqual(s.agents.N.task.verif.auto, false);
  assert.strictEqual(v.start('inconnu').ok, false);
});

test('la consigne des taches dit que la tour verifie et qu\'on ne ferme jamais l\'editeur', () => {
  assert.match(require('../lib/suivi').CONSIGNE, /la tour compile le projet et lance la suite de tests/);
  assert.match(require('../lib/suivi').CONSIGNE, /ne le ferme jamais/);
});
