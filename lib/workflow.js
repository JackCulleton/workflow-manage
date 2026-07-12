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
  for (const phase of state.phases) {
    if (!phase.id || !phase.name || !Array.isArray(phase.topics)) {
      throw new Error('Every phase requires id, name and topics.');
    }
    phase.documents ??= [];
    for (const topic of phase.topics) {
      if (!topic.id || !topic.name) throw new Error('Every topic requires id and name.');
      if (!['not_started', 'in_progress', 'completed'].includes(topic.status)) {
        throw new Error('Topic status must be not_started, in_progress or completed.');
      }
      topic.description ??= '';
      topic.activities ??= [];
    }
  }
  return state;
}

export function addPhase(state, input) {
  const phase = { id: uid(), name: input.name.trim(), topics: [], documents: [] };
  state.phases.push(phase);
  return phase;
}

export function addTopic(state, input) {
  const phase = findPhase(state, input.phase_id);
  if (!phase) throw new Error('Phase not found.');
  const topic = {
    id: uid(),
    name: input.name.trim(),
    description: (input.description || '').trim(),
    status: input.status || 'not_started',
    activities: Array.isArray(input.activities) ? input.activities : []
  };
  phase.topics.push(topic);
  return topic;
}

export function updateTopic(state, topicId, input) {
  const found = findTopic(state, topicId);
  if (!found) throw new Error('Topic not found.');
  const allowed = ['name', 'description', 'status', 'activities'];
  for (const key of allowed) if (input[key] !== undefined) found.topic[key] = input[key];
  validateState(state);
  return found.topic;
}
