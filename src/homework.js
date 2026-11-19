// Homework: a quiz students play on their own, any time before a deadline.
// No database: each assignment is one JSON file. Scoring happens here on the
// server, one question at a time, so the answers never reach the student's browser.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isCorrect, validAnswer, scoreFor, publicQuestion, answerText, rightAnswerText, TYPES } from '../public/quiz.js';
import { isRude } from './names.js';
import { cleanName } from './game.js';

const DAY = 24 * 60 * 60 * 1000;
const KEEP_AFTER_DEADLINE = 30 * DAY;
const MAX_AHEAD = 90 * DAY;
const MAX_SUBMISSIONS = 2000;
const SESSION_MS = 3 * 60 * 60 * 1000;
const GRACE_MS = 3000; // network delay allowance on the timer

function shuffled(n, avoidIdentity = false) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  if (avoidIdentity && n >= 2 && a.every((v, i) => v === i)) a.reverse();
  return a;
}

export class Homework {
  constructor({ dir, now = Date.now, maxAssignments = 5000 }) {
    this.dir = path.join(dir, 'assignments');
    fs.mkdirSync(this.dir, { recursive: true });
    this.now = now;
    this.maxAssignments = maxAssignments;
    this.cache = new Map();
    this.sessions = new Map();
  }

  file(id) { return path.join(this.dir, `${id}.json`); }

  load(id) {
    if (!/^[a-z0-9]{10}$/.test(String(id))) return null;
    if (this.cache.has(id)) return this.cache.get(id);
    try {
      const a = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
      this.cache.set(id, a);
      return a;
    } catch { return null; }
  }

  save(a) {
    const tmp = `${this.file(a.id)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(a));
    fs.renameSync(tmp, this.file(a.id));
    this.cache.set(a.id, a);
  }

  count() { try { return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).length; } catch { return 0; } }

  create({ quiz, deadline, settings = {} }) {
    const due = Date.parse(deadline);
    if (!Number.isFinite(due)) return { error: 'Pick a deadline.' };
    if (due < this.now() + 5 * 60 * 1000) return { error: 'The deadline must be in the future.' };
    if (due > this.now() + MAX_AHEAD) return { error: 'The deadline can be at most 90 days away.' };
    if (this.count() >= this.maxAssignments) return { error: 'This server has too many homework quizzes. Try again later.' };
    let id;
    do id = Array.from(crypto.randomBytes(10), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    while (fs.existsSync(this.file(id)));
    const key = crypto.randomBytes(12).toString('hex');
    const a = { id, key, quiz, deadline: new Date(due).toISOString(), created: new Date(this.now()).toISOString(), settings: { shuffleAnswers: !!settings.shuffleAnswers, shuffleQuestions: !!settings.shuffleQuestions }, submissions: [] };
    this.save(a);
    return { id, key, deadline: a.deadline };
  }

  info(id) {
    const a = this.load(id);
    if (!a) return null;
    return { title: a.quiz.title, questions: a.quiz.questions.length, deadline: a.deadline, closed: Date.parse(a.deadline) < this.now() };
  }

  start(id, rawName) {
    const a = this.load(id);
    if (!a) return { error: 'This homework link does not work. Check it with your teacher.' };
    if (Date.parse(a.deadline) < this.now()) return { error: 'The deadline for this homework has passed.' };
    if (a.submissions.length >= MAX_SUBMISSIONS) return { error: 'This homework is full.' };
    const name = cleanName(rawName);
    if (!name) return { error: 'Type your name.' };
    if (isRude(name)) return { error: 'Please use your real name.' };
    this.sweep();
    const n = a.quiz.questions.length;
    const s = {
      sid: crypto.randomBytes(16).toString('hex'), id, name, index: 0, score: 0, streak: 0, answers: [],
      order: a.settings.shuffleQuestions ? shuffled(n) : [...Array(n).keys()], perm: null, sentAt: 0, started: this.now(),
    };
    this.sessions.set(s.sid, s);
    return { sid: s.sid, name, title: a.quiz.title, total: n, question: this.ask(a, s) };
  }

  ask(a, s) {
    const q = a.quiz.questions[s.order[s.index]];
    const n = q.answers ? q.answers.length : q.items ? q.items.length : 0;
    s.perm = q.type === 'order' ? shuffled(n, true) : (a.settings.shuffleAnswers && q.answers ? shuffled(n) : null);
    s.sentAt = this.now();
    return { index: s.index, q: publicQuestion(q, s.perm), image: q.image || null, video: q.video || null };
  }

  answer(sid, index, raw, { timeout = false } = {}) {
    const s = this.sessions.get(String(sid));
    if (!s) return { error: 'Your session ran out. Start again from the homework link.' };
    if (Number(index) !== s.index) return { error: 'That answer arrived twice. Carry on.', stale: true };
    const a = this.load(s.id);
    if (!a) return { error: 'This homework has been removed.' };
    const q = a.quiz.questions[s.order[s.index]];
    const elapsed = this.now() - s.sentAt;
    let answer = null;
    if (!timeout && elapsed <= q.time * 1000 + GRACE_MS) {
      answer = raw;
      if (s.perm) {
        if (q.type === 'order') answer = Array.isArray(raw) && raw.every(i => Number.isInteger(i) && i >= 0 && i < s.perm.length) ? raw.map(i => s.perm[i]) : null;
        else if (Number.isInteger(raw)) answer = s.perm[raw];
      }
      if (q.type === 'type' || q.type === 'cloud') answer = String(answer ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (q.type === 'slider') answer = Number(answer);
      if (!validAnswer(q, answer)) answer = null;
    }
    const scored = TYPES[q.type].scored && q.points !== 'none';
    const correct = answer === null ? (TYPES[q.type].scored ? false : null) : isCorrect(q, answer);
    let points = 0;
    if (scored) {
      s.streak = correct ? s.streak + 1 : 0;
      points = scoreFor(q, { correct, elapsedMs: elapsed, limitMs: q.time * 1000, streak: s.streak }).total;
    }
    s.score += points;
    s.answers[s.order[s.index]] = { answer, correct, points };
    const result = { kind: TYPES[q.type].scored ? 'scored' : 'unscored', answered: answer !== null, correct, points, score: s.score, right: rightAnswerText(q) };
    s.index++;
    if (s.index < s.order.length) return { result, next: this.ask(a, s) };

    this.sessions.delete(s.sid);
    if (a.submissions.length < MAX_SUBMISSIONS) {
      a.submissions.push({ name: s.name, score: s.score, at: new Date(this.now()).toISOString(), answers: s.answers });
      this.save(a);
    }
    const rank = a.submissions.filter(x => x.score > s.score).length + 1;
    return { result, done: { score: s.score, rank, of: a.submissions.length, correct: s.answers.filter(x => x?.correct).length, total: s.order.length } };
  }

  results(id, key) {
    const a = this.load(id);
    if (!a || typeof key !== 'string' || key.length !== a.key.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(a.key))) return null;
    const qs = a.quiz.questions;
    const subs = [...a.submissions].sort((x, y) => y.score - x.score);
    const header = ['Rank', 'Name', 'Score', 'Correct', 'Submitted'];
    qs.forEach((q, i) => header.push(`Q${i + 1} answer`, `Q${i + 1} points`));
    const rows = subs.map((sub, r) => {
      const cells = [];
      qs.forEach((q, i) => { const e = sub.answers[i]; cells.push(e ? answerText(q, e.answer) : '', e ? e.points : ''); });
      return [r + 1, sub.name, sub.score, sub.answers.filter(x => x?.correct).length, sub.at, ...cells];
    });
    const summary = qs.map((q, i) => ({ n: i + 1, text: q.text, type: q.type, right: TYPES[q.type].scored ? subs.filter(s => s.answers[i]?.correct).length : null, of: subs.length, answer: rightAnswerText(q) }));
    return { title: a.quiz.title, deadline: a.deadline, closed: Date.parse(a.deadline) < this.now(), header, rows, summary };
  }

  sweep() {
    const now = this.now();
    for (const [sid, s] of this.sessions) if (now - s.started > SESSION_MS) this.sessions.delete(sid);
  }

  // Remove homework 30 days after its deadline.
  cleanup() {
    const now = this.now();
    let files = [];
    try { files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json')); } catch { return; }
    for (const f of files) {
      const id = f.slice(0, -5);
      const a = this.load(id);
      if (!a || Date.parse(a.deadline) + KEEP_AFTER_DEADLINE < now) {
        try { fs.unlinkSync(this.file(id)); } catch {}
        this.cache.delete(id);
      }
    }
    this.sweep();
  }
}
