import { h, show, toast, live, LETTERS, downloadCsv, slug, qrImage, youtubeEmbed } from '/common.js';
import { sound } from '/sound.js';
import { confetti } from '/confetti.js';

const app = document.getElementById('app');
const statusEl = document.getElementById('status');
const endBtn = document.getElementById('end');
const muteBtn = document.getElementById('mute');
const lockBtn = document.getElementById('lock');

const read = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
let session = read('blurt-host-session');
const quiz = read('blurt-host-quiz');
const settings = read('blurt-host-settings') || {};

let pin = session?.pin || null;
let players = [];
let teams = null;
let locked = false;
let view = '';
let conn = null;
let clock = { left: 0, limit: 0, paused: false, timer: null };
let lastPlayerCount = 0;

// Sound needs a click first. The first click anywhere on the page turns it on.
document.addEventListener('click', () => { sound.unlock(); if (view === 'lobby') sound.lobby(); }, { once: true });
const setMute = () => { muteBtn.textContent = sound.muted ? '🔇' : '🔊'; muteBtn.title = sound.muted ? 'Sound off' : 'Sound on'; };
setMute();
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); sound.unlock(); sound.toggle(); setMute(); if (!sound.muted && view === 'lobby') sound.lobby(); });
lockBtn.addEventListener('click', () => conn?.send({ type: 'lock', on: !locked }));

if (!session && !quiz) {
  show(app, h('div', { class: 'center' }, h('h1', {}, 'No quiz to host'), h('a', { class: 'btn', href: '/create' }, 'Pick a quiz')));
} else {
  conn = live({
    hello: () => session ? { type: 'rehost', pin: session.pin, hostKey: session.hostKey } : { type: 'host', quiz, settings },
    onStatus: (s) => { statusEl.textContent = s === 'open' ? '' : 'Reconnecting...'; },
    onMessage: handle,
  });
  endBtn.addEventListener('click', () => {
    if (!window.confirm('End the game for everyone?')) return;
    conn.send({ type: 'end' });
    sessionStorage.removeItem('blurt-host-session');
    conn.stop(); sound.stop();
    location.href = '/create';
  });
}

function handle(m) {
  if (m.type === 'error') {
    if (m.gone) { sessionStorage.removeItem('blurt-host-session'); session = null; }
    show(app, h('div', { class: 'center' }, h('div', { class: 'error' }, m.error), h('a', { class: 'btn', href: '/create' }, 'Back to quizzes')));
    conn.stop();
    return;
  }
  if (m.type === 'hosted') {
    pin = m.pin;
    session = { pin: m.pin, hostKey: m.hostKey };
    sessionStorage.setItem('blurt-host-session', JSON.stringify(session));
    endBtn.classList.remove('hidden'); lockBtn.classList.remove('hidden');
    document.title = `Blurt: ${m.title}`;
    return;
  }
  if (m.type === 'hostState') {
    players = m.players; teams = m.teams; setLocked(m.locked);
    if (m.phase === 'lobby') lobby();
    return;
  }
  if (m.type === 'players') {
    if (m.players.length > lastPlayerCount && view === 'lobby') sound.join();
    lastPlayerCount = m.players.length;
    players = m.players; teams = m.teams; setLocked(m.locked);
    if (view === 'lobby') lobby();
    return;
  }
  if (m.type === 'question') return question(m);
  if (m.type === 'timer') { clock.left = m.left; clock.paused = m.paused; clock.limit = m.limit; drawClock(); syncPauseButton(); return; }
  if (m.type === 'answerCount') { const c = document.getElementById('count'); if (c) c.firstChild.textContent = m.answered; sound.answer(); return; }
  if (m.type === 'reveal') return reveal(m);
  if (m.type === 'leaderboard') return leaderboard(m);
  if (m.type === 'podium') return podium(m);
}

function setLocked(on) {
  locked = !!on;
  lockBtn.textContent = locked ? '🔒 Locked' : '🔓 Open';
  lockBtn.title = locked ? 'Nobody new can join. Click to open.' : 'New players can join. Click to lock.';
}

// ---- lobby ----

function lobby() {
  view = 'lobby';
  stopClock();
  const url = `${location.host}`;
  const joinLink = `${location.origin}/play?pin=${pin}`;
  const live = players.filter(p => p.connected);
  const teamOf = (p) => (teams && p.team != null ? teams[p.team] : null);
  show(app, h('div', { class: 'q-stage' },
    h('div', { class: 'join-banner' },
      h('div', { class: 'stack', style: 'gap:4px' }, h('div', { class: 'muted' }, 'Go to'), h('div', { class: 'display', style: 'font-size:30px' }, url), h('div', { class: 'muted' }, 'and enter the PIN')),
      h('div', {}, h('div', { class: 'muted' }, 'Game PIN'), h('div', { class: 'big-pin' }, pin.replace(/(\d{3})(\d{3})/, '$1 $2'))),
      qrImage(joinLink, 5)),
    h('div', { class: 'row', style: 'gap:18px' },
      h('div', { class: 'counter' }, live.length, h('small', {}, live.length === 1 ? 'player' : 'players')),
      h('button', { class: 'btn', disabled: !live.length, onclick: () => { sound.unlock(); conn.send({ type: 'start' }); } }, 'Start')),
    teams ? h('div', { class: 'team-cols' }, teams.map((t, i) => h('div', { class: 'team-col', style: `--team:${t.color}` },
      h('div', { class: 'team-name' }, t.name),
      h('div', { class: 'chips' }, players.filter(p => p.team === i).map(chip))))) :
    players.length ? h('div', { class: 'chips' }, players.map(chip)) : h('p', { class: 'muted' }, 'Waiting for players...'),
    players.length ? h('p', { class: 'muted', style: 'font-size:13px' }, 'Click a name to remove it.') : null,
    sound.muted ? null : h('p', { class: 'muted', style: 'font-size:13px' }, 'Click anywhere for music.')));

  function chip(p) {
    const t = teamOf(p);
    return h('button', { class: `chip${p.connected ? '' : ' off'}`, style: t ? `border-color:${t.color}` : null, title: 'Click to remove', onclick: () => { if (window.confirm(`Remove ${p.name}?`)) conn.send({ type: 'kick', id: p.id }); } }, p.name);
  }
}

// ---- the clock ----

function stopClock() { clearInterval(clock.timer); clock.timer = null; }

function startClock(left, limit, paused) {
  stopClock();
  Object.assign(clock, { left, limit, paused });
  drawClock();
  clock.timer = setInterval(() => {
    if (clock.paused || clock.left <= 0) return;
    clock.left--;
    if (clock.left <= 5 && clock.left > 0) sound.tick(true);
    if (clock.left === 0) { sound.stop(); sound.timesUp(); }
    drawClock();
  }, 1000);
}

function drawClock() {
  const el = document.getElementById('timer');
  if (!el) return;
  el.style.setProperty('--p', `${clock.limit ? (clock.left / clock.limit) * 100 : 0}%`);
  el.firstChild.textContent = clock.paused ? '❚❚' : Math.max(0, clock.left);
  el.classList.toggle('low', !clock.paused && clock.left <= 5);
}

function syncPauseButton() {
  const b = document.getElementById('pause');
  if (b) b.textContent = clock.paused ? '▶ Resume' : '❚❚ Pause';
  if (clock.paused) sound.stop(); else if (view === 'question' && clock.left > 0) sound.thinking();
}

// ---- a question ----

function media(m) {
  if (m.video) return h('iframe', { class: 'q-video', src: youtubeEmbed(m.video), title: 'Video', allow: 'autoplay; encrypted-media', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
  if (m.image) return h('img', { class: 'q-img', src: m.image, alt: '', referrerpolicy: 'no-referrer' });
  return h('div');
}

function question(m) {
  view = 'question';
  const q = m.q;
  sound.stop(); if (!m.paused) sound.thinking();
  show(app, h('div', { class: 'q-stage' },
    h('div', { class: 'row muted' }, `Question ${m.index + 1} of ${m.total}`, q.points === 'double' ? h('span', { class: 'badge' }, '2× points') : null),
    h('div', { class: 'q-text rise' }, q.text),
    h('div', { class: 'q-mid' },
      h('div', { class: 'timer', id: 'timer' }, h('span', {}, m.left)),
      media(m),
      h('div', { class: 'counter', id: 'count' }, String(m.answered ?? 0), h('small', {}, 'answers'))),
    questionBody(q),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost small', id: 'pause', onclick: () => conn.send({ type: clock.paused ? 'resume' : 'pause' }) }, m.paused ? '▶ Resume' : '❚❚ Pause'),
      h('button', { class: 'btn ghost small', onclick: () => conn.send({ type: 'addTime', seconds: 10 }) }, '+10 sec'),
      h('button', { class: 'btn ghost small', onclick: () => conn.send({ type: 'next' }) }, 'Skip'))));
  startClock(m.left, q.time, m.paused);
}

function questionBody(q) {
  if (q.answers) return h('div', { class: 'answers' }, q.answers.map((a, i) => h('div', { class: 'answer rise', style: `animation-delay:${i * 80}ms` }, h('span', { class: 'letter' }, LETTERS[i]), h('span', {}, a))));
  if (q.type === 'order') return h('div', { class: 'stack', style: 'width:100%;max-width:760px' },
    h('p', { class: 'muted center-text' }, 'Put these in the right order on your phone'),
    h('div', { class: 'answers' }, q.items.map((a, i) => h('div', { class: 'answer rise', style: `animation-delay:${i * 80}ms` }, h('span', { class: 'letter' }, LETTERS[i]), h('span', {}, a)))));
  if (q.type === 'slider') return h('div', { class: 'slider-show' }, h('span', {}, fmt(q.min, q.unit)), h('div', { class: 'slider-track' }), h('span', {}, fmt(q.max, q.unit)));
  if (q.type === 'type') return h('div', { class: 'type-show' }, '⌨️ Type your answer on your phone');
  if (q.type === 'cloud') return h('div', { class: 'type-show' }, '☁️ Type a word or two on your phone');
  return null;
}

const fmt = (n, unit) => `${Math.abs(Number(n)) >= 10000 ? Number(n).toLocaleString() : String(Number(n))}${unit ? ` ${unit}` : ''}`;

// ---- the answer ----

function reveal(m) {
  view = 'reveal';
  stopClock(); sound.stop(); sound.reveal();
  const q = m.q;
  show(app, h('div', { class: 'q-stage' },
    h('div', { class: 'q-text' }, q.text),
    revealBody(m),
    h('div', { class: 'muted' }, `${m.answered} of ${m.of} answered`),
    h('button', { class: 'btn', onclick: () => conn.send({ type: 'next' }) }, m.last ? 'See the winners' : 'Next')));
}

function revealBody(m) {
  const q = m.q;
  if (q.answers) {
    const total = Math.max(1, m.counts.reduce((a, b) => a + b, 0));
    const right = m.correct || [];
    return h('div', { class: 'answers' }, q.answers.map((a, i) => {
      const isRight = q.type === 'poll' || right.includes(i);
      return h('div', { class: `answer ${q.type === 'poll' ? '' : isRight ? 'right' : 'wrong'}` },
        h('div', { class: 'bar', style: `width:${(m.counts[i] / total) * 100}%` }),
        h('span', { class: 'letter' }, q.type === 'quiz' && isRight ? '✓' : LETTERS[i]), h('span', {}, a),
        h('span', { class: 'count' }, q.type === 'poll' ? `${Math.round((m.counts[i] / total) * 100)}%` : m.counts[i]));
    }));
  }
  if (q.type === 'type') return h('div', { class: 'stack', style: 'width:100%;max-width:760px;align-items:center' },
    h('div', { class: 'right-answer' }, '✓ ', m.right),
    h('div', { class: 'board' }, m.typed.map(t => h('div', { class: 'board-row' }, h('span', {}, t.correct ? '✓' : '✗'), h('span', {}, t.text), h('span', { class: 'score' }, t.count)))));
  if (q.type === 'order') return h('div', { class: 'stack', style: 'width:100%;max-width:760px;align-items:center' },
    h('div', { class: 'board' }, m.items.map((it, i) => h('div', { class: 'board-row', style: `animation-delay:${i * 120}ms` }, h('span', { class: 'pos' }, i + 1), h('span', {}, it)))),
    h('div', { class: 'counter' }, m.rightCount, h('small', {}, 'got the order right')));
  if (q.type === 'slider') return sliderReveal(m.slider);
  if (q.type === 'cloud') return wordCloud(m.cloud);
  return null;
}

function sliderReveal(s) {
  const span = s.max - s.min || 1;
  const pos = (v) => `${((v - s.min) / span) * 100}%`;
  const near = s.values.filter(v => Math.abs(v - s.answer) <= s.margin + 1e-9).length;
  return h('div', { class: 'stack', style: 'width:100%;max-width:900px;align-items:center' },
    h('div', { class: 'right-answer' }, '✓ ', fmt(s.answer, s.unit)),
    h('div', { class: 'slider-reveal' },
      h('div', { class: 'band', style: `left:${pos(Math.max(s.min, s.answer - s.margin))};width:${((Math.min(s.max, s.answer + s.margin) - Math.max(s.min, s.answer - s.margin)) / span) * 100}%` }),
      s.values.map(v => h('div', { class: 'dot', style: `left:${pos(v)}` })),
      h('div', { class: 'mark', style: `left:${pos(s.answer)}` })),
    h('div', { class: 'row spread', style: 'width:100%' }, h('span', { class: 'muted' }, fmt(s.min, s.unit)), h('span', { class: 'muted' }, fmt(s.max, s.unit))),
    h('div', { class: 'counter' }, near, h('small', {}, 'close enough')));
}

function wordCloud(words) {
  if (!words.length) return h('p', { class: 'muted' }, 'No words this time.');
  const most = words[0].count;
  const colors = ['var(--a)', 'var(--b)', 'var(--c)', 'var(--d)', 'var(--spot)', '#a77bff'];
  // Biggest words in the middle.
  const sorted = [...words];
  const arranged = [];
  sorted.forEach((w, i) => (i % 2 ? arranged.push(w) : arranged.unshift(w)));
  return h('div', { class: 'cloud' }, arranged.map((w, i) => h('span', {
    class: 'rise', title: `${w.count}`,
    style: `font-size:${18 + (w.count / most) * 54}px;color:${colors[i % colors.length]};animation-delay:${i * 40}ms`,
  }, w.word)));
}

// ---- scores ----

function teamBoard(list) {
  return h('div', { class: 'board' }, list.map((t, i) => h('div', { class: 'board-row', style: `animation-delay:${i * 90}ms;border-color:${t.color}` },
    h('span', { class: 'pos' }, i + 1), h('span', { class: 'swatch', style: `background:${t.color}` }), h('span', {}, t.name),
    h('span', { class: 'muted', style: 'font-size:14px' }, `${t.members} player${t.members === 1 ? '' : 's'}`),
    h('span', { class: 'score' }, t.score.toLocaleString()))));
}

function leaderboard(m) {
  view = 'leaderboard';
  sound.stop();
  show(app, h('div', { class: 'q-stage' },
    m.teams ? h('h1', {}, 'Team scores') : h('h1', {}, 'Leaderboard'),
    m.teams ? teamBoard(m.teams) : null,
    m.teams ? h('h2', { class: 'muted', style: 'font-size:20px' }, 'Top players') : null,
    h('div', { class: 'board' }, m.top.length ? m.top.map((p, i) => h('div', { class: 'board-row', style: `animation-delay:${i * 90}ms${p.team ? `;border-color:${p.team.color}` : ''}` },
      h('span', { class: 'pos' }, i + 1), h('span', {}, p.name), h('span', { class: 'score' }, p.score.toLocaleString()),
      p.points ? h('span', { class: 'plus' }, `+${p.points}`) : null)) : h('p', { class: 'muted' }, 'Nobody scored yet.')),
    h('button', { class: 'btn', onclick: () => conn.send({ type: 'next' }) }, `Question ${m.index + 2} of ${m.total}`)));
}

function podium(m) {
  view = 'podium';
  stopClock();
  sessionStorage.removeItem('blurt-host-session');
  endBtn.classList.add('hidden'); lockBtn.classList.add('hidden');
  const entries = m.teams ? m.teams.map(t => ({ name: t.name, score: t.score, color: t.color })) : m.top;
  const [p1, p2, p3] = entries;
  const step = (p, cls, place) => p ? h('div', { class: `step ${cls}`, style: p.color ? `background:${p.color};color:#fff` : null }, h('div', { class: 'place' }, place), h('div', { class: 'who' }, p.name), h('div', { class: 'pts' }, p.score.toLocaleString())) : h('div', { class: `step ${cls} empty` });
  const hard = m.results.summary.filter(s => s.right != null && s.of).sort((a, b) => a.right / a.of - b.right / b.of).slice(0, 3);
  show(app, h('div', { class: 'q-stage' },
    h('h1', { style: 'font-size:clamp(36px,6vw,64px)' }, m.teams ? 'And the winning team is...' : 'And the winner is...'),
    h('div', { class: 'podium' }, step(p2, 'p2', 2), step(p1, 'p1', 1), step(p3, 'p3', 3)),
    m.teams && m.top[0] ? h('p', { class: 'muted' }, `Top player: ${m.top[0].name} with ${m.top[0].score.toLocaleString()} points`) : null,
    !m.teams && m.top.length > 3 ? h('div', { class: 'board' }, m.top.slice(3).map((p, i) => h('div', { class: 'board-row' }, h('span', { class: 'pos' }, i + 4), h('span', {}, p.name), h('span', { class: 'score' }, p.score.toLocaleString())))) : null,
    hard.length ? h('div', { class: 'card stack', style: 'max-width:760px;width:100%' },
      h('strong', {}, 'Worth going over again'),
      hard.map(s => h('div', { class: 'row spread' }, h('span', {}, `Q${s.n}. ${s.text}`), h('span', { class: 'muted' }, `${s.right} of ${s.of} right`)))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => downloadCsv(`${slug(m.results.title)}-results.csv`, [m.results.header, ...m.results.rows]) }, 'Download results'),
      h('button', { class: 'btn ghost', onclick: () => { sessionStorage.removeItem('blurt-host-session'); location.reload(); } }, 'Play again'),
      h('a', { class: 'btn ghost', href: '/create' }, 'Another quiz'))));
  sound.stop(); sound.drumroll(1400);
  setTimeout(() => { sound.fanfare(); confetti(); }, 1500);
}
