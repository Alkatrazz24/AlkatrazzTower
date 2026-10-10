'use strict';
// Consommation de tokens d'une session Claude Code, lue dans son journal (le transcript .jsonl dont
// le hook donne le chemin). Lecture seule, par morceaux : on reprend la ou on s'etait arrete.
//
// Un meme message de l'API est ecrit sur plusieurs lignes (une par bloc : reflexion, texte, outil) qui
// repetent son usage : on compte chaque message une seule fois, par son id.

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

const WINDOW = 200_000;
const BIG_WINDOW = 1_000_000;
const CHUNK = 1 << 20; // par morceaux de 1 Mo : un journal peut peser des dizaines de Mo (captures d'ecran)
const KEEP_DAYS = 7;

const files = new Map(); // chemin -> { offset, rest, msgs: Map(id -> message) }

function dayOf(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Titre de la session : celui donne avec /rename passe avant celui que Claude Code genere.
function eatTitle(f, line) {
  let o;
  try { o = JSON.parse(line); } catch { return; }
  if (!o || typeof o !== 'object') return;
  if (o.type === 'custom-title' && typeof o.customTitle === 'string' && o.customTitle.trim()) f.custom = o.customTitle.trim();
  else if (o.type === 'ai-title' && typeof o.aiTitle === 'string' && o.aiTitle.trim()) f.auto = o.aiTitle.trim();
  else if (o.type === 'summary' && typeof o.summary === 'string' && o.summary.trim()) f.auto = o.summary.trim();
}

function eat(f, line) {
  if (/^\{"type":"(summary|custom-title|ai-title)"/.test(line)) return eatTitle(f, line);
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  const m = o && o.type === 'assistant' && o.message;
  if (!m || !m.usage) return;
  const id = m.id || o.uuid;
  const u = m.usage;
  const prev = f.msgs.get(id);
  const msg = prev || { tools: [], side: !!o.isSidechain, day: dayOf(o.timestamp), at: Date.parse(o.timestamp) || 0, model: m.model || '' };
  msg.in = u.input_tokens || 0;
  msg.cw = u.cache_creation_input_tokens || 0;
  msg.cr = u.cache_read_input_tokens || 0;
  msg.out = Math.max(prev ? prev.out : 0, u.output_tokens || 0);
  for (const c of m.content || []) if (c && c.type === 'tool_use' && c.name) msg.tools.push(c.name);
  f.msgs.delete(id); // garde l'ordre d'arrivee : le dernier message lu est le plus recent
  f.msgs.set(id, msg);
}

// Lit ce qui s'est ajoute au journal depuis la derniere fois, sans bloquer la tour : lecture
// asynchrone, et une pause toutes les 15 ms de calcul. Renvoie false si le fichier est illisible.
const yieldNow = () => new Promise(r => setImmediate(r));
async function readMore(file) {
  let f = files.get(file);
  let st;
  try { st = await fs.promises.stat(file); } catch { return false; }
  if (!f || st.size < f.offset) { f = { offset: 0, rest: '', dec: new StringDecoder('utf8'), msgs: new Map() }; files.set(file, f); }
  while (st.size > f.offset) {
    let h;
    try {
      h = await fs.promises.open(file, 'r');
      const len = Math.min(st.size - f.offset, CHUNK);
      const { bytesRead, buffer } = await h.read(Buffer.alloc(len), 0, len, f.offset);
      if (!bytesRead) break;
      f.offset += bytesRead;
      const lines = (f.rest + f.dec.write(buffer.slice(0, bytesRead))).split('\n');
      f.rest = lines.pop();
      let t = Date.now();
      for (const l of lines) {
        eat(f, l);
        if (Date.now() - t > 15) { await yieldNow(); t = Date.now(); }
      }
      await yieldNow();
    } catch { return false; } finally { if (h) await h.close().catch(() => {}); }
  }
  return true;
}

function summarize(f, modelHint = '') {
  const t = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  const tools = {};
  const days = {};
  let last = null, lastAt = 0, count = 0;
  for (const m of f.msgs.values()) {
    count++;
    t.in += m.in; t.out += m.out; t.cacheRead += m.cr; t.cacheWrite += m.cw;
    const all = m.in + m.out + m.cr + m.cw;
    if (m.day) days[m.day] = (days[m.day] || 0) + all;
    // Les tokens produits par un message vont aux actions qu'il lance (ou a la reponse s'il n'en lance pas).
    const names = m.tools.length ? m.tools : ['Réponse'];
    for (const n of names) {
      const k = tools[n] = tools[n] || { calls: 0, out: 0, ctx: 0 };
      if (m.tools.length) k.calls++;
      k.out += Math.round(m.out / names.length);
      k.ctx += Math.round((m.in + m.cr + m.cw) / names.length);
    }
    if (!m.side) last = m;
    lastAt = Math.max(lastAt, m.at);
  }
  const context = last ? last.in + last.cr + last.cw + last.out : 0;
  const window = /1m/i.test(modelHint) || context > WINDOW ? BIG_WINDOW : WINDOW;
  const keepDays = Object.keys(days).sort().slice(-KEEP_DAYS);
  return {
    ...t, total: t.in + t.out + t.cacheRead + t.cacheWrite, messages: count,
    context, window, contextPct: Math.min(100, Math.round(100 * context / window)),
    tools: Object.entries(tools).map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.out + b.ctx) - (a.out + a.ctx)).slice(0, 12),
    days: Object.fromEntries(keepDays.map(d => [d, days[d]])),
    lastAt,
    title: f.custom || f.auto || '',
  };
}

// Seuls des journaux .jsonl de Claude Code sont lus.
function okPath(p) { return typeof p === 'string' && /\.jsonl$/i.test(p) && require('path').isAbsolute(p); }

// Une seule lecture a la fois par journal : deux lectures en parallele compteraient deux fois.
const running = new Map();
function usageOf(file, modelHint) {
  if (!okPath(file)) return Promise.resolve(null);
  const prev = running.get(file) || Promise.resolve();
  const next = prev.then(async () => ((await readMore(file)) ? summarize(files.get(file), modelHint) : null));
  running.set(file, next.catch(() => null));
  next.finally(() => { if (running.get(file) === next) running.delete(file); }).catch(() => {});
  return next;
}

function forget(file) { files.delete(file); }

module.exports = { usageOf, forget, okPath, dayOf, WINDOW, BIG_WINDOW };
