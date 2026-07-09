export function sortByFavorite<T extends { artifactKey: string; name: string }>(
  artifacts: T[],
  favoriteKeys: Set<string>,
): T[] {
  return [...artifacts].sort((a, b) => {
    const aFav = favoriteKeys.has(a.artifactKey);
    const bFav = favoriteKeys.has(b.artifactKey);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
