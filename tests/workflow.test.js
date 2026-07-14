import test from 'node:test';
import assert from 'node:assert/strict';
import { addPhase, addTopic, deletePhase, deleteTopic, movePhase, moveTopic, updatePhase, updateTopic, validateState } from '../lib/workflow.js';
import { calculateProgress, ensureCurriculumState, setManualOverride } from '../lib/curriculum.js';

function state() { return { title: 'Plan', subtitle: '', phases: [] }; }

test('adds and completes a topic', () => {
  const workflow = state();
  const phase = addPhase(workflow, { name: 'Clarification' });
  const topic = addTopic(workflow, { phase_id: phase.id, name: 'Resolve questions' });
  updateTopic(workflow, topic.id, { status: 'completed' });
  assert.equal(workflow.phases[0].topics[0].status, 'complete');
  assert.doesNotThrow(() => validateState(workflow));
});

test('rejects an invalid topic status', () => {
  const workflow = state();
  const phase = addPhase(workflow, { name: 'Build' });
  const topic = addTopic(workflow, { phase_id: phase.id, name: 'Code' });
  assert.throws(() => updateTopic(workflow, topic.id, { status: 'maybe' }), /status/);
});

test('calculates completion from topic evidence and manual overrides', () => {
  const workflow = {
    title: 'Curriculum',
    subtitle: '',
    phases: [],
    curriculum: {
      id: 'curriculum',
      title: 'Curriculum',
      phases: [{
        id: 'signals',
        name: 'Signals',
        projects: [],
        topics: [
          { id: 'ctrl-c', name: 'Ctrl-C', status: 'partial', completion: 50, successCriteria: ['SIGINT handled'], objectives: [], deliverables: [] },
          { id: 'ctrl-d', name: 'Ctrl-D', status: 'not_verified', completion: 0, successCriteria: ['EOF handled'], objectives: [], deliverables: [] }
        ]
      }]
    }
  };
  const topic = workflow.curriculum.phases[0].topics[0];
  setManualOverride(workflow, workflow.curriculum.phases[0].topics[1].id, { completed: true, reason: 'Evaluator accepted it.' });
  assert.equal(calculateProgress(workflow).overall, 75);
  assert.equal(workflow.curriculum.phases[0].topics[1].manualOverride.completed, true);
});

test('manages phases with validation and persistent order', () => {
  const workflow = state();
  const first = addPhase(workflow, { name: 'Planning' });
  const second = addPhase(workflow, { name: 'Build' });
  assert.throws(() => addPhase(workflow, { name: 'planning' }), /already exists/);

  updatePhase(workflow, second.id, { name: 'Implementation', description: 'Write the code.' });
  assert.equal(workflow.curriculum.phases[1].name, 'Implementation');
  assert.equal(workflow.phases[1].description, 'Write the code.');

  movePhase(workflow, second.id, 'up');
  assert.equal(workflow.curriculum.phases[0].id, second.id);
  assert.equal(workflow.phases[0].id, second.id);

  deletePhase(workflow, first.id);
  assert.equal(workflow.curriculum.phases.length, 1);
  assert.equal(workflow.phases.length, 1);
});

test('manages topics with validation, deletion, and order', () => {
  const workflow = state();
  const phase = addPhase(workflow, { name: 'Networking' });
  const socket = addTopic(workflow, { phase_id: phase.id, name: 'Socket Basics' });
  const poll = addTopic(workflow, { phase_id: phase.id, name: 'poll()' });
  assert.throws(() => addTopic(workflow, { phase_id: phase.id, name: 'socket basics' }), /already exists/);

  updateTopic(workflow, poll.id, { name: 'poll system call' });
  assert.equal(workflow.curriculum.phases[0].topics[1].name, 'poll system call');

  moveTopic(workflow, poll.id, 'up');
  assert.equal(workflow.curriculum.phases[0].topics[0].id, poll.id);
  assert.equal(workflow.phases[0].topics[0].id, poll.id);

  deleteTopic(workflow, socket.id);
  assert.equal(workflow.curriculum.phases[0].topics.length, 1);
  assert.equal(workflow.phases[0].topics.length, 1);
});

test('preserves explicit topic activities during curriculum normalisation', () => {
  const workflow = {
    title: 'Cube3D',
    subtitle: '',
    phases: [{
      id: 'phase-1',
      name: 'Scope',
      topics: [{
        id: 'topic-1',
        name: 'Requirements',
        status: 'not_verified',
        activities: [{
          title: 'Review required features',
          status: 'not_started',
          completionRequirements: ['Mandatory requirements are documented.']
        }],
        successCriteria: ['Review required features']
      }]
    }]
  };

  ensureCurriculumState(workflow);
  validateState(workflow);

  assert.deepEqual(workflow.curriculum.phases[0].topics[0].activities, [{
    title: 'Review required features',
    status: 'not_started',
    completionRequirements: ['Mandatory requirements are documented.']
  }]);
  assert.equal(workflow.curriculum.phases[0].topics[0].successCriteria[0], 'Review required features');
});

test('preserves team members and phase/topic assignments', () => {
  const workflow = {
    title: 'Cube3D',
    subtitle: '',
    teamMembers: [{ id: 'member-jack', name: 'Jack', color: '#f97316' }],
    phases: [{
      id: 'phase-1',
      name: 'Scope',
      assignedMemberIds: ['member-jack'],
      topics: [{
        id: 'topic-1',
        name: 'Requirements',
        status: 'not_verified',
        assignedMemberIds: ['member-jack'],
        successCriteria: ['Checklist exists']
      }]
    }]
  };

  ensureCurriculumState(workflow);
  validateState(workflow);

  assert.deepEqual(workflow.teamMembers, [{ id: 'member-jack', name: 'Jack', color: '#f97316' }]);
  assert.deepEqual(workflow.curriculum.phases[0].assignedMemberIds, ['member-jack']);
  assert.deepEqual(workflow.curriculum.phases[0].topics[0].assignedMemberIds, ['member-jack']);
  assert.deepEqual(workflow.phases[0].assignedMemberIds, ['member-jack']);
  assert.deepEqual(workflow.phases[0].topics[0].assignedMemberIds, ['member-jack']);
});
