import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BEGIN = "# BEGIN skills-manager (auto-managed, do not edit)";
const END = "# END skills-manager";

export async function writeExcludeBlock(filePath: string, patterns: string[]): Promise<void> {
  const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
  if (patterns.length === 0) {
    const stripped = stripBlock(existing);
    await ensureDir(filePath);
    await writeFile(filePath, stripped, "utf8");
    return;
  }

  const block = `${BEGIN}\n${patterns.join("\n")}\n${END}\n`;
  const blockPattern = `${escape(BEGIN)}\\n[\\s\\S]*?\\n${escape(END)}\\n?`;
  const blockRegexTest = new RegExp(blockPattern);
  const blockRegexReplace = new RegExp(blockPattern, "g");

  let result: string;
  if (blockRegexTest.test(existing)) {
    // Replace existing block in place
    result = existing.replace(blockRegexReplace, block);
  } else {
    // Append new block
    const suffix = existing.length && !existing.endsWith("\n") ? "\n" : "";
    result = `${existing}${suffix}${block}`;
  }

  await ensureDir(filePath);
  await writeFile(filePath, result, "utf8");
}

export async function readExcludeBlock(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  const m = raw.match(new RegExp(`${escape(BEGIN)}\\n([\\s\\S]*?)\\n${escape(END)}`));
  if (!m) return [];
  return m[1]!.split(/\r?\n/).filter(Boolean);
}

function stripBlock(raw: string): string {
  const re = new RegExp(`${escape(BEGIN)}\\n[\\s\\S]*?\\n${escape(END)}\\n?`, "g");
  return raw.replace(re, "");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}
