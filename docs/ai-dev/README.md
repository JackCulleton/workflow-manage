# AI Development Notes

Mountain Scope now treats AI as a set of responsibilities around a stored curriculum:

- curriculum parser
- repository auditor
- mentor
- learning assistant
- progress evaluator
- resource recommender

The curriculum remains the source of truth. AI should never invent objectives or completion criteria.

## Current Implementation

The repository uses `lib/ai.js` to call the OpenAI Responses API with structured outputs. Resource discovery uses the hosted web search tool. Repository verification sends source-code context to the model and requires evidence for every decision.

The dashboard and API support:

- AI structured curriculum import from text or PDF/file data
- topic mentoring from stored curriculum, criteria, audit, notes, and repository context
- dynamic resource discovery
- evidence-first repository audits over source files
- transparent manual overrides
- calculated progress intelligence

## GPT Integration

`gpt-instructions.md` tells ChatGPT to read stored curriculum before advising, to use narrow actions, and to separate manual completion from AI-verified completion.

## Future AI Work

Future implementations can add chunked background processing, vector retrieval, and richer private GitHub authorization without changing the core dashboard contract.
