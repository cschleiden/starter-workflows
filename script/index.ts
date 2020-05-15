#!/usr/bin/env npx ts-node
import { promises as fs } from "fs";
import { safeLoad } from "js-yaml";
import { basename, extname, join } from "path";
import { exec } from "./exec";

interface WorkflowDesc {
  folder: string;
  id: string;
}

interface WorkflowsCheckResult {
  compatibleWorkflows: WorkflowDesc[];
  incompatibleWorkflows: WorkflowDesc[];
}

async function checkWorkflows(
  folders: string[],
  enabledActions: string[]
): Promise<WorkflowsCheckResult> {
  const result: WorkflowsCheckResult = {
    compatibleWorkflows: [],
    incompatibleWorkflows: [],
  };

  for (const folder of folders) {
    const dir = await fs.readdir(folder, {
      withFileTypes: true,
    });

    for (const e of dir) {
      if (e.isFile()) {
        const workflowFilePath = join(folder, e.name);
        const enabled = await checkWorkflow(workflowFilePath, enabledActions);

        const workflowDesc: WorkflowDesc = {
          folder,
          id: basename(e.name, extname(e.name)),
        };

        if (!enabled) {
          result.incompatibleWorkflows.push(workflowDesc);
        } else {
          result.compatibleWorkflows.push(workflowDesc);
        }
      }
    }
  }

  return result;
}

/**
 * Check if a workflow only the given set of actions.
 *
 * @param workflowPath Path to workflow yaml file
 * @param enabledActions List of enabled actions
 */
async function checkWorkflow(
  workflowPath: string,
  enabledActions: string[]
): Promise<boolean> {
  // Create set with lowercase action names for easier, case-insensitive lookup
  const enabledActionsSet = new Set(enabledActions.map((x) => x.toLowerCase()));

  try {
    const workflowFileContent = await fs.readFile(workflowPath, "utf8");
    const workflow = safeLoad(workflowFileContent);

    for (const job of Object.keys(workflow.jobs || {}).map(
      (k) => workflow.jobs[k]
    )) {
      for (const step of job.steps || []) {
        if (!!step.uses) {
          // Check if allowed action
          const [actionName, _] = step.uses.split("@");
          if (!enabledActionsSet.has(actionName.toLowerCase())) {
            return false;
          }
        }
      }
    }

    // All used actions are enabled 🎉
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

(async function main() {
  try {
    const settings = require("./settings.json");

    const result = await checkWorkflows(
      settings.folders,
      settings.enabledActions
    );

    console.group(
      `Found ${result.compatibleWorkflows.length} starter workflows compatible with GHES:`
    );
    console.log(
      result.compatibleWorkflows.map((x) => `${x.folder}/${x.id}`).join("\n")
    );
    console.groupEnd();

    console.group(
      `Ignored ${result.incompatibleWorkflows.length} starter-workflows incompatible with GHES:`
    );
    console.log(
      result.incompatibleWorkflows.map((x) => `${x.folder}/${x.id}`).join("\n")
    );
    console.groupEnd();

    console.log("Switch to GHES branch");
    await exec("git", ["checkout", "ghes"]);

    console.log("Remove all workflows");
    await exec("rm", ["-fr", ...settings.folders]);

    console.log("Sync changes from master for enabled workflows");

    // Yaml
    await exec("git", [
      "checkout",
      "master",
      "--",
      ...Array.prototype.concat.apply(
        [],
        result.compatibleWorkflows.map((x) => [
          join(x.folder, `${x.id}.yml`),
          join(x.folder, "properties", `${x.id}.properties.json`),
        ])
      ),
    ]);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
