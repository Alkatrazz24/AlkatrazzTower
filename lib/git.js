'use strict';
// Le batiment des depots : l'etat git de chaque dossier suivi (branche, derniers commits, travail pas
// encore commite) et, quand il a un depot GitHub, ce qui s'y passe (derniers commits pousses, PR
// ouvertes, avance ou retard du PC sur GitHub).
// La tour lit sans rien changer : git --no-optional-locks ne touche meme pas l'index. Les seules
// commandes qui modifient un depot (git init, git remote add, git fetch) partent d'un clic d'ali.
// Si git n'est pas installe, la tour le dit et donne le lien de telechargement.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const GIT_DOWNLOAD = 'https://git-scm.com/downloads/win';
const MAX_FILES = 12;

// git sans fenetre, sans question (ni mot de passe au terminal, ni fenetre du gestionnaire d'identifiants).
function run(args, cwd, { timeout = 20_000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
    }, (err, out, errOut) => {
      if (err && err.code === 'ENOENT') return resolve({ ok: false, missing: true, out: '', err: 'git introuvable' });
      resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '').trim() });
    });
  });
}

async function gitVersion() {
  const r = await run(['--version'], process.cwd(), { timeout: 5000 });
  if (!r.ok) return null;
  const m = /git version\s+(\S+)/.exec(r.out);
  return { version: m ? m[1] : r.out.trim() };
}

// « ## main...origin/main [ahead 1, behind 2] », « ## No commits yet on main », « ## HEAD (no branch) »
function parseBranch(line) {
  const out = { branch: null, upstream: null, ahead: 0, behind: 0, empty: false, detached: false };
  let s = String(line || '').replace(/^##\s*/, '');
  const empty = /^(?:No commits yet on|Initial commit on)\s+(.+)$/.exec(s);
  if (empty) return { ...out, branch: empty[1].trim(), empty: true };
  if (/^HEAD \(no branch\)/.test(s)) return { ...out, detached: true };
  const track = /\s\[(.*)\]$/.exec(s);
  if (track) {
    s = s.slice(0, track.index);
    const a = /ahead (\d+)/.exec(track[1]), b = /behind (\d+)/.exec(track[1]);
    out.ahead = a ? +a[1] : 0; out.behind = b ? +b[1] : 0;
    if (/gone/.test(track[1])) out.gone = true;
  }
  const [branch, upstream] = s.split('...');
  return { ...out, branch: branch.trim() || null, upstream: upstream ? upstream.trim() : null };
}

// git status --porcelain=v1 -b : la branche, puis une ligne par fichier « XY chemin ».
function parseStatus(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  const head = lines[0] && lines[0].startsWith('##') ? parseBranch(lines.shift()) : parseBranch('');
  const dirty = { staged: 0, modified: 0, untracked: 0, conflicts: 0, total: lines.length, files: [] };
  for (const l of lines) {
    const x = l[0], y = l[1], file = l.slice(3).replace(/^"|"$/g, '');
    if (x === '?' && y === '?') dirty.untracked++;
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) dirty.conflicts++;
    else { if (x !== ' ') dirty.staged++; if (y !== ' ') dirty.modified++; }
    if (dirty.files.length < MAX_FILES) dirty.files.push({ st: (x + y).trim() || '?', path: file.split(' -> ').pop() });
  }
  return { ...head, dirty };
}

// L'adresse d'un depot GitHub, sous toutes ses formes (https, ssh) : { owner, repo, url } ou null.
function parseGithub(url) {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}

function parseLog(text) {
  return String(text || '').split(/\r?\n/).filter(Boolean).map(l => {
    const [sha, subject, author, ct] = l.split('\x1f');
    return { sha, short: sha.slice(0, 7), subject: subject || '', author: author || '', at: (+ct || 0) * 1000 };
  });
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// L'etat git d'un dossier, lu sans rien y ecrire.
async function local(root) {
  const out = { root, exists: false, isRepo: false, checkedAt: Date.now() };
  try { out.exists = fs.statSync(root).isDirectory(); } catch { /* dossier parti */ }
  if (!out.exists) return out;
  if (!fs.existsSync(path.join(root, '.git'))) {
    // pas de .git ici : peut-etre un sous-dossier d'un autre depot (on ne propose pas d'en creer un dedans)
    const top = await run(['rev-parse', '--show-toplevel'], root, { timeout: 5000 });
    if (top.missing) return { ...out, nogit: true };
    if (top.ok && top.out.trim() && !same(top.out.trim(), root)) out.inside = path.normalize(top.out.trim());
    out.uproject = fs.readdirSync(root).some(n => n.toLowerCase().endsWith('.uproject'));
    return out;
  }
  out.isRepo = true;
  const [st, log, rem] = await Promise.all([
    run(['--no-optional-locks', '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b'], root, { timeout: 30_000 }),
    run(['--no-optional-locks', 'log', '-n', '30', '--format=%H%x1f%s%x1f%an%x1f%ct'], root),
    run(['remote', '-v'], root, { timeout: 5000 }),
  ]);
  if (st.missing) return { ...out, nogit: true };
  if (!st.ok) return { ...out, error: st.err.split('\n')[0] || 'git status a échoué' };
  Object.assign(out, parseStatus(st.out));
  const commits = log.ok ? parseLog(log.out) : [];
  out.commits = commits.slice(0, 6);
  out.shas = commits.map(c => c.sha);
  out.remotes = [];
  for (const l of rem.out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(l);
    if (m) out.remotes.push({ name: m[1], url: m[2].replace(/\/\/[^@/]+@/, '//') }); // jamais d'identifiant dans la page
  }
  const origin = out.remotes.find(r => r.name === 'origin') || out.remotes[0];
  out.github = origin ? parseGithub(origin.url) : null;
  try { out.fetchedAt = fs.statSync(path.join(root, '.git', 'FETCH_HEAD')).mtimeMs; } catch { out.fetchedAt = 0; }
  try { out.lfs = /filter=lfs/.test(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')); } catch { out.lfs = false; }
  return out;
}

// ---- GitHub : l'API publique, sans dependance. Un jeton (GITHUB_TOKEN ou GH_TOKEN) ouvre les depots prives.
const etags = new Map(); // url -> { etag, body } : une reponse 304 ne compte pas dans la limite de GitHub
let tokenRefused = false; // un jeton refuse : on continue sans, les depots publics restent lisibles
function token() { return tokenRefused ? '' : process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''; }
function getJson(url, { timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    const cached = etags.get(url);
    const headers = { 'User-Agent': 'alkatrazz-tower', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (cached) headers['If-None-Match'] = cached.etag;
    const req = https.get(url, { headers, timeout }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; if (raw.length > 4_000_000) req.destroy(); });
      res.on('end', () => {
        const left = Number(res.headers['x-ratelimit-remaining']);
        if (res.statusCode === 304 && cached) return resolve({ status: 200, body: cached.body, left });
        let body = null;
        try { body = JSON.parse(raw); } catch { /* pas du JSON */ }
        if (res.statusCode === 200 && res.headers.etag) etags.set(url, { etag: res.headers.etag, body });
        resolve({ status: res.statusCode, body, left });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, body: null }));
  });
}

async function github(g) {
  const base = `https://api.github.com/repos/${g.owner}/${g.repo}`;
  let info = await getJson(base);
  if (info.status === 401 && token()) { tokenRefused = true; info = await getJson(base); }
  if (info.status !== 200 || !info.body) {
    const error = info.status === 404 ? (token() ? 'Dépôt introuvable sur GitHub.' : 'Dépôt introuvable ou privé : sans jeton, la tour ne voit que les dépôts publics.')
      : info.status === 403 || info.status === 429 ? 'GitHub limite les lectures pour l\'instant : nouvel essai dans quelques minutes.'
        : 'GitHub injoignable.';
    return { ok: false, error, checkedAt: Date.now() };
  }
  const R = info.body;
  const [pulls, commits] = await Promise.all([getJson(`${base}/pulls?state=open&per_page=10`), getJson(`${base}/commits?per_page=20`)]);
  return {
    ok: true, url: R.html_url, private: !!R.private, defaultBranch: R.default_branch, pushedAt: Date.parse(R.pushed_at) || 0,
    prs: Array.isArray(pulls.body) ? pulls.body.map(p => ({ number: p.number, title: p.title, user: p.user && p.user.login, url: p.html_url, draft: !!p.draft, at: Date.parse(p.updated_at) || 0 })) : [],
    commits: Array.isArray(commits.body) ? commits.body.map(c => ({
      sha: c.sha, short: c.sha.slice(0, 7), subject: String((c.commit && c.commit.message) || '').split('\n')[0],
      author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || '', at: Date.parse(c.commit && c.commit.committer && c.commit.committer.date) || 0,
    })) : [],
    left: Number.isFinite(commits.left) ? commits.left : null, checkedAt: Date.now(),
  };
}

// Le PC face a GitHub, sur la branche principale : sans fetch, en comparant les derniers commits des deux cotes.
function compare(L, G) {
  if (!L || !L.isRepo || !G || !G.ok || !G.commits.length) return null;
  if (L.branch !== G.defaultBranch) return { state: 'branch', branch: L.branch, main: G.defaultBranch };
  const head = (L.shas || [])[0], gh = G.commits.map(c => c.sha);
  if (!head) return { state: 'behind', n: gh.length };
  if (gh[0] === head) return { state: 'ok' };
  const behind = gh.indexOf(head);
  if (behind > 0) return { state: 'behind', n: behind };
  const ahead = (L.shas || []).indexOf(gh[0]);
  if (ahead > 0) return { state: 'ahead', n: ahead };
  return { state: 'diverged' };
}

// .gitignore d'un projet Unreal : ce que le moteur regenere et les fichiers de Visual Studio.
const UE_GITIGNORE = [
  '# Ecrit par Alkatrazz Tower a l\'initialisation de git : ce qu\'Unreal regenere tout seul.',
  'Binaries/', 'DerivedDataCache/', 'Intermediate/', 'Saved/',
  'Plugins/*/Binaries/', 'Plugins/*/Intermediate/',
  '.vs/', '.idea/', '*.sln', '*.suo', '*.sdf', '*.opensdf', '*.VC.db', '*.VC.opendb', '',
].join('\n');

// Le suivi : la liste des dossiers vient du serveur (la tour, les projets connectes, les dossiers ajoutes).
function create({ list, publish }) {
  let ver = null, busy = null, queued = null;
  const gh = new Map(); // owner/repo -> derniere lecture GitHub
  let repos = [];

  async function refresh({ withGithub = false } = {}) {
    // une lecture en cours a pu commencer avant un geste (init, remote) : on en relance une juste apres
    if (busy) { if (!queued) queued = busy.then(() => { queued = null; return refresh({ withGithub }); }); return queued; }
    busy = (async () => {
      ver = await gitVersion();
      const items = list();
      const L = ver ? await Promise.all(items.map(it => local(it.root).catch(e => ({ root: it.root, exists: true, error: e.message })))) : items.map(it => ({ root: it.root }));
      if (withGithub) {
        const keys = new Map();
        for (const l of L) if (l.github) keys.set(`${l.github.owner}/${l.github.repo}`.toLowerCase(), l.github);
        for (const [k, g] of keys) { try { gh.set(k, await github(g)); } catch { /* reseau */ } }
      }
      repos = items.map((it, i) => {
        const l = { ...L[i] };
        const g = l.github ? gh.get(`${l.github.owner}/${l.github.repo}`.toLowerCase()) || null : null;
        const sync = compare(l, g);
        delete l.shas;
        return { ...it, ...l, remote: g, sync };
      });
      publish({ git: ver, download: GIT_DOWNLOAD, token: !!token(), repos });
      return repos;
    })().finally(() => { busy = null; });
    return busy;
  }

  const find = (root) => list().find(it => root && same(it.root, String(root)));

  async function init(root) {
    const it = find(root);
    if (!it) return { ok: false, error: 'Ce dossier n\'est pas suivi par la tour.' };
    if (!(await gitVersion())) return { ok: false, nogit: true, download: GIT_DOWNLOAD, error: 'Git n\'est pas installé sur ce PC.' };
    const L = await local(it.root);
    if (!L.exists) return { ok: false, error: 'Dossier introuvable.' };
    if (L.isRepo) return { ok: false, error: 'Git est déjà initialisé ici.' };
    if (L.inside) return { ok: false, error: `Ce dossier est déjà dans le dépôt ${L.inside}.` };
    let r = await run(['init', '-b', 'main'], it.root);
    if (!r.ok && !r.missing) r = await run(['init'], it.root); // git trop ancien pour -b
    if (!r.ok) return { ok: false, error: r.err || 'git init a échoué.' };
    let gitignore = false;
    const gi = path.join(it.root, '.gitignore');
    if (L.uproject && !fs.existsSync(gi)) { fs.writeFileSync(gi, UE_GITIGNORE); gitignore = true; }
    await refresh();
    return { ok: true, gitignore };
  }

  async function fetchRemote(root) {
    const it = find(root);
    if (!it) return { ok: false, error: 'Ce dossier n\'est pas suivi par la tour.' };
    const r = await run(['fetch', '--prune'], it.root, { timeout: 120_000 });
    if (r.missing) return { ok: false, nogit: true, download: GIT_DOWNLOAD, error: 'Git n\'est pas installé sur ce PC.' };
    await refresh({ withGithub: true });
    return r.ok ? { ok: true } : { ok: false, error: r.err.split('\n').slice(-1)[0] || 'git fetch a échoué.' };
  }

  async function addRemote(root, url) {
    const it = find(root);
    if (!it) return { ok: false, error: 'Ce dossier n\'est pas suivi par la tour.' };
    const g = parseGithub(url);
    if (!g) return { ok: false, error: 'Adresse GitHub attendue, par exemple https://github.com/toi/projet.' };
    const L = await local(it.root);
    if (L.nogit) return { ok: false, nogit: true, download: GIT_DOWNLOAD, error: 'Git n\'est pas installé sur ce PC.' };
    if (!L.isRepo) return { ok: false, error: 'Initialise d\'abord git dans ce dossier.' };
    if ((L.remotes || []).some(x => x.name === 'origin')) return { ok: false, error: 'Ce dépôt a déjà un lien « origin ».' };
    const r = await run(['remote', 'add', 'origin', `${g.url}.git`], it.root);
    if (!r.ok) return { ok: false, error: r.err || 'git remote add a échoué.' };
    await refresh({ withGithub: true });
    return { ok: true, github: g };
  }

  return { refresh, init, fetchRemote, addRemote, find, view: () => repos };
}

module.exports = { create, run, local, github, compare, parseStatus, parseBranch, parseGithub, parseLog, gitVersion, GIT_DOWNLOAD, UE_GITIGNORE };
