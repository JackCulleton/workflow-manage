import { auditRepositoryWithAI, auditRoadmapWithAI, discoverResourcesWithAI, mentorWithAI, parseCurriculumWithAI } from './ai.js';

const COMPLETE_STATUSES = new Set(['complete', 'completed']);
const PARTIAL_STATUSES = new Set(['partial', 'in_progress']);
const MAX_GENERATED_PHASES = 40;
const MAX_GENERATED_TOPICS = 400;

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
  validateCurriculumRoadmap(next);
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

export function validateCurriculumRoadmap(curriculum) {
  if (!curriculum || typeof curriculum !== 'object') throw new Error('Generated roadmap is invalid.');
  if (!Array.isArray(curriculum.phases) || curriculum.phases.length === 0) throw new Error('Generated roadmap must contain at least one phase.');
  if (curriculum.phases.length > MAX_GENERATED_PHASES) throw new Error(`Generated roadmap contains too many phases. Maximum supported phases: ${MAX_GENERATED_PHASES}.`);
  const ids = new Set();
  let topicCount = 0;
  for (const phase of curriculum.phases) {
    if (!phase || typeof phase !== 'object') throw new Error('Generated roadmap contains an invalid phase.');
    if (!String(phase.name || '').trim()) throw new Error('Generated roadmap contains a phase without a title.');
    if (!Array.isArray(phase.topics)) throw new Error(`Generated roadmap phase "${phase.name}" must contain a topics array.`);
    if (!Array.isArray(phase.projects)) phase.projects = [];
    for (const project of phase.projects) {
      if (!project || typeof project !== 'object') throw new Error(`Generated roadmap phase "${phase.name}" contains an invalid project.`);
      if (!String(project.name || '').trim()) throw new Error(`Generated roadmap phase "${phase.name}" contains a project without a title.`);
      if (!Array.isArray(project.topics)) throw new Error(`Generated roadmap project "${project.name}" must contain a topics array.`);
    }
    for (const topic of getPhaseTopics(phase)) {
      topicCount += 1;
      if (!topic || typeof topic !== 'object') throw new Error(`Generated roadmap phase "${phase.name}" contains an invalid topic.`);
      if (!String(topic.name || '').trim()) throw new Error(`Generated roadmap phase "${phase.name}" contains a topic without a title.`);
      if (topic.id) {
        if (ids.has(topic.id)) throw new Error(`Generated roadmap contains a duplicate topic id: ${topic.id}.`);
        ids.add(topic.id);
      }
      for (const key of ['objectives', 'deliverables', 'successCriteria', 'keywords', 'glossary']) {
        if (topic[key] !== undefined && !Array.isArray(topic[key])) throw new Error(`Generated roadmap topic "${topic.name}" has invalid ${key}.`);
      }
      if (topic.completion !== undefined && (typeof topic.completion !== 'number' || topic.completion < 0 || topic.completion > 100)) {
        throw new Error(`Generated roadmap topic "${topic.name}" has invalid completion.`);
      }
    }
  }
  if (topicCount === 0) throw new Error('Generated roadmap must contain at least one topic.');
  if (topicCount > MAX_GENERATED_TOPICS) throw new Error(`Generated roadmap contains too many topics. Maximum supported topics: ${MAX_GENERATED_TOPICS}.`);
  return curriculum;
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
  const audit = applyTopicAudit(state, topicItem, repo, aiAudit);
  state.repository = { url: input.repositoryUrl || `${repo.owner}/${repo.repo}`, owner: repo.owner, repo: repo.repo };
  state.progress = calculateProgress(state);
  return { audit, topic: topicItem, progress: state.progress };
}

export async function auditRepository(state, input = {}) {
  const repo = parseRepo(input.repositoryUrl || (state.repository && state.repository.url) || '');
  if (!repo) throw new Error('A GitHub repository URL or owner/repo value is required.');

  const repositoryContext = await collectRepositoryContext(input.repositoryUrl || (state.repository && state.repository.url) || `${repo.owner}/${repo.repo}`);
  const topics = getAllTopics(state);
  if (!topics.length) throw new Error('Roadmap must contain at least one topic before repository progress can be calculated.');
  const auditableTopics = topics.filter((topicItem) => !(topicItem.manualOverride && topicItem.manualOverride.completed));
  if (!auditableTopics.length) {
    state.repository = { url: input.repositoryUrl || `${repo.owner}/${repo.repo}`, owner: repo.owner, repo: repo.repo };
    state.progress = calculateProgress(state);
    return { audits: [], progress: state.progress, workflow: state, repository: state.repository };
  }
  const result = await auditRoadmapWithAI(state, repositoryContext, auditableTopics.map((topicItem) => topicItem.id));
  const auditsByTopic = new Map((result.audits || []).map((audit) => [audit.topicId, audit]));
  const missingTopics = auditableTopics.filter((topicItem) => !auditsByTopic.has(topicItem.id));
  if (missingTopics.length) throw new Error('Repository audit did not return results for every roadmap topic.');

  const audits = [];
  for (const topicItem of auditableTopics) {
    audits.push(applyTopicAudit(state, topicItem, repo, auditsByTopic.get(topicItem.id)));
  }

  state.repository = { url: input.repositoryUrl || `${repo.owner}/${repo.repo}`, owner: repo.owner, repo: repo.repo };
  state.progress = calculateProgress(state);
  return { audits, progress: state.progress, workflow: state, repository: state.repository };
}

function applyTopicAudit(state, topicItem, repo, aiAudit) {
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
  topicItem.confidence = audit.confidence;
  return audit;
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
  const meta = await fetchJson(base, headers);
  if (!meta) throw new Error('Repository not found or GitHub API access failed.');
  const defaultBranch = meta.default_branch || 'main';
  const [readme, tree] = await Promise.all([
    fetchText(`${base}/readme`, headers),
    fetchJson(`${base}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, headers)
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
    defaultBranch,
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
