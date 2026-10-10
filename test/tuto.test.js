'use strict';
// Tutos : ils jouent sur la vraie tour sans laisser de trace ni toucher a la version.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const tuto = require('../lib/tuto');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-tuto-'));
  fs.writeFileSync(path.join(root, 'ConquerTheBackrooms.uproject'), '{}');
  return { name: 'ConquerTheBackrooms', root, uproject: path.join(root, 'ConquerTheBackrooms.uproject') };
}

test('un build de tuto ne compte pas pour la version et n\'est jamais sauvegarde', () => {
  const p = project();
  const s = new TowerState();
  const c = s.createCampaign({ name: 'v', project: p.name, text: 'A | build' });
  s.event({ session_id: 'vrai', cwd: p.root, hook_event_name: 'SessionStart' });
  s.event({ session_id: 'tuto-forge-a', cwd: p.root, hook_event_name: 'SessionStart' });
  const t = s.acquire({ sessionId: 'tuto-forge-a', kind: 'build', cwd: p.root });
  s.release(t.ticket, { ok: true, exitCode: 0, summary: 'compile' });
  assert.strictEqual(s.builds.length, 1);
  assert.strictEqual(c.stats.builds, 0);
  assert.strictEqual(s.characters[s.agents['tuto-forge-a'].characterId].tuto, true);
  const saved = s.toJSON();
  assert.deepStrictEqual(Object.keys(saved.agents), ['vrai']);
  assert.strictEqual(saved.builds.length, 0);
  assert.ok(Object.values(saved.characters).every(x => !x.tuto));
  assert.strictEqual(Object.keys(saved.characters).length, 1);
});

test('le tuto question attend, « J\'ai vu » le termine, Effacer ne laisse rien', async () => {
  const p = project();
  const s = new TowerState();
  s.connectProject(p);
  s.event({ session_id: 'vrai', cwd: p.root, hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  const tu = tuto.create(s, { projects: () => s.projects });
  assert.strictEqual(tu.info().project, 'ConquerTheBackrooms');
  assert.deepStrictEqual(tu.start({ id: 'question' }), { ok: true, project: 'ConquerTheBackrooms' });
  assert.strictEqual(s.agents['tuto-question'].project.name, 'ConquerTheBackrooms');
  await new Promise(r => setTimeout(r, 6300));
  assert.strictEqual(s.agents['tuto-question'].status, 'waiting');
  assert.strictEqual(tu.answer(), true);
  assert.strictEqual(s.agents['tuto-question'].status, 'idle');
  assert.strictEqual(s.tuto.last.done, true);
  tu.clean();
  assert.deepStrictEqual(Object.keys(s.agents), ['vrai']);
  assert.ok(Object.values(s.characters).every(x => !x.tuto));
  assert.strictEqual(s.tuto.last, null);
});

test('pas de tuto sans projet, ni de faux build pendant un vrai', () => {
  const s = new TowerState();
  assert.strictEqual(tuto.create(s, { projects: () => [] }).start({ id: 'agent' }).ok, false);
  const p = project();
  s.connectProject(p);
  s.acquire({ sessionId: 'vrai', kind: 'build' });
  const tu = tuto.create(s, { projects: () => s.projects });
  assert.strictEqual(tu.start({ id: 'forge' }).ok, false);
  assert.strictEqual(tu.start({ id: 'inconnu' }).ok, false);
});
