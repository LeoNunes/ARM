import { createTwoFilesPatch } from "diff";

export interface DiffFilePair {
  path: string;
  fromContent: string | null;
  toContent: string | null;
}

export interface DiffLabels {
  fromLabel: string;
  toLabel: string;
}

/** A missing file on either side is shown as an add/delete rather than a silent empty diff. */
function annotate(pair: DiffFilePair): string {
  if (pair.fromContent === null) return `${pair.path} (added)`;
  if (pair.toContent === null) return `${pair.path} (deleted)`;
  return pair.path;
}

/**
 * Renders file pairs as unified-diff text. Unchanged files are omitted entirely,
 * so an empty result means "no differences".
 */
export function formatUnifiedDiff(pairs: DiffFilePair[], labels: DiffLabels): string {
  return pairs
    .filter((pair) => pair.fromContent !== pair.toContent)
    .map((pair) => {
      const name = annotate(pair);
      return createTwoFilesPatch(
        name,
        name,
        pair.fromContent ?? "",
        pair.toContent ?? "",
        labels.fromLabel,
        labels.toLabel,
      );
    })
    .join("\n");
}
