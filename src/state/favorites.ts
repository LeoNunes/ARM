import path from "node:path";
import { JsonStore } from "./store.js";

export class FavoritesStore {
  private store: JsonStore<Record<string, boolean>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, boolean>>(
      path.join(stateDir, "favorites.json"),
      {},
    );
  }

  async isFavorite(artifactKey: string): Promise<boolean> {
    const data = await this.store.read();
    return !!data[artifactKey];
  }

  async setFavorite(artifactKey: string, favorited: boolean): Promise<void> {
    const data = await this.store.read();
    if (favorited) {
      data[artifactKey] = true;
    } else {
      delete data[artifactKey];
    }
    await this.store.write(data);
  }

  async listFavorites(): Promise<Set<string>> {
    const data = await this.store.read();
    return new Set(Object.keys(data));
  }
}
