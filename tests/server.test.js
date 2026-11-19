import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server.js';
import { SAMPLE, validateQuiz } from '../public/quiz.js';

let srv; let base;
before(async () => {
  srv = createServer({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'blurt-srv-')), env: {} });
  await new Promise(r => srv.server.listen(0, r));
  base = `127.0.0.1:${srv.server.address().port}`;
});
after(() => { for (const c of srv.wss.clients) c.terminate(); srv.server.close(); });

function client() {
  const ws = new WebSocket(`ws://${base}/ws`);
  const inbox = []; const waiters = [];
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex(w => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  const ready = new Promise(r => ws.on('open', r));
  return {
    send: async (m) => { await ready; ws.send(JSON.stringify(m)); },
    next: (type) => {
      const i = inbox.findIndex(m => m.type === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => { waiters.push({ type, resolve }); setTimeout(() => reject(new Error(`no ${type}`)), 3000); });
    },
    close: () => ws.close(),
  };
}

const post = async (p, body) => { const r = await fetch(`http://${base}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

test('pages are served and paths outside public are not', async () => {
  for (const p of ['/', '/create', '/host', '/play', '/library', '/homework', '/results', '/quiz.js', '/style.css', '/vendor/qrcode.js', '/library/index.json']) {
    const r = await fetch(`http://${base}${p}`);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  }
  for (const p of ['/../server.js', '/..%2Fserver.js', '/%2e%2e/package.json', '/nope.html', '/%E0%A4%A']) {
    const r = await fetch(`http://${base}${p}`);
    assert.equal(r.status, 404, p);
  }
});

test('config says AI is off without a key', async () => {
  const r = await fetch(`http://${base}/api/config`);
  assert.deepEqual(await r.json(), { ai: false, homework: true });
  assert.equal((await post('/generate', { topic: 'x' })).status, 404);
});

test('a bad quiz is refused', async () => {
  const host = client();
  await host.send({ type: 'host', quiz: { questions: [] } });
  assert.match((await host.next('error')).error, /no questions/);
  host.close();
});

test('host and two phones play a game over the network', async () => {
  const host = client();
  await host.send({ type: 'host', quiz: SAMPLE, settings: { teams: 2 } });
  const { pin, hostKey } = await host.next('hosted');
  assert.equal((await host.next('hostState')).teams.length, 2);

  const p1 = client(); const p2 = client(); const bad = client();
  await bad.send({ type: 'join', pin: '000000', name: 'X' });
  assert.match((await bad.next('error')).error, /No game/);
  await p1.send({ type: 'join', pin, name: 'Ann' });
  const j1 = await p1.next('joined');
  await p2.send({ type: 'join', pin, name: 'Ben' });
  await p2.next('joined');
  assert.equal((await p1.next('state')).phase, 'lobby');

  await host.send({ type: 'lock', on: true });
  const late = client();
  await late.send({ type: 'join', pin, name: 'Cal' });
  assert.match((await late.next('error')).error, /locked/);

  await host.send({ type: 'start' });
  const q = await p1.next('question');
  assert.equal(q.q.text, SAMPLE.questions[0].text);
  assert.equal(q.q.correct, undefined);
  await p2.next('question');
  await host.send({ type: 'pause' });
  assert.equal((await p1.next('timer')).paused, true);
  await host.send({ type: 'resume' });
  await p1.next('timer');
  await p1.send({ type: 'answer', answer: SAMPLE.questions[0].correct[0] });
  await p2.send({ type: 'answer', answer: 0 });
  const r1 = await p1.next('result');
  assert.equal(r1.correct, true);
  assert.ok(r1.team.name);
  assert.equal((await p2.next('result')).correct, false);
  assert.equal((await host.next('reveal')).counts.reduce((a, b) => a + b), 2);

  p1.close();
  const p1b = client();
  await p1b.send({ type: 'rejoin', pin, id: j1.id });
  await p1b.next('joined');
  const st = await p1b.next('state');
  assert.equal(st.phase, 'reveal');
  assert.equal(st.result.score, r1.score);

  host.close();
  const host2 = client();
  await host2.send({ type: 'rehost', pin, hostKey });
  await host2.next('hosted');
  assert.equal((await host2.next('hostState')).phase, 'reveal');
  assert.equal((await host2.next('reveal')).index, 0);

  const intruder = client();
  await intruder.send({ type: 'rehost', pin, hostKey: 'wrong' });
  assert.match((await intruder.next('error')).error, /ended/);

  await host2.send({ type: 'end' });
  assert.equal((await p2.next('closed')).type, 'closed');
  assert.equal(srv.rooms.has(pin), false);
  for (const c of [p1b, p2, bad, intruder, host2, late]) c.close();
});

test('homework over HTTP: set, play, results', async () => {
  const quiz = validateQuiz({ title: 'HW', questions: [{ type: 'quiz', text: 'Q', answers: ['a', 'b'], correct: [1] }] }).quiz;
  const set = await post('/assign', { quiz, deadline: new Date(Date.now() + 864e5).toISOString() });
  assert.equal(set.status, 200);
  const info = await post('/homework/info', { id: set.body.id });
  assert.equal(info.body.title, 'HW');
  const s = await post('/homework/start', { id: set.body.id, name: 'Liam' });
  assert.equal(s.body.question.q.correct, undefined);
  const a = await post('/homework/answer', { sid: s.body.sid, index: 0, answer: 1 });
  assert.equal(a.body.result.correct, true);
  assert.equal(a.body.done.correct, 1);
  const res = await post('/homework/results', { id: set.body.id, key: set.body.key });
  assert.equal(res.body.rows[0][1], 'Liam');
  assert.equal((await post('/homework/results', { id: set.body.id, key: 'x' })).status, 404);
  assert.equal((await post('/assign', { quiz, deadline: 'yesterday' })).status, 400);
});
