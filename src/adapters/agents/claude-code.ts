import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from '../types';
import type { ArtifactTypeId } from '../../state/schema';

const SUPPORTED: Partial<Record<ArtifactTypeId, Scope[]>> = {
  skills: ["working-repo", "global"],
  rules: ["working-repo", "global"],
};

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    const leaf = type === "rules" ? [".claude", "rules"] : [".claude", "skills", name];
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ...leaf);
    }
    return path.join(os.homedir(), ...leaf);
  },
  mapFileName(name, type) {
    if (type === "rules" && name.endsWith(".mdc")) return name.slice(0, -4) + ".md";
    return name;
  },
};
