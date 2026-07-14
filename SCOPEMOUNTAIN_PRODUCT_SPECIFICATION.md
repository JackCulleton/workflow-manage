# Mountain Scope Product Specification

This file describes the current deployed product scope.

## Product Vision

Mountain Scope is a curriculum-driven learning operating system. It stores curriculum material as the source of truth, opens a workspace for each topic, recommends resources, provides topic mentoring, and calculates progress from topic completion.

## Source of Truth

The curriculum is authoritative. AI may mentor and recommend resources, but it must not invent objectives or completion criteria.

## Implemented Product Scope

- Structured curriculum JSON with phases, projects, topics, objectives, deliverables, success criteria, keywords, glossary, resources, and version history.
- Dashboard roadmap with overall and phase-level progress.
- Topic states: `complete`, `partial`, `not_verified`, `missing`.
- Topic workspace: Overview, Resources, AI Chat, Notes.
- Static resources from import plus dynamic AI web-search resource discovery.
- Personal notes that do not modify the official curriculum.
- Manual override for explicit completion.
- Progress intelligence: strongest topics, needs improvement, recommended next topic, estimated remaining work.
- Custom GPT Action schema and behaviour instructions.

## Architecture

```mermaid
flowchart TD
  Storage[Supabase JSON Storage]
  Dashboard[Dashboard]
  Resources[Resource Engine]
  Topic[Topic Workspace]
  Chat[AI Mentor Interface]
  Progress[Progress Engine]

  Storage --> Dashboard
  Dashboard --> Topic
  Topic --> Resources
  Topic --> Chat
  Topic --> Progress
  Progress --> Storage
```

## API Surface

- `GET /api/workflow`
- `PUT /api/workflow`
- `GET /api/curriculum`
- `GET /api/progress`
- `POST /api/phases`
- `POST /api/topics`
- `PATCH /api/topics/{topicId}`
- `GET /api/topics/{topicId}/resources`
- `POST /api/topics/{topicId}/mentor`
- `PATCH /api/topics/{topicId}/notes`
- `PATCH /api/topics/{topicId}/manual-override`

## Current Technical Limits

- `OPENAI_API_KEY` is required for mentoring and dynamic resource discovery.
- PDF roadmap generation and repository verification are intentionally removed to reduce token usage.
