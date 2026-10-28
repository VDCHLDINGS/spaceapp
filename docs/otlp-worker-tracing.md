# End-to-End OTLP Worker & Temporal Tracing (`#61`)

## Overview
- **Implementation Module:** `apps/worker/src/telemetry/otlp-tracing.mjs`
- **Automated Test Suite:** `scripts/tests/otlp-tracing.test.mjs`

## Architecture & Guarantees
1. **W3C Trace Context Propagation:** `parseTraceparent`, `formatTraceparent`, `injectTemporalHeaders`, and `extractTemporalHeaders` propagate `00-<traceId>-<spanId>-<flags>` across API entrypoints, Temporal workflow headers, and activity invocations.
2. **Deterministic Replay Suppression:** `recordSpan` checks `isReplaying` and suppresses duplicate span emission when Temporal replays historical workflow events.
3. **Continue-As-New Span Linking:** Workflows that rotate runs via `Continue-As-New` attach a `ContinueAsNew` span link (`continuationFromSpanId`) preserving end-to-end trace continuity.
4. **Strict Attribute Allowlisting:** `filterAllowedAttributes` strips any non-allowlisted attribute keys (`ALLOWED_SPAN_ATTRIBUTES`) before OTLP export.
5. **Non-Blocking OTLP Collector Export:** `flushSpans` batches recorded spans into standard OTLP/HTTP JSON (`resourceSpans`) and degrades gracefully when the collector is offline.
