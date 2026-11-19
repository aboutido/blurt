// Quiz format, shared by the server and the browser.
//
// A quiz is { title, questions: [question] }. Every question has
//   { type, text, time, points, image?, video? }
// plus fields for its type:
//   quiz    answers: [2-4 strings], correct: [indexes]   (any marked answer scores)
//   poll    answers: [2-4 strings]                        (no right answer, no points)
//   type    accepted: [1-5 strings]                       (player types the answer)
//   order   items: [2-4 strings, in the right order]      (player puts them in order)
//   slider  min, max, step, answer, margin, unit          (player picks a number)
//   cloud   (nothing)                                     (short typed answers, shown as a word cloud)

export const TYPES = {
  quiz: { label: 'Quiz', scored: true },
  poll: { label: 'Poll', scored: false },
  type: { label: 'Type answer', scored: true },
  order: { label: 'Put in order', scored: true },
  slider: { label: 'Slider', scored: true },
  cloud: { label: 'Word cloud', scored: false },
};

export const LIMITS = {
  questions: 100, text: 300, answer: 120, title: 100, accepted: 40, item: 60, cloudWord: 24,
  minAnswers: 2, maxAnswers: 4, minTime: 5, maxTime: 240,
  imageLink: 500, imageData: 400 * 1024, quizBytes: 3.5 * 1024 * 1024,
};
export const TIMES = [10, 20, 30, 60, 90, 120];
export const POINTS = { standard: 1, double: 2, none: 0 };

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// A YouTube link or id becomes { id, start, end }.
export function parseVideo(v) {
  if (!v) return null;
  if (typeof v === 'object' && v.id) return { id: String(v.id), start: Math.max(0, Math.floor(num(v.start) || 0)), end: num(v.end) ? Math.floor(num(v.end)) : null };
  const s = String(v).trim();
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  if (!m) return undefined;
  const t = s.match(/[?&](?:t|start)=(\d+)/);
  return { id: m[1], start: t ? Number(t[1]) : 0, end: null };
}

function validImage(image) {
  if (/^https:\/\/[^\s"'<>]+$/i.test(image)) return image.length <= LIMITS.imageLink;
  const m = image.match(/^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  return !!m && m[2].length * 0.75 <= LIMITS.imageData;
}

// Returns { quiz } when valid, or { error } explaining the first problem.
export function validateQuiz(input) {
  if (!input || typeof input !== 'object') return { error: 'No quiz.' };
  const title = clean(input.title, LIMITS.title) || 'Untitled quiz';
  const list = Array.isArray(input.questions) ? input.questions : [];
  if (!list.length) return { error: 'The quiz has no questions.' };
  if (list.length > LIMITS.questions) return { error: `A quiz can have at most ${LIMITS.questions} questions.` };
  const questions = [];
  for (let i = 0; i < list.length; i++) {
    const { question, error } = validateQuestion(list[i] || {}, i + 1);
    if (error) return { error };
    questions.push(question);
  }
  const quiz = { title, questions };
  if (JSON.stringify(quiz).length > LIMITS.quizBytes) return { error: 'This quiz is too big. Use fewer or smaller images.' };
  return { quiz };
}

function validateQuestion(q, n) {
  const type = TYPES[q.type] ? q.type : 'quiz';
  const text = clean(q.text, LIMITS.text);
  if (!text) return { error: `Question ${n} has no text.` };
  let time = Math.round(Number(q.time) || 20);
  time = Math.min(LIMITS.maxTime, Math.max(LIMITS.minTime, time));
  let points = POINTS[q.points] !== undefined ? q.points : 'standard';
  if (!TYPES[type].scored) points = 'none';
  const out = { type, text, time, points };

  const image = String(q.image ?? '').trim();
  if (image) {
    if (!validImage(image)) return { error: `Question ${n}: the image must be an https:// link or an uploaded picture under 400 KB.` };
    out.image = image;
  }
  if (q.video) {
    const video = parseVideo(q.video);
    if (!video) return { error: `Question ${n}: the video must be a YouTube link.` };
    out.video = video;
  }

  if (type === 'quiz' || type === 'poll') {
    const answers = (Array.isArray(q.answers) ? q.answers : []).map(a => clean(a, LIMITS.answer));
    if (answers.some(a => !a)) return { error: `Question ${n} has an empty answer.` };
    if (answers.length < LIMITS.minAnswers || answers.length > LIMITS.maxAnswers) return { error: `Question ${n} needs ${LIMITS.minAnswers} to ${LIMITS.maxAnswers} answers.` };
    out.answers = answers;
    if (type === 'quiz') {
      const raw = Array.isArray(q.correct) ? q.correct : [q.correct];
      const correct = [...new Set(raw.map(Number))].filter(c => Number.isInteger(c) && c >= 0 && c < answers.length).sort((a, b) => a - b);
      if (!correct.length) return { error: `Question ${n} has no correct answer marked.` };
      out.correct = correct;
    }
  } else if (type === 'type') {
    const accepted = [...new Set((Array.isArray(q.accepted) ? q.accepted : []).map(a => clean(a, LIMITS.accepted)).filter(Boolean))].slice(0, 5);
    if (!accepted.length) return { error: `Question ${n} needs at least one accepted answer.` };
    out.accepted = accepted;
  } else if (type === 'order') {
    const items = (Array.isArray(q.items) ? q.items : []).map(a => clean(a, LIMITS.item));
    if (items.some(a => !a)) return { error: `Question ${n} has an empty item.` };
    if (items.length < 2 || items.length > 4) return { error: `Question ${n} needs 2 to 4 items to put in order.` };
    out.items = items;
  } else if (type === 'slider') {
    const min = num(q.min); const max = num(q.max); const answer = num(q.answer);
    let step = num(q.step) || 1; const margin = Math.max(0, num(q.margin) || 0);
    if (min === null || max === null || !(max > min)) return { error: `Question ${n}: the slider needs a lowest and a highest number.` };
    if (max - min > 1e7) return { error: `Question ${n}: the slider range is too big.` };
    if (step <= 0) step = 1;
    if ((max - min) / step > 2000) step = (max - min) / 2000;
    if (answer === null || answer < min || answer > max) return { error: `Question ${n}: the right answer must be between ${min} and ${max}.` };
    Object.assign(out, { min, max, step, answer, margin, unit: clean(q.unit, 10) });
  }
  return { question: out };
}

// ---- checking answers (used by the server for live games and homework) ----

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Returns true/false for scored types, null when the question has no right answer.
export function isCorrect(q, answer) {
  if (q.type === 'quiz') return Number.isInteger(answer) && q.correct.includes(answer);
  if (q.type === 'type') return typeof answer === 'string' && !!fold(answer) && q.accepted.some(a => fold(a) === fold(answer));
  if (q.type === 'order') return Array.isArray(answer) && answer.length === q.items.length && answer.every((v, i) => v === i);
  if (q.type === 'slider') return typeof answer === 'number' && Math.abs(answer - q.answer) <= q.margin + 1e-9;
  return null;
}

// Is this a well-formed answer for the question? (Anything else is ignored.)
export function validAnswer(q, answer) {
  if (q.type === 'quiz' || q.type === 'poll') return Number.isInteger(answer) && answer >= 0 && answer < q.answers.length;
  if (q.type === 'type' || q.type === 'cloud') return typeof answer === 'string' && answer.trim().length > 0 && answer.length <= 60;
  if (q.type === 'order') return Array.isArray(answer) && answer.length === q.items.length && [...answer].sort().every((v, i) => v === i);
  if (q.type === 'slider') return typeof answer === 'number' && Number.isFinite(answer) && answer >= q.min && answer <= q.max;
  return false;
}

// A right answer scores 500 to 1000 points (faster is more), times the question's
// multiplier, plus 100 per answer in a streak beyond the first, up to 500.
export function scoreFor(q, { correct, elapsedMs, limitMs, streak }) {
  if (!correct || q.points === 'none') return { base: 0, bonus: 0, total: 0 };
  const t = Math.min(Math.max(elapsedMs, 0), limitMs);
  const base = Math.round(1000 * (1 - t / (2 * limitMs))) * POINTS[q.points];
  const bonus = Math.min(500, Math.max(0, streak - 1) * 100);
  return { base, bonus, total: base + bonus };
}

// What players are shown: never the right answer.
export function publicQuestion(q, order) {
  const out = { type: q.type, text: q.text, time: q.time, points: q.points };
  if (q.answers) out.answers = order ? order.map(i => q.answers[i]) : q.answers;
  if (q.type === 'order') out.items = order ? order.map(i => q.items[i]) : q.items;
  if (q.type === 'slider') Object.assign(out, { min: q.min, max: q.max, step: q.step, unit: q.unit });
  return out;
}

// How an answer reads in a results spreadsheet.
export function answerText(q, answer) {
  if (answer == null) return '';
  if (q.answers && Number.isInteger(answer)) return q.answers[answer] ?? '';
  if (q.type === 'order' && Array.isArray(answer)) return answer.map(i => q.items[i]).join(' > ');
  return String(answer);
}

export function rightAnswerText(q) {
  if (q.type === 'quiz') return q.correct.map(i => q.answers[i]).join(' / ');
  if (q.type === 'type') return q.accepted[0];
  if (q.type === 'order') return q.items.join(' > ');
  if (q.type === 'slider') return `${q.answer}${q.unit ? ` ${q.unit}` : ''}`;
  return '';
}

// ---- plain text format ----
// One question per block, a blank line between questions.
//   What is the capital of France?     <- the question
//   - Berlin                           <- an answer
//   * Paris                            <- a right answer (several allowed)
//   time: 20  points: double           <- optional settings, one per line
// Other types:
//   type: poll                  then "- option" lines
//   = Paris                     accepted typed answers (makes it a "type answer" question)
//   > first  > second           items in the right order (makes it a "put in order" question)
//   range: 0 to 100 / answer: 42 / margin: 5 / unit: km   (makes it a slider)
//   type: cloud                 a word cloud
export function parseText(text) {
  const blocks = String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const questions = [];
  let title = '';
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 1 && /^title\s*:/i.test(lines[0])) { title = lines[0].replace(/^title\s*:/i, '').trim(); continue; }
    const q = { type: '', text: '', answers: [], correct: [], accepted: [], items: [], time: 20, points: 'standard' };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^([-*+])\s+(.+)$/))) { if (m[1] !== '-') q.correct.push(q.answers.length); q.answers.push(m[2]); }
      else if ((m = line.match(/^=\s*(.+)$/))) q.accepted.push(m[1]);
      else if ((m = line.match(/^>\s*(.+)$/))) q.items.push(m[1]);
      else if ((m = line.match(/^time\s*:\s*(\d+)/i))) q.time = Number(m[1]);
      else if ((m = line.match(/^points\s*:\s*(standard|double|none)/i))) q.points = m[1].toLowerCase();
      else if ((m = line.match(/^type\s*:\s*(\w+)/i))) q.type = m[1].toLowerCase();
      else if ((m = line.match(/^image\s*:\s*(\S+)/i))) q.image = m[1];
      else if ((m = line.match(/^video\s*:\s*(\S+)/i))) q.video = m[1];
      else if ((m = line.match(/^range\s*:\s*(-?[\d.]+)\s*(?:to|-|–)\s*(-?[\d.]+)/i))) { q.min = Number(m[1]); q.max = Number(m[2]); }
      else if ((m = line.match(/^answer\s*:\s*(-?[\d.]+)/i))) q.answer = Number(m[1]);
      else if ((m = line.match(/^margin\s*:\s*([\d.]+)/i))) q.margin = Number(m[1]);
      else if ((m = line.match(/^step\s*:\s*([\d.]+)/i))) q.step = Number(m[1]);
      else if ((m = line.match(/^unit\s*:\s*(.+)$/i))) q.unit = m[1];
      else q.text = q.text ? `${q.text} ${line}` : line;
    }
    if (!q.type) q.type = q.min !== undefined ? 'slider' : q.items.length ? 'order' : q.accepted.length ? 'type' : 'quiz';
    questions.push(tidyParsed(q));
  }
  return { title, questions };
}

function tidyParsed(q) {
  const out = { type: q.type, text: q.text, time: q.time, points: q.points };
  if (q.image) out.image = q.image;
  if (q.video) out.video = q.video;
  if (q.type === 'quiz') Object.assign(out, { answers: q.answers, correct: q.correct });
  if (q.type === 'poll') out.answers = q.answers;
  if (q.type === 'type') out.accepted = q.accepted;
  if (q.type === 'order') out.items = q.items;
  if (q.type === 'slider') Object.assign(out, { min: q.min, max: q.max, answer: q.answer, margin: q.margin ?? 0, step: q.step ?? 1, unit: q.unit ?? '' });
  return out;
}

// The reverse, so a quiz can be edited as text. Uploaded pictures are left out.
export function toText(quiz) {
  const parts = [];
  if (quiz.title) parts.push(`title: ${quiz.title}`);
  for (const q of quiz.questions || []) {
    const lines = [q.text];
    const type = q.type || 'quiz';
    if (type === 'quiz') q.answers.forEach((a, i) => lines.push(`${[].concat(q.correct).includes(i) ? '*' : '-'} ${a}`));
    if (type === 'poll') { lines.push('type: poll'); q.answers.forEach(a => lines.push(`- ${a}`)); }
    if (type === 'type') q.accepted.forEach(a => lines.push(`= ${a}`));
    if (type === 'order') q.items.forEach(a => lines.push(`> ${a}`));
    if (type === 'slider') {
      lines.push(`range: ${q.min} to ${q.max}`, `answer: ${q.answer}`);
      if (q.margin) lines.push(`margin: ${q.margin}`);
      if (q.step && q.step !== 1) lines.push(`step: ${q.step}`);
      if (q.unit) lines.push(`unit: ${q.unit}`);
    }
    if (type === 'cloud') lines.push('type: cloud');
    if (q.time && q.time !== 20) lines.push(`time: ${q.time}`);
    if (q.points && q.points !== 'standard' && TYPES[type].scored) lines.push(`points: ${q.points}`);
    if (q.image && !q.image.startsWith('data:')) lines.push(`image: ${q.image}`);
    if (q.video) lines.push(`video: https://youtu.be/${q.video.id}${q.video.start ? `?t=${q.video.start}` : ''}`);
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

// ---- spreadsheet import (CSV or pasted from Excel/Google Sheets) ----
// Columns: Question, Answer 1, Answer 2, Answer 3, Answer 4, Time limit, Correct answer(s)
// This matches the common quiz spreadsheet template. "Correct" is 1-4, or e.g. "1,3".

export function parseDelimited(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n')[0] || '';
  const sep = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

export function parseSpreadsheet(text) {
  const rows = parseDelimited(text).filter(r => r.some(Boolean));
  if (!rows.length) return { questions: [] };
  let start = rows.findIndex(r => /question/i.test(r[0] || '') || /question/i.test(r[1] || ''));
  let offset = 0;
  if (start >= 0) {
    offset = /question/i.test(rows[start][0] || '') ? 0 : 1; // some templates have a number column first
    start += 1;
  } else start = 0;
  const questions = [];
  for (const r of rows.slice(start)) {
    const c = r.slice(offset);
    const text = c[0];
    if (!text) continue;
    const answers = c.slice(1, 5).filter(Boolean);
    const time = Number(c[5]) || 20;
    const correct = String(c[6] || '').split(/[^\d]+/).filter(Boolean).map(n => Number(n) - 1);
    questions.push({ type: 'quiz', text, answers, correct, time, points: 'standard' });
  }
  return { questions };
}

// ---- share links (no database: the quiz is in the link) ----
export function encodeQuiz(quiz) {
  const bytes = new TextEncoder().encode(JSON.stringify(quiz));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeQuiz(code) {
  try {
    const bin = atob(String(code).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

export const SAMPLE = {
  title: 'Warm-up: general knowledge',
  questions: [
    { type: 'quiz', text: 'Which planet is known as the Red Planet?', answers: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: [1], time: 20, points: 'standard' },
    { type: 'quiz', text: 'How many legs does a spider have?', answers: ['6', '8', '10', '12'], correct: [1], time: 20, points: 'standard' },
    { type: 'type', text: 'What is the capital of France?', accepted: ['Paris'], time: 20, points: 'standard' },
    { type: 'order', text: 'Put these planets in order, closest to the Sun first.', items: ['Mercury', 'Venus', 'Earth', 'Mars'], time: 30, points: 'standard' },
    { type: 'slider', text: 'In which year did people first walk on the Moon?', min: 1950, max: 2000, step: 1, answer: 1969, margin: 2, unit: '', time: 20, points: 'standard' },
    { type: 'quiz', text: 'Water boils at 100°C at sea level.', answers: ['True', 'False'], correct: [0], time: 10, points: 'double' },
    { type: 'poll', text: 'Which was your favourite question?', answers: ['The planets', 'The spider', 'The Moon', 'None, more please'], time: 15, points: 'none' },
    { type: 'cloud', text: 'Describe this quiz in one word.', time: 20, points: 'none' },
  ],
};
