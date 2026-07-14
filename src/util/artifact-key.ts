export function artifactRootRelativePath(artifactKey: string): string {
  const idx = artifactKey.indexOf(":");
  return idx === -1 ? artifactKey : artifactKey.slice(idx + 1);
}

export function artifactDisplayName(artifactKey: string): string {
  const rel = artifactRootRelativePath(artifactKey);
  return rel.split("/").pop() || artifactKey;
}
