#!/usr/bin/env node
'use strict';
// Retire Alkatrazz Tower de ce PC : hooks, lancement au demarrage et skill des personnages.
// Les skills Unreal (ue-*) restent : ils servent aussi sans la tour. Le dossier du depot n'est pas touche.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { strip } = require('./install-hooks');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
if (fs.existsSync(SETTINGS)) {
  const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-tower-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const next = { ...s, hooks: strip(s.hooks) };
  if (!Object.keys(next.hooks).length) delete next.hooks;
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + '\n');
  console.log('Hooks de la tour retires.');
}
if (process.env.APPDATA) {
  const f = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Alkatrazz Tower.vbs');
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('Lancement au demarrage retire.'); }
}
const skill = path.join(os.homedir(), '.claude', 'skills', 'alkatrazz-tower-personnages');
if (fs.existsSync(skill)) { fs.rmSync(skill, { recursive: true, force: true }); console.log('Skill des personnages retire.'); }
console.log('Les skills Unreal ue-* sont gardes. Arrete la tour en fermant sa fenetre (ou son processus node).');
