import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { registerSettingsRoutes } from "./settings.ts";

export async function registerRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  await registerSettingsRoutes(app, deps);
}
