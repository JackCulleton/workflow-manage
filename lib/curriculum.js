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

export async function createCurriculumFromText(input = {}) {
  return parseCurriculumWithAI(input);
}

export function ensureCurriculumState(state) {
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

export async function importCurriculum(state, input) {
  const next = await parseCurriculumWithAI(input);
  if (state.curriculum) {
    const currentHash = state.curriculum.source && state.curriculum.source.versionHash;
    const nextHash = next.source && next.source.versionHash;
    if (currentHash && nextHash && currentHash !== nextHash && !input.confirmUpdate) {
      return {
        needsConfirmation: true,
        differences: diffCurricula(state.curriculum, next),
        proposedCurriculum: next
      };
    }
    next.versionHistory = [...(state.curriculum.versionHistory || []), state.curriculum.source].filter(Boolean);
  }
  state.curriculum = next;
  state.title = next.title;
  state.subtitle = 'AI curriculum roadmap with evidence-based progress tracking.';
  state.phases = next.phases.map((phaseItem) => ({
    id: phaseItem.id,
    name: phaseItem.name,
    topics: getPhaseTopics(phaseItem),
    documents: []
  }));
  state.progress = calculateProgress(state);
  return { curriculum: next, workflow: state };
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
  const repositoryContext = state.repository ? await collectRepositoryContext(state.repository.url || `${state.repository.owner}/${state.repository.repo}`) : null;
  const result = await mentorWithAI(state, topicId, question, repositoryContext);
  topicItem.chatHistory.push({ id: uid(), question: question || '', reply: result.reply, recommendedActions: result.recommendedActions, createdAt: new Date().toISOString() });
  return { ...result, topic: topicItem };
}

export async function auditTopic(state, topicId, input = {}) {
  const topicItem = findCurriculumTopic(state, topicId);
  if (!topicItem) throw new Error('Topic not found.');
  const repo = parseRepo(input.repositoryUrl || (state.repository && state.repository.url) || '');
  if (!repo) throw new Error('A GitHub repository URL or owner/repo value is required.');

  const repositoryContext = await collectRepositoryContext(input.repositoryUrl || (state.repository && state.repository.url) || `${repo.owner}/${repo.repo}`);
  const aiAudit = await auditRepositoryWithAI(state, topicId, repositoryContext);
  const completion = clamp(Math.round(aiAudit.completion), 0, 100);
  const status = normaliseStatus(aiAudit.status);
  const audit = {
    id: uid(),
    repository: `${repo.owner}/${repo.repo}`,
    status,
    completion,
    confidence: clamp(Math.round(aiAudit.confidence), 0, 100),
    summary: aiAudit.summary,
    evidence: aiAudit.evidence,
    recommendedNextSteps: aiAudit.recommendedNextSteps,
    createdAt: new Date().toISOString()
  };
  topicItem.audit = audit;
  topicItem.audits.push(audit);
  topicItem.status = status;
  topicItem.completion = completion;
  state.repository = { url: input.repositoryUrl || `${repo.owner}/${repo.repo}`, owner: repo.owner, repo: repo.repo };
  state.progress = calculateProgress(state);
  return { audit, topic: topicItem, progress: state.progress };
}

export async function dynamicResourcesFor(topicItem, curriculum) {
  const result = await discoverResourcesWithAI(topicItem, curriculum);
  return result.resources.map((resource) => ({ id: uid(), ...resource }));
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
    confidence: topicItem.confidence || 0,
    audit: topicItem.audit || null,
    audits: topicItem.audits || [],
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

export async function collectRepositoryContext(repositoryUrl) {
  const repo = parseRepo(repositoryUrl || '');
  if (!repo) throw new Error('A GitHub repository URL or owner/repo value is required.');
  const headers = { 'User-Agent': 'mountain-scope-curriculum-audit' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const [meta, readme, tree] = await Promise.all([
    fetchJson(base, headers),
    fetchText(`${base}/readme`, headers),
    fetchJson(`${base}/git/trees/HEAD?recursive=1`, headers)
  ]);
  const files = Array.isArray(tree && tree.tree)
    ? tree.tree.filter((item) => item.type === 'blob' && sourceFile(item.path) && item.size <= 60000).slice(0, 60)
    : [];
  const fileContents = await Promise.all(files.map((file) => fetchBlob(base, file, headers)));
  return {
    repository: `${repo.owner}/${repo.repo}`,
    description: meta && meta.description,
    language: meta && meta.language,
    topics: (meta && meta.topics) || [],
    defaultBranch: (meta && meta.default_branch) || 'HEAD',
    readme: truncate(readme, 12000),
    files: fileContents.filter(Boolean)
  };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  return response.json();
}

async function fetchText(url, headers) {
  const response = await fetch(url, { headers: { ...headers, Accept: 'application/vnd.github.raw' } });
  if (!response.ok) return '';
  return response.text();
}

async function fetchBlob(base, file, headers) {
  const response = await fetch(`${base}/git/blobs/${file.sha}`, { headers });
  if (!response.ok) return null;
  const body = await response.json();
  if (!body || body.encoding !== 'base64' || !body.content) return null;
  const content = Buffer.from(body.content, 'base64').toString('utf8');
  return { path: file.path, size: file.size, content: truncate(content, 8000) };
}

function parseRepo(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i) || trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

function diffCurricula(current, next) {
  return {
    currentTitle: current.title,
    nextTitle: next.title,
    currentPhaseCount: (current.phases && current.phases.length) || 0,
    nextPhaseCount: (next.phases && next.phases.length) || 0,
    currentTopicCount: current.phases ? current.phases.flatMap(getPhaseTopics).length : 0,
    nextTopicCount: next.phases ? next.phases.flatMap(getPhaseTopics).length : 0
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sourceFile(path) {
  return /\.(c|h|cpp|hpp|cc|js|ts|tsx|jsx|py|java|go|rs|rb|php|sh|md|txt|json|yml|yaml|toml|makefile)$/i.test(path) || /(^|\/)(Makefile|Dockerfile)$/i.test(path);
}

function truncate(value, limit) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}
import { auditRepositoryWithAI, discoverResourcesWithAI, mentorWithAI, parseCurriculumWithAI } from './ai.js';
