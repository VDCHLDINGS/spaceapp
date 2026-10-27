# syntax=docker/dockerfile:1.7

FROM node:22.23.0-trixie-slim@sha256:cfd8f2a5bc50526aee08e88970979f92722828e7dcc6d8983607fb8bff4bdb82 AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential liblzma5 python3 pkg-config \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci --no-audit --no-fund \
    && npm run build \
    && find node_modules -type f \( -name '*.js.map' -o -name '*.mjs.map' -o -name '*.cjs.map' -o -name '*.css.map' \) -delete \
    && node --input-type=module -e '
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const copyPath = (root, rel) => {
  const src = join("/app", rel);
  if (!existsSync(src)) return;
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
};

const writeJson = (filePath, value) => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const rootPkg = JSON.parse(readFileSync("/app/package.json", "utf8"));
const lockPkg = JSON.parse(readFileSync("/app/package-lock.json", "utf8"));
const compiledNodePty = "/app/node_modules/node-pty";

const coreWorkspaces = [
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
];

const browserWorkspaces = [
  "apps/api",
  "packages/browser-host",
  "packages/contracts",
  "packages/db",
  "packages/memory-graph",
  "packages/runtime"
];

const cliWorkspaces = [
  "packages/cli-host"
];

const stageTarget = (target, workspaces, customizeManifests, extraPaths) => {
  const outRoot = join("/out", target);
  mkdirSync(outRoot, { recursive: true });
  const pkg = structuredClone(rootPkg);
  delete pkg.devDependencies;
  const lock = structuredClone(lockPkg);
  writeJson(join(outRoot, "package.json"), pkg);
  writeJson(join(outRoot, "package-lock.json"), lock);
  for (const ws of workspaces) {
    const wsPkg = JSON.parse(readFileSync(join("/app", ws, "package.json"), "utf8"));
    delete wsPkg.devDependencies;
    writeJson(join(outRoot, ws, "package.json"), wsPkg);
  }
  customizeManifests(outRoot);
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
    [join(outRoot, "node_modules"), "-type", "f", "(", "-name", "*.js.map", "-o", "-name", "*.mjs.map", "-o", "-name", "*.cjs.map", "-o", "-name", "*.css.map", "-o", "-name", "*.d.ts.map", ")", "-delete"],
    { stdio: "inherit" }
  );
  rmSync(join(outRoot, "package-lock.json"), { force: true });
  for (const ws of workspaces) {
    copyPath(outRoot, join(ws, "dist"));
  }
  for (const rel of extraPaths) {
    copyPath(outRoot, rel);
  }
};

stageTarget(
  "core",
  coreWorkspaces,
  (outRoot) => {
    const pkg = JSON.parse(readFileSync(join(outRoot, "package.json"), "utf8"));
    delete pkg.dependencies.react;
    delete pkg.dependencies["react-dom"];
    writeJson(join(outRoot, "package.json"), pkg);
    const webPkg = JSON.parse(readFileSync(join(outRoot, "apps/web/package.json"), "utf8"));
    webPkg.dependencies = {};
    writeJson(join(outRoot, "apps/web/package.json"), webPkg);
  },
  [
    "apps/web/server.mjs",
    "deploy/docker/core-entrypoint.sh",
    "deploy/docker/core-supervisor.mjs",
    "deploy/docker/memory-names.sh",
    "scripts/portable-backup.mjs",
    "scripts/portable-restore.mjs",
    "scripts/reset-owner-password.mjs",
    "scripts/rotate-owner-setup-token.mjs"
  ]
);

stageTarget(
  "browser",
  browserWorkspaces,
  (outRoot) => {
    const pkg = JSON.parse(readFileSync(join(outRoot, "package.json"), "utf8"));
    pkg.dependencies = { ws: rootPkg.dependencies.ws };
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
  [
    "deploy/docker/browser-entrypoint.sh"
  ]
);

stageTarget(
  "cli",
  cliWorkspaces,
  (outRoot) => {
    const pkg = JSON.parse(readFileSync(join(outRoot, "package.json"), "utf8"));
    pkg.dependencies = {};
    writeJson(join(outRoot, "package.json"), pkg);
  },
  [
    "agent-skills",
    "deploy/docker/cli-entrypoint.sh",
    "deploy/docker/credential-agent.mjs",
    "deploy/docker/opencode-first-run.mjs",
    "deploy/docker/provider-install.mjs",
    "deploy/docker/public-cli-wrapper.sh"
  ]
);
' \
    && npm cache clean --force \
    && rm -rf /root/.npm /tmp/*

FROM node:22.23.0-trixie-slim@sha256:cfd8f2a5bc50526aee08e88970979f92722828e7dcc6d8983607fb8bff4bdb82 AS runtime-base
ARG TARGETARCH
ARG NPM_VERSION=11.18.0
ENV NODE_ENV=production \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8
LABEL org.opencontainers.image.source=https://github.com/oll4com/spaceapp
LABEL org.opencontainers.image.licenses=MIT
RUN npm install --global --ignore-scripts --no-audit --no-fund "npm@${NPM_VERSION}" \
    && install -d /tmp/npm-security-patches \
    && npm pack --ignore-scripts --no-audit --no-fund --pack-destination /tmp/npm-security-patches \
      brace-expansion@5.0.12 tar@7.5.21 ip-address@10.7.4 undici@6.28.1 postcss-selector-parser@7.1.6 \
    && rm -rf \
      /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
      /usr/local/lib/node_modules/npm/node_modules/tar \
      /usr/local/lib/node_modules/npm/node_modules/ip-address \
      /usr/local/lib/node_modules/npm/node_modules/undici \
      /usr/local/lib/node_modules/npm/node_modules/postcss-selector-parser \
    && install -d \
      /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
      /usr/local/lib/node_modules/npm/node_modules/tar \
      /usr/local/lib/node_modules/npm/node_modules/ip-address \
      /usr/local/lib/node_modules/npm/node_modules/undici \
      /usr/local/lib/node_modules/npm/node_modules/postcss-selector-parser \
    && tar -xzf /tmp/npm-security-patches/brace-expansion-5.0.12.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/brace-expansion --strip-components=1 \
    && tar -xzf /tmp/npm-security-patches/tar-7.5.21.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/tar --strip-components=1 \
    && tar -xzf /tmp/npm-security-patches/ip-address-10.7.4.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/ip-address --strip-components=1 \
    && tar -xzf /tmp/npm-security-patches/undici-6.28.1.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/undici --strip-components=1 \
    && tar -xzf /tmp/npm-security-patches/postcss-selector-parser-7.1.6.tgz \
      -C /usr/local/lib/node_modules/npm/node_modules/postcss-selector-parser --strip-components=1 \
    && rm -rf /tmp/npm-security-patches && npm cache clean --force \
    && apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git gosu liblzma5 postgresql-client procps ripgrep sqlite3 \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 spaceapp \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /var/lib/spaceapp-cli --shell /bin/bash spaceapp
WORKDIR /app
COPY --from=build --chown=spaceapp:spaceapp /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
COPY --from=build --chown=spaceapp:spaceapp /app/THIRD_PARTY_LICENSES ./THIRD_PARTY_LICENSES

FROM runtime-base AS core
COPY --from=build --chown=spaceapp:spaceapp /out/core /app
COPY --chown=spaceapp:spaceapp starter-memory /opt/spaceapp/starter-memory
# The Databases tool's SQLite worker (apps/api/src/databases/sqlite-worker.py) needs Python 3.12+ with its sqlite3 module;
# python3-minimal has no sqlite3 (1.1.7 review: SQLite could not run in public installations).
RUN chmod 0755 deploy/docker/core-entrypoint.sh \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -c 'import sqlite3, sys; assert sys.version_info >= (3, 12)'
RUN install -d -o spaceapp -g spaceapp -m 0700 \
      /var/lib/spaceapp \
      /var/lib/spaceapp/artifacts \
      /var/lib/spaceapp/memory \
      /run/spaceapp-cli
EXPOSE 4911
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4911/readyz').then(async r=>{const body=await r.json();if(!r.ok||body.ok !== true)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/app/deploy/docker/core-entrypoint.sh"]

FROM runtime-base AS browser
COPY --from=build --chown=spaceapp:spaceapp /out/browser /app
RUN chmod 0755 deploy/docker/browser-entrypoint.sh \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation liblzma5 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o spaceapp -g spaceapp -m 0700 \
      /var/lib/spaceapp \
      /var/lib/spaceapp/artifacts \
      /run/spaceapp-browser
ENV SPACE_BROWSER_CHROME_PATH=/usr/bin/chromium \
    SPACE_BROWSER_SESSIONS_CHROME_PATH=/usr/bin/chromium
ENTRYPOINT ["/app/deploy/docker/browser-entrypoint.sh"]

FROM runtime-base AS cli
COPY --from=build --chown=spaceapp:spaceapp /out/cli /app
COPY --chown=root:root starter-memory/AGENTS.md /etc/AGENTS.md
COPY --chown=root:root starter-memory/installation-guide.md /etc/spaceapp-installation-guide.md
RUN chmod 0644 /etc/AGENTS.md \
    && chmod 0755 deploy/docker/cli-entrypoint.sh \
    && install -m 0755 deploy/docker/public-cli-wrapper.sh /usr/local/bin/spaceapp-cli-wrapper \
    && for name in codex claude gemini opencode qwen kimi grok deepseek autohand cursor copilot; do \
         ln -s /usr/local/bin/spaceapp-cli-wrapper "/usr/local/bin/${name}-vscode-parity"; \
       done
ARG TARGETARCH
# python3-minimal (about 13 MB): agents often check their work with a short python3 script (pilot F18).
# OpenCode 2 (@opencode/cli): its postinstall picks the native binary for the image's platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-minimal \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --no-audit --no-fund @opencode/cli@2.0.32 \
    && install -d -o spaceapp -g spaceapp -m 0700 /var/lib/spaceapp-cli/vendor \
    && npm cache clean --force \
    && install -d -o spaceapp -g spaceapp -m 0700 \
      /var/lib/spaceapp-cli \
      /var/lib/spaceapp-cli/providers \
      /var/lib/spaceapp-cli/imported-credentials \
      /var/lib/spaceapp/memory \
      /workspaces \
      /run/spaceapp-cli \
    && printf '%s\n' "$TARGETARCH" > /usr/local/share/spaceapp-cli-architecture
# The application's default room project is /opt/spaceapp. CLI sessions run in /etc, as
# /etc/AGENTS.md documents, so that path resolves to /etc in this image. Without it, the
# Getting Started OpenCode pane exits with "chdir(2) failed" before OpenCode starts.
RUN ln -s /etc /opt/spaceapp
ENTRYPOINT ["/app/deploy/docker/cli-entrypoint.sh"]
