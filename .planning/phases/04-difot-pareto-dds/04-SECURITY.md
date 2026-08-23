---
phase: 04
slug: difot-pareto-dds
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-23
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Retroactive-STRIDE audit: no phase-04 PLAN.md carried a `<threat_model>` block and no
SUMMARY.md carried a `## Threat Flags` section (both grep-confirmed empty), so the register
below was built from the implementation files rather than inherited from planning. The
emptiness reflects an absence of threat modelling during planning, not an absence of risk —
the audit was run at correspondingly greater depth, including live requests against the
running `docker compose` stack rather than static inspection alone.

**Closed:** 5/7 · **Open:** 2/7 (0 at or above the `high` block threshold)

## Trust Boundaries

New in Phase 04:

| Boundary | Description |
|---|---|
| Browser → `/api/orders`, `/api/orders/[id]`, `/api/losses`, `/api/dds` | New unauthenticated GET-only read routes; same boundary class as Phase-03's routes |
| `/api/orders/[id]` → `order_loss_drilldown()` / `order_drilldown_context()` | New parameterized SQL function surface in `packages/db/src/views.sql` |
| Worker → Postgres (writes) | `apps/worker/src/orders/{generate,allocate}.ts` — new write paths, still worker-only per ENG-01 |

## Threat Register

### Closed

| ID | Category | Severity | Disposition | Evidence |
|---|---|---|---|---|
| T-01 | Tampering — SQL injection | critical | mitigate | Zero `$queryRawUnsafe`/`$executeRawUnsafe` in `apps/web/src`, `apps/worker/src`, `packages/db/src`. All four routes use Prisma tagged-template `$queryRaw` (auto-parameterized). Live-tested: `GET /api/dds?lineId=';DROP TABLE customer_order;--` → 200 with the string echoed back as inert data; `GET /api/orders/';DROP TABLE customer_order;--` → 404. Follow-up `GET /api/orders?day=2026-01-05` → 200, table intact. `order_loss_drilldown`/`order_drilldown_context` are `LANGUAGE sql STABLE` with a typed `p_order_id text` param; zero `EXECUTE`/`format(` — no dynamic-SQL second-order path. |
| T-02 | Tampering — write-path integrity | high | mitigate | `generate.ts:180` (`db.customerOrder.upsert`), `allocate.ts:98,104` (`tx.allocation.upsert`, `tx.customerOrder.update`) — zero raw SQL in these files. Preserves ENG-01 worker-sole-writer, inherited from Phase-03 T-08. |
| T-03 | XSS / improper output encoding | high | mitigate | Zero `dangerouslySetInnerHTML` across `apps/web/src` (extends Phase-03 T-11). Values rendered from Phase-04 endpoints are numeric/date, or app-controlled seed data (hardcoded `CUSTOMERS` array at `generate.ts:37-38`; `reason_code` master table) — not attacker-reachable free text. `composeLateHeadline`/`composeFulfillmentStory` render through a JSX text node (`orders/[id]/page.tsx:243`), React-escaped. |
| T-06 | Information disclosure — secrets | low | mitigate | No new secrets. `.env` gitignored (`.gitignore:5`); `.env.example` carries only placeholder dev credentials (`linelens-dev`). Unchanged from Phase-03 T-09. |
| T-07 | Spoofing / CSRF | low | mitigate | Zero `Access-Control-*` headers on the four new routes → default same-origin policy (matches Phase-03 T-10). All four are GET-only; no state-changing verb to forge. |

### Open — non-blocking (below the `high` threshold)

| ID | Category | Severity | Expected mitigation | Evidence |
|---|---|---|---|---|
| T-04 | DoS — uncaught exception on malformed input | medium | Calendar-validity checking (not just regex shape) and/or `try`/`catch` → clean 400, in `apps/web/src/app/api/orders/route.ts` | `day` is validated only by `^\d{4}-\d{2}-\d{2}$`, then bound as `"dueDate"::date = ${day}::date`. Live-confirmed twice (auditor, then independently by the orchestrator): `GET /api/orders?day=2026-02-30` → **500**, `?day=2026-99-99` → **500**, `?day=2026-01-05` → 200. Container logs show an uncaught `PrismaClientKnownRequestError` / Postgres `22008` "date/time field value out of range" from `route.ts:59`; zero `try {` in the route. **Mitigating factor:** the HTTP response body is empty — no stack trace or schema internals reach the client, only the server console. `/api/losses` shares the unvalidated-`day` pattern but does NOT crash (string compare against `shiftDate`, no `::date` cast — returns 200 with `rows: []`); the defect is specific to `/api/orders`'s cast. |
| T-05 | Broken access control — no authentication | low *(latent: medium off-localhost)* | N/A — accepted by design, see R-04 | The four new routes are GET-only over 100% synthetic data, extending an already-documented and accepted boundary (CLAUDE.md: "demo appliance, no auth per scope"; Phase-03 SECURITY.md Trust Boundaries already documents "Browser → Next.js route handlers: unauthenticated HTTP from any local client"). |

### Unregistered flags

None. No SUMMARY.md in Phase 04 carries a `## Threat Flags` section — consistent with the
fully retroactive nature of this audit; there was nothing to reconcile.

## Accepted Risks Log

| ID | Risk | Rationale | Scope |
|---|---|---|---|
| R-04 | The Phase-04 read routes (`/api/orders`, `/api/orders/[id]`, `/api/losses`, `/api/dds`) require no authentication | LineLens is a deliberately unauthenticated local demo appliance with a $0 infrastructure budget. All data is synthetic/clean-room — no real customer, employee, or production figures exist anywhere in the system. These routes are GET-only and extend the boundary Phase-03 already accepted; they introduce no new class of exposure. | Extends the Phase-03 rationale explicitly to the four Phase-04 routes. Revisit if LineLens is ever deployed beyond localhost — the latent severity rises to medium off-localhost. |

**Not accepted:** T-04 remains OPEN rather than accepted. It is non-blocking at ASVS L1, but
it is a reproducible crash trigger rather than a theoretical verbosity risk, and Phase 05's
stated goal is a public MIT repo that a stranger clones and runs. A 500 on a plausible typo'd
date is a poor first impression in exactly that scenario. Recommended as a cheap fix before
Phase 05 rather than a documented acceptance.

## Security Audit Trail

| Date | Auditor | Mode | Result |
|---|---|---|---|
| 2026-08-23 | gsd-security-auditor (ASVS L1, block_on `high`) | retroactive-STRIDE | 5 closed, 2 open, 0 blocking. Live-tested against the running compose stack, not static grep alone. |
| 2026-08-23 | orchestrator (independent re-check) | spot-verification | Confirmed both load-bearing claims: T-04 crash reproduced (500/500/200 across the three probe dates) and T-01 injection confirmed inert (200, table intact). |

## Sign-Off

**threats_open: 0** — no open threat at or above the `high` blocking threshold. Phase 04
passes the security gate. T-04 (medium) and T-05 (low, accepted as R-04) remain open and
tracked.
