'use strict';
// La page web : chaque template annonce par web/templates/list.js existe, se declare sous son id, et la demo
// a bien la forme de l'etat que sert le serveur.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { TowerState } = require('../server/state');

const WEB = path.join(__dirname, '..', 'web');
const list = fs.readFileSync(path.join(WEB, 'templates', 'list.js'), 'utf8');
const ids = [...list.matchAll(/id: '([a-z0-9-]+)'/g)].map(m => m[1]);

test('cinq templates, chacun avec son JS et son CSS', () => {
  assert.strictEqual(ids.length, 5);
  const def = list.match(/TOWER_DEFAULT = '([a-z0-9-]+)'/)[1];
  assert.ok(ids.includes(def), `template par defaut inconnu : ${def}`);
  for (const id of ids) {
    const js = fs.readFileSync(path.join(WEB, 'templates', `${id}.js`), 'utf8');
    assert.ok(fs.existsSync(path.join(WEB, 'templates', `${id}.css`)), `${id}.css manquant`);
    assert.match(js, new RegExp(`register\\(\\{ id: '${id}'`), `${id}.js doit se declarer sous son id`);
    assert.match(js, /T\.switcher\(\)/, `${id}.js doit proposer le choix du template`);
  }
});

test('les scripts de la page sont du JavaScript valide', () => {
  const files = ['core.js', path.join('templates', 'list.js'), 'avatar.js', 'map.js', ...ids.map(id => path.join('templates', `${id}.js`))];
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
