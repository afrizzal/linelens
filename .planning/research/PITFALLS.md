# Pitfalls Research

**Domain:** Real-time OEE / manufacturing analytics dashboard + built-in MQTT factory telemetry simulator (portfolio-first, simulated build)
**Researched:** 2026-07-22
**Confidence:** HIGH (technical pitfalls verified against current docs; domain pitfalls carried from adversarially-verified `docs/00-domain-research.md` + OEE math)

> Two failure classes dominate this project: **credibility killers** (a factory person spots an OEE classification error and the whole demo loses trust) and **the "silent number corruption" class** (an accelerated simulated clock, timezone, or in-progress-interval bug quietly makes every number wrong while the UI still looks alive). A third class — **distribution failure** — is the maintainer's known personal failure mode and is explicitly in the Definition of Done.

---

## Critical Pitfalls

### Pitfall 1: OEE classification errors a factory person catches on sight

**What goes wrong:**
The demo shows a loss classified the way a naïve developer would guess, not the way the industry defines it. The three lethal ones:
- **Small/minor stops counted as Availability loss.** They are **Performance loss** (Idling & Minor Stops — the machine is available but running slow/stopping briefly, <5 min, resolved by operator without maintenance). Getting this wrong is the single most common OEE tell.
- **Changeover excluded from Availability** (or counted as Performance). Changeover/setup is a **Planned Stop = Availability loss** (Setup & Adjustments), usually the largest downtime bucket.
- **Ideal Cycle Time set as a budget/standard number** instead of the fastest theoretical rate → Performance silently exceeds 100%, which is physically impossible and instantly reads as broken.

**Why it happens:**
"Downtime = availability" feels intuitive, so minor stops get lumped there. ICT gets set to a comfortable planning number rather than best-demonstrated rate because that is what an ERP-trained mind reaches for.

**How to avoid:**
- Encode the 2-2-2 Six Big Losses → factor mapping directly in the state machine and the aggregation layer (Availability: Unplanned Stops, Planned Stops; Performance: Small Stops, Slow Cycles; Quality: Production Rejects, Startup Rejects — per `docs/00-domain-research.md §3`).
- Ship the **built-in validation guard: Performance > 100% → flag "Ideal Cycle Time misconfigured"** (already a stated requirement). Wire it as a hard assertion in the OEE engine and a visible dashboard warning, not just a comment.
- Make "changeover as planned vs unplanned" a **configurable policy** with a planned→unplanned transition on overage (verified best practice), not a hardcode.

**Warning signs:**
Performance factor > 100% anywhere; a "minor stop" bar showing up under the Availability slice of the waterfall; changeover missing from the Availability breakdown; OEE that goes *up* when you add downtime.

**Phase to address:** OEE Engine phase (classification is the engine's core contract). Add a "factory-person review" checklist item before the dashboard phase.

---

### Pitfall 2: OEE calculation edge cases (divide-by-zero, in-progress intervals, PPT-vs-calendar, double-counted rejects)

**What goes wrong:**
The formula is trivial; the edge cases are where it breaks. Four concrete ones:
1. **Division by zero on a no-runtime shift.** `Availability = RunTime / PlannedProductionTime`, `Performance = (ICT × Count) / RunTime`, `Quality = Good / TotalCount`. Any denominator can be 0 (idle shift, no scheduled production, zero parts made) → `NaN`/`Infinity` propagates and the dashboard shows `NaN%` or a crash.
2. **In-progress (open) intervals skewing live OEE.** The current state interval has no end yet. If live OEE only sums *closed* intervals, a machine mid-way through a 20-minute breakdown contributes 0 downtime until the breakdown ends — live OEE looks fine, then jumps. If instead you project the interval's full expected duration, it over-penalizes.
3. **Planned Production Time confused with calendar time.** Availability's denominator is **Planned Production Time** (shift length minus breaks and no-demand Schedule Loss), *not* calendar time. Mixing them (using calendar time = TEEP denominator) silently deflates Availability and makes OEE look worse than reality.
4. **Reject double-counting.** `Total = Good + Reject` is an invariant. Bugs: counting a part at both infeed and outfeed sensors; subtracting rejects from Total *and* dividing by Total; treating Startup Rejects and Production Rejects as separate subtractions when both simply roll into the one Quality ratio.

**Why it happens:**
Developers test with a "happy path" shift that has runtime, parts, and a clean end. Empty shifts, the live/streaming case, and the two-kinds-of-rejects taxonomy only surface with real event streams.

**How to avoid:**
- Guard every factor: when a denominator is 0, the factor and OEE are **`null` / "N/A"**, never 0% and never 100%. An unscheduled shift showing "0% OEE" falsely implies catastrophic failure; "N/A — no planned production" is correct.
- For **live** metrics, define the window as `[shift_start, now_event_time]` and **clamp the open interval to `now`** (treat it as ending at the current simulated time), recomputing on each event. Label the tile "so far this shift."
- Model the shift calendar explicitly (breaks, no-demand) so `PPT = shift_length − planned_breaks − schedule_loss`. Keep TEEP (calendar denominator) as a separate, clearly-labeled metric if shown at all.
- Enforce `Total = Good + Reject` as a DB constraint or ingestion assertion; unit-test the two-reject-types case against Quality.

**Warning signs:**
`NaN%`/`Infinity%` in any tile; live OEE that leaps discontinuously when an interval closes; Availability that mysteriously improves when you add break time; Quality that doesn't equal `Good/Total`.

**Phase to address:** OEE Engine phase. Write these four as explicit unit tests before wiring the dashboard.

---

### Pitfall 3: Event-time vs wall-clock bug with the accelerated simulated clock (the silent corruptor)

**What goes wrong:**
The simulator runs an **accelerated clock** (e.g., 1 real second = several simulated minutes) so a demo can show a full shift in 60 seconds. Every derived number depends on *which* clock you measure with. If the ingestion worker or aggregation uses **wall-clock `Date.now()` / receipt time** instead of the **simulated event timestamp in the payload**, then:
- State-interval durations collapse to near-zero (real elapsed time between two accelerated events is milliseconds), so downtime/runtime and therefore OEE are garbage.
- The "now" for the live window is wrong, so "so far this shift" spans the wrong slice.
- MQTT-queued/retained messages replayed on reconnect arrive out of order and get stamped with a later receipt time than earlier events.

The insidious part: the UI still animates and looks alive, so the bug is invisible until someone checks whether the numbers are physically plausible.

**Why it happens:**
`Date.now()` is the path of least resistance and works fine at 1:1 speed. The accelerated clock breaks the hidden assumption that receipt time ≈ event time.

**How to avoid:**
- The simulator **stamps every payload with its simulated event-time** (in the PackTags-lite JSON, per `docs §7`). This is the single source of truth for all time math.
- **Every derivation uses event-time from the payload — never `Date.now()`.** The system's notion of "current time" for live windows = the **latest simulated timestamp seen**, not wall-clock.
- One authoritative sim clock (owned by the simulator); the acceleration factor is a config value, not scattered constants.
- Handle out-of-order arrival: order by event-time, not insertion order, when deriving intervals.

**Warning signs:**
Interval durations in milliseconds when they should be minutes; OEE that is absurdly high/low but stable; numbers that change if you slow the acceleration factor; different results on a fast vs slow machine (a dead giveaway that wall-clock leaked in).

**Phase to address:** Simulator phase (event-time contract) + OEE Engine phase (consume event-time only). Make "no `Date.now()` in derivation code" a lint/review rule.

---

### Pitfall 4: Simulated-data tells that make the demo read as fake

**What goes wrong:**
The clean-room synthetic data is the whole credibility bet, and amateur simulators broadcast their fakeness: a too-perfect factory (every line ~90%), round numbers (cycle time exactly 30.00s, OEE exactly 85.0%), zero variance, machines that all fail at the same instant, production running flat 24/7 with no shift/break rhythm, and instant/complete operator reason codes on every stop. A plant manager sees this in three seconds.

**Why it happens:**
Uniform random or constant values are the easiest to code; realism (jitter, MTBF/MTTR distributions, correlated-not-synchronized failures, reason-code lag) takes deliberate effort.

**How to avoid:**
- Calibrate the fleet to the **verified real-world distribution**: majority of lines **50–65% OEE, one showcase ~85%, one problem line <45%** (Evocon 3,500+ machine dataset — a too-perfect factory is *less* credible, not more).
- Add variance/jitter to cycle times; model downtime via **MTBF/MTTR per machine class** with exponential-ish inter-arrival (configurable defaults — the domain research notes per-class numbers aren't publicly sourced, so make them parameters, don't hardcode a fake authority).
- **Reason codes lag the event and some stops stay uncategorized** — real operator annotation is imperfect (Vorne's model: counts from sensors, reasons from operator input). Perfectly-labeled 100% is a tell.
- Respect the **shift/break calendar** so production has rhythm; failures should be *correlated but not synchronized*.
- Enforce reconciliation: `good + reject = total`, and DIFOT numbers that actually tie to production output.

**Warning signs:**
Every line within a few points of each other; OEE/cycle values that are suspiciously round; a Pareto where every stop has a reason; production with no break gaps; all machines red at once.

**Phase to address:** Simulator phase (this *is* the simulator's quality bar). Verify against the calibration distribution before building the dashboard on top of it.

---

### Pitfall 5: Re-introducing one of the four refuted anti-patterns

**What goes wrong:**
`docs/00-domain-research.md §8` already refuted four claims (0-3 / 1-2 adversarial votes). It is easy to drift back into them under implementation pressure:
1. Labeling the hierarchy **"ISA-95-aligned"** — normative ISA-95 is Enterprise/Site/Area/**Work Center/Work Unit**; Line/Cell is **UNS convention**. Say **"UNS-style hierarchy."**
2. **Hardcoding a 2-minute** minor-stop-vs-breakdown threshold — no universal normative limit exists (field varies 2–10 min). Make it **configurable**.
3. Taking the **PackML state list from the OPC Section 4 page** — incomplete. The minimal state subset must be verified **directly against ISA-TR88.00.02-2015** before implementation (community references say 17 states / 4 minimal-compliant, *unverified*).
4. Claiming **"OEE is an explicit PackML objective"** — PackML is about state/tag interoperability, not OEE.

Adjacent framing trap: claiming the DIFOT drill-down is **absolutely unique**. Verification found no OEE-segment precedent, but Celonis does order-delay classification from ERP data. Use the **"bridge" framing** (`docs §1,§5`), never absolute uniqueness.

**Why it happens:**
The "ISA-95" and "unique" labels sound more impressive; hardcoding a threshold is faster than a config knob; the OPC page is the easiest PackML source to find.

**How to avoid:**
Treat §8 as a linter for docs, README, UI copy, and case study. Resolve open research item #1 (ISA-TR88 state subset) *before* writing the state machine. Config-drive the minor-stop threshold from day one.

**Warning signs:**
The string "ISA-95" near "Line/Cell"; a literal `120` seconds in stop-classification code; "no one else does this" in any portfolio copy.

**Phase to address:** Simulator + Distribution phases (copy review). Add §8 items to the pre-merge doc checklist.

---

### Pitfall 6: Over-scoping the 2–3 week sprint (breadth before the money shot)

**What goes wrong:**
The scope spans seven areas — simulator, OEE engine, four dashboard widgets, DIFOT module, DDS screen, and distribution. The natural failure is to build all of them to equal fidelity (or polish simulator realism forever) and run out of time before the **signature demo** — inject breakdown → OEE drops → andon red → drill-down from a late order to the causing loss event — is wired end-to-end and captured as a GIF.

**Why it happens:**
Every requirement feels load-bearing, and horizontal building (finish all widgets, then connect) feels orderly. But the demo is a *vertical* path through the whole stack.

**How to avoid:**
- Build the **demo vertical slice first**: one inject-breakdown scenario that cascades sim → MQTT → ingestion → OEE → andon → one late order → drill-down. Thin but end-to-end. *Then* add breadth (more widgets, DDS, calibration polish).
- Rank widgets: andon + OEE waterfall + the DIFOT drill-down are the money shot; Pareto/timeline/DDS are supporting.
- Keep the Out-of-Scope list (full Sparkplug protobuf, DuckDB, live URL, waste module, predictive) actually out. Cut features, not credibility.

**Warning signs:**
Week 2 with a beautiful simulator but no drill-down; polishing MTBF curves while the DIFOT link is still a stub; "I'll connect it all at the end."

**Phase to address:** Roadmap ordering — sequence a thin vertical demo slice as an early phase, before widening.

---

### Pitfall 7: "Works on my machine" + the GIF-left-for-later distribution gap

**What goes wrong:**
Two linked failures, both fatal for a *portfolio* project:
- A recruiter clones the repo, runs `docker compose up`, and it fails — because of host-specific ports, `host.docker.internal`, an unseeded DB, a missing `.env.example`, unpinned image tags, or a hidden timezone assumption.
- The **60-second demo GIF is deferred** and never made — the maintainer's documented recurring failure mode (the StockLens demo-URL gap). A manufacturing dashboard that can't be *seen* in 60 seconds doesn't do its one job: winning a job-market segment.

**Why it happens:**
The build works incrementally on the author's box, so cross-machine breakage is invisible. The GIF feels like a "later" polish task rather than a deliverable.

**How to avoid:**
- **Distribution is in the Definition of Done** (public MIT repo, README with hero GIF + one-command start, 60s demo GIF, case study, ≥1 LinkedIn post, attached to ≥1 real application). Gate the milestone on it.
- Make the demo **deterministic**: seeded RNG + a scripted breakdown scenario so the cascade reliably produces a visibly-late order inside the demo window (a fully-random sim may not show a late order in 60s). Record the GIF against this scripted path.
- Test on a **clean checkout / second machine** (or a throwaway container host): one command, self-seeding on boot, pinned image versions, healthcheck-gated startup, no host-specific config, timezone set explicitly.
- Verify the DIFOT link is **genuinely causal**, not cosmetic — if injecting a *different* breakdown doesn't change which order goes late, a sharp viewer notices the drill-down is faked.

**Warning signs:**
No `.env.example`; `latest` image tags; DB empty on fresh start; the GIF still a TODO in the final week; the drill-down shows the same order regardless of which line you break.

**Phase to address:** Distribution phase (first-class, not a coda). Add a "clean-machine smoke test" as a milestone gate.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Timestamp events with `Date.now()` at ingestion instead of event-time from payload | One less field to plumb | Corrupts every duration/OEE number under accelerated clock (Pitfall 3) | **Never** — event-time is non-negotiable for an accelerated sim |
| Full Sparkplug B (protobuf, birth/death lifecycle) | "Standards-compliant" bragging rights | Days of work, zero demo value; distracts from the money shot | **Never for v1** — topic convention + JSON is enough (`docs §9`) |
| Hardcode minor-stop threshold, MTBF/MTTR, shift pattern | Faster to first working sim | Reintroduces refuted anti-pattern #2; can't calibrate realism; fake-authority claim | **Never** — make them config with sane defaults |
| One giant unpartitioned events table, no retention | Simplest schema | Unbounded growth in a long-running demo; slow live queries as rows pile up | OK for v1 **if** a retention cap or rollup exists (see Performance Traps) |
| NextResponse for the SSE stream | Familiar Next.js idiom | Buffers the stream — dashboard shows nothing until connection closes | **Never** — use raw `Response` + `ReadableStream` |
| Skip MQTT persistent session / fixed client ID | Simpler connect code | Worker misses events across reconnects; gaps in OEE during the demo | Acceptable only if you tolerate at-most-once and re-derive from last-known state |
| DIFOT link as a cosmetic hardcode | Ships the "money shot" visually fast | Demo collapses under scrutiny (Pitfall 7); kills credibility | **Never** — the drill-down must be genuinely data-linked |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Next.js App Router SSE** | Returning `NextResponse`, awaiting the whole stream before returning, or letting the route be cached | Return a raw `Response` wrapping a `ReadableStream`; set `export const dynamic = 'force-dynamic'`; send headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, **`X-Accel-Buffering: no`** (defeats proxy buffering) |
| **SSE behind a proxy (nginx/docker)** | Stream buffered by the reverse proxy; events arrive in bursts or not at all — works in `next dev`, breaks in docker/compose | `X-Accel-Buffering: no` header + `proxy_buffering off` if you front it with nginx; test the streaming path *inside docker*, not just `next dev` |
| **MQTT.js reconnect** | Registering `message` handlers after a delay / after `connect`, so queued messages on a persistent-session reconnect are acked before handlers exist → silently dropped | Register `on('message')` **before/synchronously with** connecting; use a **fixed client ID** + `clean: false` + QoS 1 for the ingestion worker so the broker replays missed events |
| **MQTT session semantics** | `clean: true` (default-ish) → broker drops the subscription/queue on disconnect; worker restart loses the gap | `clean: false` + stable client ID for the worker; accept that a *long* offline gap past session expiry is discarded — re-derive state from last persisted interval |
| **Docker Compose startup order** | `depends_on` (short form) only waits for the container to *start*, not be *ready* — worker connects to Postgres/Mosquitto before they accept connections and crash-loops | Long-form `depends_on` with `condition: service_healthy`; add healthchecks (`pg_isready` for Postgres, a broker ping for Mosquitto) with a `start_period`; app/worker retry-with-backoff as a belt-and-braces |
| **EventSource client** | Assuming the browser tab count is unlimited | HTTP/1.1 caps EventSource at **6 connections per domain across all tabs** — a 7th tab hangs. Fine for a single-screen demo; if multi-tab matters, serve over HTTP/2 or share one connection |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded event-table growth in a long-running demo | Disk creeps up; live "so far this shift" queries slow over hours; a demo left running overnight bloats | Cap raw-event retention (drop/rollup old shifts) or downsample into per-interval summaries; for a demo, a rolling window is plenty | Accelerated clock generates *many* sim-hours per real hour — this bites in hours, not months. Note: native partitioning/TimescaleDB only pays off above ~100GB — **don't** add it for a demo; a retention cap + good index is the right call |
| Recomputing full-shift OEE from raw events on every SSE tick | Dashboard lag as events pour in; CPU spike | Maintain incremental per-interval aggregates; push deltas over SSE, not full recomputes | As soon as event rate × line count is nontrivial |
| SSE 6-connection HTTP/1.1 limit | 7th browser tab silently hangs with no error | Single-screen demo needs one connection; if not, HTTP/2 or a shared worker | Only if the demo relies on many simultaneous tabs |
| Per-event round-trip DB writes with no batching | Ingestion falls behind the accelerated stream; growing lag between sim time and persisted time | Batch inserts / use a write queue in the worker | High acceleration factors |

---

## Security Mistakes

> This is a single-user demo appliance (no auth, no multi-tenant, 100% synthetic data — all by design), so classic app-sec surface is minimal. The real "security"-adjacent risks are **data-provenance and honesty**, which for a portfolio piece are credibility-critical.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Any real employer data / production figures leaking into seed data or the case study | Violates standing confidentiality rule; reputational + legal risk | 100% clean-room synthetic; no real SKUs, plants, or figures; state "simulated build" prominently |
| Overclaiming in README/case study ("real factory deployment", "ISA-95-aligned", "uniquely first") | Recruiter/plant-manager calls the bluff; credibility gone | Honesty guardrail from PROJECT.md: "simulated build informed by manufacturing experience"; UNS-style not ISA-95; bridge framing not uniqueness |
| Mosquitto open with no listener config / default allow-anonymous exposed beyond localhost | If ever deployed to a live URL, an open broker is abusable | Bind broker to the compose network only; if the stretch live-URL happens, lock the listener down |
| Committing a real `.env` instead of `.env.example` | Leaks any future tokens; sloppy signal on a portfolio repo | `.env.example` only; `.gitignore` the real env; no secrets needed for v1 anyway |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Andon board missing the minimum viable content | Looks like a toy, not a floor tool | Per verified baseline (`docs §4`): each line shows **production state (Running/Down/Changeover/Break) + good count + target count**, live |
| No color language for production state | Viewer can't parse the floor at a glance | Color-coded timeline + andon (the whole point of andon is instant visual state) |
| OEE shown as a bare percentage with no waterfall | Viewer can't see *why* OEE is low — the loss story is invisible | A×P×Q waterfall + Six Big Losses Pareto (stackable per shift) so the "downtime is the fastest lever" narrative lands |
| Live tiles that flicker/jump on every event | Feels janky, undermines "real-time" polish | Debounce/smooth updates; label live tiles "so far this shift"; animate transitions |
| The 60s demo doesn't reach the drill-down | The signature value ("downtime = broken customer promises") never lands | Script the demo so inject-breakdown → OEE → andon → late-order drill-down completes inside the window |
| Numbers that don't reconcile across screens | Viewer trust evaporates | Single source of truth for counts/OEE; andon good-count must match the OEE engine's Good Count |

---

## "Looks Done But Isn't" Checklist

- [ ] **OEE engine:** Often missing the divide-by-zero guards — verify an idle/no-production shift shows "N/A", not `NaN%` or a false 0%.
- [ ] **OEE engine:** Often missing the Performance > 100% guard wired as a live warning — verify a deliberately-wrong ICT triggers the flag.
- [ ] **Live OEE:** Often missing open-interval clamping — verify the value updates smoothly mid-breakdown, not in a jump when the interval closes.
- [ ] **Simulator:** Often missing event-time stamps in the payload — verify durations are correct at 2× and 10× acceleration (same OEE either way).
- [ ] **Simulator:** Often missing realistic distribution — verify lines span 50–65% / ~85% / <45%, not all-identical.
- [ ] **MQTT worker:** Often missing persistent session — verify no event gap after a worker restart mid-demo.
- [ ] **SSE:** Often missing anti-buffering headers — verify streaming works **inside docker compose**, not just `next dev`.
- [ ] **Docker:** Often missing healthcheck-gated startup — verify a cold `docker compose up` on a clean machine comes up with no crash-loop.
- [ ] **DIFOT drill-down:** Often faked — verify injecting a *different* breakdown changes *which* order goes late (genuine causal link).
- [ ] **Distribution:** Often missing the GIF — verify the 60s demo GIF exists and shows the full cascade, and README has one-command quick start.
- [ ] **Copy:** Often drifts into refuted claims — verify no "ISA-95-aligned", no hardcoded 2-min threshold, no absolute-uniqueness claim.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Event-time vs wall-clock leaked into derivations | HIGH | Audit all time math for `Date.now()`; re-plumb event-time from payload; re-run OEE unit tests at multiple acceleration factors; likely a targeted rewrite of the interval-derivation layer |
| OEE misclassification shipped | MEDIUM | Fix the Six-Big-Losses mapping in one place (engine); re-derive intervals; update Pareto/waterfall — contained if classification is centralized, painful if scattered |
| Simulated-data reads as fake | MEDIUM | Add variance/jitter, MTBF/MTTR distributions, reason-code lag, calibrate to 50–65/85/<45 distribution — mostly simulator tuning, no schema change |
| SSE buffered in docker | LOW | Add `X-Accel-Buffering: no` + `dynamic = 'force-dynamic'` + raw `Response`; retest inside compose |
| Worker crash-loops on cold start | LOW | Add `condition: service_healthy` + healthchecks + retry-backoff |
| Unbounded table growth in a long demo | LOW | Add a retention cap / rollup job; drop old shifts |
| GIF/distribution never made | MEDIUM (time, not tech) | Gate the milestone on it; script a deterministic demo path and record once the vertical slice works |

---

## Pitfall-to-Phase Mapping

> Phases are topic-named (roadmap not yet finalized). Ordering implication: sequence a **thin end-to-end demo vertical slice early**, before widening to all widgets.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1 OEE classification errors | OEE Engine | Factory-person review checklist; Performance ≤ 100% guard fires on bad ICT |
| P2 OEE edge cases (div/0, open intervals, PPT, rejects) | OEE Engine | Unit tests for idle shift, mid-breakdown live value, PPT vs calendar, two reject types |
| P3 Event-time vs wall-clock | Simulator (stamp) + OEE Engine (consume) | Identical OEE at 2× and 10× acceleration; no `Date.now()` in derivation code |
| P4 Simulated-data tells | Simulator | Fleet spans 50–65/85/<45; jitter present; reason-code lag + some uncategorized |
| P5 Refuted anti-patterns re-entry | Simulator + Distribution (copy) | §8 doc-linter pass; ISA-TR88 state subset verified before state machine; threshold is config |
| P6 Over-scoping | Roadmap ordering | Demo vertical slice done before breadth; Out-of-Scope stays out |
| P7 Works-on-my-machine + missing GIF | Distribution | Clean-machine smoke test; GIF exists; DIFOT link proven causal |
| SSE buffering / limits | Dashboard (real-time) | Streaming verified inside docker; single-screen demo within 6-connection limit |
| MQTT reconnect gaps | Ingestion worker | No event gap after mid-demo worker restart |
| Docker startup ordering | Foundation / infra | Cold `docker compose up` on clean checkout, no crash-loop |
| Unbounded table growth | OEE Engine / infra | Overnight demo run stays bounded |
| Timezone / shift-boundary bugs | Simulator + OEE Engine | Event at a shift/day boundary (Asia/Jakarta) lands in the correct shift/day |

---

## Sources

- `docs/00-domain-research.md` (2026-07-22) — adversarially verified: OEE formula & preferred calculation, Six Big Losses 2-2-2 mapping, small-stops→Performance, changeover→Availability, 50–65/85/<45 distribution (Evocon), Vorne data model, §8 four refuted anti-patterns, DIFOT bridge framing. **HIGH**
- oee.com/calculating-oee, oee.com/oee-six-big-losses, vorne.com/products/xl — OEE mechanics, ICT/Performance>100% rule, loss taxonomy (via domain research). **HIGH**
- [Next.js Streaming guide](https://nextjs.org/docs/app/guides/streaming) + [vercel/next.js discussion #48427](https://github.com/vercel/next.js/discussions/48427) + [Fixing slow SSE in Next.js/Vercel](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996) — App Router SSE buffering, raw `Response` vs `NextResponse`, `force-dynamic`, `X-Accel-Buffering: no`. **HIGH**
- [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) + [Chromium bug 275955](https://bugs.chromium.org/p/chromium/issues/detail?id=275955) + [SSE browser limits](https://www.javascriptroom.com/blog/server-sent-events-and-browser-limits/) — 6-connection HTTP/1.1 per-domain limit, HTTP/2 multiplexing fix. **HIGH**
- [MQTT.js #316](https://github.com/mqttjs/MQTT.js/issues/316) + [#1124](https://github.com/mqttjs/MQTT.js/issues/1124) + [HiveMQ persistent sessions](https://www.hivemq.com/blog/mqtt-essentials-part-7-persistent-session-queuing-messages/) — handler-registration-before-connect gotcha, clean vs persistent session, fixed client ID + QoS 1 for missed-message replay. **HIGH**
- [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/) + [depends_on with healthchecks](https://oneuptime.com/blog/post/2026-01-16-docker-compose-depends-on-healthcheck/view) — `service_healthy` condition, `pg_isready`, `start_period`. **HIGH**
- [Time-based partitioning in Postgres](https://oneuptime.com/blog/post/2026-01-26-time-based-partitioning-postgresql/view) + [pg_partman/native partitioning](https://dev.to/mohhddhassan/managing-large-postgresql-tables-with-native-partitioning-and-pgpartman-59ak) — retention over partitioning below ~100GB; drop-partition O(1) vs DELETE. **MEDIUM** (informs "don't over-engineer" call)
- LineLens `PROJECT.md` — scope, DoD (distribution first-class), honesty guardrail, calibration decisions, StockLens demo-gap failure mode. **HIGH**

---
*Pitfalls research for: real-time OEE dashboard + MQTT factory simulator (portfolio-first)*
*Researched: 2026-07-22*
