'use strict';
// Le batiment des depots (lib/git.js) : lecture de l'etat git sans rien ecrire, comparaison avec GitHub,
// et les gestes sur clic (git init, git remote add) limites aux dossiers suivis.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const gitLib = require('../lib/git');
const { TowerState } = require('../server/state');

let hasGit = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const who = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_COMMITTER_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: who, stdio: 'pipe' }).toString();

test('la ligne de branche de git status', () => {
  assert.deepStrictEqual(gitLib.parseBranch('## main...origin/main [ahead 2, behind 1]'), { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, empty: false, detached: false });
  assert.strictEqual(gitLib.parseBranch('## No commits yet on main').empty, true);
  assert.strictEqual(gitLib.parseBranch('## No commits yet on main').branch, 'main');
  assert.strictEqual(gitLib.parseBranch('## HEAD (no branch)').detached, true);
  assert.deepStrictEqual([gitLib.parseBranch('## dev').branch, gitLib.parseBranch('## dev').upstream], ['dev', null]);
});

test('les fichiers pas commites, par sorte', () => {
  const s = gitLib.parseStatus('## main\n M Source/A.cpp\nM  docs/B.md\n?? Content/New.uasset\nUU Config/C.ini\nR  old.txt -> new.txt\n');
  assert.deepStrictEqual([s.dirty.total, s.dirty.modified, s.dirty.staged, s.dirty.untracked, s.dirty.conflicts], [5, 1, 2, 1, 1]);
  assert.strictEqual(s.dirty.files[4].path, 'new.txt');
});

test('les adresses GitHub, et rien d\'autre', () => {
  const want = { owner: 'Alkatrazz24', repo: 'AlkatrazzTower', url: 'https://github.com/Alkatrazz24/AlkatrazzTower' };
  for (const u of ['https://github.com/Alkatrazz24/AlkatrazzTower.git', 'https://github.com/Alkatrazz24/AlkatrazzTower', 'git@github.com:Alkatrazz24/AlkatrazzTower.git', 'https://user@github.com/Alkatrazz24/AlkatrazzTower/']) assert.deepStrictEqual(gitLib.parseGithub(u), want, u);
  for (const u of ['https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/a/b/c', 'https://github.com.evil.io/a/b', 'file:///c/x', '--upload-pack=x', 'https://github.com/a/..']) assert.strictEqual(gitLib.parseGithub(u), null, u);
});

test('le PC face a GitHub, sans fetch', () => {
  const L = { isRepo: true, branch: 'main', shas: ['c', 'b', 'a'] };
  const G = (shas) => ({ ok: true, defaultBranch: 'main', commits: shas.map(sha => ({ sha })) });
  assert.deepStrictEqual(gitLib.compare(L, G(['c', 'b'])), { state: 'ok' });
  assert.deepStrictEqual(gitLib.compare(L, G(['e', 'd', 'c'])), { state: 'behind', n: 2 });
  assert.deepStrictEqual(gitLib.compare(L, G(['a'])), { state: 'ahead', n: 2 });
  assert.deepStrictEqual(gitLib.compare(L, G(['x', 'y'])), { state: 'diverged' });
  assert.strictEqual(gitLib.compare({ ...L, branch: 'dev' }, G(['c'])).state, 'branch');
  assert.strictEqual(gitLib.compare(L, { ok: false }), null);
});

test('l\'etat d\'un depot se lit sans rien y ecrire', { skip: !hasGit && 'git absent' }, async () => {
  const root = tmp('tower-git-');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'premier');
  fs.writeFileSync(path.join(root, 'a.txt'), 'b');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');
  git(root, 'remote', 'add', 'origin', 'https://jeton@github.com/moi/jeu.git');
  const index = fs.statSync(path.join(root, '.git', 'index')).mtimeMs;
  const L = await gitLib.local(root);
  assert.strictEqual(L.isRepo, true);
  assert.strictEqual(L.branch, 'main');
  assert.deepStrictEqual([L.dirty.total, L.dirty.modified, L.dirty.untracked], [2, 1, 1]);
  assert.strictEqual(L.commits[0].subject, 'premier');
  assert.deepStrictEqual(L.github, { owner: 'moi', repo: 'jeu', url: 'https://github.com/moi/jeu' });
  assert.ok(!JSON.stringify(L.remotes).includes('jeton'), 'aucun identifiant dans la page');
  assert.strictEqual(fs.statSync(path.join(root, '.git', 'index')).mtimeMs, index, 'l\'index n\'est pas reecrit');
  // un sous-dossier d'un depot n'est pas un depot a part : pas d'init propose dedans
  fs.mkdirSync(path.join(root, 'sous'));
  const S = await gitLib.local(path.join(root, 'sous'));
  assert.strictEqual(S.isRepo, false);
  assert.ok(S.inside);
});

test('initialiser git : seulement un dossier suivi, avec le .gitignore Unreal', { skip: !hasGit && 'git absent' }, async () => {
  const root = tmp('tower-gitinit-');
  fs.writeFileSync(path.join(root, 'Jeu.uproject'), '{}');
  let published = null;
  const T = gitLib.create({ list: () => [{ name: 'Jeu', root, kind: 'suivi' }], publish: (v) => { published = v; } });
  assert.strictEqual((await T.init(tmp('tower-autre-'))).ok, false, 'un dossier non suivi est refuse');
  const r = await T.init(root);
  assert.deepStrictEqual(r, { ok: true, gitignore: true });
  assert.ok(fs.existsSync(path.join(root, '.git')));
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^Intermediate\/$/m);
  assert.strictEqual(git(root, 'log', '--oneline', '--all').trim(), '', 'rien n\'est commite');
  assert.strictEqual(published.repos[0].isRepo, true);
  assert.strictEqual((await T.init(root)).ok, false, 'deja initialise');
  // relier a GitHub : une adresse GitHub valide, une seule fois, sans rien pousser
  assert.strictEqual((await T.addRemote(root, 'https://evil.example/x/y')).ok, false);
  assert.strictEqual((await T.addRemote(root, 'https://github.com/moi/jeu')).ok, true);
  assert.strictEqual(git(root, 'remote', 'get-url', 'origin').trim(), 'https://github.com/moi/jeu.git');
  assert.strictEqual((await T.addRemote(root, 'https://github.com/moi/autre')).ok, false);
});

test('les dossiers suivis sont gardes d\'un lancement a l\'autre', () => {
  const s = new TowerState();
  assert.strictEqual(s.followRepo('C:\\Jeux\\Proto', 'Proto'), true);
  assert.strictEqual(s.followRepo('c:\\jeux\\proto', 'Proto'), false);
  const back = new TowerState();
  back.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepStrictEqual(back.gitFollow, [{ name: 'Proto', root: 'C:\\Jeux\\Proto' }]);
  assert.strictEqual(back.unfollowRepo('C:\\Jeux\\Proto'), true);
  assert.deepStrictEqual(back.gitFollow, []);
});
