---
name: clarify-before-act
description: Use when facing architectural decisions, ambiguous requirements, multiple valid implementation approaches, or trade-offs that materially change the outcome. Mandatory before writing code, choosing libraries, designing schemas, picking deployment targets, or modifying existing patterns.
---

# Clarify Before Act

You have access to the `ask_user_question` tool (provided by `@juicesharp/rpiv-ask-user-question`). Use it **proactively** — never guess on decisions that materially change the outcome.

## When to call (mandatory)

Call `ask_user_question` BEFORE acting on any of the following:

- **Architectural choices** — auth strategy, state management, API style (REST/GraphQL/RPC), monorepo vs polyrepo, sync vs async processing
- **Library/framework selection** — ORM, testing framework, build tool, runtime, validation lib
- **Data model** — schema design, relationship modeling, naming conventions
- **Deployment** — cloud provider, container vs serverless, CI/CD pipeline
- **Breaking changes** — any modification that affects public API, config format, file structure, or user-facing behavior
- **Trade-offs** — when two valid approaches exist and the user's context would change the choice (e.g., "use Redis" vs "use in-memory cache" depends on scale, latency requirements, ops capacity)
- **Ambiguous requirements** — when the user's prompt is short, multi-interpretable, or missing key constraints

## When NOT to call (don't waste user's time)

- Trivial implementation details (variable names, formatting, file ordering)
- Tasks with a single obvious correct answer in the current codebase context
- Pure mechanical edits (rename, refactor, type fixes)
- Tasks where the user already specified the answer explicitly

## How to call

### Single question (no tabs)
```json
{
  "questions": [
    {
      "question": "Which authentication approach should we use?",
      "header": "Auth (max 12 chars)",
      "options": [
        {
          "label": "JWT",
          "description": "⭐ RECOMMENDED — Stateless, scales horizontally, works with SPA. Best for 100+ concurrent users."
        },
        {
          "label": "Session cookies",
          "description": "Simpler to implement, but requires sticky sessions or shared store (Redis)."
        },
        {
          "label": "API keys",
          "description": "Best for service-to-service only. No user identity, no expiration."
        }
      ],
      "multiSelect": false
    }
  ]
}
```

### Multiple questions in one dialog (tabbed — preferred for 2+ related choices)
```json
{
  "questions": [
    {
      "question": "Which web framework?",
      "header": "Framework",
      "options": [
        { "label": "Express", "description": "⭐ RECOMMENDED — Minimal, mature, huge ecosystem. Best for REST APIs." },
        { "label": "Fastify", "description": "Faster, schema-first, built-in validation. Steeper learning curve." },
        { "label": "Hono", "description": "Modern, ultra-fast, edge-runtime ready. Newer ecosystem." }
      ],
      "multiSelect": false
    },
    {
      "question": "Which database?",
      "header": "Database",
      "options": [
        { "label": "PostgreSQL", "description": "⭐ RECOMMENDED — Reliable, mature, JSON support. Best for relational + semi-structured data." },
        { "label": "SQLite", "description": "Zero-config, embedded. Best for single-instance apps and dev." },
        { "label": "MongoDB", "description": "Flexible schema. Best for document-shaped data with no relations." }
      ],
      "multiSelect": false
    }
  ]
}
```

## Recommendation convention

Always mark **exactly one** option as recommended per question using:
- `⭐ RECOMMENDED — ` prefix in the description, followed by short justification (1 sentence, max ~15 words)
- Justification must reference the user's stated context or project constraints — not generic pros

Place the recommended option **first** in the options array for visual prominence.

For multiSelect questions, you can mark multiple options as recommended if they are non-conflicting complements.

## Response handling

When the user answers:
1. **Confirm** the choice briefly (one sentence) before proceeding
2. **Cite** the choice in your plan ("Per your choice: JWT auth, PostgreSQL")
3. **Do not re-ask** the same question unless the answer conflicts with new information

## Edge cases

- If the user replies with a custom answer ("Other"), treat it as a new constraint and re-evaluate recommendations
- If the user replies "use your judgment" or "any", pick the option matching the current best practice in the codebase, briefly state why, and proceed
- If unsure whether to ask, ask. The cost of one extra question is lower than the cost of redoing 30 minutes of work.
