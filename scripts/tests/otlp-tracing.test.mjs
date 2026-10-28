import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTraceparent,
  formatTraceparent,
  filterAllowedAttributes,
  createOtlpWorkflowTracer,
} from "../../apps/worker/src/telemetry/otlp-tracing.mjs";

test("parseTraceparent validates canonical W3C traceparent headers and rejects invalid ids", () => {
  const valid = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.deepEqual(valid, {
    version: "00",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    traceFlags: "01",
  });
  assert.equal(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"), null);
  assert.equal(parseTraceparent("invalid"), null);
});

test("createOtlpWorkflowTracer suppresses replay spans, filters attributes, and exports to fake collector", async () => {
  const collectedPayloads = [];
  const tracer = createOtlpWorkflowTracer({
    endpoint: "http://127.0.0.1:4318/v1/traces",
    fetchImpl: async (url, init) => {
      collectedPayloads.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
  });

  const headers = tracer.injectTemporalHeaders({
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
  });
  const extracted = tracer.extractTemporalHeaders(headers);
  assert.equal(extracted.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");

  // Replayed workflow step must be suppressed
  const replaySpan = tracer.recordSpan({
    name: "WorkflowExecute",
    traceId: extracted.traceId,
    spanId: "1111111111111111",
    isReplaying: true,
  });
  assert.equal(replaySpan, null);

  // Live workflow step with continuation link and secret attribute filtering
  const liveSpan = tracer.recordSpan({
    name: "WorkflowExecute",
    traceId: extracted.traceId,
    spanId: "2222222222222222",
    parentSpanId: extracted.spanId,
    continuationFromSpanId: "00f067aa0ba902b7",
    attributes: {
      "spaceapp.workflow.id": "wf-123",
      "spaceapp.activity.attempt": 1,
      "secret.api.key": "must-not-leak",
    },
  });
  assert.equal(liveSpan.attributes["spaceapp.workflow.id"], "wf-123");
  assert.equal("secret.api.key" in liveSpan.attributes, false);
  assert.equal(liveSpan.links.length, 1);

  const flushResult = await tracer.flushSpans();
  assert.equal(flushResult.ok, true);
  assert.equal(flushResult.exported, 1);
  assert.equal(collectedPayloads.length, 1);
});
