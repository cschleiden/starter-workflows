#!/usr/bin/env npx ts-node
import { promises as fs } from "fs";
import { safeLoad } from "js-yaml";
import { basename, extname, join } from "path";
import { exec } from "./exec";

interface WorkflowDesc {
  folder: string;
  id: string;
  iconName: string;
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

        const workflowId = basename(e.name, extname(e.name));
        const workflowProperties = require(join(
          folder,
          "properties",
          `${workflowId}.properties.json`
        ));
        const iconName = workflowProperties["iconName"];

        const workflowDesc: WorkflowDesc = {
          folder,
          id: workflowId,
          iconName,
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
 * Check if a workflow uses only the given set of actions.
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
            console.info(
              `Workflow ${workflowPath} uses '${actionName}' which is not supported for GHES.`
            );
            return false;
          }
        }
      }
    }

    // All used actions are enabled 🎉
    return true;
  } catch (e) {
    console.error("Error while checking workflow", e);
    throw e;
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

    // In order to sync from master, we might need to remove some workflows, add some
    // and modify others. The lazy approach is to delete all workflows first, and then
    // just bring the compatible ones over from the master branch. We let git figure out
    // whether it's a deletion, add, or modify and commit the new state.
    console.log("Remove all workflows");
    await exec("rm", ["-fr", ...settings.folders]);
    await exec("rm", ["-fr", "../../icons"]);

    console.log("Sync changes from master for compatible workflows");
    await exec("git", [
      "checkout",
      "master",
      "--",
      ...Array.prototype.concat.apply(
        [],
        result.compatibleWorkflows.map((x) => [
          join(x.folder, `${x.id}.yml`),
          join(x.folder, "properties", `${x.id}.properties.json`),
          join("../../icons", `${x.iconName}.svg`),
        ])
      ),
    ]);
  } catch (e) {
    console.error("Unhandled error while syncing workflows", e);
    process.exitCode = 1;
  }
})();