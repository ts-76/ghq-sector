export type ApplyStage =
  | "prepare"
  | "repos"
  | "links"
  | "resources"
  | "code-workspace"
  | "agents-summary"
  | "config-copy";

export type ApplyProgressReporter = (
  stage: ApplyStage,
  completed: boolean,
) => void;

export interface ApplyProgress {
  completed: ApplyStage[];
  failedStage: ApplyStage;
  failedStageMayHaveChanges: boolean;
}

export class ApplyError extends Error {
  constructor(
    readonly progress: ApplyProgress,
    cause: unknown,
  ) {
    super(`Apply failed during ${progress.failedStage}`, { cause });
  }
}
