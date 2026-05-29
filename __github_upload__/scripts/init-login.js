const path = require("path");
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
  takeScreenshot
} = require("./shared");

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
