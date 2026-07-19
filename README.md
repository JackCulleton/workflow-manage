# Mountain Scope

Mountain Scope is a workflow dashboard for planning and tracking a project roadmap. It keeps phases, topics, team members, assignments, notes, resources, and completion status in one stored workflow.

The app is intentionally simple: a browser dashboard, a small Vercel API, Supabase storage, and an OpenAPI file that lets a Custom GPT call the same API.

## Tech Stack

The tech stack is the set of tools and technologies used to build the project.

- HTML, CSS, and JavaScript build the dashboard in `public/index.html`.
- Node.js runs the backend code in `api/index.js` and `lib/`.
- Vercel hosts the dashboard and the serverless API route.
- Supabase stores the workflow data in the `workflow_state` table.
- OpenAPI describes the API actions in `openapi.yaml` and `public/openapi.yaml`.
- Custom GPT Actions let ChatGPT read and update the workflow through the API.
- npm runs project scripts like `npm run dev` and `npm test`.
- GitHub is used for source control.
- Automated tests live in `tests/` and use Node's built-in test runner.

The tech stack describes what the project is built with, while the architecture explains how those technologies work together.

## Architecture

Architecture means how the different parts of the project are organised and how they talk to each other.

```text
User
  ↓
Dashboard or Custom GPT
  ↓
Vercel API
  ↓
Supabase
```

The dashboard is the visual interface. It displays the workflow in the browser and lets a user edit phases, topics, team members, assignments, notes, and completion state.

The Custom GPT is the natural-language interface. It can read and update the same workflow through ChatGPT Actions.

Vercel hosts both the dashboard and the Node.js API. Requests to `/api/*` are routed to `api/index.js`.

The API validates requests and controls workflow changes before writing anything. Supabase stores the workflow data so it remains after refreshes and can be shared between interfaces.

The OpenAPI schema tells the Custom GPT which API actions it can call. Both the dashboard and the Custom GPT use the same API and the same Supabase storage, so a change made in one place should appear in the other.

## Dashboard Frontend

The frontend is a plain HTML/CSS/JavaScript app in `public/index.html`. There is no separate frontend framework.

It renders the roadmap, team filter, phase and topic controls, topic workspace, notes, resources, and assignment indicators. It talks to the API with `fetch`, then keeps a local backup in `localStorage` if the API is unavailable.

## Vercel API

The backend entry point is `api/index.js`. Vercel rewrites `/api/:path*` to this file using `vercel.json`.

The API supports workflow reads and writes, phase and topic edits, assignment actions, progress reads, notes, manual completion overrides, resource discovery, and topic mentor replies.

Most workflow validation and mutation logic lives in `lib/workflow.js`. Curriculum progress, notes, manual overrides, resources, and mentor helpers live in `lib/curriculum.js`, `lib/resource-search.js`, and `lib/ai.js`.

## Supabase Storage

Supabase stores one workflow record in `public.workflow_state`. The API reads and writes the `data` JSON column using the Supabase service-role key on the server.

`supabase.sql` enables Row Level Security and does not create public policies. The service-role key should stay in server-side environment variables only.

## Custom GPT And OpenAPI

The important schema files are:

- `openapi.yaml` for the Custom GPT Action schema.
- `public/openapi.yaml` for the public copy served with the dashboard.

These files should stay in sync. They describe operations such as `getWorkflow`, phase and topic updates, assignment updates, notes, resources, and manual status overrides.

`gpt-instructions.md` contains behaviour guidance for the Custom GPT. The GPT should read the latest workflow before making changes, then call the API using IDs from that response.

## Project Structure

- `public/index.html` contains the dashboard UI.
- `public/client-response.js` contains shared response parsing for browser API calls.
- `api/index.js` exposes the Vercel API route.
- `lib/workflow.js` handles workflow validation, normalization, phase/topic changes, and team assignments.
- `lib/curriculum.js` handles progress, notes, manual overrides, resources, and mentor orchestration.
- `lib/ai.js` calls the OpenAI Responses API for AI-assisted resource and mentor features.
- `lib/resource-search.js` helps find topic resources.
- `openapi.yaml` and `public/openapi.yaml` describe the GPT Actions.
- `gpt-instructions.md` contains Custom GPT instructions.
- `supabase.sql` creates the Supabase storage table.
- `tests/*.test.js` contains the Node test suite.

## Setup

Install dependencies:

```bash
npm install
```

Create a Supabase project, then run `supabase.sql` in the Supabase SQL editor.

Set these server-side environment variables in Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

AI-assisted resource discovery and mentor replies also need:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`, optional

Run locally through Vercel:

```bash
npm run dev
```

Run tests:

```bash
npm test
```
or use this url: https://workflow-manage.vercel.app/


## Connect ChatGPT

1. Create a Custom GPT in ChatGPT.
2. Copy `gpt-instructions.md` into the GPT instructions.
3. Enable Actions.
4. Confirm `openapi.yaml` points at the deployed Vercel API.
5. Paste the schema into the Action schema field.
6. Leave authentication disabled unless you add a separate access-control layer.


## reflection 

## Workflow Manager Reflection

Working on Workflow Manager gave me a much better understanding of how important it is to have complete clarification before giving prompts to AI. Compared to my earlier projects, I became much more specific about what I wanted the AI to build, how each feature should work and what should not be changed. This made the results more accurate and reduced the amount of time spent fixing misunderstandings.

I also started to use AI more like an equal project partner throughout the development process instead of only using it to generate code. I used AI to help plan features, discuss different options, solve problems, organise the workflow and improve the design of the project. Going back and forth with AI helped me think through my decisions before implementing them, rather than immediately accepting the first solution.

Another major improvement was my understanding of the project architecture. I had a clearer idea of how the frontend, backend, API endpoints, Vercel and Supabase worked together. Because I understood the role of each part, the development process was much cleaner and easier to follow. I could understand where data was being sent, how it was being validated and how the dashboard was being updated.

The purpose of Workflow Manager is to help teams clearly understand what they need to do during a project. This will be especially useful for Japan because everyone will be able to see the different phases, topics, responsibilities and overall progress of the project. It should reduce confusion and make it easier for team members to know what they are working on and what still needs to be completed.

One of the main failures was my attempt to make the AI automatically check the Git repository and use it to mark the progress of the project. I found it difficult to fine-tune the AI enough for it to accurately understand whether a task had actually been completed. It also required too many tokens because the AI needed to repeatedly inspect large amounts of code and repository information. Because of this, the feature was not efficient or reliable enough, so I decided that progress should be updated more directly by the users and the AI assistant.

This failure taught me that not every feature should use AI just because it is possible. The feature must also be accurate, useful and affordable to run. It helped me understand that AI works best when it is given clear information and a controlled task, rather than being expected to fully understand an entire project without enough context.

If I completed the project again, I would increase my knowledge of the different AI tools, integrations and development tools available before starting. This would help me choose the most efficient tools for each part of the project and avoid spending time trying to make one tool perform a task that another tool may be better suited for.

Overall, Workflow Manager showed a clear improvement in how I use AI. I became better at writing complete prompts, planning the architecture and working with AI throughout the full development process. Even though the automatic repository grading feature was unsuccessful, the project will still be very useful for Japan by helping teams stay organised, understand their responsibilities and follow the progress of their work.
