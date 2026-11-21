export function requireSource(actual: string, expected: string): void;
export function requirePublisherAudit(report: unknown): void;
export function requireEnvironmentReview(
  environment: unknown,
  rules: unknown,
): void;
export function requireEvidence(
  evidence: unknown,
  inspected: Readonly<Record<string, string>>,
  runId: string,
  runAttempt: string,
): void;
export function publisherEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string>;
