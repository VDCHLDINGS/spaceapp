import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_SIZE_BUDGETS_BYTES,
  evaluateImageSizeBudget,
  formatMebibytes,
  inspectDockerImageSize
} from "../container-image-size-budget.mjs";

const mebibyte = 1024 * 1024;

test("container image size budgets cover every public target with per-service ceilings", () => {
  assert.deepEqual(IMAGE_SIZE_BUDGETS_BYTES, {
    core: 850 * mebibyte,
    browser: 1350 * mebibyte,
    cli: 1000 * mebibyte
  });
});

test("evaluateImageSizeBudget accepts images at or under budget and rejects regressions", () => {
  const passing = evaluateImageSizeBudget({
    target: "core",
    sizeBytes: IMAGE_SIZE_BUDGETS_BYTES.core
  });
  assert.equal(passing.ok, true);
  assert.equal(passing.summary, "core: 850.0 MiB / 850.0 MiB");

  const failing = evaluateImageSizeBudget({
    target: "cli",
    sizeBytes: IMAGE_SIZE_BUDGETS_BYTES.cli + mebibyte
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.summary, "cli: 1001.0 MiB / 1000.0 MiB");

  const browserPassing = evaluateImageSizeBudget({
    target: "browser",
    sizeBytes: IMAGE_SIZE_BUDGETS_BYTES.browser
  });
  assert.equal(browserPassing.ok, true);
  assert.equal(browserPassing.summary, "browser: 1350.0 MiB / 1350.0 MiB");
});

test("evaluateImageSizeBudget rejects unknown targets and invalid byte counts", () => {
  assert.throws(
    () => evaluateImageSizeBudget({ target: "unknown", sizeBytes: 1024 }),
    /Unknown container size budget target: unknown/
  );
  assert.throws(
    () => evaluateImageSizeBudget({ target: "core", sizeBytes: 0 }),
    /Invalid image size for core: 0/
  );
});

test("inspectDockerImageSize reads the integer byte count from docker image inspect", () => {
  const calls = [];
  const size = inspectDockerImageSize("spaceapp-ci:core-amd64", (command, args) => {
    calls.push([command, args]);
    return "812345678\n";
  });

  assert.equal(size, 812345678);
  assert.deepEqual(calls, [
    ["docker", ["image", "inspect", "--format", "{{.Size}}", "spaceapp-ci:core-amd64"]]
  ]);
  assert.equal(formatMebibytes(104857600), "100.0 MiB");
});
