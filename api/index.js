import {
  addPhase,
  addTopic,
  assignMemberToPhase,
  assignMemberToTopic,
  deletePhase,
  deleteTopic,
  movePhase,
  moveTopic,
  setAssignments,
  unassignMemberFromPhase,
  unassignMemberFromTopic,
  updatePhase,
  updateTopic,
  validateState
} from '../lib/workflow.js';
import {
  calculateProgress,
  dynamicResourcesFor,
  ensureCurriculumState,
  findCurriculumTopic,
  mentorReply,
  setManualOverride,
  updateTopicNotes
} from '../lib/curriculum.js';

const WORKFLOW_ID = 'main';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb'
    }
  }
};

function send(res, status, body) {
  res.status(status).json(body);
}

function requestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendError(res, status, error, id) {
  return send(res, status, { success: false, error, requestId: id });
}

export function statusForApiError(error) {
  const message = String((error && error.message) || '');
  if (/too large/i.test(message)) return 413;
  if (/OPENAI_API_KEY|OpenAI request failed|OpenAI returned invalid JSON|OpenAI response/i.test(message)) return 500;
  if (/not found/i.test(message)) return 404;
  if (/required|must|contain|already exists|direction|duplicate|ambiguous|would remove existing projects|different id/i.test(message)) return 400;
  return 500;
}

export function messageForApiError(error, path) {
  const message = String((error && error.message) || 'Request failed');
  if (/OPENAI_API_KEY/i.test(message)) return `Server route ${path} failed: ${message}`;
  return message;
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function contentLength(req) {
  const length = Number(req.headers['content-length']);
  return Number.isFinite(length) ? length : null;
}

function routeLogBase(req, path, id, startedAt) {
  return {
    requestId: id,
    method: req.method,
    path,
    contentType: req.headers['content-type'] || '',
    contentLength: contentLength(req),
    durationMs: Date.now() - startedAt
  };
}

async function storageError(action, response) {
  const body = await response.json().catch(() => null);
  const detail = (body && (body.message || body.hint || body.code));
  const suffix = detail ? `: ${detail}` : '';
  return new Error(`Storage ${action} failed (${response.status})${suffix}`);
}

async function readState() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/workflow_state?id=eq.${WORKFLOW_ID}&select=data`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) throw await storageError('read', response);
  const rows = await response.json();
  return rows[0] ? rows[0].data : null;
}

async function writeState(state) {
  const migrated = migrateToSingleProject(state).state;
  state = migrated || state;
  validateState(state);
  const url = `${process.env.SUPABASE_URL}/rest/v1/workflow_state?on_conflict=id`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: WORKFLOW_ID, data: state, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw await storageError('write', response);
}

function normaliseName(value) {
  return String(value || '').trim().toLowerCase();
}

function phaseCount(project) {
  return ((project && project.curriculum && project.curriculum.phases) || (project && project.phases) || []).length;
}

function topicCount(project) {
  return ((project && project.curriculum && project.curriculum.phases) || (project && project.phases) || [])
    .reduce((sum, phase) => sum + getPhaseTopicList(phase).length, 0);
}

function getPhaseTopicList(phase) {
  return [...(phase.topics || []), ...(phase.projects || []).flatMap((project) => project.topics || [])];
}

function stripNestedProjectsFromPhases(phases = []) {
  let changed = false;
  for (const phase of phases) {
    if (!phase || typeof phase !== 'object') continue;
    const nestedTopics = (phase.projects || []).flatMap((project) => project.topics || []);
    if (nestedTopics.length) {
      phase.topics = [...(phase.topics || []), ...nestedTopics];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(phase, 'projects')) {
      delete phase.projects;
      changed = true;
    }
  }
  return changed;
}

function projectName(project) {
  return project && (project.name || project.title || (project.curriculum && project.curriculum.title) || 'Workflow');
}

function projectToWorkflow(project) {
  normaliseProject(project);
  const phases = (project.curriculum && project.curriculum.phases) || project.phases || [];
  stripNestedProjectsFromPhases(phases);
  const name = projectName(project);
  return {
    title: name,
    subtitle: project.subtitle || '',
    teamMembers: project.teamMembers || [],
    project: {
      id: project.id,
      name,
      description: project.description || project.subtitle || '',
      teamMembers: project.teamMembers || [],
      phases
    },
    curriculum: {
      ...(project.curriculum || {}),
      id: (project.curriculum && project.curriculum.id) || project.id,
      title: name,
      phases,
      glossary: (project.curriculum && project.curriculum.glossary) || [],
      resources: (project.curriculum && project.curriculum.resources) || [],
      versionHistory: (project.curriculum && project.curriculum.versionHistory) || []
    },
    phases,
    progress: null,
    migrationBackups: project.migrationBackups || []
  };
}

export function migrateToSingleProject(input) {
  const state = input || null;
  if (!state) return { state: null, changed: false };
  if (state.project && !Array.isArray(state.projects)) {
    ensureCurriculumState(state);
    const changed = stripNestedProjectsFromPhases(state.curriculum.phases);
    state.project.phases = state.curriculum.phases;
    state.project.teamMembers = state.teamMembers || state.project.teamMembers || [];
    state.project.name = state.project.name || state.title || state.curriculum.title || 'Workflow';
    state.progress = calculateProgress(state);
    return { state, changed };
  }
  const projects = Array.isArray(state.projects) ? state.projects : [];
  let selected = projects.find((project) => project.id === state.activeProjectId);
  if (!selected) {
    const minishellProjects = projects.filter((project) => normaliseName(projectName(project)) === 'minishell');
    selected = minishellProjects.sort((a, b) => topicCount(b) - topicCount(a) || phaseCount(b) - phaseCount(a))[0] || projects[0];
  }
  if (!selected) {
    selected = {
      id: 'single-project',
      title: state.title || 'Workflow',
      subtitle: state.subtitle || '',
      teamMembers: state.teamMembers || [],
      curriculum: state.curriculum || { id: 'single-project', title: state.title || 'Workflow', phases: state.phases || [], glossary: [], resources: [], versionHistory: [] },
      phases: state.phases || []
    };
  }
  const next = projectToWorkflow(selected);
  next.migrationBackups = [
    ...(Array.isArray(state.migrationBackups) ? state.migrationBackups : []),
    ...(projects.length ? [{
      id: `backup-${Date.now()}`,
      createdAt: new Date().toISOString(),
      reason: 'single-project-migration',
      activeProjectId: state.activeProjectId || '',
      projects
    }] : [])
  ];
  ensureCurriculumState(next);
  stripNestedProjectsFromPhases(next.curriculum.phases);
  next.project.phases = next.curriculum.phases;
  next.progress = calculateProgress(next);
  return { state: next, changed: true };
}

function projectResponse(state) {
  return {
    id: state.project.id,
    name: state.project.name,
    description: state.project.description || '',
    teamMembers: state.teamMembers || state.project.teamMembers || [],
    phases: state.curriculum.phases,
    progress: state.progress || calculateProgress(state)
  };
}

function normaliseProject(project) {
  if (!project || typeof project !== 'object') return project;
  ensureCurriculumState(project);
  project.phases = project.phases || (project.curriculum && project.curriculum.phases) || [];
  stripNestedProjectsFromPhases(project.curriculum?.phases || project.phases);
  project.progress = calculateProgress(project);
  return project;
}

export default async function handler(req, res) {
  const id = requestId();
  const startedAt = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('X-Request-Id', id);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('API request failed', {
      requestId: id,
      method: req.method,
      path: new URL(req.url, 'https://workflow.local').pathname.replace(/^\/api/, '') || '/workflow',
      status: 500,
      contentLength: contentLength(req),
      durationMs: Date.now() - startedAt,
      errorName: 'ConfigurationError',
      errorMessage: 'Storage is not configured.'
    });
    return sendError(res, 500, 'Storage is not configured.', id);
  }

  const path = new URL(req.url, 'https://workflow.local').pathname.replace(/^\/api/, '') || '/workflow';

  try {
    if (req.method === 'GET' && path === '/workflow') {
      const result = migrateToSingleProject(await readState());
      const workflow = result.state;
      if (workflow) ensureCurriculumState(workflow);
      if (result.changed && workflow) await writeState(workflow);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, project: workflow ? projectResponse(workflow) : null, workflow });
    }
    if (req.method === 'PUT' && path === '/workflow') {
      const workflow = validateState(migrateToSingleProject(req.body && req.body.workflow).state);
      await writeState(workflow);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, project: projectResponse(workflow), workflow, persistence: 'stored' });
    }

    const migration = migrateToSingleProject(await readState());
    const state = migration.state;
    if (!state) {
      console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 409, errorMessage: 'Open the dashboard once to initialise the workflow.' });
      return sendError(res, 409, 'Open the dashboard once to initialise the workflow.', id);
    }
    ensureCurriculumState(state);
    if (migration.changed) await writeState(state);

    if (req.method === 'GET' && path === '/curriculum') {
      state.progress = calculateProgress(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { curriculum: state.curriculum, progress: state.progress });
    }
    if (req.method === 'GET' && path === '/progress') {
      state.progress = calculateProgress(state);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { progress: state.progress });
    }

    if (req.method === 'POST' && path === '/phases') {
      if (!req.body || !req.body.name || !req.body.name.trim()) {
        console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 400, errorMessage: 'Phase name is required.' });
        return sendError(res, 400, 'Phase name is required.', id);
      }
      const phase = addPhase(state, req.body);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 201 });
      return send(res, 201, { success: true, projectId: state.project.id, phaseId: phase.id, phase, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const phaseMatch = path.match(/^\/phases\/([^/]+)$/);
    if (phaseMatch && req.method === 'PATCH') {
      const phase = updatePhase(state, phaseMatch[1], req.body || {});
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, phaseId: phase.id, phase, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (phaseMatch && req.method === 'DELETE') {
      deletePhase(state, phaseMatch[1]);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, phaseId: phaseMatch[1], persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const phaseMoveMatch = path.match(/^\/phases\/([^/]+)\/move$/);
    if (phaseMoveMatch && req.method === 'POST') {
      movePhase(state, phaseMoveMatch[1], (req.body && req.body.direction) || '');
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, phaseId: phaseMoveMatch[1], persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'POST' && path === '/topics') {
      const phaseId = req.body && (req.body.phaseId || req.body.phase_id);
      if (!req.body || !phaseId || !req.body.name || !req.body.name.trim()) {
        console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 400, errorMessage: 'phase_id and name are required.' });
        return sendError(res, 400, 'phase_id and name are required.', id);
      }
      const topic = addTopic(state, { ...req.body, phase_id: phaseId });
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 201 });
      return send(res, 201, { success: true, projectId: state.project.id, phaseId, topicId: topic.id, topic, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const match = path.match(/^\/topics\/([^/]+)$/);
    if (req.method === 'PATCH' && match) {
      const topic = updateTopic(state, match[1], req.body || {});
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, topicId: topic.id, topic, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'DELETE' && match) {
      deleteTopic(state, match[1]);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, topicId: match[1], persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const topicMoveMatch = path.match(/^\/topics\/([^/]+)\/move$/);
    if (req.method === 'POST' && topicMoveMatch) {
      moveTopic(state, topicMoveMatch[1], (req.body && req.body.direction) || '');
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, topicId: topicMoveMatch[1], persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'POST' && path === '/assignments/phases/assign') {
      const result = assignMemberToPhase(state, req.body && req.body.phaseId, req.body && req.body.memberId);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, phaseId: result.target.id, phase: result.target, assignedMembers: result.assignedMembers, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'POST' && path === '/assignments/phases/unassign') {
      const result = unassignMemberFromPhase(state, req.body && req.body.phaseId, req.body && req.body.memberId);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, phaseId: result.target.id, phase: result.target, assignedMembers: result.assignedMembers, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'POST' && path === '/assignments/topics/assign') {
      const result = assignMemberToTopic(state, req.body && req.body.topicId, req.body && req.body.memberId);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, topicId: result.target.id, topic: result.target, assignedMembers: result.assignedMembers, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'POST' && path === '/assignments/topics/unassign') {
      const result = unassignMemberFromTopic(state, req.body && req.body.topicId, req.body && req.body.memberId);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, topicId: result.target.id, topic: result.target, assignedMembers: result.assignedMembers, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    if (req.method === 'POST' && path === '/assignments/batch') {
      const results = setAssignments(state, req.body && req.body.assignments);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, assignments: results, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const notesMatch = path.match(/^\/topics\/([^/]+)\/notes$/);
    if (req.method === 'PATCH' && notesMatch) {
      const topic = updateTopicNotes(state, notesMatch[1], (req.body && req.body.notes) || '');
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, topicId: topic.id, topic, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const manualMatch = path.match(/^\/topics\/([^/]+)\/manual-override$/);
    if (req.method === 'PATCH' && manualMatch) {
      const topic = setManualOverride(state, manualMatch[1], req.body || {});
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, topicId: topic.id, topic, progress: state.progress, persistence: 'stored', project: projectResponse(state), workflow: state });
    }
    const resourcesMatch = path.match(/^\/topics\/([^/]+)\/resources$/);
    if (req.method === 'GET' && resourcesMatch) {
      const topic = findCurriculumTopic(state, resourcesMatch[1]);
      if (!topic) {
        console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 404, errorMessage: 'Topic not found.' });
        return sendError(res, 404, 'Topic not found.', id);
      }
      const refresh = new URL(req.url, 'https://workflow.local').searchParams.get('refresh') === 'true';
      const result = await dynamicResourcesFor(topic, state.curriculum, { refresh });
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { resources: result.resources, searched: result.searched, topic });
    }
    const mentorMatch = path.match(/^\/topics\/([^/]+)\/mentor$/);
    if (req.method === 'POST' && mentorMatch) {
      const result = await mentorReply(state, mentorMatch[1], (req.body && req.body.question) || '');
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: state.project.id, topicId: mentorMatch[1], persistence: 'stored', ...result });
    }
    console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 404, errorMessage: 'Endpoint not found.' });
    return sendError(res, 404, 'Endpoint not found.', id);
  } catch (error) {
    const status = statusForApiError(error);
    const errorMessage = messageForApiError(error, path);
    console.error('API request failed', {
      ...routeLogBase(req, path, id, startedAt),
      status,
      errorName: error && error.name,
      errorMessage,
      stack: error && error.stack
    });
    return sendError(res, status, errorMessage, id);
  }
}
