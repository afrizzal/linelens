---
status: resolved
phase: 01-foundation-living-plant
source: [01-VERIFICATION.md]
started: 2026-07-25T20:25:00Z
updated: 2026-07-25T21:20:00Z
---

## Current Test

[none — all items automated and passing]

## Tests

### 1. Full 5-service `docker compose up` (build step for simulator/worker/web images)
expected: All 5 services (db, mqtt, simulator, worker, web) reach running/healthy state from a clean clone, per Success Criterion 1.
result: passed — but only after fixing three real defects. Automated as `pnpm smoke` (`tests/smoke/compose-stack.spec.ts`) so this never needs a manual pass again.

Evidence: `docker compose up -d --wait db mqtt simulator web` → all four report `(healthy)`; `pnpm exec playwright test` → 5/5 pass in ~11s. Negative control performed: with `docker compose stop simulator`, the suite fails on `ECONNREFUSED :4000` — so the tests genuinely exercise the live stack rather than passing vacuously.

Defects found and fixed (commit `f93a495`) — none were detectable by the unit suite, which stayed 56/56 green throughout:
1. **No `.dockerignore`** — `COPY . .` overwrote the image's installed `node_modules` with the host's. On Windows those are pnpm symlinks into host paths, so simulator, worker, and web all crash-looped on `MODULE_NOT_FOUND` for `tsx`/`next`. This was the actual bug hiding behind the "re-verify on a clean machine" note; it was never an environment quirk.
2. **Simulator port only `expose`d, not published** — the control endpoint was unreachable from the host, so inject-breakdown could not be driven by a smoke test or a manual `curl` demo. Now `4000:4000`.
3. **TLS-intercepting proxy broke the image build** — `corepack prepare pnpm` failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (Avast Web/Mail Shield MITM on this machine). `docker/certs/*.crt` is now concatenated into `NODE_EXTRA_CA_CERTS` at build time; the directory is empty and the step is a no-op on a clean machine, and certs are gitignored as machine-local. This was the only genuinely environmental item of the three.

Non-defect observations, both consistent with Phase 1 scope:
- `worker` exits 0 immediately — it is still the skeleton (`no domain logic yet`) per plan 01-01. Phase 2 gives it a real MQTT subscribe loop; the smoke suite intentionally does not assert `worker` stays up yet.
- A stray host-side simulator left running from Wave 3's live test held the same stable MQTT `clientId` as the container, so the broker kicked them off each other in a 1s reconnect loop. Killed the host process; loop stopped. Not a code defect — the stable clientId is deliberate (required for `clean:false` session resumption) — but worth knowing that two simulator instances can never share a broker.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
