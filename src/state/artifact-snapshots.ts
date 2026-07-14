import path from "node:path";
import { JsonStore } from "./store.js";

export class ArtifactSnapshotsStore {
  private store: JsonStore<Record<string, string[]>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, string[]>>(
      path.join(stateDir, "artifact-snapshots.json"),
      {},
    );
  }

  async getSnapshot(sourceRepoId: string): Promise<Set<string>> {
    const all = await this.store.read();
    return new Set(all[sourceRepoId] ?? []);
  }

  async initSnapshot(sourceRepoId: string, keys: string[]): Promise<void> {
    const all = await this.store.read();
    if (all[sourceRepoId] === undefined) {
      all[sourceRepoId] = [...new Set(keys)];
      await this.store.write(all);
    }
  }

  async addToSnapshot(sourceRepoId: string, keys: string[]): Promise<void> {
    const all = await this.store.read();
    const existing = new Set(all[sourceRepoId] ?? []);
    for (const k of keys) existing.add(k);
    all[sourceRepoId] = [...existing];
    await this.store.write(all);
  }

  async getSnapshotOrInit(
    sourceRepoId: string,
    currentKeys: string[],
  ): Promise<{ snapshot: Set<string>; wasInitialized: boolean }> {
    const all = await this.store.read();
    if (all[sourceRepoId] === undefined) {
      all[sourceRepoId] = [...new Set(currentKeys)];
      await this.store.write(all);
      return { snapshot: new Set(currentKeys), wasInitialized: true };
    }
    return { snapshot: new Set(all[sourceRepoId]), wasInitialized: false };
  }

  async removeRepo(sourceRepoId: string): Promise<void> {
    const all = await this.store.read();
    if (all[sourceRepoId] !== undefined) {
      delete all[sourceRepoId];
      await this.store.write(all);
    }
  }

  async removeByKeyPrefix(sourceRepoId: string, keyPrefix: string): Promise<void> {
    const all = await this.store.read();
    const existing = all[sourceRepoId];
    if (existing === undefined) return;
    all[sourceRepoId] = existing.filter((k) => !k.startsWith(keyPrefix));
    await this.store.write(all);
  }
}
