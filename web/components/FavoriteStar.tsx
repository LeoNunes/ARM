export function FavoriteStar({ favorited, onToggle }: { favorited: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={favorited ? "Unfavorite" : "Favorite"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: favorited ? "#f5b400" : "var(--muted)",
        fontSize: 16,
        lineHeight: 1,
        padding: 2,
      }}
    >
      {favorited ? "★" : "☆"}
    </button>
  );
}
