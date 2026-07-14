import { addPhase, addTopic, updateTopic, validateState } from '../lib/workflow.js';
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
  if (/not found|required|must|contain/i.test(message)) return 400;
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
      if (workflow) ensureCurriculumState(workflow);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { workflow });
    }
    if (req.method === 'PUT' && path === '/workflow') {
      const workflow = validateState(req.body && req.body.workflow);
      await writeState(workflow);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { workflow });
    }

    const state = await readState();
    if (!state) {
      console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 409, errorMessage: 'Open the dashboard once to initialise the workflow.' });
      return sendError(res, 409, 'Open the dashboard once to initialise the workflow.', id);
    }
    ensureCurriculumState(state);

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
      return send(res, 201, { phase, workflow: state });
    }
    if (req.method === 'POST' && path === '/topics') {
      if (!req.body || !req.body.phase_id || !req.body.name || !req.body.name.trim()) {
        console.warn('API request rejected', { ...routeLogBase(req, path, id, startedAt), status: 400, errorMessage: 'phase_id and name are required.' });
        return sendError(res, 400, 'phase_id and name are required.', id);
      }
      const topic = addTopic(state, req.body);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 201 });
      return send(res, 201, { topic, workflow: state });
    }
    const match = path.match(/^\/topics\/([^/]+)$/);
    if (req.method === 'PATCH' && match) {
      const topic = updateTopic(state, match[1], req.body || {});
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { topic, workflow: state });
    }
    const notesMatch = path.match(/^\/topics\/([^/]+)\/notes$/);
    if (req.method === 'PATCH' && notesMatch) {
      const topic = updateTopicNotes(state, notesMatch[1], (req.body && req.body.notes) || '');
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { topic, workflow: state });
    }
    const manualMatch = path.match(/^\/topics\/([^/]+)\/manual-override$/);
    if (req.method === 'PATCH' && manualMatch) {
      const topic = setManualOverride(state, manualMatch[1], req.body || {});
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { topic, progress: state.progress, workflow: state });
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
      return send(res, 200, result);
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
