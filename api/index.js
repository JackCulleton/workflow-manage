import { addPhase, addTopic, updateTopic, validateState } from '../lib/workflow.js';
import {
  auditTopic,
  auditRepository,
  calculateProgress,
  dynamicResourcesFor,
  ensureCurriculumState,
  findCurriculumTopic,
  importCurriculum,
  mentorReply,
  setManualOverride,
  updateTopicNotes
} from '../lib/curriculum.js';

const WORKFLOW_ID = 'main';
const MAX_IMPORT_TEXT_CHARS = 300000;
const MAX_IMPORT_FILE_DATA_CHARS = 4 * 1024 * 1024;
const PDF_DATA_URL_PATTERN = /^data:application\/pdf(?:;[^,]*)?;base64,/i;

export const config = {
  maxDuration: 60,
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
  if (/not found|required|must|contain|repository|malformed|uploaded|valid application\/pdf|only pdf/i.test(message)) return 400;
  return 500;
}

export function messageForApiError(error, path) {
  const message = String((error && error.message) || 'Failed to build roadmap');
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

function describeImportPayload(input = {}) {
  const fileData = input.fileData ? String(input.fileData) : '';
  const text = input.text ? String(input.text) : '';
  return {
    title: input.title || '',
    fileName: input.fileName || '',
    mimeType: input.mimeType || '',
    hasFileData: Boolean(fileData),
    fileDataChars: fileData.length,
    textChars: text.length,
    payloadKind: fileData ? 'base64 file data' : (text ? 'extracted or pasted text' : 'empty')
  };
}

export function validateImportPayload(input = {}) {
  const text = input.text ? String(input.text) : '';
  const fileData = input.fileData ? String(input.fileData) : '';
  const fileName = input.fileName ? String(input.fileName) : '';
  const mimeType = input.mimeType ? String(input.mimeType) : '';
  if (!text.trim() && !fileData) {
    throw new Error('Curriculum text or PDF file data is required.');
  }
  if (text.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(`Curriculum text is too large (${text.length} characters). Paste a shorter extract or split the curriculum into smaller imports.`);
  }
  if (fileData.length > MAX_IMPORT_FILE_DATA_CHARS) {
    throw new Error('Uploaded file is too large for roadmap import. Use a PDF under 3 MB, or extract the relevant curriculum text and import that instead.');
  }
  if (fileData) {
    if (fileName && !/\.pdf$/i.test(fileName)) throw new Error('Only PDF uploads are supported for file import.');
    if (mimeType && mimeType !== 'application/pdf') throw new Error('Uploaded file must be a PDF.');
    if (!PDF_DATA_URL_PATTERN.test(fileData)) throw new Error('Uploaded PDF data must be a valid application/pdf base64 data URL.');
    const base64 = fileData.replace(PDF_DATA_URL_PATTERN, '');
    if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('Uploaded PDF data is malformed.');
  }
  return input;
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
    if (req.method === 'POST' && path === '/curriculum/import') {
      const payload = validateImportPayload(req.body || {});
      console.info('Curriculum import request', {
        requestId: id,
        method: req.method,
        path,
        contentLength: contentLength(req),
        ...describeImportPayload(payload)
      });
      const result = await importCurriculum(state, payload);
      if (result.needsConfirmation) {
        console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 409 });
        return send(res, 409, result);
      }
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 201 });
      return send(res, 201, result);
    }
    if (req.method === 'GET' && path === '/progress') {
      state.progress = calculateProgress(state);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { progress: state.progress });
    }
    if (req.method === 'POST' && path === '/repository/audit') {
      const result = await auditRepository(state, req.body || {});
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, result);
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
      topic.resources.dynamic = await dynamicResourcesFor(topic, state.curriculum);
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, { resources: topic.resources, topic });
    }
    const mentorMatch = path.match(/^\/topics\/([^/]+)\/mentor$/);
    if (req.method === 'POST' && mentorMatch) {
      const result = await mentorReply(state, mentorMatch[1], (req.body && req.body.question) || '');
      await writeState(state);
      console.info('API request completed', { ...routeLogBase(req, path, id, startedAt), status: 200 });
      return send(res, 200, result);
    }
    const auditMatch = path.match(/^\/topics\/([^/]+)\/audit$/);
    if (req.method === 'POST' && auditMatch) {
      const result = await auditTopic(state, auditMatch[1], req.body || {});
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
