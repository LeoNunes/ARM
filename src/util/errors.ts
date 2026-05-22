export type AppErrorCode =
  | "artifact_not_found"
  | "install_not_found"
  | "working_repo_not_found"
  | "skills_repo_not_found"
  | "unsupported_combination"
  | "already_installed"
  | "agent_not_specified"
  | "bad_input"
  | "io_error";

export class AppError extends Error {
  constructor(public code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}
