---
quick_id: 260823-vtw
slug: write-the-project-readme-and-bring-the-r
date: 2026-08-23
mode: quick
status: complete
files_modified:
  - README.md
  - .planning/PROJECT.md
  - .env.example
  - CLAUDE.md
---

# Quick Task 260823-vtw — Summary

## What changed

**`README.md` — created.** The repo had none. Written for a recruiter or plant
manager first and a developer second: the value claim up front, the
simulated-build caveat immediately after it, then `cp .env.example .env &&
docker compose up -d --wait`, the six screens and what each answers, the
60-second demo script ending on the drill-down, an ASCII architecture diagram,
credibility notes (A×P×Q, Six Big Losses classification, N/A-never-a-false-0,
PPT-based Availability), the stack with what was deliberately *not* used, dev
commands, and status.

Every concrete detail was read out of the codebase rather than assumed: the six
nav entries, ten API routes, published ports 3000/4000/5432/1883, the
`2026-01-05` warm-start day, the 60x clock, and the SQL view names.

**`.planning/PROJECT.md` — Phase 4 requirements moved Active → Validated.**
DASH-02, DIFOT-01, DIFOT-02 and DDS-01 had still been sitting unchecked.
Distribution is now the only Active group; footer date refreshed to
2026-08-23. `.planning/REQUIREMENTS.md` already had all four as Complete — no
edit needed there.

**`.env.example` — documented `INGESTOR_READY_TIMEOUT_MS`,** introduced by
`260823-tkx` and previously undocumented.

**`CLAUDE.md` — Conventions and Architecture filled in.** Both had read
"not yet established" / "not yet mapped" after four phases, which actively
misleads a future session. Conventions now records the seven rules the code
already follows (sim time is domain time, raw pg binds ISO 'Z' strings, N/A
never a false 0, worker is sole consumer and sole writer, parse-don't-validate,
skip-loudly over hollow passes, log defects to WINDOWS). Architecture records
the workspace layout and the load-bearing startup ordering from WINDOWS 14/15.

## Honesty constraints held

The README deliberately does **not**:

- embed a hero GIF or a broken image link — the GIF is Phase 5 (DIST-02);
- claim an MIT license — there is no `LICENSE` file in the repo yet;
- claim a public repo or a live URL — both are Phase 5;
- quote a test count — the unit suite was still running when the README was
  written, so the testing section describes *what* is tested (golden scenarios
  to 4 dp, acceleration invariance, the `Asia/Jakarta` TZ regression, the
  causality test) rather than a number that could drift.

It also documents two known rough edges rather than hiding them, both of which
would otherwise confuse a first-time runner: `pnpm smoke` failing during the
simulated night (WINDOWS 16), and the drill-down smoke test skipping on a young
stack (the WINDOWS 13 precondition).

## Not done

Phase 5 still owns: the public repo, `LICENSE`, the hero GIF, the case study,
and the LinkedIn/application steps. This task moved none of them.
