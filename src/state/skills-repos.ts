import path from "node:path";
import { JsonStore } from "./store.ts";
import type { SkillsRepo } from "./schema.ts";
import { newId } from "../util/ids.ts";

export class SkillsRepoStore {
  private store: JsonStore<SkillsRepo[]>;
  constructor(stateDir: string) {
    this.store = new JsonStore<SkillsRepo[]>(path.join(stateDir, "skills-repos.json"), []);
  }
  list(): Promise<SkillsRepo[]> {
    return this.store.read();
  }
  async get(id: string): Promise<SkillsRepo | undefined> {
    return (await this.list()).find((r) => r.id === id);
  }
  async add(input: Omit<SkillsRepo, "id">): Promise<SkillsRepo> {
    const list = await this.list();
    const repo: SkillsRepo = { id: newId(), ...input };
    list.push(repo);
    await this.store.write(list);
    return repo;
  }
  async update(id: string, patch: Partial<Omit<SkillsRepo, "id">>): Promise<SkillsRepo> {
    const list = await this.list();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`skills repo not found: ${id}`);
    list[idx] = { ...list[idx]!, ...patch };
    await this.store.write(list);
    return list[idx]!;
  }
  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.store.write(list.filter((r) => r.id !== id));
  }
}
