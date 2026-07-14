import { calculateProgress, ensureCurriculumState, findCurriculumTopic, normaliseStatus } from './curriculum.js';

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function findPhase(state, phaseId) {
  return state.phases.find((phase) => phase.id === phaseId);
}

export function findTopic(state, topicId) {
  for (const phase of state.phases) {
    const topic = phase.topics.find((item) => item.id === topicId);
    if (topic) return { phase, topic };
  }
  return null;
}

export function validateState(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.phases)) {
    throw new Error('Workflow must contain a phases array.');
  }
  ensureCurriculumState(state);
  for (const phase of state.phases) {
    if (!phase.id || !phase.name || !Array.isArray(phase.topics)) {
      throw new Error('Every phase requires id, name and topics.');
    }
    if (phase.documents === undefined) phase.documents = [];
    for (const topic of phase.topics) {
      if (!topic.id || !topic.name) throw new Error('Every topic requires id and name.');
      topic.status = normaliseStatus(topic.status);
      if (!['complete', 'partial', 'not_verified', 'missing'].includes(topic.status)) {
        throw new Error('Topic status must be complete, partial, not_verified or missing.');
      }
      if (topic.description === undefined) topic.description = '';
      if (topic.activities === undefined) topic.activities = [];
    }
  }
  state.progress = calculateProgress(state);
  return state;
}

export function addPhase(state, input) {
  ensureCurriculumState(state);
  const phase = { id: uid(), name: input.name.trim(), projects: [], topics: [], documents: [] };
  state.phases.push(phase);
  state.curriculum.phases.push({ id: phase.id, name: phase.name, projects: [], topics: [] });
  state.progress = calculateProgress(state);
  return phase;
}

export function addTopic(state, input) {
  ensureCurriculumState(state);
  const phase = findPhase(state, input.phase_id);
  if (!phase) throw new Error('Phase not found.');
  const topic = {
    id: uid(),
    name: input.name.trim(),
    description: (input.description || '').trim(),
    status: normaliseStatus(input.status),
    activities: Array.isArray(input.activities) ? input.activities : [],
    objectives: Array.isArray(input.objectives) ? input.objectives : [],
    deliverables: Array.isArray(input.deliverables) ? input.deliverables : [],
    successCriteria: Array.isArray(input.successCriteria) ? input.successCriteria : Array.isArray(input.activities) ? input.activities : [],
    keywords: Array.isArray(input.keywords) ? input.keywords : [],
    resources: { static: [], dynamic: [] },
    completion: 0,
    notes: '',
    chatHistory: [],
    manualOverride: null
  };
  phase.topics.push(topic);
  const curriculumPhase = state.curriculum.phases.find((item) => item.id === phase.id);
  if (curriculumPhase) curriculumPhase.topics.push(topic);
  state.progress = calculateProgress(state);
  return topic;
}

export function updateTopic(state, topicId, input) {
  ensureCurriculumState(state);
  const found = findTopic(state, topicId);
  const curriculumTopic = findCurriculumTopic(state, topicId);
  if (!found && !curriculumTopic) throw new Error('Topic not found.');
  if (input.status !== undefined && !['complete', 'partial', 'not_verified', 'missing', 'completed', 'in_progress', 'not_started'].includes(input.status)) {
    throw new Error('Topic status must be complete, partial, not_verified or missing.');
  }
  const topic = (found && found.topic) || curriculumTopic;
  const allowed = ['name', 'description', 'status', 'activities', 'objectives', 'deliverables', 'successCriteria', 'keywords', 'notes'];
  for (const key of allowed) {
    if (input[key] !== undefined) topic[key] = key === 'status' ? normaliseStatus(input[key]) : input[key];
  }
  if (found && curriculumTopic && found.topic !== curriculumTopic) Object.assign(curriculumTopic, topic);
  if (found && curriculumTopic && found.topic === curriculumTopic) Object.assign(found.topic, topic);
  validateState(state);
  return topic;
}
