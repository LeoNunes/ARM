import path from "node:path";
import { JsonStore } from "./store.js";

export class DismissedNotificationsStore {
  private store: JsonStore<Record<string, boolean>>;

  constructor(stateDir: string) {
    this.store = new JsonStore<Record<string, boolean>>(
      path.join(stateDir, "dismissed-notifications.json"),
      {},
    );
  }

  async isDismissed(key: string): Promise<boolean> {
    const data = await this.store.read();
    return !!data[key];
  }

  async dismiss(key: string): Promise<void> {
    const data = await this.store.read();
    data[key] = true;
    await this.store.write(data);
  }

  async listDismissed(): Promise<Set<string>> {
    const data = await this.store.read();
    return new Set(Object.keys(data));
  }

  async removeBySubstring(substr: string): Promise<void> {
    const data = await this.store.read();
    let changed = false;
    for (const key of Object.keys(data)) {
      if (key.includes(substr)) { delete data[key]; changed = true; }
    }
    if (changed) await this.store.write(data);
  }
}
