export function requireSource(actual: string, expected: string): void;
export function requirePublisherAudit(
  report: unknown,
  consent: string,
  version: string,
): void;
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
export function inspectArtifact(
  tarball: string,
  sourceSha: string,
): Promise<Record<string, string>>;
export function stageArguments(tarball: string, fixture: string): string[];
export function publisherEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string>;
