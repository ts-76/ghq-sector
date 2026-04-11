import { writeFile } from "node:fs/promises";
import type { GhqWsConfig } from "../config/schema.js";
import { buildCodeWorkspacePlan } from "./plan-workspace.js";

export async function generateCodeWorkspace(config: GhqWsConfig) {
  const plan = buildCodeWorkspacePlan(config);

  if (!plan.enabled || !plan.path) {
    return null;
  }

  await writeFile(
    plan.path,
    `${JSON.stringify({ folders: plan.folders, settings: plan.settings }, null, 2)}\n`,
    "utf8",
  );
  return plan.path;
}
