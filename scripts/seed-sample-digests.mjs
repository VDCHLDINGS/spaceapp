import { readFileSync } from "node:fs";
import path from "node:path";

export function parsePinnedTemplateImages(composeContent) {
  const postgresMatch = composeContent.match(
    /postgres:\s*[\s\S]*?image:\s*(pgvector\/pgvector:[^\s]+@sha256:[a-f0-9]{64})/
  );
  const temporalMatch = composeContent.match(
    /temporal:\s*[\s\S]*?image:\s*(temporalio\/auto-setup:[^\s]+@sha256:[a-f0-9]{64})/
  );
  if (!postgresMatch?.[1]) {
    throw new Error("Could not find digest-pinned postgres image in compose.yml");
  }
  if (!temporalMatch?.[1]) {
    throw new Error("Could not find digest-pinned temporal image in compose.yml");
  }
  return {
    postgresImage: postgresMatch[1],
    temporalImage: temporalMatch[1],
  };
}

export function parsePinnedOpencodeVersion(dockerfileContent) {
  const match = dockerfileContent.match(/(?:@opencode\/cli|opencode-ai)@([0-9]+\.[0-9]+\.[0-9]+)/);
  if (!match?.[1]) {
    throw new Error("Could not find pinned OpenCode version in Dockerfile");
  }
  return match[1];
}

export function loadRepoPinnedDigests(repoRoot) {
  const composePath = path.join(repoRoot, "packages/run-spaceapp/templates/compose.yml");
  const dockerfilePath = path.join(repoRoot, "Dockerfile");
  const images = parsePinnedTemplateImages(readFileSync(composePath, "utf8"));
  const opencodeVersion = parsePinnedOpencodeVersion(readFileSync(dockerfilePath, "utf8"));
  return {
    ...images,
    opencodeVersion,
  };
}
