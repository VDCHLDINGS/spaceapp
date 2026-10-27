#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadRepoPinnedDigests } from "./seed-sample-digests.mjs";

export function resolveDevStackConfig(env = process.env, repoRoot = process.cwd()) {
  const stateDir = path.resolve(repoRoot, env.SPACE_DEV_STACK_DIR || ".dev-stack");
  const projectName = env.SPACE_DEV_STACK_PROJECT || "spaceapp-dev-stack";
  const bindHost = "127.0.0.1";
  const apiPort = Number(env.SPACE_DEV_API_PORT || 14910);
  const webPort = Number(env.SPACE_DEV_WEB_PORT || 14911);
  const postgresPort = Number(env.SPACE_DEV_POSTGRES_PORT || 15432);
  const temporalPort = Number(env.SPACE_DEV_TEMPORAL_PORT || 17233);

  if (apiPort === 4910 || webPort === 4911) {
    throw new Error("dev:stack ports must not collide with an installed SpaceApp on 4910/4911");
  }

  return {
    repoRoot,
    stateDir,
    projectName,
    bindHost,
    apiPort,
    webPort,
    postgresPort,
    temporalPort,
    secretsDir: path.join(stateDir, "secrets"),
    runtimeDir: path.join(stateDir, "runtime"),
    cliSocketPath: path.join(stateDir, "runtime", "cli-host.sock"),
    binDir: path.join(stateDir, "bin"),
    opencodePrefixDir: path.join(stateDir, "opencode"),
    composeFilePath: path.join(stateDir, "docker-compose.dev-stack.yml"),
  };
}

function writeSecretFile0600(filePath, value) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${value}\n`, { encoding: "utf8", mode: 0o600 });
  }
  chmodSync(filePath, 0o600);
  return readFileSync(filePath, "utf8").trim();
}

export function ensureDevStackSecrets(config) {
  mkdirSync(config.secretsDir, { recursive: true, mode: 0o700 });
  const postgresPassword = writeSecretFile0600(
    path.join(config.secretsDir, "postgres-password"),
    randomBytes(24).toString("hex")
  );
  const sessionSecret = writeSecretFile0600(
    path.join(config.secretsDir, "session-secret"),
    randomBytes(32).toString("hex")
  );
  const setupToken = writeSecretFile0600(
    path.join(config.secretsDir, "setup-token"),
    `setup_${randomBytes(18).toString("hex")}`
  );
  const databaseUrl = `postgresql://spaceapp:${postgresPassword}@127.0.0.1:${config.postgresPort}/spaceapp`;
  writeSecretFile0600(path.join(config.secretsDir, "database-url"), databaseUrl);

  return {
    setupToken,
    databaseUrlPath: path.join(config.secretsDir, "database-url"),
    sessionSecretPath: path.join(config.secretsDir, "session-secret"),
    setupTokenPath: path.join(config.secretsDir, "setup-token"),
    postgresPasswordPath: path.join(config.secretsDir, "postgres-password"),
  };
}

export function buildDevStackComposeYaml(config, pinned) {
  return `services:
  postgres:
    image: ${pinned.postgresImage}
    restart: unless-stopped
    environment:
      POSTGRES_DB: spaceapp
      POSTGRES_USER: spaceapp
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres-password
    ports:
      - "127.0.0.1:${config.postgresPort}:5432"
    volumes:
      - dev-stack-postgres:/var/lib/postgresql/data
    secrets:
      - postgres-password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U spaceapp -d spaceapp"]
      interval: 5s
      timeout: 3s
      retries: 15

  temporal:
    image: ${pinned.temporalImage}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB: postgres12
      DB_PORT: 5432
      POSTGRES_USER: spaceapp
      POSTGRES_SEEDS: postgres
      DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/docker.yaml
    ports:
      - "127.0.0.1:${config.temporalPort}:7233"
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - export POSTGRES_PWD="$$(cat /run/secrets/postgres-password)"; exec /etc/temporal/entrypoint.sh autosetup
    secrets:
      - postgres-password
    healthcheck:
      test: ["CMD-SHELL", "temporal operator cluster health --address 127.0.0.1:7233 >/dev/null && temporal operator namespace describe --namespace default --address 127.0.0.1:7233 >/dev/null"]
      interval: 5s
      timeout: 5s
      retries: 20

secrets:
  postgres-password:
    file: ${config.secretsDir}/postgres-password

volumes:
  dev-stack-postgres:
`;
}

export function buildDevStackEnvironment(config, secrets) {
  return {
    SPACE_PUBLIC_DISTRIBUTION: "true",
    SPACE_DEV_LOGIN: "false",
    SPACE_RUNTIME_STORE: "postgres",
    SPACE_DATABASE_URL_SOURCE_FILE: secrets.databaseUrlPath,
    SPACE_DATABASE_URL_FILE: secrets.databaseUrlPath,
    SPACE_SESSION_SECRET_FILE: secrets.sessionSecretPath,
    SPACE_SETUP_TOKEN_SOURCE_FILE: secrets.setupTokenPath,
    SPACE_API_HOST: "127.0.0.1",
    SPACE_API_PORT: String(config.apiPort),
    SPACE_WEB_HOST: "127.0.0.1",
    SPACE_WEB_PORT: String(config.webPort),
    SPACE_API_ORIGIN: `http://127.0.0.1:${config.apiPort}`,
    SPACE_TEMPORAL_ADDRESS: `127.0.0.1:${config.temporalPort}`,
    SPACEAPP_WORKFLOWS_ENABLED: "true",
    SPACE_CLI_ENABLED: "true",
    SPACE_CLI_HOST_SOCKET: config.cliSocketPath,
    SPACE_CLI_COMMAND_PATH: config.binDir,
    SPACE_BROWSER_SESSIONS_ENABLED: "false",
  };
}

export function ensureLocalCliWrappers(config, opencodeVersion) {
  mkdirSync(config.binDir, { recursive: true });
  mkdirSync(config.opencodePrefixDir, { recursive: true });
  const wrapperPath = path.join(config.binDir, "opencode-vscode-parity");
  const wrapperScript = `#!/usr/bin/env sh
set -eu
export SPACE_OPENCODE_VERSION="${opencodeVersion}"
exec "${config.opencodePrefixDir}/node_modules/.bin/opencode" "$@"
`;
  writeFileSync(wrapperPath, wrapperScript, { encoding: "utf8", mode: 0o755 });
  chmodSync(wrapperPath, 0o755);
  return { wrapperPath, opencodeVersion };
}

export function formatReadyBanner(config, setupToken) {
  return [
    "============================================================",
    "SpaceApp Dev Stack Ready (from source with hot reload)",
    `Web URL:            http://127.0.0.1:${config.webPort}`,
    `API Origin:         http://127.0.0.1:${config.apiPort}`,
    `Owner Setup Token:  ${setupToken}`,
    "============================================================",
  ].join("\n");
}

export function resetDevStackState(config, runDocker = false) {
  if (runDocker && existsSync(config.composeFilePath)) {
    spawnSync(
      "docker",
      ["compose", "-p", config.projectName, "-f", config.composeFilePath, "down", "-v", "--remove-orphans"],
      { stdio: "inherit" }
    );
  }
  if (existsSync(config.stateDir)) {
    rmSync(config.stateDir, { recursive: true, force: true });
  }
}
