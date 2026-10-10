#!/usr/bin/env node
'use strict';
// Branche (ou debranche) les hooks de la tour dans un settings.json de Claude Code.
//
//   node scripts/install-hooks.js               montre ce qui serait ajoute, ne touche a rien
//   node scripts/install-hooks.js --apply       ajoute les hooks (copie de sauvegarde avant)
//   node scripts/install-hooks.js --remove      retire les hooks de la tour
//   --settings <fichier>                        autre fichier que ~/.claude/settings.json
//
// Les autres hooks et reglages du fichier ne sont jamais modifies.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'tower-hook.js').replace(/\\/g, '/');
const ASK = path.join(ROOT, 'hooks', 'tower-ask.js').replace(/\\/g, '/');
const TAGS = ['tower-hook.js', 'tower-ask.js'];

function towerHooks() {
  const cmd = `node "${HOOK}"`;
  const sync = { type: 'command', command: cmd, timeout: 5 };
  const bg = { type: 'command', command: cmd, timeout: 5, async: true };
  // Questions et permissions : le hook attend la reponse d'ali dans la tour (10 min au plus), puis
  // laisse la question s'afficher dans la fenetre. Le delai du hook couvre cette attente.
  const ask = { type: 'command', command: `node "${ASK}"`, timeout: 660 };
  return {
    // Synchrones : PreToolUse sur Bash/PowerShell (il emballe les builds) et SessionStart (il donne
    // a l'agent la consigne de lire la doc Unreal). Tout le reste part en arriere-plan.
    PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [sync] }, { matcher: 'AskUserQuestion', hooks: [ask] }],
    PermissionRequest: [{ matcher: '*', hooks: [ask] }],
    PostToolUse: [{ matcher: '*', hooks: [bg] }],
    PostToolUseFailure: [{ matcher: '*', hooks: [bg] }],
    SessionStart: [{ hooks: [sync] }],
    UserPromptSubmit: [{ hooks: [bg] }],
    Notification: [{ hooks: [bg] }],
    Stop: [{ hooks: [bg] }],
    SubagentStart: [{ hooks: [bg] }],
    SubagentStop: [{ hooks: [bg] }],
    SessionEnd: [{ hooks: [bg] }],
  };
}

function isTower(h) { return h && typeof h.command === 'string' && TAGS.some(t => h.command.includes(t)); }

// Retire nos hooks sans toucher aux autres ; supprime les groupes et evenements devenus vides.
function strip(hooks) {
  const out = {};
  for (const [ev, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) { out[ev] = groups; continue; }
    const kept = groups
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isTower(h)) }))
      .filter(g => g.hooks.length);
    if (kept.length) out[ev] = kept;
  }
  return out;
}

function merge(settings) {
  const hooks = strip(settings.hooks);
  for (const [ev, groups] of Object.entries(towerHooks())) hooks[ev] = [...(hooks[ev] || []), ...groups];
  return { ...settings, hooks };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const remove = args.includes('--remove');
  const i = args.indexOf('--settings');
  const file = i >= 0 ? path.resolve(args[i + 1]) : path.join(os.homedir(), '.claude', 'settings.json');

  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error(`Lecture impossible de ${file} : ${e.message}`); process.exit(1); }
  }

  let next;
  if (remove) {
    next = { ...settings, hooks: strip(settings.hooks) };
    if (!Object.keys(next.hooks).length) delete next.hooks;
  } else {
    next = merge(settings);
  }

  if (!apply && !remove) {
    console.log(`Fichier : ${file}\nHooks que la tour ajouterait (rien n'a ete modifie) :\n`);
    console.log(JSON.stringify({ hooks: towerHooks() }, null, 2));
    console.log('\nRelance avec --apply pour les ajouter.');
    return;
  }

  if (fs.existsSync(file)) {
    const backup = `${file}.bak-tower-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
    console.log(`Sauvegarde : ${backup}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log(remove ? `Hooks de la tour retires de ${file}` : `Hooks de la tour ajoutes a ${file}`);
}

if (require.main === module) main();

module.exports = { towerHooks, strip, merge };
