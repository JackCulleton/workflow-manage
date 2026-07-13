# AI Development Notes

Mountain Scope now treats AI as a set of responsibilities around a stored curriculum:

- curriculum parser
- repository auditor
- mentor
- learning assistant
- progress evaluator
- resource recommender

The curriculum remains the source of truth. AI or deterministic helpers should never invent objectives or completion criteria.

## Current Implementation

The repository currently uses deterministic helpers in `lib/curriculum.js` and a Custom GPT Action schema in `openapi.yaml`.

The dashboard and API support:

- structured curriculum import
- topic mentoring from stored context
- resource generation
- evidence-first repository audits
- transparent manual overrides
- calculated progress intelligence

## GPT Integration

`gpt-instructions.md` tells ChatGPT to read stored curriculum before advising, to use narrow actions, and to separate manual completion from AI-verified completion.

## Future AI Work

Future implementations can replace or extend deterministic helpers with hosted AI providers for robust PDF parsing, semantic code analysis, and richer mentoring. The data model and API are designed so those capabilities can be added without changing the core dashboard contract.
