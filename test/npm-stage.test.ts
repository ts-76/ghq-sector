import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  publisherEnvironment,
  requireEnvironmentReview,
  requireEvidence,
  requirePublisherAudit,
  requireSource,
  stageArguments,
} from "../scripts/npm-stage.mjs";

const known = {
  metadata: { vulnerabilities: { total: 1 } },
  vulnerabilities: {
    "http-cache-semantics": {
      severity: "high",
      via: [{ url: "https://github.com/advisories/GHSA-ch52-4w7c-c8xp" }],
    },
  },
};

describe("one-off npm staging", () => {
  it("requires explicit consent for known risks and rejects another version", () => {
    expect(() => requirePublisherAudit(known, "false", "1.4.0")).toThrow();
    expect(() => requirePublisherAudit(known, "true", "1.4.0")).not.toThrow();
    expect(() => requirePublisherAudit(known, "true", "1.4.1")).toThrow();
  });

  it("blocks unknown advisories, critical findings and incomplete reports", () => {
    const unknown = structuredClone(known);
    unknown.vulnerabilities["http-cache-semantics"].via[0].url =
      "https://github.com/advisories/GHSA-new-risk-test";
    expect(() => requirePublisherAudit(unknown, "true", "1.4.0")).toThrow();
    const critical = structuredClone(known);
    critical.vulnerabilities["http-cache-semantics"].severity = "critical";
    expect(() => requirePublisherAudit(critical, "true", "1.4.0")).toThrow();
    const incomplete = structuredClone(known);
    incomplete.metadata.vulnerabilities.total = 0;
    expect(() => requirePublisherAudit(incomplete, "true", "1.4.0")).toThrow();
    expect(() =>
      requirePublisherAudit({ error: "network" }, "true", "1.4.0"),
    ).toThrow();
  });

  it("blocks changed source, altered artifacts and earlier run attempts", () => {
    expect(() => requireSource("a".repeat(40), "b".repeat(40))).toThrow();
    expect(() => requireSource("a".repeat(40), "main")).toThrow();
    const inspected = { sha256: "verified", sourceSha: "a".repeat(40) };
    const evidence = { ...inspected, runId: "10", runAttempt: "2" };
    expect(() => requireEvidence(evidence, inspected, "10", "2")).not.toThrow();
    expect(() =>
      requireEvidence(
        evidence,
        { ...inspected, sha256: "tampered" },
        "10",
        "2",
      ),
    ).toThrow();
    expect(() => requireEvidence(evidence, inspected, "10", "3")).toThrow();
  });

  it("requires the owner reviewer and restricted main deployment", () => {
    const environment = {
      name: "npm-stage",
      can_admins_bypass: false,
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [{ type: "User", reviewer: { id: 108617014 } }],
        },
      ],
      deployment_branch_policy: {
        custom_branch_policies: true,
        protected_branches: false,
      },
    };
    const rules = { branch_policies: [{ name: "main", type: "branch" }] };
    expect(() => requireEnvironmentReview(environment, rules)).not.toThrow();
    expect(() =>
      requireEnvironmentReview(
        { ...environment, can_admins_bypass: true },
        rules,
      ),
    ).toThrow();
    expect(() =>
      requireEnvironmentReview({ ...environment, protection_rules: [] }, rules),
    ).toThrow();
    expect(() =>
      requireEnvironmentReview(environment, {
        branch_policies: [{ name: "*", type: "branch" }],
      }),
    ).toThrow();
  });

  it("uses stage-only arguments and strips user tokens and proxy variables", () => {
    const args = stageArguments("/tmp/accepted.tgz", "/tmp/isolated");
    expect(args.slice(0, 2)).toEqual(["stage", "publish"]);
    expect(args).toContain("--ignore-scripts");
    expect(args).toContain("--provenance");
    expect(args).toContain("--fetch-retries=0");
    expect(
      publisherEnvironment({
        PATH: "/bin",
        GITHUB_ACTIONS: "true",
        NPM_TOKEN: "secret",
        NODE_AUTH_TOKEN: "secret",
        GITHUB_TOKEN: "secret",
        HTTPS_PROXY: "untrusted",
      }),
    ).toEqual({ PATH: "/bin", GITHUB_ACTIONS: "true" });
  });

  it("cannot stage on push, from a PR or without activation and consent", async () => {
    const workflow = YAML.parse(
      await readFile(".github/workflows/release.yml", "utf8"),
    );
    expect(Object.keys(workflow.on).sort()).toEqual([
      "push",
      "workflow_dispatch",
    ]);
    expect(workflow.on.workflow_dispatch.inputs.prepare_npm_stage.default).toBe(
      false,
    );
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(
      workflow.on.workflow_dispatch.inputs.publisher_risk_consent.default,
    ).toBe(false);
    expect(workflow.jobs.stage.needs).toBe("verify");
    expect(workflow.jobs.stage.if).toContain(
      "github.event_name == 'workflow_dispatch'",
    );
    expect(workflow.jobs.stage.if).toContain("inputs.prepare_npm_stage");
    expect(workflow.jobs.stage.if).toContain("refs/heads/main");
    expect(workflow.jobs.stage.if).toContain(
      "vars.GHQ_SECTOR_STAGING_ENABLED == 'true'",
    );
    expect(workflow.jobs.stage.if).toContain("inputs.publisher_risk_consent");
    expect(workflow.jobs.stage.environment).toBe("npm-stage");
    expect(workflow.jobs.stage.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    const install = workflow.jobs.stage.steps.find(
      (step: { name?: string }) =>
        step.name === "Install locked official publisher without scripts",
    );
    expect(install.run).toContain("env -i");
    expect(install.run).toContain("--ignore-scripts");
    expect(install.run).toContain(
      'mktemp -d "$RUNNER_TEMP/ghq-sector-publisher-bootstrap.XXXXXX"',
    );
    expect(install.run).toContain('--userconfig="$bootstrap_dir/user.npmrc"');
    expect(install.run).toContain(
      '--globalconfig="$bootstrap_dir/global.npmrc"',
    );
    expect(install.run).not.toContain("/dev/null");
    expect(workflow.jobs.verify.permissions?.["id-token"]).toBeUndefined();
    const upload = workflow.jobs.verify.steps.find(
      (step: { uses?: string }) => step.uses === "actions/upload-artifact@v4",
    );
    const download = workflow.jobs.stage.steps.find(
      (step: { uses?: string }) => step.uses === "actions/download-artifact@v4",
    );
    expect(upload.if).toBe(
      "github.event_name == 'workflow_dispatch' && inputs.prepare_npm_stage",
    );
    expect(upload.with.name).toBe(download.with.name);
    expect(upload.with.name).toContain("github.run_attempt");
  });
});
