import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.ts";
import { registerSettingsRoutes } from "./settings.ts";
import { registerSkillsReposRoutes } from "./skills-repos.ts";
import { registerWorkingReposRoutes } from "./working-repos.ts";
import { registerArtifactsRoutes } from "./artifacts.ts";
import { registerInstallsRoutes } from "./installs.ts";
import { AppError } from "../util/errors.ts";

export async function registerRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      const status =
        err.code === "bad_input" ? 400 :
        err.code === "unsupported_combination" ? 409 :
        err.code === "already_installed" ? 409 :
        err.code === "artifact_not_found" ? 404 :
        err.code === "working_repo_not_found" ? 404 :
        err.code === "skills_repo_not_found" ? 404 :
        500;
      return reply.code(status).send({ code: err.code, message: err.message });
    }
    return reply.code(500).send({ code: "internal", message: err.message });
  });
  await registerSettingsRoutes(app, deps);
  await registerSkillsReposRoutes(app, deps);
  await registerWorkingReposRoutes(app, deps);
  await registerArtifactsRoutes(app, deps);
  await registerInstallsRoutes(app, deps);
}
