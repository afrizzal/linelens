---
phase: 03
slug: live-dashboard
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-22
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Retroactive-STRIDE audit: no phase-03 PLAN.md carried a `<threat_model>` block, so the
register below was built from the implementation files rather than inherited from planning.

**Severity is calibrated to the documented system context** (PROJECT.md): LineLens is a
localhost portfolio demo appliance with 100% synthetic clean-room data. No auth, no
multi-tenancy, and anonymous MQTT are explicit Out-of-Scope decisions, not findings. Items
that would become genuine vulnerabilities on a non-local deployment are marked **latent**
with the severity they would carry there.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → Next.js route handlers | Unauthenticated HTTP from any local client | Query params (`lineId`, `shiftDate`, `shiftId`); synthetic OEE/state read models |
| Browser → `/api/control/inject` | The only state-changing endpoint reachable from the UI | `{lineId}` JSON body → proxied to simulator control server |
| Host → simulator `:4000` | **Published** by compose for the smoke test — bypasses the web proxy entirely | `/control/inject-breakdown`, `/control/speed`, clock introspection |
| Web → Postgres | Read-only Prisma singleton + dedicated `pg` LISTEN connection | Synthetic telemetry, derived intervals, OEE aggregates |
| Worker → Postgres/MQTT | Sole MQTT consumer and sole writer (ENG-01) | Raw machine events |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01 | Tampering | Read-model routes | critical | mitigate | All `db.$queryRaw` use Prisma tagged-template form (auto-parameterized). Grep-verified: zero `$queryRawUnsafe`/`$executeRawUnsafe`/non-tagged `$queryRaw(` in application code | closed |
| T-02 | Tampering (data integrity) | `api/andon/route.ts` | high | mitigate | CR-01 fixed in `fd36da1` — both sim-time bounds `.toISOString()`-converted before binding, per the 02-02 raw-pg contract | closed |
| T-03 | Denial of Service | `api/control/inject` | low *(latent: medium)* | accept | Cooldown is client-side `setTimeout` only; no server-side 429. Accepted for localhost demo — see Accepted Risks R-01 | open — below high threshold (non-blocking) |
| T-04 | Broken security control | `docker-compose.yml` / `control.ts` | low *(latent: high)* | mitigate | Compose deliberately publishes `4000:4000` (smoke test needs it) while two source comments claimed the opposite. Comments corrected to state the real boundary; port intentionally left published | closed |
| T-05 | Denial of Service | `api/stream/route.ts` | high | mitigate | WR-02 fixed in `144f567` — both `controller.enqueue()` sites wrapped in try/catch; a disconnecting client can no longer throw into the long-lived process | closed |
| T-06 | Denial of Service | `api/stream` / `lib/listener.ts` | low *(latent: medium)* | accept | No cap on concurrent SSE connections (`setMaxListeners(0)` supports legitimate fan-out). Abort cleanup verified correct — this is an absent ceiling, not a leak. See R-02 | open — below high threshold (non-blocking) |
| T-07 | Information Disclosure | `api/{oee,timeline,sim-clock}` | low | accept | No try/catch around Prisma calls, and compose runs `next dev` without `NODE_ENV=production`, so an unhandled route exception surfaces dev-mode verbosity. Synthetic data only. See R-03 | open — below high threshold (non-blocking) |
| T-08 | Tampering | `apps/web` | high | mitigate | Read-only discipline (ENG-01) independently grep-verified: zero `.create(`/`.update(`/`.delete(`/`.upsert(`/`.createMany(`/`.updateMany(`/`.deleteMany(`/`$executeRaw` under `apps/web` | closed |
| T-09 | Information Disclosure | Secrets handling | low | mitigate | `.gitignore` covers `.env` and `docker/certs/*.crt`; only `.env.example` (placeholder values) tracked; no hardcoded credentials repo-wide | closed |
| T-10 | Spoofing / Tampering | `api/control/inject` | low | mitigate | No `Access-Control-Allow-*` headers anywhere in `apps/web/src` → default same-origin policy blocks cross-origin JSON POST. No session exists to forge (no-auth by scope) | closed |
| T-11 | Tampering (client) | Dashboard pages | low | mitigate | Zero `dangerouslySetInnerHTML`/`eval`/`new Function` in `apps/web/src`; all rendering via React JSX escaping | closed |
| T-12 | Denial of Service | `api/oee`, `api/timeline` | low | mitigate | User-controlled values bind only into `=` equality filters against small indexed master-data tables / `v_shift_windows` — no attacker-reachable unbounded scan | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (`high`) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-01 | T-03 | Inject rate limiting is client-side only. Localhost demo appliance; the worst case is a user spamming their own simulator. Already triaged and deferred by explicit user decision at the phase-03 code-review gate (WINDOWS #5). Revisit before any non-local deployment | afrizzal | 2026-08-22 |
| R-02 | T-06 | No SSE connection ceiling. `setMaxListeners(0)` is deliberate to support legitimate multi-tab fan-out; cleanup on abort is verified correct (`subscribers: 0` observed in docker). A single-viewer demo cannot exhaust it | afrizzal | 2026-08-22 |
| R-03 | T-07 | Dev-mode error verbosity on three read-model routes. All data is synthetic clean-room; there is no PII or credential to leak in a stack trace. Tracked as WINDOWS #6 alongside the pino logging gap | afrizzal | 2026-08-22 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-22 | 12 | 9 | 3 (0 blocking) | gsd-security-auditor (retroactive-STRIDE, ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-22
