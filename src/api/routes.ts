import type { FastifyInstance } from "fastify";
import type { ServerDeps } from '../server';
import { registerSettingsRoutes } from './settings';
import { registerSkillsReposRoutes } from './skills-repos';
import { registerWorkingReposRoutes } from './working-repos';
import { registerArtifactsRoutes } from './artifacts';
import { registerInstallsRoutes } from './installs';
import { registerNotificationsRoutes } from './notifications';
import { registerDiffRoutes } from './diff';
import { registerActivityLogRoutes } from './activity-log';
import { AppError } from '../util/errors';

export async function registerRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      const status =
        err.code === "bad_input" ? 400 :
        err.code === "unsupported_combination" ? 409 :
        err.code === "already_installed" ? 409 :
        err.code === "artifact_not_found" ? 404 :
        err.code === "working_repo_not_found" ? 404 :
        err.code === "install_not_found" ? 404 :
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
  await registerNotificationsRoutes(app, deps);
  await registerDiffRoutes(app, deps);
  await registerActivityLogRoutes(app, deps);
}
