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

function send(res, status, body) {
  res.status(status).json(body);
}

function authorised(req) {
  const expected = process.env.WORKFLOW_API_KEY;
  return Boolean(expected && req.headers.authorization === `Bearer ${expected}`);
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorised(req)) return send(res, 401, { error: 'Invalid or missing API key.' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { error: 'Storage is not configured.' });
  }

  try {
    const path = new URL(req.url, 'https://workflow.local').pathname.replace(/^\/api/, '') || '/workflow';

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
    if (!state) return send(res, 409, { error: 'Open the dashboard once to initialise the workflow.' });
    ensureCurriculumState(state);

    if (req.method === 'GET' && path === '/curriculum') {
      state.progress = calculateProgress(state);
      return send(res, 200, { curriculum: state.curriculum, progress: state.progress });
    }
    if (req.method === 'POST' && path === '/curriculum/import') {
      const result = importCurriculum(state, req.body || {});
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
      if (!req.body || !req.body.name || !req.body.name.trim()) return send(res, 400, { error: 'Phase name is required.' });
      const phase = addPhase(state, req.body);
      await writeState(state);
      return send(res, 201, { phase, workflow: state });
    }
    if (req.method === 'POST' && path === '/topics') {
      if (!req.body || !req.body.phase_id || !req.body.name || !req.body.name.trim()) return send(res, 400, { error: 'phase_id and name are required.' });
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
      if (!topic) return send(res, 404, { error: 'Topic not found.' });
      topic.resources.dynamic = dynamicResourcesFor(topic);
      await writeState(state);
      return send(res, 200, { resources: topic.resources, topic });
    }
    const mentorMatch = path.match(/^\/topics\/([^/]+)\/mentor$/);
    if (req.method === 'POST' && mentorMatch) {
      const result = mentorReply(state, mentorMatch[1], (req.body && req.body.question) || '');
      await writeState(state);
      return send(res, 200, result);
    }
    const auditMatch = path.match(/^\/topics\/([^/]+)\/audit$/);
    if (req.method === 'POST' && auditMatch) {
      const result = await auditTopic(state, auditMatch[1], req.body || {});
      await writeState(state);
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'Endpoint not found.' });
  } catch (error) {
    const status = /not found|required|must|contain|repository/i.test(error.message) ? 400 : 500;
    return send(res, status, { error: error.message });
  }
}
