import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import type { AgentId } from '../state/schema';

export async function registerSettingsRoutes(app: FastifyInstance, { settings }: ServerDeps): Promise<void> {
  app.get("/api/settings", async () => settings.read());
  app.patch<{
    Body: {
      favoriteAgent?: AgentId;
      mcpPort?: number;
      autoRefreshEnabled?: boolean;
      autoRefreshIntervalMinutes?: number;
    };
  }>(
    "/api/settings",
    async (req) => settings.update(req.body ?? {}),
  );
}
