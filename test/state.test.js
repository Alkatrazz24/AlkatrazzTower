'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TowerState, LEASE_MS } = require('../server/state');

function clock() { let t = 1_000_000; const f = () => t; f.add = (ms) => { t += ms; }; return f; }

test('un seul detenteur, les autres en file dans l\'ordre', () => {
  const s = new TowerState(clock());
  const a = s.acquire({ sessionId: 'A', kind: 'build' });
  const b = s.acquire({ sessionId: 'B', kind: 'test' });
  const c = s.acquire({ sessionId: 'C', kind: 'build' });
  assert.strictEqual(a.granted, true);
  assert.deepStrictEqual([b.granted, b.position, c.position], [false, 1, 2]);
  s.release(a.ticket, { ok: true, exitCode: 0, summary: 'compile' });
  assert.strictEqual(s.ticketStatus(b.ticket).granted, true);
  assert.strictEqual(s.ticketStatus(c.ticket).position, 1);
  assert.strictEqual(s.builds[0].ok, true);
});

test('le verrou expire sans signe de vie et passe au suivant', () => {
  const now = clock();
  const s = new TowerState(now);
  const a = s.acquire({ sessionId: 'A' });
  const b = s.acquire({ sessionId: 'B' });
  now.add(LEASE_MS - 1000);
  s.touch(b.ticket);            // B attend et donne signe de vie, A non
  now.add(2000);
  s.expire();
  assert.strictEqual(s.ticketStatus(a.ticket).lost, true);
  assert.strictEqual(s.ticketStatus(b.ticket).granted, true);
  assert.strictEqual(s.builds[0].how, 'expired');
});

test('etats d\'un agent au fil des evenements', () => {
  const now = clock();
  const s = new TowerState(now);
  const ev = (e) => { now.add(10); s.event({ session_id: 'S', ts: now(), ...e }); return s.agents.S.status; };
  assert.strictEqual(ev({ hook_event_name: 'SessionStart', source: 'startup' }), 'ready');
  assert.strictEqual(ev({ hook_event_name: 'UserPromptSubmit', prompt: 'compile' }), 'working');
  assert.strictEqual(ev({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'ok ?' }), 'waiting');
  assert.strictEqual(ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }), 'working');
  assert.strictEqual(ev({ hook_event_name: 'Stop' }), 'idle');
  // un PostToolUse asynchrone en retard ne fait pas repasser au travail
  s.event({ session_id: 'S', hook_event_name: 'PostToolUse', tool_name: 'Read', ts: now() - 5 });
  assert.strictEqual(s.agents.S.status, 'idle');
  assert.strictEqual(ev({ hook_event_name: 'SessionEnd', reason: 'other' }), 'ended');
});

test('le resultat va sur la fiche de l\'agent', () => {
  const s = new TowerState(clock());
  s.event({ session_id: 'A', hook_event_name: 'SessionStart' });
  const t = s.acquire({ sessionId: 'A', kind: 'test' });
  s.release(t.ticket, { ok: false, exitCode: 1, summary: '9/10 tests', tests: { total: 10, failed: 1, passed: 9 } });
  assert.strictEqual(s.agents.A.lastTest.ok, false);
  assert.strictEqual(s.agents.A.lastBuild, null);
});
