import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  publisherEnvironment,
  requireEnvironmentReview,
  requireEvidence,
  requirePublisherAudit,
  requireSource,
} from "../scripts/npm-stage.mjs";

describe("npm staging", () => {
  it("requires a complete audit report with zero findings", () => {
    const clean = {
      metadata: { vulnerabilities: { total: 0 } },
      vulnerabilities: {},
    };
    const findings = { glob: { severity: "moderate" } };
    expect(() => requirePublisherAudit(clean)).not.toThrow();
    expect(() =>
      requirePublisherAudit({
        metadata: { vulnerabilities: { total: 1 } },
        vulnerabilities: findings,
      }),
    ).toThrow();
    expect(() =>
      requirePublisherAudit({ ...clean, vulnerabilities: findings }),
    ).toThrow();
    expect(() => requirePublisherAudit({ error: "network" })).toThrow();
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

  it("strips user tokens and proxy variables", () => {
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

  it("stages from an activated main dispatch using the verify job's artifact", async () => {
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
    expect(workflow.on.workflow_dispatch.inputs.expected_version.default).toBe(
      "",
    );
    expect(workflow.jobs.stage.needs).toBe("verify");
    expect(workflow.jobs.stage.if).toContain(
      "github.event_name == 'workflow_dispatch'",
    );
    expect(workflow.jobs.stage.if).toContain("inputs.prepare_npm_stage");
    expect(workflow.jobs.stage.if).toContain("refs/heads/main");
    expect(workflow.jobs.stage.if).toContain(
      "vars.GHQ_SECTOR_STAGING_ENABLED == 'true'",
    );
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
    expect(workflow.jobs.verify.outputs.tarball_sha256).toBe(
      "${{ steps.prepare.outputs.sha256 }}",
    );
    const submit = workflow.jobs.stage.steps.find(
      (step: { run?: string }) =>
        step.run === "node scripts/npm-stage.mjs stage",
    );
    expect(submit.env.PREPARED_TARBALL_SHA256).toBe(
      "${{ needs.verify.outputs.tarball_sha256 }}",
    );
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
