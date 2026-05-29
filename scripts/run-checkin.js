const path = require("path");
const { chromium } = require("playwright");
const {
  clickFirstVisible,
  createLogger,
  ensureDir,
  findVisibleSelector,
  formatSelectors,
  getTaskConfig,
  parseCliArgs,
  readConfig,
  resolveFromRoot,
  takeScreenshot
} = require("./shared");

function getCheckinType(task) {
  return (task.checkin && task.checkin.type) || "button";
}

function getWaitAfterActionMs(task) {
  return (task.checkin && (task.checkin.waitAfterActionMs || task.checkin.waitAfterClickMs)) || 3000;
}

function getRefreshSuccessMode(task) {
  return (task.checkin && task.checkin.refreshSuccessMode) || "selector";
}

async function detectCheckinState(page, task, timeoutMs) {
  const successSelectors = task.checkin.successSelectors || [];
  const alreadyDoneSelectors = task.checkin.alreadyDoneSelectors || [];
  const matchedSelector = await findVisibleSelector(
    page,
    [
      ...successSelectors,
      ...alreadyDoneSelectors
    ],
    timeoutMs
  );

  if (!matchedSelector) {
    return null;
  }

  return {
    matchedSelector,
    state: alreadyDoneSelectors.includes(matchedSelector) ? "already_done" : "success"
  };
}

async function main() {
  const config = readConfig();
  const cli = parseCliArgs(process.argv.slice(2));
  const task = getTaskConfig(config, cli.taskKey);
  const logger = createLogger(task);
  const userDataDir = resolveFromRoot(task.userDataDir || `./data/${task.key}-profile`);
  ensureDir(path.dirname(userDataDir));

  logger.info(`Starting scheduled check-in for ${task.siteName}.`);
  logger.info(`Browser profile: ${userDataDir}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: task.browserChannel || "chrome",
    headless: cli.headed ? false : Boolean(task.headlessOnSchedule)
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultNavigationTimeout(task.navigationTimeoutMs || 30000);
    page.setDefaultTimeout(task.actionTimeoutMs || 15000);

    await page.goto(task.checkin.openUrl || task.startUrl, {
      waitUntil: "domcontentloaded"
    });

    const checkinType = getCheckinType(task);
    if (!["button", "refresh"].includes(checkinType)) {
      throw new Error(`Unsupported check-in type: ${checkinType}`);
    }
    logger.info(`Check-in type: ${checkinType}`);

    const loggedOutSelector = await findVisibleSelector(
      page,
      task.loginState && task.loginState.loggedOutSelectors,
      4000
    );
    if (loggedOutSelector) {
      const screenshotPath = await takeScreenshot(page, "checkin_not_logged_in", task.key);
      throw new Error(
        `Login state appears to be expired. Matched selector: ${loggedOutSelector}. Screenshot: ${screenshotPath}`
      );
    }

    const loggedInSelector = await findVisibleSelector(
      page,
      task.loginState && task.loginState.loggedInSelectors,
      8000
    );
    if (!loggedInSelector) {
      logger.warn(
        `Could not positively confirm logged-in state. Please review loggedInSelectors if the site changes. Current selectors: ${formatSelectors(task.loginState && task.loginState.loggedInSelectors)}`
      );
    } else {
      logger.info(`Confirmed logged-in state with selector: ${loggedInSelector}`);
    }

    if (checkinType === "refresh") {
      const refreshSuccessMode = getRefreshSuccessMode(task);
      logger.info(`Refresh success mode: ${refreshSuccessMode}`);

      const initialState = await detectCheckinState(page, task, 3000);
      if (initialState) {
        const screenshotPath = await takeScreenshot(page, "checkin_refresh_detected_on_load", task.key);
        logger.info(`Refresh-based check-in was already reflected on page load. Matched selector: ${initialState.matchedSelector}`);
        logger.info(`Saved screenshot: ${screenshotPath}`);
        return;
      }

      logger.info("No completed state detected on initial load. Reloading page to trigger refresh-based check-in.");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(getWaitAfterActionMs(task));

      const refreshState = await detectCheckinState(
        page,
        task,
        task.actionTimeoutMs || 15000
      );
      const screenshotPath = await takeScreenshot(page, "checkin_refresh_result", task.key);

      if (refreshState) {
        logger.info(`Refresh-based check-in finished successfully. Matched selector: ${refreshState.matchedSelector}`);
        logger.info(`Saved screenshot: ${screenshotPath}`);
        return;
      }

      if (refreshSuccessMode === "page_load") {
        const loggedOutAfterReload = await findVisibleSelector(
          page,
          task.loginState && task.loginState.loggedOutSelectors,
          2000
        );
        if (loggedOutAfterReload) {
          throw new Error(
            `Page reload completed, but the site appears logged out afterwards. Matched selector: ${loggedOutAfterReload}. Screenshot: ${screenshotPath}`
          );
        }

        logger.info("No explicit success selector matched, but refreshSuccessMode=page_load so a successful reload counts as success.");
        logger.info(`Saved screenshot: ${screenshotPath}`);
        return;
      }

      if (!refreshState) {
        throw new Error(
          `Reloaded the page but did not detect a completed state. Update successSelectors/alreadyDoneSelectors, or set refreshSuccessMode to page_load if this site treats a successful refresh as the sign-in trigger. Screenshot: ${screenshotPath}`
        );
      }
    }

    const alreadyDoneState = await detectCheckinState(page, task, 3000);
    if (alreadyDoneState && alreadyDoneState.state === "already_done") {
      const screenshotPath = await takeScreenshot(page, "checkin_already_done", task.key);
      logger.info(`Check-in already completed today. Matched selector: ${alreadyDoneState.matchedSelector}`);
      logger.info(`Saved screenshot: ${screenshotPath}`);
      return;
    }

    if ((task.checkin.beforeClickSelectors || []).length) {
      const beforeSelector = await findVisibleSelector(
        page,
        task.checkin.beforeClickSelectors,
        task.actionTimeoutMs || 15000
      );
      if (!beforeSelector) {
        const screenshotPath = await takeScreenshot(page, "checkin_precondition_missing", task.key);
        throw new Error(
          `Page did not reach the expected pre-click state. Update beforeClickSelectors. Screenshot: ${screenshotPath}`
        );
      }
      logger.info(`Reached pre-click state with selector: ${beforeSelector}`);
    }

    const clickedSelector = await clickFirstVisible(
      page,
      task.checkin.buttonSelectors,
      task.actionTimeoutMs || 15000
    );
    if (!clickedSelector) {
      const screenshotPath = await takeScreenshot(page, "checkin_button_not_found", task.key);
      throw new Error(
        `Could not find a check-in button. Update buttonSelectors in checkin.config.js. Current selectors: ${formatSelectors(task.checkin.buttonSelectors)}. Screenshot: ${screenshotPath}`
      );
    }

    logger.info(`Clicked check-in button: ${clickedSelector}`);
    await page.waitForTimeout(getWaitAfterActionMs(task));

    const checkinState = await detectCheckinState(
      page,
      task,
      task.actionTimeoutMs || 15000
    );
    const screenshotPath = await takeScreenshot(page, "checkin_result", task.key);

    if (!checkinState) {
      throw new Error(
        `Clicked the button but did not detect a success state. Update successSelectors. Screenshot: ${screenshotPath}`
      );
    }

    logger.info(`Check-in finished successfully. Matched selector: ${checkinState.matchedSelector}`);
    logger.info(`Saved screenshot: ${screenshotPath}`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
