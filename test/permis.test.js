'use strict';
// Les autorisations que la tour donne seule aux sessions qu'elle lance (lib/permis.js).

const test = require('node:test');
const assert = require('node:assert');
const permis = require('../lib/permis');
const { TowerState } = require('../server/state');

const ps = (command, conf) => permis.autoAllow('PowerShell', { command }, conf);
const sh = (command, conf) => permis.autoAllow('Bash', { command }, conf);

test('ce qui ne fait que lire passe sans demander (la commande de la capture d\'ali comprise)', () => {
  assert.ok(ps('Get-ChildItem Saved\\Logs\\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 6 Name, LastWriteTime, Length'));
  assert.ok(ps('Get-Content Saved\\Logs\\CTB.log -Tail 50 2>&1 | Out-String'));
  assert.ok(ps('Get-ChildItem | Where-Object { $_.Name.StartsWith("a") } | ForEach-Object { $_.FullName }'));
  assert.ok(ps('(Get-Item x).Length'));
  assert.ok(ps('git status; git log --oneline -5'));
  assert.ok(ps('git -C "C:\\a b" diff --stat'));
  assert.ok(sh('ls -la && cat foo | head -n 5'));
  assert.ok(sh('FOO=1 git branch -a'));
  for (const tool of ['Read', 'Grep', 'Glob', 'LS']) assert.ok(permis.autoAllow(tool, { file_path: 'C:/x' }));
});

test('ce qui ecrit, supprime ou peut cacher une autre commande demande toujours', () => {
  for (const c of ['Get-ChildItem x | Remove-Item', 'Get-ChildItem x | % { Remove-Item $_ }', '$a = Remove-Item x', '$a = rm x',
    'Get-Content a > b.txt', '[IO.File]::Delete("x")', '(Get-Item x).Delete()', 'Set-Content a b', 'git commit -m x', 'git checkout -- .',
    'powershell -Command "Get-ChildItem"', 'Invoke-Expression $x', 'Get-ChildItem "$(Remove-Item x)"',
    'Get-ChildItem >> log.txt', 'Get-Content a | Out-File b', 'Add-Content a b', 'Get-ChildItem | Tee-Object x', 'iex $x', '& "Get-ChildItem"',
    '. .\\x.ps1', '. $profile', 'Start-Process notepad', 'cmd /c dir', 'Get-Item $(Get-Location)', 'Get-ChildItem; Remove-Item x']) assert.ok(!ps(c), c);
  for (const c of ['find . -name x -delete', 'echo $(rm -rf /)', 'echo `rm x`', 'sort -o out.txt in.txt', 'git -c core.pager=x log', 'git branch -D old'])
    assert.ok(!sh(c), c);
  assert.ok(!permis.autoAllow('Edit', { file_path: 'Source/x.cpp' }));
  assert.ok(!permis.autoAllow('PowerShell', { command: '' }));
});

test('une commande autorisee une fois est retenue par son programme ; une suppression jamais', () => {
  assert.deepStrictEqual(permis.keysFor('PowerShell', { command: 'git commit -m "move door"' }), ['git commit']);
  assert.deepStrictEqual(permis.keysFor('PowerShell', { command: '& "C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Build\\BatchFiles\\Build.bat" X Win64 2>&1 | Select-Object -Last 10' }), ['build.bat']);
  assert.deepStrictEqual(permis.keysFor('Bash', { command: 'python tools/creer_coup_de_pied.py --auto' }), ['python creer_coup_de_pied.py']);
  assert.deepStrictEqual(permis.keysFor('PowerShell', { command: 'Remove-Item x' }), []);
  assert.deepStrictEqual(permis.keysFor('PowerShell', { command: 'git reset --hard' }), []);
  assert.deepStrictEqual(permis.keysFor('PowerShell', { command: 'cmd /c build.bat' }), []); // shell imbrique : rien de sur a retenir
  assert.deepStrictEqual(permis.keysFor('Edit', { file_path: 'x' }), []);
  assert.deepStrictEqual(permis.keysFor('WebFetch', { url: 'https://dev.epicgames.com/doc' }), ['WebFetch dev.epicgames.com']);
  const conf = { niveau: 'lecture', retenues: ['git commit', 'build.bat'] };
  assert.ok(ps('git commit -m "autre message"', conf));
  assert.ok(ps('& "D:\\UE\\Build.bat" Y Win64 -waitmutex', conf));
  assert.ok(!ps('git push', conf));
  assert.ok(!ps('git commit -m x; Remove-Item y', conf));
});

test('les niveaux : tout sauf supprimer, puis tout', () => {
  const sauf = { niveau: 'sauf-suppression' };
  assert.ok(ps('New-Item -ItemType Directory x', sauf));
  assert.ok(ps('npm install', sauf));
  assert.ok(permis.autoAllow('Edit', { file_path: 'x' }, sauf, 'C:\\p'));
  assert.ok(!ps('Remove-Item x -Recurse', sauf));
  assert.ok(!ps('powershell -Command "Remove-Item x"', sauf));
  assert.ok(!sh('git push --force', sauf));
  assert.ok(ps('Remove-Item x -Recurse', { niveau: 'tout' }));
  assert.deepStrictEqual(permis.restore({ niveau: 'n\'importe', retenues: ['a', 3] }), { niveau: 'lecture', retenues: ['a'] });
});

test('dans la tour : la lecture passe seule, « Autoriser » retient, le reglage se change et survit au redemarrage', () => {
  const s = new TowerState();
  assert.ok(s.autoPermis({ kind: 'permission', tool: 'PowerShell', input: { command: 'Get-ChildItem Saved' } }));
  const req = { sessionId: 'K', kind: 'permission', tool: 'PowerShell', summary: 'git commit -m x', input: { command: 'git commit -m x' } };
  assert.ok(!s.autoPermis(req));
  const id = s.openAsk(req);
  assert.deepStrictEqual(s.agents.K.ask.retenir, ['git commit']);
  assert.deepStrictEqual(s.answerAsk(id, { decision: 'allow' }), { ok: true });
  assert.deepStrictEqual(s.permis.retenues, ['git commit']);
  assert.ok(s.autoPermis({ ...req, input: { command: 'git commit -m y' } }));
  // un refus ne retient rien
  const id2 = s.openAsk({ ...req, input: { command: 'git push' } });
  s.answerAsk(id2, { decision: 'deny' });
  assert.deepStrictEqual(s.permis.retenues, ['git commit']);
  assert.strictEqual(s.setPermis({ niveau: 'rien' }).ok, false);
  assert.ok(s.setPermis({ niveau: 'sauf-suppression' }).ok);
  const t = new TowerState();
  t.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepStrictEqual(t.permis, { niveau: 'sauf-suppression', retenues: ['git commit'] });
  t.setPermis({ oublier: 'git commit' });
  assert.deepStrictEqual(t.permis.retenues, []);
  assert.strictEqual(t.snapshot ? t.snapshot().permis.niveau : 'sauf-suppression', 'sauf-suppression');
});

test('le hook repond seul quand la tour dit « auto », sans ouvrir de question', async () => {
  const http = require('http');
  const { execFile } = require('child_process');
  const path = require('path');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', () => { seen.push([req.url, JSON.parse(raw)]); res.end(JSON.stringify({ auto: 'allow' })); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ev = { session_id: 'x', hook_event_name: 'PermissionRequest', tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem Saved\\Logs' } };
  const out = await new Promise((resolve) => {
    const p = execFile(process.execPath, [path.join(__dirname, '..', 'hooks', 'tower-ask.js')], { env: { ...process.env, TOWER_PORT: String(srv.address().port), TOWER_ASK: '1' } }, (e, o) => resolve(o));
    p.stdin.end(JSON.stringify(ev));
  });
  srv.close();
  assert.deepStrictEqual(JSON.parse(out).hookSpecificOutput.decision, { behavior: 'allow' });
  assert.deepStrictEqual(seen.map(x => x[0]), ['/api/ask/open']);
  assert.strictEqual(seen[0][1].input.command, 'Get-ChildItem Saved\\Logs');
});

test('« tout sauf supprimer » : reecrire l\'historique git ou ecrire hors du projet demande (chemins Windows)', () => {
  const CTB = 'C:\\Users\\Alkatrazz\\Documents\\unreal\\ConquerTheBackrooms 5.8';
  const sauf = { niveau: 'sauf-suppression' };
  const ok = (c) => permis.autoAllow('PowerShell', { command: c }, sauf, CTB);
  assert.ok(ok('New-Item -ItemType Directory Saved\\Tour\\x'));
  assert.ok(ok('Set-Content Source\\a.txt b'));
  assert.ok(ok('Copy-Item Content\\a.uasset "C:\\Users\\alkatrazz\\Documents\\Unreal\\ConquerTheBackrooms 5.8\\Content\\b.uasset"'));
  assert.ok(ok('& "C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Build\\BatchFiles\\Build.bat" X Win64 -project="C:\\Users\\Alkatrazz\\Documents\\unreal\\ConquerTheBackrooms 5.8\\CTB.uproject" 2>&1'));
  assert.ok(ok('git commit -m "porte"'));
  for (const c of ['git reset --soft HEAD~1', 'git reset HEAD~2', 'git commit --amend -m x', 'git rebase -i main', 'git push --force', 'git clean -fd',
    'Set-Content ..\\x.txt y', 'New-Item C:\\Users\\Alkatrazz\\Desktop\\x', 'Get-Content a > C:\\temp\\b.txt', 'Copy-Item a $env:TEMP\\b', 'cd ..; New-Item x',
    'Copy-Item a "C:\\Users\\Alkatrazz\\Documents\\unreal\\ConquerTheBackrooms 5.8 copie\\a"']) assert.ok(!ok(c), c);
  assert.ok(ok('Get-Content C:\\Windows\\win.ini')); // lire ailleurs reste permis
  assert.ok(permis.autoAllow('Edit', { file_path: `${CTB}\\Source\\a.cpp` }, sauf, CTB));
  assert.ok(permis.autoAllow('Write', { file_path: 'c:/users/alkatrazz/documents/unreal/conquerthebackrooms 5.8/docs/x.md' }, sauf, CTB));
  assert.ok(!permis.autoAllow('Edit', { file_path: 'C:\\Users\\Alkatrazz\\.claude\\settings.json' }, sauf, CTB));
  assert.ok(!permis.autoAllow('Edit', { file_path: `${CTB}\\..\\autre\\a.cpp` }, sauf, CTB));
  assert.ok(!permis.autoAllow('Edit', { file_path: 'Source/a.cpp' }, sauf, '')); // sans dossier connu, on demande
  assert.ok(permis.autoAllow('Edit', { file_path: 'C:\\x' }, { niveau: 'tout' }, CTB));
});

test('un shell imbrique qui ecrit hors du projet demande aussi', () => {
  const CTB = 'C:\\Users\\Alkatrazz\\Documents\\unreal\\ConquerTheBackrooms 5.8';
  assert.ok(!permis.autoAllow('PowerShell', { command: 'cmd /c "copy a C:\\temp\\b"' }, { niveau: 'sauf-suppression' }, CTB));
  assert.ok(permis.autoAllow('PowerShell', { command: 'cmd /c "copy a Saved\\b"' }, { niveau: 'sauf-suppression' }, CTB));
});
