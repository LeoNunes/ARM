import path from "node:path";
import { JsonStore } from './store';
import type { WorkingRepo } from './schema';
import { newId } from '../util/ids';

export class WorkingRepoStore {
  private store: JsonStore<WorkingRepo[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<WorkingRepo[]>(path.join(stateDir, "working-repos.json"), []);
  }
  list(): Promise<WorkingRepo[]> {
    return this.store.read();
  }
  async get(id: string): Promise<WorkingRepo | undefined> {
    return (await this.list()).find((r) => r.id === id);
  }
  async add(input: Omit<WorkingRepo, "id">): Promise<WorkingRepo> {
    const list = await this.list();
    const r: WorkingRepo = { id: newId(), ...input };
    list.push(r);
    await this.store.write(list);
    return r;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((r) => r.id !== id));
  }
}
