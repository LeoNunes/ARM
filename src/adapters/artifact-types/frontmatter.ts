export function frontmatterDescription(md: string): string | null {
  const frontmatterMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatterMatch) return null;
  const lines = frontmatterMatch[1]!.split(/\r?\n/);
  const keyIndex = lines.findIndex((line) => /^description:\s*(.*)$/.test(line));
  if (keyIndex === -1) return null;
  const inline = lines[keyIndex]!.match(/^description:\s*(.*)$/)![1]!.trim();

  const blockMatch = inline.match(/^([|>])([+-]?)\s*$/);
  if (blockMatch) {
    return parseBlockScalar(lines, keyIndex + 1, blockMatch[1] as "|" | ">", blockMatch[2] as "" | "+" | "-");
  }

  let value = inline;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value || null;
}

// Minimal YAML block scalar (`|` literal, `>` folded) support, per-line, no explicit indentation indicators.
function parseBlockScalar(lines: string[], startIndex: number, style: "|" | ">", chomp: "" | "+" | "-"): string | null {
  const blockLines: string[] = [];
  let indent: number | null = null;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      blockLines.push("");
      continue;
    }
    const lineIndent = line.match(/^ */)![0]!.length;
    if (indent === null) indent = lineIndent;
    if (lineIndent < indent) break;
    blockLines.push(line.slice(indent));
  }
  while (blockLines.length && blockLines[blockLines.length - 1] === "") blockLines.pop();
  if (blockLines.length === 0) return null;

  let value: string;
  if (style === ">") {
    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const line of blockLines) {
      if (line === "") {
        if (current.length) {
          paragraphs.push(current.join(" "));
          current = [];
        }
        paragraphs.push("");
      } else {
        current.push(line);
      }
    }
    if (current.length) paragraphs.push(current.join(" "));
    value = paragraphs.join("\n").replace(/\n{2,}/g, "\n\n");
  } else {
    value = blockLines.join("\n");
  }
  if (chomp !== "+") value = value.replace(/\s+$/, "");
  return value || null;
}
