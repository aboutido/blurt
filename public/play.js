import { h, show, live, LETTERS } from '/common.js';
import { confetti } from '/confetti.js';

const app = document.getElementById('app');
const meEl = document.getElementById('me');
const scoreEl = document.getElementById('score');
const params = new URLSearchParams(location.search);

let me = null;
try { me = JSON.parse(sessionStorage.getItem('blurt-player')); } catch {}
if (me && params.get('pin') && me.pin !== params.get('pin')) me = null;

let conn = null;
let pending = null; // the join request, until the server confirms
let clock = { left: 0, paused: false, timer: null };

if (me) connect();
else nameForm();

function nameForm(error) {
  const urlPin = /^\d{6}$/.test(params.get('pin') || '') ? params.get('pin') : '';
  const pinInput = h('input', { class: `pin-input${urlPin && !error ? ' hidden' : ''}`, inputmode: 'numeric', maxlength: 6, placeholder: 'Game PIN', value: pending?.pin || urlPin, 'aria-label': 'Game PIN', oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); } });
  const name = h('input', { class: 'pin-input', style: 'letter-spacing:0;font-size:24px', maxlength: 20, placeholder: 'Nickname', autocomplete: 'off', 'aria-label': 'Nickname', value: pending?.name || '' });
  const form = h('form', { class: 'stack', style: 'width:100%;max-width:320px', onsubmit: (e) => {
    e.preventDefault();
    if (pinInput.value.length !== 6) { pinInput.classList.remove('hidden'); return pinInput.focus(); }
    pending = { type: 'join', pin: pinInput.value, name: name.value };
    connect();
  } }, pinInput, name, h('button', { class: 'btn', type: 'submit' }, 'Go!'),
    h('small', { class: 'muted' }, 'If the host picked random names, you\'ll be given one.'));
  show(app, h('div', { class: 'logo' }, 'Blurt!'), error ? h('div', { class: 'error' }, error) : null, form);
  (urlPin ? name : pinInput).focus();
}

function connect() {
  if (conn) conn.stop();
  conn = live({
    hello: () => me ? { type: 'rejoin', pin: me.pin, id: me.id } : pending,
    onStatus: (s) => { if (s === 'closed' && me) scoreEl.textContent = 'Reconnecting...'; },
    onMessage: handle,
  });
}

function handle(m) {
  if (m.type === 'error') {
    conn.stop(); conn = null;
    if (m.gone) { sessionStorage.removeItem('blurt-player'); me = null; }
    return nameForm(m.error);
  }
  if (m.type === 'joined') {
    me = { pin: m.pin, id: m.id, name: m.name };
    sessionStorage.setItem('blurt-player', JSON.stringify(me));
    meEl.textContent = m.name;
    pending = null;
    return;
  }
  if (m.type === 'state') return restore(m);
  if (m.type === 'question') return question(m);
  if (m.type === 'timer') { clock.left = m.left; clock.paused = m.paused; drawClock(); return; }
  if (m.type === 'answered') return locked();
  if (m.type === 'result') return result(m);
  if (m.type === 'standing') return standing(m);
  if (m.type === 'final') return final(m);
  if (m.type === 'kicked' || m.type === 'closed') {
    sessionStorage.removeItem('blurt-player'); me = null;
    stopClock(); conn.stop(); conn = null;
    show(app, h('h2', {}, m.type === 'kicked' ? 'The host removed you from the game.' : (m.reason || 'The game has ended.')), h('a', { class: 'btn', href: '/' }, 'Home'));
  }
}

function setTop(score, team) {
  scoreEl.textContent = score != null ? `${score.toLocaleString()} pts` : '';
  meEl.replaceChildren(document.createTextNode(me?.name || ''), team ? h('span', { class: 'team-tag', style: `background:${team.color}` }, team.name) : '');
}

function restore(s) {
  if (s.phase === 'lobby') return waiting(s.team);
  if (s.phase === 'question') return s.answered ? locked() : question(s.question);
  if (s.phase === 'reveal') return result(s.result);
  if (s.phase === 'leaderboard') return standing(s);
  if (s.phase === 'end') return final(s);
}

function waiting(team) {
  setTop(null, team);
  show(app, h('div', { class: 'verdict' }, "You're in!"),
    team ? h('div', { class: 'bigpts', style: `background:${team.color};color:#fff` }, `Team ${team.name}`) : null,
    h('p', { class: 'muted' }, 'See your name on the big screen? Wait for the host to start.'));
}

// ---- clock ----

function stopClock() { clearInterval(clock.timer); clock.timer = null; }
function startClock(left, paused) {
  stopClock();
  clock.left = left; clock.paused = paused;
  drawClock();
  clock.timer = setInterval(() => { if (!clock.paused && clock.left > 0) { clock.left--; drawClock(); } }, 1000);
}
function drawClock() {
  const el = document.getElementById('pclock');
  if (el) el.textContent = clock.paused ? '❚❚ Paused' : `${Math.max(0, clock.left)}s`;
  document.body.classList.toggle('paused', !!clock.paused);
}

// ---- answering ----

const send = (answer) => conn.send({ type: 'answer', answer });

function question(m) {
  if (navigator.vibrate) navigator.vibrate(30);
  setTop(scoreEl.dataset.score ? Number(scoreEl.dataset.score) : null, m.team);
  const q = m.q;
  const head = h('div', { class: 'row spread', style: 'width:100%' }, h('span', { class: 'muted' }, `Question ${m.index + 1} of ${m.total}`), h('span', { class: 'pill on', id: 'pclock' }, ''));
  const text = q.text ? h('div', { class: 'q-small' }, q.text) : h('div', { class: 'muted' }, q.type === 'quiz' || q.type === 'poll' ? 'Look at the big screen' : 'The question is on the big screen');
  show(app, head, q.points === 'double' ? h('span', { class: 'badge' }, '2× points') : null, text, answerInput(q, m.screenOnly));
  startClock(m.left, m.paused);
}

function answerInput(q, screenOnly) {
  if (q.answers) {
    const buttons = q.answers.map((a, i) => h('button', { class: `answer rise${screenOnly ? ' big-letter' : ''}`, style: `animation-delay:${i * 60}ms`, 'aria-label': screenOnly ? `Answer ${LETTERS[i]}` : a, onclick: () => {
      buttons.forEach(b => { b.disabled = true; if (b !== buttons[i]) b.classList.add('wrong'); });
      send(i);
    } }, h('span', { class: 'letter' }, LETTERS[i]), screenOnly ? null : h('span', {}, a)));
    return h('div', { class: `answers${screenOnly ? ' grid-2' : ''}` }, buttons);
  }
  if (q.type === 'type' || q.type === 'cloud') {
    const input = h('input', { type: 'text', class: 'pin-input', style: 'letter-spacing:0;font-size:22px', maxlength: q.type === 'cloud' ? 24 : 40, autocomplete: 'off', autocapitalize: 'off', placeholder: q.type === 'cloud' ? 'A word or two' : 'Your answer' });
    setTimeout(() => input.focus(), 50);
    return h('form', { class: 'stack', style: 'width:100%;max-width:360px', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) send(input.value.trim()); } }, input, h('button', { class: 'btn', type: 'submit' }, 'Send'));
  }
  if (q.type === 'slider') {
    const mid = q.min + Math.round((q.max - q.min) / 2 / q.step) * q.step;
    const out = h('div', { class: 'verdict' }, fmt(mid, q.unit));
    const range = h('input', { type: 'range', min: q.min, max: q.max, step: q.step, value: mid, class: 'range', 'aria-label': 'Your answer', oninput: (e) => { out.textContent = fmt(Number(e.target.value), q.unit); } });
    return h('div', { class: 'stack', style: 'width:100%;max-width:420px;align-items:center' }, out, range,
      h('div', { class: 'row spread', style: 'width:100%' }, h('span', { class: 'muted' }, fmt(q.min, q.unit)), h('span', { class: 'muted' }, fmt(q.max, q.unit))),
      h('button', { class: 'btn', onclick: () => send(Number(range.value)) }, 'Lock it in'));
  }
  if (q.type === 'order') {
    const picked = [];
    const slots = h('div', { class: 'stack', style: 'width:100%' });
    const pool = h('div', { class: 'answers' });
    const go = h('button', { class: 'btn', disabled: true, onclick: () => send([...picked]) }, 'Lock it in');
    const redraw = () => {
      show(slots, q.items.map((_, k) => h('div', { class: `slot${picked[k] != null ? ' filled' : ''}` }, h('span', { class: 'pos' }, k + 1), picked[k] != null ? q.items[picked[k]] : '')));
      show(pool, q.items.map((it, i) => h('button', { class: 'answer', disabled: picked.includes(i), onclick: () => { picked.push(i); redraw(); } }, h('span', { class: 'letter' }, LETTERS[i]), h('span', {}, it))));
      go.disabled = picked.length !== q.items.length;
    };
    redraw();
    return h('div', { class: 'stack', style: 'width:100%;align-items:center' },
      h('p', { class: 'muted' }, 'Tap them in the right order, first one first.'), slots, pool,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => { picked.length = 0; redraw(); } }, 'Start again'), go));
  }
  return null;
}

const fmt = (n, unit) => `${Math.abs(Number(n)) >= 10000 ? Number(n).toLocaleString() : String(Number(n))}${unit ? ` ${unit}` : ''}`;

function locked() {
  stopClock();
  show(app, h('div', { class: 'verdict' }, 'Locked in!'), h('p', { class: 'muted' }, 'Waiting for everyone else...'));
}

function result(r) {
  stopClock();
  scoreEl.dataset.score = r.score;
  setTop(r.score, r.team);
  if (r.kind === 'unscored') {
    return show(app, h('div', { class: 'verdict' }, r.answered ? 'Thanks!' : 'Missed that one'), h('p', { class: 'muted' }, 'See what everyone said on the big screen.'));
  }
  if (navigator.vibrate) navigator.vibrate(r.correct ? [40, 60, 40] : 150);
  show(app,
    h('div', { class: `verdict ${r.correct ? 'good' : 'bad'}` }, r.correct ? 'Correct!' : r.answered ? 'Not this time' : "Time's up"),
    r.correct ? h('div', { class: 'bigpts rise' }, `+${r.points}`) : h('p', {}, 'The answer was ', h('strong', {}, r.right)),
    r.bonus ? h('p', {}, `🔥 ${r.streak} in a row: +${r.bonus} streak bonus`) : null,
    h('p', { class: 'muted' }, `You're in place ${r.rank}`));
}

function standing(s) {
  setTop(s.score, s.team);
  show(app, h('div', { class: 'verdict' }, `Place ${s.rank}`), h('p', { class: 'muted' }, `out of ${s.of}. Eyes on the big screen.`),
    s.team ? h('p', {}, `Your team, ${s.team.name}, is ${ordinal(s.teamRank)} of ${s.teamCount}.`) : null);
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;

function final(s) {
  stopClock();
  setTop(s.score, s.team);
  sessionStorage.removeItem('blurt-player');
  const msg = s.rank === 1 ? 'You won! 🏆' : s.rank <= 3 ? `On the podium: place ${s.rank}` : `You came ${ordinal(s.rank)} of ${s.of}`;
  show(app, h('div', { class: 'verdict' }, msg), h('div', { class: 'bigpts' }, `${(s.score || 0).toLocaleString()} points`),
    s.team ? h('p', {}, s.teamRank === 1 ? `Your team, ${s.team.name}, won! 🎉` : `Your team, ${s.team.name}, came ${ordinal(s.teamRank)}.`) : null,
    h('a', { class: 'btn ghost', href: '/' }, 'Play another'));
  if (s.rank === 1 || s.teamRank === 1) confetti({ count: 120 });
}
