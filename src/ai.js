// Optional: make a quiz from a topic or a pasted document with an AI model.
// Off unless the server has AI_API_KEY set. Works with any OpenAI-compatible API:
//   AI_API_KEY=...  AI_BASE_URL=https://api.openai.com/v1  AI_MODEL=gpt-4.1-mini
import { validateQuiz } from '../public/quiz.js';

export function aiConfig(env = process.env) {
  if (!env.AI_API_KEY) return null;
  return {
    key: env.AI_API_KEY,
    url: `${(env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`,
    model: env.AI_MODEL || 'gpt-4.1-mini',
  };
}

const SYSTEM = `You write quizzes for a live quiz game used in classrooms and offices.
Return only JSON: {"title": string, "questions": [{"text": string, "answers": [4 strings], "correct": [index of the right answer], "time": 20}]}.
Rules: every question has exactly one right answer and three believable wrong ones. Keep questions under 120 characters and answers under 60.
Facts must be accurate and not disputed. Mix easy and harder questions. Vary which position the right answer is in.
Write in the same language as the request. No trick questions, nothing unsuitable for children.`;

export async function generateQuiz({ topic, count = 10, level = '', text = '' }, cfg, fetchFn = fetch) {
  const n = Math.min(20, Math.max(3, Math.round(Number(count) || 10)));
  const what = String(topic || '').trim().slice(0, 200);
  const doc = String(text || '').trim().slice(0, 12000);
  if (!what && !doc) return { error: 'Type a topic or paste some text.' };
  const user = [
    `Write ${n} questions.`,
    what ? `Topic: ${what}` : '',
    level ? `Audience: ${String(level).slice(0, 60)}` : '',
    doc ? `Base every question only on this text:\n"""\n${doc}\n"""` : '',
  ].filter(Boolean).join('\n');
  let res;
  try {
    res = await fetchFn(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}`, 'api-key': cfg.key },
      body: JSON.stringify({ model: cfg.model, temperature: 0.6, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(60000),
    });
  } catch { return { error: 'The AI service did not answer. Try again.' }; }
  if (!res.ok) return { error: `The AI service said no (${res.status}). Try again later.` };
  let data;
  try {
    const body = await res.json();
    data = JSON.parse(body.choices[0].message.content);
  } catch { return { error: 'The AI sent back something that was not a quiz. Try again.' }; }
  const questions = (Array.isArray(data.questions) ? data.questions : []).map(q => ({ type: 'quiz', text: q.text, answers: q.answers, correct: q.correct, time: q.time || 20, points: 'standard' }));
  const { quiz, error } = validateQuiz({ title: data.title || what || 'AI quiz', questions });
  if (error) return { error: `The AI made a mistake: ${error} Try again.` };
  return { quiz };
}
