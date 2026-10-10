'use strict';
// Etat de la tour : agents, verrou de build, file d'attente, builds recents.
// Aucune E/S ici, pour pouvoir tout tester sans serveur.

const { findProject } = require('../lib/detect');
const campaign = require('../lib/campaign');
const { docRead } = require('../lib/unreal');
const chars = require('../lib/characters');
const { roomForPath } = require('../lib/inventory');
const taches = require('../lib/taches');
const suivi = require('../lib/suivi');
const { salleOf } = require('../lib/salles');
const equipe = require('../lib/equipe');
const sujets = require('../lib/sujets');
const features = require('../lib/features');
const regles = require('../lib/regles');

// Agents des tutos (lib/tuto.js) : jamais sauvegardes, jamais comptes pour une version.
const isTuto = (id) => String(id || '').startsWith('tuto-');

const SUB_SILENT_MS = 600_000; // sous-agent sans nouvelle depuis 10 min : il a fini
const LEASE_MS = 30_000;      // sans signe de vie, le verrou ou la place en file est rendu
const MAX_BUILDS = 50;
const SNIP = 160;

function snip(s, n = SNIP) {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Resume lisible d'un appel d'outil.
function toolSummary(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (input.command) {
    // Commande emballee par le hook : on montre la commande d'origine.
    const m = String(input.command).match(/tower-run\.js"?.*--b64 ([A-Za-z0-9+/=]+)/);
    if (m) return snip('[verrou] ' + Buffer.from(m[1], 'base64').toString('utf8'), 120);
    return snip(input.command, 120);
  }
  if (input.question) return snip(input.question, 120);
  if (input.file_path) return snip(input.file_path.split(/[\\/]/).slice(-2).join('/'), 120);
  if (input.pattern) return snip(input.pattern, 80);
  if (input.url) return snip(input.url, 120);
  if (input.description) return snip(input.description, 120);
  if (input.prompt) return snip(input.prompt, 120);
  return '';
}

class TowerState {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.agents = {};      // session_id -> fiche
    this.lock = null;      // { ticket, sessionId, label, kind, command, project, since, lastSeen }
    this.queue = [];       // [{ ticket, sessionId, ..., since, lastSeen }]
    this.builds = [];      // les plus recents d'abord
    this.editor = { open: false, count: 0, checkedAt: 0 };
    this.chantiers = {};   // projet -> [{ file, text, mtime }]
    this.campaigns = [];   // voir lib/campaign.js
    this.testGroups = {};  // projet -> { 'CTB.Munitions': nombre de tests vus }
    this.characters = {};  // id -> { id, name, role, look, createdAt }
    this.projects = [];    // projets Unreal connectes : [{ name, root, uproject, engine }]
    this.inventories = {}; // nom du projet -> inventaire (lib/inventory.js), recalcule par le serveur
    this.editors = {};     // nom du projet -> ce que dit le plugin Unreal de l'editeur ouvert
    this.roster = null;    // le quartier des agents : tous les agents appelables et leur usage (lib/agents.js)
    this.skills = null;    // la bibliotheque des skills installes et leur usage (lib/skills.js), relue par le serveur
    this.tasks = [];       // taches ajoutees par l'utilisateur (lib/taches.js), en plus des taches de base
    this.sujets = {};      // projet -> { topics, board } : les sujets du jeu, leur carnet, le tableau (lib/sujets.js)
    this.features = [];    // sessions feature creees depuis la tour (lib/features.js)
    this.featureNotes = {}; // id de feature -> son carnet, relu par le serveur
    this.regles = {};      // id de sujet ou de feature -> { action: 'oui' | 'demander' | 'non' } (lib/regles.js)
    this.answers = {};     // id de question -> reponse donnee dans la tour, en attente du hook
    this.redTests = {};    // projet -> chemins des tests rouges a leur dernier passage
    this.onVictory = null; // (campagne) => void, branche par le serveur
    this.onTaskDone = null; // (agent) => void : une tache vient de rendre son suivi (lib/verif.js)
    this.seq = 0;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) { try { fn(); } catch { /* un abonne en moins */ } } }

  // ---- agents -------------------------------------------------------------------------------

  agent(sessionId, cwd) {
    let a = this.agents[sessionId];
    if (!a) {
      a = this.agents[sessionId] = {
        sessionId,
        status: 'ready',
        cwd: cwd || '',
        project: null,
        firstSeen: this.now(),
        lastSeen: this.now(),
        prompt: '',
        tool: null,
        message: '',
        lastError: '',
        subagents: {},
        model: '',
        title: '',
        lastBuild: null,
        lastTest: null,
      };
    }
    if (!a.characterId || !this.characters[a.characterId]) this.assignCharacter(a);
    if (cwd && cwd !== a.cwd) a.cwd = cwd;
    if (a.cwd && !a.project) {
      const p = findProject(a.cwd);
      if (p) a.project = { name: p.name, root: p.root };
    }
    return a;
  }

  event(ev) {
    if (!ev || typeof ev !== 'object' || !ev.session_id) return false;
    const a = this.agent(String(ev.session_id), ev.cwd);
    const t = this.now();
    a.lastSeen = t;
    // Les hooks asynchrones peuvent arriver dans le desordre : un PostToolUse en retard ne doit pas
    // faire repasser au travail un agent qui a deja fini. On ignore tout evenement plus vieux que
    // le dernier pris en compte.
    const ts = Number(ev.ts) || t;
    if (a.eventTs && ts < a.eventTs) { this.changed(); return true; }
    a.eventTs = ts;
    if (ev.session_title && a.title !== snip(ev.session_title, 80)) {
      a.title = snip(ev.session_title, 80);
      // Un personnage attache a ce role prend la place du personnage donne par defaut.
      const owner = Object.values(this.characters).find(c => c.role && c.role.toLowerCase() === a.title.toLowerCase());
      if (owner && owner.id !== a.characterId) a.characterId = owner.id;
    }
    if (typeof ev.transcript_path === 'string' && ev.transcript_path) a.transcript = ev.transcript_path;
    const sub = ev.agent_id ? String(ev.agent_id) : null;
    if (sub) {
      a.subagents[sub] = { type: ev.agent_type || 'agent', lastSeen: t };
    }

    switch (ev.hook_event_name) {
      case 'SessionStart':
        a.status = 'ready';
        a.subagents = {}; // session neuve ou reprise : personne n'est encore a la table
        if (ev.model) a.model = snip(typeof ev.model === 'string' ? ev.model : ev.model.id || '', 40);
        a.message = ev.source && ev.source !== 'startup' ? `reprise (${ev.source})` : '';
        break;
      case 'UserPromptSubmit':
        a.status = 'working';
        delete a.hidden; // une salle rangee qui reprend du service revient dans le batiment
        // Les messages injectes par Claude Code (fin de tache de fond...) ne sont pas une demande.
        if (ev.prompt && !/^\s*<[a-z_-]+[\s>]/i.test(ev.prompt)) {
          a.prompt = snip(ev.prompt, 240);
          if (!a.firstPrompt) a.firstPrompt = a.prompt; // donne son nom a la salle (lib/salles.js)
        }
        // Une session lancee depuis le panneau Taches (ou avec sa consigne collee) porte sa marque.
        const tid = taches.taskIdIn(ev.prompt);
        if (tid && (!a.task || a.task.id !== tid)) {
          const def = this.taskList().find(x => x.id === tid) || this.sujetTask(tid);
          a.task = suivi.start(tid, def ? def.title : tid, t);
        }
        a.message = '';
        a.promptAt = t;
        break;
      case 'PreToolUse':
      case 'PostToolUse':
        // Un sous-agent de fond peut encore travailler apres la fin du tour de la session : il reste a la
        // table, mais la session garde son etat (a fini, attend ta reponse).
        if (!sub) a.status = 'working';
        a.tool = { name: ev.tool_name || '?', summary: toolSummary(ev.tool_name, ev.tool_input), at: t, sub: !!sub };
        // Sur la carte, le personnage se tient devant l'extension du fichier qu'il touche.
        const touched = ev.tool_input && (ev.tool_input.file_path || ev.tool_input.path);
        const room = touched ? roomForPath(touched) : null;
        if (room) { a.room = room; a.roomAt = t; }
        if (touched && ev.hook_event_name === 'PreToolUse' || touched && /^(Edit|Write|MultiEdit)$/.test(ev.tool_name || '')) a.lastFile = { path: String(touched), at: t, tool: ev.tool_name };
        if (Array.isArray(ev.game_paths) && ev.game_paths.length) {
          const keep = (a.lastAssets || []).filter(x => t - x.at < 30 * 60_000 && !ev.game_paths.includes(x.pkg));
          a.lastAssets = [...ev.game_paths.slice(0, 8).map(p => ({ pkg: String(p).slice(0, 300), at: t })), ...keep].slice(0, 20);
        }
        if (ev.hook_event_name === 'PostToolUse') {
          const d = docRead(ev.tool_name, ev.tool_input);
          if (d) {
            a.docs = a.docs || { count: 0, last: null };
            a.docs.count++;
            a.docs.last = { ...d, at: t };
          }
          // Un rapport ecrit dans Saved/Tour ne compte pas comme une modification du jeu.
          if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(ev.tool_name || '') && !suivi.isTowerFile(touched)) a.edits = (a.edits || 0) + 1;
        }
        if (ev.hook_event_name === 'PreToolUse' && !sub) a.message = '';
        // L'agent pose une question a l'humain dans sa fenetre : il attend sa reponse.
        if (ev.tool_name === 'AskUserQuestion' && ev.hook_event_name === 'PreToolUse' && !sub) {
          a.status = 'waiting';
          a.message = snip((ev.tool_input && ev.tool_input.question) || 'Une question dans sa session Claude Code.', 200);
        }
        break;
      case 'PostToolUseFailure':
        if (!sub) a.status = 'working';
        a.lastError = snip(ev.error, 200);
        break;
      case 'Notification':
        // idle_prompt = l'agent a fini et attend depuis un moment ; le reste demande une reponse.
        // Le rappel « en attente » ne remplace pas ce que l'agent a dit en finissant.
        if (ev.notification_type === 'idle_prompt') { a.status = 'idle'; if (!a.message) a.message = snip(ev.message, 200); }
        else { a.status = 'waiting'; a.message = snip(ev.message, 200); }
        break;
      case 'SubagentStart':
        break;
      case 'SubagentStop':
        if (sub) delete a.subagents[sub];
        break;
      case 'Stop':
        a.status = 'idle';
        // Le bloc « ## Suivi » d'une tache s'affiche a part (lib/suivi.js) : la fiche garde ce qui precede.
        a.message = snip(String(ev.last_assistant_message || '').split(/^[ \t]*#{1,4}[ \t]*suivi\b/im)[0].trim() || ev.last_assistant_message, 240);
        a.subagents = {};
        break;
      case 'SessionEnd':
        a.subagents = {};
        // Une session de discussion (lib/discussion.js) se termine a chaque message : elle reste
        // ouverte pour la tour, et attend le suivant.
        if (a.chat && a.chat.mode === 'tour') { if (a.status === 'working') a.status = 'idle'; break; }
        a.status = 'ended';
        a.message = ev.reason ? `fin : ${ev.reason}` : '';
        break;
      default:
        break;
    }
    // Une question ouverte dans la tour (hooks/tower-ask.js) que la session a depassee : elle a eu sa
    // reponse dans sa fenetre, ou s'est arretee.
    if (a.ask && !sub && /^(UserPromptSubmit|PostToolUse|Stop|SessionEnd)$/.test(ev.hook_event_name || '')) delete a.ask;
    if (a.task) {
      suivi.track(a.task, ev, t); // les sous-agents de la tache comptent aussi
      // Fin de tache (son bloc « Suivi » est arrive) : la tour la verifie elle-meme.
      if (ev.hook_event_name === 'Stop' && !sub && a.task.suivi && this.onTaskDone) {
        try { this.onTaskDone(a); } catch { /* la verification est un bonus */ }
      }
    }
    this.pruneSubagents(a, t);
    this.changed();
    return true;
  }

  // Un sous-agent muet depuis 10 minutes est considere comme fini. Verifie aussi sans nouvel evenement
  // (expire, toutes les 2 s) : une session fermee d'un coup ne laisse pas sa table occupee.
  pruneSubagents(a, t = this.now()) {
    let n = 0;
    for (const [k, v] of Object.entries(a.subagents || {})) if (t - v.lastSeen > SUB_SILENT_MS) { delete a.subagents[k]; n++; }
    return n;
  }

  // Tokens lus dans le journal de la session (lib/usage.js, appele par le serveur).
  setUsage(sessionId, usage) {
    const a = this.agents[sessionId];
    if (!a || !usage) return false;
    // Le titre que Claude Code donne a la session (ou /rename) est dans son journal.
    if (usage.title) a.sessionName = snip(usage.title, 80);
    delete usage.title;
    a.usage = usage;
    this.changed();
    return true;
  }

  // Un sujet (core) ou une feature sous forme de tache, pour le lancer et nommer sa salle. Sa consigne
  // finit par ses regles, pour qu'il ne tente pas ce qu'ali lui a interdit.
  sujetTask(id) {
    let task = null;
    if (sujets.isSujet(id)) {
      for (const v of Object.values(this.sujets)) {
        const t = v && v.topics && v.topics.find(x => x.id === id);
        if (t) { task = sujets.taskOf(t); break; }
      }
    } else if (features.isFeature(id)) {
      const f = this.features.find(x => x.id === id);
      if (f) task = features.taskOf(f, this.topicsOf(f.project));
    }
    return task && { ...task, prompt: `${task.prompt}\n\n${regles.text(this.regles[id])}` };
  }
  topicsOf(project) {
    const v = this.sujets[project] || Object.values(this.sujets)[0];
    return (v && v.topics) || [];
  }

  // Une nouvelle feature, creee depuis la tour.
  addFeature(input) {
    const r = features.make(input, this.features, this.topicsOf(input && input.project), this.now());
    if (!r.ok) return r;
    this.features.push(r.feature);
    this.changed();
    return r;
  }
  // Terminer une feature : sa salle quitte le batiment (on la retrouve dans les anciennes), rien n'est efface.
  endFeature(id, done = true) {
    const f = this.features.find(x => x.id === id);
    if (!f) return false;
    if (done) f.doneAt = this.now(); else delete f.doneAt;
    this.changed();
    return true;
  }
  setFeatureNotes(id, notes) {
    if (JSON.stringify(this.featureNotes[id] || null) === JSON.stringify(notes || null)) return false;
    this.featureNotes[id] = notes || null;
    this.changed();
    return true;
  }

  // Les regles d'une session core ou feature : ce qu'elle fait sans demander, demande, ou ne fait pas.
  setRule(id, action, level) {
    if (!(sujets.isSujet(id) || features.isFeature(id)) || !regles.valid(action, level)) return false;
    this.regles[id] = { ...regles.rulesOf(this.regles[id]), [action]: level };
    this.changed();
    return true;
  }
  ruleArgs(id) { return id && (sujets.isSujet(id) || features.isFeature(id)) ? regles.args(this.regles[id]) : []; }

  setSujets(project, v) {
    if (!project || !v) return false;
    if (JSON.stringify(this.sujets[project]) === JSON.stringify(v)) return false;
    this.sujets[project] = v;
    this.changed();
    return true;
  }

  // Ranger une salle : elle quitte le batiment, rien n'est efface ; « Anciennes sessions » la remontre.
  hide(sessionId, hidden = true) {
    const a = this.agents[sessionId];
    if (!a) return false;
    if (hidden) a.hidden = this.now(); else delete a.hidden;
    this.changed();
    return true;
  }

  taskList() {
    return [...taches.BUILTIN.map(t => ({ ...t, builtin: true })), ...this.tasks.map(t => ({ ...t, builtin: false }))];
  }

  forget(sessionId) {
    if (!this.agents[sessionId]) return false;
    delete this.agents[sessionId];
    this.changed();
    return true;
  }

  label(sessionId) {
    if (String(sessionId).startsWith('editor:')) return `Editeur Unreal (${String(sessionId).slice(7)})`;
    if (String(sessionId).startsWith('verif:')) return `verif de fin de tache, ${this.label(String(sessionId).slice(6))}`;
    const a = this.agents[sessionId];
    if (!a) return sessionId ? `agent ${String(sessionId).slice(0, 8)}` : 'inconnu';
    const where = a.project ? a.project.name : (a.cwd || '').split(/[\\/]/).filter(Boolean).pop();
    const c = this.characters[a.characterId];
    if (c) return where ? `${c.name} (${where})` : c.name;
    return a.title || (where ? `${where} · ${sessionId.slice(0, 8)}` : `agent ${sessionId.slice(0, 8)}`);
  }

  // ---- verrou -------------------------------------------------------------------------------

  // Demande le verrou. Renvoie { ticket, granted, position, holder }.
  acquire(req) {
    this.expire();
    const t = this.now();
    const entry = {
      ticket: `T${++this.seq}-${t.toString(36)}`,
      sessionId: req.sessionId || '',
      kind: req.kind || 'build',
      command: snip(req.command, 300),
      cwd: req.cwd || '',
      project: req.cwd ? (findProject(req.cwd) || {}).name || null : null,
      pid: req.pid || null,
      target: req.target || null,
      testFilter: req.testFilter || null,
      since: t,
      lastSeen: t,
    };
    entry.label = this.label(entry.sessionId);
    this.queue.push(entry);
    this.promote();
    this.changed();
    return this.ticketStatus(entry.ticket);
  }

  ticketStatus(ticket) {
    if (this.lock && this.lock.ticket === ticket) return { ticket, granted: true, position: 0 };
    const i = this.queue.findIndex(e => e.ticket === ticket);
    if (i < 0) return { ticket, granted: false, position: -1, lost: true };
    return {
      ticket,
      granted: false,
      position: i + 1,
      holder: this.lock ? { label: this.lock.label, kind: this.lock.kind, since: this.lock.since } : null,
    };
  }

  // Signe de vie, pour le detenteur comme pour un ticket en file.
  touch(ticket) {
    const t = this.now();
    if (this.lock && this.lock.ticket === ticket) { this.lock.lastSeen = t; return true; }
    const e = this.queue.find(x => x.ticket === ticket);
    if (e) { e.lastSeen = t; return true; }
    return false;
  }

  promote() {
    if (this.lock || !this.queue.length) return false;
    const next = this.queue.shift();
    next.grantedAt = this.now();
    next.lastSeen = next.grantedAt;
    this.lock = next;
    const a = this.agents[next.sessionId];
    if (a) a.building = { kind: next.kind, since: next.grantedAt };
    return true;
  }

  expire() {
    const t = this.now();
    let dirty = false;
    if (this.lock && t - this.lock.lastSeen > LEASE_MS) {
      this.recordBuild(this.lock, { ok: false, exitCode: null, summary: 'verrou perdu (plus de signe de vie)', errors: 0, errorLines: [], tests: null }, 'expired');
      this.lock = null;
      dirty = true;
    }
    const before = this.queue.length;
    this.queue = this.queue.filter(e => t - e.lastSeen <= LEASE_MS);
    if (this.queue.length !== before) dirty = true;
    if (this.promote()) dirty = true;
    for (const a of Object.values(this.agents)) if (this.pruneSubagents(a, t)) dirty = true;
    if (dirty) this.changed();
    return dirty;
  }

  release(ticket, result) {
    if (!this.lock || this.lock.ticket !== ticket) {
      // Ticket encore en file (la commande a tourne sans attendre, comme Live Coding qu'on ne
      // peut pas retenir) ou deja expire : on garde quand meme le resultat.
      const q = this.queue.findIndex(e => e.ticket === ticket);
      if (q >= 0) {
        const [entry] = this.queue.splice(q, 1);
        this.recordBuild({ ...entry, grantedAt: entry.since }, result || {}, 'unlocked');
      } else if (result && result.entry) {
        this.recordBuild(result.entry, result, 'late');
      }
      this.changed();
      return false;
    }
    this.recordBuild(this.lock, result || {}, 'done');
    this.lock = null;
    this.promote();
    this.changed();
    return true;
  }

  forceRelease() {
    if (!this.lock) return false;
    this.recordBuild(this.lock, { ok: false, exitCode: null, summary: 'libere a la main', errors: 0, errorLines: [], tests: null }, 'forced');
    this.lock = null;
    this.promote();
    this.changed();
    return true;
  }

  // Build lance sans verrou (tour arretee puis revenue, ou commande deja finie) : on garde le resultat.
  report(entry, result) {
    this.recordBuild({ ...entry, label: this.label(entry.sessionId), since: entry.since || this.now(), grantedAt: entry.since || this.now() }, result, 'unlocked');
    this.changed();
  }

  recordBuild(entry, result, how) {
    const t = this.now();
    const b = {
      id: entry.ticket || `U${++this.seq}`,
      sessionId: entry.sessionId,
      label: entry.label || this.label(entry.sessionId),
      kind: entry.kind,
      command: entry.command,
      project: entry.project || null,
      queuedAt: entry.since,
      startedAt: entry.grantedAt || entry.since,
      endedAt: t,
      waitMs: (entry.grantedAt || entry.since) - entry.since,
      durationMs: t - (entry.grantedAt || entry.since),
      ok: !!result.ok,
      exitCode: result.exitCode ?? null,
      summary: snip(result.summary || '', 120),
      errors: result.errors || 0,
      warnings: result.warnings || 0,
      errorLines: (result.errorLines || []).slice(0, 5).map(l => snip(l, 300)),
      tests: result.tests || null,
      target: entry.target || null,
      testFilter: entry.testFilter || null,
      how,
    };
    // Un faux build de tuto ne prouve rien.
    if (!isTuto(b.sessionId)) this.noteTestGroups(b);
    // Un verrou perdu ou libere a la main ne dit rien de la qualite du code.
    if (how !== 'expired' && how !== 'forced' && !isTuto(b.sessionId)) this.feedCampaigns(b);
    if (!isTuto(b.sessionId)) this.noteRedTests(b);
    // Les chemins de tests ne servent qu'aux campagnes : on ne les garde pas dans l'historique,
    // sauf les rouges d'une verification de fin de tache (lib/verif.js les compare a ceux d'avant).
    if (b.tests) {
      const { passedPaths, failedPaths, ...rest } = b.tests;
      b.tests = rest;
      if (String(b.sessionId).startsWith('verif:') && failedPaths) b.tests.failedPaths = failedPaths.slice(0, 50);
    }
    this.builds.unshift(b);
    if (this.builds.length > MAX_BUILDS) this.builds.length = MAX_BUILDS;
    const a = this.agents[entry.sessionId];
    if (a) {
      delete a.building;
      if (b.kind === 'test' || b.tests) a.lastTest = b; else a.lastBuild = b;
    }
    return b;
  }

  // Tests rouges a leur dernier passage : un test qui passe sort de la liste, un qui echoue y entre.
  noteRedTests(b) {
    const t = b.tests;
    if (!t || !b.project || !(t.passedPaths || t.failedPaths)) return;
    const red = new Set(this.redTests[b.project] || []);
    for (const p of t.passedPaths || []) red.delete(p);
    for (const p of t.failedPaths || []) red.add(p);
    this.redTests[b.project] = [...red].slice(-500);
  }

  // Groupes de tests vus (CTB.Munitions...) : proposes dans le formulaire de version.
  noteTestGroups(b) {
    const t = b.tests;
    if (!t || !b.project) return;
    const g = this.testGroups[b.project] = this.testGroups[b.project] || {};
    for (const p of [...(t.passedPaths || []), ...(t.failedPaths || [])]) {
      const parts = String(p).split('.');
      for (let d = 1; d <= Math.min(2, parts.length - 1); d++) {
        const k = parts.slice(0, d + 1).join('.');
        g[k] = (g[k] || 0) + 1;
      }
    }
  }

  // ---- personnages ---------------------------------------------------------------------------

  // Donne un personnage a un agent : celui de son role s'il existe, sinon un personnage libre,
  // sinon un nouveau tire au hasard (toujours le meme pour une meme session).
  assignCharacter(a) {
    // Un agent de tuto a son propre personnage, efface avec lui.
    if (isTuto(a.sessionId)) { a.characterId = this.createCharacter({ seed: a.sessionId, tuto: true }).id; return this.characters[a.characterId]; }
    const list = Object.values(this.characters);
    const busy = new Set(Object.values(this.agents).filter(x => x !== a && x.status !== 'ended').map(x => x.characterId));
    let c = a.title && list.find(x => x.role && x.role.toLowerCase() === a.title.toLowerCase());
    if (!c) c = list.filter(x => !x.role && !busy.has(x.id)).sort((x, y) => x.createdAt - y.createdAt)[0];
    if (!c) c = this.createCharacter({ seed: a.sessionId });
    a.characterId = c.id;
    return c;
  }

  createCharacter({ name, look, role, seed, tuto } = {}) {
    const id = `P${++this.seq}-${this.now().toString(36)}`;
    const taken = new Set(Object.values(this.characters).map(c => c.name));
    const c = {
      id,
      name: chars.cleanName(name) || chars.randomName(seed || id, taken),
      role: chars.cleanName(role),
      look: chars.cleanLook(look, chars.randomLook(seed || id)),
      createdAt: this.now(),
    };
    if (tuto) c.tuto = true;
    this.characters[id] = c;
    this.changed();
    return c;
  }

  // Retrouve un personnage par id, par nom, ou par la session qu'il represente.
  findCharacter({ id, name, sessionId } = {}) {
    if (id && this.characters[id]) return this.characters[id];
    if (sessionId && this.agents[sessionId]) return this.characters[this.agents[sessionId].characterId] || null;
    if (name) {
      const n = String(name).trim().toLowerCase();
      return Object.values(this.characters).find(c => c.name.toLowerCase() === n)
        || Object.values(this.characters).find(c => c.role && c.role.toLowerCase() === n) || null;
    }
    return null;
  }

  updateCharacter(req) {
    const c = this.findCharacter(req);
    if (!c) return null;
    if (req.newName !== undefined || (req.name !== undefined && req.id)) {
      const n = chars.cleanName(req.newName !== undefined ? req.newName : req.name);
      if (n) c.name = n;
    }
    if (req.role !== undefined) c.role = chars.cleanName(req.role);
    if (req.look) c.look = chars.cleanLook(req.look, c.look);
    if (req.randomize) c.look = chars.randomLook(`${c.id}:${this.now()}`);
    this.changed();
    return c;
  }

  deleteCharacter(id) {
    if (!this.characters[id]) return false;
    delete this.characters[id];
    for (const a of Object.values(this.agents)) if (a.characterId === id) delete a.characterId;
    this.changed();
    return true;
  }

  setAgentCharacter(sessionId, characterId) {
    const a = this.agents[sessionId];
    if (!a || !this.characters[characterId]) return false;
    a.characterId = characterId;
    this.changed();
    return true;
  }

  // ---- projets connectes -----------------------------------------------------------------------

  connectProject(p) {
    if (!p || !p.uproject) return false;
    if (!this.projects.some(x => x.uproject.toLowerCase() === p.uproject.toLowerCase())) this.projects.push(p);
    this.changed();
    return true;
  }

  disconnectProject(uproject) {
    const n = this.projects.length;
    this.projects = this.projects.filter(x => x.uproject.toLowerCase() !== String(uproject).toLowerCase());
    if (n !== this.projects.length) this.changed();
    return n !== this.projects.length;
  }

  // ---- editeur Unreal (plugin AlkatrazzTower) -------------------------------------------------

  // Le plugin envoie l'etat de l'editeur toutes les quelques secondes.
  editorState(b) {
    if (!b || !b.project) return false;
    const name = String(b.project).slice(0, 80);
    const prev = this.editors[name] || {};
    this.editors[name] = {
      project: name,
      uproject: String(b.uproject || '').slice(0, 400),
      engine: String(b.engine || '').slice(0, 40),
      pid: Number(b.pid) || null,
      map: String(b.map || '').slice(0, 200),
      pie: !!b.pie,
      dirty: Math.max(0, Number(b.dirty) || 0),
      dirtyNames: Array.isArray(b.dirtyNames) ? b.dirtyNames.slice(0, 10).map(x => String(x).slice(0, 120)) : [],
      liveCoding: { enabled: !!(b.liveCoding && b.liveCoding.enabled), compiling: !!(b.liveCoding && b.liveCoding.compiling) },
      openAssets: Array.isArray(b.openAssets) ? b.openAssets.slice(0, 20).map(x => String(x).slice(0, 300)) : [],
      lastSaved: prev.lastSaved || null,
      lastSeen: this.now(),
    };
    this.changed();
    return true;
  }

  // Editeur vu depuis moins de 15 s : le plugin est vivant.
  liveEditor(project) {
    const e = project && Object.values(this.editors).find(x => x.project.toLowerCase() === String(project).toLowerCase());
    return e && this.now() - e.lastSeen < 15_000 ? e : null;
  }

  // Le plugin signale un asset ouvert dans un editeur d'asset : un agent est-il dessus ?
  // On compare le fichier (.uasset modifie a la main) et le paquet /Game/... (MCP, scripts Python).
  agentsOnAsset(file, pkg) {
    const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase().replace(/\.(uasset|umap)$/, '');
    const f = norm(file), p = String(pkg || '').toLowerCase();
    if (!f && !p) return [];
    const recent = (at) => this.now() - at < 30 * 60_000;
    const out = [];
    for (const a of Object.values(this.agents)) {
      if (a.status === 'ended') continue;
      let at = 0;
      if (f && a.lastFile && norm(a.lastFile.path) === f && recent(a.lastFile.at)) at = a.lastFile.at;
      const hit = p && (a.lastAssets || []).find(x => x.pkg.toLowerCase() === p && recent(x.at));
      if (hit) at = Math.max(at, hit.at);
      if (at) out.push({ sessionId: a.sessionId, name: this.label(a.sessionId), at });
    }
    return out;
  }

  // Ce que le plugin affiche dans l'editeur : petit, pour etre lu toutes les 3 s.
  editorFeed(project) {
    const p = String(project || '').toLowerCase();
    const mine = (a) => !p || (a.project && a.project.name.toLowerCase() === p);
    const agents = Object.values(this.agents).filter(a => a.status !== 'ended' && mine(a));
    const camp = this.campaigns.find(c => !c.archived && (!p || c.project.toLowerCase() === p));
    const v = camp ? campaign.view(camp) : null;
    return {
      now: this.now(),
      agents: agents.map(a => ({
        sessionId: a.sessionId,
        name: this.label(a.sessionId),
        status: a.status,
        message: a.status === 'waiting' ? a.message : '',
        tool: a.tool ? `${a.tool.name} ${a.tool.summary}`.slice(0, 120) : '',
        room: a.room || null,
      })),
      lock: this.lock ? { label: this.lock.label, kind: this.lock.kind, since: this.lock.grantedAt || this.lock.since, sessionId: this.lock.sessionId } : null,
      queue: this.queue.map(e => ({ label: e.label, kind: e.kind, sessionId: e.sessionId })),
      lastBuild: (() => {
        // Le dernier build de CE projet : l'editeur n'a pas a annoncer ceux des autres.
        const b = this.builds.find(x => !p || (x.project && x.project.toLowerCase() === p));
        return b ? { id: b.id, sessionId: b.sessionId, project: b.project, label: b.label, kind: b.kind, ok: b.ok, summary: b.summary, endedAt: b.endedAt } : null;
      })(),
      version: v ? { name: v.name, proven: v.progress.proven, total: v.progress.total, won: !!v.wonAt } : null,
    };
  }

  // ---- campagnes ----------------------------------------------------------------------------

  feedCampaigns(b) {
    for (const c of this.campaigns) {
      if (!campaign.applyBuild(c, b)) continue;
      if (campaign.checkVictory(c, this.now()) && this.onVictory) {
        try { this.onVictory(c); } catch { /* le commit est un bonus */ }
      }
    }
  }

  createCampaign({ name, project, text }) {
    const c = campaign.newCampaign({ id: `C${++this.seq}-${this.now().toString(36)}`, name, project, text, now: this.now() });
    // Une seule campagne en cours par projet : la precedente est rangee.
    for (const o of this.campaigns) if (!o.wonAt && !o.archived && o.project.toLowerCase() === c.project.toLowerCase()) o.archived = true;
    this.campaigns.unshift(c);
    this.changed();
    return c;
  }

  manualProof(id, featureId, ok) {
    const c = this.campaigns.find(x => x.id === id);
    if (!c || !campaign.setManual(c, featureId, ok, this.now())) return false;
    if (campaign.checkVictory(c, this.now()) && this.onVictory) {
      try { this.onVictory(c); } catch { /* bonus */ }
    }
    this.changed();
    return true;
  }

  archiveCampaign(id) {
    const c = this.campaigns.find(x => x.id === id);
    if (!c) return false;
    c.archived = true;
    this.changed();
    return true;
  }

  deleteCampaign(id) {
    const n = this.campaigns.length;
    this.campaigns = this.campaigns.filter(x => x.id !== id);
    if (n !== this.campaigns.length) this.changed();
    return n !== this.campaigns.length;
  }

  // Le nom de salle choisi par l'utilisateur ; vide = le nom automatique revient.
  // ---- questions et permissions auxquelles ali repond depuis la tour (hooks/tower-ask.js) ------------

  // Le hook ouvre une question : la salle passe « attend ta reponse » avec ses options.
  openAsk(req) {
    if (!req || !req.sessionId) return null;
    const a = this.agent(String(req.sessionId), req.cwd);
    const t = this.now();
    const id = `Q${++this.seq}-${t.toString(36)}`;
    const qs = (Array.isArray(req.questions) ? req.questions : []).slice(0, 4).map(q => ({
      question: snip(q && q.question, 300),
      header: snip(q && q.header, 30),
      multiSelect: !!(q && q.multiSelect),
      options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 6).map(o => ({ label: snip(o && o.label, 80), description: snip(o && o.description, 200) })).filter(o => o.label),
    })).filter(q => q.question);
    const kind = req.kind === 'permission' ? 'permission' : 'question';
    if (kind === 'question' && !qs.length) return null;
    a.ask = { id, kind, at: t, questions: qs, tool: snip(req.tool, 60), summary: snip(req.summary, 300), window: false };
    a.status = 'waiting';
    a.lastSeen = t;
    a.message = kind === 'permission' ? snip(`Autorisation : ${req.tool || 'outil'} ${req.summary || ''}`, 200) : snip(qs[0].question, 200);
    this.changed();
    return id;
  }

  // Reponse d'ali dans la tour : { answers: { question: reponse } } ou { decision: 'allow' | 'deny' },
  // ou { decision: 'window' } pour repondre dans la fenetre de la session.
  answerAsk(id, body = {}) {
    const a = Object.values(this.agents).find(x => x.ask && x.ask.id === id);
    if (!a) return { ok: false, error: 'Cette question n\'attend plus de réponse.' };
    const ask = a.ask;
    let answer;
    if (body.decision === 'window') answer = { decision: 'window' };
    else if (ask.kind === 'permission') {
      if (body.decision !== 'allow' && body.decision !== 'deny') return { ok: false, error: 'Autoriser ou refuser ?' };
      answer = { decision: body.decision };
    } else {
      const answers = {};
      for (const q of ask.questions) {
        const v = body.answers && body.answers[q.question];
        const txt = Array.isArray(v) ? v.map(x => snip(x, 200)).filter(Boolean).join(', ') : snip(v, 500);
        if (!txt) return { ok: false, error: `Il manque ta réponse à « ${q.question} ».` };
        answers[q.question] = txt;
      }
      answer = { answers };
    }
    this.answers[id] = { ...answer, at: this.now() };
    if (answer.decision === 'window') { ask.window = true; this.changed(); return { ok: true }; }
    delete a.ask;
    a.status = 'working';
    a.message = '';
    this.changed();
    return { ok: true };
  }

  // Ce que le hook lit en attendant : la reponse, rien encore, ou question perdue (tour redemarree).
  askStatus(id) {
    const ans = this.answers[id];
    if (ans) { delete this.answers[id]; return { answered: true, ...ans }; }
    const a = Object.values(this.agents).find(x => x.ask && x.ask.id === id);
    return a ? { pending: true } : { lost: true };
  }

  // Le hook rend la main sans reponse (delai depasse) : la question reste posee, dans la fenetre.
  closeAsk(id) {
    const a = Object.values(this.agents).find(x => x.ask && x.ask.id === id);
    if (!a) return false;
    a.ask.window = true;
    this.changed();
    return true;
  }

  renameRoom(sessionId, label) {
    const a = this.agents[sessionId];
    if (!a) return false;
    const v = snip(String(label || '').replace(/[\u0000-\u001f]/g, ' '), 60);
    if (v) a.label = v; else delete a.label;
    this.changed();
    return true;
  }

  // L'equipe de chaque projet connecte : ses agents .claude/agents, ranges par section.
  teams() {
    const out = {};
    for (const p of this.projects) if (p && p.root && p.name) out[p.name] = equipe.teamOf(p.root);
    return out;
  }

  // ---- instantane ---------------------------------------------------------------------------

  snapshot() {
    const team = this.teams();
    const section = (a, type) => {
      const list = a.project ? team[a.project.name] || [] : [];
      const m = list.find(x => x.name.toLowerCase() === String(type).toLowerCase());
      return m ? m.section : '';
    };
    const view = (a) => ({
      ...a,
      salle: salleOf(a),
      subagents: Object.fromEntries(Object.entries(a.subagents || {}).map(([k, v]) => [k, { ...v, section: section(a, v.type) }])),
    });
    return {
      now: this.now(),
      agents: Object.values(this.agents).sort((x, y) => y.lastSeen - x.lastSeen).map(view),
      team,
      lock: this.lock,
      queue: this.queue,
      builds: this.builds,
      editor: this.editor,
      chantiers: this.chantiers,
      campaigns: this.campaigns.map(campaign.view),
      testGroups: this.testGroups,
      characters: this.characters,
      projects: this.projects,
      inventories: this.inventories,
      editors: this.editors,
      tuto: this.tuto || null,
      tasks: this.taskList(),
      taskSuivi: suivi.CONSIGNE,
      skills: this.skills,
      roster: this.roster,
      sujets: this.sujets,
      features: this.features.map(f => ({ ...f, notes: this.featureNotes[f.id] || null })),
      regles: Object.fromEntries([...Object.values(this.sujets).flatMap(v => (v && v.topics) || []), ...this.features].map(x => [x.id, regles.rulesOf(this.regles[x.id])])),
      actions: regles.ACTIONS,
    };
  }

  toJSON() {
    const keep = (o, ok) => Object.fromEntries(Object.entries(o).filter(([, v]) => ok(v)));
    return {
      agents: keep(this.agents, a => !isTuto(a.sessionId)), builds: this.builds.filter(b => !isTuto(b.sessionId)), seq: this.seq,
      campaigns: this.campaigns, testGroups: this.testGroups, characters: keep(this.characters, c => !c.tuto), projects: this.projects,
      tasks: this.tasks, redTests: this.redTests, features: this.features, regles: this.regles,
    };
  }

  load(saved) {
    if (!saved || typeof saved !== 'object') return;
    if (saved.agents) this.agents = saved.agents;
    if (Array.isArray(saved.builds)) this.builds = saved.builds.slice(0, MAX_BUILDS);
    if (saved.seq) this.seq = saved.seq;
    if (Array.isArray(saved.campaigns)) this.campaigns = saved.campaigns;
    if (saved.testGroups && typeof saved.testGroups === 'object') this.testGroups = saved.testGroups;
    if (saved.characters && typeof saved.characters === 'object') this.characters = saved.characters;
    // Ancien nom donne au hasard, confondu avec la forge de la page : renomme une fois.
    for (const c of Object.values(this.characters)) if (c && c.name === 'Forge') c.name = Object.values(this.characters).some(x => x.name === 'Quartz') ? 'Quartz 2' : 'Quartz';
    if (Array.isArray(saved.projects)) this.projects = saved.projects;
    if (Array.isArray(saved.tasks)) this.tasks = saved.tasks;
    if (saved.redTests && typeof saved.redTests === 'object') this.redTests = saved.redTests;
    if (Array.isArray(saved.features)) this.features = saved.features;
    if (saved.regles && typeof saved.regles === 'object') this.regles = saved.regles;
    for (const a of Object.values(this.agents)) delete a.building; // aucun verrou ne survit a un redemarrage
    // ni un message de discussion en cours : son processus est parti avec l'ancienne tour
    for (const a of Object.values(this.agents)) if (a.chat) { if (a.chat.busy) { a.chat.error = 'Interrompu : la tour a redémarré.'; if (a.status === 'working') a.status = 'idle'; } a.chat.busy = false; a.chat.queued = 0; }
    // Tache lancee avant le suivi : on la complete, et son dernier fichier ecrit dans Saved/Tour (son rapport) se lit.
    for (const a of Object.values(this.agents)) {
      if (!a.task || a.task.counts) continue;
      a.task = { ...suivi.start(a.task.id, a.task.title, a.task.at), ...a.task, counts: { reads: 0, edits: 0, cmds: 0 } };
      const f = a.lastFile;
      if (f && suivi.isTowerFile(f.path) && f.at >= a.task.at) a.task.files = [{ path: f.path, tool: f.tool, at: f.at, tower: true, n: 1 }];
      if (a.status === 'idle' || a.status === 'ended') a.task.doneAt = a.lastSeen;
    }
  }
}

module.exports = { TowerState, LEASE_MS, toolSummary, snip };
