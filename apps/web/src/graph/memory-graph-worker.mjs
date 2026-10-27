export const DEFAULT_MEMORY_CAMERA = { yaw: 0.3, pitch: -0.15, zoom: 1 };
export const DEFAULT_OVERVIEW_NODE_LIMIT = 2000;
export const MAX_OVERVIEW_NODE_LIMIT = 50000;
export const MAX_OVERVIEW_EDGE_LIMIT = 150000;

export function isMemoryCoreLabel(label = "") {
  const normalized = String(label).toLowerCase();
  return normalized.endsWith("space_memory.md") || normalized.endsWith("agents.md");
}

export function unitHash(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

export function projectMemoryPoint(point, camera, scale, width, height) {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);

  const x = point.x * cosYaw + point.z * sinYaw;
  const depth = -point.x * sinYaw + point.z * cosYaw;
  const y = point.y * cosPitch - depth * sinPitch;
  const z = point.y * sinPitch + depth * cosPitch;
  const perspective = 650 / Math.max(120, 650 + z * scale);
  return {
    x: width / 2 + x * scale * camera.zoom * perspective,
    y: height / 2 - y * scale * camera.zoom * perspective,
    z,
    perspective,
  };
}

export function memory3DVolumeRatio(points) {
  if (points.length < 4) return 0;
  let cx = 0, cy = 0, cz = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    cx += points[i].x;
    cy += points[i].y;
    cz += points[i].z;
  }
  cx /= n; cy /= n; cz /= n;
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i].x - cx;
    const y = points[i].y - cy;
    const z = points[i].z - cz;
    xx += x * x; yy += y * y; zz += z * z;
    xy += x * y; xz += x * z; yz += y * z;
  }
  const determinant = xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
  return Math.max(0, determinant / Math.max(1e-12, ((xx + yy + zz) / 3) ** 3));
}

/**
 * Incremental deterministic 3D force layout generator using flat typed arrays
 * so 50,000 nodes stream progressive frames without main-thread long tasks.
 */
export function* streamLayoutMemoryNetwork3D(nodes, edges, options = {}) {
  const totalSteps = options.steps ?? (nodes.length > 10000 ? 36 : 180);
  const batchSteps = options.batchSteps ?? 6;
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const count = ordered.length;
  const index = new Map(ordered.map((node, i) => [node.id, i]));
  const root = ordered.findIndex((node) => node.type === "SOURCE" && isMemoryCoreLabel(node.label));

  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const isSource = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const id = ordered[i].id;
    px[i] = (unitHash(`${id}:x`) - 0.5) * 260;
    py[i] = (unitHash(`${id}:y`) - 0.5) * 260;
    pz[i] = (unitHash(`${id}:z`) - 0.5) * 260;
    isSource[i] = ordered[i].type === "SOURCE" ? 1 : 0;
  }
  if (root >= 0) {
    px[root] = 0; py[root] = 0; pz[root] = 0;
  }

  for (const edge of edges) {
    if (edge.type !== "CONTAINS") continue;
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined || !isSource[a] || ordered[b].type !== "MEMORY") continue;
    const id = ordered[b].id;
    px[b] = px[a] + (unitHash(`${id}:dx`) - 0.5) * 70;
    py[b] = py[a] + (unitHash(`${id}:dy`) - 0.5) * 70;
    pz[b] = pz[a] + (unitHash(`${id}:dz`) - 0.5) * 70;
  }

  const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  const linkA = [];
  const linkB = [];
  const linkLen = [];
  const linkStr = [];
  for (const edge of sortedEdges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    const fileLink = isSource[a] && isSource[b];
    linkA.push(a);
    linkB.push(b);
    linkLen.push(fileLink ? 110 : edge.type === "CONTAINS" ? 34 : 55);
    linkStr.push(fileLink ? 0.035 : edge.type === "CONTAINS" ? 0.028 : 0.004);
  }

  const fx = new Float32Array(count);
  const fy = new Float32Array(count);
  const fz = new Float32Array(count);
  const TABLE_SIZE = 65536;
  const head = new Int32Array(TABLE_SIZE);
  const next = new Int32Array(count);

  const cellHash = (gx, gy, gz) =>
    (((Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ Math.imul(gz, 83492791)) >>> 0) & (TABLE_SIZE - 1));

  for (let step = 0; step < totalSteps; step++) {
    fx.fill(0); fy.fill(0); fz.fill(0);
    head.fill(-1);
    for (let i = 0; i < count; i++) {
      const h = cellHash(Math.floor(px[i] / 32), Math.floor(py[i] / 32), Math.floor(pz[i] / 32));
      next[i] = head[h];
      head[h] = i;
    }

    for (let i = 0; i < count; i++) {
      const gx = Math.floor(px[i] / 32);
      const gy = Math.floor(py[i] / 32);
      const gz = Math.floor(pz[i] / 32);
      const h = cellHash(gx, gy, gz);
      let j = head[h];
      let comparisons = 0;
      while (j !== -1 && comparisons < 24) {
        if (j > i) {
          const dx = px[i] - px[j];
          const dy = py[i] - py[j];
          const dz = pz[i] - pz[j];
          const distSq = Math.max(1, dx * dx + dy * dy + dz * dz);
          const strength = (isSource[i] || isSource[j] ? 28 : 12) / distSq;
          fx[i] += dx * strength; fy[i] += dy * strength; fz[i] += dz * strength;
          fx[j] -= dx * strength; fy[j] -= dy * strength; fz[j] -= dz * strength;
          comparisons++;
        }
        j = next[j];
      }
    }

    for (let k = 0; k < linkA.length; k++) {
      const a = linkA[k], b = linkB[k];
      const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const dist = Math.max(0.01, Math.hypot(dx, dy, dz));
      const spring = ((dist - linkLen[k]) * linkStr[k]) / dist;
      fx[a] += dx * spring; fy[a] += dy * spring; fz[a] += dz * spring;
      fx[b] -= dx * spring; fy[b] -= dy * spring; fz[b] -= dz * spring;
    }

    const cooling = 1 - step / (totalSteps + 50);
    for (let i = 0; i < count; i++) {
      if (i === root) continue;
      const dx = fx[i] - px[i] * 0.0005;
      const dy = fy[i] - py[i] * 0.0005;
      const dz = fz[i] - pz[i] * 0.0005;
      const stepScale = Math.min(1, 4 / Math.max(0.01, Math.hypot(dx, dy, dz))) * cooling;
      px[i] += dx * stepScale;
      py[i] += dy * stepScale;
      pz[i] += dz * stepScale;
    }

    if ((step + 1) % batchSteps === 0 || step === totalSteps - 1) {
      yield {
        step: step + 1,
        totalSteps,
        done: step === totalSteps - 1,
        ids: ordered.map((n) => n.id),
        positions: new Float32Array(count * 3).map((_, idx) => {
          const nodeIdx = Math.floor(idx / 3);
          const axis = idx % 3;
          return axis === 0 ? px[nodeIdx] : axis === 1 ? py[nodeIdx] : pz[nodeIdx];
        }),
      };
    }
  }
}

export function layoutMemoryNetwork3D(nodes, edges, options = {}) {
  let finalBatch = null;
  for (const batch of streamLayoutMemoryNetwork3D(nodes, edges, options)) {
    finalBatch = batch;
  }
  const result = new Map();
  if (!finalBatch) return result;
  for (let i = 0; i < finalBatch.ids.length; i++) {
    result.set(finalBatch.ids[i], {
      x: finalBatch.positions[i * 3],
      y: finalBatch.positions[i * 3 + 1],
      z: finalBatch.positions[i * 3 + 2],
    });
  }
  return result;
}
