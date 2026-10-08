'use strict';
// Petit client HTTP vers la tour. Ne leve jamais : renvoie null si la tour ne repond pas.

const http = require('http');

const PORT = Number(process.env.TOWER_PORT) || 4777;
const HOST = '127.0.0.1';

function post(pathname, body, timeoutMs = 400) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let data;
    try { data = Buffer.from(JSON.stringify(body || {})); } catch { return done(null); }
    const req = http.request({
      host: HOST, port: PORT, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      agent: false,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return done(null);
        try { done(JSON.parse(raw)); } catch { done(null); }
      });
      res.on('error', () => done(null));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    req.end(data);
  });
}

module.exports = { post, PORT, HOST };
