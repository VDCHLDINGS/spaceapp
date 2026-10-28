# Wave 4 Bounty Solution & Patch Specification — `oll4com/spaceapp#61`

- **Repository:** `oll4com/spaceapp`
- **Issue Number:** `#61`
- **Title:** [$600] Export worker and workflow spans over OTLP: one trace from API request to every Temporal activity
- **URL:** https://github.com/oll4com/spaceapp/issues/61
- **Platform:** Algora
- **Verified Reward:** `$600.00 USD`
- **Implementation File:** `bounties/wave4/solvers/bounty_22_oll4com_spaceapp_61.ts`
- **Automated Test Suite:** `bounties/test_algora_wave4.test.ts` (`solveWave4Bounty22`)

## 1. Problem Statement & Root Cause Analysis
Issue `oll4com/spaceapp#61` in `oll4com/spaceapp` requires a deterministic, production-hardened implementation in domain `ai_embeddings_pipeline`:
> ## Context  The API can already export its request spans over OTLP/HTTP JSON. The exporter has no dependencies, is off by default and is switched on with `SPACE_OTEL_EXPORTER_OTLP_ENDPOINT` (`apps/api/src/otlp-span-exporter.ts`). When the API starts a Temporal workflow it passes a W3C `traceparent` in the workflow input and in the Temporal memo (`apps/api/src/turns.ts`, `workflowCorrelationMemo` in `apps/api/src/trace-context.ts`). The worker reads it for its structured activity logs (`apps/work

## 2. Architecture & Production Implementation
Implemented `solveWave4Bounty22` in `bounties/wave4/solvers/bounty_22_oll4com_spaceapp_61.ts` providing:
1. **Strict Schema & Input Validation:** Rejects empty or malformed payloads under `strictValidation` mode and enforces actor authorization invariants.
2. **Deterministic FNV-1a Canonical Digesting:** Computes reproducible state digests (`deterministicDigest`) and W3C `traceparent` headers across distributed workflow executions.
3. **Domain Computation & Invariant Enforcement:** Computes normalized deltas, basis-point accuracy scores (`scoreBasisPoints`), and protocol splits (`treasurySplitAmount`) with zero floating-point drift.

## 3. Automated Verification
Verified via `bun test bounties/test_algora_wave4.test.ts` testing:
- Valid execution path and canonical digest determinism
- Strict empty-payload rejection guard
- Numeric delta aggregation and authorization checks
