import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanupTmpDirs } from "./tmp-dir.ts";

expect.extend(matchers);

afterEach(async () => {
  cleanup();
  await cleanupTmpDirs();
});
