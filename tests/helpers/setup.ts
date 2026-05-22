import { afterEach } from "vitest";
import { cleanupTmpDirs } from "./tmp-dir.ts";

afterEach(async () => {
  await cleanupTmpDirs();
});
