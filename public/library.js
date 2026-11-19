import { h, show } from '/common.js';

const app = document.getElementById('app');
const tagsEl = document.getElementById('tags');
let all = []; let tag = null;

fetch('/library/index.json').then(r => r.json()).then(list => { all = list; draw(); }).catch(() => show(app, h('p', { class: 'error' }, 'Could not load the library.')));

function draw() {
  const tags = [...new Set(all.flatMap(x => x.tags))].sort();
  show(tagsEl, h('button', { class: `pill${tag ? '' : ' on'}`, onclick: () => { tag = null; draw(); } }, 'All'), tags.map(t => h('button', { class: `pill${tag === t ? ' on' : ''}`, onclick: () => { tag = t; draw(); } }, t)));
  show(app, all.filter(x => !tag || x.tags.includes(tag)).map(x => h('div', { class: 'quiz-item rise' },
    h('h3', {}, x.title), h('p', { class: 'muted', style: 'margin:0' }, x.description),
    h('div', { class: 'muted', style: 'font-size:13px' }, `${x.questions} questions · ${x.tags.join(', ')}`),
    h('div', { class: 'row' }, h('a', { class: 'btn small', href: `/create?library=${encodeURIComponent(x.file)}` }, 'Copy to my quizzes')))));
}
