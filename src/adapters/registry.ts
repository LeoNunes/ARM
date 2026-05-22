import type { AgentId, ArtifactTypeId } from '../state/schema';
import type { AgentAdapter, ArtifactTypeAdapter } from './types';

export class AgentRegistry {
  private map = new Map<AgentId, AgentAdapter>();
  register(a: AgentAdapter): void {
    this.map.set(a.id, a);
  }
  get(id: AgentId): AgentAdapter {
    const a = this.map.get(id);
    if (!a) throw new Error(`unknown agent: ${id}`);
    return a;
  }
  list(): AgentAdapter[] {
    return [...this.map.values()];
  }
}

export class ArtifactTypeRegistry {
  private map = new Map<ArtifactTypeId, ArtifactTypeAdapter>();
  register(a: ArtifactTypeAdapter): void {
    this.map.set(a.id, a);
  }
  get(id: ArtifactTypeId): ArtifactTypeAdapter {
    const a = this.map.get(id);
    if (!a) throw new Error(`unknown artifact type: ${id}`);
    return a;
  }
  list(): ArtifactTypeAdapter[] {
    return [...this.map.values()];
  }
}
