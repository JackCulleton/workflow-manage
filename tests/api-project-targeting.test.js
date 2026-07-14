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

test('addTopic targets the requested project phase and preserves other projects', async () => {
  const stateRef = { current: workflowState() };
  const response = await callApi('POST', '/api/topics', {
    projectId: '8cid8lk8',
    phase_id: 'mini-phase',
    name: 'Parse quoted strings',
    description: 'Handle minishell quotes.'
  }, stateRef);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.projectId, '8cid8lk8');
  assert.equal(
    projectById(stateRef.current, '8cid8lk8').curriculum.phases[0].topics.some((item) => item.name === 'Parse quoted strings'),
    true
  );
  assert.equal(
    projectById(stateRef.current, 'cube-id').curriculum.phases[0].topics.some((item) => item.name === 'Parse quoted strings'),
    false
  );

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  assert.equal(
    projectById(reload.body.workflow, '8cid8lk8').curriculum.phases[0].topics.some((item) => item.name === 'Parse quoted strings'),
    true
  );
});

test('addTopic rejects invalid projectId and wrong phase ids', async () => {
  const stateRef = { current: workflowState() };
  const before = JSON.stringify(stateRef.current);

  const invalidProject = await callApi('POST', '/api/topics', {
    projectId: 'missing-project',
    phase_id: 'mini-phase',
    name: 'Should Not Add'
  }, stateRef);
  assert.equal(invalidProject.statusCode, 404);
  assert.match(invalidProject.body.error, /Project not found/);
  assert.equal(JSON.stringify(stateRef.current), before);

  const wrongPhase = await callApi('POST', '/api/topics', {
    projectId: '8cid8lk8',
    phase_id: 'cube-phase',
    name: 'Should Not Add'
  }, stateRef);
  assert.equal(wrongPhase.statusCode, 404);
  assert.match(wrongPhase.body.error, /Phase not found/);
  assert.equal(JSON.stringify(stateRef.current), before);
});

test('repeated getWorkflow calls preserve project ids and data', async () => {
  const stateRef = { current: workflowState() };
  const first = await callApi('GET', '/api/workflow', null, stateRef);
  const second = await callApi('GET', '/api/workflow', null, stateRef);
  const third = await callApi('GET', '/api/workflow', null, stateRef);

  assert.equal(projectById(first.body.workflow, '8cid8lk8').title, 'minishell');
  assert.equal(projectById(second.body.workflow, '8cid8lk8').title, 'minishell');
  assert.equal(projectById(third.body.workflow, '8cid8lk8').title, 'minishell');
  assert.deepEqual(
    first.body.workflow.projects.map((item) => item.id),
    third.body.workflow.projects.map((item) => item.id)
  );
});

test('replaceWorkflow rejects duplicate project names and id churn', async () => {
  const stateRef = { current: workflowState() };
  const duplicate = structuredClone(stateRef.current);
  duplicate.projects.push(project('other-mini', 'minishell', []));
  const duplicateResponse = await callApi('PUT', '/api/workflow', { workflow: duplicate }, stateRef);
  assert.equal(duplicateResponse.statusCode, 400);
  assert.match(duplicateResponse.body.error, /Duplicate project name/);

  const churn = structuredClone(stateRef.current);
  projectById(churn, '8cid8lk8').id = '4u4nqhe5';
  churn.activeProjectId = churn.projects[0].id;
  const churnResponse = await callApi('PUT', '/api/workflow', { workflow: churn }, stateRef);
  assert.equal(churnResponse.statusCode, 400);
  assert.match(churnResponse.body.error, /different id/);
});

test('replaceWorkflow rejects project removal unless deletion is explicit', async () => {
  const stateRef = { current: workflowState() };
  const before = JSON.stringify(stateRef.current);
  const removed = structuredClone(stateRef.current);
  removed.projects = removed.projects.filter((item) => item.id !== '8cid8lk8');

  const rejected = await callApi('PUT', '/api/workflow', { workflow: removed }, stateRef);
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.error, /remove existing projects/);
  assert.equal(JSON.stringify(stateRef.current), before);

  const accepted = await callApi('PUT', '/api/workflow', { workflow: removed, allowProjectDeletion: true }, stateRef);
  assert.equal(accepted.statusCode, 200);
  assert.equal(projectById(stateRef.current, '8cid8lk8'), undefined);
});

test('addTopic may target a globally unique phase id without projectId', async () => {
  const stateRef = { current: workflowState() };
  const response = await callApi('POST', '/api/topics', {
    phase_id: 'mini-phase',
    name: 'Unique phase target'
  }, stateRef);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.projectId, '8cid8lk8');
  assert.equal(projectById(stateRef.current, '8cid8lk8').curriculum.phases[0].topics.some((item) => item.name === 'Unique phase target'), true);
  assert.equal(projectById(stateRef.current, 'cube-id').curriculum.phases[0].topics.some((item) => item.name === 'Unique phase target'), false);
});

test('addTopic rejects ambiguous phase ids without projectId', async () => {
  const stateRef = { current: workflowState() };
  projectById(stateRef.current, 'cube-id').curriculum.phases[0].id = 'shared-phase';
  projectById(stateRef.current, 'cube-id').phases[0].id = 'shared-phase';
  projectById(stateRef.current, '8cid8lk8').curriculum.phases[0].id = 'shared-phase';
  projectById(stateRef.current, '8cid8lk8').phases[0].id = 'shared-phase';

  const response = await callApi('POST', '/api/topics', {
    phase_id: 'shared-phase',
    name: 'Ambiguous target'
  }, stateRef);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /ambiguous/);
});
