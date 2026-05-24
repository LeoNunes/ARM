import path from "node:path";
import { JsonStore } from "./store";
import type { ActivityLogEntry, ActivityCategory } from "./schema";
import { newId } from "../util/ids";

const MAX_ENTRIES = 500;

export class ActivityLogStore {
  private store: JsonStore<ActivityLogEntry[]>;

  constructor(stateDir: string) {
    this.store = new JsonStore<ActivityLogEntry[]>(
      path.join(stateDir, "activityLog.json"),
      [],
    );
  }

  async list(filter?: { category?: ActivityCategory; limit?: number }): Promise<ActivityLogEntry[]> {
    let entries = await this.store.read();
    if (filter?.category) {
      entries = entries.filter((e) => e.category === filter.category);
    }
    if (filter?.limit !== undefined) {
      entries = entries.slice(0, Math.max(0, filter.limit));
    }
    return entries;
  }

  async add(input: Omit<ActivityLogEntry, "id">): Promise<ActivityLogEntry> {
    const entries = await this.store.read();
    const entry: ActivityLogEntry = { id: newId(), ...input };
    entries.unshift(entry);
    await this.store.write(entries.slice(0, MAX_ENTRIES));
    return entry;
  }

  async delete(id: string): Promise<void> {
    const entries = await this.store.read();
    await this.store.write(entries.filter((e) => e.id !== id));
  }
}
