import { buildServer } from "./server.ts";
import { ensureStateDirs, resolveStateDir, resolveCacheDir } from "./state/paths.ts";
import { SettingsStore } from "./state/settings.ts";
import { SkillsRepoStore } from "./state/skills-repos.ts";
import { WorkingRepoStore } from "./state/working-repos.ts";
import { InstallsStore } from "./state/installs.ts";
import { buildRegistries } from "./adapters/index.ts";
import { pickFreePort } from "./ports.ts";

async function main() {
  ensureStateDirs();
  const stateDir = resolveStateDir();
  const cacheDir = resolveCacheDir();
  const settings = new SettingsStore(stateDir);
  const skillsRepos = new SkillsRepoStore(stateDir);
  const workingRepos = new WorkingRepoStore(stateDir);
  const installs = new InstallsStore(stateDir);
  const registries = buildRegistries();
  const app = await buildServer({ stateDir, cacheDir, settings, skillsRepos, workingRepos, installs, registries });
  const desired = (await settings.read()).mcpPort;
  const port = await pickFreePort(desired);
  if (port !== desired) await settings.update({ mcpPort: port });
  await app.listen({ port, host: "127.0.0.1" });
  process.stdout.write(`Skills Manager listening at http://127.0.0.1:${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
