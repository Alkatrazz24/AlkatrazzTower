'use strict';
// Le batiment de la sauvegarde : une copie complete d'un projet, ailleurs que sur son disque.
// Pour chaque projet, ali choisit une destination :
//   - « dossier » : un autre disque, un disque externe ou un NAS. La tour y tient un depot git nu
//     (<destination>\<Projet>.git) avec tout l'historique, tous les fichiers LFS, et une branche
//     tour-sauvegarde/en-cours qui contient le travail pas encore commite et Saved/Tour.
//   - « depot » : l'adresse d'un depot git (GitHub, GitLab, un serveur) : la tour y pousse la meme chose.
// Le projet n'est jamais modifie : ni commit, ni stash, ni index, ni branche. La tour lit le projet
// (git fetch depuis lui, git status --no-optional-locks, lecture des fichiers) et n'ecrit que dans la
// destination ou dans un depot relais jetable de data\ (pour un depot distant).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const BRANCH = 'tour-sauvegarde';            // les branches de la tour dans la destination
const BIG_REMOTE = 50 * 1024 * 1024;         // au-dela, un depot distant refuse souvent le fichier (GitHub : 100 Mo)
const KEEP_HISTORY = 20;                     // sauvegardes du travail en cours gardees dans un dossier
const MAX_RUNS = 30;
const GITHUB_LFS_FREE = 10 * 1024 ** 3;
// Ce qu'Unreal (ou un outil) regenere tout seul : jamais copie quand le projet n'a pas git.
const SKIP_DIRS = new Set(['.git', 'binaries', 'intermediate', 'deriveddatacache', 'saved', '.vs', '.idea', 'node_modules']);
const EXTRA = ['Saved/Tour']; // ignore par git mais precieux : carnets, rapports, verdicts du conseil
const WHO = { GIT_AUTHOR_NAME: 'Alkatrazz Tower', GIT_AUTHOR_EMAIL: 'tour@alkatrazz.local', GIT_COMMITTER_NAME: 'Alkatrazz Tower', GIT_COMMITTER_EMAIL: 'tour@alkatrazz.local' };

class Stop extends Error {}
const fail = (msg) => { throw new Stop(msg); };

// git sans fenetre ni question au terminal. interactive : laisse le gestionnaire d'identifiants ouvrir
// sa fenetre de connexion (un envoi vers un depot distant part d'un clic d'ali).
function sh(args, { cwd, env = {}, input = null, timeout = 60_000, onChild = null, interactive = false } = {}) {
  return new Promise((resolve) => {
    const e = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env };
    if (!interactive) e.GCM_INTERACTIVE = 'never';
    let child, done = false, timedOut = false;
    const out = [], err = [];
    let size = 0;
    const end = (r) => { if (done) return; done = true; clearTimeout(timer); if (onChild) onChild(null); resolve(r); };
    try { child = spawn('git', ['-c', 'safe.directory=*', '-c', 'core.quotepath=false', ...args], { cwd: cwd || process.cwd(), env: e, windowsHide: true }); }
    catch (x) { return resolve({ ok: false, out: '', err: x.message }); }
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    if (onChild) onChild(child);
    child.stdout.on('data', (d) => { size += d.length; if (size < 64 * 1024 * 1024) out.push(d); });
    child.stderr.on('data', (d) => { err.push(d); if (err.length > 400) err.splice(0, 200); });
    child.on('error', (x) => end({ ok: false, missing: x.code === 'ENOENT', out: '', err: x.code === 'ENOENT' ? 'git introuvable' : x.message }));
    child.on('close', (code) => end({ ok: code === 0 && !timedOut, code, timedOut, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8').trim() }));
    child.stdin.on('error', () => { /* git a fini avant de tout lire */ });
    child.stdin.end(input == null ? undefined : input);
  });
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// Le chemin reel : git donne toujours le chemin long, alors qu'un dossier peut arriver par un nom court
// Windows (C:\Users\ALKATR~1\...) ou par un lien.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const inside = (child, parent) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };
const slash = (p) => p.split(path.sep).join('/');
const lastLine = (s) => String(s || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || '';
function safeName(name) { return String(name || 'projet').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'projet'; }
function gb(n) { return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} ko`; }

// L'adresse d'un depot distant : https, ssh ou git@hote:chemin. Jamais une option de git deguisee.
function validRemote(url) {
  const u = String(url || '').trim();
  return u.length < 500 && !/\s/.test(u) && !u.startsWith('-') && /^(?:https?:\/\/[^/\s]+\/\S+|ssh:\/\/\S+|file:\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/.test(u);
}
const hideAuth = (url) => String(url || '').replace(/\/\/[^@/]+@/, '//');
const isGithub = (url) => /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/i.test(String(url || ''));

// Les fichiers d'un dossier, sans suivre les liens (un plugin relie par jonction n'est pas recopie).
async function listFiles(dir, { skip = null, abort = () => false } = {}) {
  const out = [];
  async function walk(d, rel) {
    if (abort()) return;
    let names;
    try { names = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!(skip && skip(r, e.name))) await walk(path.join(d, e.name), r); }
      else if (e.isFile()) {
        try { const st = await fsp.stat(path.join(d, e.name)); out.push({ rel: r, abs: path.join(d, e.name), size: st.size }); } catch { /* parti entre-temps */ }
      }
    }
  }
  await walk(dir, '');
  return out;
}

// Ce qu'on sait d'un projet avant de le sauvegarder : depot git ?, ou est son .git, sa taille LFS.
async function inspect(root) {
  const info = { root, exists: false, isRepo: false, uproject: false, head: null, lfsFiles: 0, lfsBytes: 0, at: Date.now() };
  try { info.exists = fs.statSync(root).isDirectory(); } catch { /* parti */ }
  if (!info.exists) return info;
  try { info.uproject = fs.readdirSync(root).some(n => n.toLowerCase().endsWith('.uproject')); } catch { /* illisible */ }
  const r = await sh(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { cwd: root, timeout: 10_000 });
  if (r.missing) { info.nogit = true; return info; }
  const [top, common] = r.out.split(/\r?\n/);
  if (r.ok && top && same(real(top), real(root)) && common) {
    info.isRepo = true;
    info.gitDir = path.resolve(common);
    const h = await sh(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { cwd: root, timeout: 10_000 });
    info.head = h.ok ? h.out.trim() : null;
    const lfs = await listFiles(path.join(info.gitDir, 'lfs', 'objects'));
    info.lfsFiles = lfs.length;
    info.lfsBytes = lfs.reduce((s, f) => s + f.size, 0);
  }
  return info;
}

// « XY chemin\0 » ; un renommage ajoute l'ancien chemin juste apres.
function parseStatusZ(text) {
  const parts = String(text || '').split('\0');
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    paths.push(p.slice(3));
    if (p[0] === 'R' || p[0] === 'C') { if (parts[i + 1]) paths.push(parts[i + 1]); i++; }
  }
  return [...new Set(paths)];
}

function stamp(t) {
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const frDate = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function readme(name, file) {
  return [
    `Sauvegarde de « ${name} » par Alkatrazz Tower`,
    '',
    `Le dossier ${file} est un dépôt git complet : tout l'historique, toutes les branches et`,
    'les étiquettes, les fichiers Git LFS, et le travail pas encore commité au moment de la sauvegarde.',
    '',
    'Pour tout retrouver dans un nouveau dossier (Git et Git LFS installés) :',
    '',
    `  git clone "${file}" "${name} (restauré)"`,
    `  cd "${name} (restauré)"`,
    '  git lfs fetch --all',
    '  git lfs checkout',
    '',
    'Le travail pas encore commité et Saved\\Tour sont sur la branche tour-sauvegarde/en-cours :',
    '',
    '  git checkout tour-sauvegarde/en-cours',
    '',
    'Les sauvegardes précédentes du travail en cours : git for-each-ref refs/tour-sauvegarde/',
    'Les stash : branches tour-sauvegarde/stash-0, stash-1…',
    '',
    'Ne modifie pas ce dossier à la main : la tour le complète à chaque sauvegarde.',
    '',
  ].join('\r\n');
}

// Une sauvegarde complete. ctx : { step(id, texte), progress(o), aborted(), child(c), dataDir }
async function backup(job, ctx) {
  const t0 = Date.now();
  const remote = job.type === 'depot';
  const res = { head: null, branches: 0, tags: 0, stashes: 0, lfs: { files: 0, bytes: 0, copied: 0, copiedBytes: 0 }, wip: { files: 0, removed: 0, extra: 0, bytes: 0, skipped: [], commit: null, unchanged: false }, warnings: [], size: null, verified: false };
  const stop = () => { if (ctx.aborted()) fail('Sauvegarde arrêtée.'); };
  ctx.step('lecture', 'Lecture du projet');
  const info = await inspect(job.root);
  if (!info.exists) fail(`Le dossier du projet est introuvable : ${job.root}`);
  if (info.nogit) fail('Git n\'est pas installé sur ce PC : installe-le (bâtiment Dépôts), puis relance la sauvegarde.');
  if (remote && !validRemote(job.dest)) fail('Adresse de dépôt invalide : https://…, ssh://… ou git@serveur:chemin.');
  if (!remote && inside(real(job.dest), real(job.root))) fail('La destination est dans le projet lui-même : choisis un autre disque ou un autre dossier.');
  if (remote && !info.isRepo) fail('Ce dossier n\'a pas git : pour l\'envoyer sur un dépôt, initialise d\'abord git (bâtiment Dépôts), ou choisis un dossier comme destination.');

  // T : le depot qui recoit tout. Dans un dossier, il reste ; pour un depot distant, c'est un relais
  // jetable dans data\ qui emprunte les objets du projet (alternates) au lieu de les recopier.
  let T;
  if (remote) {
    const dir = path.join(ctx.dataDir, 'sauvegarde-relais');
    fs.mkdirSync(dir, { recursive: true });
    T = fs.mkdtempSync(path.join(dir, 'r-'));
  } else {
    try { fs.mkdirSync(job.dest, { recursive: true }); } catch { fail(`Destination inaccessible : ${job.dest}. Disque débranché ou chemin faux ?`); }
    T = path.join(job.dest, `${safeName(job.name)}.git`);
  }
  const G = (args, o = {}) => sh([`--git-dir=${T}`, ...args], { cwd: T, onChild: ctx.child, ...o });
  const indexFile = path.join(ctx.dataDir, `sauvegarde-index-${process.pid}-${Date.now()}`);
  try {
    if (!fs.existsSync(path.join(T, 'HEAD'))) {
      fs.mkdirSync(T, { recursive: true });
      const r = await sh(['init', '--bare', '-q', T], { cwd: T });
      if (!r.ok) fail(`Impossible de créer le dépôt de sauvegarde : ${lastLine(r.err)}`);
    }
    if (remote) fs.writeFileSync(path.join(T, 'objects', 'info', 'alternates'), `${path.join(info.gitDir, 'objects')}\n`);
    else { try { fs.writeFileSync(path.join(job.dest, `${safeName(job.name)} - LISEZMOI.txt`), readme(job.name, `${safeName(job.name)}.git`)); } catch { /* pas grave */ } }

    // 1. L'historique : toutes les references du projet (branches, etiquettes, stash), lues sans rien y ecrire.
    if (info.isRepo) {
      stop();
      ctx.step('historique', 'Copie de l\'historique git');
      const f = await G(['fetch', '--quiet', '--update-head-ok', job.root, '+refs/*:refs/*'], { timeout: 60 * 60_000 });
      stop();
      if (!f.ok) fail(`Copie de l'historique impossible : ${lastLine(f.err)}`);
      // la branche ouverte du projet devient celle de la sauvegarde : un clone s'ouvre dessus
      const hb = await sh(['symbolic-ref', '-q', 'HEAD'], { cwd: job.root, timeout: 10_000 });
      if (!remote && hb.ok && /^refs\/heads\/\S+$/.test(hb.out.trim())) await G(['symbolic-ref', 'HEAD', hb.out.trim()]);
      // les stash plus anciens ne vivent que dans le reflog : chacun devient une branche de la sauvegarde
      const sl = await sh(['--no-optional-locks', 'log', '-g', '--format=%H', 'refs/stash', '--'], { cwd: job.root, timeout: 30_000 });
      const stashes = sl.ok ? sl.out.split(/\r?\n/).filter(s => /^[0-9a-f]{40,64}$/.test(s)) : [];
      if (stashes.length) {
        const s = await G(['fetch', '--quiet', job.root, ...stashes.map((h, i) => `+${h}:refs/heads/${BRANCH}/stash-${i}`)], { timeout: 10 * 60_000 });
        if (!s.ok) res.warnings.push(`Les anciens stash n'ont pas pu être copiés (${lastLine(s.err)}).`);
        else res.stashes = stashes.length;
      }
      const refs = await G(['for-each-ref', '--format=%(refname)'], { timeout: 30_000 });
      const names = refs.out.split(/\r?\n/).filter(Boolean);
      for (const n of names) {
        const m = new RegExp(`^refs/heads/${BRANCH}/stash-(\\d+)$`).exec(n);
        if (m && +m[1] >= stashes.length) await G(['update-ref', '-d', n]); // un stash qui n'existe plus
      }
      res.branches = names.filter(n => n.startsWith('refs/heads/') && !n.startsWith(`refs/heads/${BRANCH}/`)).length;
      res.tags = names.filter(n => n.startsWith('refs/tags/')).length;
      res.head = info.head;
    }

    // 2. Les fichiers LFS : les gros fichiers du projet, rangés à part par git-lfs.
    const lfsDir = info.isRepo ? path.join(info.gitDir, 'lfs', 'objects') : null;
    const lfs = lfsDir ? await listFiles(lfsDir, { abort: ctx.aborted }) : [];
    res.lfs.files = lfs.length;
    res.lfs.bytes = lfs.reduce((s, x) => s + x.size, 0);
    if (lfs.length && !remote) {
      stop();
      const destLfs = path.join(T, 'lfs', 'objects');
      const todo = lfs.filter(x => { try { return fs.statSync(path.join(destLfs, x.rel)).size !== x.size; } catch { return true; } });
      const need = todo.reduce((s, x) => s + x.size, 0);
      try {
        const st = fs.statfsSync(job.dest);
        const free = Number(st.bavail) * Number(st.bsize);
        if (free < need + 512 * 1024 ** 2) fail(`Pas assez de place sur la destination : il faut ${gb(need)} pour les fichiers LFS, il reste ${gb(free)}.`);
      } catch (e) { if (e instanceof Stop) throw e; }
      ctx.step('lfs', `Copie des fichiers LFS : ${todo.length} à copier sur ${lfs.length}`);
      let n = 0, bytes = 0, last = 0;
      for (const x of todo) {
        stop();
        const to = path.join(destLfs, x.rel);
        await fsp.mkdir(path.dirname(to), { recursive: true });
        const tmp = `${to}.tmp`;
        try { await fsp.copyFile(x.abs, tmp); await fsp.rename(tmp, to); }
        catch (e) { try { fs.unlinkSync(tmp); } catch { /* rien a nettoyer */ } fail(`Copie LFS impossible (${x.rel}) : ${e.code === 'ENOSPC' ? 'disque plein' : e.message}`); }
        n++; bytes += x.size;
        if (Date.now() - last > 400) { last = Date.now(); ctx.progress({ done: n, total: todo.length, bytes, totalBytes: need }); }
      }
      res.lfs.copied = n; res.lfs.copiedBytes = bytes;
    } else if (lfs.length && remote) {
      stop();
      const v = await sh(['lfs', 'version'], { timeout: 10_000 });
      if (!v.ok) fail('Ce projet a des fichiers LFS mais git-lfs n\'est pas installé : impossible de les envoyer.');
      ctx.step('lfs', `Envoi des fichiers LFS (${gb(res.lfs.bytes)})`);
      // le relais montre les fichiers LFS du projet par des liens durs (rien n'est recopie) ; sur un
      // autre disque, git-lfs les lit directement dans le projet (lfs.storage)
      let linked = true;
      for (const x of lfs) {
        const to = path.join(T, 'lfs', 'objects', x.rel);
        try { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.link(x.abs, to); } catch { linked = false; break; }
      }
      if (!linked) await G(['config', 'lfs.storage', path.join(info.gitDir, 'lfs')]);
      const p = await G(['lfs', 'push', '--all', job.dest], { timeout: 6 * 60 * 60_000, interactive: true });
      stop();
      if (!p.ok) fail(`Envoi des fichiers LFS refusé : ${lastLine(p.err) || 'erreur inconnue'}${isGithub(job.dest) && res.lfs.bytes > GITHUB_LFS_FREE ? ' (GitHub gratuit : 10 Go de LFS)' : ''}`);
      res.lfs.copied = lfs.length; res.lfs.copiedBytes = res.lfs.bytes;
    }

    // 3. Le travail en cours : ce qui n'est pas commite, plus Saved/Tour, dans un commit de la sauvegarde
    // (jamais dans le projet). Son parent est le HEAD du projet : la difference montre ce qui a change.
    stop();
    ctx.step('en-cours', 'Sauvegarde du travail pas encore commité');
    const add = [], del = [];
    if (info.isRepo) {
      const st = await sh(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: job.root, timeout: 10 * 60_000, onChild: ctx.child });
      if (!st.ok) fail(`Lecture du travail en cours impossible : ${lastLine(st.err)}`);
      for (const rel of parseStatusZ(st.out)) {
        const abs = path.join(job.root, ...rel.split('/'));
        let s = null;
        try { s = fs.lstatSync(abs); } catch { /* supprime */ }
        if (!s) del.push(rel);
        else if (s.isFile()) add.push({ rel, abs, size: s.size });
      }
    } else {
      add.push(...await listFiles(job.root, { abort: ctx.aborted, skip: (rel, name) => rel.indexOf('/') < 0 ? SKIP_DIRS.has(name.toLowerCase()) : ['.git', '.vs', 'node_modules'].includes(name.toLowerCase()) }));
    }
    const nWip = add.length;
    if (info.uproject || !info.isRepo) {
      for (const e of EXTRA) {
        const dir = path.join(job.root, ...e.split('/'));
        for (const f of await listFiles(dir, { abort: ctx.aborted })) add.push({ rel: `${e}/${f.rel}`, abs: f.abs, size: f.size });
      }
    }
    const extra = add.length - nWip;
    const keep = [];
    for (const f of add) {
      if (remote && f.size > BIG_REMOTE) res.wip.skipped.push({ rel: f.rel, size: f.size });
      else keep.push(f);
    }
    const env = { GIT_INDEX_FILE: indexFile, ...WHO };
    const rt = await G(info.head ? ['read-tree', info.head] : ['read-tree', '--empty'], { env });
    if (!rt.ok) fail(`Préparation du travail en cours impossible : ${lastLine(rt.err)}`);
    stop();
    let shas = [];
    if (keep.length) {
      ctx.progress({ done: 0, total: keep.length });
      const hs = await G(['hash-object', '-w', '--no-filters', '--stdin-paths'], { input: keep.map(f => f.abs).join('\n') + '\n', timeout: 6 * 60 * 60_000 });
      stop();
      shas = hs.out.split(/\r?\n/).filter(Boolean);
      if (!hs.ok || shas.length !== keep.length) fail(`Lecture d'un fichier impossible : ${lastLine(hs.err) || 'fichier verrouillé ?'}`);
    }
    const Z = '0'.repeat(info.head ? info.head.length : 40);
    const lines = keep.map((f, i) => `100644 ${shas[i]}\t${f.rel}\0`).concat(del.map(rel => `0 ${Z}\t${rel}\0`));
    if (lines.length) {
      const ui = await G(['update-index', '-z', '--index-info'], { env, input: lines.join('') });
      if (!ui.ok) fail(`Préparation du travail en cours impossible : ${lastLine(ui.err)}`);
    }
    const wt = await G(['write-tree'], { env });
    if (!wt.ok) fail(`Préparation du travail en cours impossible : ${lastLine(wt.err)}`);
    const tree = wt.out.trim();
    const prev = await G(['rev-parse', '--verify', '-q', `refs/heads/${BRANCH}/en-cours`]);
    const prevSha = prev.ok ? prev.out.trim() : null;
    const prevInfo = prevSha ? await G(['show', '-s', '--format=%T %P', prevSha]) : null;
    const [prevTree, prevParent] = prevInfo && prevInfo.ok ? prevInfo.out.trim().split(' ') : [];
    const parent = info.head || prevSha;
    if (prevSha && prevTree === tree && (prevParent || null) === (parent || null)) {
      res.wip.commit = prevSha; res.wip.unchanged = true;
    } else {
      const msg = `Sauvegarde Alkatrazz Tower du ${frDate(t0)}\n\n${info.isRepo ? `Travail pas encore commité : ${keep.length - extra} fichier(s) modifié(s) ou nouveau(x), ${del.length} supprimé(s).` : `Tous les fichiers du dossier (${keep.length - extra}).`}\n${extra ? `Saved/Tour : ${extra} fichier(s).\n` : ''}${res.wip.skipped.length ? `Trop gros pour un dépôt distant, pas envoyés : ${res.wip.skipped.map(x => x.rel).join(', ')}\n` : ''}`;
      const ct = await G(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], { env, input: msg });
      if (!ct.ok) fail(`Sauvegarde du travail en cours impossible : ${lastLine(ct.err)}`);
      res.wip.commit = ct.out.trim();
      await G(['update-ref', `refs/heads/${BRANCH}/en-cours`, res.wip.commit]);
      if (!remote) {
        await G(['update-ref', `refs/${BRANCH}/${stamp(t0)}`, res.wip.commit]);
        const old = await G(['for-each-ref', '--sort=-refname', '--format=%(refname)', `refs/${BRANCH}/`]);
        for (const n of old.out.split(/\r?\n/).filter(Boolean).slice(KEEP_HISTORY)) await G(['update-ref', '-d', n]);
      }
    }
    res.wip.files = keep.length - extra; res.wip.removed = del.length; res.wip.extra = extra;
    res.wip.bytes = keep.reduce((s, f) => s + f.size, 0);
    if (res.wip.skipped.length) res.warnings.push(`${res.wip.skipped.length} fichier(s) de plus de ${gb(BIG_REMOTE)} pas commité(s) ne sont pas partis : un dépôt distant les refuse. Commite-les (LFS) ou sauvegarde aussi dans un dossier.`);

    // 4. Vers un depot distant : les branches du projet sans jamais ecraser celles de la destination,
    // les branches de la tour (travail en cours, stash) remplacees a chaque fois.
    if (remote) {
      stop();
      ctx.step('envoi', 'Envoi vers le dépôt');
      const refs = (await G(['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/tags/'])).out.split(/\r?\n/).filter(Boolean);
      const specs = refs.map(n => (n.startsWith(`refs/heads/${BRANCH}/`) ? `+${n}:${n}` : `${n}:${n}`));
      const p = await G(['push', '--porcelain', '--no-verify', job.dest, ...specs], { timeout: 2 * 60 * 60_000, interactive: true });
      stop();
      const rejected = [];
      for (const l of p.out.split(/\r?\n/)) { const m = /^!\t[^:]*:refs\/(?:heads|tags)\/(\S+)\t/.exec(l); if (m) rejected.push(m[1]); }
      if (rejected.length) res.warnings.push(`Refusé par la destination, qui a des commits que le PC n'a pas : ${rejected.join(', ')}. Rien n'y a été écrasé.`);
      else if (!p.ok) fail(`Envoi refusé : ${lastLine(p.err) || 'erreur inconnue'}`);
    }

    // 5. La verification : la destination a bien le dernier commit et le travail en cours.
    ctx.step('verif', 'Vérification');
    if (remote) {
      const ls = await sh(['ls-remote', job.dest, `refs/heads/${BRANCH}/en-cours`], { cwd: T, timeout: 2 * 60_000, interactive: true, onChild: ctx.child });
      res.verified = ls.ok && ls.out.startsWith(res.wip.commit);
      if (!res.verified) res.warnings.push('La vérification sur le dépôt n\'a pas abouti : relance la sauvegarde.');
    } else {
      const want = [res.head, res.wip.commit].filter(Boolean);
      const ok = await G(['cat-file', '--batch-check'], { input: want.join('\n') + '\n' });
      const lfsOk = lfs.every(x => { try { return fs.statSync(path.join(T, 'lfs', 'objects', x.rel)).size === x.size; } catch { return false; } });
      res.verified = ok.ok && !/missing/.test(ok.out) && lfsOk;
      if (!res.verified) res.warnings.push('La vérification a trouvé un manque dans la sauvegarde : relance-la.');
      res.size = (await listFiles(T)).reduce((s, f) => s + f.size, 0);
      res.location = T;
    }
    return res;
  } finally {
    try { fs.rmSync(indexFile, { force: true }); } catch { /* deja parti */ }
    if (remote) { try { fs.rmSync(T, { recursive: true, force: true }); } catch { /* relais garde, nettoye au prochain demarrage */ } }
  }
}

const STEPS = { lecture: 'Lecture du projet', historique: 'Copie de l\'historique', lfs: 'Fichiers LFS', 'en-cours': 'Travail en cours', envoi: 'Envoi', verif: 'Vérification', fini: 'Terminée', erreur: 'Erreur' };

// Le batiment : les projets (la liste vient du serveur), la destination de chacun, les sauvegardes.
// state.sauvegarde = { cibles: { racine en minuscules: { type, dest, at } }, runs: [...] }
function create(state, { list, dataDir }) {
  if (!state.sauvegarde) state.sauvegarde = { cibles: {}, runs: [] };
  const S = state.sauvegarde;
  const infos = new Map(); // racine -> inspect()
  let current = null, child = null, aborted = false, lastPub = 0, pubTimer = null;
  // un relais laisse par une tour arretee en pleine sauvegarde
  try { fs.rmSync(path.join(dataDir, 'sauvegarde-relais'), { recursive: true, force: true }); } catch { /* rien */ }

  const key = (root) => path.resolve(String(root || '')).toLowerCase();
  const find = (root) => list().find(it => root && same(it.root, String(root)));
  function publish(now = false) {
    if (now || Date.now() - lastPub > 700) { lastPub = Date.now(); clearTimeout(pubTimer); pubTimer = null; state.changed(); }
    else if (!pubTimer) pubTimer = setTimeout(() => publish(true), 700);
  }

  async function refresh() {
    for (const it of list()) {
      try { infos.set(key(it.root), await inspect(it.root)); } catch { /* illisible */ }
    }
    publish(true);
  }

  function setTarget(root, { type, dest }) {
    const it = find(root);
    if (!it) return { ok: false, error: 'Ce projet n\'est pas suivi par la tour.' };
    if (current && same(current.root, it.root)) return { ok: false, error: 'Une sauvegarde de ce projet est en cours.' };
    if (!type) { delete S.cibles[key(it.root)]; state.changed(); return { ok: true }; }
    let d = String(dest || '').trim().replace(/^["']|["']$/g, '');
    if (type === 'dossier') {
      if (!path.isAbsolute(d)) return { ok: false, error: 'Chemin complet attendu, par exemple D:\\Sauvegardes ou \\\\NAS\\partage\\Sauvegardes.' };
      d = path.resolve(d);
      if (inside(real(d), real(it.root))) return { ok: false, error: 'La destination est dans le projet lui-même : choisis un autre disque ou un autre dossier.' };
      if (!fs.existsSync(path.parse(d).root)) return { ok: false, error: `Le disque ${path.parse(d).root} est introuvable : branché ?` };
    } else if (type === 'depot') {
      if (!validRemote(d)) return { ok: false, error: 'Adresse de dépôt attendue : https://github.com/toi/projet-sauvegarde.git, ssh://… ou git@serveur:chemin.' };
    } else return { ok: false, error: 'Destination inconnue.' };
    S.cibles[key(it.root)] = { type, dest: d, at: Date.now() };
    state.changed();
    return { ok: true };
  }

  function start(root) {
    const it = find(root);
    if (!it) return { ok: false, error: 'Ce projet n\'est pas suivi par la tour.' };
    const c = S.cibles[key(it.root)];
    if (!c) return { ok: false, error: 'Choisis d\'abord où sauvegarder ce projet.' };
    if (current) return { ok: false, error: `Une sauvegarde est déjà en cours (${current.name}) : attends qu'elle finisse.` };
    const run = { id: `s${Date.now().toString(36)}`, root: it.root, name: it.name, type: c.type, dest: c.type === 'depot' ? hideAuth(c.dest) : c.dest, startedAt: Date.now(), step: 'lecture', stepText: STEPS.lecture, progress: null };
    current = run; aborted = false;
    S.runs.unshift(run);
    S.runs.splice(MAX_RUNS);
    publish(true);
    const ctx = {
      dataDir,
      step: (id, text) => { run.step = id; run.stepText = text || STEPS[id]; run.progress = null; publish(true); },
      progress: (p) => { run.progress = p; publish(); },
      aborted: () => aborted,
      child: (c2) => { child = c2; },
    };
    backup({ root: it.root, name: it.name, type: c.type, dest: c.dest }, ctx)
      .then((r) => { Object.assign(run, { step: 'fini', stepText: STEPS.fini, result: r, ok: true }); })
      .catch((e) => { Object.assign(run, { step: 'erreur', stepText: STEPS.erreur, ok: false, error: e instanceof Stop ? e.message : `Erreur inattendue : ${e.message}` }); if (!(e instanceof Stop)) console.error('[tower] sauvegarde :', e); })
      .finally(() => {
        run.endedAt = Date.now(); run.progress = null; current = null; child = null;
        inspect(it.root).then(i => { infos.set(key(it.root), i); publish(true); }, () => publish(true));
      });
    return { ok: true, id: run.id };
  }

  function stop() {
    if (!current) return { ok: false, error: 'Aucune sauvegarde en cours.' };
    aborted = true;
    if (child) { try { child.kill(); } catch { /* deja fini */ } }
    return { ok: true };
  }

  function view() {
    const projects = list().map(it => {
      const k = key(it.root), c = S.cibles[k] || null, i = infos.get(k) || null;
      const last = S.runs.find(r => same(r.root, it.root) && r.step !== 'erreur' && r.ok) || null;
      const lastAny = S.runs.find(r => same(r.root, it.root)) || null;
      return {
        name: it.name, root: it.root, kind: it.kind,
        target: c && { type: c.type, dest: c.type === 'depot' ? hideAuth(c.dest) : c.dest, sameDisk: c.type === 'dossier' && path.parse(c.dest).root.toLowerCase() === path.parse(it.root).root.toLowerCase(), github: c.type === 'depot' && isGithub(c.dest) },
        info: i && { exists: i.exists, isRepo: i.isRepo, uproject: i.uproject, lfsFiles: i.lfsFiles, lfsBytes: i.lfsBytes, nogit: !!i.nogit },
        lastOk: last && last.endedAt, last: lastAny && lastAny.id,
      };
    });
    // le jeu d'abord : les projets Unreal, puis le reste
    projects.sort((a, b) => (b.info && b.info.uproject ? 1 : 0) - (a.info && a.info.uproject ? 1 : 0));
    return { projects, runs: S.runs.slice(0, 15), current: current && current.id, steps: STEPS, githubLfsFree: GITHUB_LFS_FREE, bigRemote: BIG_REMOTE };
  }

  return { refresh, setTarget, start, stop, view, find };
}

// Au redemarrage, une sauvegarde en cours est perdue avec l'ancienne tour.
function restore(saved) {
  const S = { cibles: {}, runs: [] };
  if (saved && saved.cibles && typeof saved.cibles === 'object') {
    for (const [k, v] of Object.entries(saved.cibles)) if (v && (v.type === 'dossier' || v.type === 'depot') && typeof v.dest === 'string') S.cibles[k] = v;
  }
  if (saved && Array.isArray(saved.runs)) {
    S.runs = saved.runs.slice(0, MAX_RUNS).map(r => (r && !r.endedAt ? { ...r, step: 'erreur', stepText: STEPS.erreur, ok: false, error: 'Interrompue : la tour a redémarré. Relance-la, elle reprend là où elle en était.', endedAt: r.startedAt, progress: null } : r));
  }
  return S;
}

module.exports = { create, restore, backup, inspect, parseStatusZ, validRemote, safeName, hideAuth, isGithub, BRANCH, STEPS };
