'use strict';
// Suivi d'une tache lancee depuis la tour : journal des hooks, bloc « ## Suivi », lecture du rapport.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const suivi = require('../lib/suivi');
const taches = require('../lib/taches');

const MSG = [
  'Relecture finie, voici le résumé.', '',
  '## Suivi',
  'Fait :', '- Lu tout le C++', '- **Écrit** le rapport',
  'À faire :', '1. Fermer le chantier ragdoll', '2. Tester la coop à deux',
  'Questions pour ali :', '- aucune',
  'Rapport : `Saved/Tour/rapports/relecture-2026-10-10.md`',
  '', '## Autre chose', '- pas dans le suivi',
].join('\n');

test('le bloc Suivi se lit : fait, a faire, questions vides, rapport', () => {
  assert.deepStrictEqual(suivi.parse(MSG), {
    fait: ['Lu tout le C++', 'Écrit le rapport'],
    afaire: ['Fermer le chantier ragdoll', 'Tester la coop à deux'],
    questions: [],
    rapport: 'Saved/Tour/rapports/relecture-2026-10-10.md',
  });
  assert.strictEqual(suivi.parse('Fini, rien de spécial.'), null);
  assert.deepStrictEqual(suivi.parse('### Suivi\nQuestions : on garde le ragdoll ?').questions, ['on garde le ragdoll ?']);
});

test('toute consigne de tache demande le bloc Suivi', () => {
  assert.match(taches.promptFor(taches.BUILTIN[0], 'CTB'), /## Suivi\nFait :/);
  assert.match(taches.promptFor({ id: 'perso-x', title: 'X', prompt: 'Fais X.' }, 'CTB'), /Questions pour ali :/);
});

test('le journal de la tache : lectures, fichiers, questions, fin, reprise', () => {
  let clock = 1000;
  const s = new TowerState(() => clock);
  const ev = (name, extra = {}) => { clock += 1000; s.event({ session_id: 'R', cwd: '/p/CTB', hook_event_name: name, ts: clock, ...extra }); };
  ev('UserPromptSubmit', { prompt: 'Tache de la tour [relecture] : lis la consigne dans Saved/Tour/taches/relecture.md et suis-la.' });
  ev('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/p/CTB/Source/A.cpp' } });
  ev('PostToolUse', { tool_name: 'Grep', tool_input: { pattern: 'x' }, agent_id: 'sub1', agent_type: 'Explore' });
  ev('PostToolUse', { tool_name: 'Write', tool_input: { file_path: '/p/CTB/Saved/Tour/rapports/r.md' } });
  ev('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: '/p/CTB/Saved/Tour/rapports/r.md' } });
  ev('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Write' });
  const k = s.agents.R.task;
  assert.deepStrictEqual(k.counts, { reads: 2, edits: 0, cmds: 0 });
  assert.strictEqual(k.files.length, 1);
  assert.strictEqual(k.files[0].tower, true);
  assert.strictEqual(s.agents.R.edits, undefined); // un rapport dans Saved/Tour n'est pas une modification du jeu
  assert.strictEqual(k.questions.length, 1);
  ev('Stop', { last_assistant_message: MSG });
  assert.strictEqual(k.doneAt, clock);
  assert.strictEqual(k.suivi.afaire.length, 2);
  // Le rappel « en attente » ne remplace pas ce que l'agent a dit en finissant.
  ev('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.match(s.agents.R.message, /Relecture finie/);
  ev('UserPromptSubmit', { prompt: 'Merci, détaille le point 2' });
  assert.strictEqual(k.doneAt, null);
  assert.strictEqual(s.agents.R.task.id, 'relecture');
});

test('une demande injectee (balise avec _) ne devient pas la demande affichee', () => {
  const s = new TowerState();
  s.event({ session_id: 'P', hook_event_name: 'UserPromptSubmit', prompt: '<project_claude_message session="x">relais</project_claude_message>' });
  assert.strictEqual(s.agents.P.prompt, '');
});

test('l\'ancien nom « Forge » est renomme au chargement', () => {
  const s = new TowerState();
  s.load({ characters: { c1: { id: 'c1', name: 'Forge', look: {} } } });
  assert.strictEqual(s.characters.c1.name, 'Quartz');
});

test('seuls les fichiers de la tache, dans Saved/Tour, se lisent depuis la page', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-suivi-'));
  fs.mkdirSync(path.join(root, 'Saved', 'Tour', 'rapports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Saved', 'Tour', 'rapports', 'r.md'), '# Rapport\n- point');
  fs.writeFileSync(path.join(root, 'secret.md'), 'non');
  const rel = path.join(root, 'Saved', 'Tour', 'rapports', 'r.md');
  const agent = { cwd: root, project: { root }, task: { files: [{ path: rel }, { path: path.join(root, 'secret.md') }, { path: 'Saved/Tour/../../secret.md' }], suivi: { rapport: 'Saved/Tour/rapports/r.md' } } };
  assert.strictEqual(suivi.readFile(agent, rel).text, '# Rapport\n- point');
  assert.strictEqual(suivi.readFile(agent, 'Saved/Tour/rapports/r.md').ok, true); // chemin relatif donne dans le bloc Suivi
  assert.strictEqual(suivi.readFile(agent, path.join(root, 'secret.md')).ok, false);
  assert.strictEqual(suivi.readFile(agent, 'Saved/Tour/../../secret.md').ok, false);
  assert.strictEqual(suivi.readFile(agent, path.join(root, 'autre.md')).ok, false);
  assert.strictEqual(suivi.readFile(undefined, rel).ok, false);
});
