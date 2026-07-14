const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.2';

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function parseCurriculumWithAI(input = {}) {
  const content = [
    {
      type: 'input_text',
      text: [
        'Extract the official curriculum into structured JSON.',
        'The uploaded curriculum is the source of truth. Do not invent objectives, deliverables, criteria, resources, keywords, or glossary terms.',
        'If a field is not present, return an empty array or empty string.',
        input.text ? `Curriculum text:\n${input.text}` : 'Use the attached curriculum file as the source.'
      ].join('\n\n')
    }
  ];
  const fileItem = fileInput(input);
  if (fileItem) content.push(fileItem);

  const parsed = await openAIJson({
    instructions: 'You are an expert curriculum analyst. Return only curriculum facts supported by the provided document.',
    input: [{ role: 'user', content }],
    schemaName: 'curriculum',
    schema: curriculumSchema()
  });
  parsed.id = uid();
  parsed.source = {
    name: input.sourceName || input.fileName || parsed.sourceName || 'AI parsed curriculum',
    type: input.mimeType || input.sourceType || (fileItem ? 'file' : 'text'),
    importedAt: new Date().toISOString(),
    versionHash: hashText([input.text || '', input.fileName || '', input.fileData || ''].join(':'))
  };
  parsed.versionHistory = [];
  parsed.phases = (parsed.phases || []).map(enrichPhase);
  parsed.glossary = parsed.glossary || [];
  parsed.resources = parsed.resources || [];
  return parsed;
}

export async function discoverResourcesWithAI(topic, curriculum) {
  return openAIJson({
    instructions: [
      'You are a learning resource researcher.',
      'Use web search to find relevant official documentation and high-quality community resources.',
      'Prefer official docs, standards, manual pages, course material, reputable tutorials, GitHub examples, Stack Overflow, and community discussions.',
      'Return only resources that are relevant to the selected topic and completion criteria.'
    ].join('\n'),
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({
          curriculumTitle: curriculum && curriculum.title,
          topic: compactTopic(topic),
          criteria: criteriaFor(topic)
        })
      }]
    }],
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    schemaName: 'resources',
    schema: resourcesSchema()
  });
}

export async function mentorWithAI(state, topicId, question, repositoryContext) {
  const topic = findTopic(state, topicId);
  if (!topic) throw new Error('Topic not found.');
  return openAIJson({
    instructions: [
      'You are a dedicated AI mentor for this exact curriculum topic.',
      'The user should never have to explain context. Use the supplied curriculum, topic, criteria, previous audits, notes, and repository context.',
      'Do not invent curriculum requirements. If something is unknown, say what is missing and how to verify it.',
      'Give clear, practical guidance for a learner implementing the project.'
    ].join('\n'),
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({
          question,
          curriculum: compactCurriculum(state.curriculum),
          topic: compactTopic(topic),
          completionCriteria: criteriaFor(topic),
          previousAudits: topic.audits || [],
          currentAudit: topic.audit || null,
          repository: state.repository || null,
          repositoryContext: repositoryContext || null,
          notes: topic.notes || ''
        })
      }]
    }],
    schemaName: 'mentor_reply',
    schema: mentorSchema()
  });
}

export async function auditRepositoryWithAI(state, topicId, repositoryContext) {
  const topic = findTopic(state, topicId);
  if (!topic) throw new Error('Topic not found.');
  return openAIJson({
    instructions: [
      'You are an evidence-first repository auditor.',
      'Compare the actual source code context against the stored curriculum completion criteria.',
      'Every completion decision must include evidence from file paths, snippets, README text, or repository metadata.',
      'Never guess. If evidence is absent, mark the criterion unmet.',
      'Do not treat manual overrides as AI verification.'
    ].join('\n'),
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({
          curriculum: compactCurriculum(state.curriculum),
          topic: compactTopic(topic),
          completionCriteria: criteriaFor(topic),
          previousAudits: topic.audits || [],
          repository: state.repository || null,
          repositoryContext
        })
      }]
    }],
    schemaName: 'repository_audit',
    schema: auditSchema()
  });
}

export async function auditRoadmapWithAI(state, repositoryContext, topicIds = []) {
  const requested = new Set(topicIds);
  const topics = getAllTopicsFromState(state).filter((topic) => !requested.size || requested.has(topic.id));
  return openAIJson({
    instructions: [
      'You are an evidence-first repository auditor.',
      'Compare the actual source code context against every supplied curriculum topic and its completion criteria.',
      'Return one audit for each supplied topic id.',
      'Every completion decision must include evidence from file paths, snippets, README text, or repository metadata.',
      'Never guess. If evidence is absent, mark the criterion unmet.',
      'Do not treat manual overrides as AI verification.'
    ].join('\n'),
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({
          curriculum: compactCurriculum(state.curriculum),
          topics: topics.map((topic) => ({
            ...compactTopic(topic),
            completionCriteria: criteriaFor(topic)
          })),
          repository: state.repository || null,
          repositoryContext
        })
      }]
    }],
    schemaName: 'roadmap_repository_audit',
    schema: roadmapAuditSchema()
  });
}

async function openAIJson({ instructions, input, schemaName, schema, tools, tool_choice }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for AI-assisted functionality.');
  }
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      instructions,
      input,
      tools,
      tool_choice,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });
  const responseText = await response.text();
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error(`OpenAI returned invalid JSON (${response.status}).`);
  }
  if (!response.ok) {
    const detail = body && body.error && (body.error.message || body.error.code);
    throw new Error(`OpenAI request failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const text = extractOutputText(body);
  if (!text) throw new Error('OpenAI response did not include structured output text.');
  try {
    return JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error('OpenAI response did not include valid structured JSON.');
  }
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return '';
}

function fileInput(input) {
  if (!input.fileData) return null;
  return {
    type: 'input_file',
    filename: input.fileName || 'curriculum.pdf',
    file_data: input.fileData
  };
}

function stripJsonFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

export function compactCurriculum(curriculum) {
  return {
    title: curriculum && curriculum.title,
    phases: ((curriculum && curriculum.phases) || []).map((phase) => ({
      name: phase.name,
      topics: getPhaseTopics(phase).map((topic) => ({
        id: topic.id,
        name: topic.name,
        status: topic.status,
        completion: topic.completion,
        objectives: topic.objectives || [],
        deliverables: topic.deliverables || [],
        successCriteria: topic.successCriteria || []
      }))
    }))
  };
}

export function compactTopic(topic) {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description || '',
    objectives: topic.objectives || [],
    deliverables: topic.deliverables || [],
    successCriteria: topic.successCriteria || [],
    keywords: topic.keywords || [],
    glossary: topic.glossary || [],
    status: topic.status,
    completion: topic.completion,
    audit: topic.audit || null,
    manualOverride: topic.manualOverride || null
  };
}

function curriculumSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'sourceName', 'phases', 'glossary', 'resources'],
    properties: {
      title: { type: 'string' },
      sourceName: { type: 'string' },
      phases: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'projects', 'topics'],
          properties: {
            name: { type: 'string' },
            projects: {
              type: 'array',
              items: projectSchema()
            },
            topics: {
              type: 'array',
              items: topicSchema()
            }
          }
        }
      },
      glossary: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['term', 'definition'],
          properties: {
            term: { type: 'string' },
            definition: { type: 'string' }
          }
        }
      },
      resources: {
        type: 'array',
        items: resourceSchema()
      }
    }
  };
}

function projectSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'topics'],
    properties: {
      name: { type: 'string' },
      topics: {
        type: 'array',
        items: topicSchema()
      }
    }
  };
}

function topicSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'description', 'objectives', 'deliverables', 'successCriteria', 'keywords', 'glossary', 'resources'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      objectives: { type: 'array', items: { type: 'string' } },
      deliverables: { type: 'array', items: { type: 'string' } },
      successCriteria: { type: 'array', items: { type: 'string' } },
      keywords: { type: 'array', items: { type: 'string' } },
      glossary: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['term', 'definition'],
          properties: {
            term: { type: 'string' },
            definition: { type: 'string' }
          }
        }
      },
      resources: {
        type: 'array',
        items: resourceSchema()
      }
    }
  };
}

function resourcesSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['resources'],
    properties: {
      resources: {
        type: 'array',
        items: resourceSchema()
      }
    }
  };
}

function resourceSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'url', 'type', 'reason'],
    properties: {
      title: { type: 'string' },
      url: { type: 'string' },
      type: { type: 'string' },
      reason: { type: 'string' }
    }
  };
}

function mentorSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'recommendedActions', 'missingContext'],
    properties: {
      reply: { type: 'string' },
      recommendedActions: { type: 'array', items: { type: 'string' } },
      missingContext: { type: 'array', items: { type: 'string' } }
    }
  };
}

function auditSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'completion', 'confidence', 'evidence', 'recommendedNextSteps', 'summary'],
    properties: {
      status: { type: 'string', enum: ['complete', 'partial', 'not_verified', 'missing'] },
      completion: { type: 'number' },
      confidence: { type: 'number' },
      summary: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'met', 'detail', 'files'],
          properties: {
            criterion: { type: 'string' },
            met: { type: 'boolean' },
            detail: { type: 'string' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'snippet'],
                properties: {
                  path: { type: 'string' },
                  snippet: { type: 'string' }
                }
              }
            }
          }
        }
      },
      recommendedNextSteps: { type: 'array', items: { type: 'string' } }
    }
  };
}

function roadmapAuditSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['audits'],
    properties: {
      audits: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['topicId', 'status', 'completion', 'confidence', 'evidence', 'recommendedNextSteps', 'summary'],
          properties: {
            topicId: { type: 'string' },
            ...auditSchema().properties
          }
        }
      }
    }
  };
}

function enrichPhase(phase) {
  return {
    id: uid(),
    name: phase.name,
    projects: (phase.projects || []).map((project) => ({
      id: uid(),
      name: project.name,
      topics: (project.topics || []).map(enrichTopic)
    })),
    topics: (phase.topics || []).map(enrichTopic)
  };
}

function enrichTopic(topic) {
  return {
    id: uid(),
    name: topic.name,
    description: topic.description || '',
    objectives: topic.objectives || [],
    deliverables: topic.deliverables || [],
    successCriteria: topic.successCriteria || [],
    keywords: topic.keywords || [],
    glossary: topic.glossary || [],
    resources: { static: topic.resources || [], dynamic: [] },
    status: 'not_verified',
    completion: 0,
    confidence: 0,
    audit: null,
    audits: [],
    notes: '',
    chatHistory: [],
    manualOverride: null
  };
}

function findTopic(state, topicId) {
  return getAllTopicsFromState(state).find((topic) => topic.id === topicId) || null;
}

function getAllTopicsFromState(state) {
  return ((state.curriculum && state.curriculum.phases) || []).flatMap((phase) => getPhaseTopics(phase));
}

function getPhaseTopics(phase) {
  return [...(phase.topics || []), ...(phase.projects || []).flatMap((project) => project.topics || [])];
}

function criteriaFor(topic) {
  const criteria = [
    ...(topic.successCriteria || []),
    ...(topic.deliverables || []),
    ...(topic.objectives || [])
  ].filter(Boolean);
  return criteria.length ? criteria : [topic.name];
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
