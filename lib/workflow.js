import { calculateProgress, ensureCurriculumState, findCurriculumTopic, getPhaseTopics, normaliseStatus } from './curriculum.js';

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
    if (!Array.isArray(phase.assignedMemberIds)) phase.assignedMemberIds = [];
    if (phase.documents === undefined) phase.documents = [];
    for (const topic of phase.topics) {
      if (!topic.id || !topic.name) throw new Error('Every topic requires id and name.');
      topic.status = normaliseStatus(topic.status);
      if (!['complete', 'partial', 'not_verified', 'missing'].includes(topic.status)) {
        throw new Error('Topic status must be complete, partial, not_verified or missing.');
      }
      if (topic.description === undefined) topic.description = '';
      if (topic.activities === undefined) topic.activities = [];
      if (!Array.isArray(topic.assignedMemberIds)) topic.assignedMemberIds = [];
    }
  }
  if (!Array.isArray(state.teamMembers)) state.teamMembers = [];
  state.progress = calculateProgress(state);
  return state;
}

export function addPhase(state, input) {
  ensureCurriculumState(state);
  const name = cleanName(input.name, 'Phase name is required.');
  ensureUniquePhaseName(state, name);
  const phase = { id: uid(), name, description: (input.description || '').trim(), assignedMemberIds: [], topics: [], documents: [] };
  state.phases.push(phase);
  state.curriculum.phases.push({ id: phase.id, name: phase.name, description: phase.description, assignedMemberIds: [], topics: [] });
  syncPhasesFromCurriculum(state);
  state.progress = calculateProgress(state);
  return phase;
}

export function updatePhase(state, phaseId, input = {}) {
  ensureCurriculumState(state);
  const phase = findPhase(state, phaseId);
  const curriculumPhase = findCurriculumPhase(state, phaseId);
  if (!phase && !curriculumPhase) throw new Error('Phase not found.');
  if (input.name !== undefined) {
    const name = cleanName(input.name, 'Phase name is required.');
    ensureUniquePhaseName(state, name, phaseId);
    if (phase) phase.name = name;
    if (curriculumPhase) curriculumPhase.name = name;
  }
  if (input.description !== undefined) {
    const description = String(input.description || '').trim();
    if (phase) phase.description = description;
    if (curriculumPhase) curriculumPhase.description = description;
  }
  if (input.assignedMemberIds !== undefined) {
    const assignedMemberIds = Array.isArray(input.assignedMemberIds) ? input.assignedMemberIds : [];
    if (phase) phase.assignedMemberIds = assignedMemberIds;
    if (curriculumPhase) curriculumPhase.assignedMemberIds = assignedMemberIds;
  }
  syncPhasesFromCurriculum(state);
  state.progress = calculateProgress(state);
  return findPhase(state, phaseId) || curriculumPhase;
}

export function deletePhase(state, phaseId) {
  ensureCurriculumState(state);
  const phaseIndex = state.phases.findIndex((phase) => phase.id === phaseId);
  const curriculumIndex = state.curriculum.phases.findIndex((phase) => phase.id === phaseId);
  if (phaseIndex === -1 && curriculumIndex === -1) throw new Error('Phase not found.');
  if (phaseIndex !== -1) state.phases.splice(phaseIndex, 1);
  if (curriculumIndex !== -1) state.curriculum.phases.splice(curriculumIndex, 1);
  syncPhasesFromCurriculum(state);
  state.progress = calculateProgress(state);
  return state;
}

export function movePhase(state, phaseId, direction) {
  ensureCurriculumState(state);
  moveItem(state.phases, phaseId, direction, 'Phase not found.');
  moveItem(state.curriculum.phases, phaseId, direction, 'Phase not found.');
  syncPhasesFromCurriculum(state);
  state.progress = calculateProgress(state);
  return state;
}

export function addTopic(state, input) {
  ensureCurriculumState(state);
  const phase = findPhase(state, input.phase_id);
  if (!phase) throw new Error('Phase not found.');
  const name = cleanName(input.name, 'Topic name is required.');
  const curriculumPhase = state.curriculum.phases.find((item) => item.id === phase.id);
  ensureUniqueTopicName(curriculumPhase || phase, name);
  const topic = {
    id: uid(),
    name,
    description: (input.description || '').trim(),
    status: normaliseStatus(input.status),
    activities: Array.isArray(input.activities) ? input.activities : [],
    assignedMemberIds: Array.isArray(input.assignedMemberIds) ? input.assignedMemberIds : [],
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
  if (curriculumPhase) curriculumPhase.topics.push(topic);
  syncPhasesFromCurriculum(state);
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
  if (input.name !== undefined) {
    const phase = findTopicPhase(state, topicId);
    if (phase) ensureUniqueTopicName(phase, input.name, topicId);
  }
  const topic = (found && found.topic) || curriculumTopic;
  const allowed = ['name', 'description', 'status', 'activities', 'assignedMemberIds', 'objectives', 'deliverables', 'successCriteria', 'keywords', 'notes'];
  for (const key of allowed) {
    if (input[key] !== undefined) topic[key] = key === 'status' ? normaliseStatus(input[key]) : key === 'name' ? cleanName(input[key], 'Topic name is required.') : input[key];
  }
  if (found && curriculumTopic && found.topic !== curriculumTopic) Object.assign(curriculumTopic, topic);
  if (found && curriculumTopic && found.topic === curriculumTopic) Object.assign(found.topic, topic);
  syncPhasesFromCurriculum(state);
  validateState(state);
  return topic;
}

export function deleteTopic(state, topicId) {
  ensureCurriculumState(state);
  let removed = false;
  for (const phase of state.curriculum.phases) removed = removeTopicFromPhase(phase, topicId) || removed;
  if (!removed) throw new Error('Topic not found.');
  syncPhasesFromCurriculum(state);
  state.progress = calculateProgress(state);
  return state;
}

export function moveTopic(state, topicId, direction) {
  ensureCurriculumState(state);
  let moved = false;
  for (const phase of state.curriculum.phases) moved = moveTopicInPhase(phase, topicId, direction) || moved;
  if (!moved) throw new Error('Topic not found.');
  syncPhasesFromCurriculum(state);
  state.progress = calculateProgress(state);
  return state;
}

export function assignMemberToPhase(state, phaseId, memberId) {
  const member = requireTeamMember(state, memberId);
  const phase = requireCurriculumPhase(state, phaseId);
  phase.assignedMemberIds = uniqueIds([...(phase.assignedMemberIds || []), member.id]);
  syncPhasesFromCurriculum(state);
  return assignmentResult(state, 'phase', phase);
}

export function unassignMemberFromPhase(state, phaseId, memberId) {
  requireTeamMember(state, memberId);
  const phase = requireCurriculumPhase(state, phaseId);
  phase.assignedMemberIds = uniqueIds(phase.assignedMemberIds || []).filter((id) => id !== memberId);
  syncPhasesFromCurriculum(state);
  return assignmentResult(state, 'phase', phase);
}

export function assignMemberToTopic(state, topicId, memberId) {
  const member = requireTeamMember(state, memberId);
  const topic = requireCurriculumTopic(state, topicId);
  topic.assignedMemberIds = uniqueIds([...(topic.assignedMemberIds || []), member.id]);
  syncPhasesFromCurriculum(state);
  return assignmentResult(state, 'topic', topic);
}

export function unassignMemberFromTopic(state, topicId, memberId) {
  requireTeamMember(state, memberId);
  const topic = requireCurriculumTopic(state, topicId);
  topic.assignedMemberIds = uniqueIds(topic.assignedMemberIds || []).filter((id) => id !== memberId);
  syncPhasesFromCurriculum(state);
  return assignmentResult(state, 'topic', topic);
}

export function setAssignments(state, assignments = []) {
  ensureCurriculumState(state);
  if (!Array.isArray(assignments) || !assignments.length) throw new Error('assignments must contain at least one item.');
  const checked = assignments.map((assignment) => {
    const targetType = assignment && assignment.targetType;
    const targetId = assignment && assignment.targetId;
    const memberIds = uniqueIds(assignment && assignment.memberIds);
    if (!['phase', 'topic'].includes(targetType)) throw new Error('targetType must be phase or topic.');
    if (!targetId) throw new Error('targetId is required.');
    for (const memberId of memberIds) requireTeamMember(state, memberId);
    const target = targetType === 'phase' ? requireCurriculumPhase(state, targetId) : requireCurriculumTopic(state, targetId);
    return { targetType, target, memberIds };
  });

  for (const assignment of checked) assignment.target.assignedMemberIds = assignment.memberIds;
  syncPhasesFromCurriculum(state);
  return checked.map((assignment) => assignmentResult(state, assignment.targetType, assignment.target));
}

function cleanName(value, message) {
  const name = String(value || '').trim();
  if (!name) throw new Error(message);
  return name;
}

function normaliseName(value) {
  return String(value || '').trim().toLowerCase();
}

function ensureUniquePhaseName(state, name, exceptId = null) {
  if ((state.curriculum.phases || []).some((phase) => phase.id !== exceptId && normaliseName(phase.name) === normaliseName(name))) {
    throw new Error('A phase with this name already exists.');
  }
}

function ensureUniqueTopicName(phase, name, exceptId = null) {
  if (!phase) return;
  if (getPhaseTopics(phase).some((topic) => topic.id !== exceptId && normaliseName(topic.name) === normaliseName(name))) {
    throw new Error('A topic with this name already exists in this phase.');
  }
}

function findCurriculumPhase(state, phaseId) {
  return state.curriculum && state.curriculum.phases.find((phase) => phase.id === phaseId);
}

function requireCurriculumPhase(state, phaseId) {
  ensureCurriculumState(state);
  if (!phaseId) throw new Error('phaseId is required.');
  const phase = findCurriculumPhase(state, phaseId);
  if (!phase) throw new Error('Phase not found.');
  if (!Array.isArray(phase.assignedMemberIds)) phase.assignedMemberIds = [];
  return phase;
}

function requireCurriculumTopic(state, topicId) {
  ensureCurriculumState(state);
  if (!topicId) throw new Error('topicId is required.');
  const topic = findCurriculumTopic(state, topicId);
  if (!topic) throw new Error('Topic not found.');
  if (!Array.isArray(topic.assignedMemberIds)) topic.assignedMemberIds = [];
  return topic;
}

function requireTeamMember(state, memberId) {
  ensureCurriculumState(state);
  if (!memberId) throw new Error('memberId is required.');
  const member = (state.teamMembers || []).find((item) => item.id === memberId);
  if (!member) throw new Error('Team member not found.');
  return member;
}

function uniqueIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map((id) => String(id))));
}

function assignedMembersFor(state, assignedMemberIds) {
  const ids = uniqueIds(assignedMemberIds);
  return ids.map((id) => (state.teamMembers || []).find((member) => member.id === id)).filter(Boolean);
}

function assignmentResult(state, targetType, target) {
  return {
    targetType,
    target,
    assignedMembers: assignedMembersFor(state, target.assignedMemberIds)
  };
}

function findTopicPhase(state, topicId) {
  return (state.curriculum.phases || []).find((phase) => getPhaseTopics(phase).some((topic) => topic.id === topicId));
}

function moveItem(items, id, direction, missingMessage) {
  if (!['up', 'down'].includes(direction)) throw new Error('Move direction must be up or down.');
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(missingMessage);
  const next = direction === 'up' ? index - 1 : index + 1;
  if (next < 0 || next >= items.length) return false;
  const [item] = items.splice(index, 1);
  items.splice(next, 0, item);
  return true;
}

function removeTopicFromPhase(phase, topicId) {
  const topicIndex = (phase.topics || []).findIndex((topic) => topic.id === topicId);
  if (topicIndex !== -1) {
    phase.topics.splice(topicIndex, 1);
    return true;
  }
  for (const project of phase.projects || []) {
    const projectTopicIndex = (project.topics || []).findIndex((topic) => topic.id === topicId);
    if (projectTopicIndex !== -1) {
      project.topics.splice(projectTopicIndex, 1);
      return true;
    }
  }
  return false;
}

function moveTopicInPhase(phase, topicId, direction) {
  if ((phase.topics || []).some((topic) => topic.id === topicId)) return moveItem(phase.topics, topicId, direction, 'Topic not found.');
  for (const project of phase.projects || []) {
    if ((project.topics || []).some((topic) => topic.id === topicId)) return moveItem(project.topics, topicId, direction, 'Topic not found.');
  }
  return false;
}

function syncPhasesFromCurriculum(state) {
  state.phases = (state.curriculum.phases || []).map((phase) => ({
    id: phase.id,
    name: phase.name,
    description: phase.description || '',
    assignedMemberIds: phase.assignedMemberIds || [],
    topics: getPhaseTopics(phase),
    documents: []
  }));
}
