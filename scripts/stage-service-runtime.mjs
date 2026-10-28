import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy a relative path from the build workspace into a staged target root if it exists.
 *
 * @param {string} root - Destination target directory (e.g. `/out/core`).
 * @param {string} rel - Workspace-relative path to copy.
 * @param {string} [sourceRoot="/app"] - Source build root directory.
 * @returns {void}
 */
export function copyPath(root, rel, sourceRoot = "/app") {
  const src = join(sourceRoot, rel);
  if (!existsSync(src)) return;
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
}

/**
 * Write a JSON value to disk with stable 2-space indentation and a trailing newline.
 *
 * @param {string} filePath - Destination JSON file path.
 * @param {unknown} value - Serializable JSON payload.
 * @returns {void}
 */
export function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export const CORE_WORKSPACES = Object.freeze([
  "apps/api",
  "apps/worker",
  "apps/web",
  "packages/browser-host",
  "packages/cli-host",
  "packages/codex-app-server",
  "packages/contracts",
  "packages/db",
  "packages/gateway",
  "packages/memory-graph",
  "packages/opencode-control",
  "packages/runtime",
  "packages/streaming"
]);

export const BROWSER_WORKSPACES = Object.freeze([
  "apps/api",
  "packages/browser-host",
  "packages/contracts",
  "packages/db",
  "packages/memory-graph",
  "packages/runtime"
]);

export const CLI_WORKSPACES = Object.freeze([
  "packages/cli-host"
]);

export const CORE_EXTRA_PATHS = Object.freeze([
  "apps/web/server.mjs",
  "apps/web/public/brand",
  "evals",
  "packages/db/migrations",
  "deploy/docker/core-entrypoint.sh",
  "deploy/docker/core-supervisor.mjs",
  "deploy/docker/memory-names.sh",
  "scripts/portable-backup.mjs",
  "scripts/portable-restore.mjs",
  "scripts/reset-owner-password.mjs",
  "scripts/rotate-owner-setup-token.mjs",
  "scripts/cli-render-fixture.mjs",
  "scripts/space-design-render.mjs",
  "scripts/space-video-engine.mjs",
  "scripts/space-video-tools-setup.mjs"
]);

export const BROWSER_EXTRA_PATHS = Object.freeze([
  "deploy/docker/browser-entrypoint.sh"
]);

export const CLI_EXTRA_PATHS = Object.freeze([
  "agent-skills",
  "deploy/docker/cli-entrypoint.sh",
  "deploy/docker/credential-agent.mjs",
  "deploy/docker/opencode-first-run.mjs",
  "deploy/docker/provider-install.mjs",
  "deploy/docker/public-cli-wrapper.sh"
]);

/**
 * Stage an isolated production runtime tree for a container target (`core`, `browser`, or `cli`).
 *
 * @param {object} options - Target staging configuration.
 * @param {string} options.target - Target service name (`core`, `browser`, or `cli`).
 * @param {readonly string[]} options.workspaces - Workspace directories required by the target.
 * @param {(outRoot: string, rootPkg: Record<string, any>) => void} options.customizeManifests - Callback to prune target manifests.
 * @param {readonly string[]} options.extraPaths - Non-dist runtime paths required at startup.
 * @param {Record<string, any>} options.rootPkg - Parsed root `package.json`.
 * @param {Record<string, any>} options.lockPkg - Parsed root `package-lock.json`.
 * @param {string} [options.sourceRoot="/app"] - Source build root directory.
 * @param {string} [options.outBase="/out"] - Output parent directory for staged trees.
 * @returns {void}
 */
export function stageTarget({
  target,
  workspaces,
  customizeManifests,
  extraPaths,
  rootPkg,
  lockPkg,
  sourceRoot = "/app",
  outBase = "/out"
}) {
  const outRoot = join(outBase, target);
  const compiledNodePty = join(sourceRoot, "node_modules/node-pty");
  mkdirSync(outRoot, { recursive: true });
  const pkg = structuredClone(rootPkg);
  delete pkg.devDependencies;
  const lock = structuredClone(lockPkg);
  writeJson(join(outRoot, "package.json"), pkg);
  writeJson(join(outRoot, "package-lock.json"), lock);
  for (const ws of workspaces) {
    const wsPkg = JSON.parse(readFileSync(join(sourceRoot, ws, "package.json"), "utf8"));
    delete wsPkg.devDependencies;
    writeJson(join(outRoot, ws, "package.json"), wsPkg);
  }
  customizeManifests(outRoot, rootPkg);
  const wsArgs = workspaces.flatMap((ws) => {
    const wsPkg = JSON.parse(readFileSync(join(outRoot, ws, "package.json"), "utf8"));
    return ["--workspace", wsPkg.name];
  });
  execFileSync(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", ...wsArgs],
    { cwd: outRoot, stdio: "inherit" }
  );
  if (existsSync(join(outRoot, "node_modules/node-pty")) && existsSync(compiledNodePty)) {
    rmSync(join(outRoot, "node_modules/node-pty"), { recursive: true, force: true });
    cpSync(compiledNodePty, join(outRoot, "node_modules/node-pty"), { recursive: true });
  }
  execFileSync(
    "find",
    [
      join(outRoot, "node_modules"),
      "-type",
      "f",
      "(",
      "-name",
      "*.js.map",
      "-o",
      "-name",
      "*.mjs.map",
      "-o",
      "-name",
      "*.cjs.map",
      "-o",
      "-name",
      "*.css.map",
      "-o",
      "-name",
      "*.d.ts.map",
      ")",
      "-delete"
    ],
    { stdio: "inherit" }
  );
  rmSync(join(outRoot, "package-lock.json"), { force: true });
  for (const ws of workspaces) {
    copyPath(outRoot, join(ws, "dist"), sourceRoot);
  }
  for (const rel of extraPaths) {
    copyPath(outRoot, rel, sourceRoot);
  }
}

/**
 * Stage all three service runtime trees (`core`, `browser`, and `cli`) under `/out`.
 *
 * @param {string} [sourceRoot="/app"] - Source build root directory.
 * @param {string} [outBase="/out"] - Output parent directory for staged trees.
 * @returns {void}
 */
export function stageAllServiceRuntimes(sourceRoot = "/app", outBase = "/out") {
  const rootPkg = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
  const lockPkg = JSON.parse(readFileSync(join(sourceRoot, "package-lock.json"), "utf8"));

  stageTarget({
    target: "core",
    workspaces: CORE_WORKSPACES,
    customizeManifests: (outRoot) => {
      const pkg = JSON.parse(readFileSync(join(outRoot, "package.json"), "utf8"));
      delete pkg.dependencies.react;
      delete pkg.dependencies["react-dom"];
      writeJson(join(outRoot, "package.json"), pkg);
      const webPkg = JSON.parse(readFileSync(join(outRoot, "apps/web/package.json"), "utf8"));
      webPkg.dependencies = {};
      writeJson(join(outRoot, "apps/web/package.json"), webPkg);
    },
    extraPaths: CORE_EXTRA_PATHS,
    rootPkg,
    lockPkg,
    sourceRoot,
    outBase
  });

  stageTarget({
    target: "browser",
    workspaces: BROWSER_WORKSPACES,
    customizeManifests: (outRoot, rootManifest) => {
      const pkg = JSON.parse(readFileSync(join(outRoot, "package.json"), "utf8"));
      pkg.dependencies = { ws: rootManifest.dependencies.ws };
      writeJson(join(outRoot, "package.json"), pkg);
      const apiPkg = JSON.parse(readFileSync(join(outRoot, "apps/api/package.json"), "utf8"));
      apiPkg.dependencies = {
        "@space/browser-host": apiPkg.dependencies["@space/browser-host"],
        "@space/contracts": apiPkg.dependencies["@space/contracts"],
        "@space/db": apiPkg.dependencies["@space/db"],
        "@space/memory-graph": apiPkg.dependencies["@space/memory-graph"],
        "@space/runtime": apiPkg.dependencies["@space/runtime"],
        "@t3-oss/env-core": apiPkg.dependencies["@t3-oss/env-core"],
        nanoid: apiPkg.dependencies.nanoid,
        zod: apiPkg.dependencies.zod
      };
      writeJson(join(outRoot, "apps/api/package.json"), apiPkg);
    },
    extraPaths: BROWSER_EXTRA_PATHS,
    rootPkg,
    lockPkg,
    sourceRoot,
    outBase
  });

  stageTarget({
    target: "cli",
    workspaces: CLI_WORKSPACES,
    customizeManifests: (outRoot) => {
      const pkg = JSON.parse(readFileSync(join(outRoot, "package.json"), "utf8"));
      pkg.dependencies = {};
      writeJson(join(outRoot, "package.json"), pkg);
    },
    extraPaths: CLI_EXTRA_PATHS,
    rootPkg,
    lockPkg,
    sourceRoot,
    outBase
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageAllServiceRuntimes();
}
