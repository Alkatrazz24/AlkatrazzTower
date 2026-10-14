'use strict';
// Le journal du serveur : chaque ligne a son heure, le fichier tourne au-dela de sa taille, et un
// plantage laisse sa pile et le code de sortie dans server.log.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const journal = require('../lib/journal');

test('le journal ecrit des lignes datees et garde un seul ancien fichier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-journal-'));
  const j = journal.open(dir, { max: 200 });
  j.write('info', 'premiere ligne');
  assert.match(fs.readFileSync(j.file, 'utf8'), /^\d{4}-\d\d-\d\dT[\d:.]+Z info premiere ligne\n$/);
  for (let i = 0; i < 10; i++) j.write('info', 'x'.repeat(40));
  assert.ok(fs.existsSync(j.file + '.1'));
  assert.ok(fs.statSync(j.file).size <= 200 + 80);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un plantage laisse la pile et le code de sortie dans server.log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-journal-'));
  const code = `require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'journal.js'))}).install(process.argv[1], { port: 1 });
    console.log('bonjour'); console.error('attention'); setTimeout(() => { throw new Error('boum'); }, 5);`;
  const r = spawnSync(process.execPath, ['-e', code, dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  const log = fs.readFileSync(path.join(dir, 'server.log'), 'utf8');
  assert.match(log, /info \[tower\] demarrage, pid \d+, node v[\d.]+, port 1\n/);
  assert.match(log, /info bonjour\n/);
  assert.match(log, /ERROR attention\n/);
  assert.match(log, /ERROR \[tower\] erreur non rattrapee, la tour s'arrete : Error: boum\n\s+at /);
  assert.match(log, /info \[tower\] arret, code 1\n$/);
  fs.rmSync(dir, { recursive: true, force: true });
});
