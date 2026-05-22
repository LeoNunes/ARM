import path from "node:path";
import { JsonStore } from "./store.ts";
import type { Install } from "./schema.ts";
import { newId } from "../util/ids.ts";

export class InstallsStore {
  private store: JsonStore<Install[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<Install[]>(path.join(stateDir, "installs.json"), []);
  }
  list(): Promise<Install[]> {
    return this.store.read();
  }
  async get(id: string): Promise<Install | undefined> {
    return (await this.list()).find((i) => i.id === id);
  }
  async listByWorkingRepo(workingRepoId: string): Promise<Install[]> {
    return (await this.list()).filter(
      (i) => i.target.type === "working-repo" && i.target.workingRepoId === workingRepoId,
    );
  }
  async findExisting(artifactKey: string, target: Install["target"], agent: Install["agent"]): Promise<Install | undefined> {
    return (await this.list()).find(
      (i) =>
        i.artifactKey === artifactKey &&
        i.agent === agent &&
        JSON.stringify(i.target) === JSON.stringify(target),
    );
  }
  async add(input: Omit<Install, "id">): Promise<Install> {
    const list = await this.list();
    const i: Install = { id: newId(), ...input };
    list.push(i);
    await this.store.write(list);
    return i;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((i) => i.id !== id));
  }
}
