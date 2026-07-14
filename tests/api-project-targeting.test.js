import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.js';

function topic(id, name) {
  return {
    id,
    name,
    status: 'not_verified',
    description: '',
    objectives: [],
    deliverables: [],
    successCriteria: [name],
    resources: { static: [], dynamic: [] },
    notes: '',
    chatHistory: [],
    manualOverride: null
  };
}

function project(id, title, phases) {
  return {
    id,
    title,
    subtitle: '',
    teamMembers: [],
    curriculum: {
      id: `${id}-curriculum`,
      title,
      phases,
      glossary: [],
      resources: [],
      versionHistory: []
    },
    phases,
    progress: null
  };
}

function phase(id, name, topics = []) {
  return { id, name, description: '', assignedMemberIds: [], projects: [], topics, documents: [] };
}

function workflowState() {
  const cube = project('cube-id', 'Cube3D', [phase('cube-phase', 'Cube Scope', [topic('cube-topic', 'Cube Topic')])]);
  const minishell = project('8cid8lk8', 'minishell', [phase('mini-phase', 'Mini Existing', [topic('mini-topic', 'Mini Topic')])]);
  return {
    title: cube.title,
    subtitle: cube.subtitle,
    activeProjectId: cube.id,
    projects: [cube, minishell],
    curriculum: cube.curriculum,
    phases: cube.phases,
    progress: null
  };
}

async function callApi(method, url, body, stateRef) {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  globalThis.fetch = async (requestUrl, options = {}) => {
    if (String(requestUrl).includes('/rest/v1/workflow_state?id=eq.main')) {
      return new Response(JSON.stringify([{ data: stateRef.current }]), { status: 200 });
    }
    if (String(requestUrl).includes('/rest/v1/workflow_state?on_conflict=id')) {
      stateRef.current = JSON.parse(options.body).data;
      return new Response('', { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; }
  };

  try {
    await handler({ method, url, headers: {}, body }, res);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
  return res;
}

function projectById(state, id) {
  return state.projects.find((item) => item.id === id);
}

test('addPhase targets the requested project and persists after reload', async () => {
  const stateRef = { current: workflowState() };
  const response = await callApi('POST', '/api/phases', {
    projectId: '8cid8lk8',
    name: 'Temporary API Target Test',
    description: 'temporary'
  }, stateRef);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.projectId, '8cid8lk8');
  assert.equal(projectById(stateRef.current, '8cid8lk8').curriculum.phases.some((item) => item.name === 'Temporary API Target Test'), true);
  assert.equal(projectById(stateRef.current, 'cube-id').curriculum.phases.some((item) => item.name === 'Temporary API Target Test'), false);
  assert.equal(stateRef.current.curriculum.phases.some((item) => item.name === 'Temporary API Target Test'), false);

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  assert.equal(projectById(reload.body.workflow, '8cid8lk8').curriculum.phases.some((item) => item.name === 'Temporary API Target Test'), true);

  const phaseId = response.body.phase.id;
  const cleanup = await callApi('DELETE', `/api/phases/${phaseId}`, { projectId: '8cid8lk8' }, stateRef);
  assert.equal(cleanup.statusCode, 200);
  assert.equal(projectById(stateRef.current, '8cid8lk8').curriculum.phases.some((item) => item.id === phaseId), false);
});

test('addPhase to Cube3D does not modify minishell', async () => {
  const stateRef = { current: workflowState() };
  const response = await callApi('POST', '/api/phases', { projectId: 'cube-id', name: 'Cube Only' }, stateRef);

  assert.equal(response.statusCode, 201);
  assert.equal(projectById(stateRef.current, 'cube-id').curriculum.phases.some((item) => item.name === 'Cube Only'), true);
  assert.equal(projectById(stateRef.current, '8cid8lk8').curriculum.phases.some((item) => item.name === 'Cube Only'), false);
});

test('missing or invalid projectId is rejected without active-project fallback', async () => {
  const stateRef = { current: workflowState() };
  const before = JSON.stringify(stateRef.current);

  const missing = await callApi('POST', '/api/phases', { name: 'Should Not Add' }, stateRef);
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body.error, /projectId is required/);
  assert.equal(JSON.stringify(stateRef.current), before);

  const invalid = await callApi('POST', '/api/phases', { projectId: 'missing-project', name: 'Should Not Add' }, stateRef);
  assert.equal(invalid.statusCode, 404);
  assert.match(invalid.body.error, /Project not found/);
  assert.equal(JSON.stringify(stateRef.current), before);
});

test('nested updates reject incorrect item ids inside the requested project', async () => {
  const stateRef = { current: workflowState() };
  const before = JSON.stringify(stateRef.current);

  const response = await callApi('PATCH', '/api/topics/cube-topic', {
    projectId: '8cid8lk8',
    name: 'Wrongly Updated'
  }, stateRef);

  assert.equal(response.statusCode, 404);
  assert.match(response.body.error, /Topic not found/);
  assert.equal(JSON.stringify(stateRef.current), before);
});
