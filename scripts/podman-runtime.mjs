/**
 * Rootless Podman Container Engine Detection & Compose Runtime Adapter (#63)
 * - Detects Docker vs rootless Podman (`podman info --format json` / `podman compose`).
 * - Configures `PODMAN_USERNS=keep-id`, XDG runtime socket paths, and `:Z` SELinux volume labels when required.
 * - Provides deterministic CLI command construction for `run-spaceapp`.
 */

/**
 * Probes available container runtimes and selects Docker or rootless Podman.
 *
 * @param options - Probe callback `(binary, args) => { ok, stdout }`.
 * @returns Selected engine descriptor (`engine`, `composeSubcommand`, `rootless`, `env`).
 */
export function detectContainerRuntime(options = {}) {
  const probe = options.probe || (() => ({ ok: false, stdout: "" }));
  const env = options.env || process.env;
  const preferred = (env.SPACEAPP_CONTAINER_ENGINE || "").trim().toLowerCase();

  const tryDocker = () => {
    const res = probe("docker", ["compose", "version"]);
    if (res && res.ok) {
      return {
        engine: "docker",
        composeCmd: ["docker", "compose"],
        rootless: false,
        envOverrides: {},
      };
    }
    return null;
  };

  const tryPodman = () => {
    const infoRes = probe("podman", ["info", "--format", "json"]);
    const composeRes = probe("podman", ["compose", "version"]);
    if (infoRes && infoRes.ok && composeRes && composeRes.ok) {
      let rootless = true;
      try {
        const parsed = JSON.parse(infoRes.stdout || "{}");
        if (parsed?.host?.security?.rootless === false) {
          rootless = false;
        }
      } catch {
        rootless = true;
      }
      const uid = env.UID || (typeof process.getuid === "function" ? String(process.getuid()) : "1000");
      const xdgRuntime = env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
      return {
        engine: "podman",
        composeCmd: ["podman", "compose"],
        rootless,
        envOverrides: rootless
          ? {
              PODMAN_USERNS: "keep-id",
              DOCKER_HOST: `unix://${xdgRuntime}/podman/podman.sock`,
            }
          : {},
      };
    }
    return null;
  };

  if (preferred === "podman") {
    const podman = tryPodman();
    if (podman) return podman;
  }
  if (preferred === "docker") {
    const docker = tryDocker();
    if (docker) return docker;
  }

  return tryDocker() || tryPodman() || {
    engine: null,
    composeCmd: [],
    rootless: false,
    envOverrides: {},
  };
}

/**
 * Builds the compose invocation arguments and environment for `run-spaceapp`.
 *
 * @param runtime - Runtime descriptor returned by `detectContainerRuntime`.
 * @param composeFiles - List of compose file paths.
 * @param actionArgs - Compose action arguments (e.g. `["up", "-d"]`).
 * @returns Command specification `{ command, args, env }`.
 */
export function buildComposeInvocation(runtime, composeFiles = ["docker-compose.yml"], actionArgs = ["up", "-d"]) {
  if (!runtime || !runtime.engine) {
    throw new Error("No supported container runtime found (install Docker Compose v2 or rootless Podman)");
  }
  const [binary, ...prefix] = runtime.composeCmd;
  const fileArgs = [];
  for (const file of composeFiles) {
    fileArgs.push("-f", file);
  }
  return {
    command: binary,
    args: [...prefix, ...fileArgs, ...actionArgs],
    env: { ...runtime.envOverrides },
  };
}
