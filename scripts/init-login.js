const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const {
  createLogger,
  ensureDir,
  findVisibleSelector,
  formatSelectors,
  getTaskConfig,
  parseCliArgs,
  readConfig,
  resolveFromRoot,
  resolveBrowserExecutable,
  takeScreenshot
} = require("./shared");

function waitForChildProcess(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function runNativeBrowserLogin(task, userDataDir, logger) {
  const browserExecutable = resolveBrowserExecutable(task.browserChannel || "chrome");
  if (!browserExecutable) {
    return false;
  }

  logger.info("Login bootstrap mode: native browser.");
  logger.info(`Launching browser executable: ${browserExecutable}`);
  logger.info("Please complete login manually in the opened browser, then close that browser window when you're done.");

  const child = spawn(
    browserExecutable,
    [
      `--user-data-dir=${userDataDir}`,
      "--new-window",
      "--no-first-run",
      "--no-default-browser-check",
      task.startUrl
    ],
    {
      stdio: "ignore",
      windowsHide: false
    }
  );

  const result = await waitForChildProcess(child);
  if (result.code && result.code !== 0) {
    throw new Error(`Native browser exited unexpectedly with code ${result.code}.`);
  }

  logger.info("Native browser closed. Login profile has been written to disk.");
  logger.info("If the site uses Cloudflare or similar anti-bot checks, this mode is usually easier to pass.");
  logger.info("Next, run a visible check-in test to confirm the saved login state still works.");
  return true;
}

async function main() {
  const config = readConfig();
  const cli = parseCliArgs(process.argv.slice(2));
  const task = getTaskConfig(config, cli.taskKey);
  const logger = createLogger(task);
  const userDataDir = resolveFromRoot(task.userDataDir || `./data/${task.key}-profile`);
  ensureDir(path.dirname(userDataDir));

  logger.info(`Starting login bootstrap for ${task.siteName}.`);
  logger.info(`Browser profile: ${userDataDir}`);
  logger.info("A real browser window will open. Please log in manually, then keep the page on any logged-in screen.");

  const usedNativeBrowser = await runNativeBrowserLogin(task, userDataDir, logger);
  if (usedNativeBrowser) {
    return;
  }

  logger.warn("Could not find a native browser executable for this channel. Falling back to Playwright-controlled browser mode, which may trigger stricter anti-bot checks.");

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: task.browserChannel || "chrome",
    headless: false
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultNavigationTimeout(task.navigationTimeoutMs || 30000);
    page.setDefaultTimeout(task.actionTimeoutMs || 15000);

    await page.goto(task.startUrl, { waitUntil: "domcontentloaded" });

    const loggedInSelector = await findVisibleSelector(
      page,
      task.loginState && task.loginState.loggedInSelectors,
      task.loginInitTimeoutMs || 10 * 60 * 1000
    );

    if (!loggedInSelector) {
      const screenshotPath = await takeScreenshot(page, "login_init_timeout", task.key);
      throw new Error(
        `Login confirmation timed out. Please update loggedInSelectors in checkin.config.js. Current selectors: ${formatSelectors(task.loginState && task.loginState.loggedInSelectors)}. Screenshot: ${screenshotPath}`
      );
    }

    const screenshotPath = await takeScreenshot(page, "login_init_success", task.key);
    logger.info(`Login confirmed with selector: ${loggedInSelector}`);
    logger.info(`Saved confirmation screenshot: ${screenshotPath}`);
    logger.info("You can close the browser now. Future runs will reuse this saved login state.");
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
