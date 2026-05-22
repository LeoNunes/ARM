import { AgentRegistry, ArtifactTypeRegistry } from './registry';
import { claudeCodeAdapter } from './agents/claude-code';
import { cursorAdapter } from './agents/cursor';
import { skillsAdapter } from './artifact-types/skills';

export function buildRegistries(): { agents: AgentRegistry; types: ArtifactTypeRegistry } {
  const agents = new AgentRegistry();
  agents.register(claudeCodeAdapter);
  agents.register(cursorAdapter);
  const types = new ArtifactTypeRegistry();
  types.register(skillsAdapter);
  return { agents, types };
}
