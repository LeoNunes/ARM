#!/usr/bin/env node
// bin/arm.js
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const compiled = path.join(root, "dist", "be", "index.js");
const cmd = existsSync(compiled)
  ? { run: process.execPath, args: [compiled] }
  : { run: process.execPath, args: [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), path.join(root, "src", "index.ts")] };

const child = spawn(cmd.run, cmd.args, { stdio: ["ignore", "pipe", "inherit"], cwd: root });

let opened = false;
child.stdout.on("data", (chunk) => {
  const s = chunk.toString();
  process.stdout.write(s);
  if (!opened) {
    const m = s.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      opened = true;
      open(m[0]).catch(() => {});
    }
  }
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
