# Workflow Manager V2 — Team Project Allocation and Progress Tracking

## Objective

Extend the existing Workflow Manager so it can organise 42 group projects without teammates duplicating work, editing the same areas accidentally, or discovering integration conflicts too late.

The product has two connected parts:

1. A Custom GPT that clarifies the project and team structure before creating the roadmap.
2. A dashboard that displays the shared roadmap, individual assignments, ownership boundaries, dependencies, and progress.

The GPT is the planning layer.

The dashboard is the execution and progress layer.

Do not replace the existing dashboard or rebuild the project from scratch. Extend the current implementation while preserving working functionality and the existing black-and-orange visual style.

---

## Core Product Principle

There must be one shared project roadmap.

Do not create completely separate roadmaps for each teammate.

The shared roadmap remains the single source of truth. Each topic can then be assigned to one person, multiple people, the whole team, or left unassigned.

The dashboard must allow the roadmap to be filtered by person without losing the overall project context.

---

## Part 1 — Custom GPT Clarification Flow

The Custom GPT must not create or update the project roadmap immediately after receiving a project name, PDF, or repository.

It must first collect enough information to create a reliable team split.

The GPT should continue asking focused clarification questions until every required planning field has an answer and no unresolved contradiction would materially affect task allocation.

The GPT should not endlessly chase perfect certainty. It may proceed when all required information is present and the ownership plan is clear enough to implement safely.

### Required clarification information

Before generating the roadmap, establish:

- Project name
- Project description
- Project deadline
- Number of teammates
- Name of each teammate
- Each teammate's current knowledge
- Each teammate's confidence level
- Each teammate's preferred areas
- Each teammate's areas they want to learn
- Each teammate's availability
- Any known responsibilities already agreed by the team
- Whether workload should be balanced equally or based on ability
- Which components can be developed independently
- Which components require shared decisions
- Which files, folders, modules, structures, or interfaces may be shared
- How integration will happen
- How the work will be tested
- Who will resolve conflicts when two people need to modify the same area

### Clarification behaviour

The GPT must:

- Ask one focused group of questions at a time.
- Identify missing information.
- Identify contradictions.
- Warn when the proposed split creates overlap or bottlenecks.
- Suggest a better split when appropriate.
- Explain why a responsibility is assigned to a person.
- Allow the user to override a recommendation.
- Record explicit manual overrides.
- Avoid creating the roadmap until the required information is resolved.
- Never mark work completed merely because it was discussed.

### Ready-to-build condition

The GPT may generate the roadmap when it can confidently state:

> The team structure, ownership boundaries, dependencies, shared interfaces, and integration plan are clear enough to begin work without material responsibility overlap.

Before writing to the dashboard, show a concise proposed allocation summary.

If the user approves or clearly asks to apply it, write the roadmap and assignments to the dashboard.

---

## Part 2 — Roadmap Structure

Keep one shared roadmap containing phases and topics.

### Phases

Phases describe the timeline or stage of the whole project.

Example:

- Clarification
- Shared architecture
- Individual implementation
- Integration
- Testing
- Final review

Phases normally belong to the whole project, not to one individual.

### Topics

Topics are the actual units of work.

Each topic must support:

- Title
- Description
- Phase
- Status
- Progress state
- One or more assignees
- Assignment type
- Assignment reason
- Ownership boundaries
- Expected output
- Dependencies
- Blocking relationships
- Shared interfaces
- Integration checkpoint
- Definition of done
- Notes
- Locked or unlocked assignment state
- Manual or GPT-generated assignment source

### Assignment types

A topic can be:

- Assigned to one person
- Assigned to multiple people
- Shared by the whole team
- Unassigned

---

## Part 3 — Ownership Contract

Every implementation topic should support a clear ownership contract.

The ownership contract should include:

- Primary owner
- Additional assignees
- Files or folders owned
- Functions or components owned
- Inputs received
- Outputs produced
- Data structures used
- Shared interfaces
- Dependencies
- Work blocked by this topic
- Files or areas the assignee should not modify
- Integration checkpoint
- Definition of done
- Test expectations

This is the main mechanism that prevents teammates from stepping on each other's work.

Do not require every field for simple planning topics. Ownership details should be strongest for implementation and integration topics.

---

## Part 4 — Dashboard Person Filter

Add a person-selection dropdown near the project title or roadmap controls.

The dropdown must include:

- Overall Project
- Every teammate
- Shared Work
- Unassigned Work

### Overall Project view

Show:

- Every phase
- Every topic
- All assignees
- Overall completion percentage
- Shared dependencies
- Blocked work
- Unassigned work

### Individual person view

When a teammate is selected, show:

- Topics assigned to that person
- Shared topics involving that person
- Dependencies blocking that person
- Topics that person is blocking
- That person's completion percentage
- Their ownership boundaries
- Their integration checkpoints

Do not duplicate the roadmap data.

The view must filter the same shared source of truth.

Dependencies from other teammates may remain visible in a reduced or contextual style so the selected person understands how their work connects to the project.

---

## Part 5 — Manual Assignment Controls

Users must be able to manually assign or reassign topics from the dashboard.

Each topic should have an assignee control.

Support:

- Assigning one person
- Assigning multiple people
- Marking a topic as shared
- Leaving a topic unassigned
- Reassigning a topic
- Removing an assignee
- Adding a reason for the assignment
- Locking an assignment
- Unlocking an assignment

When an assignment changes:

- Update the overall project view.
- Update every affected person view.
- Recalculate personal workload counts.
- Preserve topic progress and completion state.
- Record whether the change was manual or GPT-generated.

A locked assignment must not be automatically changed by the GPT unless the user explicitly requests it.

---

## Part 6 — Manual Topic Completion

Every topic must include a manual completion control.

The user must be able to click a checkbox, button, or status control to mark a topic as completed.

### Required behaviour

When a topic is marked completed:

- Save the completed state persistently.
- Show a clear completed visual state.
- Update the phase progress percentage.
- Update the overall project progress percentage.
- Update the progress percentage for every assigned person.
- Update shared-work progress where relevant.
- Preserve the completion state after refresh.
- Record the completion timestamp if supported by the current data model.

When a completed topic is marked incomplete:

- Reverse the progress calculations.
- Remove or clear the completion timestamp.
- Preserve all assignment and ownership data.

### Progress calculation

Use topic-based progress unless the existing project already supports topic weights.

Default calculation:

```text
Progress percentage = completed visible topics / total visible topics × 100
```

Calculate separately for:

- Overall project
- Each phase
- Each teammate
- Shared work

For a teammate's percentage, include:

- Topics assigned directly to that teammate
- Shared topics where that teammate is an assignee

Do not count unrelated topics in that person's percentage.

If a topic has multiple assignees, its completion state contributes to each assigned person's filtered progress because it is part of each person's responsibility.

### Empty states

If a person has no assigned topics, display:

```text
No topics assigned
```

Do not display `NaN%`, `Infinity%`, or misleading 0-of-0 calculations.

---

## Part 7 — Progress Display

Keep the existing overall progress display and extend it.

Display:

- Overall project percentage
- Phase percentage
- Selected person's percentage
- Completed topic count
- Total relevant topic count

Example:

```text
Jack — 62% complete
5 of 8 assigned topics completed
```

Progress must update immediately in the UI after a completion change, while also being persisted to the backend.

If persistence fails:

- Revert the optimistic UI change or clearly show that saving failed.
- Do not leave the user believing the topic was saved.
- Display a useful error.

---

## Part 8 — Manual Roadmap Editing

Preserve and support manual editing of the roadmap.

Users must be able to:

- Add a phase
- Rename a phase
- Remove a phase with appropriate confirmation
- Reorder phases
- Add a topic to a phase
- Edit a topic
- Remove a topic with appropriate confirmation
- Reorder topics
- Assign or reassign topics
- Mark topics completed or incomplete

Avoid destructive bulk replacement unless the user explicitly requests it.

---

## Part 9 — Suggested Data Model

Adapt this to the existing project rather than replacing the current storage approach blindly.

A teammate may contain:

```js
{
  id,
  name,
  knowledge,
  confidence,
  preferences,
  learningGoals,
  availability
}
```

A topic may contain:

```js
{
  id,
  phaseId,
  title,
  description,
  status,
  completed,
  completedAt,
  assigneeIds,
  assignmentType,
  assignmentReason,
  assignmentSource,
  assignmentLocked,
  ownership: {
    filesOwned,
    foldersOwned,
    functionsOwned,
    inputs,
    outputs,
    sharedInterfaces,
    dependencies,
    blocks,
    restrictedAreas,
    integrationCheckpoint,
    definitionOfDone,
    testExpectations
  },
  notes
}
```

Maintain backward compatibility for existing projects that do not yet contain teammate or assignment fields.

Older topics should load safely with defaults such as:

```js
assigneeIds: []
assignmentType: "unassigned"
completed: false
assignmentLocked: false
```

---

## Part 10 — API and Custom GPT Actions

Use the narrowest possible API action for every change.

Add or confirm support for actions such as:

- Get project
- Get team members
- Add team member
- Update team member
- Remove team member
- Add phase
- Update phase
- Remove phase
- Reorder phases
- Add topic
- Update topic
- Remove topic
- Reorder topics
- Assign topic
- Unassign topic
- Lock assignment
- Unlock assignment
- Mark topic completed
- Mark topic incomplete

Do not replace the entire workflow when only one topic, assignment, or completion state needs changing.

The Custom GPT must use these narrow actions.

After any write action, it should briefly state exactly what changed.

---

## Part 11 — UI Requirements

Preserve the current black-and-orange visual design.

Keep the horizontal roadmap direction already requested.

Do not reintroduce the removed left-hand navigation panel.

The person filter should be easy to find without adding a large new top panel.

Each topic card should make these fields visible without becoming overcrowded:

- Topic title
- Assignee
- Completion state
- Dependency or blocked indicator
- Ownership details control
- Edit control

Detailed ownership information may appear in an expandable section, drawer, or modal.

Manual completion must be quick and visible directly from the topic card.

---

## Part 12 — Validation Rules

Prevent invalid states where practical.

Examples:

- A topic cannot reference a nonexistent teammate.
- Removing a teammate must not silently delete their topics.
- When removing a teammate, their topics should become unassigned or require reassignment.
- A topic marked as shared should have either multiple assignees or an explicit whole-team assignment.
- Locked assignments should not be changed by automated planning.
- Completion percentages must always remain between 0 and 100.
- Empty phases and people with no assigned work must be handled safely.
- Duplicate completion requests must be idempotent.

---

## Part 13 — Testing

Add tests for:

- Creating teammates
- Assigning one person to a topic
- Assigning multiple people
- Shared topics
- Unassigned topics
- Reassigning a topic
- Locked assignment behaviour
- Manual override behaviour
- Marking a topic completed
- Marking a topic incomplete
- Overall percentage calculation
- Phase percentage calculation
- Individual percentage calculation
- Shared topic percentage calculation
- Person filter results
- Empty person view
- Removing a teammate with assigned topics
- Persistence after refresh
- API errors during completion updates
- Backward compatibility with existing project data
- Custom GPT actions using narrow update endpoints

Run the complete existing test suite and fix regressions.

---

## Part 14 — Implementation Approach

Before changing code:

1. Inspect the current project architecture.
2. Identify the existing roadmap, phase, topic, storage, API, and progress models.
3. Explain which existing files will be extended.
4. Avoid rebuilding working sections.
5. Preserve existing data.
6. Add migrations or compatibility logic where necessary.

Implement the work in small, testable stages:

1. Team member data model and API
2. Topic assignment model
3. Manual assignment controls
4. Person-filtered dashboard views
5. Manual topic completion
6. Progress calculations
7. Ownership contract details
8. Custom GPT action support
9. Validation and tests

---

## Acceptance Criteria

The feature is complete when:

- The GPT gathers required team information before creating the roadmap.
- The GPT can propose a clear team allocation with ownership boundaries.
- The dashboard contains one shared roadmap.
- Topics can be assigned to one person, multiple people, everyone, or nobody.
- Users can manually assign and reassign topics.
- Users can lock assignments against automatic changes.
- The dashboard can filter the roadmap by teammate.
- Each teammate sees their topics, dependencies, blockers, and progress.
- Every topic can be manually marked completed or incomplete.
- Overall, phase, shared, and individual percentages update correctly.
- Completion and assignment changes persist after refresh.
- Existing projects continue to load.
- Existing working dashboard features remain functional.
- The visual style remains consistent with the current black-and-orange interface.
- All tests pass.

---

## Final Report

After implementation, provide:

- Root architecture decisions
- Files changed
- Data model changes
- API actions added or changed
- UI changes
- Progress calculation rules
- Backward-compatibility approach
- Tests added
- Test results
- Any remaining limitations

Do not claim completion without running the relevant tests.
