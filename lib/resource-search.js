import { discoverResourcesWithAI } from './ai.js';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function resourceCacheFor(topicItem) {
  if (!topicItem.resources) topicItem.resources = { static: [], dynamic: [] };
  if (!Array.isArray(topicItem.resources.static)) topicItem.resources.static = [];
  if (!Array.isArray(topicItem.resources.dynamic)) topicItem.resources.dynamic = [];
  return topicItem.resources;
}

export function projectContextFor(topicItem, curriculum) {
  const phase = ((curriculum && curriculum.phases) || []).find((phaseItem) => {
    const phaseTopics = [
      ...(phaseItem.topics || []),
      ...(phaseItem.projects || []).flatMap((project) => project.topics || [])
    ];
    return phaseTopics.some((item) => item.id === topicItem.id);
  });
  const project = (phase && (phase.projects || []).find((projectItem) => {
    return (projectItem.topics || []).some((item) => item.id === topicItem.id);
  })) || null;
  return {
    curriculumTitle: (curriculum && curriculum.title) || '',
    phaseName: (phase && phase.name) || '',
    projectName: (project && project.name) || (curriculum && curriculum.title) || '',
    topicName: topicItem.name,
    searchContext: [curriculum && curriculum.title, project && project.name, phase && phase.name, topicItem.name]
      .filter(Boolean)
      .join(' ')
  };
}

export async function findTopicResources(topicItem, curriculum, { refresh = false } = {}) {
  const cache = resourceCacheFor(topicItem);
  if (!refresh && cache.dynamic.length) {
    return { resources: cache, searched: false };
  }

  const context = projectContextFor(topicItem, curriculum);
  const result = await discoverResourcesWithAI(topicItem, curriculum, context);
  cache.dynamic = (result.resources || []).slice(0, 3).map((resource) => ({
    id: uid(),
    title: resource.title || resource.url || 'Resource',
    source: resource.source || resource.type || 'Resource',
    description: resource.description || resource.reason || '',
    url: resource.url || '#',
    type: resource.type || resource.source || 'resource',
    reason: resource.reason || resource.description || ''
  }));
  return { resources: cache, searched: true };
}

export const ResourceCache = { forTopic: resourceCacheFor };
export const AISearchProvider = { search: discoverResourcesWithAI };
export const ResourceSearchService = { findTopicResources, projectContextFor };
