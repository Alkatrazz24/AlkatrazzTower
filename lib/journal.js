'use strict';
// Journal du serveur : ce que la tour ecrit dans la console part aussi dans <data>/server.log, avec
// l'heure. La tour est lancee sans console (demarrage de Windows, relance par une session), donc sans
// ce fichier un arret ne laisse aucune trace. Le journal garde aussi le demarrage, une erreur qui
// ferait tomber le serveur (avec sa pile) et la sortie du processus avec son code.
// Le fichier ne grossit pas sans fin : au-dela de MAX octets il devient server.log.1 (un seul ancien).

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX = 2 * 1024 * 1024;

function open(dir, { max = MAX } = {}) {
  const file = path.join(dir, 'server.log');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ecrit plus bas ou jamais */ }
  try { if (fs.statSync(file).size > max) fs.renameSync(file, file + '.1'); } catch { /* pas encore de journal */ }
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* nouveau */ }
  // ecriture synchrone : une ligne ecrite juste avant un plantage doit etre sur le disque
  const write = (level, text) => {
    const line = `${new Date().toISOString()} ${level} ${text}\n`;
    try {
      if (size > max) { fs.renameSync(file, file + '.1'); size = 0; }
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch { /* disque plein ou dossier verrouille : la tour continue sans journal */ }
  };
  return { file, write };
}

// Branche le journal sur la console et le processus. A appeler une fois, au lancement du serveur.
function install(dir, info = {}) {
  const j = open(dir);
  for (const [name, level] of [['log', 'info'], ['warn', 'WARN'], ['error', 'ERROR']]) {
    const orig = console[name].bind(console);
    console[name] = (...args) => { j.write(level, util.format(...args)); try { orig(...args); } catch { /* pas de console */ } };
  }
  j.write('info', `[tower] demarrage, pid ${process.pid}, node ${process.version}` + Object.entries(info).map(([k, v]) => `, ${k} ${v}`).join(''));
  process.on('uncaughtException', (e) => {
    j.write('ERROR', `[tower] erreur non rattrapee, la tour s'arrete : ${(e && e.stack) || e}`);
    process.exit(1);
  });
  process.on('exit', (code) => j.write('info', `[tower] arret, code ${code}`));
  return j;
}

module.exports = { open, install, MAX };
