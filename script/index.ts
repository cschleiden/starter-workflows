import { promises as fs } from "fs";
import { safeLoad } from "js-yaml";
import { join } from "path";
import { exec } from "./exec";

async function checkWorkflows(folders: string[], enabledActions: string[]) {
  const result: {
    enabledWorkflows: string[];
    disabledWorkflows: string[];
  } = {
    enabledWorkflows: [],
    disabledWorkflows: [],
  };

  for (const folder of folders) {
    try {
      const dir = await fs.readdir(folder, {
        withFileTypes: true,
      });

      for (const e of dir) {
        if (e.isFile()) {
          const workflowFilePath = join(folder, e.name);
          const enabled = await checkWorkflow(workflowFilePath, enabledActions);

          !enabled && console.log(workflowFilePath, enabled);
          if (!enabled) {
            result.disabledWorkflows.push(workflowFilePath);
          } else {
            result.enabledWorkflows.push(workflowFilePath);
          }
        }
      }
    } catch (e) {
      console.error(e);
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

    console.log("Switch to GHES branch");
    await exec("git", ["checkout", "ghes"]);

    console.log("Remove all workflows");
    await exec("rm", settings.folders);

    console.log("Sync changes from master for enabled workflows");
    await exec("git", ["checkout", "master", "--", ...result.enabledWorkflows]);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
