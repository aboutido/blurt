import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, pointsFor, cleanName } from '../src/game.js';
import { validateQuiz } from '../public/quiz.js';

const Q = (o) => ({ type: 'quiz', time: 20, points: 'standard', ...o });
const quiz = validateQuiz({
  title: 'T',
  questions: [
    Q({ text: 'Q1', answers: ['a', 'b', 'c'], correct: [1] }),
    Q({ text: 'Q2', answers: ['x', 'y'], correct: [0], time: 10 }),
  ],
}).quiz;

function setup(q = quiz, settings = {}, seed = 1) {
  let t = 1000;
  let r = seed;
  const sent = [];
  const timers = [];
  const room = new Room({
    pin: '123456', quiz: q, settings,
    send: (to, msg) => sent.push({ to, ...msg }),
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.cleared = true; },
    rand: () => { r = (r * 16807) % 2147483647; return (r - 1) / 2147483646; },
  });
  return { room, sent, timers, advance: (ms) => { t += ms; }, last: (to, type) => sent.filter(m => m.to === to && (!type || m.type === type)).at(-1) };
}

test('points: 1000 for instant, 500 at the buzzer', () => {
  assert.equal(pointsFor(0, 20000), 1000);
  assert.equal(pointsFor(20000, 20000), 500);
  assert.equal(pointsFor(10000, 20000), 750);
});

test('names are trimmed, unique, limited and filtered', () => {
  const { room } = setup();
  assert.equal(cleanName('  Big   Al  '), 'Big Al');
  assert.ok(room.addPlayer('Sam').id);
  assert.match(room.addPlayer('sam').error, /taken/);
  assert.match(room.addPlayer('   ').error, /nickname/);
  assert.match(room.addPlayer('sh1t head').error, /different nickname/);
  assert.equal(room.addPlayer('x'.repeat(50)).name.length, 20);
});

test('random names mode ignores what players type', () => {
  const { room } = setup(quiz, { randomNames: true });
  const a = room.addPlayer('whatever I want');
  assert.match(a.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.notEqual(room.addPlayer('').name, a.name);
});

test('a full game: scoring, streaks, early reveal, leaderboard, podium and results', () => {
  const { room, sent, timers, advance, last } = setup();
  const a = room.addPlayer('Ann').id;
  const b = room.addPlayer('Ben').id;
  room.start();
  assert.equal(last(a, 'question').q.text, 'Q1');
  assert.equal(last(a, 'question').q.correct, undefined, 'players must not be sent the answer');
  advance(2000); room.answer(a, 1);
  room.answer(a, 0); // a second answer is ignored
  assert.equal(last('host', 'answerCount').answered, 1);
  advance(8000); room.answer(b, 2);
  assert.equal(room.phase, 'reveal', 'reveals as soon as everyone has answered');
  assert.ok(timers[0].cleared);
  assert.deepEqual(last('host', 'reveal').counts, [0, 1, 1]);
  assert.deepEqual(last('host', 'reveal').correct, [1]);
  assert.equal(last(a, 'result').points, 950);
  assert.equal(last(b, 'result').correct, false);
  assert.equal(last(b, 'result').right, 'b');

  room.next();
  assert.equal(last('host', 'leaderboard').top[0].name, 'Ann');
  room.next();
  advance(1000); room.answer(a, 0);
  timers.at(-1).fn(); // time runs out for Ben
  assert.equal(last(a, 'result').bonus, 100, 'second right answer in a row earns a streak bonus');
  assert.equal(last(b, 'result').answered, false);
  room.next();
  assert.equal(room.phase, 'end');
  const podium = last('host', 'podium');
  assert.deepEqual(podium.top.map(p => p.name), ['Ann', 'Ben']);
  assert.deepEqual(podium.results.header.slice(0, 4), ['Rank', 'Name', 'Score', 'Correct']);
  assert.deepEqual(podium.results.rows[0].slice(1, 5), ['Ann', 950 + 950 + 100, 2, 'b']);
  assert.equal(podium.results.summary[0].right, 1);
  assert.equal(sent.filter(m => m.type === 'final').length, 2);
});

test('double points, no points, and several right answers', () => {
  const q = validateQuiz({ questions: [
    Q({ text: 'D', answers: ['a', 'b'], correct: [0], points: 'double' }),
    Q({ text: 'N', answers: ['a', 'b'], correct: [0], points: 'none' }),
    Q({ text: 'M', answers: ['a', 'b', 'c'], correct: [0, 2] }),
  ] }).quiz;
  const { room, last } = setup(q);
  const a = room.addPlayer('Ann').id;
  room.start(); room.answer(a, 0);
  assert.equal(last(a, 'result').points, 2000);
  room.next(); room.next(); room.answer(a, 0);
  assert.equal(last(a, 'result').points, 0);
  room.next(); room.next(); room.answer(a, 2);
  assert.equal(last(a, 'result').correct, true);
});

test('every question type is checked properly', () => {
  const q = validateQuiz({ questions: [
    { type: 'type', text: 'Capital of France?', accepted: ['Paris'], time: 20 },
    { type: 'order', text: 'Order', items: ['one', 'two', 'three'], time: 20 },
    { type: 'slider', text: 'Moon landing?', min: 1950, max: 2000, answer: 1969, margin: 2, time: 20 },
    { type: 'poll', text: 'Favourite?', answers: ['x', 'y'], time: 20 },
    { type: 'cloud', text: 'One word', time: 20 },
  ] }).quiz;
  const { room, last } = setup(q);
  const a = room.addPlayer('Ann').id; const b = room.addPlayer('Ben').id;
  room.start();
  room.answer(a, '  paris! '); room.answer(b, 'Lyon');
  assert.equal(last(a, 'result').correct, true);
  assert.equal(last(b, 'result').correct, false);
  assert.ok(last('host', 'reveal').typed.find(t => t.text === 'Lyon' && !t.correct));

  room.next(); room.next();
  const shown = last(a, 'question').q.items;
  assert.notDeepEqual(shown, ['one', 'two', 'three'], 'items are never shown in the right order');
  room.answer(a, ['one', 'two', 'three'].map(x => shown.indexOf(x)));
  room.answer(b, [0, 1, 2]);
  assert.equal(last(a, 'result').correct, true);
  assert.equal(last(b, 'result').correct, false);
  assert.equal(last('host', 'reveal').rightCount, 1);

  room.next(); room.next();
  room.answer(a, 1971); room.answer(b, 1980);
  assert.equal(last(a, 'result').correct, true, 'within the margin');
  assert.equal(last(b, 'result').correct, false);
  assert.deepEqual(last('host', 'reveal').slider.values.sort(), [1971, 1980]);

  room.next(); room.next();
  room.answer(a, 1); room.answer(b, 1);
  assert.equal(last(a, 'result').kind, 'unscored');
  assert.equal(last(a, 'result').points, 0);
  assert.deepEqual(last('host', 'reveal').counts, [0, 2]);

  room.next(); room.next();
  room.answer(a, 'Fun'); room.answer(b, 'fun');
  assert.deepEqual(last('host', 'reveal').cloud, [{ word: 'Fun', count: 2 }]);
});

test('rude words are kept off the word cloud', () => {
  const q = validateQuiz({ questions: [{ type: 'cloud', text: 'One word', time: 20 }] }).quiz;
  const { room, last } = setup(q);
  const a = room.addPlayer('Ann').id; const b = room.addPlayer('Ben').id;
  room.start(); room.answer(a, 'great'); room.answer(b, 'sh!t');
  assert.deepEqual(last('host', 'reveal').cloud.map(w => w.word), ['great']);
});

test('shuffled answers are mapped back for each player', () => {
  const q = validateQuiz({ questions: [Q({ text: 'S', answers: ['a', 'b', 'c', 'd'], correct: [2] })] }).quiz;
  const { room, last } = setup(q, { shuffleAnswers: true });
  const ids = ['P1', 'P2', 'P3', 'P4'].map(n => room.addPlayer(n).id);
  room.start();
  for (const id of ids) room.answer(id, last(id, 'question').q.answers.indexOf('c'));
  for (const id of ids) assert.equal(last(id, 'result').correct, true);
  assert.deepEqual(last('host', 'reveal').counts, [0, 0, 4, 0]);
});

test('screen-only mode: same answer order for everyone, no question text on phones', () => {
  const q = validateQuiz({ questions: [Q({ text: 'S', answers: ['a', 'b', 'c', 'd'], correct: [2] })] }).quiz;
  const { room, last } = setup(q, { shuffleAnswers: true, screenOnly: true });
  const a = room.addPlayer('Ann').id; const b = room.addPlayer('Ben').id;
  room.start();
  const host = last('host', 'question').q.answers;
  assert.deepEqual(last(a, 'question').q.answers, host);
  assert.deepEqual(last(b, 'question').q.answers, host);
  assert.equal(last(a, 'question').q.text, '');
  room.answer(a, host.indexOf('c')); room.answer(b, (host.indexOf('c') + 1) % 4);
  const rev = last('host', 'reveal');
  assert.deepEqual(rev.correct, [host.indexOf('c')]);
  assert.equal(rev.counts[host.indexOf('c')], 1);
});

test('teams: balanced, scored by average, shown on the board', () => {
  const { room, last } = setup(quiz, { teams: 2 });
  const ids = ['A', 'B', 'C', 'D'].map(n => room.addPlayer(n).id);
  const teamOf = (id) => room.players.get(id).team;
  assert.deepEqual(ids.map(teamOf).sort(), [0, 0, 1, 1]);
  room.start();
  for (const id of ids) room.answer(id, teamOf(id) === 0 ? 1 : 0);
  room.next();
  const lb = last('host', 'leaderboard');
  assert.equal(lb.teams[0].name, 'Red Rockets');
  assert.equal(lb.teams[0].score, 1000);
  assert.equal(lb.teams[1].score, 0);
  assert.equal(last(ids[0], 'standing').teamRank, teamOf(ids[0]) === 0 ? 1 : 2);
});

test('pause, resume and add time', () => {
  const { room, timers, advance, last } = setup();
  const a = room.addPlayer('Ann').id;
  room.start();
  advance(5000); room.pause();
  assert.equal(last('host', 'timer').paused, true);
  assert.equal(last('host', 'timer').left, 15);
  advance(60000);
  room.answer(a, 1);
  assert.equal(room.phase, 'question', 'no answers while paused');
  room.resume();
  assert.equal(timers.at(-1).ms, 15000);
  room.addTime(10);
  assert.equal(last(a, 'timer').left, 25);
  assert.equal(timers.at(-1).ms, 25000);
  advance(1000); room.answer(a, 1);
  assert.equal(last(a, 'result').points, 850, 'the paused minute does not count against the player');
});

test('locking the lobby stops new players', () => {
  const { room, last } = setup();
  room.addPlayer('Ann');
  room.setLocked(true);
  assert.match(room.addPlayer('Ben').error, /locked/);
  assert.equal(last('host', 'players').locked, true);
  room.setLocked(false);
  assert.ok(room.addPlayer('Ben').id);
});

test('a dropped phone does not hold up the question, and can come back', () => {
  const { room, last, advance } = setup();
  const a = room.addPlayer('Ann').id;
  const b = room.addPlayer('Ben').id;
  room.start();
  room.disconnect(b);
  advance(1000); room.answer(a, 1);
  assert.equal(room.phase, 'reveal');
  assert.ok(room.reconnect(b));
  assert.equal(room.viewFor(b).result.answered, false);
  assert.equal(room.reconnect('nope'), null);
  assert.equal(last('host', 'players').players.find(p => p.name === 'Ben').connected, true);
});

test('a late joiner mid-question gets a shuffled order for put-in-order questions', () => {
  const q = validateQuiz({ questions: [{ type: 'order', text: 'O', items: ['1', '2', '3', '4'], time: 20 }] }).quiz;
  const { room } = setup(q);
  room.addPlayer('Ann');
  room.start();
  const late = room.addPlayer('Late').id;
  const v = room.viewFor(late);
  assert.notDeepEqual(v.question.q.items, ['1', '2', '3', '4']);
});

test('kicking removes the player and tells them', () => {
  const { room, last } = setup();
  const a = room.addPlayer('Rude').id;
  room.kick(a);
  assert.equal(room.players.size, 0);
  assert.equal(last(a, 'kicked').type, 'kicked');
  assert.ok(room.addPlayer('Rude').id);
});

test('a reload mid-question rebuilds the screen with the time left', () => {
  const { room, advance } = setup();
  const a = room.addPlayer('Ann').id;
  room.addPlayer('Ben');
  room.start();
  advance(7500);
  assert.equal(room.viewFor(a).question.left, 13);
  assert.equal(room.hostScreen().left, 13);
});
