#!/usr/bin/env node
'use strict';
// Installation d'Alkatrazz Tower sur un PC, en une commande : setup.cmd (ou node scripts/setup.js).
//
//   --yes        accepte les choix par defaut sans poser de question
//   --no-start   ne lance pas la tour a la fin
//
// Etapes : verifier Node, brancher les hooks Claude Code, installer les skills, (option) lancer la tour
// au demarrage de Windows, puis lancer la tour et ouvrir la page pour connecter un projet Unreal.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, execFile } = require('child_process');
const { merge } = require('./install-hooks');

const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const SKILLS_DIR = path.join(HOME, '.claude', 'skills');
const STARTUP = process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null;
const STARTUP_FILE = STARTUP ? path.join(STARTUP, 'Alkatrazz Tower.vbs') : null;
const PORT = Number(process.env.TOWER_PORT) || 4777;

const args = process.argv.slice(2);
const YES = args.includes('--yes');
const say = (m = '') => console.log(m);

async function ask(question, def) {
  if (YES || !process.stdin.isTTY) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = def ? '[O/n]' : '[o/N]';
  const a = await new Promise(r => rl.question(`${question} ${hint} `, r));
  rl.close();
  const v = a.trim().toLowerCase();
  return v ? v.startsWith('o') || v.startsWith('y') : def;
}

function installHooks() {
  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    const backup = `${SETTINGS}.bak-tower-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(SETTINGS, backup);
    say(`   sauvegarde : ${backup}`);
  } else {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(merge(settings), null, 2) + '\n');
  say(`   hooks ajoutes a ${SETTINGS}`);
}

// Copie un dossier de skill. Les skills Unreal deja presents sont gardes ; celui de la tour est mis a jour.
function copySkill(src, name, overwrite) {
  const dst = path.join(SKILLS_DIR, name);
  if (fs.existsSync(dst) && !overwrite) return false;
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  return true;
}

function installSkills() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const ue = path.join(ROOT, 'vendor', 'unreal-engine-skills', 'skills');
  let added = 0, kept = 0;
  for (const name of fs.readdirSync(ue)) {
    if (copySkill(path.join(ue, name), name, false)) added++; else kept++;
  }
  for (const name of fs.readdirSync(path.join(ROOT, 'skills'))) copySkill(path.join(ROOT, 'skills', name), name, true);
  say(`   ${added} skills Unreal ajoutes${kept ? `, ${kept} deja presents gardes` : ''}, skill des personnages a jour`);
}

function installStartup() {
  const vbs = [
    "' Lance Alkatrazz Tower sans fenetre au demarrage de Windows (cree par setup.cmd).",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run """${process.execPath}"" ""${path.join(ROOT, 'server', 'server.js')}""", 0, False`,
    '',
  ].join('\r\n');
  fs.writeFileSync(STARTUP_FILE, vbs);
  say(`   ${STARTUP_FILE}`);
}

function towerUp() {
  return new Promise((resolve) => {
    const req = require('http').get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 800 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  say('Alkatrazz Tower : installation');
  say('');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) { say(`Node ${process.versions.node} est trop ancien : installe Node 20 ou plus (https://nodejs.org).`); process.exit(1); }
  say(`1. Node ${process.versions.node} : ok`);

  if (await ask('2. Brancher la tour sur Claude Code (hooks dans ~/.claude/settings.json, avec sauvegarde) ?', true)) installHooks();
  else say('   passe : relance plus tard avec node scripts\\install-hooks.js --apply');

  if (await ask('3. Installer les 31 skills Unreal et le skill des personnages dans ~/.claude/skills ?', true)) installSkills();
  else say('   passe');

  if (STARTUP_FILE) {
    if (await ask('4. Lancer la tour automatiquement au demarrage de Windows ?', false)) installStartup();
    else say('   passe : lance-la avec start-tower.cmd quand tu en as besoin');
  }

  if (args.includes('--no-start')) { say('\nTermine.'); return; }
  if (!(await towerUp())) {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    for (let i = 0; i < 20 && !(await towerUp()); i++) await new Promise(r => setTimeout(r, 250));
  }
  const url = `http://127.0.0.1:${PORT}`;
  say(`\n5. La tour tourne sur ${url}`);
  say('   Sur la page, clique sur « Connecter un projet Unreal » pour choisir ton projet.');
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  say('\nPour tout retirer : uninstall.cmd');
}

main().catch((e) => { say(`Erreur : ${e.message}`); process.exit(1); });
