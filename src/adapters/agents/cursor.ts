import os from "node:os";
import path from "node:path";
import type { AgentAdapter, Scope } from '../types';
import type { ArtifactTypeId } from '../../state/schema';

const SUPPORTED: Partial<Record<ArtifactTypeId, Scope[]>> = {
  skills: ["working-repo", "global"],
  rules: ["working-repo"],
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  displayName: "Cursor",
  supports(type, scope) {
    return SUPPORTED[type]?.includes(scope) ?? false;
  },
  targetRoot({ scope, workingRepoPath, type, name }) {
    if (type === "rules") {
      if (scope !== "working-repo" || !workingRepoPath) {
        throw new Error("cursor: rules are only supported in a working repo");
      }
      return path.join(workingRepoPath, ".cursor", "rules");
    }
    if (type !== "skills") throw new Error(`cursor: unsupported artifact type: ${type}`);
    if (scope === "working-repo") {
      if (!workingRepoPath) throw new Error("workingRepoPath required for working-repo scope");
      return path.join(workingRepoPath, ".cursor", "skills", name);
    }
    return path.join(os.homedir(), ".cursor", "skills", name);
  },
  mapFileName(name, type) {
    const parts = name.split("/");
    const last = parts[parts.length - 1]!;
    if (type === "rules" && last.endsWith(".md")) {
      parts[parts.length - 1] = last.slice(0, -3) + ".mdc";
    } else if (last === "CLAUDE.md") {
      parts[parts.length - 1] = "AGENTS.md";
    }
    return parts.join("/");
  },
};
