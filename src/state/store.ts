import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class JsonStore<T> {
  constructor(private filePath: string, private defaultValue: T) {}

  async read(): Promise<T> {
    if (!existsSync(this.filePath)) return structuredClone(this.defaultValue);
    const raw = await readFile(this.filePath, "utf8");
    return JSON.parse(raw) as T;
  }

  async write(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
