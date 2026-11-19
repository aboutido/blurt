// One live game. No sockets in here: the server passes in `send(to, message)`,
// where `to` is 'host' or a player id, so the game can be tested on its own.
import crypto from 'node:crypto';
import { isCorrect, validAnswer, scoreFor, publicQuestion, answerText, rightAnswerText, TYPES } from '../public/quiz.js';
import { isRude, randomName } from './names.js';

export const MAX_PLAYERS = 1000;
const NAME_MAX = 20;
export const TEAMS = [
  { name: 'Red Rockets', color: '#ff4d7d' }, { name: 'Blue Comets', color: '#23b8f0' },
  { name: 'Gold Stars', color: '#ffb020' }, { name: 'Green Geckos', color: '#3ddc84' },
  { name: 'Purple Owls', color: '#a77bff' }, { name: 'Orange Foxes', color: '#ff8a3d' },
];

const NO_RESULT = { answered: false, correct: null, points: 0, bonus: 0 };

export const DEFAULT_SETTINGS = { teams: 0, randomNames: false, shuffleAnswers: false, shuffleQuestions: false, screenOnly: false };

export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// Kept for older callers and tests: plain speed points for a standard question.
export function pointsFor(elapsedMs, limitMs) {
  return scoreFor({ points: 'standard' }, { correct: true, elapsedMs, limitMs, streak: 1 }).base;
}

export function cleanSettings(s = {}) {
  return {
    teams: [0, 2, 3, 4, 5, 6].includes(Number(s.teams)) ? Number(s.teams) : 0,
    randomNames: !!s.randomNames,
    shuffleAnswers: !!s.shuffleAnswers,
    shuffleQuestions: !!s.shuffleQuestions,
    screenOnly: !!s.screenOnly,
  };
}

function shuffled(n, rand, avoidIdentity = false) {
  const a = [...Array(n).keys()];
  for (let tries = 0; tries < 10; tries++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (!avoidIdentity || n < 2 || a.some((v, i) => v !== i)) break;
  }
  if (avoidIdentity && n >= 2 && a.every((v, i) => v === i)) a.reverse();
  return a;
}

export class Room {
  constructor({ pin, quiz, settings, send, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, rand = Math.random }) {
    this.pin = pin;
    this.settings = cleanSettings(settings);
    this.send = send;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.rand = rand;
    const order = this.settings.shuffleQuestions ? shuffled(quiz.questions.length, rand) : [...quiz.questions.keys()];
    this.quiz = { ...quiz, questions: order.map(i => quiz.questions[i]) };
    this.hostKey = crypto.randomBytes(16).toString('hex');
    this.players = new Map();
    this.phase = 'lobby'; // lobby | question | reveal | leaderboard | end
    this.index = -1;
    this.timer = null;
    this.locked = false;
    this.log = []; // one entry per question: { answers: Map(id -> { answer, correct, points, ms }) }
    this.lastActive = now();
  }

  get question() { return this.quiz.questions[this.index]; }
  get isLast() { return this.index >= this.quiz.questions.length - 1; }
  get teamsOn() { return this.settings.teams > 0; }
  connected() { return [...this.players.values()].filter(p => p.connected); }

  ranking() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  rankOf(id) { return this.ranking().findIndex(p => p.id === id) + 1; }

  teamRanking() {
    if (!this.teamsOn) return [];
    const teams = TEAMS.slice(0, this.settings.teams).map((t, i) => ({ ...t, index: i, members: 0, total: 0 }));
    for (const p of this.players.values()) { teams[p.team].members++; teams[p.team].total += p.score; }
    return teams.filter(t => t.members).map(t => ({ name: t.name, color: t.color, index: t.index, members: t.members, score: Math.round(t.total / t.members) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }

  playerList() { return this.ranking().map(p => ({ id: p.id, name: p.name, connected: p.connected, team: this.teamsOn ? p.team : null })); }
  pushPlayers() { this.send('host', { type: 'players', players: this.playerList(), locked: this.locked, teams: this.teamsOn ? TEAMS.slice(0, this.settings.teams) : null }); }

  // ---- players ----

  addPlayer(rawName) {
    if (this.phase === 'end') return { error: 'This game has finished.' };
    if (this.locked) return { error: 'This game is locked. Ask the host to unlock it.' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'This game is full.' };
    const taken = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
    let name;
    if (this.settings.randomNames) name = randomName(taken, this.rand);
    else {
      name = cleanName(rawName);
      if (!name) return { error: 'Pick a nickname.' };
      if (isRude(name)) return { error: 'Please pick a different nickname.' };
      if (taken.has(name.toLowerCase())) return { error: 'That nickname is taken. Try another.' };
    }
    const id = crypto.randomBytes(12).toString('hex');
    let team = 0;
    if (this.teamsOn) {
      const sizes = Array(this.settings.teams).fill(0);
      for (const p of this.players.values()) sizes[p.team]++;
      team = sizes.indexOf(Math.min(...sizes));
    }
    const order = this.phase === 'question' && this.currentOrders ? this.currentOrders.per() : null;
    this.players.set(id, { id, name, team, score: 0, streak: 0, connected: true, answer: null, answeredAt: 0, order, last: { ...NO_RESULT } });
    this.touch();
    this.pushPlayers();
    return { id, name };
  }

  reconnect(id) {
    const p = this.players.get(id);
    if (!p) return null;
    p.connected = true;
    this.touch();
    this.pushPlayers();
    return p;
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    this.pushPlayers();
    if (this.phase === 'question') this.maybeAllAnswered();
  }

  kick(id) {
    if (!this.players.has(id)) return;
    this.send(id, { type: 'kicked' });
    this.players.delete(id);
    this.pushPlayers();
    if (this.phase === 'question') this.maybeAllAnswered();
  }

  teamInfo(p) { return this.teamsOn ? { team: TEAMS[p.team] } : {}; }

  // ---- host controls ----

  setLocked(on) { this.locked = !!on; this.pushPlayers(); }

  start() {
    if (this.phase !== 'lobby') return;
    this.nextQuestion();
  }

  next() {
    if (this.phase === 'question') return this.reveal();
    if (this.phase === 'reveal') return this.isLast ? this.end() : this.leaderboard();
    if (this.phase === 'leaderboard') return this.nextQuestion();
  }

  // Time keeping: the clock only runs while not paused.
  elapsed() { return this.usedMs + (this.paused ? 0 : this.now() - this.runningSince); }
  left() { return Math.max(0, this.limitMs - this.elapsed()); }
  armTimer() { this.clearTimer(this.timer); this.timer = this.setTimer(() => this.reveal(), this.left()); }
  pushTimer() {
    const msg = { type: 'timer', left: Math.ceil(this.left() / 1000), paused: this.paused, limit: Math.round(this.limitMs / 1000) };
    this.send('host', msg);
    for (const p of this.players.values()) this.send(p.id, msg);
  }

  pause() {
    if (this.phase !== 'question' || this.paused) return;
    this.usedMs += this.now() - this.runningSince;
    this.paused = true;
    this.clearTimer(this.timer); this.timer = null;
    this.pushTimer();
  }

  resume() {
    if (this.phase !== 'question' || !this.paused) return;
    this.paused = false;
    this.runningSince = this.now();
    this.armTimer();
    this.pushTimer();
  }

  addTime(seconds = 10) {
    if (this.phase !== 'question') return;
    this.limitMs += Math.min(60, Math.max(1, Number(seconds) || 10)) * 1000;
    if (!this.paused) this.armTimer();
    this.pushTimer();
  }

  // The order answers are shown in. With "screen only", everyone (host included)
  // must see the same order, so the letters on the phones match the big screen.
  orders(q) {
    const n = q.answers ? q.answers.length : q.items ? q.items.length : 0;
    const isOrder = q.type === 'order';
    const shuffle = isOrder || (this.settings.shuffleAnswers && !!q.answers);
    if (!n || !shuffle) return { host: null, per: () => null };
    if (this.settings.screenOnly || !this.settings.shuffleAnswers) {
      const one = shuffled(n, this.rand, isOrder);
      return { host: one, per: () => one };
    }
    const host = isOrder ? shuffled(n, this.rand, true) : null;
    return { host, per: () => shuffled(n, this.rand, isOrder) };
  }

  nextQuestion() {
    this.index++;
    const q = this.question;
    this.phase = 'question';
    this.paused = false;
    this.usedMs = 0;
    this.runningSince = this.now();
    this.limitMs = q.time * 1000;
    const orders = this.orders(q);
    this.currentOrders = orders;
    this.hostOrder = orders.host;
    this.log[this.index] = { answers: new Map() };
    for (const p of this.players.values()) { p.answer = null; p.answeredAt = 0; p.last = { ...NO_RESULT }; p.order = orders.per(); }
    this.armTimer();
    this.touch();
    this.send('host', this.hostQuestion());
    for (const p of this.players.values()) this.send(p.id, this.playerQuestion(p));
  }

  hostQuestion() {
    const q = this.question;
    const answered = [...this.players.values()].filter(x => x.answer !== null).length;
    return {
      type: 'question', index: this.index, total: this.quiz.questions.length,
      q: publicQuestion(q, this.hostOrder), image: q.image || null, video: q.video || null,
      left: Math.ceil(this.left() / 1000), paused: this.paused, answered, of: this.connected().length,
      screenOnly: this.settings.screenOnly,
    };
  }

  playerQuestion(p) {
    const q = this.question;
    const pub = publicQuestion(q, p.order);
    if (this.settings.screenOnly) pub.text = '';
    return { type: 'question', index: this.index, total: this.quiz.questions.length, q: pub, left: Math.ceil(this.left() / 1000), paused: this.paused, screenOnly: this.settings.screenOnly, ...this.teamInfo(p) };
  }

  // Players answer in the order they were shown; map back to the quiz's own order.
  unshuffle(p, q, answer) {
    if (!p.order) return answer;
    if (q.type === 'order') return Array.isArray(answer) ? answer.map(i => p.order[i]) : answer;
    if (q.answers && Number.isInteger(answer)) return p.order[answer];
    return answer;
  }

  answer(id, raw) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'question' || this.paused || p.answer !== null) return;
    const q = this.question;
    if (q.type === 'order' && (!Array.isArray(raw) || raw.length !== q.items.length || raw.some(i => !Number.isInteger(i) || i < 0 || i >= q.items.length))) return;
    let answer = this.unshuffle(p, q, raw);
    if (q.type === 'type' || q.type === 'cloud') answer = String(answer ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (q.type === 'slider') answer = Number(answer);
    if (!validAnswer(q, answer)) return;
    p.answer = answer;
    p.answeredAt = this.elapsed();
    this.touch();
    this.send(id, { type: 'answered' });
    const answered = [...this.players.values()].filter(x => x.answer !== null).length;
    this.send('host', { type: 'answerCount', answered, of: this.connected().length });
    this.maybeAllAnswered();
  }

  maybeAllAnswered() {
    const live = this.connected();
    if (live.length && live.every(p => p.answer !== null)) this.reveal();
  }

  reveal() {
    if (this.phase !== 'question') return;
    this.clearTimer(this.timer);
    this.timer = null;
    this.phase = 'reveal';
    const q = this.question;
    const scored = TYPES[q.type].scored && q.points !== 'none';
    const entries = this.log[this.index].answers;
    for (const p of this.players.values()) {
      const answered = p.answer !== null;
      const correct = answered ? isCorrect(q, p.answer) : (TYPES[q.type].scored ? false : null);
      let s = { base: 0, bonus: 0, total: 0 };
      if (scored) {
        p.streak = correct ? p.streak + 1 : 0;
        s = scoreFor(q, { correct, elapsedMs: p.answeredAt, limitMs: q.time * 1000, streak: p.streak });
      }
      p.score += s.total;
      p.last = { answered, correct, points: s.total, bonus: s.bonus };
      entries.set(p.id, { answer: p.answer, correct, points: s.total, ms: answered ? Math.round(p.answeredAt) : null });
    }
    this.send('host', this.hostReveal());
    for (const p of this.players.values()) this.send(p.id, this.playerResult(p));
  }

  hostReveal() {
    const q = this.question;
    const players = [...this.players.values()];
    const out = { type: 'reveal', index: this.index, q: publicQuestion(q, this.hostOrder), last: this.isLast, right: rightAnswerText(q), answered: players.filter(p => p.answer !== null).length, of: players.length };
    const show = (i) => (this.hostOrder ? this.hostOrder.indexOf(i) : i);
    if (q.answers) {
      const counts = q.answers.map(() => 0);
      for (const p of players) if (p.answer !== null) counts[show(p.answer)]++;
      out.counts = counts;
      if (q.type === 'quiz') out.correct = q.correct.map(show);
    }
    if (q.type === 'type') {
      const tally = new Map();
      for (const p of players) if (p.answer !== null) {
        const key = p.answer.toLowerCase();
        const t = tally.get(key) || { text: p.answer, count: 0, correct: isCorrect(q, p.answer) };
        t.count++; tally.set(key, t);
      }
      out.typed = [...tally.values()].filter(t => t.correct || !isRude(t.text)).sort((a, b) => b.count - a.count).slice(0, 8);
    }
    if (q.type === 'order') { out.items = q.items; out.rightCount = players.filter(p => p.last?.correct).length; }
    if (q.type === 'slider') {
      out.slider = { min: q.min, max: q.max, answer: q.answer, margin: q.margin, unit: q.unit, values: players.filter(p => p.answer !== null).map(p => p.answer).slice(0, 1000) };
    }
    if (q.type === 'cloud') {
      const words = new Map();
      for (const p of players) if (p.answer !== null && !isRude(p.answer)) {
        const key = p.answer.toLowerCase();
        const w = words.get(key) || { word: p.answer, count: 0 };
        w.count++; words.set(key, w);
      }
      out.cloud = [...words.values()].sort((a, b) => b.count - a.count).slice(0, 60);
    }
    return out;
  }

  playerResult(p) {
    const q = this.question;
    return {
      type: 'result', kind: TYPES[q.type].scored ? 'scored' : 'unscored',
      answered: p.last.answered, correct: p.last.correct, points: p.last.points, bonus: p.last.bonus,
      score: p.score, rank: this.rankOf(p.id), streak: p.streak, right: rightAnswerText(q), ...this.teamInfo(p),
    };
  }

  leaderboard() {
    this.phase = 'leaderboard';
    this.send('host', this.hostLeaderboard());
    for (const p of this.players.values()) this.send(p.id, { type: 'standing', rank: this.rankOf(p.id), score: p.score, of: this.players.size, ...this.teamStanding(p) });
  }

  hostLeaderboard() {
    const top = this.ranking().slice(0, 5).map(p => ({ name: p.name, score: p.score, points: p.last?.points || 0, team: this.teamsOn ? TEAMS[p.team] : null }));
    return { type: 'leaderboard', top, teams: this.teamsOn ? this.teamRanking() : null, index: this.index, total: this.quiz.questions.length };
  }

  teamStanding(p) {
    if (!this.teamsOn) return {};
    const teams = this.teamRanking();
    return { team: TEAMS[p.team], teamRank: teams.findIndex(t => t.index === p.team) + 1, teamCount: teams.length };
  }

  end() {
    this.clearTimer(this.timer);
    this.phase = 'end';
    this.send('host', this.hostPodium());
    for (const p of this.players.values()) this.send(p.id, { type: 'final', rank: this.rankOf(p.id), score: p.score, of: this.players.size, ...this.teamStanding(p) });
  }

  hostPodium() {
    const top = this.ranking().slice(0, 5).map(p => ({ name: p.name, score: p.score, team: this.teamsOn ? TEAMS[p.team] : null }));
    return { type: 'podium', top, teams: this.teamsOn ? this.teamRanking() : null, players: this.players.size, results: this.results() };
  }

  // Everything a teacher needs afterwards, as rows for a spreadsheet.
  results() {
    const questions = this.quiz.questions.slice(0, this.index + 1);
    const header = ['Rank', 'Name', ...(this.teamsOn ? ['Team'] : []), 'Score', 'Correct'];
    questions.forEach((q, i) => header.push(`Q${i + 1} answer`, `Q${i + 1} points`));
    const rows = this.ranking().map((p, r) => {
      let right = 0;
      const cells = [];
      questions.forEach((q, i) => {
        const e = this.log[i]?.answers.get(p.id);
        if (e?.correct) right++;
        cells.push(e ? answerText(q, e.answer) : '', e ? e.points : '');
      });
      return [r + 1, p.name, ...(this.teamsOn ? [TEAMS[p.team].name] : []), p.score, right, ...cells];
    });
    const summary = questions.map((q, i) => {
      const all = [...(this.log[i]?.answers.values() || [])];
      const scoredType = TYPES[q.type].scored;
      const right = all.filter(e => e.correct).length;
      return { n: i + 1, text: q.text, type: q.type, right: scoredType ? right : null, of: all.length, answer: rightAnswerText(q) };
    });
    return { title: this.quiz.title, header, rows, summary };
  }

  // What someone who (re)connects should see right now.
  viewFor(id) {
    const p = this.players.get(id);
    const base = { type: 'state', phase: this.phase, title: this.quiz.title, screenOnly: this.settings.screenOnly };
    if (!p) return base;
    const extra = { ...this.teamInfo(p) };
    if (this.phase === 'question') return { ...base, ...extra, question: this.playerQuestion(p), answered: p.answer !== null };
    if (this.phase === 'reveal') return { ...base, ...extra, result: this.playerResult(p) };
    return { ...base, ...extra, score: p.score, rank: this.rankOf(id), of: this.players.size, ...this.teamStanding(p) };
  }

  hostView() {
    return { type: 'hostState', pin: this.pin, title: this.quiz.title, phase: this.phase, players: this.playerList(), locked: this.locked, settings: this.settings, teams: this.teamsOn ? TEAMS.slice(0, this.settings.teams) : null };
  }

  // The last big-screen view, rebuilt fresh (so the timer is right after a reload).
  hostScreen() {
    if (this.phase === 'question') return this.hostQuestion();
    if (this.phase === 'reveal') return this.hostReveal();
    if (this.phase === 'leaderboard') return this.hostLeaderboard();
    if (this.phase === 'end') return this.hostPodium();
    return null;
  }

  touch() { this.lastActive = this.now(); }

  close(reason) {
    this.clearTimer(this.timer);
    for (const p of this.players.values()) this.send(p.id, { type: 'closed', reason });
  }
}
