'use strict';
// La page web : l'application « Conversations » est la seule interface, ses scripts sont valides, et la demo
// a bien la forme de l'etat que sert le serveur.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { TowerState } = require('../server/state');

const WEB = path.join(__dirname, '..', 'web');
const list = fs.readFileSync(path.join(WEB, 'templates', 'list.js'), 'utf8');
const defs = [...list.matchAll(/\{ id: '([a-z0-9-]+)'(?:, engine: '([a-z0-9-]+)')?/g)].map(m => ({ id: m[1], engine: m[2] }));
const ids = defs.map(d => d.id);
const engines = [...new Set(defs.map(d => d.engine).filter(Boolean))];

test('une seule interface : l application Conversations, son moteur et ses fiches', () => {
  assert.deepStrictEqual(ids, ['conversations']);
  assert.strictEqual(list.match(/TOWER_DEFAULT = '([a-z0-9-]+)'/)[1], 'conversations');
  assert.deepStrictEqual(engines, ['appli']);
  assert.match(fs.readFileSync(path.join(WEB, 'templates', 'conversations.js'), 'utf8'), /mode\(\{\s*id: 'conversations'/);
  assert.ok(fs.existsSync(path.join(WEB, 'templates', 'conversations.css')));
  for (const f of ['moteur.js', 'fiches.js', 'hud.css']) assert.ok(fs.existsSync(path.join(WEB, 'appli', f)), `appli/${f} manquant`);
  const js = fs.readFileSync(path.join(WEB, 'appli', 'moteur.js'), 'utf8');
  assert.match(js, /T\.register\(/);
  assert.match(js, /appli\/fiches\.js/);
  // chaque zone se regle : un separateur par zone, accessible au clavier, et des tailles gardees
  assert.match(js, /\['side', 'rail', 'sheet', 'board'\]\.map\(grip\)/);
  assert.match(js, /role: 'separator'/);
  assert.match(js, /store\.set\('appli\.zones'/);
  // l'ancienne interface en jeu est retiree : plus rien ne la charge ni n'y renvoie
  for (const gone of ['usine', 'galerie.html', 'classique.html', 'avatar.js', 'map.js']) assert.ok(!fs.existsSync(path.join(WEB, gone)), `${gone} devrait etre retire`);
  const page = ['index.html', 'core.js', path.join('appli', 'moteur.js'), path.join('appli', 'fiches.js')].map(f => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
  assert.doesNotMatch(page, /T\.choose\(|avatar\.js|map\.js|usine\//);
});

test('les scripts de la page sont du JavaScript valide', () => {
  const files = ['core.js', path.join('templates', 'list.js'), ...engines.map(e => path.join(e, 'moteur.js')), path.join('appli', 'fiches.js'), ...ids.map(id => path.join('templates', `${id}.js`))];
  for (const f of files) execFileSync(process.execPath, ['--check', path.join(WEB, f)]);
});

test('la demo a la forme de l etat du serveur', () => {
  const demo = JSON.parse(fs.readFileSync(path.join(WEB, 'demo', 'state.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(demo).sort(), Object.keys(new TowerState().snapshot()).sort());
  assert.ok(demo.agents.length >= 5 && demo.lock && demo.queue.length && demo.campaigns.length);
});

test('les polices citees par fonts.css sont livrees', () => {
  const css = fs.readFileSync(path.join(WEB, 'fonts.css'), 'utf8');
  for (const [, f] of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(WEB, f)), `${f} manquant`);
});
