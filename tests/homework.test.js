import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Homework } from '../src/homework.js';
import { validateQuiz } from '../public/quiz.js';

const quiz = validateQuiz({ title: 'HW', questions: [
  { type: 'quiz', text: 'Q1', answers: ['a', 'b'], correct: [1], time: 20 },
  { type: 'type', text: 'Q2', accepted: ['Paris'], time: 20 },
] }).quiz;

function setup() {
  let t = Date.parse('2026-11-19T10:00:00Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blurt-hw-'));
  const hw = new Homework({ dir, now: () => t });
  return { hw, dir, advance: (ms) => { t += ms; } };
}

test('a student plays homework and the teacher sees the results', () => {
  const { hw, dir, advance } = setup();
  assert.match(hw.create({ quiz, deadline: '2020-01-01' }).error, /future/);
  const { id, key } = hw.create({ quiz, deadline: '2026-11-26T17:00:00Z' });
  assert.match(id, /^[a-z0-9]{10}$/);
  assert.equal(hw.info(id).questions, 2);

  const s = hw.start(id, 'Liam');
  assert.equal(s.question.q.correct, undefined, 'the answer is never sent to the student');
  advance(2000);
  const r1 = hw.answer(s.sid, 0, 1);
  assert.equal(r1.result.correct, true);
  assert.equal(r1.result.points, 950);
  assert.match(hw.answer(s.sid, 0, 1).error, /twice/);
  advance(30000);
  const r2 = hw.answer(s.sid, 1, 'paris');
  assert.equal(r2.result.answered, false, 'too late: the timer had run out');
  assert.equal(r2.done.correct, 1);

  const s2 = hw.start(id, 'Daphne');
  hw.answer(s2.sid, 0, 0);
  hw.answer(s2.sid, 1, 'Paris');

  assert.equal(hw.results(id, 'wrong-key'), null);
  const res = hw.results(id, key);
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows.map(r => [r[1], r[2]]), [['Daphne', 1000], ['Liam', 950]]);
  assert.deepEqual(res.summary.map(x => x.right), [1, 1]);

  // Survives a restart: results are on disk.
  const again = new Homework({ dir, now: () => Date.parse('2026-11-20T10:00:00Z') });
  assert.equal(again.results(id, key).rows.length, 2);
});

test('no new attempts after the deadline, files removed 30 days later', () => {
  const { hw, advance } = setup();
  const { id } = hw.create({ quiz, deadline: '2026-11-19T12:00:00Z' });
  advance(3 * 60 * 60 * 1000);
  assert.match(hw.start(id, 'Late').error, /deadline/);
  assert.equal(hw.info(id).closed, true);
  advance(31 * 24 * 60 * 60 * 1000);
  hw.cleanup();
  assert.equal(hw.info(id), null);
});

test('rude names and bad ids are refused', () => {
  const { hw } = setup();
  const { id } = hw.create({ quiz, deadline: '2026-11-26T17:00:00Z' });
  assert.match(hw.start(id, 'f u c k').error, /real name/);
  assert.match(hw.start('../../etc', 'Ann').error, /does not work/);
});
