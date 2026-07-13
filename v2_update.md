# Mountain Scope – AI Curriculum Engine Specification

## Vision

Mountain Scope should become an AI-powered learning operating system capable of transforming any structured curriculum into an interactive learning roadmap.

Rather than acting as a simple checklist application, Mountain Scope should:

* Parse official curriculum documents.
* Build structured learning roadmaps.
* Track implementation progress.
* Audit GitHub repositories.
* Recommend learning resources.
* Provide contextual AI mentoring.
* Calculate overall completion automatically.

The goal is to eliminate manual progress tracking while giving learners an intelligent mentor for every topic.

---

# Core Philosophy

The curriculum document (PDF) is the **source of truth**.

The AI should never invent learning objectives or completion criteria.

Instead, it should extract them from the official curriculum and store them for future verification.

Every repository audit must compare the implementation against the stored curriculum.

---

# High-Level Workflow

```text
Curriculum PDF
        │
        ▼
AI Curriculum Builder
        │
        ▼
Structured Curriculum
(Database)
        │
        ▼
Dashboard
        │
        ▼
User selects Topic
        │
        ▼
AI Mentor + Resources
        │
        ▼
Repository Audit
        │
        ▼
Progress Updated
```

---

# Phase 1 – Curriculum Builder

## Input

The user uploads an official curriculum PDF.

Examples:

* 42 School
* University modules
* CS50
* Odin Project
* Internal company training
* Certification guides

---

## AI Responsibilities

The AI should extract:

* Phases
* Projects
* Topics
* Learning objectives
* Deliverables
* Success criteria
* Keywords
* Glossary
* Recommended official resources

The AI should convert the curriculum into structured JSON.

---

## Stored Curriculum

The generated curriculum should be permanently stored.

Future audits should use the stored curriculum rather than repeatedly parsing the PDF.

If the user uploads a newer curriculum version:

* Detect differences.
* Ask whether the stored curriculum should be updated.
* Never overwrite automatically.

---

# Phase 2 – Dashboard

The dashboard displays:

* Overall completion
* Phases
* Projects
* Topics

Each topic has one of four states.

## Topic States

🟢 Complete

The AI has verified the implementation.

---

🟡 Partial

Some completion criteria are met.

---

🔵 Not Verified

The topic has not yet been audited.

---

🔴 Missing

No implementation evidence was found.

---

Users may work on topics in any order.

Mountain Scope should recommend a logical learning path but must never lock topics behind previous ones.

---

# Overall Completion

Mountain Scope calculates an overall completion percentage.

Example:

```text
Overall Progress

74%

Parsing                 100%

Signals                  72%

Pipes                    91%

Algorithms              100%

Memory Management        82%
```

This percentage should be derived from topic completion, not estimated by the AI.

---

# Phase 3 – Topic Workspace

Selecting a topic opens a dedicated workspace.

```text
--------------------------------------------------
Topic
--------------------------------------------------

Overview

Resources

AI Chat

Verify

Notes
```

---

# Overview Tab

Display:

* Topic description
* Learning objectives
* Completion checklist
* Current progress
* Confidence score

---

# Resources Tab

Use a hybrid model.

## Static Resources

Stored when the curriculum is created.

Examples:

* Official documentation
* Curriculum links
* PDF references

---

## Dynamic Resources

Generated when the topic is opened.

Examples:

* GitHub repositories
* YouTube videos
* Blog posts
* Reddit discussions
* Stack Overflow
* Articles

Resources should be ranked by relevance.

---

# AI Chat

Every topic has its own dedicated AI assistant.

The AI automatically receives:

* Curriculum
* Project
* Topic
* Learning objectives
* Completion criteria
* Previous audits
* Current GitHub repository

The user should never need to explain context.

Example questions:

* Explain this topic.
* Why am I only 65% complete?
* Show me what is missing.
* Find bugs.
* Recommend architecture.
* Explain this concept.
* Suggest improvements.

---

# Verify Tab

The Verify tab performs an AI audit.

Input:

* Stored curriculum
* Selected topic
* GitHub repository

The AI should inspect the repository and compare it against the completion criteria.

The AI must never guess.

Every decision must be supported with evidence.

Example:

Status

Partial

Completion

72%

Confidence

95%

Evidence

✓ Parsing implemented

✓ Signal handlers exist

✗ Parent process cleanup

✗ Ctrl-\ handling

---

Recommended Next Steps

* Finish parent process cleanup
* Handle Ctrl-\
* Re-run verification

---

# Notes Tab

Users can maintain personal notes.

These notes should never modify the official curriculum.

---

# Repository Auditing

The user provides a GitHub repository.

The AI should:

* Inspect the repository.
* Detect the relevant project.
* Compare implementation against the stored curriculum.
* Verify completion criteria.
* Produce evidence.
* Update progress.

The AI should always explain its reasoning.

---

# Evidence First

Every audit must include evidence.

Example:

Signals

Status

Partial

Evidence

✓ SIGINT found

✓ SIGQUIT found

✗ Ctrl-D missing

✗ Parent signal handling missing

Confidence

94%

---

# Manual Override

Users may manually override completion.

The UI must clearly distinguish between:

✓ Verified by AI

and

✓ Manually Completed

AI verification should never be silently replaced.

---

# Progress Intelligence

Mountain Scope should generate insights.

Example:

Overall Progress

82%

Strongest Topics

* Parsing
* Algorithms
* Memory Management

Needs Improvement

* Signals
* Networking
* Concurrency

Recommended Next Topic

Signals

Estimated Remaining Work

6 hours

---

# AI Responsibilities

The AI should act as:

* Curriculum parser
* Repository auditor
* Mentor
* Learning assistant
* Progress evaluator
* Resource recommender

The AI should never become the source of truth.

The curriculum remains the authority.

---

# Future Architecture

```text
Curriculum PDF
        │
        ▼
AI Curriculum Builder
        │
        ▼
Curriculum Database
        │
        ├─────────────┐
        ▼             ▼
Dashboard      Resource Engine
        │             │
        ▼             ▼
Topic Workspace
        │
        ├───────────┐
        ▼           ▼
AI Chat      Repository Audit
        │           │
        └─────┬─────┘
              ▼
      Progress Engine
              │
              ▼
Overall Completion
```

---

# Design Principles

* The curriculum is always the source of truth.
* Every AI decision must be evidence-based.
* Repository audits should be explainable.
* Resources should combine official documentation with dynamic community content.
* Users should be free to learn in any order.
* AI should recommend rather than enforce.
* Manual overrides must remain transparent.
* Every topic should feel like having a dedicated mentor.

---

# Long-Term Vision

Mountain Scope should evolve into a universal AI-powered learning platform capable of understanding any structured curriculum.

Whether the user is learning:

* 42 School
* University courses
* Professional certifications
* Internal company training
* Open-source roadmaps

The workflow remains the same:

1. Import curriculum.
2. Generate structured roadmap.
3. Learn with AI assistance.
4. Verify implementation against the curriculum.
5. Track progress automatically.
6. Recommend the next learning steps based on evidence.

The objective is to replace static checklists with an intelligent learning system that continuously guides, evaluates, and mentors the learner throughout their journey.
