'use strict';
// L'equipe d'un projet : les agents definis dans <projet>/.claude/agents/*.md, chacun range dans sa
// section (animation, assets, interface, menus...). Lecture seule, aucun fichier du projet n'est ecrit.
//
// La section vient du champ « section: » de l'en-tete de l'agent ; sans lui, on la devine d'apres son nom.

const fs = require('fs');
const path = require('path');

// Ordre d'affichage, et les mots de nom d'agent qui menent a chaque section.
const SECTIONS = [
  ['Direction', /chef|lead|direct|coord/],
  ['Gameplay', /gameplay|interact|porte|door|mecan/],
  ['Personnage', /personnage|character|pion|pawn|mouvement|movement/],
  ['Animation', /anim/],
  ['Armes et combat', /arme|weapon|combat|tir|melee|mêlée/],
  ['Santé et soins', /sante|santé|soin|bless|medic|heal/],
  ['IA et entités', /entit|(^|-)(ia|ai)($|-)|ennemi|enemy|creature/],
  ['Raid', /raid|horde|siege|arene/],
  ['Monde et niveaux', /monde|world|niveau|level|map|decor|parcelle/],
  ['Assets', /asset|contenu|content|import|mesh|texture/],
  ['Rendu et effets', /vfx|effet|rendu|render|lumi|light|material|shader|niagara/],
  ['Interface', /interface|(^|-)ui($|-)|hud|widget|umg/],
  ['Menus', /menu|option|reglage/],
  ['Son', /(^|-)son($|-)|audio|sound|music/],
  ['Économie et inventaire', /econom|invent|commerce|loot|mission|profil/],
  ['Réseau', /reseau|réseau|network|replic|multi|escouade/],
  ['Caméra', /camera|caméra/],
  ['Tests et qualité', /test|qa\b|relect|review|qualit/],
  ['Livraison', /livraison|build|package|release|perf/],
];
const ORDER = SECTIONS.map(s => s[0]);
const OTHER = 'Autres';

function guessSection(name) {
  const n = String(name || '').toLowerCase().replace(/^(ctb|ue5?)-/, '');
  for (const [s, re] of SECTIONS) if (re.test(n)) return s;
  return OTHER;
}

// En-tete YAML simple : « cle: valeur » sur une ligne (les listes et les blocs sont ignores).
function frontmatter(text) {
  const m = String(text).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

const short = (s, n) => { s = String(s || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function readTeam(root) {
  const dir = path.join(root, '.claude', 'agents');
  let names;
  try { names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.md')); } catch { return []; }
  const team = [];
  for (const n of names) {
    let fm;
    try { fm = frontmatter(fs.readFileSync(path.join(dir, n), 'utf8').slice(0, 8192)); } catch { continue; }
    const name = short(fm.name || n.replace(/\.md$/i, ''), 60);
    const wanted = short(fm.section, 40);
    const section = wanted ? (ORDER.find(s => s.toLowerCase() === wanted.toLowerCase()) || wanted) : guessSection(name);
    team.push({ name, section, description: short(fm.description, 200) });
  }
  const rank = (s) => { const i = ORDER.indexOf(s); return i < 0 ? ORDER.length : i; };
  return team.sort((a, b) => rank(a.section) - rank(b.section) || a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
}

// Relu au plus toutes les 5 secondes par projet : /api/state est appele a chaque changement.
const cache = new Map();
function teamOf(root, ttl = 5000) {
  const c = cache.get(root);
  if (c && Date.now() - c.at < ttl) return c.team;
  const team = readTeam(root);
  cache.set(root, { at: Date.now(), team });
  return team;
}

module.exports = { readTeam, teamOf, guessSection, frontmatter, SECTIONS: ORDER, OTHER };
