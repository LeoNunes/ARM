import { describe, it, expect } from "vitest";
import { computeInstallStatus } from "../../src/engine/status.ts";

describe("computeInstallStatus", () => {
  it("returns up-to-date when no update and no drift", () => {
    expect(computeInstallStatus(false, false)).toBe("up-to-date");
  });
  it("returns update-available when update exists and no drift", () => {
    expect(computeInstallStatus(true, false)).toBe("update-available");
  });
  it("returns drifted when no update and drift exists", () => {
    expect(computeInstallStatus(false, true)).toBe("drifted");
  });
  it("returns update-available+drifted when both are true", () => {
    expect(computeInstallStatus(true, true)).toBe("update-available+drifted");
  });
});
