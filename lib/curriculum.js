import { mentorWithAI } from './ai.js';
import { findTopicResources } from './resource-search.js';

const COMPLETE_STATUSES = new Set(['complete', 'completed']);
const PARTIAL_STATUSES = new Set(['partial', 'in_progress']);

export const TOPIC_STATES = ['complete', 'partial', 'not_verified', 'missing'];

export function normaliseStatus(status = 'not_verified') {
  if (status === 'completed') return 'complete';
  if (status === 'in_progress') return 'partial';
  if (status === 'not_started') return 'not_verified';
  return TOPIC_STATES.includes(status) ? status : 'not_verified';
}

export function completionForTopic(topic) {
  if (topic.manualOverride && topic.manualOverride.completed) return 100;
  if (typeof topic.completion === 'number') return clamp(topic.completion, 0, 100);
  if (COMPLETE_STATUSES.has(topic.status)) return 100;
  if (PARTIAL_STATUSES.has(topic.status)) return 50;
  return 0;
}

export function calculateProgress(state) {
  const topics = getAllTopics(state);
  const overall = topics.length
    ? Math.round(topics.reduce((sum, topic) => sum + completionForTopic(topic), 0) / topics.length)
    : 0;

  const phases = ((state.curriculum && state.curriculum.phases) || state.phases || []).map((phase) => {
    const phaseTopics = getPhaseTopics(phase);
    const completion = phaseTopics.length
      ? Math.round(phaseTopics.reduce((sum, topic) => sum + completionForTopic(topic), 0) / phaseTopics.length)
      : 0;
    return { id: phase.id, name: phase.name, completion };
  });

  const strongestTopics = topics
    .filter((topic) => completionForTopic(topic) >= 80)
    .map((topic) => topic.name)
    .slice(0, 5);
  const needsImprovement = topics
    .filter((topic) => completionForTopic(topic) < 70)
    .map((topic) => topic.name)
    .slice(0, 5);
  const recommended = topics.find((topic) => !COMPLETE_STATUSES.has(topic.status) && !(topic.manualOverride && topic.manualOverride.completed));

  return {
    overall,
    phases,
    strongestTopics,
    needsImprovement,
    recommendedNextTopic: recommended ? recommended.name : null,
    estimatedRemainingWork: `${Math.max(1, needsImprovement.length * 2)} hours`
  };
}

export function ensureCurriculumState(state) {
  delete state.repository;
  if (!state.curriculum) {
    state.curriculum = {
      id: uid(),
      title: state.title || 'Mountain Scope Curriculum',
      source: { name: 'Dashboard workflow migration', type: 'legacy', importedAt: new Date().toISOString() },
      phases: (state.phases || []).map((phaseItem) => ({
        id: phaseItem.id || uid(),
        name: phaseItem.name,
        projects: [],
        topics: (phaseItem.topics || []).map((topicItem) => enrichTopic(topicItem))
      })),
      glossary: [],
      resources: [],
      versionHistory: []
    };
  }
  ensureCurriculumTopics(state.curriculum);
  state.progress = calculateProgress(state);
  return state;
}

export function updateTopicNotes(state, topicId, notes) {
  const topicItem = findCurriculumTopic(state, topicId);
  if (!topicItem) throw new Error('Topic not found.');
  topicItem.notes = String(notes || '');
  return topicItem;
}

export function setManualOverride(state, topicId, input = {}) {
  const topicItem = findCurriculumTopic(state, topicId);
  if (!topicItem) throw new Error('Topic not found.');
  topicItem.manualOverride = {
    completed: Boolean(input.completed),
    reason: input.reason || '',
    updatedAt: new Date().toISOString()
  };
  topicItem.completion = topicItem.manualOverride.completed ? 100 : completionForTopic(topicItem);
  state.progress = calculateProgress(state);
  return topicItem;
}

export async function mentorReply(state, topicId, question) {
  const topicItem = findCurriculumTopic(state, topicId);
  if (!topicItem) throw new Error('Topic not found.');
  const result = await mentorWithAI(state, topicId, question);
  topicItem.chatHistory.push({ id: uid(), question: question || '', reply: result.reply, recommendedActions: result.recommendedActions, createdAt: new Date().toISOString() });
  return { ...result, topic: topicItem };
}

export async function dynamicResourcesFor(topicItem, curriculum, options = {}) {
  return findTopicResources(topicItem, curriculum, options);
}

export function findCurriculumTopic(state, topicId) {
  for (const phaseItem of (state.curriculum && state.curriculum.phases) || []) {
    for (const topicItem of getPhaseTopics(phaseItem)) {
      if (topicItem.id === topicId) return topicItem;
    }
  }
  return null;
}

export function getAllTopics(state) {
  return ((state.curriculum && state.curriculum.phases) || state.phases || []).flatMap((phaseItem) => getPhaseTopics(phaseItem));
}

export function getPhaseTopics(phaseItem) {
  return [...(phaseItem.topics || []), ...(phaseItem.projects || []).flatMap((project) => project.topics || [])];
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function enrichTopic(topicItem) {
  return {
    id: topicItem.id || uid(),
    name: topicItem.name,
    description: topicItem.description || '',
    objectives: topicItem.objectives || [],
    deliverables: topicItem.deliverables || [],
    successCriteria: topicItem.successCriteria || topicItem.activities || [],
    keywords: topicItem.keywords || [],
    glossary: topicItem.glossary || [],
    resources: topicItem.resources || { static: [], dynamic: [] },
    status: normaliseStatus(topicItem.status),
    completion: typeof topicItem.completion === 'number' ? topicItem.completion : undefined,
    notes: topicItem.notes || '',
    chatHistory: topicItem.chatHistory || [],
    manualOverride: topicItem.manualOverride || null
  };
}

function ensureCurriculumTopics(curriculum) {
  if (!curriculum.phases) curriculum.phases = [];
  for (const phaseItem of curriculum.phases) {
    if (!phaseItem.projects) phaseItem.projects = [];
    phaseItem.topics = (phaseItem.topics || []).map((topicItem) => enrichTopic(topicItem));
    for (const project of phaseItem.projects) {
      project.topics = (project.topics || []).map((topicItem) => enrichTopic(topicItem));
    }
  }
}

function criteriaFor(topicItem) {
  const criteria = [
    ...(topicItem.successCriteria || []),
    ...(topicItem.deliverables || []),
    ...(topicItem.objectives || [])
  ].filter(Boolean);
  return criteria.length ? criteria : [topicItem.name];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
