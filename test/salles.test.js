'use strict';
// Le nom des salles (ce que fait chaque session) et l'equipe du projet rangee par section.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const { salleOf, shortAsk } = require('../lib/salles');
const equipe = require('../lib/equipe');
const usage = require('../lib/usage');

test('une premiere demande devient un nom de salle court', () => {
  assert.strictEqual(shortAsk('ok mtn tu peux ajouter une animation coup de pied pour ouvrir une porte vite'), 'Ajouter une animation coup de pied pour ouvrir…');
  assert.strictEqual(shortAsk('salut, regarde le menu principal stp'), 'Regarde le menu principal');
  assert.strictEqual(shortAsk('Corrige le crash du ragdoll. Ensuite relance les tests.'), 'Corrige le crash du ragdoll');
  assert.strictEqual(shortAsk(''), '');
});

test('le nom de la salle : le tien, puis la tache, le titre, la premiere demande, le projet', () => {
  const a = { cwd: 'C:\\jeux\\CTB', project: { name: 'CTB' } };
  assert.strictEqual(salleOf(a), 'Session sur CTB');
  a.firstPrompt = 'Ajoute un menu pause';
  assert.strictEqual(salleOf(a), 'Ajoute un menu pause');
  a.sessionName = 'Menu pause et options';
  assert.strictEqual(salleOf(a), 'Menu pause et options');
  a.title = 'ctb-menus';
  assert.strictEqual(salleOf(a), 'ctb-menus');
  a.task = { title: 'Relecture complète et rapport' };
  assert.strictEqual(salleOf(a), 'Relecture complète et rapport');
  a.label = 'Coup de pied';
  assert.strictEqual(salleOf(a), 'Coup de pied');
});

test('la tour garde la premiere demande, et un nom choisi qui s efface quand on le vide', () => {
  const s = new TowerState();
  s.event({ session_id: 'A', hook_event_name: 'UserPromptSubmit', prompt: 'Ajoute un coup de pied pour ouvrir les portes' });
  s.event({ session_id: 'A', hook_event_name: 'UserPromptSubmit', prompt: 'et le son aussi' });
  s.event({ session_id: 'A', hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>fini</task-notification>' });
  const salle = () => s.snapshot().agents.find(x => x.sessionId === 'A').salle;
  assert.strictEqual(salle(), 'Ajoute un coup de pied pour ouvrir les portes');
  assert.ok(s.renameRoom('A', '  Portes\nau pied  '));
  assert.strictEqual(salle(), 'Portes au pied');
  s.renameRoom('A', '');
  assert.strictEqual(salle(), 'Ajoute un coup de pied pour ouvrir les portes');
  assert.strictEqual(s.renameRoom('inconnu', 'x'), false);
  // le titre lu dans le journal de la session passe avant la premiere demande
  s.setUsage('A', { total: 1, title: 'Coup de pied dans les portes' });
  assert.strictEqual(salle(), 'Coup de pied dans les portes');
  assert.strictEqual(s.agents.A.usage.title, undefined);
});

test('l equipe : les agents du projet, ranges par section, et la section de chaque sous-agent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-equipe-'));
  const dir = path.join(root, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ctb-animation.md'), '---\nname: ctb-animation\nsection: Animation\ndescription: "Montages : gestes, notifies"\n---\nTu animes.');
  fs.writeFileSync(path.join(dir, 'ctb-menus.md'), '\uFEFF---\r\nname: ctb-menus\r\ndescription: Menus du jeu\r\n---\r\n');
  fs.writeFileSync(path.join(dir, 'ctb-docs.md'), 'pas d en-tete');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore');
  fs.writeFileSync(path.join(root, 'CTB.uproject'), '{}');
  const team = equipe.readTeam(root);
  assert.deepStrictEqual(team.map(x => [x.name, x.section]), [['ctb-animation', 'Animation'], ['ctb-menus', 'Menus'], ['ctb-docs', 'Autres']]);
  assert.strictEqual(team[0].description, 'Montages : gestes, notifies');
  assert.deepStrictEqual(equipe.readTeam(path.join(root, 'absent')), []);

  const s = new TowerState();
  s.projects = [{ name: 'CTB', root }];
  s.event({ session_id: 'B', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Read', agent_id: 'x1', agent_type: 'ctb-animation' });
  s.event({ session_id: 'B', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Read', agent_id: 'x2', agent_type: 'Explore' });
  const snap = s.snapshot();
  assert.deepStrictEqual(Object.keys(snap.team), ['CTB']);
  const subs = snap.agents.find(x => x.sessionId === 'B').subagents;
  assert.strictEqual(subs.x1.section, 'Animation');
  assert.strictEqual(subs.x2.section, '');
  assert.strictEqual(s.agents.B.subagents.x1.section, undefined); // l'instantane ne touche pas l'etat
});

test('les sections devinees d apres le nom de l agent', () => {
  const g = equipe.guessSection;
  assert.deepStrictEqual(['ctb-armes', 'ctb-son', 'ctb-interface', 'ctb-raid', 'ctb-monde', 'ctb-sante', 'ctb-relecteur', 'ctb-ui', 'ctb-ia'].map(g),
    ['Armes et combat', 'Son', 'Interface', 'Raid', 'Monde et niveaux', 'Santé et soins', 'Tests et qualité', 'Interface', 'IA et entités']);
});

test('le titre de la session est lu dans son journal, /rename avant le titre genere', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-titre-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'summary', summary: 'Kick door animation', leafUuid: 'u' }) + '\n');
  assert.strictEqual((await usage.usageOf(file)).title, 'Kick door animation');
  fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: 'Coup de pied', sessionId: 's' }) + '\n'
    + JSON.stringify({ type: 'summary', summary: 'Autre chose' }) + '\n');
  assert.strictEqual((await usage.usageOf(file)).title, 'Coup de pied');
});
