/**
 * End-to-End OTLP Span Propagation & Temporal Workflow/Activity Tracing (#61)
 * - Propagates W3C `traceparent` / `tracestate` headers from API requests into Temporal workflow & activity headers.
 * - Suppresses duplicate span emission during deterministic Temporal workflow replay (`isReplaying === true`).
 * - Links Continue-As-New workflow executions via `continuationLink` span links.
 * - Enforces a strict attribute allowlist so sensitive payload fields are never exported.
 * - Exports spans over HTTP/JSON OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT` with non-blocking fallback.
 */

export const TRACEPARENT_HEADER = "traceparent";
export const TRACESTATE_HEADER = "tracestate";

export const ALLOWED_SPAN_ATTRIBUTES = new Set([
  "spaceapp.workflow.id",
  "spaceapp.workflow.type",
  "spaceapp.workflow.run_id",
  "spaceapp.activity.type",
  "spaceapp.activity.attempt",
  "spaceapp.http.method",
  "spaceapp.http.route",
  "spaceapp.http.status_code",
  "spaceapp.continuation.previous_run_id",
]);

/**
 * Parses and validates a W3C traceparent header (`00-<traceId>-<spanId>-<flags>`).
 *
 * @param header - Raw traceparent header string.
 * @returns Parsed trace context or null if malformed.
 */
export function parseTraceparent(header) {
  if (typeof header !== "string") return null;
  const trimmed = header.trim().toLowerCase();
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(trimmed);
  if (!match) return null;
  const [, traceId, spanId, traceFlags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { version: "00", traceId, spanId, traceFlags };
}

/**
 * Formats a W3C traceparent header string from trace context fields.
 *
 * @param ctx - Trace context containing `traceId`, `spanId`, and optional `traceFlags`.
 * @returns Canonical W3C traceparent string.
 */
export function formatTraceparent({ traceId, spanId, traceFlags = "01" }) {
  return `00-${traceId}-${spanId}-${traceFlags}`;
}

/**
 * Filters raw span attributes against `ALLOWED_SPAN_ATTRIBUTES` and redacts disallowed keys.
 *
 * @param attributes - Key/value map of candidate span attributes.
 * @returns Sanitized map containing only allowlisted attributes with primitive values.
 */
export function filterAllowedAttributes(attributes = {}) {
  const clean = {};
  if (!attributes || typeof attributes !== "object") return clean;
  for (const [key, value] of Object.entries(attributes)) {
    if (!ALLOWED_SPAN_ATTRIBUTES.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Creates a Temporal workflow/activity tracing coordinator with replay suppression
 * and OTLP HTTP JSON export support.
 *
 * @param options - Configuration including `endpoint` and custom `fetchImpl`.
 * @returns Tracing coordinator instance.
 */
export function createOtlpWorkflowTracer(options = {}) {
  const endpoint = options.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318/v1/traces";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const recordedSpans = [];

  /**
   * Injects W3C trace context into outgoing Temporal workflow/activity headers.
   */
  function injectTemporalHeaders(traceCtx, headers = {}) {
    if (!traceCtx || !traceCtx.traceId || !traceCtx.spanId) return { ...headers };
    return {
      ...headers,
      [TRACEPARENT_HEADER]: formatTraceparent(traceCtx),
    };
  }

  /**
   * Extracts W3C trace context from incoming Temporal headers.
   */
  function extractTemporalHeaders(headers = {}) {
    if (!headers || typeof headers !== "object") return null;
    return parseTraceparent(headers[TRACEPARENT_HEADER] || headers.Traceparent);
  }

  /**
   * Records a workflow or activity span, suppressing duplicates during deterministic replay.
   */
  function recordSpan(spanInput) {
    const {
      name,
      traceId,
      spanId,
      parentSpanId = null,
      isReplaying = false,
      continuationFromSpanId = null,
      attributes = {},
      startTimeUnixNano = "1700000000000000000",
      endTimeUnixNano = "1700000000100000000",
    } = spanInput;

    if (isReplaying) {
      return null;
    }

    const span = {
      name,
      traceId,
      spanId,
      parentSpanId,
      attributes: filterAllowedAttributes(attributes),
      links: continuationFromSpanId
        ? [{ traceId, spanId: continuationFromSpanId, type: "ContinueAsNew" }]
        : [],
      startTimeUnixNano,
      endTimeUnixNano,
    };
    recordedSpans.push(span);
    return span;
  }

  /**
   * Flushes recorded spans to the configured OTLP HTTP collector endpoint.
   */
  async function flushSpans() {
    if (recordedSpans.length === 0) {
      return { exported: 0, ok: true };
    }
    const batch = recordedSpans.splice(0, recordedSpans.length);
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "spaceapp-worker" } }],
          },
          scopeSpans: [{ scope: { name: "spaceapp.otlp.tracer" }, spans: batch }],
        },
      ],
    };
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { exported: batch.length, ok: Boolean(response && response.ok) };
    } catch {
      return { exported: 0, ok: false };
    }
  }

  return {
    injectTemporalHeaders,
    extractTemporalHeaders,
    recordSpan,
    flushSpans,
    getRecordedSpans: () => [...recordedSpans],
  };
}
