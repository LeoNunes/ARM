import { AgentRegistry, ArtifactTypeRegistry } from "./registry.ts";
import { claudeCodeAdapter } from "./agents/claude-code.ts";
import { cursorAdapter } from "./agents/cursor.ts";
import { skillsAdapter } from "./artifact-types/skills.ts";

export function buildRegistries(): { agents: AgentRegistry; types: ArtifactTypeRegistry } {
  const agents = new AgentRegistry();
  agents.register(claudeCodeAdapter);
  agents.register(cursorAdapter);
  const types = new ArtifactTypeRegistry();
  types.register(skillsAdapter);
  return { agents, types };
}
