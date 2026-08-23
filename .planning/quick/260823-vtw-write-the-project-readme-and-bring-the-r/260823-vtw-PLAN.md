---
quick_id: 260823-vtw
slug: write-the-project-readme-and-bring-the-r
date: 2026-08-23
mode: quick
status: complete
---

# Quick Task 260823-vtw — README + docs alignment after Phase 4

## Context

Phases 1–4 are complete and pushed, but the repo had **no `README.md` at all** —
only `CLAUDE.md` and `docs/00-domain-research.md`.

Scope note stated up front: a README with a hero GIF and one-command quick start
is an explicit **Phase 5** deliverable (DIST-01/02, plan 05-01). Writing it now
is still right — a repo with four phases done and no README reads as abandoned —
so this task ships an honest README **without** a GIF, without a license claim,
and without any live-URL claim, leaving Phase 5 to add exactly those.

## Tasks

### Task 1 — Write `README.md`

Audience is a recruiter or plant manager, then a developer. Lead with the value
(machine downtime = broken customer promises), state the simulated-build caveat
before anything else, then quick start, the six screens, the 60-second demo
script, architecture, credibility notes, stack, dev commands, and status.

Facts verified against the codebase rather than assumed: six nav entries
(`components/ui/nav.tsx`), ten API routes, published ports 3000/4000/5432/1883
(`docker-compose.yml`), warm-start day and 60x clock (`apps/simulator/src/main.ts`,
`.env`), and the SQL views (`packages/db`).

**Done:** no unverifiable claim, no broken image link, no invented license.

### Task 2 — `.planning/PROJECT.md`

Phase-4 requirements were still sitting unchecked under **Active**. Move
DASH-02, DIFOT-01, DIFOT-02 and DDS-01 into **Validated** with a Phase 4 block,
leaving Distribution as the only Active group; refresh the footer date.

`.planning/REQUIREMENTS.md` already marked all four Complete — checked, no edit
needed.

### Task 3 — `.env.example`

Document `INGESTOR_READY_TIMEOUT_MS`, introduced in `260823-tkx` and previously
undocumented.

### Task 4 — `CLAUDE.md` Conventions + Architecture

Both sections still read "not yet established" / "not yet mapped" after four
phases — actively misleading to a future session. Fill both with what the code
actually does, including the load-bearing startup ordering from WINDOWS 14/15.

## Must-haves

- truths:
  - A stranger can clone, read the README, and run the stack.
  - Nothing in the README claims something the repo does not have.
  - PROJECT.md shows only Distribution as outstanding.
