import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateImportPayload, messageForApiError, statusForApiError } from '../api/index.js';
import { mentorWithAI, parseCurriculumWithAI } from '../lib/ai.js';
import { collectRepositoryContext, validateCurriculumRoadmap } from '../lib/curriculum.js';
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
  assert.match(curriculum, /auditRoadmapWithAI/);
  assert.equal(api.includes('process.env.OPENAI_API_KEY'), false);
});

test('missing OpenAI config is reported as a server route failure', () => {
  const error = new Error('OPENAI_API_KEY is required for AI-assisted functionality.');
  assert.equal(statusForApiError(error), 500);
  assert.equal(
    messageForApiError(error, '/repository/audit'),
    'Server route /repository/audit failed: OPENAI_API_KEY is required for AI-assisted functionality.'
  );
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

test('PDF imports send the full data URL to the AI file input', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let requestBody = null;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requestBody = JSON.parse(options.body);
    return response(JSON.stringify({
      output_text: JSON.stringify({
        title: 'PDF Plan',
        sourceName: 'curriculum.pdf',
        phases: [{
          name: 'Phase',
          projects: [],
          topics: [{
            name: 'Topic',
            description: '',
            objectives: [],
            deliverables: [],
            successCriteria: [],
            keywords: [],
            glossary: [],
            resources: []
          }]
        }],
        glossary: [],
        resources: []
      })
    }));
  };

  await parseCurriculumWithAI({
    fileName: 'curriculum.pdf',
    mimeType: 'application/pdf',
    fileData: 'data:application/pdf;base64,JVBERi0='
  });

  const fileInput = requestBody.input[0].content.find((item) => item.type === 'input_file');
  assert.equal(fileInput.file_data, 'data:application/pdf;base64,JVBERi0=');
  globalThis.fetch = previousFetch;
  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  else delete process.env.OPENAI_API_KEY;
});

test('repository context loads files from the repository default branch', async () => {
  const previousFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith('/repos/octo/demo')) {
      return response(JSON.stringify({ description: 'Demo', language: 'JS', topics: [], default_branch: 'trunk' }));
    }
    if (String(url).endsWith('/repos/octo/demo/readme')) return response('Readme');
    if (String(url).endsWith('/repos/octo/demo/git/trees/trunk?recursive=1')) {
      return response(JSON.stringify({ tree: [{ type: 'blob', path: 'index.js', size: 12, sha: 'abc' }] }));
    }
    if (String(url).endsWith('/repos/octo/demo/git/blobs/abc')) {
      return response(JSON.stringify({ encoding: 'base64', content: Buffer.from('console.log(1)').toString('base64') }));
    }
    return response('', { status: 404 });
  };

  const context = await collectRepositoryContext('octo/demo');
  assert.equal(context.defaultBranch, 'trunk');
  assert.equal(context.files[0].path, 'index.js');
  assert.ok(urls.some((url) => url.endsWith('/git/trees/trunk?recursive=1')));
  assert.ok(!urls.some((url) => url.endsWith('/git/trees/HEAD?recursive=1')));
  globalThis.fetch = previousFetch;
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
