'use strict';
// Tutos : de courts scenarios joues sur la vraie tour, avec le vrai projet, pour voir chaque partie
// marcher. Rien n'est ecrit dans le projet : les agents du tuto sont simules (evenements de hook
// fabriques ici) et la forge lance un faux build (scripts/tuto-build.js) sous le vrai verrou, avec
// le vrai tower-run, depuis le dossier du projet. Les traces (agents, builds, personnages) portent
// l'identifiant « tuto- », ne sont jamais sauvegardees et ne comptent pas pour la version.

const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'bin', 'tower-run.js');
const FAKE_BUILD = path.join(ROOT, 'scripts', 'tuto-build.js');
const PREFIX = 'tuto-';
const AUTO_CLEAN_MS = 30 * 60_000;

const isTuto = (id) => String(id || '').startsWith(PREFIX);

const LIST = [
  { id: 'agent', title: 'Un agent arrive', text: 'Un agent de démonstration ouvre une session sur le projet, lit deux fichiers puis termine.' },
  { id: 'question', title: 'Il te pose une question', text: 'Un agent s\'arrête et attend ta réponse : la tour te le signale.' },
  { id: 'forge', title: 'Un build à la fois', text: 'Deux agents veulent compiler en même temps : un passe à la forge, l\'autre attend son tour.' },
  { id: 'echec', title: 'Un build qui échoue', text: 'Un faux build échoue : la tour lit l\'erreur et la montre.' },
  { id: 'vrai', title: 'Ton vrai agent', text: 'Tu lances Claude Code dans le dossier du projet : la tour le voit arriver tout seul.' },
];

function create(state, { projects }) {
  let run = null;          // { id, project, startedAt, timers, children, done }
  let cleanTimer = null;

  function pickProject(name) {
    const all = projects();
    if (name) return all.find(p => p.name.toLowerCase() === String(name).toLowerCase()) || null;
    return all.find(p => /ctb|conquer/i.test(p.name)) || all[0] || null;
  }

  function info() {
    const p = pickProject();
    return {
      list: LIST,
      project: p ? p.name : null,
      running: run && !run.done ? { id: run.id, project: run.project.name, startedAt: run.startedAt } : null,
      last: run ? { id: run.id, project: run.project.name, startedAt: run.startedAt, done: !!run.done } : null,
    };
  }
  function publish() { state.tuto = info(); state.changed(); }

  // Un evenement de hook, comme en enverrait Claude Code.
  function ev(sid, name, extra = {}) {
    state.event({ session_id: sid, cwd: run.project.root, hook_event_name: name, ts: Date.now(), ...extra });
  }
  function at(ms, fn) {
    const r = run;
    r.timers.push(setTimeout(() => { if (run === r && !r.done) fn(); }, ms));
  }
  function file(...parts) { return path.join(run.project.root, ...parts); }

  // Faux build sous le vrai verrou : tower-run fait exactement ce qu'il fait pour un agent.
  function fakeBuild(sid, how, seconds, then) {
    const r = run;
    const node = process.execPath;
    const win = process.platform === 'win32';
    const cmd = win ? `& "${node}" "${FAKE_BUILD}" ${how} ${seconds}` : `"${node}" "${FAKE_BUILD}" ${how} ${seconds}`;
    const child = spawn(node, [RUNNER, '--shell', win ? 'powershell' : 'bash', '--session', sid, '--kind', 'build', '--', cmd],
      { cwd: r.project.root, stdio: 'ignore', windowsHide: true, env: { ...process.env, TOWER_SESSION: sid } });
    r.children.push(child);
    child.on('error', () => {});
    child.on('close', () => { if (run === r && !r.done && then) then(); });
  }

  function finish() { if (run && !run.done) { run.done = true; publish(); } }

  const SCENES = {
    agent() {
      const s = `${PREFIX}agent`;
      ev(s, 'SessionStart', { source: 'startup', session_title: 'Tuto : visite' });
      at(1500, () => ev(s, 'UserPromptSubmit', { prompt: 'Tuto : regarde comment sont rangés les Blueprints (rien ne sera modifié).' }));
      at(4000, () => ev(s, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: file('Content', 'Blueprints', 'BP_Exemple.uasset') } }));
      at(9000, () => ev(s, 'PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'UCLASS', path: file('Source') } }));
      at(15000, () => { ev(s, 'Stop', { last_assistant_message: 'Tuto fini : j\'ai fait semblant de lire deux fichiers, rien n\'a été touché.' }); finish(); });
    },
    question() {
      const s = `${PREFIX}question`;
      ev(s, 'SessionStart', { source: 'startup', session_title: 'Tuto : question' });
      at(1500, () => ev(s, 'UserPromptSubmit', { prompt: 'Tuto : prépare un build du jeu.' }));
      at(3500, () => ev(s, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: file('Source') } }));
      at(6000, () => ev(s, 'Notification', { notification_type: 'permission_prompt', message: 'Tuto : je peux lancer le build ? (c\'est un exercice, clique sur « J\'ai vu » dans le tuto)' }));
    },
    forge() {
      const a = `${PREFIX}forge-a`, b = `${PREFIX}forge-b`;
      let left = 2;
      const end = (s) => () => { ev(s, 'Stop', { last_assistant_message: 'Tuto : build fini (faux build, rien n\'a été compilé).' }); if (--left === 0) finish(); };
      for (const [s, t] of [[a, 'Tuto : forge 1'], [b, 'Tuto : forge 2']]) {
        ev(s, 'SessionStart', { source: 'startup', session_title: t });
        ev(s, 'UserPromptSubmit', { prompt: 'Tuto : compile le jeu.' });
      }
      at(2000, () => { ev(a, 'PreToolUse', { tool_name: 'PowerShell', tool_input: { command: 'Build.bat (faux build du tuto)' } }); fakeBuild(a, 'ok', 12, end(a)); });
      at(3500, () => { ev(b, 'PreToolUse', { tool_name: 'PowerShell', tool_input: { command: 'Build.bat (faux build du tuto)' } }); fakeBuild(b, 'ok', 8, end(b)); });
    },
    echec() {
      const s = `${PREFIX}echec`;
      ev(s, 'SessionStart', { source: 'startup', session_title: 'Tuto : échec' });
      at(1000, () => ev(s, 'UserPromptSubmit', { prompt: 'Tuto : compile le jeu.' }));
      at(2500, () => {
        ev(s, 'PreToolUse', { tool_name: 'PowerShell', tool_input: { command: 'Build.bat (faux build du tuto)' } });
        fakeBuild(s, 'fail', 8, () => { ev(s, 'Stop', { last_assistant_message: 'Tuto : le build a échoué exprès, la tour a lu l\'erreur.' }); finish(); });
      });
    },
    vrai() { /* rien a simuler : c'est toi qui lances l'agent ; la page guette son arrivee */ },
  };

  function start({ id, project } = {}) {
    if (!SCENES[id]) return { ok: false, error: 'tuto inconnu' };
    const p = pickProject(project);
    if (!p) return { ok: false, error: 'Aucun projet Unreal connecté : connecte d\'abord ton projet (bouton du projet en haut).' };
    if ((id === 'forge' || id === 'echec') && state.lock && !isTuto(state.lock.sessionId)) {
      return { ok: false, error: 'Un vrai build tourne : relance ce tuto quand la forge est libre.' };
    }
    clean(false); // un tuto a la fois : les traces du precedent partent
    run = { id, project: p, startedAt: Date.now(), timers: [], children: [], done: false };
    SCENES[id]();
    publish();
    clearTimeout(cleanTimer);
    cleanTimer = setTimeout(() => clean(), AUTO_CLEAN_MS);
    if (cleanTimer.unref) cleanTimer.unref();
    return { ok: true, project: p.name };
  }

  // « J'ai vu » : l'agent qui attendait repart et finit.
  function answer() {
    const a = state.agents[`${PREFIX}question`];
    if (!a || !run || run.id !== 'question') return false;
    ev(a.sessionId, 'Stop', { last_assistant_message: 'Tuto : merci, tu as vu la question. Rien n\'a été lancé.' });
    finish();
    return true;
  }

  function stop() {
    if (!run) return;
    for (const t of run.timers) clearTimeout(t);
    for (const c of run.children) { try { c.kill(); } catch { /* deja fini */ } }
    run.done = true;
  }

  // Efface toutes les traces des tutos : agents, builds, file, verrou, personnages crees pour eux.
  function clean(tell = true) {
    stop();
    run = null;
    for (const id of Object.keys(state.agents)) if (isTuto(id)) delete state.agents[id];
    state.builds = state.builds.filter(b => !isTuto(b.sessionId));
    state.queue = state.queue.filter(e => !isTuto(e.sessionId));
    if (state.lock && isTuto(state.lock.sessionId)) { state.lock = null; state.promote(); }
    for (const [id, c] of Object.entries(state.characters)) if (c.tuto) delete state.characters[id];
    if (tell) publish();
    return true;
  }

  state.tuto = info();
  return { info, start, answer, clean, isTuto };
}

module.exports = { create, isTuto, LIST, PREFIX };
