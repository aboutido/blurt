import { h, show, toast, saved, newId, LETTERS, api, slug, shareButtons, resizeImage } from '/common.js';
import { validateQuiz, parseText, toText, parseSpreadsheet, encodeQuiz, decodeQuiz, parseVideo, SAMPLE, TIMES, LIMITS, TYPES } from '/quiz.js';

const app = document.getElementById('app');
let current = null; // { id, quiz, folder, homework }
let config = { ai: false, homework: true };
let folderFilter = null;
api('/config').then(c => { if (!c.error) { config = c; if (!current) listView(); } });

// ---- small UI pieces ----

function modal(title, ...content) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const wrap = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'row spread' }, h('h2', {}, title), h('button', { class: 'btn ghost small', onclick: close, 'aria-label': 'Close' }, '✕')),
      ...content));
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  return { close, el: wrap };
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
const check = (label, on, onchange) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => onchange(e.target.checked) }), h('span', {}, label));

// ---- quiz shapes ----

const blank = (type = 'quiz') => fill({ type, text: '', time: 20, points: 'standard' });

// Make sure a question has every field the editor shows for its type.
function fill(q) {
  q.type = TYPES[q.type] ? q.type : 'quiz';
  q.correct = [].concat(q.correct ?? []).filter(n => Number.isInteger(n));
  if (q.type === 'quiz' && !q.correct.length) q.correct = [0];
  q.answers = [...(q.answers || []), '', '', '', ''].slice(0, 4);
  q.accepted = [...(q.accepted || []), '', '', '', ''].slice(0, 4);
  q.items = [...(q.items || []), '', '', '', ''].slice(0, 4);
  if (q.min === undefined) Object.assign(q, { min: 0, max: 100, step: 1, answer: 50, margin: 0, unit: '' });
  if (q.video && typeof q.video === 'object') q.videoLink = `https://youtu.be/${q.video.id}${q.video.start ? `?t=${q.video.start}` : ''}`;
  q.videoLink ??= '';
  q.image ??= '';
  return q;
}

// Strip the editor's padding and blanks so the quiz validates.
function tidy(quiz) {
  return {
    title: quiz.title,
    questions: quiz.questions.map(q => {
      const out = { type: q.type, text: q.text, time: q.time, points: q.points };
      if (q.image) out.image = q.image;
      if (q.videoLink) out.video = q.videoLink;
      if (q.type === 'quiz' || q.type === 'poll') {
        const keep = q.answers.map((a, j) => ({ a: String(a || '').trim(), j })).filter(x => x.a);
        out.answers = keep.map(x => x.a);
        if (q.type === 'quiz') out.correct = keep.map((x, k) => (q.correct.includes(x.j) ? k : -1)).filter(k => k >= 0);
      }
      if (q.type === 'type') out.accepted = q.accepted.map(a => String(a || '').trim()).filter(Boolean);
      if (q.type === 'order') out.items = q.items.map(a => String(a || '').trim()).filter(Boolean);
      if (q.type === 'slider') Object.assign(out, { min: q.min, max: q.max, step: q.step, answer: q.answer, margin: q.margin, unit: q.unit });
      return out;
    }),
  };
}

function saveItem(item) {
  if (!saved.put(item)) { toast('Could not save: this browser is out of space. Remove some pictures or old quizzes.'); return false; }
  return true;
}

// ---- hosting and homework ----

function hostDialog(quiz) {
  let settings = { teams: 0, randomNames: false, shuffleAnswers: false, shuffleQuestions: false, screenOnly: false };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem('blurt-host-settings')) }; } catch {}
  const teams = h('select', { onchange: (e) => { settings.teams = Number(e.target.value); } },
    [0, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: settings.teams === n }, n ? `${n} teams` : 'Everyone for themselves')));
  modal('Host settings',
    h('p', { class: 'muted' }, quiz.title),
    field('Game mode', teams, 'Teams are picked automatically and scored by their average, so team sizes don\'t matter.'),
    h('div', { class: 'stack' },
      check('Random friendly nicknames (players can\'t choose their own)', settings.randomNames, v => { settings.randomNames = v; }),
      check('Shuffle the order of answers', settings.shuffleAnswers, v => { settings.shuffleAnswers = v; }),
      check('Shuffle the order of questions', settings.shuffleQuestions, v => { settings.shuffleQuestions = v; }),
      check('Questions on the big screen only (phones just show the buttons)', settings.screenOnly, v => { settings.screenOnly = v; })),
    h('button', { class: 'btn', onclick: () => {
      try { localStorage.setItem('blurt-host-settings', JSON.stringify(settings)); } catch {}
      sessionStorage.setItem('blurt-host-quiz', JSON.stringify(quiz));
      sessionStorage.setItem('blurt-host-settings', JSON.stringify(settings));
      sessionStorage.removeItem('blurt-host-session');
      location.href = '/host';
    } }, 'Open the game'));
}

function homeworkDialog(item, quiz) {
  const due = new Date(Date.now() + 7 * 864e5); due.setHours(17, 0, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const when = h('input', { type: 'datetime-local', value: local(due), min: local(new Date()) });
  const opts = { shuffleAnswers: true, shuffleQuestions: false };
  const out = h('div', { class: 'stack' });
  const go = h('button', { class: 'btn', onclick: async () => {
    go.disabled = true;
    const res = await api('/assign', { quiz, deadline: new Date(when.value).toISOString(), settings: opts });
    go.disabled = false;
    if (res.error) return toast(res.error);
    const play = `${location.origin}/homework?a=${res.id}`;
    const results = `${location.origin}/results?a=${res.id}&k=${res.key}`;
    item.homework = [...(item.homework || []), { id: res.id, key: res.key, deadline: res.deadline }];
    saveItem(item);
    show(out,
      h('div', { class: 'card stack' },
        h('strong', {}, 'Send this link to your students'),
        h('input', { type: 'text', readonly: true, value: play, onclick: (e) => e.target.select() }),
        shareButtons(play, `Homework: ${quiz.title}`)),
      h('div', { class: 'card stack' },
        h('strong', {}, 'Your results page (keep this one to yourself)'),
        h('input', { type: 'text', readonly: true, value: results, onclick: (e) => e.target.select() }),
        h('div', { class: 'row' }, h('a', { class: 'btn small', href: results, target: '_blank', rel: 'noopener' }, 'Open results')),
        h('small', { class: 'muted' }, 'It is also saved next to this quiz in your list, in this browser.')));
  } }, 'Create homework link');
  modal('Set as homework',
    h('p', { class: 'muted' }, 'Students play on their own, any time before the deadline. They type their name, no account needed. You see everyone\'s answers on a results page.'),
    field('Deadline', when),
    h('div', { class: 'stack' },
      check('Shuffle the answers for each student', opts.shuffleAnswers, v => { opts.shuffleAnswers = v; }),
      check('Shuffle the questions for each student', opts.shuffleQuestions, v => { opts.shuffleQuestions = v; })),
    go, out);
}

function download(quiz) {
  const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${slug(quiz.title)}.json` });
  document.body.append(a); a.click(); a.remove();
}

function shareDialog(quiz) {
  const code = encodeQuiz(quiz);
  if (code.length > 60000) return toast('This quiz has uploaded pictures, so it is too big for a link. Use Download and send the file instead.');
  const url = `${location.origin}/create#q=${code}`;
  modal('Share this quiz',
    h('p', { class: 'muted' }, 'Anyone with the link gets their own copy to edit and host. The whole quiz is inside the link: nothing is stored on the server.'),
    h('input', { type: 'text', readonly: true, value: url, onclick: (e) => e.target.select() }),
    shareButtons(url, quiz.title));
}

// ---- making quizzes from elsewhere ----

function importDialog() {
  const text = h('textarea', { class: 'mono', placeholder: 'Paste questions as text, or paste rows straight from a spreadsheet.' });
  const file = h('input', { type: 'file', accept: '.json,.csv,.tsv,.txt,application/json,text/csv', class: 'hidden', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const body = await f.text();
    if (/\.json$/i.test(f.name)) {
      let data; try { data = JSON.parse(body); } catch { return toast('That file is not a quiz.'); }
      return openImported(data, f.name.replace(/\.json$/i, ''));
    }
    text.value = body;
  } });
  const m = modal('Import questions',
    h('p', { class: 'muted' }, 'Three ways in: a Blurt file (.json), a spreadsheet saved as CSV (columns: question, answer 1 to 4, time limit, correct answer number), or questions typed as text.'),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => file.click() }, 'Choose a file'), file),
    text,
    h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer' }, 'How to type questions as text'), h('pre', { class: 'mono hint' }, TEXT_HELP)),
    h('button', { class: 'btn', onclick: () => {
      const raw = text.value.trim();
      if (!raw) return toast('Paste something first.');
      const looksLikeSheet = /\t/.test(raw.split('\n')[0]) || /^[^\n]*,[^\n]*,[^\n]*,/.test(raw) && !/^[-*=>]\s/m.test(raw);
      const parsed = looksLikeSheet ? parseSpreadsheet(raw) : parseText(raw);
      if (!parsed.questions.length) return toast('No questions found.');
      if (openImported({ title: parsed.title || 'Imported quiz', questions: parsed.questions })) m.close();
    } }, 'Make a quiz from this'));
}

function openImported(data, fallbackTitle = 'Imported quiz') {
  const { quiz, error } = validateQuiz({ title: data.title || fallbackTitle, questions: data.questions });
  if (error) { toast(error); return false; }
  const item = { id: newId(), quiz, folder: folderFilter || '' };
  if (!saveItem(item)) return false;
  editView(item);
  toast(`Imported ${quiz.questions.length} questions`);
  return true;
}

function aiDialog() {
  const topic = h('input', { type: 'text', placeholder: 'e.g. The Romans, for Year 5', maxlength: 200 });
  const count = h('select', {}, [5, 10, 15, 20].map(n => h('option', { value: n, selected: n === 10 }, `${n} questions`)));
  const doc = h('textarea', { placeholder: 'Optional: paste notes or a reading text, and the questions will be based only on it.' });
  const go = h('button', { class: 'btn', onclick: async () => {
    if (!topic.value.trim() && !doc.value.trim()) return toast('Type a topic or paste some text.');
    go.disabled = true; go.textContent = 'Writing your quiz...';
    const res = await api('/generate', { topic: topic.value, count: Number(count.value), text: doc.value });
    go.disabled = false; go.textContent = 'Make the quiz';
    if (res.error) return toast(res.error);
    m.close();
    openImported(res.quiz);
    toast('Check the questions before you use them: AI can get facts wrong.');
  } }, 'Make the quiz');
  const m = modal('Make a quiz with AI', field('Topic', topic), field('How many', count), field('Based on this text (optional)', doc), go);
}

// ---- list of saved quizzes ----

function listView() {
  current = null;
  history.replaceState(null, '', '/create');
  const all = saved.all();
  const folders = [...new Set(all.map(x => x.folder).filter(Boolean))].sort();
  if (folderFilter && !folders.includes(folderFilter)) folderFilter = null;
  const list = folderFilter ? all.filter(x => x.folder === folderFilter) : all;
  show(app,
    h('div', { class: 'row spread' },
      h('h1', {}, 'Your quizzes'),
      h('div', { class: 'row' },
        h('a', { class: 'btn ghost small', href: '/library' }, 'Quiz library'),
        h('button', { class: 'btn ghost small', onclick: importDialog }, 'Import'),
        config.ai ? h('button', { class: 'btn ghost small', onclick: aiDialog }, '✨ Make with AI') : null,
        h('button', { class: 'btn small', onclick: () => editView({ id: newId(), quiz: { title: '', questions: [blank()] }, folder: folderFilter || '' }) }, 'New quiz'))),
    h('p', { class: 'muted' }, 'Quizzes are saved in this browser. Use a share link or Download to move one to another device.'),
    folders.length ? h('div', { class: 'row' },
      h('button', { class: `pill${folderFilter ? '' : ' on'}`, onclick: () => { folderFilter = null; listView(); } }, 'All'),
      folders.map(f => h('button', { class: `pill${folderFilter === f ? ' on' : ''}`, onclick: () => { folderFilter = f; listView(); } }, `📁 ${f}`))) : null,
    list.length
      ? h('div', { class: 'quiz-list' }, list.map(item => quizCard(item)))
      : h('div', { class: 'card stack' },
          h('p', {}, 'No quizzes here yet. Start a new one, borrow one from the library, or try the sample.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => editView({ id: newId(), quiz: { title: '', questions: [blank()] }, folder: folderFilter || '' }) }, 'New quiz'),
            h('a', { class: 'btn ghost', href: '/library' }, 'Browse the library'),
            h('button', { class: 'btn ghost', onclick: () => { const item = { id: newId(), quiz: structuredClone(SAMPLE), folder: '' }; saveItem(item); editView(item); } }, 'Use the sample'))),
  );
}

function quizCard(item) {
  const q = item.quiz;
  const hw = (item.homework || []).slice(-3);
  return h('div', { class: 'quiz-item rise' },
    h('h3', {}, q.title || 'Untitled quiz'),
    h('div', { class: 'muted' }, `${q.questions.length} question${q.questions.length === 1 ? '' : 's'}${item.folder ? ` · 📁 ${item.folder}` : ''}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => hostDialog(q) }, 'Host'),
      config.homework ? h('button', { class: 'btn ghost small', onclick: () => homeworkDialog(item, q) }, 'Homework') : null,
      h('button', { class: 'btn ghost small', onclick: () => editView(item) }, 'Edit')),
    h('div', { class: 'row' },
      h('button', { class: 'link', onclick: () => { const copy = { id: newId(), quiz: { ...structuredClone(q), title: `${q.title} (copy)` }, folder: item.folder || '' }; if (saveItem(copy)) listView(); } }, 'Duplicate'),
      h('button', { class: 'link', onclick: () => { const f = prompt('Folder name (leave empty for none):', item.folder || ''); if (f === null) return; item.folder = f.trim().slice(0, 40); saveItem(item); listView(); } }, 'Move to folder'),
      h('button', { class: 'link', onclick: () => { if (window.confirm(`Delete "${q.title || 'Untitled quiz'}"?`)) { saved.remove(item.id); listView(); } } }, 'Delete')),
    hw.length ? h('div', { class: 'stack', style: 'gap:4px' }, hw.map(a => h('a', { href: `/results?a=${a.id}&k=${a.key}`, target: '_blank', rel: 'noopener', class: 'muted', style: 'font-size:13px' }, `Homework results, due ${new Date(a.deadline).toLocaleDateString()}`))) : null);
}

// ---- editor ----

function editView(item) {
  current = { ...item, quiz: structuredClone(item.quiz) };
  if (!current.quiz.questions.length) current.quiz.questions.push(blank());
  current.quiz.questions.forEach(fill);
  render();
}

function save(silent) {
  const { quiz, error } = validateQuiz(tidy(current.quiz));
  if (error) { if (!silent) toast(error); return null; }
  const item = { id: current.id, quiz, folder: current.folder || '', homework: current.homework };
  if (!saveItem(item)) return null;
  if (!silent) toast('Saved');
  return quiz;
}

const withSaved = (fn) => () => { const quiz = save(true); if (quiz) fn(quiz); else save(); };

function render() {
  const q = current.quiz;
  show(app,
    h('div', { class: 'row spread sticky' },
      h('button', { class: 'btn ghost small', onclick: () => { save(true); listView(); } }, '← All quizzes'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: () => save() }, 'Save'),
        h('button', { class: 'btn ghost small', onclick: withSaved(shareDialog) }, 'Share'),
        h('button', { class: 'btn ghost small', onclick: withSaved(download) }, 'Download'),
        config.homework ? h('button', { class: 'btn ghost small', onclick: withSaved((quiz) => homeworkDialog({ id: current.id, quiz, folder: current.folder, homework: current.homework }, quiz)) }, 'Set as homework') : null,
        h('button', { class: 'btn small', onclick: withSaved(hostDialog) }, 'Host'))),
    h('div', { class: 'row', style: 'align-items:stretch' },
      h('input', { type: 'text', value: q.title || '', maxlength: LIMITS.title, placeholder: 'Quiz title', 'aria-label': 'Quiz title', style: 'flex:3', oninput: (e) => { q.title = e.target.value; } }),
      h('input', { type: 'text', value: current.folder || '', maxlength: 40, placeholder: '📁 Folder (optional)', 'aria-label': 'Folder', style: 'flex:1;min-width:140px', oninput: (e) => { current.folder = e.target.value.trim(); } })),
    ...q.questions.map((qq, i) => questionCard(qq, i)),
    h('div', { class: 'row' },
      Object.entries(TYPES).map(([type, t]) => h('button', { class: 'btn ghost small', disabled: q.questions.length >= LIMITS.questions, onclick: () => { q.questions.push(blank(type)); render(); window.scrollTo(0, document.body.scrollHeight); } }, `+ ${t.label}`))),
    textBox(q),
  );
}

function textBox(q) {
  const area = h('textarea', { class: 'mono', spellcheck: 'false' }, toText(tidy(q)));
  return h('details', { class: 'card' },
    h('summary', { style: 'cursor:pointer;font-weight:800' }, 'Edit as text (paste questions in bulk)'),
    h('div', { class: 'stack', style: 'margin-top:12px' },
      h('pre', { class: 'mono hint' }, TEXT_HELP),
      area,
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => {
        const parsed = parseText(area.value);
        if (!parsed.questions.length) return toast('No questions found in the text.');
        const { error } = validateQuiz({ title: parsed.title || q.title, questions: parsed.questions });
        if (error) return toast(error);
        // Keep uploaded pictures, which the text format leaves out.
        const pics = q.questions.map(x => x.image).filter(i => i && i.startsWith('data:'));
        current.quiz = { title: parsed.title || q.title, questions: parsed.questions.map((x, i) => fill({ ...x, image: x.image || (q.questions[i]?.image?.startsWith('data:') ? q.questions[i].image : '') })) };
        render(); toast(`Loaded ${parsed.questions.length} questions${pics.length ? ', pictures kept' : ''}`);
      } }, 'Use this text'))));
}

function questionCard(qq, i) {
  const q = current.quiz;
  const scored = TYPES[qq.type].scored;
  const move = (d) => { const j = i + d; if (j < 0 || j >= q.questions.length) return; [q.questions[j], q.questions[i]] = [q.questions[i], q.questions[j]]; render(); };
  return h('div', { class: 'q-card rise' },
    h('div', { class: 'row spread' },
      h('span', { class: 'num' }, `${i + 1}`),
      h('div', { class: 'row' },
        h('select', { 'aria-label': 'Question type', style: 'width:auto', onchange: (e) => { qq.type = e.target.value; fill(qq); if (!TYPES[qq.type].scored) qq.points = 'none'; else if (qq.points === 'none') qq.points = 'standard'; render(); } },
          Object.entries(TYPES).map(([k, t]) => h('option', { value: k, selected: k === qq.type }, t.label))),
        h('select', { 'aria-label': 'Time limit', style: 'width:auto', onchange: (e) => { qq.time = Number(e.target.value); } },
          [...new Set([...TIMES, qq.time])].sort((a, b) => a - b).map(t => h('option', { value: t, selected: t === qq.time }, `${t} sec`))),
        scored ? h('select', { 'aria-label': 'Points', style: 'width:auto', onchange: (e) => { qq.points = e.target.value; } },
          [['standard', 'Points'], ['double', 'Double points'], ['none', 'No points']].map(([v, l]) => h('option', { value: v, selected: v === qq.points }, l))) : null,
        h('button', { class: 'btn ghost small', disabled: i === 0, title: 'Move up', 'aria-label': 'Move up', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'btn ghost small', disabled: i === q.questions.length - 1, title: 'Move down', 'aria-label': 'Move down', onclick: () => move(1) }, '↓'),
        h('button', { class: 'btn ghost small', title: 'Duplicate', 'aria-label': 'Duplicate question', onclick: () => { q.questions.splice(i + 1, 0, structuredClone(qq)); render(); } }, '⧉'),
        h('button', { class: 'btn ghost small', title: 'Delete question', 'aria-label': 'Delete question', onclick: () => { q.questions.splice(i, 1); if (!q.questions.length) q.questions.push(blank()); render(); } }, '✕'))),
    h('input', { type: 'text', value: qq.text, maxlength: LIMITS.text, placeholder: 'Type your question', 'aria-label': `Question ${i + 1}`, oninput: (e) => { qq.text = e.target.value; } }),
    mediaRow(qq),
    typeFields(qq, i),
  );
}

function mediaRow(qq) {
  const picker = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { qq.image = await resizeImage(f); render(); } catch (err) { toast(err.message); }
  } });
  const uploaded = qq.image && qq.image.startsWith('data:');
  return h('div', { class: 'media-row' },
    uploaded
      ? h('div', { class: 'row' }, h('img', { src: qq.image, alt: '', class: 'thumb' }), h('button', { class: 'btn ghost small', onclick: () => { qq.image = ''; render(); } }, 'Remove picture'))
      : h('div', { class: 'row', style: 'flex:1' },
          h('input', { type: 'url', value: qq.image || '', placeholder: 'Picture link (https://...)', 'aria-label': 'Picture link', style: 'flex:1', oninput: (e) => { qq.image = e.target.value.trim(); } }),
          h('button', { class: 'btn ghost small', onclick: () => picker.click() }, 'Upload picture'), picker),
    h('input', { type: 'url', value: qq.videoLink || '', placeholder: 'YouTube link (optional, add ?t=30 to start at 30s)', 'aria-label': 'YouTube link', style: 'flex:1', oninput: (e) => {
      qq.videoLink = e.target.value.trim();
      e.target.classList.toggle('bad', !!qq.videoLink && !parseVideo(qq.videoLink));
    } }));
}

function typeFields(qq, i) {
  const t = qq.type;
  if (t === 'quiz' || t === 'poll') {
    return h('div', { class: 'stack' },
      h('div', { class: 'ans-edit' }, qq.answers.map((a, j) => h('div', { class: 'opt' },
        h('span', { class: 'display' }, LETTERS[j]),
        h('input', { type: 'text', value: a, maxlength: LIMITS.answer, placeholder: j < 2 ? `Answer ${LETTERS[j]}` : `Answer ${LETTERS[j]} (optional)`, oninput: (e) => { qq.answers[j] = e.target.value; } }),
        t === 'quiz' ? h('input', { type: 'checkbox', title: 'Right answer', 'aria-label': `Answer ${LETTERS[j]} is right`, checked: qq.correct.includes(j), onchange: (e) => {
          qq.correct = e.target.checked ? [...new Set([...qq.correct, j])] : qq.correct.filter(c => c !== j);
        } }) : null))),
      h('div', { class: 'row spread' },
        h('small', { class: 'muted' }, t === 'quiz' ? 'Tick the right answer. You can tick more than one.' : 'A poll has no right answer and no points: it just shows how the room voted.'),
        t === 'quiz' ? h('button', { class: 'link', onclick: () => { qq.answers = ['True', 'False', '', '']; qq.correct = [0]; render(); } }, 'Make it True / False') : null));
  }
  if (t === 'type') {
    return h('div', { class: 'stack' },
      h('div', { class: 'ans-edit' }, qq.accepted.map((a, j) => h('div', { class: 'opt plain' },
        h('input', { type: 'text', value: a, maxlength: LIMITS.accepted, placeholder: j ? 'Also accept (optional)' : 'The right answer', oninput: (e) => { qq.accepted[j] = e.target.value; } })))),
      h('small', { class: 'muted' }, 'Players type their answer. Capitals, accents and punctuation are ignored, so "sao paulo" matches "São Paulo".'));
  }
  if (t === 'order') {
    return h('div', { class: 'stack' },
      h('div', { class: 'ans-edit' }, qq.items.map((a, j) => h('div', { class: 'opt' },
        h('span', { class: 'display' }, j + 1),
        h('input', { type: 'text', value: a, maxlength: LIMITS.item, placeholder: j < 2 ? `Item ${j + 1}` : `Item ${j + 1} (optional)`, oninput: (e) => { qq.items[j] = e.target.value; } })))),
      h('small', { class: 'muted' }, 'Type the items in the RIGHT order. Players see them shuffled and have to put them back.'));
  }
  if (t === 'slider') {
    const numIn = (key, label, attrs = {}) => field(label, h('input', { type: key === 'unit' ? 'text' : 'number', value: qq[key], step: 'any', maxlength: 10, ...attrs, oninput: (e) => { qq[key] = key === 'unit' ? e.target.value : Number(e.target.value); } }));
    return h('div', { class: 'stack' },
      h('div', { class: 'grid-3' }, numIn('min', 'Lowest'), numIn('max', 'Highest'), numIn('answer', 'Right answer'), numIn('margin', 'Counts as right if within', { min: 0 }), numIn('step', 'Step', { min: 0 }), numIn('unit', 'Unit (optional)')),
      h('small', { class: 'muted' }, 'Players drag a slider to pick a number. Anyone within the margin scores.'));
  }
  return h('small', { class: 'muted' }, 'Players type a word or two. The answers appear on the big screen as a word cloud: the more people say it, the bigger it gets. No points.');
}

const TEXT_HELP = `One question per block, with a blank line between them.

What is the capital of France?
- Berlin
* Paris            (* marks the right answer, you can mark several)
- Madrid
time: 30           (optional, seconds)
points: double     (optional: standard, double or none)

Type the answer: = Paris
Put in order:    > first  (one per line, in the right order)
Slider:          range: 0 to 100, then answer: 42 and margin: 5
Poll:            type: poll, then - options
Word cloud:      type: cloud`;

document.getElementById('new').addEventListener('click', () => editView({ id: newId(), quiz: { title: '', questions: [blank()] }, folder: '' }));

// Opened from a share link, or from the library?
const shared = location.hash.match(/#q=([\w-]+)/);
const fromLibrary = new URLSearchParams(location.search).get('library');
if (shared) {
  const { quiz, error } = validateQuiz(decodeQuiz(shared[1]));
  if (quiz) { const item = { id: newId(), quiz, folder: '' }; saveItem(item); editView(item); toast('Quiz added to your list'); }
  else { listView(); toast(error || 'That share link is broken.'); }
} else if (fromLibrary && /^[\w-]+\.json$/.test(fromLibrary)) {
  fetch(`/library/${fromLibrary}`).then(r => r.json()).then(data => { if (!openImported(data)) listView(); }).catch(() => { listView(); toast('Could not load that quiz.'); });
} else listView();
