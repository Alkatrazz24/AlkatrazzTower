'use strict';
// Taches pretes a lancer et tokens lus dans les journaux de Claude Code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const taches = require('../lib/taches');
const usage = require('../lib/usage');

test('trois taches de base, des taches perso qui se gardent, et la marque reconnue', () => {
  const s = new TowerState();
  const t = taches.create(s);
  assert.deepStrictEqual(t.list().map(x => x.id), ['relecture', 'anomalies', 'features']);
  assert.strictEqual(t.save({ title: '', prompt: 'x' }).ok, false);
  assert.strictEqual(t.save({ id: 'relecture', title: 'a', prompt: 'b' }).ok, false);
  const r = t.save({ title: 'Assets orphelins', prompt: 'Liste les assets orphelins de {projet}.' });
  assert.strictEqual(r.task.id, 'perso-assets-orphelins');
  assert.strictEqual(t.save({ title: 'Assets orphelins', prompt: 'autre' }).task.id, 'perso-assets-orphelins-2');
  t.save({ id: 'perso-assets-orphelins', title: 'Orphelins', prompt: 'p' });
  assert.strictEqual(s.taskList().find(x => x.id === 'perso-assets-orphelins').title, 'Orphelins');
  const s2 = new TowerState(); s2.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.strictEqual(s2.tasks.length, 2);
  assert.ok(t.remove('perso-assets-orphelins-2'));
  assert.strictEqual(s.tasks.length, 1);

  const text = taches.promptFor(taches.BUILTIN[0], 'ConquerTheBackrooms');
  assert.match(text, /^Tache de la tour \[relecture\] : /);
  assert.match(text, /ConquerTheBackrooms/);
  assert.doesNotMatch(text, /\{projet\}|\{date\}/);
  s.event({ session_id: 'A', hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [relecture] : lis la consigne dans Saved/Tour/taches/relecture.md et suis-la.' });
  assert.deepStrictEqual([s.agents.A.task.id, s.agents.A.task.title], ['relecture', 'Relecture complète et rapport']);
  s.event({ session_id: 'B', hook_event_name: 'UserPromptSubmit', prompt: 'Corrige le bug de la porte' });
  assert.strictEqual(s.agents.B.task, undefined);
});

test('les tokens : un message compte une fois, le contexte vient du dernier, les actions se partagent la sortie', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-usage-'));
  const file = path.join(dir, 'session.jsonl');
  const msg = (id, u, content, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-10T09:00:00Z', message: { id, model: 'claude-x', usage: u, content }, ...extra });
  const u1 = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 200 };
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'salut' } }),
    msg('m1', u1, [{ type: 'thinking' }]),
    msg('m1', u1, [{ type: 'tool_use', name: 'Read' }]),
    msg('m1', u1, [{ type: 'tool_use', name: 'Grep' }]),
    '',
  ].join('\n'));
  let r = await usage.usageOf(file, 'claude-x');
  assert.strictEqual(r.messages, 1);
  assert.strictEqual(r.total, 6210);
  assert.strictEqual(r.context, 6210);
  assert.strictEqual(r.window, 200_000);
  assert.deepStrictEqual(r.tools.map(t => [t.name, t.calls, t.out]).sort(), [['Grep', 1, 100], ['Read', 1, 100]]);
  // Un sous-agent compte dans le total, pas dans le contexte ; la suite du journal est lue sans relire le debut.
  fs.appendFileSync(file, msg('m2', { input_tokens: 5, cache_read_input_tokens: 300000, output_tokens: 50 }, [{ type: 'text' }], { isSidechain: true }) + '\n'
    + msg('m3', { input_tokens: 5, cache_read_input_tokens: 7000, output_tokens: 40 }, [{ type: 'text' }]) + '\n');
  r = await usage.usageOf(file, 'claude-x');
  assert.strictEqual(r.messages, 3);
  assert.strictEqual(r.context, 7045);
  assert.strictEqual(r.total, 6210 + 300055 + 7045);
  assert.strictEqual(r.tools.find(t => t.name === 'Réponse').calls, 0);
  assert.strictEqual((await usage.usageOf(file, 'claude-x[1m]')).window, 1_000_000);
  assert.strictEqual(await usage.usageOf('/pas/un/journal.txt'), null);
});
