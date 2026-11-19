import { h, show, api, downloadCsv, slug, shareButtons } from '/common.js';

const app = document.getElementById('app');
const p = new URLSearchParams(location.search);
const id = p.get('a') || ''; const key = p.get('k') || '';

load();
async function load() {
  const r = await api('/homework/results', { id, key });
  if (r.error) return show(app, h('div', { class: 'error' }, r.error));
  const due = new Date(r.deadline);
  const play = `${location.origin}/homework?a=${id}`;
  show(app,
    h('h1', {}, r.title),
    h('p', { class: 'muted' }, `${r.rows.length} submitted · ${r.closed ? 'closed' : 'due'} ${due.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', disabled: !r.rows.length, onclick: () => downloadCsv(`${slug(r.title)}-homework.csv`, [r.header, ...r.rows]) }, 'Download spreadsheet'),
      h('button', { class: 'btn ghost small', onclick: load }, 'Refresh')),
    r.closed ? null : h('details', { class: 'card' }, h('summary', { style: 'cursor:pointer;font-weight:800' }, 'Student link'), h('div', { class: 'stack', style: 'margin-top:10px' }, h('input', { type: 'text', readonly: true, value: play }), shareButtons(play, `Homework: ${r.title}`))),
    h('h2', {}, 'Question by question'),
    h('div', { class: 'board', style: 'max-width:none' }, r.summary.map(s => {
      const pct = s.right != null && s.of ? Math.round((s.right / s.of) * 100) : null;
      return h('div', { class: 'board-row', style: 'font-size:16px;font-weight:600' },
        h('span', { class: 'pos' }, s.n), h('span', { style: 'flex:1' }, s.text, s.answer ? h('div', { class: 'muted', style: 'font-size:13px' }, `Answer: ${s.answer}`) : null),
        pct == null ? h('span', { class: 'muted' }, 'no score') : h('span', { class: 'score', style: `color:${pct < 50 ? 'var(--bad)' : pct < 75 ? 'var(--c)' : 'var(--good)'}` }, `${pct}%`));
    })),
    h('h2', {}, 'Students'),
    r.rows.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, r.header.slice(0, 5).map(c => h('th', {}, c)))),
      h('tbody', {}, r.rows.map(row => h('tr', {}, row.slice(0, 5).map((c, i) => h('td', {}, i === 4 ? new Date(c).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : String(c)))))))) : h('p', { class: 'muted' }, 'Nobody has finished yet.'));
}
