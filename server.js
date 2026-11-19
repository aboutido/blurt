// Blurt server: serves the pages in public/, runs live games over WebSockets,
// and keeps homework results in small JSON files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './src/game.js';
import { Homework } from './src/homework.js';
import { aiConfig, generateQuiz } from './src/ai.js';
import { validateQuiz } from './public/quiz.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
const PAGES = { '/': 'index.html', '/create': 'create.html', '/host': 'host.html', '/play': 'play.html', '/library': 'library.html', '/homework': 'homework.html', '/results': 'results.html' };

const HOST_GRACE_MS = 10 * 60 * 1000;   // a host who drops has 10 minutes to come back
const IDLE_MS = 3 * 60 * 60 * 1000;     // live games with no activity for 3 hours are closed
const MAX_ROOMS = 2000;
const MAX_BODY = 4 * 1024 * 1024;

const CSP = [
  "default-src 'self'", "img-src 'self' https: data: blob:", "style-src 'self' 'unsafe-inline'", "script-src 'self'",
  "connect-src 'self' ws: wss:", 'frame-src https://www.youtube-nocookie.com', "media-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'",
].join('; ');

// A simple per-address limiter for the expensive endpoints.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    if (hits.size > 10000) hits.clear();
    return true;
  };
}

export function createServer({ log = console.log, dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'), env = process.env, fetchFn = fetch } = {}) {
  const rooms = new Map();
  // Homework needs somewhere to save files. If that folder can't be written,
  // live games still work and the homework buttons are hidden.
  let homework = null;
  try { homework = new Homework({ dir: dataDir }); } catch (e) { log(`Homework is off: cannot write to ${dataDir} (${e.code || e.message}). Set DATA_DIR to a writable folder.`); }
  const ai = aiConfig(env);
  const limits = { assign: limiter(30, 60 * 60 * 1000), ai: limiter(15, 60 * 60 * 1000), solo: limiter(120, 60 * 1000) };
  homework?.cleanup();

  const ip = (req) => (env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { resolve({ tooBig: true }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { resolve({ bad: true }); } });
    req.on('error', () => resolve({ bad: true }));
  });

  async function api(req, res, url) {
    const route = url.pathname.slice(4);
    if (route === '/config' && req.method === 'GET') return json(res, 200, { ai: !!ai, homework: !!homework });

    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    const body = await readBody(req);
    if (body.tooBig) return json(res, 413, { error: 'That is too big.' });
    if (body.bad) return json(res, 400, { error: 'Bad request.' });

    if (!homework && (route === '/assign' || route.startsWith('/homework/'))) return json(res, 503, { error: 'Homework is switched off on this server.' });
    if (route === '/assign') {
      if (!limits.assign(ip(req))) return json(res, 429, { error: 'Too many homework quizzes from here. Try again in an hour.' });
      const { quiz, error } = validateQuiz(body.quiz);
      if (error) return json(res, 400, { error });
      const out = homework.create({ quiz, deadline: body.deadline, settings: body.settings });
      if (out.error) return json(res, 400, out);
      log(`homework ${out.id} set: "${quiz.title}", due ${out.deadline}`);
      return json(res, 200, out);
    }
    if (route === '/homework/info') {
      const info = homework.info(String(body.id || ''));
      return info ? json(res, 200, info) : json(res, 404, { error: 'This homework link does not work. Check it with your teacher.' });
    }
    if (route === '/homework/start') {
      if (!limits.solo(ip(req))) return json(res, 429, { error: 'Slow down a little and try again.' });
      const out = homework.start(String(body.id || ''), body.name);
      return json(res, out.error ? 400 : 200, out);
    }
    if (route === '/homework/answer') {
      const out = homework.answer(String(body.sid || ''), body.index, body.answer, { timeout: !!body.timeout });
      return json(res, out.error ? 400 : 200, out);
    }
    if (route === '/homework/results') {
      const out = homework.results(String(body.id || ''), String(body.key || ''));
      return out ? json(res, 200, out) : json(res, 404, { error: 'That results link does not work.' });
    }
    if (route === '/generate') {
      if (!ai) return json(res, 404, { error: 'AI quizzes are not switched on for this server.' });
      if (!limits.ai(ip(req))) return json(res, 429, { error: 'That is a lot of AI quizzes. Try again in an hour.' });
      const out = await generateQuiz(body, ai, fetchFn);
      return json(res, out.error ? 502 : 200, out);
    }
    return json(res, 404, { error: 'Not found.' });
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`ok ${rooms.size}`); }
    if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => { log(`api error: ${e.message}`); json(res, 500, { error: 'Something went wrong.' }); });
    let file;
    try { file = PAGES[url.pathname] || decodeURIComponent(url.pathname.slice(1)); } catch { file = ''; }
    const full = path.normalize(path.join(PUBLIC, file));
    if (!file || !full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(full)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-security-policy': CSP,
    });
    fs.createReadStream(full).pipe(res);
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_BODY });

  const newPin = () => {
    for (let i = 0; i < 50; i++) {
      const pin = String(crypto.randomInt(100000, 1000000));
      if (!rooms.has(pin)) return pin;
    }
    return null;
  };

  const closeRoom = (room, reason) => {
    room.close(reason);
    for (const ws of room.sockets.values()) try { ws.close(); } catch {}
    try { room.hostSocket?.close(); } catch {}
    clearTimeout(room.hostGone);
    rooms.delete(room.pin);
  };

  const makeRoom = (quiz, settings) => {
    const pin = newPin();
    if (!pin) return null;
    const room = new Room({
      pin, quiz, settings,
      send: (to, msg) => (to === 'host' ? sendTo(room.hostSocket, msg) : sendTo(room.sockets.get(to), msg)),
    });
    room.sockets = new Map();
    room.hostSocket = null;
    room.hostGone = null;
    rooms.set(pin, room);
    return room;
  };

  wss.on('connection', (ws) => {
    let role = null; let room = null; let playerId = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      if (!role) {
        if (msg.type === 'host') {
          if (rooms.size >= MAX_ROOMS) return sendTo(ws, { type: 'error', error: 'The server is busy. Try again in a minute.' });
          const { quiz, error } = validateQuiz(msg.quiz);
          if (error) return sendTo(ws, { type: 'error', error });
          room = makeRoom(quiz, msg.settings);
          if (!room) return sendTo(ws, { type: 'error', error: 'Could not make a game PIN. Try again.' });
          role = 'host'; room.hostSocket = ws;
          log(`game ${room.pin} hosted: "${quiz.title}", ${quiz.questions.length} questions`);
          sendTo(ws, { type: 'hosted', pin: room.pin, hostKey: room.hostKey, title: quiz.title, total: quiz.questions.length });
          return sendTo(ws, room.hostView());
        }
        if (msg.type === 'rehost') {
          const r = rooms.get(String(msg.pin));
          if (!r || typeof msg.hostKey !== 'string' || msg.hostKey !== r.hostKey) return sendTo(ws, { type: 'error', error: 'That game has ended.', gone: true });
          room = r; role = 'host';
          try { room.hostSocket?.close(); } catch {}
          room.hostSocket = ws;
          clearTimeout(room.hostGone); room.hostGone = null;
          sendTo(ws, { type: 'hosted', pin: room.pin, hostKey: room.hostKey, title: room.quiz.title, total: room.quiz.questions.length });
          sendTo(ws, room.hostView());
          const screen = room.hostScreen();
          if (screen) sendTo(ws, screen);
          return;
        }
        if (msg.type === 'join' || msg.type === 'rejoin') {
          const r = rooms.get(String(msg.pin ?? '').replace(/\D/g, ''));
          if (!r) return sendTo(ws, { type: 'error', error: 'No game with that PIN. Check the number on the screen.', gone: msg.type === 'rejoin' });
          if (msg.type === 'rejoin') {
            const p = r.reconnect(String(msg.id));
            if (!p) return sendTo(ws, { type: 'error', error: 'You were removed from this game.', gone: true });
            playerId = p.id;
          } else {
            const res = r.addPlayer(msg.name);
            if (res.error) return sendTo(ws, { type: 'error', error: res.error });
            playerId = res.id;
          }
          room = r; role = 'player';
          try { room.sockets.get(playerId)?.close(); } catch {}
          room.sockets.set(playerId, ws);
          const p = room.players.get(playerId);
          sendTo(ws, { type: 'joined', id: playerId, name: p.name, pin: room.pin, randomName: room.settings.randomNames });
          return sendTo(ws, room.viewFor(playerId));
        }
        return;
      }

      if (!rooms.has(room.pin)) return;
      if (role === 'host') {
        if (msg.type === 'start') room.start();
        else if (msg.type === 'next') room.next();
        else if (msg.type === 'kick') room.kick(String(msg.id));
        else if (msg.type === 'lock') room.setLocked(msg.on);
        else if (msg.type === 'pause') room.pause();
        else if (msg.type === 'resume') room.resume();
        else if (msg.type === 'addTime') room.addTime(msg.seconds);
        else if (msg.type === 'end') closeRoom(room, 'The host ended the game.');
      } else if (role === 'player') {
        if (msg.type === 'answer') room.answer(playerId, msg.answer);
        else if (msg.type === 'leave') { room.kick(playerId); room.sockets.delete(playerId); }
      }
    });

    ws.on('close', () => {
      if (!room || !rooms.has(room.pin)) return;
      if (role === 'player' && room.sockets.get(playerId) === ws) {
        room.sockets.delete(playerId);
        room.disconnect(playerId);
      }
      if (role === 'host' && room.hostSocket === ws) {
        room.hostSocket = null;
        const r = room;
        r.hostGone = setTimeout(() => closeRoom(r, 'The host left.'), HOST_GRACE_MS);
        r.hostGone.unref?.();
      }
    });
  });

  // Drop dead connections, idle games and expired homework.
  let sweeps = 0;
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
    const now = Date.now();
    for (const room of rooms.values()) if (now - room.lastActive > IDLE_MS) closeRoom(room, 'This game timed out.');
    if (++sweeps % 120 === 0) homework?.cleanup();
  }, 30000);
  sweep.unref?.();
  server.on('close', () => { clearInterval(sweep); for (const r of rooms.values()) { clearTimeout(r.hostGone); r.close('The server stopped.'); } });

  return { server, wss, rooms, homework };
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createServer();
  server.listen(port, () => console.log(`Blurt is running on http://localhost:${port}${aiConfig() ? ' (AI quizzes on)' : ''}`));
}
