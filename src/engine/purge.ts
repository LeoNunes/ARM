import type { FavoritesStore } from "../state/favorites";
import type { ArtifactSnapshotsStore } from "../state/artifact-snapshots";
import type { ArtifactShaBaselineStore } from "../state/artifact-sha-baseline";
import type { DismissedNotificationsStore } from "../state/notifications";

export interface PurgeDeps {
  favorites: FavoritesStore;
  snapshots: ArtifactSnapshotsStore;
  shaBaseline: ArtifactShaBaselineStore;
  dismissed: DismissedNotificationsStore;
}

export async function purgeRepoState(deps: PurgeDeps, sourceRepoId: string): Promise<void> {
  await deps.favorites.removeByKeyPrefix(`${sourceRepoId}:`);
  await deps.snapshots.removeRepo(sourceRepoId);
  await deps.shaBaseline.removeByKeyPrefix(`${sourceRepoId}:`);
  await deps.dismissed.removeBySubstring(`:${sourceRepoId}:`);
}

export async function purgePathState(
  deps: PurgeDeps,
  sourceRepoId: string,
  configuredPath: string,
): Promise<void> {
  const keyPrefix = `${sourceRepoId}:${configuredPath}/`;
  await deps.favorites.removeByKeyPrefix(keyPrefix);
  await deps.snapshots.removeByKeyPrefix(sourceRepoId, keyPrefix);
  await deps.shaBaseline.removeByKeyPrefix(`${sourceRepoId}:${keyPrefix}`);
  await deps.dismissed.removeBySubstring(`:${keyPrefix}`);
}
