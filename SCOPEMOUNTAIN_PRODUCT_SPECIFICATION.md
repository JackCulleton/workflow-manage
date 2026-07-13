# Mountain Scope Product Specification

`v2_update.md` is the primary specification for the active product.

## Product Vision

Mountain Scope is a curriculum-driven learning operating system. It imports structured curriculum material, stores it as the source of truth, opens a workspace for each topic, recommends resources, provides topic mentoring, verifies implementation against GitHub evidence, and calculates progress from topic completion.

## Source of Truth

The curriculum is authoritative. AI and deterministic helpers may parse, mentor, recommend, and audit, but they must not invent objectives or completion criteria.

## Implemented Product Scope

- Curriculum import from pasted text and best-effort file reading.
- Structured curriculum JSON with phases, projects, topics, objectives, deliverables, success criteria, keywords, glossary, resources, and version history.
- Dashboard roadmap with overall and phase-level progress.
- Topic states: `complete`, `partial`, `not_verified`, `missing`.
- Topic workspace: Overview, Resources, AI Chat, Verify, Notes.
- Static resources from import plus dynamic resource links.
- Personal notes that do not modify the official curriculum.
- Evidence-first repository audit for public GitHub repositories.
- Manual override recorded separately from audit verification.
- Progress intelligence: strongest topics, needs improvement, recommended next topic, estimated remaining work.
- Custom GPT Action schema and behaviour instructions.

## Architecture

```mermaid
flowchart TD
  Curriculum[Curriculum Text or PDF]
  Builder[Curriculum Builder]
  Storage[Supabase JSON Storage]
  Dashboard[Dashboard]
  Resources[Resource Engine]
  Topic[Topic Workspace]
  Chat[AI Mentor Interface]
  Audit[Repository Audit]
  Progress[Progress Engine]

  Curriculum --> Builder
  Builder --> Storage
  Storage --> Dashboard
  Dashboard --> Topic
  Topic --> Resources
  Topic --> Chat
  Topic --> Audit
  Audit --> Progress
  Progress --> Storage
```

## API Surface

- `GET /api/workflow`
- `PUT /api/workflow`
- `GET /api/curriculum`
- `POST /api/curriculum/import`
- `GET /api/progress`
- `POST /api/phases`
- `POST /api/topics`
- `PATCH /api/topics/{topicId}`
- `GET /api/topics/{topicId}/resources`
- `POST /api/topics/{topicId}/mentor`
- `POST /api/topics/{topicId}/audit`
- `PATCH /api/topics/{topicId}/notes`
- `PATCH /api/topics/{topicId}/manual-override`

## Current Technical Limits

- No hosted AI provider is configured in this repository.
- Browser PDF handling is best-effort text reading, not robust PDF parsing or OCR.
- GitHub audits inspect public repository metadata, README text, and file paths.
- Deep code understanding remains future work.
