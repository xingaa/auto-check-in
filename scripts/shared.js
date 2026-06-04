const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const publicConfigPath = path.join(projectRoot, "checkin.config.js");
const localConfigPath = path.join(projectRoot, "checkin.config.local.js");
const defaultDailyTime = "09:00";

function getActiveConfigPath() {
  if (fs.existsSync(localConfigPath)) {
    return localConfigPath;
  }
  return publicConfigPath;
}

function toTrimmedString(value) {
  return String(value || "").trim();
}

function sanitizeFileSegment(value, fallback = "task") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function normalizeCheckinType(value) {
  return value === "refresh" ? "refresh" : "button";
}

function normalizeRefreshSuccessMode(value) {
  return value === "page_load" ? "page_load" : "selector";
}

function normalizeDailyTime(value) {
  const normalized = toTrimmedString(value);
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : defaultDailyTime;
}

function reserveTaskKey(usedKeys, preferredValue) {
  const baseKey = sanitizeFileSegment(preferredValue, "task");
  let candidate = baseKey;
  let suffix = 2;

  while (usedKeys.has(candidate)) {
    candidate = `${baseKey}-${suffix}`;
    suffix += 1;
  }

  usedKeys.add(candidate);
  return candidate;
}

function getTaskDefaults(taskKey) {
  return {
    key: taskKey,
    siteName: `签到任务 ${taskKey}`,
    browserChannel: "chrome",
    startUrl: "",
    userDataDir: `./data/${taskKey}-profile`,
    headlessOnSchedule: true,
    navigationTimeoutMs: 30000,
    actionTimeoutMs: 15000,
    loginInitTimeoutMs: 600000,
    loginState: {
      loggedInSelectors: [],
      loggedOutSelectors: []
    },
    checkin: {
      openUrl: "",
      type: "button",
      refreshSuccessMode: "selector",
      beforeClickSelectors: [],
      buttonSelectors: [],
      successSelectors: [],
      alreadyDoneSelectors: [],
      waitAfterActionMs: 3000
    },
    schedule: {
      taskName: `AutoCheckin-${taskKey}`,
      dailyTime: defaultDailyTime
    }
  };
}

function createTaskTemplate(seedValue, usedKeys = new Set()) {
  const taskKey = reserveTaskKey(usedKeys, seedValue || "task");
  return getTaskDefaults(taskKey);
}

function normalizeTask(input, usedKeys, fallbackSeed) {
  const taskKey = reserveTaskKey(
    usedKeys,
    toTrimmedString(input && input.key) || toTrimmedString(input && input.siteName) || fallbackSeed
  );
  const defaults = getTaskDefaults(taskKey);
  const loginState = (input && input.loginState) || {};
  const checkin = (input && input.checkin) || {};
  const schedule = (input && input.schedule) || {};

  return {
    key: taskKey,
    siteName: toTrimmedString(input && input.siteName) || defaults.siteName,
    browserChannel: toTrimmedString(input && input.browserChannel) || defaults.browserChannel,
    startUrl: toTrimmedString(input && input.startUrl),
    userDataDir: toTrimmedString(input && input.userDataDir) || defaults.userDataDir,
    headlessOnSchedule: input && Object.prototype.hasOwnProperty.call(input, "headlessOnSchedule")
      ? Boolean(input.headlessOnSchedule)
      : defaults.headlessOnSchedule,
    navigationTimeoutMs: Number(input && input.navigationTimeoutMs) || defaults.navigationTimeoutMs,
    actionTimeoutMs: Number(input && input.actionTimeoutMs) || defaults.actionTimeoutMs,
    loginInitTimeoutMs: Number(input && input.loginInitTimeoutMs) || defaults.loginInitTimeoutMs,
    loginState: {
      loggedInSelectors: normalizeStringArray(loginState.loggedInSelectors),
      loggedOutSelectors: normalizeStringArray(loginState.loggedOutSelectors)
    },
    checkin: {
      openUrl: toTrimmedString(checkin.openUrl),
      type: normalizeCheckinType(toTrimmedString(checkin.type)),
      refreshSuccessMode: normalizeRefreshSuccessMode(toTrimmedString(checkin.refreshSuccessMode)),
      beforeClickSelectors: normalizeStringArray(checkin.beforeClickSelectors),
      buttonSelectors: normalizeStringArray(checkin.buttonSelectors),
      successSelectors: normalizeStringArray(checkin.successSelectors),
      alreadyDoneSelectors: normalizeStringArray(checkin.alreadyDoneSelectors),
      waitAfterActionMs: Number(checkin.waitAfterActionMs || checkin.waitAfterClickMs) || defaults.checkin.waitAfterActionMs
    },
    schedule: {
      taskName: toTrimmedString(schedule.taskName) || defaults.schedule.taskName,
      dailyTime: normalizeDailyTime(schedule.dailyTime)
    }
  };
}

function buildLegacyTask(config) {
  return {
    key: sanitizeFileSegment(config.siteName || "task"),
    siteName: config.siteName,
    browserChannel: config.browserChannel,
    startUrl: config.startUrl,
    userDataDir: config.userDataDir,
    headlessOnSchedule: config.headlessOnSchedule,
    navigationTimeoutMs: config.navigationTimeoutMs,
    actionTimeoutMs: config.actionTimeoutMs,
    loginInitTimeoutMs: config.loginInitTimeoutMs,
    loginState: config.loginState,
    checkin: config.checkin,
    schedule: config.schedule
  };
}

function normalizeConfig(input) {
  const source = input || {};
  const rawTasks = Array.isArray(source.tasks) && source.tasks.length
    ? source.tasks
    : [buildLegacyTask(source)];
  const usedKeys = new Set();
  const tasks = rawTasks.map((task, index) => normalizeTask(task, usedKeys, `task-${index + 1}`));
  const requestedDefaultKey = toTrimmedString(source.defaultTaskKey);
  const defaultTaskKey = tasks.some((task) => task.key === requestedDefaultKey)
    ? requestedDefaultKey
    : tasks[0].key;

  return {
    defaultTaskKey,
    tasks
  };
}

function getTaskConfig(config, taskKey) {
  const normalized = normalizeConfig(config);
  if (!normalized.tasks.length) {
    throw new Error("No check-in tasks are configured.");
  }

  if (!taskKey) {
    return normalized.tasks.find((task) => task.key === normalized.defaultTaskKey) || normalized.tasks[0];
  }

  const matchedTask = normalized.tasks.find((task) => task.key === taskKey);
  if (!matchedTask) {
    throw new Error(`Task not found: ${taskKey}`);
  }

  return matchedTask;
}

function parseCliArgs(argv) {
  const result = {
    headed: false,
    taskKey: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headed") {
      result.headed = true;
      continue;
    }

    if ((arg === "--task" || arg === "--task-key") && argv[index + 1]) {
      result.taskKey = argv[index + 1];
      index += 1;
    }
  }

  return result;
}

function resolveFromRoot(...segments) {
  return path.resolve(projectRoot, ...segments);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join("-") + "_" + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("-");
}

function readConfig() {
  const configPath = getActiveConfigPath();
  delete require.cache[require.resolve(configPath)];
  return normalizeConfig(require(configPath));
}

function serializeConfigValue(value, indentLevel = 0) {
  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);

  if (Array.isArray(value)) {
    if (!value.length) {
      return "[]";
    }
    const items = value
      .map((item) => `${childIndent}${serializeConfigValue(item, indentLevel + 1)}`)
      .join(",\n");
    return `[\n${items}\n${indent}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) {
      return "{}";
    }
    const lines = entries.map(([key, entryValue]) => (
      `${childIndent}${key}: ${serializeConfigValue(entryValue, indentLevel + 1)}`
    ));
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  throw new Error(`Unsupported config value type: ${typeof value}`);
}

function writeConfig(config) {
  const configPath = getActiveConfigPath();
  const contents = `module.exports = ${serializeConfigValue(normalizeConfig(config))};\n`;
  fs.writeFileSync(configPath, contents, "utf8");
}

function createLogger(task) {
  const logDir = resolveFromRoot("logs");
  ensureDir(logDir);
  const taskSegment = sanitizeFileSegment(task && task.key, "global");
  const logFile = path.join(logDir, `${timestamp()}__${taskSegment}.log`);

  function write(level, message) {
    const scope = task
      ? ` [${task.siteName} / ${task.key}]`
      : "";
    const line = `[${new Date().toISOString()}] [${level}]${scope} ${message}`;
    console.log(line);
    fs.appendFileSync(logFile, `${line}\n`, "utf8");
  }

  return {
    logFile,
    info(message) {
      write("INFO", message);
    },
    warn(message) {
      write("WARN", message);
    },
    error(message) {
      write("ERROR", message);
    }
  };
}

async function findVisibleSelector(page, selectors, timeoutMs) {
  const list = (selectors || []).filter(Boolean);
  if (!list.length) {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of list) {
      try {
        const visible = await page.locator(selector).first().isVisible();
        if (visible) {
          return selector;
        }
      } catch (error) {
        // Ignore transient selector errors while polling the page.
      }
    }
    await page.waitForTimeout(300);
  }

  return null;
}

async function clickFirstVisible(page, selectors, timeoutMs) {
  const selector = await findVisibleSelector(page, selectors, timeoutMs);
  if (!selector) {
    return null;
  }

  await page.locator(selector).first().click({ timeout: timeoutMs });
  return selector;
}

async function takeScreenshot(page, prefix, taskKey) {
  const artifactDir = resolveFromRoot("artifacts");
  ensureDir(artifactDir);
  const taskSegment = sanitizeFileSegment(taskKey, "task");
  const filePath = path.join(artifactDir, `${taskSegment}_${prefix}_${timestamp()}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

function formatSelectors(selectors) {
  return (selectors || []).filter(Boolean).join(" | ");
}

function listRecentFiles(relativeDir, limit, extensionFilter) {
  const absoluteDir = resolveFromRoot(relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  return fs.readdirSync(absoluteDir)
    .filter((fileName) => {
      if (!extensionFilter) {
        return true;
      }
      return fileName.toLowerCase().endsWith(extensionFilter.toLowerCase());
    })
    .map((fileName) => {
      const absolutePath = path.join(absoluteDir, fileName);
      const stat = fs.statSync(absolutePath);
      return {
        absolutePath,
        fileName,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit);
}

function readFileTail(filePath, maxLines) {
  const contents = fs.readFileSync(filePath, "utf8");
  const lines = contents.split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines).join("\n");
}

function getBrowserExecutableCandidates(channel) {
  const normalizedChannel = toTrimmedString(channel).toLowerCase();
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA || "";

  if (normalizedChannel === "msedge" || normalizedChannel === "edge") {
    return [
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData ? path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe") : null
    ].filter(Boolean);
  }

  return [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localAppData ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : null
  ].filter(Boolean);
}

function resolveBrowserExecutable(channel) {
  return getBrowserExecutableCandidates(channel).find((candidate) => fs.existsSync(candidate)) || null;
}

module.exports = {
  configPath: publicConfigPath,
  createTaskTemplate,
  createLogger,
  clickFirstVisible,
  ensureDir,
  findVisibleSelector,
  formatSelectors,
  getActiveConfigPath,
  getTaskConfig,
  listRecentFiles,
  normalizeCheckinType,
  normalizeConfig,
  normalizeDailyTime,
  normalizeRefreshSuccessMode,
  normalizeStringArray,
  parseCliArgs,
  projectRoot,
  readFileTail,
  readConfig,
  resolveFromRoot,
  resolveBrowserExecutable,
  sanitizeFileSegment,
  takeScreenshot,
  writeConfig
};
