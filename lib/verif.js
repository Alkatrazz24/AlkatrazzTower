'use strict';
// Verification de fin de tache : quand une tache qui a modifie le projet se termine (son bloc
// « ## Suivi » est arrive), la tour compile et lance la suite de tests elle-meme, sous son verrou,
// et met le verdict sur la tache. Une tache ne se dit plus finie sur des tests jamais lances.
//
// L'editeur ouvert n'est jamais gene, et la tour ne le ferme jamais : la cible Editeur ne se
// construit pas tant qu'il tourne (ses DLL sont chargees), et des tests lances contre l'ancienne DLL
// mentiraient. Editeur ouvert : la tour compile la cible Jeu (memes sources, rien a fermer) et garde
// le reste pour quand il sera ferme. Editeur ferme : cible Editeur, puis la suite de tests.
//
// Chaque etape passe par bin/tower-run.js, comme le build d'un agent : file d'attente, forge,
// historique. Sa session est « verif:<session de la tache> ».

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { findProject } = require('./detect');
const { engineVersion, engineDir } = require('./unreal');

const RUNNER = path.join(__dirname, '..', 'bin', 'tower-run.js');
const PREFIX = 'verif:';
const isVerif = (id) => String(id || '').startsWith(PREFIX);

// Les commandes d'un projet. Les scripts du projet passent avant ceux du moteur : tools\tests.ps1
// de CTB lit les vrais resultats dans le journal (le code de sortie d'UnrealEditor-Cmd ment).
function plan(project, { testGroups = {}, exists = fs.existsSync, engine } = {}) {
  const found = project && project.root ? findProject(project.root) : null;
  if (!found) return { error: 'Projet Unreal introuvable.' };
  const root = found.root, uproject = found.uproject, name = found.name;
  const eng = engine !== undefined ? engine : engineDir(engineVersion(uproject));
  const q = (s) => `"${s}"`;
  const win = (...p) => p.join('\\');
  const build = (target) => eng
    ? `& ${q(win(eng, 'Engine', 'Build', 'BatchFiles', 'Build.bat'))} ${target} Win64 Development ${q(`-project=${uproject}`)} -waitmutex`
    : null;
  let tests = null, filter = null;
  if (exists(path.join(root, 'tools', 'tests.ps1'))) {
    tests = `& ${q(win(root, 'tools', 'tests.ps1'))}`;
  } else if (eng) {
    // Sans script : le groupe de tests le plus vu sur ce projet (CTB, MonJeu...).
    const tops = {};
    for (const [k, n] of Object.entries(testGroups[name] || {})) { const top = k.split('.')[0]; tops[top] = (tops[top] || 0) + n; }
    filter = Object.keys(tops).sort((a, b) => tops[b] - tops[a])[0] || null;
    if (filter) {
      tests = `& ${q(win(eng, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe'))} ${q(uproject)} "-ExecCmds=Automation RunTests ${filter}; Quit"`
        + ` -unattended -nosplash -nullrhi -nopause -log ${q(`-abslog=${win(root, 'Saved', 'Logs', 'tour_verif.log')}`)}`;
    }
  }
  return { root, name, game: build(name), editor: build(`${name}Editor`), tests, filter };
}

// Les etapes d'une verification, selon que l'editeur est ouvert ou non.
function steps(p, editorOpen) {
  const out = [];
  if (editorOpen) out.push({ id: 'jeu', label: 'Compilation (cible Jeu)', state: 'todo' });
  out.push({ id: 'editeur', label: 'Compilation (cible Éditeur)', state: editorOpen ? 'waiting' : 'todo' });
  out.push({ id: 'tests', label: 'Suite de tests', state: !p.tests ? 'skipped' : editorOpen ? 'waiting' : 'todo', detail: p.tests ? '' : 'Aucune suite de tests connue pour ce projet.' });
  return out;
}

// Verdict d'ensemble a partir des etapes.
function overall(list) {
  if (list.some(s => s.state === 'fail')) return 'fail';
  if (list.some(s => s.state === 'running' || s.state === 'todo')) return 'running';
  if (list.some(s => s.state === 'waiting')) return 'waiting';
  if (list.some(s => s.state === 'error')) return 'error';
  return 'ok';
}

// Lance une commande par tower-run et rend son code de sortie.
function defaultRun(cmd, { cwd, session, kind }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, '--shell', process.platform === 'win32' ? 'powershell' : 'bash', '--session', session, '--kind', kind,
      '--b64', Buffer.from(cmd, 'utf8').toString('base64')], { cwd, stdio: 'ignore', windowsHide: true, env: { ...process.env, TOWER_SESSION: session } });
    child.on('error', () => resolve(127));
    child.on('close', (c) => resolve(c === null ? 1 : c));
  });
}

function create(state, { run = defaultRun, planFor = (a) => plan(a.project, { testGroups: state.testGroups }), editorOpen } = {}) {
  const busy = new Set(); // sessions dont une etape tourne
  const isOpen = (a) => editorOpen ? editorOpen(a) : !!(state.editor && state.editor.open) || !!(a.project && state.liveEditor(a.project.name));

  // Demarre (ou relance) la verification de la tache d'un agent.
  function start(sessionId, { auto = false } = {}) {
    const a = state.agents[sessionId];
    if (!a || !a.task) return { ok: false, error: 'Cet agent n\'a pas de tâche.' };
    if (!a.project) return { ok: false, error: 'Cette tâche ne tourne pas dans un projet Unreal.' };
    if (busy.has(sessionId)) return { ok: false, error: 'Une vérification tourne déjà pour cette tâche.' };
    const p = planFor(a);
    if (p.error || !p.editor) return { ok: false, error: p.error || 'Moteur Unreal introuvable : impossible de compiler.' };
    a.task.verif = { at: state.now(), auto, state: 'running', steps: steps(p, isOpen(a)), red: [...(state.redTests[a.project.name] || [])] };
    a.task.verif.state = overall(a.task.verif.steps);
    state.changed();
    next(sessionId);
    return { ok: true };
  }

  // Fait avancer une verification : l'etape suivante a faire, s'il y en a une.
  async function next(sessionId) {
    const a = state.agents[sessionId];
    const v = a && a.task && a.task.verif;
    if (!v || busy.has(sessionId)) return;
    const open = isOpen(a);
    // L'editeur s'est ferme : ce qui l'attendait part. Il s'est rouvert : ce qui n'a pas commence attend.
    for (const s of v.steps) {
      if (s.state === 'waiting' && !open) s.state = 'todo';
      else if (s.state === 'todo' && open && s.id !== 'jeu') s.state = 'waiting';
    }
    // La cible Jeu ne sert qu'editeur ouvert : s'il s'est ferme avant, la cible Editeur la remplace.
    const jeu = v.steps.find(s => s.id === 'jeu');
    if (jeu && jeu.state === 'todo' && !open) jeu.state = 'skipped';
    const step = v.steps.find(s => s.state === 'todo');
    v.state = overall(v.steps);
    if (!step) { if (v.state !== 'running') v.endedAt = v.endedAt || state.now(); state.changed(); return; }
    const p = planFor(a);
    const cmd = step.id === 'jeu' ? p.game : step.id === 'editeur' ? p.editor : p.tests;
    busy.add(sessionId);
    step.state = 'running';
    step.at = state.now();
    state.changed();
    const session = PREFIX + sessionId;
    let code;
    try { code = await run(cmd, { cwd: p.root, session, kind: step.id === 'tests' ? 'test' : 'build' }); } catch { code = 1; }
    busy.delete(sessionId);
    // Le resultat lu par tower-run est dans l'historique des builds.
    const b = state.builds.find(x => x.sessionId === session && x.endedAt >= step.at);
    step.endedAt = state.now();
    step.ok = b ? !!b.ok : code === 0;
    step.summary = b ? b.summary : code === 0 ? 'termine' : `code ${code}`;
    step.errorLines = b ? (b.errorLines || []).slice(0, 3) : [];
    if (b && b.tests) {
      const failed = b.tests.failedPaths || [];
      const known = new Set(v.red);
      step.tests = { total: b.tests.total, failed: b.tests.failed, passed: b.tests.passed };
      step.newFailures = failed.filter(x => !known.has(x)).slice(0, 10);
      step.oldFailures = failed.filter(x => known.has(x)).slice(0, 10);
      if (!failed.length && b.tests.failedNames) step.newFailures = b.tests.failedNames.slice(0, 10);
      // Rouge seulement de tests deja rouges avant la tache : la tache n'a rien casse.
      if (!step.ok && b.tests.failed > 0 && failed.length === b.tests.failed && !step.newFailures.length) step.ok = true;
    }
    step.state = step.ok ? 'ok' : 'fail';
    if (!step.ok) for (const s of v.steps) if (s.state === 'todo' || s.state === 'waiting') s.state = 'skipped';
    next(sessionId);
  }

  // Une tache vient de se terminer avec son bloc « Suivi » : on verifie si elle a touche au projet.
  state.onTaskDone = (a) => {
    if (!a || !a.task || !(a.task.counts && a.task.counts.edits > 0)) return;
    const def = state.taskList().find(t => t.id === a.task.id);
    if (def && def.readonly) return;
    const v = a.task.verif;
    if (v && (v.state === 'running' && busy.has(a.sessionId))) return;
    start(a.sessionId, { auto: true });
  };

  // L'editeur s'est ferme : les verifications qui l'attendaient reprennent.
  let soon = false;
  state.onChange(() => {
    if (soon) return;
    const ready = Object.values(state.agents).some(a => a.task && a.task.verif && a.task.verif.state === 'waiting' && !busy.has(a.sessionId) && !isOpen(a));
    if (!ready) return;
    soon = true;
    setImmediate(() => {
      soon = false;
      for (const a of Object.values(state.agents)) {
        const v = a.task && a.task.verif;
        if (v && v.state === 'waiting' && !busy.has(a.sessionId) && !isOpen(a)) next(a.sessionId);
      }
    });
  });

  // Au demarrage : une etape coupee par l'arret de la tour est relancee.
  for (const a of Object.values(state.agents)) {
    const v = a.task && a.task.verif;
    if (!v) continue;
    for (const s of v.steps || []) if (s.state === 'running') s.state = 'todo';
    if (v.state === 'running' || v.state === 'waiting') setImmediate(() => next(a.sessionId));
  }

  return { start, next, busy };
}

module.exports = { create, plan, steps, overall, isVerif, PREFIX };
