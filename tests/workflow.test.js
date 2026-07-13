import test from 'node:test';
import assert from 'node:assert/strict';
import { addPhase, addTopic, updateTopic, validateState } from '../lib/workflow.js';
import { calculateProgress, createCurriculumFromText, setManualOverride } from '../lib/curriculum.js';

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

test('curriculum building requires the configured AI provider', async () => {
  await assert.rejects(() => createCurriculumFromText({
    title: 'Minishell',
    text: `
Phase Parsing
Topic Tokenizer
Objective: Split input into tokens
Deliverable: tokenizer.c
Success Criteria: Handles quoted strings
Keywords: parser, token
Resource: https://example.com/minishell
`
  }), /OPENAI_API_KEY/);
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
