'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseOutput } = require('../lib/results');

test('UBT reussi', () => {
  const r = parseOutput('Building CTBEditor...\n[1/3] Compile [x64] A.cpp\nResult: Succeeded\nTotal execution time: 12.3 seconds', 0, 'build');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.summary, 'compile');
});

test('UBT en echec, lignes d\'erreur gardees', () => {
  const out = [
    String.raw`C:\proj\A.cpp(12): error C2065: 'Foo': undeclared identifier`,
    String.raw`C:\proj\B.cpp(3): warning C4996: old`,
    'Result: Failed (OtherCompilationError)',
  ].join('\n');
  const r = parseOutput(out, 6, 'build');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors, 1);
  assert.strictEqual(r.warnings, 1);
  assert.match(r.errorLines[0], /C2065/);
});

test('tests Unreal : le journal fait foi meme si le code de sortie vaut 0', () => {
  const out = [
    'LogAutomationController: Display: Test Completed. Result={Success} Name={A} Path={CTB.A}',
    'LogAutomationController: Display: Test Completed. Result={Fail} Name={B} Path={CTB.B}',
  ].join('\n');
  const r = parseOutput(out, 0, 'test');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual([r.tests.total, r.tests.failed], [2, 1]);
  assert.deepStrictEqual(r.tests.failedNames, ['B']);
});

test('resume de tests.ps1', () => {
  const r = parseOutput('==> Suite CTB\n\n140 tests, 0 echec', 0, 'test');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.summary, '140/140 tests');
});
