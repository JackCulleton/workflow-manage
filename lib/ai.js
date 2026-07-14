const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.2';

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
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

export async function mentorWithAI(state, topicId, question) {
  const topic = findTopic(state, topicId);
  if (!topic) throw new Error('Topic not found.');
  return openAIJson({
    instructions: [
      'You are a dedicated AI mentor for this exact curriculum topic.',
      'The user should never have to explain context. Use the supplied curriculum, topic, criteria, and notes.',
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
          notes: topic.notes || ''
        })
      }]
    }],
    schemaName: 'mentor_reply',
    schema: mentorSchema()
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
    manualOverride: topic.manualOverride || null
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
