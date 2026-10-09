#!/usr/bin/env node
'use strict';
// Copie le plugin Unreal AlkatrazzTower dans un projet : <projet>/Plugins/AlkatrazzTower.
//
//   node scripts/install-plugin.js "C:\...\MonJeu.uproject"      (ou le dossier du projet)
//   node scripts/install-plugin.js "C:\...\MonJeu" --remove       retire le plugin du projet
//
// Ne compile rien : le plugin se compile avec la cible Editeur du projet (Build.bat ...Editor),
// editeur ferme, ou a la prochaine ouverture du projet (Unreal propose de le compiler).

const fs = require('fs');
const path = require('path');
const { resolve } = require('../lib/projects');

const SRC = path.resolve(__dirname, '..', 'unreal', 'AlkatrazzTower');
const SKIP = new Set(['Binaries', 'Intermediate']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function main() {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));
  const project = resolve(target);
  if (!project) {
    console.error('Donne le chemin du .uproject (ou de son dossier).');
    process.exit(1);
  }
  const dest = path.join(project.root, 'Plugins', 'AlkatrazzTower');
  if (args.includes('--remove')) {
    if (fs.existsSync(dest)) { fs.rmSync(dest, { recursive: true, force: true }); console.log(`Plugin retire de ${project.name}.`); }
    else console.log(`Le plugin n'est pas dans ${project.name}.`);
    return;
  }
  // On remplace les sources, on garde Binaries/Intermediate deja compiles s'ils existent.
  for (const name of ['Source', 'Resources', 'Config', 'AlkatrazzTower.uplugin']) {
    const p = path.join(dest, name);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  copyDir(SRC, dest);
  console.log(`Plugin copie dans ${dest}`);
  console.log(`Projet ${project.name} (UE ${project.engine || '?'}).`);
  console.log('Pour le compiler : ferme l\'editeur, puis compile la cible Editeur du projet');
  console.log(`  (Build.bat ${project.name}Editor Win64 Development -project="${project.uproject}" -waitmutex),`);
  console.log('ou ouvre le projet : Unreal propose de compiler le nouveau module.');
}

main();
