'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCampaignText, newCampaign, applyBuild, checkVictory, setManual, view } = require('../lib/campaign');
const { TowerState } = require('../server/state');
const { buildTarget, testFilter } = require('../lib/detect');

const TEXT = [
  'Munitions | tests:CTB.Munitions',
  'Lampe torche | tests:CTB.Lampe, build:ConquerTheBackrooms',
  'Menu de raid | manuel',
].join('\n');

let n = 0;
function rec(o) {
  n++;
  return { id: `B${n}`, project: 'ConquerTheBackrooms', label: 'agent', sessionId: 'S', endedAt: 1000 + n * 10, summary: '', ...o };
}
function testsRun(passed, failed = [], filter = 'CTB') {
  return rec({ kind: 'test', ok: failed.length === 0, testFilter: filter,
    tests: { total: passed.length + failed.length, failed: failed.length, passed: passed.length, passedPaths: passed, failedPaths: failed } });
}

test('lecture du texte de campagne', () => {
  const { features, boss } = parseCampaignText(TEXT + '\nBoss | paquet, tests:CTB');
  assert.deepStrictEqual(features.map(f => f.id), ['munitions', 'lampe-torche', 'menu-de-raid']);
  assert.deepStrictEqual(features[1].proofs, [{ type: 'tests', arg: 'CTB.Lampe' }, { type: 'build', arg: 'ConquerTheBackrooms' }]);
  assert.deepStrictEqual(features[2].proofs, [{ type: 'manual', arg: null }]);
  assert.deepStrictEqual(boss.proofs.map(p => p.type), ['package', 'tests']);
  assert.strictEqual(parseCampaignText('A').boss.proofs[0].type, 'package', 'boss par defaut : le paquet');
  assert.throws(() => parseCampaignText('A | magie'), /preuve inconnue/);
  assert.throws(() => parseCampaignText(''), /au moins un niveau/);
});

test('une partie complete : niveaux, regression, boss, victoire', () => {
  const c = newCampaign({ id: 'C1', name: 'CTB 0.3', project: 'ConquerTheBackrooms', text: TEXT, now: 1000 });
  const st = () => view(c).features.map(f => f.status);

  applyBuild(c, testsRun(['CTB.Munitions.Recharge', 'CTB.Munitions.Calibre'], ['CTB.Lampe.Minuterie']));
  assert.deepStrictEqual(st(), ['proven', 'failing', 'todo']);

  applyBuild(c, rec({ kind: 'build', ok: true, target: 'ConquerTheBackrooms' }));
  applyBuild(c, testsRun(['CTB.Lampe.Minuterie']));
  assert.deepStrictEqual(st(), ['proven', 'proven', 'todo']);

  // Regression : les munitions repassent au rouge
  applyBuild(c, testsRun([], ['CTB.Munitions.Recharge']));
  assert.deepStrictEqual(st(), ['broken', 'proven', 'todo']);
  assert.match(c.log[0].text, /Régression : Munitions/);

  // Un projet different ne compte pas
  applyBuild(c, { ...testsRun(['CTB.Munitions.Recharge']), project: 'AutreJeu' });
  assert.strictEqual(st()[0], 'broken');

  applyBuild(c, testsRun(['CTB.Munitions.Recharge']));
  setManual(c, 'menu-de-raid', true, 2000);
  assert.deepStrictEqual(st(), ['proven', 'proven', 'proven']);
  assert.strictEqual(view(c).bossUnlocked, true);
  assert.strictEqual(checkVictory(c, 2001), false, 'le boss n\'est pas encore battu');

  applyBuild(c, rec({ kind: 'package', ok: false, endedAt: 3000 }));
  assert.strictEqual(checkVictory(c, 3001), false);
  applyBuild(c, rec({ kind: 'package', ok: true, endedAt: 4000 }));
  assert.strictEqual(checkVictory(c, 4001), true);
  assert.strictEqual(c.wonAt, 4001);
  assert.deepStrictEqual([c.stats.builds, c.stats.failures], [7, 3], 'le build d\'un autre projet ne compte pas');

  // Une fois gagnee, la campagne est figee
  applyBuild(c, testsRun([], ['CTB.Munitions.Recharge']));
  assert.strictEqual(view(c).features[0].status, 'proven');
});

test('un boss battu avant le dernier niveau doit etre rebattu', () => {
  const c = newCampaign({ id: 'C2', name: 'v', project: 'ConquerTheBackrooms', text: 'A | tests:CTB.A', now: 0 });
  applyBuild(c, rec({ kind: 'package', ok: true, endedAt: 100 }));
  applyBuild(c, testsRun(['CTB.A.x']));
  assert.strictEqual(checkVictory(c, 9999), false);
  applyBuild(c, rec({ kind: 'package', ok: true, endedAt: 99999 }));
  assert.strictEqual(checkVictory(c, 100000), true);
});

test('sans chemins de tests, le filtre du run fait foi', () => {
  const c = newCampaign({ id: 'C3', name: 'v', project: 'ConquerTheBackrooms', text: 'A | tests:CTB.Munitions', now: 0 });
  applyBuild(c, rec({ kind: 'test', ok: true, testFilter: 'CTB.Lampe', tests: { total: 3, failed: 0, passed: 3 } }));
  assert.strictEqual(view(c).features[0].status, 'todo', 'un autre filtre ne prouve rien');
  applyBuild(c, rec({ kind: 'test', ok: true, testFilter: 'CTB', tests: { total: 140, failed: 0, passed: 140 } }));
  assert.strictEqual(view(c).features[0].status, 'proven');
});

test('la tour nourrit la campagne et ne garde pas les chemins dans l\'historique', () => {
  const s = new TowerState(() => 5000);
  s.event({ session_id: 'S', hook_event_name: 'SessionStart' });
  const c = s.createCampaign({ name: 'v', project: 'ConquerTheBackrooms', text: 'A | tests:CTB.A' });
  let won = null;
  s.onVictory = (x) => { won = x; };
  const t = s.acquire({ sessionId: 'S', kind: 'test', testFilter: 'CTB' });
  s.lock.project = 'ConquerTheBackrooms';
  s.release(t.ticket, { ok: true, exitCode: 0, summary: '1/1 tests', tests: { total: 1, failed: 0, passed: 1, passedPaths: ['CTB.A.x'], failedPaths: [] } });
  assert.strictEqual(s.snapshot().campaigns[0].features[0].status, 'proven');
  assert.strictEqual(s.builds[0].tests.passedPaths, undefined);
  const p = s.acquire({ sessionId: 'S', kind: 'package' });
  s.lock.project = 'ConquerTheBackrooms';
  s.release(p.ticket, { ok: true, exitCode: 0, summary: 'termine' });
  assert.strictEqual(won && won.id, c.id);
  // une nouvelle campagne range l'ancienne pour le meme projet
  s.createCampaign({ name: 'v2', project: 'ConquerTheBackrooms', text: 'B' });
  assert.strictEqual(s.campaigns.filter(x => !x.archived).length, 2, 'la campagne gagnee reste affichee');
  s.createCampaign({ name: 'v3', project: 'ConquerTheBackrooms', text: 'B' });
  assert.strictEqual(s.campaigns.find(x => x.name === 'v2').archived, true);
});

test('cible de build et filtre de tests lus dans la commande', () => {
  assert.strictEqual(buildTarget(String.raw`& "C:\UE\Build.bat" ConquerTheBackroomsEditor Win64 Development -waitmutex`), 'ConquerTheBackroomsEditor');
  assert.strictEqual(buildTarget(String.raw`& "C:\p\tools\cycle_editeur.ps1" -Cible Jeu`, 'ConquerTheBackrooms'), 'ConquerTheBackrooms');
  assert.strictEqual(buildTarget(String.raw`& "C:\p\tools\cycle_editeur.ps1"`, 'ConquerTheBackrooms'), 'ConquerTheBackroomsEditor');
  assert.strictEqual(testFilter(`& $Cmd x.uproject "-ExecCmds=Automation RunTests CTB.Reglages+CTB.Menu; Quit"`), 'CTB.Reglages+CTB.Menu');
  assert.strictEqual(testFilter(String.raw`tools\tests.ps1 -Filtre CTB.Munitions`), 'CTB.Munitions');
  assert.strictEqual(testFilter(String.raw`tools\tests.ps1`), 'CTB');
});

test('une suite complete apres le paquet ne bloque pas la victoire', () => {
  const c = newCampaign({ id: 'C4', name: 'v', project: 'ConquerTheBackrooms', text: 'A | tests:CTB.A\nBoss | paquet, tests:CTB', now: 0 });
  applyBuild(c, testsRun(['CTB.A.x']));
  applyBuild(c, rec({ kind: 'package', ok: true }));
  applyBuild(c, testsRun(['CTB.A.x', 'CTB.B.y']));
  assert.strictEqual(checkVictory(c, 99999), true);
});
