import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server";
import type { ActivityCategory } from "../state/schema";

export async function registerActivityLogRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Querystring: { category?: string; limit?: string } }>(
    "/api/activity-log",
    async (req) => {
      const { category, limit } = req.query;
      return deps.activityLog.list({
        category: category as ActivityCategory | undefined,
        limit: limit !== undefined ? parseInt(limit, 10) : 50,
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/activity-log/:id", async (req, reply) => {
    await deps.activityLog.delete(req.params.id);
    return reply.code(204).send();
  });
}
