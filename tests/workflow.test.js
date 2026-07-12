import test from 'node:test';
import assert from 'node:assert/strict';
import { addPhase, addTopic, updateTopic, validateState } from '../lib/workflow.js';

function state() { return { title: 'Plan', subtitle: '', phases: [] }; }

test('adds and completes a topic', () => {
  const workflow = state();
  const phase = addPhase(workflow, { name: 'Clarification' });
  const topic = addTopic(workflow, { phase_id: phase.id, name: 'Resolve questions' });
  updateTopic(workflow, topic.id, { status: 'completed' });
  assert.equal(workflow.phases[0].topics[0].status, 'completed');
  assert.doesNotThrow(() => validateState(workflow));
});

test('rejects an invalid topic status', () => {
  const workflow = state();
  const phase = addPhase(workflow, { name: 'Build' });
  const topic = addTopic(workflow, { phase_id: phase.id, name: 'Code' });
  assert.throws(() => updateTopic(workflow, topic.id, { status: 'maybe' }), /status/);
});
