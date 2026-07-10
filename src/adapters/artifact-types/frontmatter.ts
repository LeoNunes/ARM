export function frontmatterDescription(md: string): string | null {
  const frontmatterMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatterMatch) return null;
  const descriptionMatch = frontmatterMatch[1]!.match(/^description:\s*(.*)$/m);
  if (!descriptionMatch) return null;
  let value = descriptionMatch[1]!.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value || null;
}
