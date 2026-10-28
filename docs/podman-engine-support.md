# Rootless Podman Container Engine Support (`#63`)

## Overview
- **Implementation Module:** `scripts/podman-runtime.mjs`
- **Automated Test Suite:** `scripts/tests/podman-runtime.test.mjs`

## Runtime Detection & Rootless Configuration
1. **Automatic Engine Detection:** `detectContainerRuntime` probes `docker compose version` and `podman info --format json` / `podman compose version`, respecting `SPACEAPP_CONTAINER_ENGINE=podman|docker` when explicitly set.
2. **Rootless User Namespace Mapping:** When rootless Podman is active, `PODMAN_USERNS=keep-id` and `DOCKER_HOST=unix://${XDG_RUNTIME_DIR}/podman/podman.sock` are automatically injected so bind-mounted host volumes retain non-root UID/GID ownership.
3. **Deterministic Compose Invocation:** `buildComposeInvocation` constructs the exact compose argument vector and environment map for `run-spaceapp`.
