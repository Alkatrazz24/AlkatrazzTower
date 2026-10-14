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

// Sur le PC, tests.ps1 lance par PowerShell rend sa sortie en CLIXML (Write-Host) : la tour la relit
// en clair, et la ligne de bilan de tests.ps1 compte plus que les quelques « Test Completed » visibles.
test('tests.ps1 en CLIXML : la tour lit le vrai bilan', () => {
  const { declixml } = require('../lib/results');
  const out = [
    '#< CLIXML',
    '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Information">==&gt; Suite CTB_x000D__x000A_</S>'
      + '<S S="Information">LogAutomationController: Display: Test Completed. Result={Success} Name={Porte} Path={CTB.Porte}_x000D__x000A_</S>'
      + '<S S="Information">LogAutomationController: Display: Test Completed. Result={Fail} Name={Ragdoll} Path={CTB.Ragdoll}_x000D__x000A_</S>'
      + '<S S="Information">637 tests, 1 ECHEC(S)_x000D__x000A_</S></Objs>',
  ].join('\n');
  assert.match(declixml(out), /==> Suite CTB\r?\n/);
  assert.doesNotMatch(declixml(out), /<Objs|_x000D_/);
  const r = parseOutput(out, 1, 'test');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual([r.tests.total, r.tests.failed], [637, 1]);
  assert.deepStrictEqual(r.tests.failedNames, ['Ragdoll']);
  assert.ok(!r.errorLines.some(l => /<Objs|<S /.test(l)), 'pas de balises dans les erreurs');
  assert.strictEqual(declixml('texte simple'), 'texte simple');
});
