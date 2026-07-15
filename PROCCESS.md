# Process

## The Problem

This project started from a very real frustration.

While working on projects like Minishell and Cube3D, I kept running into the same issue: I couldn’t clearly track what was going on. There were too many moving parts, and everything felt scattered.

I struggled to keep track of:

- Phases of the project
- Topics within each phase
- Overall progress
- Who was responsible for what
- What should actually be worked on next

Most of the time, this information lived in different places: notes, conversations, or just in my head. That made it easy to lose track, repeat work, or miss important steps.

I wanted something simple but structured. A visual workflow that showed everything clearly in one place.

At the same time, I had another idea: what if I could interact with that workflow using natural language? Instead of clicking through a UI, I could just tell ChatGPT what to update, and it would handle it.

That combination, a visual dashboard plus conversational control, became the foundation of this project.

### 1. Initial Idea

I started with the core problem: tracking project structure and progress.

The goal was simple:

- Represent phases, topics, and tasks visually
- Make it easy to understand what’s happening at a glance

At this stage, it was basically a simple HTML product. There was no real backend, no persistence, and no integration with my Custom GPT yet.

### 2. First Dashboard Prototype

I built a basic dashboard using HTML, CSS, and JavaScript.

It showed:

- Phases
- Topics
- Activities

It worked visually, but everything was static.

**Problem discovered:**
Nothing was saved. Refreshing the page reset everything, and there was no backend for ChatGPT or my Custom GPT to talk to.

**Lesson:**
A visual interface is not enough without persistence or a proper API behind it.

### 3. Adding Structure

I expanded the model to include:

- Nested topics
- Activities inside topics
- Progress indicators

This made the dashboard more useful, but also more complex.

**Problem discovered:**
Managing state became messy without a proper backend.

**Lesson:**
As complexity grows, structure and data management become critical.

### 4. Redesign: Horizontal Roadmap

The interface was redesigned into a horizontal black-and-orange roadmap.

This made it easier to:

- Follow progression from left to right
- Visually separate phases
- Understand flow at a glance

**Problem discovered:**
The UI looked better, but underlying issues like persistence were still unresolved.

**Lesson:**
Design improvements don’t fix architectural problems.

### 5. Adding Vercel And Supabase

This is when I introduced Vercel and Supabase.

Vercel gave the project a hosted backend/API, and Supabase gave it a place to store the workflow data properly.

Now:

- Changes could be saved
- Data persisted across refreshes
- The dashboard had an API that a Custom GPT could eventually connect to

**Problem discovered:**
Some updates didn’t actually persist correctly, even when they appeared to work.

**Lesson:**
You need to verify persistence, not assume it.

### 6. Hosting on Vercel

The dashboard and API were deployed using Vercel.

This allowed:

- Easy hosting
- Unified frontend and backend deployment

**Problem discovered:**
Deployment exposed inconsistencies between local and production behavior.

**Lesson:**
Things that work locally don’t always work in production.

### 7. Adding Custom GPT Integration

This was a major step.

I connected a Custom GPT to the backend using OpenAPI actions so it could:

- Read the workflow
- Update phases, topics, and activities

**Problem discovered:**
The GPT sometimes claimed updates succeeded when they hadn’t.

**Lesson:**
AI responses must be validated against actual system state.

### 8. Fixing Targeting And Data Issues

Several issues appeared:

- The wrong project being updated
- Duplicate or unstable data
- API actions not supporting required operations

**Lesson:**
Clear identifiers and strict API design are essential.

This led to simplifying the system.

### 9. Simplifying To A Single Project

To reduce complexity and bugs, I moved to a single-project system.

This removed:

- Ambiguity in targeting
- Confusion in updates

**Lesson:**
Sometimes removing features improves reliability.

### 10. Adding Team Members And Assignments

I added:

- Team member tracking
- Assignment of activities
- Visual indicators for responsibility

**Problem discovered:**
Assignment actions were initially missing or incomplete.

**Lesson:**
Features need full backend support, not just UI representation.

### 11. Improving Reliability

I focused on:

- Fixing API inconsistencies
- Ensuring updates actually persist
- Making GPT actions more reliable
- Reducing schema complexity because OpenAPI limits were an issue

**Lesson:**
Stability matters more than adding new features.

### 12. Current Version

The current version includes:

- A visual workflow dashboard
- Persistent storage via Supabase
- API hosted on Vercel
- Custom GPT integration for natural-language updates
- Team assignments and structured workflow tracking

It’s not perfect, but it’s stable, usable, and solves the original problem.

## How I Used AI

AI played a big role in this project, but it wasn’t making decisions on its own.

### ChatGPT

I used ChatGPT to:

- Clarify ideas
- Challenge unclear features
- Plan development steps
- Explain technical concepts
- Troubleshoot issues
- Improve prompts
- Help document the project

I also used ChatGPT as a project partner. I went back and forth with it on my ideas, using the conversation to get clearer about what I actually wanted before asking Codex to build anything.

That helped me turn rough ideas into clearer prompts for Codex. In that sense, ChatGPT was not just answering questions. It helped me think through the project and communicate the work more clearly.

### Codex

I used Codex to:

- Inspect the repository
- Implement changes
- Refactor code
- Add API actions
- Update the OpenAPI schema
- Write and update tests
- Investigate bugs
- Validate changes

### My Role

I decided:

- What the product should do
- Which features were useful
- What to remove or simplify
- When AI misunderstood the goal
- Whether an implementation was correct

I constantly reviewed, tested, and corrected AI-generated work.

AI was used as a development and problem-solving tool, but the product direction, decisions, testing, and final judgement remained my responsibility.

## Why I Chose This Tech Stack

### HTML, CSS And JavaScript

The dashboard didn’t need a heavy framework. Using standard web technologies kept things simple and easy to control.

### Node.js

Node.js made it easy to build API routes that work naturally with the frontend.

### Vercel

Vercel allowed me to host both the dashboard and the API in one place with minimal setup.

### Supabase

Supabase provided persistent storage without needing to build and manage a database from scratch.

### OpenAPI

OpenAPI was necessary to define how the Custom GPT interacts with the backend.

### Custom GPT

This allowed me to manage the workflow using natural language instead of only using the UI.

### ChatGPT And Codex

These tools helped with planning, implementation, debugging, and documentation.

## Development Screenshots

<!-- Add screenshot of the early dashboard here -->

Early prototype showing the first version of the dashboard.

<!-- Add screenshot of the horizontal roadmap here -->

Redesign into the horizontal black-and-orange layout.

<!-- Add screenshot of GPT integration here -->

First working version of GPT reading and updating the workflow.

<!-- Add screenshot of team assignments here -->

Introduction of team members and assignment indicators.

<!-- Add screenshot of current dashboard here -->

Current version of the dashboard with full functionality.

## Tech Stack And Architecture

### Tech Stack

The tech stack is the list of tools used to build the project.

- HTML, CSS, JavaScript
- Node.js
- Vercel
- Supabase
- OpenAPI
- Custom GPT

### Architecture

The architecture describes how everything works together.

```text
User
  ↓
Dashboard or Custom GPT
  ↓
Vercel API
  ↓
Supabase
```

- The dashboard is the visual interface.
- The Custom GPT is the conversational interface.
- The API processes and validates requests.
- Supabase stores all workflow data.
- OpenAPI defines how the GPT interacts with the API.
- Both the dashboard and GPT use the same backend and data.

This setup ensures that updates from either interface stay consistent.
