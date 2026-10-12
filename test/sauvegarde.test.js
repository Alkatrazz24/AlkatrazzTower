'use strict';
// Le batiment de la sauvegarde (lib/sauvegarde.js) : une copie complete du projet (historique, LFS,
// travail pas commite, Saved/Tour) dans un dossier ou vers un depot, sans jamais toucher au projet.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const SV = require('../lib/sauvegarde');
const { TowerState } = require('../server/state');

let hasGit = true, hasLfs = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }
try { execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' }); } catch { hasLfs = false; }
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const who = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_COMMITTER_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: who, stdio: 'pipe' }).toString();
const ctxOf = (dataDir, steps = []) => ({ dataDir, step: (id) => steps.push(id), progress: () => {}, aborted: () => false, child: () => {} });

// Un faux projet Unreal : un gros fichier en LFS, deux stash, du travail pas commite, Saved/Tour.
function projet() {
  const base = tmp('tower-sv-');
  const src = path.join(base, 'Mon Jeu');
  fs.mkdirSync(src);
  const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); fs.writeFileSync(path.join(src, rel), body); };
  git(src, 'init', '-q', '-b', 'main');
  if (hasLfs) git(src, 'lfs', 'install', '--local');
  w('Jeu.uproject', '{}');
  w('.gitattributes', '*.uasset filter=lfs diff=lfs merge=lfs -text\n');
  w('.gitignore', 'Saved/\nIntermediate/\n');
  w('Content/Gros.uasset', Buffer.alloc(200_000, 7));
  w('a.txt', 'a'); w('b.txt', 'b');
  git(src, 'add', '-A'); git(src, 'commit', '-qm', 'premier');
  git(src, 'tag', 'v1');
  w('a.txt', 'stash 1'); git(src, 'stash', '-q');
  w('a.txt', 'stash 2'); git(src, 'stash', '-q');
  w('a.txt', 'modifié'); fs.unlinkSync(path.join(src, 'b.txt'));
  w('nouveau é.txt', 'n');
  w('Saved/Tour/carnet.md', 'carnet');
  w('Intermediate/x.bin', 'regenere');
  const data = path.join(base, 'data');
  fs.mkdirSync(data);
  return { base, src, data };
}
const empreinte = (src) => git(src, 'status', '--porcelain') + git(src, 'stash', 'list') + git(src, 'for-each-ref') + fs.readFileSync(path.join(src, '.git', 'index')).toString('hex');

test('les adresses de depot acceptees, et rien d\'autre', () => {
  for (const u of ['https://github.com/ali/jeu-sauvegarde.git', 'git@github.com:ali/jeu.git', 'ssh://git@nas.local/srv/jeu.git', 'file:///D:/depots/jeu.git']) assert.ok(SV.validRemote(u), u);
  for (const u of ['', '--upload-pack=calc', 'D:\\depots\\jeu', 'https://github.com', 'https://a b/c', 'ftp://x/y']) assert.ok(!SV.validRemote(u), u);
  assert.strictEqual(SV.hideAuth('https://ali:jeton@github.com/ali/jeu.git'), 'https://github.com/ali/jeu.git');
  assert.ok(SV.isGithub('git@github.com:ali/jeu.git') && !SV.isGithub('https://gitlab.com/ali/jeu'));
  assert.strictEqual(SV.safeName('Jeu: v2 / test. '), 'Jeu_ v2 _ test');
});

test('un depot sur disque donne en file:// devient une vraie adresse, meme sous Windows', () => {
  assert.strictEqual(SV.remoteUrl('file://C:\\Users\\ALKATR~1\\Temp\\mon depot.git'), 'file:///C:/Users/ALKATR~1/Temp/mon%20depot.git');
  assert.strictEqual(SV.remoteUrl('file:///D:/Depots/Jeu.git'), 'file:///D:/Depots/Jeu.git');
  // un chemin sans lecteur : sous Windows, il prend le lecteur courant
  assert.strictEqual(SV.remoteUrl('file:///srv/a b/jeu.git'), require('url').pathToFileURL(path.resolve('/srv/a b/jeu.git')).href);
  assert.strictEqual(SV.remoteUrl('https://github.com/ali/jeu.git'), 'https://github.com/ali/jeu.git');
  assert.ok(SV.validRemote(SV.remoteUrl('file://C:\\Depots\\Mon Jeu.git')));
});

test('le chemin reel d\'une destination pas encore creee', { skip: !hasGit }, () => {
  const base = tmp('tower-sv-');
  fs.mkdirSync(path.join(base, 'Long'));
  try { fs.symlinkSync(path.join(base, 'Long'), path.join(base, 'COURT~1'), 'junction'); } catch { return; }
  assert.strictEqual(SV.real(path.join(base, 'COURT~1', 'Jeu', 'Sauvegardes')), path.join(fs.realpathSync.native(base), 'Long', 'Jeu', 'Sauvegardes'));
});

test('git status -z : les chemins, renommages compris', () => {
  assert.deepStrictEqual(SV.parseStatusZ(' M a.txt\0?? dossier/nouveau é.txt\0R  neuf.txt\0vieux.txt\0 D b.txt\0'), ['a.txt', 'dossier/nouveau é.txt', 'neuf.txt', 'vieux.txt', 'b.txt']);
});

test('un projet ouvert par un autre chemin (nom court Windows, lien) reste un depot git', { skip: !hasGit }, async () => {
  const base = tmp('tower-sv-');
  fs.mkdirSync(path.join(base, 'Long', 'Jeu'), { recursive: true });
  git(path.join(base, 'Long', 'Jeu'), 'init', '-q');
  try { fs.symlinkSync(path.join(base, 'Long'), path.join(base, 'COURT~1'), 'junction'); } catch { return; } // liens interdits ici
  assert.ok((await SV.inspect(path.join(base, 'COURT~1', 'Jeu'))).isRepo);
});

test('sauvegarde dans un dossier : tout y est, le projet n\'a pas bouge', { skip: !hasGit }, async () => {
  const { base, src, data } = projet();
  const avant = empreinte(src);
  const dest = path.join(base, 'Disque externe');
  const steps = [];
  const r = await SV.backup({ root: src, name: 'Mon Jeu', type: 'dossier', dest }, ctxOf(data, steps));
  assert.strictEqual(empreinte(src), avant, 'le projet ne doit pas changer');
  assert.deepStrictEqual(steps, ['lecture', 'historique', ...(hasLfs ? ['lfs'] : []), 'en-cours', 'verif']);
  assert.ok(r.verified);
  assert.deepStrictEqual([r.branches, r.tags, r.stashes], [1, 1, 2]);
  assert.deepStrictEqual([r.wip.files, r.wip.removed, r.wip.extra], [2, 1, 1]);
  assert.ok(fs.existsSync(path.join(dest, 'Mon Jeu - LISEZMOI.txt')));
  if (hasLfs) assert.strictEqual(r.lfs.copied, 1);

  // on retrouve tout dans un clone de la sauvegarde
  const rest = path.join(base, 'restauré');
  execFileSync('git', ['clone', '-q', path.join(dest, 'Mon Jeu.git'), rest], { env: who, stdio: 'pipe' });
  if (hasLfs) { git(rest, 'lfs', 'fetch', '--all'); git(rest, 'lfs', 'checkout'); assert.strictEqual(fs.statSync(path.join(rest, 'Content', 'Gros.uasset')).size, 200_000); }
  git(rest, 'checkout', '-q', 'tour-sauvegarde/en-cours');
  assert.strictEqual(fs.readFileSync(path.join(rest, 'a.txt'), 'utf8'), 'modifié');
  assert.ok(!fs.existsSync(path.join(rest, 'b.txt')));
  assert.ok(fs.existsSync(path.join(rest, 'nouveau é.txt')));
  assert.strictEqual(fs.readFileSync(path.join(rest, 'Saved', 'Tour', 'carnet.md'), 'utf8'), 'carnet');
  assert.ok(!fs.existsSync(path.join(rest, 'Intermediate')), 'ce qu\'Unreal regenere reste dehors');
  assert.match(git(rest, 'show', 'origin/tour-sauvegarde/stash-1:a.txt'), /stash 1/);

  // une deuxieme sauvegarde sans changement ne recopie rien
  const r2 = await SV.backup({ root: src, name: 'Mon Jeu', type: 'dossier', dest }, ctxOf(data));
  assert.ok(r2.wip.unchanged && r2.lfs.copied === 0 && r2.verified);
  // un nouveau changement : nouvelle sauvegarde du travail en cours, l'ancienne gardee
  fs.writeFileSync(path.join(src, 'a.txt'), 'encore');
  const r3 = await SV.backup({ root: src, name: 'Mon Jeu', type: 'dossier', dest }, ctxOf(data));
  assert.ok(!r3.wip.unchanged);
  assert.ok(git(src, 'status', '--porcelain').includes('a.txt'));
});

test('sauvegarde vers un depot : on pousse sans jamais ecraser la destination', { skip: !hasGit }, async () => {
  const { base, src, data } = projet();
  const avant = empreinte(src);
  const bare = path.join(base, 'distant.git');
  git(base, 'init', '-q', '--bare', bare);
  const r = await SV.backup({ root: src, name: 'Mon Jeu', type: 'depot', dest: `file://${bare}` }, ctxOf(data));
  assert.strictEqual(empreinte(src), avant);
  assert.ok(r.verified, JSON.stringify(r.warnings));
  const heads = git(base, '--git-dir', bare, 'for-each-ref', '--format=%(refname)');
  for (const n of ['refs/heads/main', 'refs/tags/v1', 'refs/heads/tour-sauvegarde/en-cours', 'refs/heads/tour-sauvegarde/stash-0']) assert.ok(heads.includes(n), n);
  if (hasLfs) assert.ok(fs.readdirSync(path.join(bare, 'lfs', 'objects')).length, 'les fichiers LFS sont partis');
  assert.deepStrictEqual(fs.readdirSync(path.join(data, 'sauvegarde-relais')), [], 'le relais est efface');

  // la destination a un commit que le PC n'a pas : refuse et signale, rien n'est ecrase
  const autre = path.join(base, 'autre');
  execFileSync('git', ['clone', '-q', '-b', 'main', bare, autre], { env: { ...who, GIT_LFS_SKIP_SMUDGE: '1' }, stdio: 'pipe' });
  fs.writeFileSync(path.join(autre, 'c.txt'), 'c'); git(autre, 'add', '-A'); git(autre, 'commit', '-qm', 'ailleurs'); git(autre, 'push', '-q', 'origin', 'main');
  const theirs = git(base, '--git-dir', bare, 'rev-parse', 'main');
  git(src, 'stash', 'push', '-q'); fs.writeFileSync(path.join(src, 'd.txt'), 'd'); git(src, 'add', 'd.txt'); git(src, 'commit', '-qm', 'ici');
  const r2 = await SV.backup({ root: src, name: 'Mon Jeu', type: 'depot', dest: `file://${bare}` }, ctxOf(data));
  assert.match(r2.warnings.join(' '), /main/);
  assert.strictEqual(git(base, '--git-dir', bare, 'rev-parse', 'main'), theirs);
});

test('un dossier sans git : tout est copie dans un dossier, refuse vers un depot', { skip: !hasGit }, async () => {
  const base = tmp('tower-sv-');
  const src = path.join(base, 'Proto');
  for (const [rel, body] of [['Proto.uproject', '{}'], ['Content/Carte.umap', 'carte'], ['Binaries/Win64/x.dll', 'dll'], ['Saved/Logs/log.txt', 'log'], ['Saved/Tour/rapport.md', 'r']]) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); fs.writeFileSync(path.join(src, rel), body);
  }
  const data = path.join(base, 'data'); fs.mkdirSync(data);
  const dest = path.join(base, 'NAS');
  const r = await SV.backup({ root: src, name: 'Proto', type: 'dossier', dest }, ctxOf(data));
  assert.ok(r.verified);
  const files = git(base, '--git-dir', path.join(dest, 'Proto.git'), 'ls-tree', '-r', '--name-only', 'tour-sauvegarde/en-cours').trim().split('\n').sort();
  assert.deepStrictEqual(files, ['Content/Carte.umap', 'Proto.uproject', 'Saved/Tour/rapport.md']);
  await assert.rejects(SV.backup({ root: src, name: 'Proto', type: 'depot', dest: 'https://github.com/ali/proto.git' }, ctxOf(data)), /initialise d'abord git/);
  await assert.rejects(SV.backup({ root: src, name: 'Proto', type: 'dossier', dest: path.join(src, 'Sauvegardes') }, ctxOf(data)), /dans le projet/);
  let court = null;
  try { fs.symlinkSync(base, path.join(path.dirname(base), `${path.basename(base)}~1`), 'junction'); court = path.join(path.dirname(base), `${path.basename(base)}~1`); } catch { /* liens interdits */ }
  if (court) await assert.rejects(SV.backup({ root: src, name: 'Proto', type: 'dossier', dest: path.join(court, 'Proto', 'Sauvegardes') }, ctxOf(data)), /dans le projet/);
});

test('le batiment : destination par projet, une sauvegarde a la fois, reprise apres redemarrage', { skip: !hasGit }, async () => {
  const { base, src, data } = projet();
  const state = new TowerState();
  const list = () => [{ name: 'Mon Jeu', root: src, kind: 'projet' }];
  const sv = SV.create(state, { list, dataDir: data });
  assert.match(sv.start(src).error, /Choisis d'abord/);
  assert.match(sv.setTarget(src, { type: 'dossier', dest: 'Sauvegardes' }).error, /Chemin complet/);
  assert.match(sv.setTarget(src, { type: 'dossier', dest: path.join(src, 'Saved') }).error, /dans le projet/);
  assert.match(sv.setTarget(src, { type: 'depot', dest: '--upload-pack=calc' }).error, /Adresse de dépôt/);
  assert.match(sv.setTarget(path.join(base, 'ailleurs'), { type: 'dossier', dest: base }).error, /pas suivi/);
  assert.ok(sv.setTarget(src, { type: 'dossier', dest: path.join(base, 'Disque') }).ok);
  await sv.refresh();
  let v = sv.view();
  assert.strictEqual(v.projects[0].target.type, 'dossier');
  assert.ok(v.projects[0].info.isRepo && v.projects[0].info.uproject);
  const s = sv.start(src);
  assert.ok(s.ok);
  assert.match(sv.start(src).error, /déjà en cours/);
  assert.match(sv.setTarget(src, { type: '' }).error, /en cours/);
  for (let i = 0; i < 200 && sv.view().current; i++) await new Promise(r => setTimeout(r, 50));
  v = sv.view();
  assert.strictEqual(v.runs[0].step, 'fini', v.runs[0].error);
  assert.ok(v.projects[0].lastOk && v.runs[0].result.verified);

  // une sauvegarde coupee par un redemarrage de la tour : marquee interrompue
  const saved = JSON.parse(JSON.stringify(state.toJSON()));
  saved.sauvegarde.runs.unshift({ id: 'sx', root: src, name: 'Mon Jeu', startedAt: 1, step: 'lfs' });
  const st2 = new TowerState();
  st2.load(saved);
  assert.strictEqual(st2.sauvegarde.runs[0].step, 'erreur');
  assert.match(st2.sauvegarde.runs[0].error, /redémarré/);
  assert.strictEqual(Object.keys(st2.sauvegarde.cibles).length, 1);
});

test('git status -z : un renommage dans l\'arbre de travail (git add -N) garde ses deux chemins', () => {
  assert.deepStrictEqual(SV.parseStatusZ(' R src/Bar.cpp\0src/Foo.cpp\0 M a.txt\0'), ['src/Bar.cpp', 'src/Foo.cpp', 'a.txt']);
});

test('un depot deja dans la destination, que la tour n\'a pas cree, n\'est jamais touche', { skip: !hasGit }, async () => {
  const { src } = projet();
  const dest = tmp('tower-sv-dest-'), data = tmp('tower-sv-data-');
  // le depot partage d'ali, au meme nom que la sauvegarde
  const shared = path.join(dest, 'Mon Jeu.git');
  git(dest, 'init', '-q', '--bare', shared);
  const before = git(shared, 'for-each-ref');
  await assert.rejects(SV.backup({ root: src, name: 'Mon Jeu', type: 'dossier', dest }, ctxOf(data)), /pas été créé par la tour/);
  assert.strictEqual(git(shared, 'for-each-ref'), before);
  // la sauvegarde d'un autre projet du meme nom non plus
  const other = projet().src;
  const dest2 = tmp('tower-sv-dest-');
  await SV.backup({ root: src, name: 'Mon Jeu', type: 'dossier', dest: dest2 }, ctxOf(data));
  await assert.rejects(SV.backup({ root: other, name: 'Mon Jeu', type: 'dossier', dest: dest2 }, ctxOf(data)), /sauvegarde d'un autre projet/);
});
