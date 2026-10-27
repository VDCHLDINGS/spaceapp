import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mebibyte = 1024 * 1024;

export const IMAGE_SIZE_BUDGETS_BYTES = Object.freeze({
  core: 850 * mebibyte,
  browser: 1350 * mebibyte,
  cli: 1000 * mebibyte
});

export function formatMebibytes(bytes) {
  return `${(bytes / mebibyte).toFixed(1)} MiB`;
}

export function evaluateImageSizeBudget({ target, sizeBytes, budgets = IMAGE_SIZE_BUDGETS_BYTES }) {
  const budgetBytes = budgets[target];
  if (!Number.isInteger(budgetBytes) || budgetBytes <= 0) {
    throw new Error(`Unknown container size budget target: ${target}`);
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Invalid image size for ${target}: ${sizeBytes}`);
  }

  return {
    ok: sizeBytes <= budgetBytes,
    target,
    sizeBytes,
    budgetBytes,
    summary: `${target}: ${formatMebibytes(sizeBytes)} / ${formatMebibytes(budgetBytes)}`
  };
}

export function inspectDockerImageSize(image, exec = execFileSync) {
  const raw = exec("docker", ["image", "inspect", "--format", "{{.Size}}", image], {
    encoding: "utf8"
  }).trim();
  const sizeBytes = Number.parseInt(raw, 10);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Docker reported an invalid image size for ${image}: ${raw}`);
  }
  return sizeBytes;
}

function parseArgs(argv) {
  let target = "";
  let image = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      target = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--image") {
      image = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!target || !image) {
    throw new Error("Usage: node scripts/container-image-size-budget.mjs --target <core|browser|cli> --image <tag>");
  }
  return { target, image };
}

function main() {
  const { target, image } = parseArgs(process.argv.slice(2));
  const sizeBytes = inspectDockerImageSize(image);
  const result = evaluateImageSizeBudget({ target, sizeBytes });
  console.log(result.summary);
  if (!result.ok) {
    console.error(
      `Container image ${image} exceeds the ${target} size budget (${result.sizeBytes} > ${result.budgetBytes} bytes).`
    );
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
