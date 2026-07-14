# AI Development Notes

Mountain Scope now treats AI as a set of responsibilities around a stored curriculum:

- mentor
- learning assistant
- resource recommender

The curriculum remains the source of truth. AI should never invent objectives or completion criteria.

## Current Implementation

The repository uses `lib/ai.js` to call the OpenAI Responses API with structured outputs. Resource discovery uses the hosted web search tool. PDF roadmap generation and repository verification have been removed to reduce token usage.

The dashboard and API support:

- topic mentoring from stored curriculum, criteria, and notes
- dynamic resource discovery
- transparent manual overrides
- calculated progress intelligence

## GPT Integration

`gpt-instructions.md` tells ChatGPT to read stored curriculum before advising and to use narrow actions.

## Future AI Work

Future implementations can add vector retrieval without changing the core dashboard contract.
