'use strict';
// Alkatrazz Tower -- serveur local. Aucune dependance npm.
//   node server/server.js            (port 4777, ou TOWER_PORT)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { TowerState } = require('./state');
const { Worker } = require('worker_threads');
const projectsLib = require('../lib/projects');

const PORT = Number(process.env.TOWER_PORT) || 4777;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.TOWER_DATA || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WEB = path.join(ROOT, 'web');

// Version de la page : change des qu'un fichier de web/ change. Une page restee ouverte (onglet de
// l'editeur Unreal, navigateur) la recoit a chaque connexion et se recharge quand elle differe.
function webVersion(dir = WEB) {
  const h = require('crypto').createHash('sha1');
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { try { const st = fs.statSync(f); h.update(`${path.relative(dir, f)}:${st.size}:${st.mtimeMs}\n`); } catch { /* fichier parti */ } }
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}
const WEB_VERSION = webVersion();
const WAIT_MS = 20_000;

const state = new TowerState();

// ---- persistance --------------------------------------------------------------------------------

// Un state.json abime est mis de cote (state.json.abime-<date>) au lieu d'etre ecrase par une tour vide.
(function loadState() {
  let raw;
  try { raw = fs.readFileSync(STATE_FILE, 'utf8'); } catch { return; } // premier lancement
  try { state.load(JSON.parse(raw)); return; } catch (e) { console.error('[tower] state.json illisible :', e.message); }
  const bad = `${STATE_FILE}.abime-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { fs.renameSync(STATE_FILE, bad); console.error(`[tower] copie gardee dans ${bad}`); } catch { /* tant pis */ }
})();

function writeState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(state.toJSON())); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, STATE_FILE);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { writeState(); } catch (e) { console.error('[tower] sauvegarde impossible :', e.message); }
  }, 1000);
}

// ---- flux en direct (SSE) -----------------------------------------------------------------------

const clients = new Set();
let pushTimer = null;
function pushAll() {
  if (pushTimer || !clients.size) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const data = `data: ${JSON.stringify(state.snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  }, 100);
}

// Les tickets en attente de leur tour (long-poll /api/lock/wait).
const waiters = new Map(); // ticket -> [resolve]
const askWaiters = new Map(); // question -> [resolve] (long-poll /api/ask/wait de hooks/tower-ask.js)
function wakeWaiters() {
  for (const [id, list] of askWaiters) {
    if (!list.length) { askWaiters.delete(id); continue; } // personne n'attend : la reponse reste pour le prochain appel
    const st = state.askStatus(id);
    if (st.pending) continue;
    askWaiters.delete(id);
    list[0](st); // une seule reponse a rendre : les autres attentes repartent en « pending »
    for (const fn of list.slice(1)) fn({ pending: true });
  }
  for (const [ticket, list] of waiters) {
    const st = state.ticketStatus(ticket);
    if (st.granted || st.lost) {
      waiters.delete(ticket);
      for (const fn of list) fn(st);
    }
  }
}

function dropAskWaiter(id, fn) {
  const list = (askWaiters.get(id) || []).filter(f => f !== fn);
  if (list.length) askWaiters.set(id, list); else askWaiters.delete(id);
}

state.onChange(() => { scheduleSave(); pushAll(); wakeWaiters(); });

// Victoire : on note le commit Git du projet, comme un point de sauvegarde.
state.onVictory = (c) => {
  const agent = Object.values(state.agents).find(a => a.project && a.project.name.toLowerCase() === c.project.toLowerCase());
  if (!agent) return;
  const root = agent.project.root;
  execFile('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { windowsHide: true, timeout: 5000 }, (err, sha) => {
    if (err) return;
    execFile('git', ['--no-optional-locks', '-C', root, 'status', '--porcelain'], { windowsHide: true, timeout: 10000 }, (err2, dirty) => {
      c.commit = { sha: String(sha).trim(), dirty: err2 ? null : String(dirty).split(/\r?\n/).filter(Boolean).length };
      state.changed();
    });
  });
};

// ---- sondes : editeur ouvert, verrous de domaine ------------------------------------------------

function probeEditor() {
  if (process.platform !== 'win32') return;
  execFile('tasklist', ['/FI', 'IMAGENAME eq UnrealEditor.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    if (err) return;
    const count = (String(out).match(/"UnrealEditor\.exe"/gi) || []).length;
    const was = state.editor;
    const plugin = Object.values(state.editors).some(e => Date.now() - e.lastSeen < 15_000);
    state.editor = { open: count > 0 || plugin, count: Math.max(count, plugin ? 1 : 0), checkedAt: Date.now(), plugin };
    if (was.open !== state.editor.open || was.count !== count) state.changed();
  });
}

function probeChantiers() {
  const roots = new Map();
  for (const a of Object.values(state.agents)) if (a.project) roots.set(a.project.name, a.project.root);
  for (const p of state.projects) roots.set(p.name, p.root);
  const next = {};
  for (const [name, root] of roots) {
    const dir = path.join(root, 'Saved', 'chantiers');
    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt')).map(f => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { file: f.replace(/\.txt$/i, ''), text: fs.readFileSync(p, 'utf8').slice(0, 400).trim(), mtime: st.mtimeMs };
      });
    } catch { /* pas de dossier chantiers */ }
    if (files.length) next[name] = files;
  }
  if (JSON.stringify(next) !== JSON.stringify(state.chantiers)) { state.chantiers = next; state.changed(); }
}

// Les sujets du jeu (lib/sujets.js) : un par section de l'equipe, leur carnet et le tableau partage,
// relus toutes les 10 s dans Saved/Tour/ de chaque projet connecte.
const sujetsLib = require('../lib/sujets');
function probeSujets() {
  for (const p of state.projects) {
    if (!p || !p.root || !p.name) continue;
    try { state.setSujets(p.name, sujetsLib.scan(p, require('../lib/equipe').teamOf(p.root))); } catch { /* projet illisible */ }
  }
  // le carnet de chaque feature, dans le projet ou elle a ete creee
  for (const f of state.features) {
    const p = projectFor(f.project);
    if (p) try { state.setFeatureNotes(f.id, featuresLib.scan(p.root, f).notes); } catch { /* carnet illisible */ }
  }
}
const featuresLib = require('../lib/features');

// La documentation de chaque projet connecte (lib/docs.js), relue toutes les minutes ; elle reecrit
// aussi Saved/Tour/doc-unreal.md, le rayon Unreal que lisent les sessions.
const docsLib = require('../lib/docs');
function probeDocs() {
  for (const p of state.projects) {
    if (!p || !p.root || !p.name) continue;
    try { state.setDocs(p.name, docsLib.scan(p)); } catch (e) { console.error('[tower] doc illisible :', e.message); }
  }
}
function docRoot(name) { const p = projectFor(name); return p ? p.root : null; }

// Le batiment des depots (lib/git.js) : la tour elle-meme, chaque projet connu et les dossiers ajoutes
// par ali. Git local relu toutes les minutes ; GitHub toutes les 5 minutes (et sur « Relire »).
const gitLib = require('../lib/git');
function gitList() {
  const out = [{ name: 'Alkatrazz Tower', root: ROOT, kind: 'tour' }];
  const seen = new Set([ROOT.toLowerCase()]);
  const add = (it) => { const k = path.resolve(it.root).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } };
  for (const p of knownProjects()) add({ name: p.name, root: p.root, kind: 'projet' });
  for (const f of state.gitFollow) add({ name: f.name, root: f.root, kind: 'suivi' });
  return out;
}
const gitTrack = gitLib.create({ list: gitList, publish: (v) => state.setGit(v) });
const gitSafe = (p) => p.catch(e => { console.error('[tower] git illisible :', e.message); return null; });

// Le suivi des modifications (lib/modifs.js) : un git commit ou un git push d'une session arrive par
// les hooks ; la tour retrouve son depot parmi ceux qu'elle suit, lit les fichiers du commit (git show,
// sans rien ecrire) et relit les depots pour que « pousse ou pas » soit a jour.
const modifsLib = require('../lib/modifs');
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
async function completeGit(entries) {
  let push = false;
  for (const e of entries) {
    try {
      const top = e.cwd ? await gitLib.run(['rev-parse', '--show-toplevel'], e.cwd, { timeout: 5000 }) : null;
      const root = top && top.ok && top.out.trim() ? path.resolve(top.out.trim()) : '';
      if (!root) continue;
      const it = gitList().find(x => realOf(x.root).toLowerCase() === realOf(root).toLowerCase());
      e.root = it ? it.root : root;
      e.repo = it ? it.name : path.basename(root);
      if (e.kind === 'push') { push = true; continue; }
      if (e.state !== 'ok' && e.state !== 'unknown') continue;
      const c = await modifsLib.commitInfo(gitLib.run, root, e.state === 'ok' ? e.short : 'HEAD');
      // sortie inconnue (ancien hook) : HEAD n'est ce commit que s'il vient d'etre fait et n'est pas deja note
      if (!c || (e.state === 'unknown' && (c.ct < e.at - 120_000 || state.modifs.some(x => x !== e && x.sha === c.sha)))) continue;
      Object.assign(e, { state: 'ok', sha: c.sha, short: c.short, subject: e.subject || c.subject, count: c.count, list: c.list });
      if (e.files == null) e.files = c.count;
    } catch (err) { console.error('[tower] suivi git :', err.message); }
  }
  state.changed();
  await gitSafe(gitTrack.refresh({ withGithub: push }));
}
state.onGit = (entries) => { completeGit(entries).catch(() => { /* le complement est un bonus */ }); };

// Le batiment de la sauvegarde (lib/sauvegarde.js) : les memes dossiers que les depots. Chaque projet a
// sa destination (un dossier sur un autre disque, ou un depot distant) ; une sauvegarde part d'un clic.
const sauvegarde = require('../lib/sauvegarde').create(state, { list: gitList, dataDir: DATA_DIR });
state.sauvegardeView = sauvegarde.view;

// ---- inventaire des projets pour la carte ----------------------------------------------------

const scanning = new Set();
function inventoryOf(project) {
  if (scanning.has(project.root)) return;
  scanning.add(project.root);
  const w = new Worker(`const { parentPort, workerData } = require('worker_threads');
    parentPort.postMessage(require(${JSON.stringify(path.join(ROOT, 'lib', 'inventory.js'))}).inventory(workerData));`, { eval: true, workerData: project });
  const done = () => scanning.delete(project.root);
  w.once('message', (inv) => { done(); state.inventories[project.name] = inv; state.changed(); });
  w.once('error', (e) => { done(); console.error('[tower] inventaire impossible :', e.message); });
  setTimeout(() => { w.terminate(); done(); }, 120_000).unref();
}
function knownProjects() {
  const m = new Map();
  for (const p of state.projects) m.set(p.root.toLowerCase(), p);
  for (const a of Object.values(state.agents)) {
    if (!a.project || m.has(a.project.root.toLowerCase())) continue;
    const p = projectsLib.resolve(a.project.root);
    if (p) m.set(p.root.toLowerCase(), p);
  }
  return [...m.values()];
}
const pendingInv = new Map();
function scheduleInventory(p) {
  if (pendingInv.has(p.root)) return;
  pendingInv.set(p.root, setTimeout(() => { pendingInv.delete(p.root); inventoryOf(p); }, 5000));
}
function refreshInventories(force) {
  for (const p of knownProjects()) {
    const inv = state.inventories[p.name];
    if (force || !inv || Date.now() - inv.scannedAt > 10 * 60_000 || inv.root !== p.root) inventoryOf(p);
  }
}
setInterval(() => refreshInventories(false), 60_000).unref();
setTimeout(() => refreshInventories(false), 1500).unref();

setInterval(() => { state.expire(); }, 2000).unref();
setInterval(() => { state.pruneAgents(); }, 3600_000).unref();
setTimeout(() => { state.pruneAgents(); }, 5000).unref();
setInterval(probeEditor, 10_000).unref();
setInterval(probeChantiers, 10_000).unref();
setInterval(probeSujets, 10_000).unref();
setInterval(probeDocs, 60_000).unref();
setTimeout(probeDocs, 3000).unref();
setInterval(() => gitSafe(gitTrack.refresh()), 60_000).unref();
setInterval(() => gitSafe(gitTrack.refresh({ withGithub: true })), 5 * 60_000).unref();
setTimeout(() => gitSafe(gitTrack.refresh({ withGithub: true })), 2000).unref();
const sauvegardeSafe = () => sauvegarde.refresh().catch(e => console.error('[tower] sauvegarde illisible :', e.message));
setInterval(sauvegardeSafe, 10 * 60_000).unref();
setTimeout(sauvegardeSafe, 3000).unref();
probeEditor();
probeChantiers();
probeSujets();

// ---- HTTP ---------------------------------------------------------------------------------------

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; if (raw.length > 2_000_000) { resolve(null); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// Seule la page de la tour peut agir sur la tour. Un navigateur envoie toujours Origin avec un POST :
// une autre page web (autre site, ou autre serveur local sur un autre port) est refusee. Les
// programmes locaux (hooks, tower-run, plugin Unreal) n'envoient pas d'Origin.
const OWN = new RegExp(`^(127\\.0\\.0\\.1|localhost):${PORT}$`, 'i');
function foreignOrigin(req) {
  const o = req.headers.origin;
  if (!o) return false;
  return !new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`, 'i').test(o);
}
// Un nom d'hote inconnu = une page qui a fait pointer son domaine sur 127.0.0.1 (DNS rebinding) :
// elle ne lit ni n'ecrit rien, pas meme l'etat.
function foreignHost(req) {
  return !OWN.test(String(req.headers.host || ''));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// Tutos : scenarios joues sur la vraie tour et le vrai projet, sans rien y ecrire (lib/tuto.js).
const tuto = require('../lib/tuto').create(state, { projects: knownProjects });

// Taches pretes a lancer (lib/taches.js) et tokens lus dans le journal de chaque session (lib/usage.js).
const taches = require('../lib/taches').create(state);
// Fin de tache : la tour compile et lance les tests elle-meme (lib/verif.js).
const verif = require('../lib/verif').create(state);
// Discuter avec une session depuis la tour (lib/discussion.js) : chaque message relance la session sans fenetre.
const discussion = require('../lib/discussion').create(state, { launchEnv: require('../lib/taches').launchEnv, onTurn: (e) => demandes.turn(e) });
// Le suivi des demandes (lib/demandes.js) : ce qu'ali envoie depuis la tour, suivi jusqu'a son resultat.
// La discussion ne lui parle qu'une fois un message parti : il est cree juste apres elle.
const demandes = require('../lib/demandes').create(state, {
  conseilRun: (id) => ((state.conseil && state.conseil.runs) || []).find(r => r.id === id),
  envoiOf: (id) => ((state.chef && state.chef.envois) || []).find(e => e.id === id),
  busy: (sid) => discussion.busy(sid),
});
state.demandesView = demandes.tree;
// relue a chaque changement (sans en provoquer un), et toutes les 5 s pour ce qui depend de l'heure
state.onChange(() => { demandes.refresh(); });
setInterval(() => { if (demandes.refresh()) state.changed(); }, 5000).unref();
setInterval(() => demandes.writeFiles(state.projects), 10_000).unref();
// Mise en place des sessions core (lib/miseenplace.js) : un sujet apres l'autre, en fond et en lecture seule.
const misePlace = require('../lib/miseenplace').create(state, discussion, { projectFor: (n) => projectFor(n) });
state.miseView = misePlace.view;
// Le chef (lib/chef.js) : ses envois deposes dans Saved/Tour/chef/envois/, transmis aux sessions core ou feature.
const chef = require('../lib/chef').create(state, discussion, { projectFor: (n) => projectFor(n), prepare: (o) => taches.prepare(o), onEnvoi: (e, tag) => demandes.onEnvoi(e, tag) });
setInterval(() => { try { chef.scan(); } catch (e) { console.error('[tower] envois du chef :', e.message); } }, 10_000).unref();
// Le conseil (lib/conseil.js) : cinq membres deliberent sur un vrai choix, le president tranche. ali peut
// confier la decision au chef : dans sa discussion s'il tourne dans la tour, sinon la tour le lance.
function toChef(p, text, { tag } = {}) {
  const live = chef.liveOf('chef');
  if (live && discussion.canChat(live)) { const r = discussion.send(live.sessionId, text, { tag }); return r.ok ? { ok: true, sessionId: live.sessionId } : r; }
  if (live) return { ok: false, error: 'Le chef tourne dans sa fenêtre : ferme-la pour lui écrire depuis la tour, ou colle-lui le verdict.' };
  const r = taches.prepare({ id: 'chef', project: p });
  if (!r.ok) return r;
  return discussion.start({ cwd: p.root, text: `${r.ask}\n\n${text}`, def: 'chef', tag });
}
const conseil = require('../lib/conseil').create(state, { projectFor: (n) => projectFor(n), launchEnv: require('../lib/taches').launchEnv, toChef, dataDir: DATA_DIR });
state.conseilView = conseil.view;
const usage = require('../lib/usage');
const usageTimers = new Map();
function usageSoon(sid, ms = 2500) {
  const a = state.agents[sid];
  if (!a || !a.transcript || usageTimers.has(sid)) return;
  usageTimers.set(sid, setTimeout(async () => {
    usageTimers.delete(sid);
    const cur = state.agents[sid];
    if (!cur || !cur.transcript) return;
    const u = await usage.usageOf(cur.transcript, cur.model).catch(() => null);
    if (u && (!cur.usage || u.total !== cur.usage.total || u.context !== cur.usage.context)) state.setUsage(sid, u);
  }, ms));
}
// Au demarrage, on relit les journaux des sessions encore ouvertes.
for (const a of Object.values(state.agents)) if (a.status !== 'ended') usageSoon(a.sessionId, 4000);

// La bibliotheque des skills (lib/skills.js) : perso, compte, projets connus, plugins, et leur usage
// lu dans les journaux de Claude Code. Relue toutes les 2 minutes, et tout de suite apres un ajout.
const skillsLib = require('../lib/skills');
// Le quartier des agents (lib/agents.js) : relu en meme temps, avec les memes journaux.
const agentsLib = require('../lib/agents');
let rosterInv = null;
let skillsInv = null;
let skillsBusy = null;
function skillProjects() {
  const out = knownProjects().map(p => ({ name: p.name, root: p.root }));
  out.push({ name: 'Alkatrazz Tower', root: ROOT });
  // sessions ouvertes hors d'un projet Unreal, dans un dossier qui a sa config Claude Code
  for (const a of Object.values(state.agents)) {
    if (a.project || !a.cwd || a.status === 'ended') continue;
    try { if (fs.existsSync(path.join(a.cwd, '.claude'))) out.push({ name: path.basename(a.cwd), root: a.cwd }); } catch { /* chemin invalide */ }
  }
  return out;
}
function refreshSkills() {
  if (skillsBusy) return skillsBusy;
  skillsBusy = (async () => {
    const inv = skillsLib.scan({ projects: skillProjects() });
    const calls = await skillsLib.readUsage();
    const next = skillsLib.withUsage(inv, calls);
    skillsInv = inv;
    const ainv = agentsLib.scan({ projects: skillProjects(), skills: inv });
    const roster = agentsLib.withUsage(ainv, await skillsLib.readAgentUsage());
    rosterInv = ainv;
    const strip = (v) => v && JSON.stringify({ ...v, scannedAt: 0 });
    let moved = false;
    if (strip(next) !== strip(state.skills)) { state.skills = next; moved = true; } else state.skills.scannedAt = next.scannedAt;
    if (strip(roster) !== strip(state.roster)) { state.roster = roster; moved = true; } else state.roster.scannedAt = roster.scannedAt;
    if (moved) state.changed();
    return next;
  })().catch(e => { console.error('[tower] skills illisibles :', e.message); return null; }).finally(() => { skillsBusy = null; });
  return skillsBusy;
}
setInterval(refreshSkills, 120_000).unref();
setTimeout(refreshSkills, 2500).unref();

function projectFor(name) {
  const all = knownProjects();
  // Un nom donne qui ne correspond a aucun projet ne retombe jamais sur un autre projet.
  if (name) return all.find(p => p.name.toLowerCase() === String(name).toLowerCase()) || null;
  return all.find(p => /ctb|conquer/i.test(p.name)) || all[0] || null;
}

const routes = {
  'GET /api/health': () => ({ ok: true, name: 'alkatrazz-tower', pid: process.pid }),
  'GET /api/state': () => state.snapshot(),

  'POST /api/event': (b) => { const ok = state.event(b); if (ok) usageSoon(String(b.session_id)); return { ok, ...(ok ? state.hookReply(b) : {}) }; },
  'GET /api/docs/file': (b, url) => docsLib.readDoc(docRoot(url.searchParams.get('project')), url.searchParams.get('path')),
  'GET /api/docs/search': (b, url) => docsLib.search(docRoot(url.searchParams.get('project')), String(url.searchParams.get('q') || '').slice(0, 120)),
  'POST /api/docs/refresh': () => { probeDocs(); return { ok: true }; },
  'POST /api/docs/unreal': (b) => ({ ok: state.setDocRule(String(b.mode || '')) }),

  // Le batiment des depots : relire, suivre un dossier, et les trois gestes qui changent un depot,
  // chacun sur un clic d'ali (git init, git remote add origin, git fetch). Rien ne pousse.
  'POST /api/git/refresh': async () => ({ ok: !!(await gitSafe(gitTrack.refresh({ withGithub: true }))) }),
  'POST /api/git/follow': async (b) => {
    const p = String(b.path || '').trim().replace(/^["']|["']$/g, '');
    let dir = false;
    try { dir = path.isAbsolute(p) && fs.statSync(p).isDirectory(); } catch { /* introuvable */ }
    if (!dir) return { ok: false, error: 'Dossier introuvable : colle son chemin complet (ex. C:\\Users\\toi\\Documents\\MonProjet).' };
    const root = path.resolve(p);
    if (gitTrack.find(root)) return { ok: false, error: 'Ce dossier est déjà suivi.' };
    state.followRepo(root, path.basename(root) || root);
    await gitSafe(gitTrack.refresh({ withGithub: true }));
    sauvegardeSafe();
    return { ok: true, root };
  },
  'POST /api/git/unfollow': async (b) => { const ok = state.unfollowRepo(String(b.root || '')); if (ok) await gitSafe(gitTrack.refresh()); return { ok }; },
  'POST /api/git/init': (b) => gitTrack.init(String(b.root || '')),
  'POST /api/git/fetch': (b) => gitTrack.fetchRemote(String(b.root || '')),
  'POST /api/git/remote': (b) => gitTrack.addRemote(String(b.root || ''), String(b.url || '')),

  // La sauvegarde : choisir la destination d'un projet, lancer une sauvegarde, l'arreter.
  'POST /api/sauvegarde/cible': (b) => sauvegarde.setTarget(String(b.root || ''), { type: b.type ? String(b.type) : '', dest: String(b.dest || '') }),
  'POST /api/sauvegarde/lancer': (b) => sauvegarde.start(String(b.root || '')),
  'POST /api/sauvegarde/stop': () => sauvegarde.stop(),
  'POST /api/sauvegarde/relire': async () => { await sauvegarde.refresh(); return { ok: true }; },

  'POST /api/lock/acquire': (b) => {
    const st = state.acquire({
      sessionId: b.sessionId, kind: b.kind, command: b.command, cwd: b.cwd, pid: b.pid,
      target: b.target, testFilter: b.testFilter,
    });
    // tower-run previent l'agent si l'editeur de ce projet est ouvert (Build.bat de la cible
    // Editeur echoue alors avec le code 6 quand Live Coding est actif).
    const project = b.cwd ? (require('../lib/detect').findProject(b.cwd) || {}).name : null;
    const ed = state.liveEditor(project);
    if (ed) st.editor = { open: true, liveCoding: ed.liveCoding, pie: ed.pie, dirty: ed.dirty, map: ed.map };
    return st;
  },
  'POST /api/lock/heartbeat': (b) => ({ ok: state.touch(b.ticket) }),
  'POST /api/lock/release': (b) => ({ ok: state.release(b.ticket, b.result || {}) }),
  'POST /api/lock/force-release': () => ({ ok: state.forceRelease() }),
  'POST /api/report': (b) => { state.report(b.entry || {}, b.result || {}); return { ok: true }; },
  'POST /api/agents/forget': (b) => ({ ok: state.forget(b.sessionId) }),
  'POST /api/ask/open': (b) => ({ id: state.openAsk(b) }),
  'POST /api/ask/answer': (b) => state.answerAsk(String(b.id || ''), b),
  'POST /api/ask/close': (b) => ({ ok: state.closeAsk(String(b.id || '')) }),
  'POST /api/agents/rename': (b) => ({ ok: state.renameRoom(String(b.sessionId || ''), b.label) }),
  'GET /api/chat': (b, url) => discussion.read(String(url.searchParams.get('session') || ''), Math.min(200, Number(url.searchParams.get('n')) || 60)),
  'POST /api/chat/send': (b) => {
    const sid = String(b.sessionId || ''), tag = demandes.newTag();
    const r = discussion.send(sid, b.text, { tag });
    if (r.ok) {
      const a = state.agents[sid] || {}, isChef = !!(a.task && a.task.id === 'chef');
      demandes.add({ id: tag, kind: isChef ? 'chef' : 'discussion', to: isChef ? 'Chef' : demandes.roomOf(sid), text: b.text, project: a.project ? a.project.name : '', ref: { tag, session: sid } });
    }
    return r;
  },
  'POST /api/chat/stop': (b) => discussion.stop(String(b.sessionId || '')),
  // Une tache ou un sujet dans une discussion de la tour plutot que dans une fenetre.
  'POST /api/chat/start': (b) => {
    const r = taches.prepare({ id: b.id, project: projectFor(b.project) });
    if (!r.ok) return r;
    const tag = demandes.newTag();
    const s = discussion.start({ cwd: r.project.root, text: r.ask, def: r.task.id, tag });
    if (s.ok) demandes.add({ id: tag, kind: r.task.id === 'chef' ? 'chef' : 'discussion', to: r.task.title, text: r.task.text || r.task.title, project: r.project.name, ref: { tag, session: s.sessionId } });
    return s;
  },
  'POST /api/miseenplace': (b) => misePlace.start({ ids: b.ids, budget: b.budget }),
  'POST /api/miseenplace/stop': () => misePlace.stop(),
  // Le chef : valider ou ignorer un envoi propose, et choisir s'il faut valider ses envois avant.
  'POST /api/chef/envoi': (b) => chef.decide(String(b.id || ''), b.go !== false),
  'POST /api/chef/ask': (b) => chef.setAsk(!!b.ask),
  // Le conseil : poser une question, l'arreter, ses reglages, et confier son verdict au chef.
  'POST /api/conseil': (b) => {
    const r = conseil.ask({ question: b.question, project: b.project, model: b.model, revue: b.revue, cadrage: b.cadrage });
    if (!r.ok) return r;
    const run = state.conseil.runs.find(x => x.id === r.id);
    demandes.add({ kind: 'conseil', to: 'Conseil', text: run ? run.question : b.question, project: run ? run.project : '', ref: { conseil: r.id } });
    return { ok: true, id: r.id };
  },
  'POST /api/conseil/stop': () => conseil.stop(),
  'POST /api/conseil/reglages': (b) => conseil.settings({ model: b.model, revue: b.revue, cadrage: b.cadrage }),
  'POST /api/conseil/chef': (b) => {
    const id = String(b.id || ''), tag = demandes.newTag();
    const r = conseil.chef(id, { tag });
    if (r && r.ok) {
      const run = state.conseil.runs.find(x => x.id === id) || {};
      const parent = (state.demandes || []).find(d => d.ref.conseil === id);
      demandes.add({ id: tag, kind: 'chef', to: 'Chef', text: `Mettre en œuvre le verdict du conseil : ${run.decision || run.question || ''}`, project: run.project || '', parent: parent ? parent.id : '', ref: { tag, session: r.sessionId } });
    }
    return r;
  },
  // Le suivi des demandes : ali a vu une demande finie (ou toutes) ; elle quitte la barre.
  'POST /api/demandes/vu': (b) => demandes.seen(b.id ? String(b.id) : ''),
  // Sessions feature : une nouvelle idee, creee depuis la tour, puis lancee en discussion (ou dans une fenetre).
  'POST /api/features': (b) => {
    const p = projectFor(b.project);
    if (!p) return { ok: false, error: 'Aucun projet connecté : connecte d\'abord ton projet.' };
    return state.addFeature({ title: b.title, idea: b.idea, sujets: b.sujets, project: p.name });
  },
  'POST /api/features/done': (b) => ({ ok: state.endFeature(String(b.id || ''), b.done !== false) }),
  // Regles d'une session core ou feature (lib/regles.js) : appliquees a son prochain lancement ou message.
  'POST /api/regles': (b) => {
    const ok = state.setRule(String(b.id || ''), String(b.action || ''), String(b.level || ''));
    return ok ? { ok } : { ok, error: 'Règle inconnue.' };
  },
  'POST /api/agents/hide': (b) => ({ ok: state.hide(String(b.sessionId || ''), b.hidden !== false) }),
  'GET /api/sujets/file': (b, url) => {
    const p = projectFor(url.searchParams.get('project'));
    return p ? sujetsLib.readFile(p.root, String(url.searchParams.get('id') || '')) : { ok: false, error: 'Aucun projet connecté.' };
  },
  'POST /api/sujets/post': (b) => {
    const p = projectFor(b.project);
    if (!p) return { ok: false, error: 'Aucun projet connecté.' };
    const r = sujetsLib.post(p.root, { from: b.from || 'ali', to: b.to, text: b.text });
    if (r.ok) probeSujets();
    return r;
  },

  // Personnages
  'GET /api/characters': () => Object.values(state.characters).map(c => ({
    ...c, agents: Object.values(state.agents).filter(a => a.characterId === c.id && a.status !== 'ended').map(a => a.sessionId),
  })),
  'POST /api/characters': (b) => ({ ok: true, character: state.createCharacter(b) }),
  'POST /api/characters/update': (b) => {
    const c = state.updateCharacter(b);
    return c ? { ok: true, character: c } : { ok: false, error: 'personnage introuvable (id, name ou sessionId)' };
  },
  'POST /api/characters/delete': (b) => ({ ok: state.deleteCharacter(b.id) }),
  'POST /api/agents/character': (b) => ({ ok: state.setAgentCharacter(b.sessionId, b.characterId) }),

  // Projets Unreal connectes
  'POST /api/projects/connect': (b) => {
    const p = projectsLib.resolve(b.uproject || b.path);
    if (!p) return { ok: false, error: 'aucun .uproject a cet endroit' };
    state.connectProject(p);
    inventoryOf(p);
    setTimeout(probeDocs, 500);
    setTimeout(() => gitSafe(gitTrack.refresh({ withGithub: true })), 500);
    setTimeout(sauvegardeSafe, 800);
    return { ok: true, project: p };
  },
  'POST /api/projects/disconnect': (b) => ({ ok: state.disconnectProject(b.uproject) }),
  'POST /api/inventory/refresh': () => { refreshInventories(true); return { ok: true }; },

  // Plugin Unreal (unreal/AlkatrazzTower)
  'POST /api/editor/state': (b) => ({ ok: state.editorState(b) }),
  'GET /api/editor/feed': (b, url) => state.editorFeed(url.searchParams.get('project')),
  'POST /api/editor/asset-opened': (b) => ({ ok: true, agents: state.agentsOnAsset(b.file, b.package) }),
  'POST /api/editor/assets-changed': (b) => {
    // Un asset ajoute, renomme, supprime ou sauvegarde : on recompte le projet (0,3 s) sous 5 s.
    const p = knownProjects().find(x => x.name.toLowerCase() === String(b.project || '').toLowerCase());
    if (p) scheduleInventory(p);
    const ed = state.editors[p ? p.name : b.project];
    if (ed && b.saved) { ed.lastSaved = { asset: String(b.saved).slice(0, 200), at: Date.now() }; state.changed(); }
    return { ok: !!p };
  },

  'POST /api/tasks/save': (b) => taches.save(b),
  'POST /api/tasks/delete': (b) => ({ ok: taches.remove(b.id) }),
  'POST /api/tasks/verify': (b) => verif.start(String(b.sessionId || '')),
  'GET /api/tasks/file': (b, url) => require('../lib/suivi').readFile(state.agents[url.searchParams.get('session')], url.searchParams.get('path')),

  'POST /api/skills/refresh': async () => ({ ok: !!(await refreshSkills()) }),
  'GET /api/skills/file': (b, url) => skillsLib.readFileOf(skillsInv, url.searchParams.get('id')),
  'POST /api/roster/refresh': async () => ({ ok: !!(await refreshSkills()) }),
  'GET /api/roster/file': (b, url) => agentsLib.readFileOf(rosterInv, url.searchParams.get('id')),
  'POST /api/skills/fetch': (b) => skillsLib.fetchSkill(b.url),
  'POST /api/skills/create': async (b) => {
    let root;
    if (b.scope === 'projet') {
      const p = skillProjects().find(x => x.name.toLowerCase() === String(b.project || '').toLowerCase());
      if (!p) return { ok: false, error: `Projet inconnu : ${b.project}` };
      root = p.root;
    }
    const r = skillsLib.create({ scope: b.scope, root, name: b.name, description: b.description, body: b.body, text: b.text });
    if (r.ok) await refreshSkills();
    return r;
  },

  'GET /api/tuto': () => tuto.info(),
  'POST /api/tuto/start': (b) => tuto.start(b),
  'POST /api/tuto/answer': () => ({ ok: tuto.answer() }),
  'POST /api/tuto/clean': () => ({ ok: tuto.clean() }),

  'POST /api/campaigns': (b) => {
    try { return { ok: true, campaign: state.createCampaign(b) }; }
    catch (e) { return { ok: false, error: e.message }; }
  },
  'POST /api/campaigns/manual': (b) => ({ ok: state.manualProof(b.id, b.featureId, b.ok !== false) }),
  'POST /api/campaigns/archive': (b) => ({ ok: state.archiveCampaign(b.id) }),
  'POST /api/campaigns/delete': (b) => ({ ok: state.deleteCampaign(b.id) }),
};

async function handle(req, res) {
  let url;
  try { url = new URL(req.url, `http://${HOST}`); } catch { return send(res, 400, { error: 'adresse invalide' }); }
  const key = `${req.method} ${url.pathname}`;

  if (foreignHost(req) || req.method === 'POST' && foreignOrigin(req)) return send(res, 403, { error: 'origine refusee' });

  if (key === 'GET /api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\nevent: version\ndata: ${JSON.stringify(WEB_VERSION)}\n\n`);
    res.write(`data: ${JSON.stringify(state.snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (key === 'POST /api/lock/wait') {
    const b = await readBody(req);
    if (!b || !b.ticket) return send(res, 400, { error: 'ticket manquant' });
    state.touch(b.ticket);
    const st = state.ticketStatus(b.ticket);
    if (st.granted || st.lost) return send(res, 200, st);
    let done = false;
    const finish = (s) => { if (done) return; done = true; clearTimeout(timer); send(res, 200, s); };
    const timer = setTimeout(() => {
      const list = (waiters.get(b.ticket) || []).filter(f => f !== finish);
      if (list.length) waiters.set(b.ticket, list); else waiters.delete(b.ticket);
      finish(state.ticketStatus(b.ticket));
    }, Math.min(Number(b.timeoutMs) || WAIT_MS, WAIT_MS));
    const list = waiters.get(b.ticket) || [];
    list.push(finish);
    waiters.set(b.ticket, list);
    res.on('close', () => { if (!done) { done = true; clearTimeout(timer); const l = (waiters.get(b.ticket) || []).filter(f => f !== finish); if (l.length) waiters.set(b.ticket, l); else waiters.delete(b.ticket); } });
    return;
  }

  if (key === 'POST /api/ask/wait') {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'JSON invalide' });
    const id = String(b.id || '');
    const st = state.askStatus(id);
    if (!st.pending) return send(res, 200, st);
    let done = false;
    const finish = (s) => { if (done) return; done = true; clearTimeout(timer); send(res, 200, s); };
    const timer = setTimeout(() => {
      dropAskWaiter(id, finish);
      finish({ pending: true });
    }, Math.min(Number(b.timeoutMs) || WAIT_MS, WAIT_MS));
    askWaiters.set(id, [...(askWaiters.get(id) || []), finish]);
    res.on('close', () => { if (!done) { done = true; clearTimeout(timer); dropAskWaiter(id, finish); } });
    return;
  }

  if (key === 'POST /api/tasks/launch') {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'JSON invalide' });
    const p = projectFor(b.project);
    const r = await taches.launch({ id: b.id, project: p, background: !!b.background }).catch(e => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      const t = taches.find(r.task) || { title: r.task };
      demandes.add({ kind: 'tache', to: t.title, text: t.text || t.title, project: p ? p.name : '', ref: { task: r.task, background: !!r.background } });
    }
    return send(res, 200, r);
  }

  if (key === 'GET /api/projects/scan') {
    const w = new Worker(`const { parentPort } = require('worker_threads');
      parentPort.postMessage(require(${JSON.stringify(path.join(ROOT, 'lib', 'projects.js'))}).scan());`, { eval: true });
    let done = false;
    const finish = (code, body) => { if (!done) { done = true; send(res, code, body); } };
    w.once('message', (m) => finish(200, m));
    w.once('error', (e) => finish(500, { error: e.message }));
    setTimeout(() => { w.terminate(); finish(200, { projects: [], complete: false }); }, 10_000).unref();
    return;
  }

  const route = routes[key];
  if (route) {
    const b = req.method === 'POST' ? await readBody(req) : {};
    if (b === null) return send(res, 400, { error: 'JSON invalide' });
    try { return send(res, 200, await route(b, url)); } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) return send(res, 404, 'introuvable', 'text/plain');
    return fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'introuvable', 'text/plain');
      send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
    });
  }
  send(res, 404, { error: 'route inconnue' });
}

// Une requete qui plante ne doit jamais faire tomber la tour.
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[tower] requete en erreur :', e && e.message);
    if (!res.headersSent) { try { send(res, 500, { error: 'erreur interne' }); } catch { /* deja ferme */ } }
    else { try { res.end(); } catch { /* deja ferme */ } }
  });
});
process.on('unhandledRejection', (e) => console.error('[tower] promesse rejetee :', e && e.message));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[tower] le port ${PORT} est deja pris : la tour tourne peut-etre deja (http://${HOST}:${PORT}).`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`[tower] Alkatrazz Tower en ecoute sur http://${HOST}:${PORT}`);
});

function shutdown() {
  try { writeState(); } catch { /* tant pis */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, state, foreignOrigin, foreignHost };
