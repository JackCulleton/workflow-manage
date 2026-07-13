import { addPhase, addTopic, updateTopic, validateState } from '../lib/workflow.js';
import {
  auditTopic,
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
const MAX_IMPORT_FILE_DATA_CHARS = 18 * 1024 * 1024;

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

function sendError(res, status, error) {
  return send(res, status, { success: false, error });
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

function validateImportPayload(input = {}) {
  const text = input.text ? String(input.text) : '';
  const fileData = input.fileData ? String(input.fileData) : '';
  if (!text.trim() && !fileData) {
    throw new Error('Curriculum text or PDF file data is required.');
  }
  if (text.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(`Curriculum text is too large (${text.length} characters). Paste a shorter extract or split the curriculum into smaller imports.`);
  }
  if (fileData.length > MAX_IMPORT_FILE_DATA_CHARS) {
    throw new Error('Uploaded file is too large for roadmap import. Use a PDF under about 13 MB, or extract the relevant curriculum text and import that instead.');
  }
  return input;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return sendError(res, 500, 'Storage is not configured.');
  }

  const path = new URL(req.url, 'https://workflow.local').pathname.replace(/^\/api/, '') || '/workflow';

  try {
    if (req.method === 'GET' && path === '/workflow') {
      const workflow = await readState();
      if (workflow) ensureCurriculumState(workflow);
      return send(res, 200, { workflow });
    }
    if (req.method === 'PUT' && path === '/workflow') {
      const workflow = validateState(req.body && req.body.workflow);
      await writeState(workflow);
      return send(res, 200, { workflow });
    }

    const state = await readState();
    if (!state) return sendError(res, 409, 'Open the dashboard once to initialise the workflow.');
    ensureCurriculumState(state);

    if (req.method === 'GET' && path === '/curriculum') {
      state.progress = calculateProgress(state);
      return send(res, 200, { curriculum: state.curriculum, progress: state.progress });
    }
    if (req.method === 'POST' && path === '/curriculum/import') {
      const payload = validateImportPayload(req.body || {});
      console.info('Curriculum import request', {
        method: req.method,
        path,
        contentLength: contentLength(req),
        ...describeImportPayload(payload)
      });
      const result = await importCurriculum(state, payload);
      if (result.needsConfirmation) return send(res, 409, result);
      await writeState(state);
      return send(res, 201, result);
    }
    if (req.method === 'GET' && path === '/progress') {
      state.progress = calculateProgress(state);
      await writeState(state);
      return send(res, 200, { progress: state.progress });
    }

    if (req.method === 'POST' && path === '/phases') {
      if (!req.body || !req.body.name || !req.body.name.trim()) return sendError(res, 400, 'Phase name is required.');
      const phase = addPhase(state, req.body);
      await writeState(state);
      return send(res, 201, { phase, workflow: state });
    }
    if (req.method === 'POST' && path === '/topics') {
      if (!req.body || !req.body.phase_id || !req.body.name || !req.body.name.trim()) return sendError(res, 400, 'phase_id and name are required.');
      const topic = addTopic(state, req.body);
      await writeState(state);
      return send(res, 201, { topic, workflow: state });
    }
    const match = path.match(/^\/topics\/([^/]+)$/);
    if (req.method === 'PATCH' && match) {
      const topic = updateTopic(state, match[1], req.body || {});
      await writeState(state);
      return send(res, 200, { topic, workflow: state });
    }
    const notesMatch = path.match(/^\/topics\/([^/]+)\/notes$/);
    if (req.method === 'PATCH' && notesMatch) {
      const topic = updateTopicNotes(state, notesMatch[1], (req.body && req.body.notes) || '');
      await writeState(state);
      return send(res, 200, { topic, workflow: state });
    }
    const manualMatch = path.match(/^\/topics\/([^/]+)\/manual-override$/);
    if (req.method === 'PATCH' && manualMatch) {
      const topic = setManualOverride(state, manualMatch[1], req.body || {});
      await writeState(state);
      return send(res, 200, { topic, progress: state.progress, workflow: state });
    }
    const resourcesMatch = path.match(/^\/topics\/([^/]+)\/resources$/);
    if (req.method === 'GET' && resourcesMatch) {
      const topic = findCurriculumTopic(state, resourcesMatch[1]);
      if (!topic) return sendError(res, 404, 'Topic not found.');
      topic.resources.dynamic = await dynamicResourcesFor(topic, state.curriculum);
      await writeState(state);
      return send(res, 200, { resources: topic.resources, topic });
    }
    const mentorMatch = path.match(/^\/topics\/([^/]+)\/mentor$/);
    if (req.method === 'POST' && mentorMatch) {
      const result = await mentorReply(state, mentorMatch[1], (req.body && req.body.question) || '');
      await writeState(state);
      return send(res, 200, result);
    }
    const auditMatch = path.match(/^\/topics\/([^/]+)\/audit$/);
    if (req.method === 'POST' && auditMatch) {
      const result = await auditTopic(state, auditMatch[1], req.body || {});
      await writeState(state);
      return send(res, 200, result);
    }
    return sendError(res, 404, 'Endpoint not found.');
  } catch (error) {
    const status = /too large/i.test(error.message)
      ? 413
      : (/not found|required|must|contain|repository/i.test(error.message) ? 400 : 500);
    console.error('API request failed', {
      method: req.method,
      path,
      status,
      contentLength: contentLength(req),
      error: error && error.stack ? error.stack : String(error)
    });
    return sendError(res, status, error.message || 'Failed to build roadmap');
  }
}
