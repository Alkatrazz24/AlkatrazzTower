'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const modifs = require('../lib/modifs');
const git = require('../lib/git');
const { TowerState } = require('../server/state');
const { slim } = require('../hooks/tower-hook');

test('les git commit et git push d une ligne de commande', () => {
  assert.deepStrictEqual(modifs.gitCommands('git add -A && git commit -m "Porte : six coups" && git push -u origin feat/porte').map(c => c.verb), ['commit', 'push']);
  assert.strictEqual(modifs.gitCommands('git -C "C:/Jeu" commit -m x')[0].dir, 'C:/Jeu');
  assert.strictEqual(modifs.gitCommands('git -c core.quotepath=false push')[0].verb, 'push');
  assert.deepStrictEqual(modifs.gitCommands('git stash push -m wip; git commit-tree abc; git log --grep commit; echo git push'), []);
  assert.strictEqual(modifs.gitCommands('& git.exe commit -m "x"')[0].verb, 'commit');
  assert.strictEqual(modifs.messageOf('git commit -m "Porte : six coups"'), 'Porte : six coups');
  assert.strictEqual(modifs.messageOf("git commit -m 'Une ligne'"), 'Une ligne');
  assert.strictEqual(modifs.messageOf('git commit -m "$(cat <<\'EOF\'\nLe titre\n\nLe corps\nEOF\n)"'), 'Le titre');
  assert.deepStrictEqual(modifs.pushTarget('-u origin feat/porte'), { remote: 'origin', ref: 'feat/porte' });
});

test('la sortie d un commit et d un push', () => {
  assert.deepStrictEqual(modifs.parseCommitOut('[main 1a2b3c4] Porte : six coups\n 3 files changed, 10 insertions(+), 2 deletions(-)\n'),
    { state: 'ok', branch: 'main', short: '1a2b3c4', subject: 'Porte : six coups', files: 3, ins: 10, del: 2 });
  assert.strictEqual(modifs.parseCommitOut('[main (root-commit) 1a2b3c4d] Premier\n 1 file changed, 1 insertion(+)').files, 1);
  assert.strictEqual(modifs.parseCommitOut('On branch main\nnothing to commit, working tree clean').state, 'nothing');
  assert.strictEqual(modifs.parseCommitOut('error: pathspec \'x\' did not match').state, 'error');
  const ok = modifs.parsePushOut('To https://ali:secret@github.com/a/b.git\n   feff70f..1b58952  main -> main\n * [new branch]      feat/x -> feat/x\n');
  assert.strictEqual(ok.state, 'ok');
  assert.strictEqual(ok.to, 'https://github.com/a/b.git'); // jamais d'identifiant
  assert.deepStrictEqual(ok.refs.map(r => r.what), ['update', 'new']);
  const no = modifs.parsePushOut('To https://github.com/a/b.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to \'https://github.com/a/b.git\'\n');
  assert.strictEqual(no.state, 'rejected');
  assert.strictEqual(no.error, 'fetch first');
  assert.strictEqual(modifs.parsePushOut('Everything up-to-date').state, 'uptodate');
  assert.strictEqual(modifs.parsePushOut('fatal: No configured push destination.').error, 'fatal: No configured push destination.');
  assert.strictEqual(modifs.parsePushOut(''), null);
});

test('le hook garde le debut de la sortie d un git commit, rien d autre', () => {
  const ev = { session_id: 'S', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, tool_response: { stdout: '[main 1a2b3c4] x', stderr: '' } };
  assert.strictEqual(slim(ev).git_out, '[main 1a2b3c4] x');
  assert.strictEqual(slim({ ...ev, tool_input: { command: 'npm test' } }).git_out, undefined);
  assert.strictEqual(slim({ ...ev, tool_name: 'Read' }).git_out, undefined);
  assert.strictEqual(slim({ ...ev, tool_response: { stdout: 'x'.repeat(5000) } }).git_out.length, 1500);
  assert.strictEqual(slim({ ...ev, tool_response: undefined }).git_out, undefined);
});

test('la tour note la doc ecrite, les commits et les push des sessions, et les garde', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-modifs-'));
  fs.writeFileSync(path.join(root, 'Jeu.uproject'), '{}');
  let t = 1_000_000;
  const s = new TowerState(() => t);
  s.connectProject({ name: 'Jeu', root, uproject: path.join(root, 'Jeu.uproject') });
  const seen = [];
  s.onGit = (e) => seen.push(...e);
  const ev = (e) => s.event({ session_id: 'S', cwd: root, ...e });
  s.agent('S', root);
  s.agents.S.project = { name: 'Jeu', root };
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'Source', 'Jeu', 'Porte.cpp') } });
  s.hookReply({ session_id: 'S', hook_event_name: 'Stop' }); // la tour reclame la doc
  t += 1000;
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'docs', 'ARCHITECTURE.md') } });
  let doc = s.modifs[0];
  assert.strictEqual(doc.kind, 'doc');
  assert.strictEqual(doc.rel, 'docs/ARCHITECTURE.md');
  assert.deepStrictEqual(doc.covers, ['Source/Jeu/Porte.cpp']);
  assert.strictEqual(doc.asked, true);
  // la meme page reprise : une seule entree
  t += 1000;
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'docs', 'ARCHITECTURE.md') } });
  assert.strictEqual(s.modifs.length, 1);
  assert.strictEqual(s.modifs[0].n, 2);
  // un agent ecrit une autre page
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_id: 'a1', agent_type: 'ctb-portes', tool_input: { file_path: path.join(root, 'docs', 'decisions', '0082.md') } });
  assert.strictEqual(s.modifs[0].sub, 'ctb-portes');
  assert.strictEqual(s.modifs[0].asked, false);
  // commit puis push, dans la meme commande
  t += 1000;
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m "Porte" && git push origin main' },
    git_out: '[main 1a2b3c4] Porte\n 2 files changed, 4 insertions(+)\nTo https://github.com/a/b.git\n   0000000..1a2b3c4  main -> main\n' });
  const [push, commit] = s.modifs;
  assert.strictEqual(commit.kind, 'commit');
  assert.strictEqual(commit.short, '1a2b3c4');
  assert.strictEqual(commit.subject, 'Porte');
  assert.strictEqual(commit.cwd, root);
  assert.strictEqual(push.kind, 'push');
  assert.strictEqual(push.state, 'ok');
  assert.strictEqual(seen.length, 2);
  // un push refuse, arrive en echec
  ev({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'git push' }, error: 'Exit code 1\n ! [rejected]        main -> main (fetch first)' });
  assert.strictEqual(s.modifs[0].state, 'rejected');
  // rien a commiter : pas une modification
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, git_out: 'nothing to commit, working tree clean' });
  assert.strictEqual(s.modifs[0].state, 'rejected');
  // la page voit quelle doc est deja dans un commit
  Object.assign(commit, { root, list: ['docs/ARCHITECTURE.md', 'Source/Jeu/Porte.cpp'] });
  const v = s.snapshot().modifs.find(e => e.rel === 'docs/ARCHITECTURE.md');
  assert.deepStrictEqual(v.commit, { short: '1a2b3c4', at: commit.at });
  // le journal survit a un redemarrage
  const again = new TowerState();
  again.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.strictEqual(again.modifs.length, s.modifs.length);
  again.load({ modifs: [{ kind: 'x', at: 1 }, null, { kind: 'doc', at: 'hier' }] });
  assert.deepStrictEqual(again.modifs, []);
});

test('les fichiers d un commit, lus par git show', async () => {
  if (!(await git.gitVersion())) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-modifs-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 'ali', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'ali', GIT_COMMITTER_EMAIL: 'a@b' } }).toString();
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'Été.md'), '# x\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  g('add', '-A');
  const out = g('commit', '-q', '-m', 'Premier commit');
  assert.strictEqual(out, '');
  const head = await modifs.commitInfo(git.run, root, 'HEAD');
  assert.strictEqual(head.subject, 'Premier commit');
  assert.strictEqual(head.count, 2);
  assert.deepStrictEqual(head.list.sort(), ['a.txt', 'docs/Été.md']);
  assert.strictEqual((await modifs.commitInfo(git.run, root, head.short)).sha, head.sha);
  assert.strictEqual(await modifs.commitInfo(git.run, root, 'abcdef0'), null);
});

test('une ligne piegee de -c ou -C ne bloque pas la tour', () => {
  const { gitCommands } = require('../lib/modifs');
  const t = Date.now();
  gitCommands('git ' + '-c '.repeat(40) + 'x');
  gitCommands('git ' + '-C a '.repeat(40) + 'x');
  assert.ok(Date.now() - t < 500);
  assert.deepStrictEqual(gitCommands('git -C "C:/a b" -c user.name=x --no-pager commit -m hi').map(c => [c.verb, c.dir]), [['commit', 'C:/a b']]);
});
