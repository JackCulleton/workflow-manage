import { addPhase, addTopic, deletePhase, deleteTopic, movePhase, moveTopic, updatePhase, updateTopic, validateState } from '../lib/workflow.js';
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

function assertUniqueProjectIdentities(state) {
  const projects = Array.isArray(state && state.projects) ? state.projects : [];
  const ids = new Set();
  const names = new Set();
  for (const project of projects) {
    if (!project.id) throw new Error('Every project requires a stable id.');
    if (!project.title || !String(project.title).trim()) throw new Error('Every project requires a title.');
    if (ids.has(project.id)) throw new Error('Duplicate project id.');
    ids.add(project.id);
    const name = normaliseName(project.title);
    if (names.has(name)) throw new Error('Duplicate project name.');
    names.add(name);
  }
  if (state.activeProjectId && projects.length && !projects.some((project) => project.id === state.activeProjectId)) {
    throw new Error('activeProjectId must reference an existing project.');
  }
}

export function validateWorkflowReplacement(existing, next, options = {}) {
  assertUniqueProjectIdentities(next);
  const previousProjects = Array.isArray(existing && existing.projects) ? existing.projects : [];
  const nextProjects = Array.isArray(next && next.projects) ? next.projects : [];
  if (!previousProjects.length || !nextProjects.length) return;

  for (const previous of previousProjects) {
    const sameName = nextProjects.find((project) => normaliseName(project.title) === normaliseName(previous.title));
    if (sameName && sameName.id !== previous.id) {
      throw new Error(`Project "${previous.title}" already exists with a different id.`);
    }
  }

  const nextIds = new Set(nextProjects.map((project) => project.id));
  const removed = previousProjects.filter((project) => !nextIds.has(project.id));
  if (removed.length && !options.allowProjectDeletion) {
    throw new Error('Workflow replacement would remove existing projects without explicit project deletion.');
  }
}

function normaliseProject(project) {
  if (!project || typeof project !== 'object') return project;
  ensureCurriculumState(project);
  project.phases = project.phases || (project.curriculum && project.curriculum.phases) || [];
  project.progress = calculateProgress(project);
  return project;
}

export function requireTargetProject(state, input = {}) {
  const projectId = input && input.projectId;
  if (!projectId) throw new Error('projectId is required.');
  const project = Array.isArray(state.projects) ? state.projects.find((item) => item.id === projectId) : null;
  if (!project) throw new Error('Project not found');
  return normaliseProject(project);
}

function allProjects(state) {
  return Array.isArray(state.projects) ? state.projects.map((project) => normaliseProject(project)) : [];
}

function requireUniqueProjectByPhaseId(state, phaseId) {
  const matches = allProjects(state).filter((project) => (project.curriculum?.phases || []).some((phase) => phase.id === phaseId));
  if (!matches.length) throw new Error('Phase not found');
  if (matches.length > 1) throw new Error('Phase id is ambiguous; projectId is required.');
  return matches[0];
}

function requireUniqueProjectByTopicId(state, topicId) {
  const matches = allProjects(state).filter((project) => (project.curriculum?.phases || []).some((phase) => findTopicInPhase(phase, topicId)));
  if (!matches.length) throw new Error('Topic not found');
  if (matches.length > 1) throw new Error('Topic id is ambiguous; projectId is required.');
  return matches[0];
}

function findTopicInPhase(phase, topicId) {
  if ((phase.topics || []).some((topic) => topic.id === topicId)) return true;
  return (phase.projects || []).some((project) => (project.topics || []).some((topic) => topic.id === topicId));
}

function targetProjectForPhaseWrite(state, input = {}, phaseId) {
  return input.projectId ? requireTargetProject(state, input) : requireUniqueProjectByPhaseId(state, phaseId);
}

function targetProjectForTopicWrite(state, input = {}, topicId) {
  return input.projectId ? requireTargetProject(state, input) : requireUniqueProjectByTopicId(state, topicId);
}

function syncTargetProject(state, project) {
  normaliseProject(project);
  if (state.activeProjectId === project.id) {
    state.title = project.title;
    state.subtitle = project.subtitle || state.subtitle || '';
    state.teamMembers = project.teamMembers || [];
    state.curriculum = project.curriculum;
    state.phases = project.phases;
    state.progress = project.progress;
  }
}

export default async function handler(req, res) {
  const id = requestId();
  const startedAt = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, OPTIONS');
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
      const workflow = await readState();
      if (workflow) {
        ensureCurriculumState(workflow);
        assertUniqueProjectIdentities(workflow);
        if (Array.isArray(workflow.projects)) workflow.projects.forEach((project) => normaliseProject(project));
      }
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { workflow });
    }
    if (req.method === 'PUT' && path === '/workflow') {
      const existing = await readState();
      const workflow = validateState(req.body && req.body.workflow);
      validateWorkflowReplacement(existing, workflow, { allowProjectDeletion: Boolean(req.body && req.body.allowProjectDeletion) });
      await writeState(workflow);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, workflow, persistence: 'stored' });
    }

    const state = await readState();
    if (!state) {
      console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 409, errorMessage: 'Open the dashboard once to initialise the workflow.' });
      return sendError(res, 409, 'Open the dashboard once to initialise the workflow.', id);
    }
    ensureCurriculumState(state);
    assertUniqueProjectIdentities(state);
    if (Array.isArray(state.projects)) state.projects.forEach((project) => normaliseProject(project));

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
      const project = requireTargetProject(state, req.body);
      const phase = addPhase(project, req.body);
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 201 });
      return send(res, 201, { success: true, projectId: project.id, phase, workflow: state });
    }
    const phaseMatch = path.match(/^\/phases\/([^/]+)$/);
    if (phaseMatch && req.method === 'PATCH') {
      const project = targetProjectForPhaseWrite(state, req.body || {}, phaseMatch[1]);
      const phase = updatePhase(project, phaseMatch[1], req.body || {});
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, phase, workflow: state });
    }
    if (phaseMatch && req.method === 'DELETE') {
      const project = targetProjectForPhaseWrite(state, req.body || {}, phaseMatch[1]);
      deletePhase(project, phaseMatch[1]);
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, workflow: state });
    }
    const phaseMoveMatch = path.match(/^\/phases\/([^/]+)\/move$/);
    if (phaseMoveMatch && req.method === 'POST') {
      const project = targetProjectForPhaseWrite(state, req.body || {}, phaseMoveMatch[1]);
      movePhase(project, phaseMoveMatch[1], (req.body && req.body.direction) || '');
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, workflow: state });
    }
    if (req.method === 'POST' && path === '/topics') {
      if (!req.body || !req.body.phase_id || !req.body.name || !req.body.name.trim()) {
        console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 400, errorMessage: 'phase_id and name are required.' });
        return sendError(res, 400, 'phase_id and name are required.', id);
      }
      const project = req.body.projectId ? requireTargetProject(state, req.body) : requireUniqueProjectByPhaseId(state, req.body.phase_id);
      const topic = addTopic(project, req.body);
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 201 });
      return send(res, 201, { success: true, projectId: project.id, topic, workflow: state });
    }
    const match = path.match(/^\/topics\/([^/]+)$/);
    if (req.method === 'PATCH' && match) {
      const project = targetProjectForTopicWrite(state, req.body || {}, match[1]);
      const topic = updateTopic(project, match[1], req.body || {});
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, topic, workflow: state });
    }
    if (req.method === 'DELETE' && match) {
      const project = targetProjectForTopicWrite(state, req.body || {}, match[1]);
      deleteTopic(project, match[1]);
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, workflow: state });
    }
    const topicMoveMatch = path.match(/^\/topics\/([^/]+)\/move$/);
    if (req.method === 'POST' && topicMoveMatch) {
      const project = targetProjectForTopicWrite(state, req.body || {}, topicMoveMatch[1]);
      moveTopic(project, topicMoveMatch[1], (req.body && req.body.direction) || '');
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, workflow: state });
    }
    const notesMatch = path.match(/^\/topics\/([^/]+)\/notes$/);
    if (req.method === 'PATCH' && notesMatch) {
      const project = targetProjectForTopicWrite(state, req.body || {}, notesMatch[1]);
      const topic = updateTopicNotes(project, notesMatch[1], (req.body && req.body.notes) || '');
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, topic, workflow: state });
    }
    const manualMatch = path.match(/^\/topics\/([^/]+)\/manual-override$/);
    if (req.method === 'PATCH' && manualMatch) {
      const project = targetProjectForTopicWrite(state, req.body || {}, manualMatch[1]);
      const topic = setManualOverride(project, manualMatch[1], req.body || {});
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, topic, progress: project.progress, workflow: state });
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
      const project = targetProjectForTopicWrite(state, req.body || {}, mentorMatch[1]);
      const result = await mentorReply(project, mentorMatch[1], (req.body && req.body.question) || '');
      syncTargetProject(state, project);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { success: true, projectId: project.id, ...result });
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
