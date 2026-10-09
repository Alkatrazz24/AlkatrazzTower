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
const defs = [...list.matchAll(/\{ id: '([a-z0-9-]+)'(?:, engine: '([a-z0-9-]+)')?/g)].map(m => ({ id: m[1], engine: m[2] }));
const ids = defs.map(d => d.id);
const engines = [...new Set(defs.map(d => d.engine).filter(Boolean))];

test('cinq templates, chacun avec son JS et son CSS', () => {
  assert.strictEqual(ids.length, 5);
  const def = list.match(/TOWER_DEFAULT = '([a-z0-9-]+)'/)[1];
  assert.ok(ids.includes(def), `template par defaut inconnu : ${def}`);
  for (const { id, engine } of defs) {
    const js = fs.readFileSync(path.join(WEB, 'templates', `${id}.js`), 'utf8');
    assert.ok(fs.existsSync(path.join(WEB, 'templates', `${id}.css`)), `${id}.css manquant`);
    if (engine) {
      assert.match(js, new RegExp(`mode\\(\\{\\s*id: '${id}'`), `${id}.js doit demarrer le moteur sous son id`);
    } else {
      assert.match(js, new RegExp(`register\\(\\{ id: '${id}'`), `${id}.js doit se declarer sous son id`);
      assert.match(js, /T\.switcher\(\)/, `${id}.js doit proposer le choix du template`);
    }
  }
  for (const e of engines) {
    const js = fs.readFileSync(path.join(WEB, e, 'moteur.js'), 'utf8');
    assert.ok(fs.existsSync(path.join(WEB, e, 'hud.css')), `${e}/hud.css manquant`);
    assert.match(js, /T\.register\(/, `${e}/moteur.js doit declarer le template`);
    assert.match(js, /T\.switcher\(/, `${e}/moteur.js doit proposer le choix du template`);
    // chaque ambiance proposee a son monde (decor) en JS et en CSS
    const worlds = [...js.match(/const WORLDS = \[(.*)\];/)[1].matchAll(/\['([a-z]+)'/g)].map(m => m[1]);
    assert.ok(worlds.length >= 1);
    for (const w of worlds) {
      assert.ok(fs.existsSync(path.join(WEB, e, 'mondes', `${w}.css`)), `${e}/mondes/${w}.css manquant`);
      const wjs = path.join(WEB, e, 'mondes', `${w}.js`);
      assert.match(fs.readFileSync(wjs, 'utf8'), new RegExp(`world\\(\\{\\s*id: '${w}'`), `${w}.js doit se declarer sous son id`);
      execFileSync(process.execPath, ['--check', wjs]);
    }
  }
});

test('les scripts de la page sont du JavaScript valide', () => {
  const files = ['core.js', path.join('templates', 'list.js'), 'avatar.js', 'map.js', ...engines.map(e => path.join(e, 'moteur.js')), ...ids.map(id => path.join('templates', `${id}.js`))];
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
