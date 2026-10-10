'use strict';
// Lance le serveur MCP Chrome DevTools (paquet chrome-devtools-mcp, via npx) pour que Claude voie
// la page de la tour : captures, console, reseau, clics. Declare dans .mcp.json a la racine.
//   node scripts/chrome-devtools-mcp.js
// Un seul .mcp.json sert le PC Windows d'ali et les sessions cloud (Linux) :
//   - Windows : Chrome installe (sinon Edge), fenetre visible, profil dedie a l'outil ;
//   - cloud   : le Chromium de Playwright (/opt/pw-browsers), sans fenetre, profil jetable.
// CHROME_DEVTOOLS_EXECUTABLE force un navigateur. Le serveur MCP parle sur stdout : ce script
// n'y ecrit rien lui-meme.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PACKAGE = 'chrome-devtools-mcp@1.10.1';

function exists(f) {
  try { return fs.statSync(f).isFile(); } catch { return false; }
}

// Navigateur a utiliser : { exe, headless } ; exe null = Chrome stable trouve par l'outil.
function pickBrowser(env = process.env, platform = process.platform, has = exists) {
  if (env.CHROME_DEVTOOLS_EXECUTABLE) return { exe: env.CHROME_DEVTOOLS_EXECUTABLE, headless: false };
  if (platform === 'win32') {
    const dirs = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const d of dirs) if (has(path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))) return { exe: null, headless: false };
    for (const d of dirs) {
      const edge = path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
      if (has(edge)) return { exe: edge, headless: false };
    }
    return { exe: null, headless: false };
  }
  // Session cloud : pas d'ecran, Chromium de Playwright.
  const pw = path.join(env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', 'chromium');
  if (platform === 'linux' && has(pw)) return { exe: pw, headless: true };
  return { exe: null, headless: !env.DISPLAY && platform === 'linux' };
}

function buildArgs(browser) {
  const args = ['-y', PACKAGE, '--usageStatistics=false', '--performanceCrux=false', '--viewport=1600x900'];
  if (browser.exe) args.push(`--executablePath=${browser.exe}`);
  if (browser.headless) args.push('--headless', '--isolated', '--chromeArg=--no-sandbox');
  return args;
}

// npx lance directement par node : evite le cmd /c qu'exige npx.cmd sous Windows.
function npxCommand(execPath = process.execPath, has = exists) {
  const dir = path.dirname(execPath);
  for (const cli of [path.join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')]) {
    if (has(cli)) return { cmd: execPath, pre: [cli], shell: false };
  }
  return { cmd: 'npx', pre: [], shell: process.platform === 'win32' };
}

if (require.main === module) {
  const npx = npxCommand();
  const child = spawn(npx.cmd, [...npx.pre, ...buildArgs(pickBrowser())], { stdio: 'inherit', shell: npx.shell });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('error', (e) => { process.stderr.write(`[chrome-devtools-mcp] ${e.message}\n`); process.exit(1); });
  child.on('exit', (code) => process.exit(code ?? 0));
}

module.exports = { PACKAGE, pickBrowser, buildArgs, npxCommand };
