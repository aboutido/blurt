// Homework: one student, their own pace, answers checked on the server.
import { h, show, api, LETTERS, youtubeEmbed } from '/common.js';
import { confetti } from '/confetti.js';

const app = document.getElementById('app');
const meEl = document.getElementById('me');
const scoreEl = document.getElementById('score');
const id = new URLSearchParams(location.search).get('a') || '';
let session = null; let total = 0; let clock = null; let busy = false;

start();

async function start() {
  const info = await api('/homework/info', { id });
  if (info.error) return show(app, h('div', { class: 'logo' }, 'Blurt!'), h('div', { class: 'error' }, info.error));
  const due = new Date(info.deadline);
  if (info.closed) return show(app, h('div', { class: 'logo' }, 'Blurt!'), h('h2', {}, info.title), h('div', { class: 'error' }, `This homework closed on ${due.toLocaleString()}.`));
  const name = h('input', { class: 'pin-input', style: 'letter-spacing:0;font-size:24px', maxlength: 20, placeholder: 'Your name', autocomplete: 'name', 'aria-label': 'Your name' });
  const err = h('div');
  show(app, h('div', { class: 'logo' }, 'Blurt!'), h('h2', {}, info.title),
    h('p', { class: 'muted' }, `${info.questions} questions · due ${due.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`),
    h('p', { class: 'muted', style: 'max-width:36ch' }, 'Each question has a timer, and faster right answers score more. You can\'t pause, so find a quiet moment.'),
    err,
    h('form', { class: 'stack', style: 'width:100%;max-width:320px', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return name.focus();
      const res = await api('/homework/start', { id, name: name.value });
      if (res.error) return show(err, h('div', { class: 'error' }, res.error));
      session = res.sid; total = res.total;
      meEl.textContent = res.name; scoreEl.textContent = '0 pts';
      ask(res.question);
    } }, name, h('button', { class: 'btn', type: 'submit' }, 'Start')));
  name.focus();
}

function ask(next) {
  const q = next.q; busy = false;
  let left = q.time;
  const clockEl = h('span', { class: 'pill on' }, `${left}s`);
  clearInterval(clock);
  clock = setInterval(() => { left--; clockEl.textContent = `${Math.max(0, left)}s`; if (left <= 0) { clearInterval(clock); submit(next.index, null, true); } }, 1000);
  const mediaEl = next.video ? h('iframe', { class: 'q-video small', src: youtubeEmbed(next.video), title: 'Video', allow: 'autoplay; encrypted-media', allowfullscreen: true })
    : next.image ? h('img', { class: 'q-img', src: next.image, alt: '', referrerpolicy: 'no-referrer' }) : null;
  show(app,
    h('div', { class: 'row spread', style: 'width:100%' }, h('span', { class: 'muted' }, `Question ${next.index + 1} of ${total}`), clockEl),
    q.points === 'double' ? h('span', { class: 'badge' }, '2× points') : null,
    h('div', { class: 'q-small' }, q.text), mediaEl, input(q, (a) => submit(next.index, a)));
}

function input(q, done) {
  if (q.answers) {
    const buttons = q.answers.map((a, i) => h('button', { class: 'answer', onclick: () => { buttons.forEach(b => { b.disabled = true; if (b !== buttons[i]) b.classList.add('wrong'); }); done(i); } }, h('span', { class: 'letter' }, LETTERS[i]), h('span', {}, a)));
    return h('div', { class: 'answers' }, buttons);
  }
  if (q.type === 'type' || q.type === 'cloud') {
    const box = h('input', { type: 'text', class: 'pin-input', style: 'letter-spacing:0;font-size:22px', maxlength: 40, autocomplete: 'off', placeholder: 'Your answer' });
    setTimeout(() => box.focus(), 50);
    return h('form', { class: 'stack', style: 'width:100%;max-width:360px', onsubmit: (e) => { e.preventDefault(); if (box.value.trim()) done(box.value.trim()); } }, box, h('button', { class: 'btn', type: 'submit' }, 'Send'));
  }
  if (q.type === 'slider') {
    const mid = q.min + Math.round((q.max - q.min) / 2 / q.step) * q.step;
    const out = h('div', { class: 'verdict' }, fmt(mid, q.unit));
    const range = h('input', { type: 'range', class: 'range', min: q.min, max: q.max, step: q.step, value: mid, oninput: (e) => { out.textContent = fmt(Number(e.target.value), q.unit); } });
    return h('div', { class: 'stack', style: 'width:100%;max-width:420px;align-items:center' }, out, range, h('button', { class: 'btn', onclick: () => done(Number(range.value)) }, 'Lock it in'));
  }
  if (q.type === 'order') {
    const picked = []; const slots = h('div', { class: 'stack', style: 'width:100%' }); const pool = h('div', { class: 'answers' });
    const go = h('button', { class: 'btn', disabled: true, onclick: () => done([...picked]) }, 'Lock it in');
    const redraw = () => {
      show(slots, q.items.map((_, k) => h('div', { class: `slot${picked[k] != null ? ' filled' : ''}` }, h('span', { class: 'pos' }, k + 1), picked[k] != null ? q.items[picked[k]] : '')));
      show(pool, q.items.map((it, i) => h('button', { class: 'answer', disabled: picked.includes(i), onclick: () => { picked.push(i); redraw(); } }, h('span', { class: 'letter' }, LETTERS[i]), h('span', {}, it))));
      go.disabled = picked.length !== q.items.length;
    };
    redraw();
    return h('div', { class: 'stack', style: 'width:100%;align-items:center' }, h('p', { class: 'muted' }, 'Tap them in the right order.'), slots, pool,
      h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => { picked.length = 0; redraw(); } }, 'Start again'), go));
  }
  return null;
}

const fmt = (n, unit) => `${Math.abs(Number(n)) >= 10000 ? Number(n).toLocaleString() : String(Number(n))}${unit ? ` ${unit}` : ''}`;

async function submit(index, answer, timeout = false) {
  if (busy) return; busy = true;
  clearInterval(clock);
  const res = await api('/homework/answer', { sid: session, index, answer, timeout });
  if (res.stale) return;
  if (res.error) return show(app, h('div', { class: 'error' }, res.error), h('a', { class: 'btn', href: location.href }, 'Start again'));
  scoreEl.textContent = `${res.result.score.toLocaleString()} pts`;
  const r = res.result;
  show(app,
    r.kind === 'unscored' ? h('div', { class: 'verdict' }, 'Thanks!') : h('div', { class: `verdict ${r.correct ? 'good' : 'bad'}` }, r.correct ? 'Correct!' : r.answered ? 'Not this time' : "Time's up"),
    r.correct ? h('div', { class: 'bigpts' }, `+${r.points}`) : r.kind === 'scored' ? h('p', {}, 'The answer was ', h('strong', {}, r.right)) : null,
    h('button', { class: 'btn', onclick: () => (res.next ? ask(res.next) : finish(res.done)) }, res.next ? 'Next question' : 'See my score'));
}

function finish(d) {
  show(app, h('div', { class: 'verdict' }, 'All done! 🎉'), h('div', { class: 'bigpts' }, `${d.score.toLocaleString()} points`),
    h('p', {}, `You got ${d.correct} of ${d.total} right.`), h('p', { class: 'muted' }, `So far you're ${d.rank} of ${d.of}. Your teacher can see your answers.`));
  confetti({ count: 120 });
}
