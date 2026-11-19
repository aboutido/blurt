import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuiz, parseText, toText, parseSpreadsheet, encodeQuiz, decodeQuiz, parseVideo, SAMPLE } from '../public/quiz.js';
import fs from 'node:fs';
import path from 'node:path';

test('the sample quiz and every library quiz are valid', () => {
  assert.ok(validateQuiz(SAMPLE).quiz);
  const dir = path.join(import.meta.dirname, '..', 'public', 'library');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.ok(index.length >= 5);
  for (const item of index) {
    const q = JSON.parse(fs.readFileSync(path.join(dir, item.file), 'utf8'));
    const { quiz, error } = validateQuiz(q);
    assert.ok(quiz, `${item.file}: ${error}`);
    assert.equal(item.questions, quiz.questions.length, `${item.file} question count`);
  }
});

test('old quizzes (single correct number, no type) still load', () => {
  const { quiz } = validateQuiz({ questions: [{ text: 'q', answers: ['a', 'b'], correct: 1 }] });
  assert.equal(quiz.questions[0].type, 'quiz');
  assert.deepEqual(quiz.questions[0].correct, [1]);
});

test('validation catches the common mistakes', () => {
  assert.match(validateQuiz({ questions: [] }).error, /no questions/);
  assert.match(validateQuiz({ questions: [{ text: '', answers: ['a', 'b'], correct: 0 }] }).error, /no text/);
  assert.match(validateQuiz({ questions: [{ text: 'q', answers: ['a'], correct: 0 }] }).error, /2 to 4 answers/);
  assert.match(validateQuiz({ questions: [{ text: 'q', answers: ['a', 'b'], correct: 5 }] }).error, /correct answer/);
  assert.match(validateQuiz({ questions: [{ text: 'q', answers: ['a', 'b'], correct: 0, image: 'javascript:alert(1)' }] }).error, /image/);
  assert.match(validateQuiz({ questions: [{ text: 'q', answers: ['a', 'b'], correct: 0, image: 'data:text/html;base64,PGI+' }] }).error, /image/);
  assert.match(validateQuiz({ questions: [{ type: 'type', text: 'q', accepted: [] }] }).error, /accepted/);
  assert.match(validateQuiz({ questions: [{ type: 'order', text: 'q', items: ['a'] }] }).error, /2 to 4 items/);
  assert.match(validateQuiz({ questions: [{ type: 'slider', text: 'q', min: 0, max: 10, answer: 20 }] }).error, /between/);
  assert.match(validateQuiz({ questions: [{ text: 'q', answers: ['a', 'b'], correct: 0, video: 'https://vimeo.com/1' }] }).error, /YouTube/);
});

test('polls and word clouds never score', () => {
  const { quiz } = validateQuiz({ questions: [{ type: 'poll', text: 'q', answers: ['a', 'b'], points: 'double' }, { type: 'cloud', text: 'w', points: 'standard' }] });
  assert.equal(quiz.questions[0].points, 'none');
  assert.equal(quiz.questions[1].points, 'none');
});

test('YouTube links of every common shape', () => {
  assert.deepEqual(parseVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), { id: 'dQw4w9WgXcQ', start: 42, end: null });
  assert.equal(parseVideo('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseVideo('https://youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseVideo('nope'), undefined);
});

test('plain text covers every type and round-trips', () => {
  const text = `title: Mixed

Capital of France?
- Berlin
* Paris
- Madrid
time: 30
points: double

Which are prime?
* 2
- 4
* 5

Type it: largest planet?
= Jupiter

Order by size, smallest first
> Mouse
> Cat
> Horse

Moon landing year?
range: 1950 to 2000
answer: 1969
margin: 1

Favourite colour?
type: poll
- Red
- Blue

One word for today
type: cloud`;
  const parsed = parseText(text);
  assert.equal(parsed.title, 'Mixed');
  assert.deepEqual(parsed.questions.map(q => q.type), ['quiz', 'quiz', 'type', 'order', 'slider', 'poll', 'cloud']);
  assert.deepEqual(parsed.questions[1].correct, [0, 2]);
  assert.equal(parsed.questions[0].points, 'double');
  const { quiz, error } = validateQuiz(parsed);
  assert.ok(quiz, error);
  assert.deepEqual(validateQuiz(parseText(toText(quiz))).quiz, quiz);
});

test('spreadsheet import reads the usual template, CSV or pasted from a sheet', () => {
  const csv = `Quiz template,,,,,,,
Question - max 120 characters,Answer 1,Answer 2,Answer 3,Answer 4,Time limit (sec),Correct answer(s)
"What is 2+2, roughly?",3,4,5,,20,2
Which are fruit?,Apple,Carrot,Pear,,30,"1,3"`;
  const { questions } = parseSpreadsheet(csv);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].text, 'What is 2+2, roughly?');
  assert.deepEqual(questions[0].answers, ['3', '4', '5']);
  assert.deepEqual(questions[1].correct, [0, 2]);
  assert.equal(questions[1].time, 30);
  assert.ok(validateQuiz({ questions }).quiz);
  const tsv = 'Question\tA1\tA2\tA3\tA4\tTime\tCorrect\nSky colour?\tBlue\tGreen\t\t\t10\t1';
  assert.deepEqual(parseSpreadsheet(tsv).questions[0].answers, ['Blue', 'Green']);
});

test('share links survive non-English text', () => {
  const quiz = { title: 'Ünïcode 🎉', questions: [{ text: 'שלום?', answers: ['כן', 'לא'], correct: [0], time: 20 }] };
  assert.deepEqual(decodeQuiz(encodeQuiz(quiz)), quiz);
  assert.equal(decodeQuiz('not-a-quiz!!'), null);
});
