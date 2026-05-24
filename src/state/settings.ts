import path from "node:path";
import { JsonStore } from './store';
import type { SettingsFile } from './schema';

const DEFAULTS: SettingsFile = {
  favoriteAgent: "claude-code",
  mcpPort: 7747,
  autoRefreshEnabled: true,
  autoRefreshIntervalMinutes: 30,
};

export class SettingsStore {
  private store: JsonStore<SettingsFile>;
  constructor(stateDir: string) {
    this.store = new JsonStore<SettingsFile>(path.join(stateDir, "settings.json"), DEFAULTS);
  }
  read(): Promise<SettingsFile> {
    return this.store.read().then(data => ({ ...DEFAULTS, ...data }));
  }
  async update(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const current = await this.store.read();
    const next = { ...DEFAULTS, ...current, ...patch };
    await this.store.write(next);
    return next;
  }
}
