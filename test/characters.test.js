'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomLook, cleanLook, cleanName } = require('../lib/characters');
const { TowerState } = require('../server/state');
const projects = require('../lib/projects');

test('allure tiree au hasard : stable pour une meme graine, toujours valide', () => {
  assert.deepStrictEqual(randomLook('abc'), randomLook('abc'));
  assert.notDeepStrictEqual(randomLook('abc'), randomLook('abd'));
  const l = randomLook('xyz');
  assert.deepStrictEqual(cleanLook(l, {}), l, 'une allure tiree passe la validation telle quelle');
});

test('validation : valeurs inconnues et couleurs invalides ignorees', () => {
  const base = randomLook('s');
  const out = cleanLook({ hat: 'CASQUE', hairStyle: 'bizarre', shirt: '#ABCDEF', pants: 'rouge', skin: '#fff', evil: '<script>' }, base);
  assert.strictEqual(out.hat, 'casque');
  assert.strictEqual(out.hairStyle, base.hairStyle);
  assert.strictEqual(out.shirt, '#abcdef');
  assert.strictEqual(out.pants, base.pants);
  assert.strictEqual(out.skin, base.skin);
  assert.strictEqual(out.evil, undefined);
  assert.strictEqual(cleanName('  <b>Brique</b>  '), 'bBrique/b');
});

test('chaque agent recoit un personnage, garde par role, modifiable par nom', () => {
  const s = new TowerState(() => 1000);
  s.event({ session_id: 'A', hook_event_name: 'SessionStart' });
  s.event({ session_id: 'B', hook_event_name: 'SessionStart' });
  const ca = s.characters[s.agents.A.characterId], cb = s.characters[s.agents.B.characterId];
  assert.ok(ca && cb && ca.id !== cb.id, 'deux agents actifs, deux personnages');
  assert.notStrictEqual(ca.name, cb.name);

  // Un agent termine libere son personnage pour le suivant
  s.event({ session_id: 'A', hook_event_name: 'SessionEnd' });
  s.event({ session_id: 'C', hook_event_name: 'SessionStart' });
  assert.strictEqual(s.agents.C.characterId, ca.id);

  // Un personnage attache a un role revient a la session qui porte ce titre
  s.updateCharacter({ id: cb.id, role: 'ctb-armes' });
  s.event({ session_id: 'D', hook_event_name: 'UserPromptSubmit', session_title: 'ctb-armes' });
  assert.strictEqual(s.agents.D.characterId, cb.id);

  // Ce que fait le skill : retrouver par nom et changer une partie de l'allure
  const r = s.updateCharacter({ name: cb.name, look: { hat: 'couronne', hatColor: '#facc15' } });
  assert.strictEqual(r.look.hat, 'couronne');
  assert.strictEqual(r.name, cb.name, 'chercher par nom ne renomme pas');
  s.updateCharacter({ id: cb.id, newName: 'Roi' });
  assert.strictEqual(s.characters[cb.id].name, 'Roi');
  assert.match(s.label('D'), /^Roi/);
});

test('connecter un projet par son dossier ou son .uproject', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-proj-'));
  fs.writeFileSync(path.join(dir, 'MonJeu.uproject'), JSON.stringify({ EngineAssociation: '5.8' }));
  const p = projects.resolve(dir);
  assert.deepStrictEqual([p.name, p.engine], ['MonJeu', '5.8']);
  assert.strictEqual(projects.resolve(path.join(dir, 'MonJeu.uproject')).root, dir);
  assert.strictEqual(projects.resolve(path.join(dir, 'absent')), null);
  const found = projects.scan({ roots: [[path.dirname(dir), 1]] }).projects;
  assert.ok(found.some(x => x.root === dir));
  const s = new TowerState(() => 1);
  s.connectProject(p); s.connectProject(p);
  assert.strictEqual(s.projects.length, 1);
  s.disconnectProject(p.uproject);
  assert.strictEqual(s.projects.length, 0);
});
