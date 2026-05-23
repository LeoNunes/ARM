import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { cleanupTmpDirs } from "./tmp-dir.ts";

afterEach(async () => {
  cleanup();
  await cleanupTmpDirs();
});
