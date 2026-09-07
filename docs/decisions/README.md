# Architecture Decision Records

## What

Architecture Decision Records (ADRs) capture **why** a significant architecture,
stack, or boundary decision was made. They give future contributors — human or
AI — the context to evolve the system without unknowingly reversing a deliberate
choice.

## When to write one

Write an ADR when a change:

- alters the architecture, stack, or package boundaries described in
  `docs/architecture/README.md`;
- introduces a new external service, dependency category, or deployment target;
- changes security guarantees (secrets, validation, data flow);
- or is otherwise significant enough that future readers would reasonably ask "why?".

Small, obviously-beneficial improvements do **not** need an ADR.

## Format

Each ADR is a self-contained Markdown file in this directory:

```
NNNN-short-kebab-case-title.md
```

A short template:

| Section      | Purpose                                                   |
| ------------ | --------------------------------------------------------- |
| Status       | Proposed / Accepted / Deprecated / Superseded by `NNNN-…` |
| Context      | The problem and the constraints that matter               |
| Decision     | What was decided                                          |
| Consequences | Trade-offs, what becomes easier and harder                |
| Alternatives | Options considered and why they were rejected             |

## Phase 0

No ADRs were required during Phase 0; the foundations follow the approved
architecture. Record the first ADR as soon as a real architectural decision arrives.
