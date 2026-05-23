import type { InstallStatus } from "../api.ts";

const STYLE: Record<InstallStatus, React.CSSProperties> = {
  "up-to-date":               { background: "#d4edda", color: "#155724" },
  "update-available":         { background: "#cce5ff", color: "#004085" },
  "drifted":                  { background: "#fff3cd", color: "#856404" },
  "update-available+drifted": { background: "#f8d7da", color: "#721c24" },
};

const LABEL: Record<InstallStatus, string> = {
  "up-to-date":               "Up to date",
  "update-available":         "Update available",
  "drifted":                  "Drifted",
  "update-available+drifted": "Update + drifted",
};

export function StatusPill({ status }: { status: InstallStatus }) {
  return (
    <span style={{
      ...STYLE[status],
      padding: "2px 8px",
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {LABEL[status]}
    </span>
  );
}
