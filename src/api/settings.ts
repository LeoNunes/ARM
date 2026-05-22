import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';

export async function registerSettingsRoutes(app: FastifyInstance, { settings }: ServerDeps): Promise<void> {
  app.get("/api/settings", async () => settings.read());
  app.patch<{ Body: { favoriteAgent?: "claude-code" | "cursor"; mcpPort?: number } }>(
    "/api/settings",
    async (req) => settings.update(req.body ?? {}),
  );
}
