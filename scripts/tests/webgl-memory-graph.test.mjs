import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  DEFAULT_MEMORY_CAMERA,
  layoutMemoryNetwork3D,
  memory3DVolumeRatio,
  projectMemoryPoint,
  streamLayoutMemoryNetwork3D,
} from "../../apps/web/src/graph/memory-graph-worker.mjs";
import {
  SpatialPickingIndex,
  WebGLMemoryGraphController,
  generateSyntheticMemoryGraph,
  selectLodLabels,
  selectOverviewGraph,
} from "../../apps/web/src/graph/webgl-memory-graph.mjs";

test("streamLayoutMemoryNetwork3D streams deterministic 3D batches with true 3D volume", () => {
  const { nodes, edges } = generateSyntheticMemoryGraph(120, 300);
  const batches = [...streamLayoutMemoryNetwork3D(nodes, edges, { steps: 24, batchSteps: 6 })];
  assert.equal(batches.length, 4);
  assert.equal(batches.at(-1).done, true);

  const mapA = layoutMemoryNetwork3D(nodes, edges, { steps: 24, batchSteps: 6 });
  const mapB = layoutMemoryNetwork3D(nodes, edges, { steps: 24, batchSteps: 6 });
  assert.equal(mapA.size, 120);
  for (const [id, ptA] of mapA.entries()) {
    const ptB = mapB.get(id);
    assert.deepEqual(ptA, ptB);
  }
  const volume = memory3DVolumeRatio([...mapA.values()]);
  assert.ok(volume > 0.1, `Expected 3D layout volume > 0.1, got ${volume}`);
});

test("SpatialPickingIndex picks hovered/clicked node in under 4 ms at 50,000 nodes", () => {
  const { nodes } = generateSyntheticMemoryGraph(50000, 0);
  const projected = nodes.map((node, i) => ({
    id: node.id,
    type: node.type,
    label: node.label,
    x: (i % 250) * 16,
    y: Math.floor(i / 250) * 16,
    z: (i % 17) * 2,
    perspective: 1,
    radius: 3,
  }));

  const index = new SpatialPickingIndex(16);
  index.build(projected);

  const target = projected[25123];
  const start = performance.now();
  const pickedId = index.pick(target.x + 1, target.y - 1);
  const elapsedMs = performance.now() - start;

  assert.equal(pickedId, target.id);
  assert.ok(elapsedMs <= 4.0, `Expected 50k-node pick <= 4 ms, took ${elapsedMs.toFixed(3)} ms`);
});

test("selectLodLabels enforces bounded label count, collision avoidance, and core/source priority at 50,000 nodes", () => {
  const { nodes } = generateSyntheticMemoryGraph(50000, 0);
  const projected = nodes.map((node, i) => ({
    id: node.id,
    type: node.type,
    label: node.label,
    x: (i % 200) * 12,
    y: Math.floor(i / 200) * 18,
    z: i * 0.01,
    perspective: 1,
    radius: 4,
  }));

  const labels = selectLodLabels(projected, { showTitles: true, maxLabels: 48 });
  assert.ok(labels.length <= 48 && labels.length > 0);
  assert.equal(labels[0].text, "space_memory.md");

  const hidden = selectLodLabels(projected, { showTitles: false, selectedNodeId: "mem-000500" });
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].id, "mem-000500");
});

test("selectOverviewGraph supports 50,000 nodes and 150,000 edges while preserving 2,000 default", () => {
  const { nodes, edges } = generateSyntheticMemoryGraph(50000, 150000);
  const defaultOverview = selectOverviewGraph(nodes, edges);
  assert.equal(defaultOverview.nodes.length, 2000);
  assert.equal(defaultOverview.truncated, true);

  const fullOverview = selectOverviewGraph(nodes, edges, 50000);
  assert.equal(fullOverview.nodes.length, 50000);
  assert.equal(fullOverview.edges.length, 150000);
  assert.equal(fullOverview.truncated, false);
});

test("WebGLMemoryGraphController falls back to Canvas 2D (2,000-node cap) on context loss and restores WebGL2", () => {
  const fakeGl = { DEPTH_TEST: 0x0b71, enable() {} };
  const fakeCanvas = {
    getContext(type) {
      return type === "webgl2" ? fakeGl : {};
    },
  };

  const { nodes, edges } = generateSyntheticMemoryGraph(5000, 10000);
  const coords = new Map();
  const controller = new WebGLMemoryGraphController(fakeCanvas);
  assert.equal(controller.mode, "webgl2");

  const webglFrame = controller.prepareFrame(nodes, edges, coords);
  assert.equal(webglFrame.mode, "webgl2");
  assert.equal(webglFrame.renderedNodeCount, 5000);

  controller.handleContextLost({ preventDefault() {} });
  assert.equal(controller.mode, "canvas2d");
  const fallbackFrame = controller.prepareFrame(nodes, edges, coords);
  assert.equal(fallbackFrame.mode, "canvas2d");
  assert.equal(fallbackFrame.renderedNodeCount, 2000);

  controller.handleContextRestored();
  assert.equal(controller.mode, "webgl2");
});
