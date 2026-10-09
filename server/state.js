'use strict';
// Etat de la tour : agents, verrou de build, file d'attente, builds recents.
// Aucune E/S ici, pour pouvoir tout tester sans serveur.

const { findProject } = require('../lib/detect');
const campaign = require('../lib/campaign');
const { docRead } = require('../lib/unreal');

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
    this.onVictory = null; // (campagne) => void, branche par le serveur
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
    if (ev.session_title) a.title = snip(ev.session_title, 80);
    const sub = ev.agent_id ? String(ev.agent_id) : null;
    if (sub) {
      a.subagents[sub] = { type: ev.agent_type || 'agent', lastSeen: t };
    }

    switch (ev.hook_event_name) {
      case 'SessionStart':
        a.status = 'ready';
        if (ev.model) a.model = snip(typeof ev.model === 'string' ? ev.model : ev.model.id || '', 40);
        a.message = ev.source && ev.source !== 'startup' ? `reprise (${ev.source})` : '';
        break;
      case 'UserPromptSubmit':
        a.status = 'working';
        // Les messages injectes par Claude Code (fin de tache de fond...) ne sont pas une demande.
        if (ev.prompt && !/^\s*<[a-z-]+[\s>]/i.test(ev.prompt)) a.prompt = snip(ev.prompt, 240);
        a.message = '';
        a.promptAt = t;
        break;
      case 'PreToolUse':
      case 'PostToolUse':
        a.status = 'working';
        a.tool = { name: ev.tool_name || '?', summary: toolSummary(ev.tool_name, ev.tool_input), at: t, sub: !!sub };
        if (ev.hook_event_name === 'PostToolUse') {
          const d = docRead(ev.tool_name, ev.tool_input);
          if (d) {
            a.docs = a.docs || { count: 0, last: null };
            a.docs.count++;
            a.docs.last = { ...d, at: t };
          }
          if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(ev.tool_name || '')) a.edits = (a.edits || 0) + 1;
        }
        if (ev.hook_event_name === 'PreToolUse') a.message = '';
        break;
      case 'PostToolUseFailure':
        a.status = 'working';
        a.lastError = snip(ev.error, 200);
        break;
      case 'Notification':
        // idle_prompt = l'agent a fini et attend depuis un moment ; le reste demande une reponse.
        if (ev.notification_type === 'idle_prompt') a.status = 'idle';
        else a.status = 'waiting';
        a.message = snip(ev.message, 200);
        break;
      case 'SubagentStart':
        break;
      case 'SubagentStop':
        if (sub) delete a.subagents[sub];
        break;
      case 'Stop':
        a.status = 'idle';
        a.message = snip(ev.last_assistant_message, 240);
        a.subagents = {};
        break;
      case 'SessionEnd':
        a.status = 'ended';
        a.message = ev.reason ? `fin : ${ev.reason}` : '';
        a.subagents = {};
        break;
      default:
        break;
    }
    // Un sous-agent muet depuis 10 minutes est considere comme fini.
    for (const [k, v] of Object.entries(a.subagents)) if (t - v.lastSeen > 600_000) delete a.subagents[k];
    this.changed();
    return true;
  }

  forget(sessionId) {
    if (!this.agents[sessionId]) return false;
    delete this.agents[sessionId];
    this.changed();
    return true;
  }

  label(sessionId) {
    const a = this.agents[sessionId];
    if (!a) return sessionId ? `agent ${String(sessionId).slice(0, 8)}` : 'inconnu';
    const where = a.project ? a.project.name : (a.cwd || '').split(/[\\/]/).filter(Boolean).pop();
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
    if (dirty) this.changed();
    return dirty;
  }

  release(ticket, result) {
    if (!this.lock || this.lock.ticket !== ticket) {
      // Ticket deja expire ou retire de la file : on garde quand meme le resultat.
      const q = this.queue.findIndex(e => e.ticket === ticket);
      if (q >= 0) this.queue.splice(q, 1);
      if (result && result.entry) this.recordBuild(result.entry, result, 'late');
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
    this.noteTestGroups(b);
    // Un verrou perdu ou libere a la main ne dit rien de la qualite du code.
    if (how !== 'expired' && how !== 'forced') this.feedCampaigns(b);
    // Les chemins de tests ne servent qu'aux campagnes : on ne les garde pas dans l'historique.
    if (b.tests) {
      const { passedPaths, failedPaths, ...rest } = b.tests;
      b.tests = rest;
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

  // ---- instantane ---------------------------------------------------------------------------

  snapshot() {
    return {
      now: this.now(),
      agents: Object.values(this.agents).sort((x, y) => y.lastSeen - x.lastSeen),
      lock: this.lock,
      queue: this.queue,
      builds: this.builds,
      editor: this.editor,
      chantiers: this.chantiers,
      campaigns: this.campaigns.map(campaign.view),
      testGroups: this.testGroups,
    };
  }

  toJSON() {
    return { agents: this.agents, builds: this.builds, seq: this.seq, campaigns: this.campaigns, testGroups: this.testGroups };
  }

  load(saved) {
    if (!saved || typeof saved !== 'object') return;
    if (saved.agents) this.agents = saved.agents;
    if (Array.isArray(saved.builds)) this.builds = saved.builds.slice(0, MAX_BUILDS);
    if (saved.seq) this.seq = saved.seq;
    if (Array.isArray(saved.campaigns)) this.campaigns = saved.campaigns;
    if (saved.testGroups && typeof saved.testGroups === 'object') this.testGroups = saved.testGroups;
    for (const a of Object.values(this.agents)) delete a.building; // aucun verrou ne survit a un redemarrage
  }
}

module.exports = { TowerState, LEASE_MS, toolSummary, snip };
