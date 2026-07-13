import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImportPayload } from '../api/index.js';
import { mentorWithAI } from '../lib/ai.js';
import { validateCurriculumRoadmap } from '../lib/curriculum.js';
import { readApiJson } from '../public/client-response.js';

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

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

test('validates valid, oversized, malformed, and invalid PDF payloads', () => {
  assert.doesNotThrow(() => validateImportPayload({
    fileName: 'curriculum.pdf',
    mimeType: 'application/pdf',
    fileData: 'data:application/pdf;base64,JVBERi0='
  }));
  assert.throws(() => validateImportPayload({
    fileName: 'curriculum.txt',
    mimeType: 'text/plain',
    fileData: 'data:text/plain;base64,SGVsbG8='
  }), /Only PDF|must be a PDF/);
  assert.throws(() => validateImportPayload({
    fileName: 'curriculum.pdf',
    mimeType: 'application/pdf',
    fileData: 'data:application/pdf;base64,not valid base64!'
  }), /malformed/);
  assert.throws(() => validateImportPayload({
    fileName: 'huge.pdf',
    mimeType: 'application/pdf',
    fileData: `data:application/pdf;base64,${'A'.repeat(4 * 1024 * 1024)}`
  }), /too large/);
});

test('validates empty and valid extracted text payloads', () => {
  assert.throws(() => validateImportPayload({ text: '' }), /required/);
  assert.doesNotThrow(() => validateImportPayload({ text: 'Phase One\nTopic Setup' }));
});

test('validates generated roadmap schema', () => {
  assert.doesNotThrow(() => validateCurriculumRoadmap({
    title: 'Plan',
    phases: [{ name: 'Phase', projects: [], topics: [{ name: 'Topic', objectives: [], deliverables: [], successCriteria: [] }] }]
  }));
  assert.throws(() => validateCurriculumRoadmap({ title: 'Plan', phases: [] }), /at least one phase/);
  assert.throws(() => validateCurriculumRoadmap({ title: 'Plan', phases: [{ name: '', projects: [], topics: [] }] }), /without a title/);
  assert.throws(() => validateCurriculumRoadmap({
    title: 'Plan',
    phases: [{ name: 'Phase', projects: [], topics: [{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }] }]
  }), /duplicate topic id/);
  assert.throws(() => validateCurriculumRoadmap({
    title: 'Plan',
    phases: [{ name: 'Phase', projects: [], topics: [{ name: 'Topic', completion: 120 }] }]
  }), /invalid completion/);
});

test('Chat AI reports missing environment variable', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => mentorWithAI(chatState(), 'topic-1', 'hello', null), /OPENAI_API_KEY/);
  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
});

test('Chat AI reports provider failure without exposing secrets', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => response(JSON.stringify({ error: { message: 'model unavailable' } }), { status: 500 });
  await assert.rejects(() => mentorWithAI(chatState(), 'topic-1', 'hello', null), /OpenAI request failed \(500\): model unavailable/);
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
  const result = await mentorWithAI(chatState(), 'topic-1', 'hello', null);
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
