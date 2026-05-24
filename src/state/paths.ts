import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PATHS = envPaths("arm", { suffix: "" });

export function resolveStateDir(): string {
  return PATHS.data;
}

export function resolveCacheDir(): string {
  return path.join(PATHS.data, "cache");
}

export function resolveLogDir(): string {
  return path.join(PATHS.data, "logs");
}

export function ensureStateDirs(): void {
  mkdirSync(resolveStateDir(), { recursive: true });
  mkdirSync(resolveCacheDir(), { recursive: true });
  mkdirSync(resolveLogDir(), { recursive: true });
}
