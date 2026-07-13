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

export function createCurriculumFromText(input = {}) {
  const text = (input.text || '').replace(/\r/g, '').trim();
  if (!text) throw new Error('Curriculum text is required.');

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = cleanHeading(input.title || lines[0] || 'Imported Curriculum');
  const phases = [];
  let currentPhase = null;
  let currentProject = null;
  let currentTopic = null;
  const glossary = [];
  const resources = [];

  for (const raw of lines.slice(input.title ? 0 : 1)) {
    const line = raw.replace(/^[-*]\s*/, '').trim();
    const lower = line.toLowerCase();

    if (/^(phase|module|part|section)\b/i.test(line)) {
      currentPhase = phase(cleanHeading(line));
      phases.push(currentPhase);
      currentProject = null;
      currentTopic = null;
      continue;
    }

    if (/^(project|assignment|exercise)\b/i.test(line)) {
      if (!currentPhase) {
        currentPhase = phase('General');
        phases.push(currentPhase);
      }
      currentProject = { id: uid(), name: cleanHeading(line), topics: [] };
      currentPhase.projects.push(currentProject);
      currentTopic = null;
      continue;
    }

    if (/^(topic|concept|chapter|lesson)\b/i.test(line)) {
      currentTopic = topic(cleanHeading(line));
      addTopicToCurrent(currentPhase, currentProject, currentTopic, phases);
      continue;
    }

    if (/^(objective|learning objective)s?:/i.test(line)) {
      ensureTopic(phases, currentPhase, currentProject, currentTopic).objectives.push(cleanValue(line));
      continue;
    }

    if (/^(deliverable|deliverables):/i.test(line)) {
      ensureTopic(phases, currentPhase, currentProject, currentTopic).deliverables.push(cleanValue(line));
      continue;
    }

    if (/^(success criteria|criteria|completion criteria):/i.test(line)) {
      ensureTopic(phases, currentPhase, currentProject, currentTopic).successCriteria.push(cleanValue(line));
      continue;
    }

    if (/^(keyword|keywords):/i.test(line)) {
      ensureTopic(phases, currentPhase, currentProject, currentTopic).keywords.push(...splitList(cleanValue(line)));
      continue;
    }

    if (/^(resource|resources|official resource):/i.test(line) || /^https?:\/\//i.test(line)) {
      const resource = resourceFromLine(cleanValue(line) || line);
      resources.push(resource);
      if (currentTopic) currentTopic.resources.static.push(resource);
      continue;
    }

    if (/^(glossary|term):/i.test(line)) {
      glossary.push({ term: cleanHeading(cleanValue(line)), definition: '' });
      continue;
    }

    if (lower.length > 2) {
      currentTopic = topic(cleanHeading(line));
      addTopicToCurrent(currentPhase, currentProject, currentTopic, phases);
    }
  }

  if (!phases.length) {
    phases.push(phase('General'));
    phases[0].topics = lines.slice(0, 8).map((line) => topic(cleanHeading(line)));
  }

  const curriculum = {
    id: uid(),
    title,
    source: {
      name: input.sourceName || 'Imported curriculum',
      type: input.sourceType || 'text',
      importedAt: new Date().toISOString(),
      versionHash: hashText(text)
    },
    phases,
    glossary,
    resources,
    versionHistory: []
  };

  ensureCurriculumTopics(curriculum);
  return curriculum;
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

export function importCurriculum(state, input) {
  const next = createCurriculumFromText(input);
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

export function mentorReply(state, topicId, question) {
  const topicItem = findCurriculumTopic(state, topicId);
  if (!topicItem) throw new Error('Topic not found.');
  const missing = criteriaFor(topicItem).filter((criterion) => !evidenceMatches((topicItem.audit && topicItem.audit.evidence) || [], criterion));
  const reply = [
    `${topicItem.name}: ${topicItem.description || 'No description was extracted from the curriculum.'}`,
    topicItem.objectives.length ? `Objectives: ${topicItem.objectives.join('; ')}` : 'Objectives: none stored yet.',
    missing.length ? `Missing or unverified criteria: ${missing.join('; ')}` : 'All stored criteria are currently satisfied or manually completed.',
    question ? `Question focus: ${question}` : 'Ask for an explanation, missing work, architecture advice, or verification help.'
  ].join('\n\n');
  topicItem.chatHistory.push({ id: uid(), question: question || '', reply, createdAt: new Date().toISOString() });
  return { reply, topic: topicItem };
}

export async function auditTopic(state, topicId, input = {}) {
  const topicItem = findCurriculumTopic(state, topicId);
  if (!topicItem) throw new Error('Topic not found.');
  const repo = parseRepo(input.repositoryUrl || (state.repository && state.repository.url) || '');
  if (!repo) throw new Error('A GitHub repository URL or owner/repo value is required.');

  const repoEvidence = await collectRepositoryEvidence(repo);
  const criteria = criteriaFor(topicItem);
  const evidence = criteria.map((criterion) => {
    const match = matchCriterion(criterion, repoEvidence);
    return {
      criterion,
      met: Boolean(match),
      detail: match ? `Found evidence in ${match}` : 'No matching implementation evidence found.'
    };
  });
  const matched = evidence.filter((item) => item.met).length;
  const completion = criteria.length ? Math.round((matched / criteria.length) * 100) : 0;
  const status = completion === 100 ? 'complete' : completion > 0 ? 'partial' : 'missing';
  const audit = {
    id: uid(),
    repository: `${repo.owner}/${repo.repo}`,
    status,
    completion,
    confidence: criteria.length ? Math.min(95, 55 + criteria.length * 8 + matched * 7) : 50,
    evidence,
    recommendedNextSteps: evidence.filter((item) => !item.met).map((item) => `Address: ${item.criterion}`),
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

export function dynamicResourcesFor(topicItem) {
  const query = encodeURIComponent([topicItem.name, ...(topicItem.keywords || [])].join(' '));
  return [
    { title: `${topicItem.name} official documentation search`, url: `https://www.google.com/search?q=${query}+official+documentation`, type: 'official-search' },
    { title: `${topicItem.name} GitHub examples`, url: `https://github.com/search?q=${query}`, type: 'github' },
    { title: `${topicItem.name} Stack Overflow`, url: `https://stackoverflow.com/search?q=${query}`, type: 'stackoverflow' }
  ];
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

function phase(name) {
  return { id: uid(), name, projects: [], topics: [] };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function topic(name) {
  return enrichTopic({ id: uid(), name, description: '', status: 'not_verified' });
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

function addTopicToCurrent(currentPhase, currentProject, currentTopic, phases) {
  if (!currentPhase) {
    currentPhase = phases.find((item) => item.name === 'General') || phase('General');
    if (!phases.includes(currentPhase)) phases.push(currentPhase);
  }
  if (currentProject) currentProject.topics.push(currentTopic);
  else currentPhase.topics.push(currentTopic);
}

function ensureTopic(phases, currentPhase, currentProject, currentTopic) {
  if (currentTopic) return currentTopic;
  const fallback = topic('General Topic');
  addTopicToCurrent(currentPhase, currentProject, fallback, phases);
  return fallback;
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

function evidenceMatches(evidence, criterion) {
  return evidence.some((item) => item.met && normaliseText(item.criterion) === normaliseText(criterion));
}

function matchCriterion(criterion, repoEvidence) {
  const tokens = keywordsFor(criterion);
  if (!tokens.length) return null;
  const found = repoEvidence.find((item) => tokens.some((token) => item.searchText.includes(token)));
  return found ? found.label : null;
}

function keywordsFor(value) {
  return normaliseText(value).split(' ').filter((token) => token.length > 2);
}

async function collectRepositoryEvidence(repo) {
  const headers = { 'User-Agent': 'mountain-scope-curriculum-audit' };
  const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const [meta, readme, tree] = await Promise.all([
    fetchJson(base, headers),
    fetchText(`${base}/readme`, headers),
    fetchJson(`${base}/git/trees/HEAD?recursive=1`, headers)
  ]);
  const files = Array.isArray(tree && tree.tree) ? tree.tree.filter((item) => item.type === 'blob').slice(0, 300) : [];
  return [
    { label: 'repository metadata', searchText: normaliseText([meta && meta.description, meta && meta.language, meta && meta.topics && meta.topics.join(' ')].filter(Boolean).join(' ')) },
    { label: 'README', searchText: normaliseText(readme) },
    ...files.map((file) => ({ label: file.path, searchText: normaliseText(file.path) }))
  ];
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

function resourceFromLine(value) {
  const urlMatch = value.match(/https?:\/\/\S+/);
  const url = urlMatch ? urlMatch[0] : '';
  return { id: uid(), title: value.replace(url, '').trim() || url || value, url, type: 'static' };
}

function cleanHeading(line) {
  return line.replace(/^(phase|module|part|section|project|assignment|exercise|topic|concept|chapter|lesson)\s*[:\d.-]*/i, '').trim() || line.trim();
}

function cleanValue(line) {
  return line.replace(/^[^:]+:\s*/, '').trim();
}

function splitList(value) {
  return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16);
}

function normaliseText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
