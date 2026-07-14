import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { migrateToSingleProject } from '../api/index.js';

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

function phase(id, name, topics = []) {
  return { id, name, description: '', assignedMemberIds: [], projects: [], topics, documents: [] };
}

function project(id, title, phases, teamMembers = []) {
  return {
    id,
    title,
    subtitle: `${title} subtitle`,
    teamMembers,
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

function legacyWorkflowState() {
  const cube = project('cube-id', 'Cube3D', [phase('cube-phase', 'Cube Scope', [topic('cube-topic', 'Cube Topic')])]);
  const minishell = project(
    '4u4nqhe5',
    'minishell',
    [
      phase('mini-phase-1', 'Scope and setup', [topic('mini-topic-1', 'Read minishell subject')]),
      phase('mini-phase-2', 'Parsing', [topic('mini-topic-2', 'Tokenization'), topic('mini-topic-3', 'Quotes')])
    ],
    [
      { id: 'member-1', name: 'Ada', color: '#f97316' },
      { id: 'member-2', name: 'Grace', color: '#38bdf8' }
    ]
  );
  return {
    title: cube.title,
    subtitle: cube.subtitle,
    activeProjectId: minishell.id,
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

test('legacy multi-project state migrates to one stable minishell project with backup', () => {
  const legacy = legacyWorkflowState();
  const result = migrateToSingleProject(structuredClone(legacy));

  assert.equal(result.changed, true);
  assert.equal(result.state.project.id, '4u4nqhe5');
  assert.equal(result.state.project.name, 'minishell');
  assert.equal(result.state.curriculum.phases.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(result.state.curriculum.phases[0], 'projects'), false);
  assert.equal(result.state.teamMembers[0].name, 'Ada');
  assert.equal(Array.isArray(result.state.projects), false);
  assert.equal(result.state.activeProjectId, undefined);
  assert.equal(result.state.migrationBackups.length, 1);
  assert.equal(result.state.migrationBackups[0].projects.length, 2);
});

test('repeated getWorkflow calls return the same single project data', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const first = await callApi('GET', '/api/workflow', null, stateRef);
  const second = await callApi('GET', '/api/workflow', null, stateRef);
  const third = await callApi('GET', '/api/workflow', null, stateRef);

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.project.id, '4u4nqhe5');
  assert.equal(second.body.project.id, '4u4nqhe5');
  assert.equal(third.body.project.id, '4u4nqhe5');
  assert.equal(first.body.workflow.curriculum.phases.length, third.body.workflow.curriculum.phases.length);
  assert.equal(Array.isArray(third.body.workflow.projects), false);
  assert.equal(Object.prototype.hasOwnProperty.call(third.body.workflow.curriculum.phases[0], 'projects'), false);
  assert.equal(third.body.workflow.activeProjectId, undefined);
  assert.equal(stateRef.current.project.id, '4u4nqhe5');
  assert.equal(stateRef.current.migrationBackups.length, 1);
});

test('addPhase writes to the single project without accepting projectId', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const response = await callApi('POST', '/api/phases', {
    name: 'Temporary single project phase',
    description: 'temporary'
  }, stateRef);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.projectId, '4u4nqhe5');
  assert.equal(response.body.persistence, 'stored');
  assert.equal(stateRef.current.curriculum.phases.some((item) => item.name === 'Temporary single project phase'), true);
  assert.equal(stateRef.current.project.phases.some((item) => item.name === 'Temporary single project phase'), true);

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  assert.equal(reload.body.workflow.curriculum.phases.some((item) => item.name === 'Temporary single project phase'), true);
});

test('addTopic uses the exact phase id and persists after a fresh request', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const response = await callApi('POST', '/api/topics', {
    phaseId: 'mini-phase-2',
    name: 'Temporary parser topic',
    description: 'temporary'
  }, stateRef);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.phaseId, 'mini-phase-2');
  assert.equal(response.body.topicId, response.body.topic.id);
  assert.equal(
    stateRef.current.curriculum.phases.find((item) => item.id === 'mini-phase-2').topics.some((item) => item.name === 'Temporary parser topic'),
    true
  );

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  assert.equal(
    reload.body.workflow.curriculum.phases.find((item) => item.id === 'mini-phase-2').topics.some((item) => item.name === 'Temporary parser topic'),
    true
  );
});

test('missing or incorrect nested ids fail without fallback', async () => {
  const stateRef = { current: legacyWorkflowState() };
  await callApi('GET', '/api/workflow', null, stateRef);
  const before = JSON.stringify(stateRef.current);

  const missingPhase = await callApi('POST', '/api/topics', { phaseId: 'missing-phase', name: 'Should not add' }, stateRef);
  assert.equal(missingPhase.statusCode, 404);
  assert.match(missingPhase.body.error, /Phase not found/);

  const wrongTopic = await callApi('PATCH', '/api/topics/cube-topic', { name: 'Should not update' }, stateRef);
  assert.equal(wrongTopic.statusCode, 404);
  assert.match(wrongTopic.body.error, /Topic not found/);

  assert.equal(JSON.stringify(stateRef.current), before);
});

test('replaceWorkflow accepts legacy input by migrating it to the selected single project', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const replacement = structuredClone(legacyWorkflowState());
  replacement.activeProjectId = 'cube-id';

  const response = await callApi('PUT', '/api/workflow', { workflow: replacement }, stateRef);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.project.id, 'cube-id');
  assert.equal(response.body.workflow.project.name, 'Cube3D');
  assert.equal(Array.isArray(response.body.workflow.projects), false);
  assert.equal(response.body.workflow.migrationBackups[0].projects.length, 2);
});

test('assignMemberToPhase persists existing team-member ids without changing progress', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const before = await callApi('GET', '/api/workflow', null, stateRef);
  const beforeProgress = JSON.stringify(before.body.workflow.progress);
  const beforeStatus = before.body.workflow.curriculum.phases[0].topics[0].status;

  const response = await callApi('POST', '/api/assignments/phases/assign', {
    phaseId: 'mini-phase-1',
    memberId: 'member-1'
  }, stateRef);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.phase.assignedMemberIds, ['member-1']);
  assert.deepEqual(response.body.assignedMembers.map((member) => member.id), ['member-1']);
  assert.equal(response.body.workflow.curriculum.phases[0].topics[0].status, beforeStatus);
  assert.equal(JSON.stringify(response.body.workflow.progress), beforeProgress);

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  assert.deepEqual(reload.body.workflow.curriculum.phases.find((item) => item.id === 'mini-phase-1').assignedMemberIds, ['member-1']);
});

test('assignMemberToTopic supports multiple members and prevents duplicates', async () => {
  const stateRef = { current: legacyWorkflowState() };
  await callApi('POST', '/api/assignments/topics/assign', { topicId: 'mini-topic-2', memberId: 'member-1' }, stateRef);
  await callApi('POST', '/api/assignments/topics/assign', { topicId: 'mini-topic-2', memberId: 'member-2' }, stateRef);
  const duplicate = await callApi('POST', '/api/assignments/topics/assign', { topicId: 'mini-topic-2', memberId: 'member-1' }, stateRef);

  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(duplicate.body.topic.assignedMemberIds, ['member-1', 'member-2']);
  assert.deepEqual(duplicate.body.assignedMembers.map((member) => member.name), ['Ada', 'Grace']);
});

test('assignment actions can resolve existing members and targets by name', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const phaseResponse = await callApi('POST', '/api/assignments/phases/assign', {
    phaseName: 'Scope and setup',
    memberName: 'Ada'
  }, stateRef);
  const topicResponse = await callApi('POST', '/api/assignments/topics/assign', {
    phaseName: 'Parsing',
    topicName: 'Quotes',
    memberName: 'Grace'
  }, stateRef);

  assert.equal(phaseResponse.statusCode, 200);
  assert.deepEqual(phaseResponse.body.phase.assignedMemberIds, ['member-1']);
  assert.equal(topicResponse.statusCode, 200);
  assert.deepEqual(topicResponse.body.topic.assignedMemberIds, ['member-2']);

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  assert.deepEqual(reload.body.workflow.curriculum.phases.find((item) => item.name === 'Scope and setup').assignedMemberIds, ['member-1']);
  assert.deepEqual(
    reload.body.workflow.curriculum.phases.find((item) => item.name === 'Parsing').topics.find((item) => item.name === 'Quotes').assignedMemberIds,
    ['member-2']
  );
});

test('name-based assignment rejects ambiguous members or topics instead of guessing', async () => {
  const stateRef = { current: legacyWorkflowState() };
  stateRef.current.projects[1].teamMembers.push({ id: 'member-3', name: 'Ada', color: '#22c55e' });
  stateRef.current.projects[1].curriculum.phases[0].topics.push(topic('mini-topic-4', 'Quotes'));
  stateRef.current.projects[1].phases[0].topics.push(topic('mini-topic-4', 'Quotes'));

  const ambiguousMember = await callApi('POST', '/api/assignments/phases/assign', {
    phaseName: 'Scope and setup',
    memberName: 'Ada'
  }, stateRef);
  assert.equal(ambiguousMember.statusCode, 400);
  assert.match(ambiguousMember.body.error, /Team member name is ambiguous/);

  const ambiguousTopic = await callApi('POST', '/api/assignments/topics/assign', {
    topicName: 'Quotes',
    memberName: 'Grace'
  }, stateRef);
  assert.equal(ambiguousTopic.statusCode, 400);
  assert.match(ambiguousTopic.body.error, /Topic name is ambiguous/);
});

test('unassigning a member does not delete workflow content', async () => {
  const stateRef = { current: legacyWorkflowState() };
  await callApi('POST', '/api/assignments/topics/assign', { topicId: 'mini-topic-2', memberId: 'member-1' }, stateRef);
  await callApi('POST', '/api/assignments/topics/assign', { topicId: 'mini-topic-2', memberId: 'member-2' }, stateRef);
  const beforeTopicCount = stateRef.current.curriculum.phases.flatMap((item) => item.topics).length;

  const response = await callApi('POST', '/api/assignments/topics/unassign', { topicId: 'mini-topic-2', memberId: 'member-1' }, stateRef);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.topic.assignedMemberIds, ['member-2']);
  assert.equal(stateRef.current.curriculum.phases.flatMap((item) => item.topics).length, beforeTopicCount);
  assert.equal(stateRef.current.curriculum.phases.some((item) => item.id === 'mini-phase-2'), true);
  assert.equal(stateRef.current.curriculum.phases.flatMap((item) => item.topics).some((item) => item.id === 'mini-topic-2'), true);
});

test('GPT-created assignments appear in getWorkflow and dashboard-shaped reads', async () => {
  const stateRef = { current: legacyWorkflowState() };
  await callApi('POST', '/api/assignments/phases/assign', { phaseId: 'mini-phase-2', memberId: 'member-2' }, stateRef);
  await callApi('POST', '/api/assignments/topics/assign', { topicId: 'mini-topic-3', memberId: 'member-2' }, stateRef);

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  const phase = reload.body.workflow.curriculum.phases.find((item) => item.id === 'mini-phase-2');
  const topic = phase.topics.find((item) => item.id === 'mini-topic-3');

  assert.deepEqual(phase.assignedMemberIds, ['member-2']);
  assert.deepEqual(topic.assignedMemberIds, ['member-2']);
  assert.deepEqual(reload.body.project.phases.find((item) => item.id === 'mini-phase-2').assignedMemberIds, ['member-2']);
});

test('frontend-created assignments submitted through replaceWorkflow appear in getWorkflow', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const initial = await callApi('GET', '/api/workflow', null, stateRef);
  const next = structuredClone(initial.body.workflow);
  next.curriculum.phases.find((item) => item.id === 'mini-phase-1').assignedMemberIds = ['member-1'];
  next.curriculum.phases.find((item) => item.id === 'mini-phase-1').topics[0].assignedMemberIds = ['member-2'];

  const save = await callApi('PUT', '/api/workflow', { workflow: next }, stateRef);
  assert.equal(save.statusCode, 200);

  const reload = await callApi('GET', '/api/workflow', null, stateRef);
  const phase = reload.body.workflow.curriculum.phases.find((item) => item.id === 'mini-phase-1');
  assert.deepEqual(phase.assignedMemberIds, ['member-1']);
  assert.deepEqual(phase.topics[0].assignedMemberIds, ['member-2']);
});

test('invalid assignment ids return errors without writing', async () => {
  const stateRef = { current: legacyWorkflowState() };
  await callApi('GET', '/api/workflow', null, stateRef);
  const before = JSON.stringify(stateRef.current);

  const invalidMember = await callApi('POST', '/api/assignments/phases/assign', { phaseId: 'mini-phase-1', memberId: 'missing-member' }, stateRef);
  assert.equal(invalidMember.statusCode, 404);
  assert.match(invalidMember.body.error, /Team member not found/);

  const invalidPhase = await callApi('POST', '/api/assignments/phases/assign', { phaseId: 'missing-phase', memberId: 'member-1' }, stateRef);
  assert.equal(invalidPhase.statusCode, 404);
  assert.match(invalidPhase.body.error, /Phase not found/);

  const invalidTopic = await callApi('POST', '/api/assignments/topics/assign', { topicId: 'missing-topic', memberId: 'member-1' }, stateRef);
  assert.equal(invalidTopic.statusCode, 404);
  assert.match(invalidTopic.body.error, /Topic not found/);
  assert.equal(JSON.stringify(stateRef.current), before);
});

test('setAssignments is atomic and validates all targets before writing', async () => {
  const stateRef = { current: legacyWorkflowState() };
  await callApi('GET', '/api/workflow', null, stateRef);
  const before = JSON.stringify(stateRef.current);

  const invalid = await callApi('POST', '/api/assignments/batch', {
    assignments: [
      { targetType: 'phase', targetId: 'mini-phase-1', memberIds: ['member-1'] },
      { targetType: 'topic', targetId: 'missing-topic', memberIds: ['member-2'] }
    ]
  }, stateRef);
  assert.equal(invalid.statusCode, 404);
  assert.equal(JSON.stringify(stateRef.current), before);

  const valid = await callApi('POST', '/api/assignments/batch', {
    assignments: [
      { targetType: 'phase', targetId: 'mini-phase-1', memberIds: ['member-1', 'member-1'] },
      { targetType: 'topic', targetId: 'mini-topic-1', memberIds: ['member-2'] }
    ]
  }, stateRef);

  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.assignments.length, 2);
  assert.deepEqual(valid.body.assignments[0].target.assignedMemberIds, ['member-1']);
  assert.deepEqual(valid.body.assignments[1].target.assignedMemberIds, ['member-2']);
});

test('setAssignments can use member names and target names', async () => {
  const stateRef = { current: legacyWorkflowState() };
  const response = await callApi('POST', '/api/assignments/batch', {
    assignments: [
      { targetType: 'phase', targetName: 'Scope and setup', memberNames: ['Ada'] },
      { targetType: 'topic', targetName: 'Quotes', phaseName: 'Parsing', memberNames: ['Grace'] }
    ]
  }, stateRef);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.assignments[0].target.assignedMemberIds, ['member-1']);
  assert.deepEqual(response.body.assignments[1].target.assignedMemberIds, ['member-2']);
});

test('existing workflows without assignment arrays still load with empty arrays', async () => {
  const stateRef = { current: legacyWorkflowState() };
  delete stateRef.current.projects[1].curriculum.phases[0].assignedMemberIds;
  delete stateRef.current.projects[1].curriculum.phases[0].topics[0].assignedMemberIds;

  const response = await callApi('GET', '/api/workflow', null, stateRef);
  const phase = response.body.workflow.curriculum.phases.find((item) => item.id === 'mini-phase-1');

  assert.deepEqual(phase.assignedMemberIds, []);
  assert.deepEqual(phase.topics[0].assignedMemberIds, []);
});
