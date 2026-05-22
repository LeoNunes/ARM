import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from "../types.ts";
import type { ArtifactTypeId } from "../../state/schema.ts";

const SUPPORTED: Record<ArtifactTypeId, Scope[]> = {
  skills: ["working-repo", "global"],
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  displayName: "Cursor",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    if (type !== "skills") throw new Error(`cursor: artifact type not supported in slice 1: ${type}`);
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ".cursor", "skills", name);
    }
    return path.join(os.homedir(), ".cursor", "skills", name);
  },
  mapFileName(name) {
    const parts = name.split("/");
    const last = parts[parts.length - 1]!;
    if (last === "CLAUDE.md") parts[parts.length - 1] = "AGENTS.md";
    return parts.join("/");
  },
};
