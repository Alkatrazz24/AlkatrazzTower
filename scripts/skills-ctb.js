#!/usr/bin/env node
'use strict';
// Installe dans un projet Unreal les skills des sessions du projet Alkatrazz Tower, et ceux de ponytail
// (sans ses hooks), dans <projet>/.claude/skills/. Liste et sources : lib/skills-ctb.js.
//
//   node scripts/skills-ctb.js "<dossier du projet>"                 montre ce qui serait installe, ne touche a rien
//   node scripts/skills-ctb.js "<dossier du projet>" --apply         l'installe
//   --only a,b         seulement ces skills
//   --ponytail-auto    laisse ponytail se declencher tout seul sur chaque tache de code (par defaut : /ponytail)
//
// Rien n'est ecrase : un skill deja dans le projet, ou qu'une session du projet a deja (perso, compte claude.ai,
// plugin active), est laisse tel quel. Rien n'est commite. Sorties en ASCII (console PowerShell).

const fs = require('fs');
const path = require('path');
const lib = require('../lib/skills-ctb');

const ascii = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
const say = (s = '') => console.log(ascii(s));

async function main(argv) {
  const args = argv.filter(a => !a.startsWith('--'));
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const root = args.find(a => a !== opt('--only'));
  if (!root || !fs.existsSync(root) || !fs.readdirSync(root).some(f => f.toLowerCase().endsWith('.uproject'))) {
    say('Usage : node scripts/skills-ctb.js "<dossier du projet Unreal>" [--apply] [--only a,b] [--ponytail-auto]');
    return 2;
  }
  const only = opt('--only') ? opt('--only').split(',').map(s => s.trim()).filter(Boolean) : null;
  const auto = argv.includes('--ponytail-auto');
  const p = lib.plan({ root: path.resolve(root), only });
  const by = (st) => p.items.filter(i => i.status === st);
  say(`Projet : ${p.root}`);
  say('');
  say(`A installer dans .claude/skills (${by('install').length}) :`);
  let group = '';
  for (const it of by('install')) {
    if (it.group !== group) { group = it.group; say(`  ${group}`); }
    say(`    ${it.name}${it.manual ? (auto ? '  (se declenche tout seul)' : '  (a la main : /ponytail)') : ''}  <- ${it.source}`);
  }
  if (by('present').length) say(`Deja dans le projet : ${by('present').map(i => i.name).join(', ')}`);
  if (by('available').length) { say('Deja disponibles pour ses sessions, non copies :'); for (const it of by('available')) say(`  ${it.name} : ${it.where}`); }
  say('');
  say('Non installes :');
  for (const s of p.skipped) say(`  ${s.names.join(', ')} : ${s.why}`);
  say('');
  if (!argv.includes('--apply')) { say('Rien n\'a ete ecrit. Relance avec --apply pour installer.'); return 0; }
  const res = await lib.apply(p, { auto });
  const ok = res.filter(r => r.ok), ko = res.filter(r => !r.ok);
  say(`Installes : ${ok.length}${ok.length ? ` (${ok.map(r => r.name).join(', ')})` : ''}`);
  for (const r of ko) say(`ECHEC ${r.name} : ${r.error}`);
  say('Rien n\'est commite dans le git du projet.');
  return ko.length ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code), (e) => { console.error(ascii(e.message)); process.exit(1); });
module.exports = { main };
