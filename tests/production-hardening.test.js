import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageForApiError, statusForApiError } from '../api/index.js';
import { mentorWithAI } from '../lib/ai.js';
import { readApiJson } from '../public/client-response.js';

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

test('OpenAI usage stays server-side and uses the shared AI module', () => {
  const frontend = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  const ai = readFileSync(new URL('../lib/ai.js', import.meta.url), 'utf8');
  const curriculum = readFileSync(new URL('../lib/curriculum.js', import.meta.url), 'utf8');
  const forbiddenPublicKeys = [
    'VITE_OPENAI_API_KEY',
    'NEXT_PUBLIC_OPENAI_API_KEY',
    'sk-'
  ];

  for (const forbidden of forbiddenPublicKeys) {
    assert.equal(frontend.includes(forbidden), false, `frontend must not contain ${forbidden}`);
  }
  assert.equal(frontend.includes('api.openai.com'), false);
  assert.match(ai, /process\.env\.OPENAI_API_KEY/);
  assert.match(ai, /Authorization:\s*`Bearer \$\{process\.env\.OPENAI_API_KEY\}`/);
  assert.match(curriculum, /mentorWithAI/);
  assert.equal(api.includes('process.env.OPENAI_API_KEY'), false);
});

test('missing OpenAI config is reported as a server route failure', () => {
  const error = new Error('OPENAI_API_KEY is required for AI-assisted functionality.');
  assert.equal(statusForApiError(error), 500);
  assert.equal(
    messageForApiError(error, '/topics/topic-1/mentor'),
    'Server route /topics/topic-1/mentor failed: OPENAI_API_KEY is required for AI-assisted functionality.'
  );
});

test('removed PDF and repository checking features are absent from UI, API, and AI helpers', () => {
  const frontend = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  const ai = readFileSync(new URL('../lib/ai.js', import.meta.url), 'utf8');
  const curriculum = readFileSync(new URL('../lib/curriculum.js', import.meta.url), 'utf8');
  const openapi = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');

  for (const removed of [
    '/api/curriculum/import',
    '/api/repository/audit',
    '/audit',
    'Build Roadmap',
    'Import Curriculum',
    'Repository',
    'Verify',
    'curriculumFile',
    'fileData'
  ]) {
    assert.equal(frontend.includes(removed), false, `frontend still contains removed feature: ${removed}`);
  }
  for (const removed of [
    'validateImportPayload',
    'importCurriculum',
    'auditTopic',
    'auditRepository',
    '/curriculum/import',
    '/repository/audit'
  ]) {
    assert.equal(api.includes(removed), false, `api still contains removed feature: ${removed}`);
  }
  for (const removed of ['parseCurriculumWithAI', 'auditRepositoryWithAI', 'auditRoadmapWithAI', 'input_file']) {
    assert.equal(ai.includes(removed), false, `ai helper still contains removed feature: ${removed}`);
  }
  for (const removed of ['collectRepositoryContext', 'auditTopic', 'auditRepository', 'parseCurriculumWithAI']) {
    assert.equal(curriculum.includes(removed), false, `curriculum helper still contains removed feature: ${removed}`);
  }
  assert.equal(openapi.includes('/curriculum/import'), false);
  assert.equal(openapi.includes('/topics/{topicId}/audit'), false);
});

test('frontend helper reads a successful JSON response', async () => {
  const data = await readApiJson(response(JSON.stringify({ ok: true })), 'Action failed');
  assert.equal(data.ok, true);
});

test('frontend helper reports plain-text server errors', async () => {
  await assert.rejects(
    () => readApiJson(response('Request Entity Too Large', { status: 413 }), 'Build roadmap failed'),
    /Build roadmap failed \(413\): Request Entity Too Large/
  );
});

test('frontend helper accepts an empty successful response', async () => {
  const data = await readApiJson(response('', { status: 204 }), 'Action failed');
  assert.deepEqual(data, {});
});

test('frontend helper rejects malformed JSON success responses', async () => {
  await assert.rejects(
    () => readApiJson(response('not json'), 'Action failed'),
    /Server returned invalid JSON/
  );
});

test('frontend helper includes backend JSON errors and request IDs', async () => {
  await assert.rejects(
    () => readApiJson(response(JSON.stringify({ success: false, error: 'Bad input', requestId: 'req-1' }), { status: 400 }), 'Save failed'),
    /Save failed \(400\): Bad input \[request req-1\]/
  );
});

test('frontend helper handles 404, 500, and aborted response reads', async () => {
  await assert.rejects(() => readApiJson(response(JSON.stringify({ error: 'Missing' }), { status: 404 }), 'Load failed'), /404/);
  await assert.rejects(() => readApiJson(response(JSON.stringify({ error: 'Broken' }), { status: 500 }), 'Load failed'), /500/);
  await assert.rejects(
    () => readApiJson({ ok: false, status: 0, headers: new Headers(), text: async () => { throw new DOMException('Aborted', 'AbortError'); } }, 'Load failed'),
    /Aborted/
  );
});

test('Chat AI reports missing environment variable', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => mentorWithAI(chatState(), 'topic-1', 'hello'), /OPENAI_API_KEY/);
  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
});

test('Chat AI reports provider failure without exposing secrets', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => response(JSON.stringify({ error: { message: 'model unavailable' } }), { status: 500 });
  await assert.rejects(() => mentorWithAI(chatState(), 'topic-1', 'hello'), /OpenAI request failed \(500\): model unavailable/);
  globalThis.fetch = previousFetch;
  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  else delete process.env.OPENAI_API_KEY;
});

test('Chat AI success parses structured output', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => response(JSON.stringify({
    output_text: JSON.stringify({ reply: 'Keep going.', recommendedActions: ['Write tests'] })
  }));
  const result = await mentorWithAI(chatState(), 'topic-1', 'hello');
  assert.equal(result.reply, 'Keep going.');
  assert.deepEqual(result.recommendedActions, ['Write tests']);
  globalThis.fetch = previousFetch;
  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  else delete process.env.OPENAI_API_KEY;
});

function chatState() {
  return {
    curriculum: {
      title: 'Plan',
      phases: [{
        name: 'Phase',
        projects: [],
        topics: [{ id: 'topic-1', name: 'Topic', objectives: [], deliverables: [], successCriteria: [] }]
      }]
    }
  };
}
