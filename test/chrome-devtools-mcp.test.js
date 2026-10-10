'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PACKAGE, pickBrowser, buildArgs, npxCommand } = require('../scripts/chrome-devtools-mcp');

const only = (...files) => (f) => files.includes(f);

test('.mcp.json declare le serveur chrome-devtools via le lanceur', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.mcp.json'), 'utf8'));
  assert.deepStrictEqual(cfg.mcpServers['chrome-devtools'], { command: 'node', args: ['scripts/chrome-devtools-mcp.js'] });
});

test('Windows : Chrome installe, fenetre visible', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files' };
  const b = pickBrowser(env, 'win32', only(path.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')));
  assert.deepStrictEqual(b, { exe: null, headless: false });
  assert.ok(!buildArgs(b).includes('--headless'));
});

test('Windows sans Chrome : Edge', () => {
  const edge = path.join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const b = pickBrowser({ 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' }, 'win32', only(edge));
  assert.deepStrictEqual(b, { exe: edge, headless: false });
  assert.ok(buildArgs(b).includes(`--executablePath=${edge}`));
});

test('cloud : Chromium de Playwright sans fenetre, profil jetable', () => {
  // Sous Windows, path.join met des barres inverses : le chemin attendu est construit de la meme facon.
  const pw = path.join('/opt/pw-browsers', 'chromium');
  const b = pickBrowser({ PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' }, 'linux', only(pw));
  const args = buildArgs(b);
  assert.strictEqual(args[1], PACKAGE);
  for (const a of ['--headless', '--isolated', '--usageStatistics=false', `--executablePath=${pw}`]) assert.ok(args.includes(a), a);
});

test('CHROME_DEVTOOLS_EXECUTABLE force le navigateur', () => {
  assert.deepStrictEqual(pickBrowser({ CHROME_DEVTOOLS_EXECUTABLE: '/x/chrome' }, 'linux', () => true), { exe: '/x/chrome', headless: false });
});

test('npx lance par node quand npx-cli.js est a cote', () => {
  const exe = path.join('/n', 'node');
  const cli = path.join('/n', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  assert.deepStrictEqual(npxCommand(exe, only(cli)), { cmd: exe, pre: [cli], shell: false });
});
