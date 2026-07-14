import path from "node:path";
import { JsonStore } from "./store.js";

export class ArtifactShaBaselineStore {
  private store: JsonStore<Record<string, string>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, string>>(
      path.join(stateDir, "artifact-sha-baseline.json"),
      {},
    );
  }

  async getBaseline(sourceRepoId: string, artifactKey: string): Promise<string | null> {
    const data = await this.store.read();
    return data[`${sourceRepoId}:${artifactKey}`] ?? null;
  }

  async setBaseline(sourceRepoId: string, artifactKey: string, sha: string): Promise<void> {
    const data = await this.store.read();
    data[`${sourceRepoId}:${artifactKey}`] = sha;
    await this.store.write(data);
  }

  async setBulkBaseline(
    sourceRepoId: string,
    entries: { artifactKey: string; sha: string }[],
  ): Promise<void> {
    const data = await this.store.read();
    for (const { artifactKey, sha } of entries) {
      data[`${sourceRepoId}:${artifactKey}`] = sha;
    }
    await this.store.write(data);
  }

  async removeByKeyPrefix(prefix: string): Promise<void> {
    const data = await this.store.read();
    let changed = false;
    for (const key of Object.keys(data)) {
      if (key.startsWith(prefix)) { delete data[key]; changed = true; }
    }
    if (changed) await this.store.write(data);
  }
}
