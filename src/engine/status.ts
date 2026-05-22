export type InstallStatus =
  | "up-to-date"
  | "update-available"
  | "drifted"
  | "update-available+drifted";

export function computeInstallStatus(hasUpdate: boolean, isDrifted: boolean): InstallStatus {
  if (hasUpdate && isDrifted) return "update-available+drifted";
  if (hasUpdate) return "update-available";
  if (isDrifted) return "drifted";
  return "up-to-date";
}
