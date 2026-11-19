import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiConfig, generateQuiz } from '../src/ai.js';

const cfg = aiConfig({ AI_API_KEY: 'k', AI_BASE_URL: 'https://example.test/v1/', AI_MODEL: 'm' });

const reply = (content, ok = true) => async (url, opts) => {
  reply.last = { url, body: JSON.parse(opts.body) };
  return { ok, status: ok ? 200 : 500, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
};

test('AI is off without a key', () => {
  assert.equal(aiConfig({}), null);
  assert.equal(cfg.url, 'https://example.test/v1/chat/completions');
});

test('a good AI reply becomes a valid quiz', async () => {
  const fetchFn = reply({ title: 'Volcanoes', questions: [{ text: 'Where is Etna?', answers: ['Italy', 'Spain', 'Greece', 'Chile'], correct: [0] }] });
  const out = await generateQuiz({ topic: 'volcanoes', count: 50 }, cfg, fetchFn);
  assert.equal(out.quiz.title, 'Volcanoes');
  assert.match(reply.last.body.messages[1].content, /Write 20 questions/, 'count is capped');
});

test('a broken AI reply is reported, not passed on', async () => {
  const out = await generateQuiz({ topic: 'x' }, cfg, reply({ questions: [{ text: 'q', answers: ['a'], correct: [3] }] }));
  assert.match(out.error, /mistake/);
  assert.match((await generateQuiz({}, cfg, reply({}))).error, /topic/);
  assert.match((await generateQuiz({ topic: 'x' }, cfg, reply({}, false))).error, /said no/);
});
