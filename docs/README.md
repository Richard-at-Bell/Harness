# Browser project studio — specification index

Status: **Draft for review** · 2026-09-28

This is the proposed specification for a web app in which a user chats with an agent, edits a vanilla HTML/CSS/JavaScript project, previews it live, works with generated table fixtures, and downloads a ZIP containing the project and its work record. The studio itself is written in TypeScript and deployed as a static Vercel site. The user's project does not require TypeScript.

Read in this order:

1. [Product specification](product-spec.md) — user journey, first release, acceptance criteria.
2. [Architecture and contracts](architecture-spec.md) — browser components, file and agent seams, preview isolation, persistence.
3. [Fixtures and ZIP format](fixtures-and-export-spec.md) — CSV/XLSX behavior, to-do reference table, portable artifact.
4. [Decision register](decisions.md) — proposed choices, alternatives, unresolved points.
5. [Glossary](glossary.md) — terms used consistently across the specs.
6. [Agent model choices](model-selection.md) — current picker models and the comparison seam.
7. [Browser agent workflow review](browser-workflow-review.md) — requested capabilities, observed UI results, and harness fixes.

## Review focus

The highest-impact choices are [D-004](decisions.md#d-004-preview-runtime), [D-006](decisions.md#d-006-what-table-writes-mean-after-export), and [D-007](decisions.md#d-007-fixture-formats). They determine how live preview and table writes work, and what a downloaded project can do independently of the studio.

## Scope boundary

The first release targets a single-user, browser-local workspace for small static web projects. It includes a to-do app template with a table fixture. It does not assume a hosted database, a managed model key, or a long-running API service.

These documents are a design proposal, not an implementation claim. A decision marked **Proposed** can be changed during review. A decision marked **Open** requires a product choice before its dependent behavior is implemented. [Implementation status](implementation-status.md) records what the current prototype supports.
