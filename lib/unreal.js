'use strict';
// Ce que la tour sait d'un projet Unreal : version du moteur, dossier du moteur, et la consigne
// "doc d'abord" injectee aux agents au debut de chaque session.

const fs = require('fs');
const path = require('path');

const LAUNCHER_DAT = 'C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat';

function engineVersion(uproject) {
  try {
    const j = JSON.parse(fs.readFileSync(uproject, 'utf8'));
    return typeof j.EngineAssociation === 'string' ? j.EngineAssociation : null;
  } catch { return null; }
}

// Dossier du moteur pour une version installee par le launcher Epic.
function engineDir(version) {
  if (!version) return null;
  try {
    const dat = JSON.parse(fs.readFileSync(LAUNCHER_DAT, 'utf8'));
    const hit = (dat.InstallationList || []).find(i => i.AppName === `UE_${version}`);
    if (hit && fs.existsSync(hit.InstallLocation)) return hit.InstallLocation;
  } catch { /* pas de launcher */ }
  const guess = `C:\\Program Files\\Epic Games\\UE_${version}`;
  return fs.existsSync(guess) ? guess : null;
}

// Pages de la doc officielle les plus utiles a un agent. `v` = version du moteur (ex. "5.8").
// Adresses verifiees le 2026-10-09 ; ?application_version=X epingle la version.
function docLinks(v) {
  const q = v ? `?application_version=${v}` : '';
  const base = 'https://dev.epicgames.com/documentation/en-us/unreal-engine';
  const home = v ? `unreal-engine-${v.replace('.', '-')}-documentation` : '';
  return [
    ['Accueil de la doc', `${base}/${home}${q}`],
    ['Reference API C++', `${base}/API${q}`],
    ['Standard de code Epic', `${base}/epic-cplusplus-coding-standard-for-unreal-engine${q}`],
    ['Gameplay Framework', `${base}/gameplay-framework-in-unreal-engine${q}`],
    ['Reflexion, UPROPERTY, UFUNCTION', `${base}/reflection-system-in-unreal-engine${q}`],
    ['Specificateurs de metadonnees', `${base}/metadata-specifiers-in-unreal-engine${q}`],
    ['Modules et Build.cs', `${base}/module-properties-in-unreal-engine${q}`],
    ['Unreal Build Tool', `${base}/unreal-build-tool-in-unreal-engine${q}`],
    ['Ecrire des tests C++', `${base}/write-cplusplus-tests-in-unreal-engine${q}`],
    ['Lancer les tests en ligne de commande', `${base}/run-automation-tests-in-unreal-engine${q}`],
    ['Live Coding', `${base}/using-live-coding-to-recompile-unreal-engine-applications-at-runtime${q}`],
    ['Cook, package, BuildCookRun', `${base}/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine${q}`],
    ['Enhanced Input', `${base}/enhanced-input-in-unreal-engine${q}`],
    ['Gameplay Ability System', `${base}/gameplay-ability-system-for-unreal-engine${q}`],
    ['Blueprints et C++', `${base}/exposing-gameplay-elements-to-blueprints-visual-scripting-in-unreal-engine${q}`],
    ['Logs', `${base}/logging-in-unreal-engine${q}`],
    ['Nommage des assets', `${base}/recommended-asset-naming-conventions-in-unreal-engine-projects${q}`],
  ];
}

// Texte ajoute au contexte de l'agent au debut de chaque session sur un projet Unreal : la doc
// obligatoire, et quand lire la doc Unreal (mode reglé dans la tour : 'question' ou 'modif', lib/docs.js).
function docsContext(project, { mode = 'question' } = {}) {
  const v = engineVersion(project.uproject);
  const dir = engineDir(v);
  const lines = [
    `[Alkatrazz Tower] Projet Unreal Engine ${v || '5'} detecte : ${project.name} (${project.root}).`,
    '',
    require('./docs').rules(project, { mode }),
    '',
    'Documentation officielle Unreal (WebFetch), les pages les plus utiles :',
    ...docLinks(v).map(([t, u]) => `- ${t} : ${u}`),
  ];
  if (dir) {
    lines.push('',
      `Signatures exactes : les en-tetes du moteur installe font foi, cherche-les avec Grep dans`,
      `  ${path.join(dir, 'Engine', 'Source')}`,
      `  (Runtime/Engine/Classes pour les classes de gameplay, Runtime/Core et Runtime/CoreUObject pour les bases),`,
      `  et dans ${path.join(dir, 'Engine', 'Plugins')} pour GAS, Enhanced Input, CommonUI...`,
      `  Seuls les en-tetes sont installes : pas les .cpp prives du moteur.`);
  }
  if (fs.existsSync(path.join(require('os').homedir(), '.claude', 'skills', 'ue-cpp-foundations'))) {
    lines.push('',
      'Skills Unreal installes (ue-*) : charge celui du domaine avant de coder (ue-cpp-foundations,',
      'ue-gameplay-framework, ue-gameplay-abilities, ue-input-system, ue-module-build-system, ue-testing-debugging,',
      'ue-networking-replication, ue-ui-umg-slate...). Ils completent la doc officielle, ils ne la remplacent pas.');
  }
  lines.push('', 'Les builds, tests et paquets Unreal passent par le verrou de la tour : un seul a la fois sur le PC.');
  return lines.join('\n');
}

// Un appel d'outil qui consulte la doc Unreal ou les sources du moteur ?
function docRead(toolName, input) {
  if (!input || typeof input !== 'object') return null;
  const url = String(input.url || '');
  if (/dev\.epicgames\.com\/documentation|docs\.unrealengine\.com|dev\.epicgames\.com\/community\/api-documentation/i.test(url)) {
    return { kind: 'doc', what: (url.split('?')[0].split('/').filter(Boolean).pop() || 'doc').slice(0, 80) };
  }
  const p = String(input.file_path || input.path || '');
  if (/Epic Games[\\/]UE_[\d.]+[\\/]Engine[\\/](Source|Plugins)/i.test(p) || /[\\/]Engine[\\/]Source[\\/](Runtime|Editor|Developer)/i.test(p)) {
    return { kind: 'source', what: p.split(/[\\/]/).slice(-2).join('/') };
  }
  const cmd = String(input.command || '');
  if (/Epic Games[\\/]UE_[\d.]+[\\/]Engine[\\/]Source/i.test(cmd) && /(grep|rg|Select-String|findstr|Get-Content|cat)\b/i.test(cmd)) {
    return { kind: 'source', what: 'recherche dans Engine/Source' };
  }
  return null;
}

module.exports = { engineVersion, engineDir, docLinks, docsContext, docRead };
