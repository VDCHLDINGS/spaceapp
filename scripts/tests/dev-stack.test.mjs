import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildDevStackComposeYaml,
  buildDevStackEnvironment,
  ensureDevStackSecrets,
  ensureLocalCliWrappers,
  formatReadyBanner,
  resetDevStackState,
  resolveDevStackConfig,
} from "../dev-stack.mjs";
import { loadRepoPinnedDigests } from "../seed-sample-digests.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

test("reads digest-pinned PostgreSQL and Temporal images from compose.yml and OPENCODE_VERSION from Dockerfile", () => {
  const pinned = loadRepoPinnedDigests(repoRoot);
  assert.match(pinned.postgresImage, /^pgvector\/pgvector:0\.8\.3-pg17-trixie@sha256:[a-f0-9]{64}$/);
  assert.match(pinned.temporalImage, /^temporalio\/auto-setup:1\.29\.1@sha256:[a-f0-9]{64}$/);
  assert.equal(pinned.opencodeVersion, "2.0.32");
});

test("isolates ports, binds strictly to 127.0.0.1, generates 0600 secrets, and disables SPACE_DEV_LOGIN", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "spaceapp-dev-stack-test-"));
  try {
    const config = resolveDevStackConfig({ SPACE_DEV_STACK_DIR: path.join(tmpDir, ".dev-stack") }, repoRoot);
    assert.notEqual(config.apiPort, 4910);
    assert.notEqual(config.webPort, 4911);
    assert.equal(config.bindHost, "127.0.0.1");

    const secrets = ensureDevStackSecrets(config);
    for (const secretFile of [
      secrets.databaseUrlPath,
      secrets.sessionSecretPath,
      secrets.setupTokenPath,
      secrets.postgresPasswordPath,
    ]) {
      const mode = statSync(secretFile).mode & 0o777;
      assert.equal(mode, 0o600, `Expected 0600 mode on ${secretFile}`);
    }

    const pinned = loadRepoPinnedDigests(repoRoot);
    const composeYaml = buildDevStackComposeYaml(config, pinned);
    assert.ok(composeYaml.includes(pinned.postgresImage));
    assert.ok(composeYaml.includes(pinned.temporalImage));
    assert.ok(composeYaml.includes(`"127.0.0.1:${config.postgresPort}:5432"`));
    assert.ok(composeYaml.includes(`"127.0.0.1:${config.temporalPort}:7233"`));

    const env = buildDevStackEnvironment(config, secrets);
    assert.equal(env.SPACE_DEV_LOGIN, "false");
    assert.equal(env.SPACEAPP_WORKFLOWS_ENABLED, "true");
    assert.equal(env.SPACE_API_HOST, "127.0.0.1");
    assert.equal(env.SPACE_WEB_HOST, "127.0.0.1");

    const wrapper = ensureLocalCliWrappers(config, pinned.opencodeVersion);
    assert.ok(existsSync(wrapper.wrapperPath));

    const banner = formatReadyBanner(config, secrets.setupToken);
    assert.ok(banner.includes(secrets.setupToken));
    assert.ok(!banner.includes("session-secret"));

    resetDevStackState(config, false);
    assert.equal(existsSync(config.stateDir), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
