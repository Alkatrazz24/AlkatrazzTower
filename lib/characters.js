'use strict';
// Personnages : chaque agent est represente par un personnage en pixels, facon Minecraft.
// Un personnage dure plus longtemps qu'une session : il garde son nom et son allure, et la tour
// le redonne a l'agent suivant qui joue le meme role.

const STYLES = {
  hairStyle: ['court', 'long', 'chauve', 'crete', 'queue'],
  shirtStyle: ['uni', 'rayures', 'veste', 'salopette'],
  hat: ['aucun', 'casquette', 'casque', 'couronne', 'bandana', 'chapeau', 'capuche'],
  accessory: ['aucun', 'lunettes', 'barbe', 'masque', 'casque-audio', 'cache-oeil'],
  tool: ['aucun', 'pioche', 'marteau', 'cle', 'epee', 'clavier', 'pinceau'],
};
const COLORS = ['skin', 'hair', 'eyes', 'shirt', 'pants', 'shoes', 'hatColor', 'accessoryColor'];

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a16e4b'];
const HAIRS = ['#2b1d0e', '#5a3825', '#a0522d', '#e6be8a', '#111111', '#b7410e', '#d9d9d9', '#4b6cb7'];
const CLOTH = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316', '#22c55e'];
const PANTS = ['#1e3a8a', '#374151', '#3f2a1d', '#111827', '#1f4d3a', '#4b5563'];
// Jamais « Forge » : c'est le poste de build de la page, un agent du meme nom pretait a confusion.
const NAMES = ['Brique', 'Pixel', 'Silex', 'Quartz', 'Bastion', 'Lanterne', 'Rouage', 'Boussole', 'Etincelle', 'Granit',
  'Comete', 'Galet', 'Ferraille', 'Tisonnier', 'Pigment', 'Cerbere', 'Mirage', 'Ardoise', 'Basalte', 'Oxyde'];

// Generateur deterministe : la meme graine donne toujours le meme personnage.
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

function randomLook(seed) {
  const r = rng(seed);
  return {
    skin: pick(r, SKINS),
    hair: pick(r, HAIRS),
    hairStyle: pick(r, ['court', 'court', 'long', 'chauve', 'crete', 'queue']),
    eyes: pick(r, ['#2563eb', '#16a34a', '#78350f', '#111827', '#7c3aed']),
    shirt: pick(r, CLOTH),
    shirtStyle: pick(r, STYLES.shirtStyle),
    pants: pick(r, PANTS),
    shoes: pick(r, ['#1f2937', '#78350f', '#e5e7eb', '#111111']),
    hat: pick(r, ['aucun', 'aucun', 'casquette', 'casque', 'bandana', 'chapeau', 'capuche']),
    hatColor: pick(r, CLOTH),
    accessory: pick(r, ['aucun', 'aucun', 'aucun', 'lunettes', 'barbe', 'casque-audio']),
    accessoryColor: pick(r, ['#111827', '#e5e7eb', '#f59e0b', '#6b7280']),
    tool: pick(r, ['pioche', 'marteau', 'cle', 'clavier', 'epee', 'pinceau']),
  };
}

function randomName(seed, taken = new Set()) {
  const r = rng('nom:' + seed);
  for (let i = 0; i < 40; i++) {
    const n = pick(r, NAMES);
    if (!taken.has(n)) return n;
  }
  return `${pick(r, NAMES)} ${Math.floor(r() * 90) + 10}`;
}

// Garde seulement les champs connus, avec des valeurs valides. `base` = allure actuelle.
function cleanLook(look, base) {
  const out = { ...(base || {}) };
  if (!look || typeof look !== 'object') return out;
  for (const k of COLORS) {
    const v = look[k];
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())) out[k] = v.trim().toLowerCase();
  }
  for (const [k, allowed] of Object.entries(STYLES)) {
    const v = typeof look[k] === 'string' ? look[k].trim().toLowerCase() : null;
    if (v && allowed.includes(v)) out[k] = v;
  }
  return out;
}

function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
}

module.exports = { STYLES, COLORS, randomLook, randomName, cleanLook, cleanName };
