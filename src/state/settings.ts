import path from "node:path";
import { JsonStore } from "./store.ts";
import type { SettingsFile } from "./schema.ts";

const DEFAULTS: SettingsFile = { favoriteAgent: "claude-code", mcpPort: 7747 };

export class SettingsStore {
  private store: JsonStore<SettingsFile>;
  constructor(stateDir: string) {
    this.store = new JsonStore<SettingsFile>(path.join(stateDir, "settings.json"), DEFAULTS);
  }
  read(): Promise<SettingsFile> {
    return this.store.read();
  }
  async update(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const current = await this.store.read();
    const next = { ...current, ...patch };
    await this.store.write(next);
    return next;
  }
}
