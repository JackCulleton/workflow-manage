import test from 'node:test';
import assert from 'node:assert/strict';
import { addPhase, addTopic, updateTopic, validateState } from '../lib/workflow.js';
import { calculateProgress, createCurriculumFromText, importCurriculum, setManualOverride } from '../lib/curriculum.js';

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

test('builds a curriculum from structured text', () => {
  const curriculum = createCurriculumFromText({
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
  });
  assert.equal(curriculum.title, 'Minishell');
  assert.equal(curriculum.phases[0].name, 'Parsing');
  assert.equal(curriculum.phases[0].topics[0].successCriteria[0], 'Handles quoted strings');
});

test('calculates completion from topic evidence and manual overrides', () => {
  const workflow = state();
  importCurriculum(workflow, {
    title: 'Curriculum',
    text: `
Phase Signals
Topic Ctrl-C
Success Criteria: SIGINT handled
Topic Ctrl-D
Success Criteria: EOF handled
`,
    confirmUpdate: true
  });
  const topic = workflow.curriculum.phases[0].topics[0];
  topic.status = 'partial';
  topic.completion = 50;
  setManualOverride(workflow, workflow.curriculum.phases[0].topics[1].id, { completed: true, reason: 'Evaluator accepted it.' });
  assert.equal(calculateProgress(workflow).overall, 75);
  assert.equal(workflow.curriculum.phases[0].topics[1].manualOverride.completed, true);
});
