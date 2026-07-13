# Mountain Scope

Mountain Scope is an AI-ready curriculum engine that turns structured curriculum material into an interactive learning roadmap.

The curriculum is the source of truth. The dashboard stores phases, projects, topics, learning objectives, deliverables, success criteria, resources, notes, audits, and progress. Topic completion is calculated from topic-level completion data and manual overrides, not estimated from a vague overall feeling.

## Current Implementation

This repository implements the Version 2 curriculum workflow described in `v2_update.md` using the existing Vercel/Supabase architecture.

Implemented now:

- AI Curriculum Builder for pasted curriculum text or uploaded PDFs.
- Structured curriculum storage in the existing Supabase-backed workflow JSON.
- Dashboard with overall completion, phase completion, progress intelligence, and selectable topics.
- Topic workspace tabs: Overview, Resources, AI Chat, Verify, and Notes.
- Four topic states: `complete`, `partial`, `not_verified`, and `missing`.
- Manual completion override that remains separate from audit verification.
- Dynamic resource discovery through AI web search.
- Topic mentor responses generated from selected curriculum, topic criteria, previous audit data, notes, and repository context.
- Evidence-first repository audit endpoint that sends actual source files, README content, and repository metadata to the LLM for comparison against stored criteria.
- OpenAPI schema for Custom GPT Actions.
- GPT instructions that require ChatGPT to read stored curriculum before advising.

## AI Requirements

Set these server-side environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`, optional, defaults to `gpt-5.2`
- `GITHUB_TOKEN`, optional, improves GitHub API rate limits and allows authenticated repository reads where the token has access

Without `OPENAI_API_KEY`, curriculum import, resource discovery, AI chat, and repository verification return an error.

## Architecture

```mermaid
flowchart TD
  PDF[Curriculum Text or PDF Upload]
  Builder[Curriculum Builder]
  DB[Supabase workflow_state JSON]
  Dashboard[Dashboard]
  Workspace[Topic Workspace]
  Mentor[Topic Mentor]
  Audit[Repository Audit]
  Progress[Progress Engine]
  GPT[Custom GPT Action]
  GitHub[GitHub Repository]

  PDF --> Builder
  Builder --> DB
  DB --> Dashboard
  Dashboard --> Workspace
  Workspace --> Mentor
  Workspace --> Audit
  Audit --> GitHub
  Audit --> Progress
  Mentor --> DB
  Progress --> DB
  GPT --> DB
```

## Project Structure

- `public/index.html` contains the curriculum dashboard and topic workspace.
- `api/index.js` exposes protected workflow, curriculum, mentor, audit, notes, resources, and manual override routes.
- `lib/workflow.js` keeps workflow validation and phase/topic mutations.
- `lib/curriculum.js` contains progress, manual override, GitHub source collection, and AI orchestration helpers.
- `lib/ai.js` contains Responses API calls, structured output schemas, AI curriculum parsing, AI mentoring, AI resource discovery, and AI repository auditing.
- `openapi.yaml` defines the Custom GPT Action schema.
- `gpt-instructions.md` defines the GPT behaviour rules.
- `supabase.sql` creates the Supabase storage table.
- `tests/workflow.test.js` covers workflow and curriculum helper behaviour.
- `v2_update.md` is the primary implementation specification.

## Setup

Install dependencies:

```bash
npm install
```

Create a Supabase project, then run `supabase.sql` in the Supabase SQL editor. Copy the project URL and service-role key.

Configure these environment variables in Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`
- optional `GITHUB_TOKEN`

Deploy the project to Vercel. AI features use the server-side `OPENAI_API_KEY`; the browser does not ask users for OpenAI or workflow API keys.

## Connect ChatGPT

1. Create a Custom GPT in ChatGPT.
2. Copy `gpt-instructions.md` into the GPT instructions.
3. Enable Actions.
4. Confirm `openapi.yaml` points at the deployed Vercel API.
5. Paste the schema into the Action schema field.
6. Leave authentication disabled unless you add a separate server-side access-control layer.

## Local Verification

Run tests with Node 18 or newer:

```bash
npm test
```

Run locally through Vercel:

```bash
npm run dev
```

## Security Notes

- The Supabase table has Row Level Security enabled.
- No public Supabase policies are created by `supabase.sql`.
- The service-role key should only live in server-side environment variables.
- The OpenAI key should only live in server-side environment variables.
- The dashboard never stores or prompts for OpenAI or workflow API keys.

## Remaining Limitations

- Very large PDFs or repositories may exceed request limits and need chunking or background jobs.
- Repository verification samples source files to stay within model context limits.
- Private GitHub repository auditing requires a `GITHUB_TOKEN` with access.
- Automatic curriculum difference review is implemented at the API helper level, but the browser import flow currently confirms replacement directly.
