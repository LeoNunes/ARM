import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerRoutes } from './api/routes';
import { registerMcpServer } from './mcp/server';
import type { SettingsStore } from './state/settings';
import type { SkillsRepoStore } from './state/skills-repos';
import type { WorkingRepoStore } from './state/working-repos';
import type { InstallsStore } from './state/installs';
import type { buildRegistries } from './adapters/index';

export interface ServerDeps {
  stateDir: string;
  cacheDir: string;
  settings: SettingsStore;
  skillsRepos: SkillsRepoStore;
  workingRepos: WorkingRepoStore;
  installs: InstallsStore;
  registries: ReturnType<typeof buildRegistries>;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerRoutes(app, deps);
  registerMcpServer(app, deps);
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/", decorateReply: false });
  }
  return app;
}
