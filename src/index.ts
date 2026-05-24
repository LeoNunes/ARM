import { buildServer } from './server';
import { ensureStateDirs, resolveStateDir, resolveCacheDir } from './state/paths';
import { SettingsStore } from './state/settings';
import { SkillsRepoStore } from './state/skills-repos';
import { WorkingRepoStore } from './state/working-repos';
import { InstallsStore } from './state/installs';
import { buildRegistries } from './adapters/index';
import { ArtifactSnapshotsStore } from './state/artifact-snapshots';
import { DismissedNotificationsStore } from './state/notifications';
import { ActivityLogStore } from './state/activity-log';
import { pickFreePort } from './ports';
import { runAutoUpdatePass } from './engine/update-pass';
import { startRefreshLoop } from './engine/refresh-loop';

async function main() {
  ensureStateDirs();
  const stateDir = resolveStateDir();
  const cacheDir = resolveCacheDir();
  const settings = new SettingsStore(stateDir);
  const skillsRepos = new SkillsRepoStore(stateDir);
  const workingRepos = new WorkingRepoStore(stateDir);
  const installs = new InstallsStore(stateDir);
  const registries = buildRegistries();
  const snapshots = new ArtifactSnapshotsStore(stateDir);
  const dismissed = new DismissedNotificationsStore(stateDir);
  const activityLog = new ActivityLogStore(stateDir);
  const app = await buildServer({ stateDir, cacheDir, settings, skillsRepos, workingRepos, installs, registries, snapshots, dismissed, activityLog });
  const desired = (await settings.read()).mcpPort;
  const port = await pickFreePort(desired);
  if (port !== desired) await settings.update({ mcpPort: port });
  await app.listen({ port, host: "127.0.0.1" });
  process.stdout.write(`Skills Manager listening at http://127.0.0.1:${port}\n`);
  runAutoUpdatePass({ installs, skillsRepos, workingRepos, registries }).catch((err) => {
    process.stderr.write(`update-pass error: ${(err as Error).message}\n`);
  });
  startRefreshLoop({ settings, skillsRepos, workingRepos, installs, activityLog, registries });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
