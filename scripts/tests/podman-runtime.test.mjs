import test from "node:test";
import assert from "node:assert/strict";
import { detectContainerRuntime, buildComposeInvocation } from "../podman-runtime.mjs";

test("detectContainerRuntime falls back to rootless Podman when Docker is unavailable", () => {
  const runtime = detectContainerRuntime({
    env: { UID: "1000" },
    probe: (bin, args) => {
      if (bin === "docker") return { ok: false, stdout: "" };
      if (bin === "podman" && args[0] === "info") {
        return { ok: true, stdout: JSON.stringify({ host: { security: { rootless: true } } }) };
      }
      if (bin === "podman" && args[0] === "compose") {
        return { ok: true, stdout: "podman compose version 1.0.6" };
      }
      return { ok: false, stdout: "" };
    },
  });

  assert.equal(runtime.engine, "podman");
  assert.equal(runtime.rootless, true);
  assert.equal(runtime.envOverrides.PODMAN_USERNS, "keep-id");
  assert.equal(runtime.envOverrides.DOCKER_HOST, "unix:///run/user/1000/podman/podman.sock");

  const invocation = buildComposeInvocation(runtime, ["docker-compose.yml"], ["up", "-d"]);
  assert.equal(invocation.command, "podman");
  assert.deepEqual(invocation.args, ["compose", "-f", "docker-compose.yml", "up", "-d"]);
});
