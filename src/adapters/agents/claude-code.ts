import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from '../types';
import type { ArtifactTypeId } from '../../state/schema';

const SUPPORTED: Partial<Record<ArtifactTypeId, Scope[]>> = {
  skills: ["working-repo", "global"],
};

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    if (type !== "skills") throw new Error(`claude-code: artifact type not supported in slice 1: ${type}`);
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ".claude", "skills", name);
    }
    return path.join(os.homedir(), ".claude", "skills", name);
  },
  mapFileName(name) {
    return name;
  },
};
