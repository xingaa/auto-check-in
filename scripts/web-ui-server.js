const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const {
  ensureDir,
  getTaskConfig,
  listRecentFiles,
  projectRoot,
  readConfig,
  readFileTail,
  resolveFromRoot,
  writeConfig
} = require("./shared");

const port = Number(process.env.AUTO_CHECKIN_UI_PORT || 3210);
const webRoot = resolveFromRoot("webui");
const logsDir = resolveFromRoot("logs");
const artifactsDir = resolveFromRoot("artifacts");
const dataDir = resolveFromRoot("data");
const scheduleScriptPath = resolveFromRoot("scripts", "manage-schedule.ps1");
const scheduledRunScriptPath = resolveFromRoot("run-daily-checkin.ps1");

ensureDir(logsDir);
ensureDir(artifactsDir);
ensureDir(dataDir);

let jobCounter = 0;
let activeJob = null;
const jobHistory = [];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function safeReadJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function jobSummary(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    name: job.name,
    taskKey: job.taskKey,
    taskName: job.taskName,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    status: job.status,
    exitCode: job.exitCode,
    outputLines: job.outputLines.slice(-120)
  };
}

function detectLogTaskSegment(fileName, taskKeys) {
  for (const taskKey of taskKeys) {
    if (fileName.includes(`__${taskKey}.log`)) {
      return taskKey;
    }
  }
  return null;
}

function detectArtifactTaskSegment(fileName, taskKeys) {
  for (const taskKey of taskKeys) {
    if (fileName.startsWith(`${taskKey}_`)) {
      return taskKey;
    }
  }
  return null;
}

function mapRecentLogs(taskKeys) {
  return listRecentFiles("logs", 8, ".log").map((file) => ({
    name: file.fileName,
    updatedAt: new Date(file.mtimeMs).toISOString(),
    size: file.size,
    preview: readFileTail(file.absolutePath, 18),
    taskSegment: detectLogTaskSegment(file.fileName, taskKeys),
    href: `/logs/${encodeURIComponent(file.fileName)}`
  }));
}

function mapRecentArtifacts(taskKeys) {
  return listRecentFiles("artifacts", 12).map((file) => ({
    name: file.fileName,
    updatedAt: new Date(file.mtimeMs).toISOString(),
    size: file.size,
    taskSegment: detectArtifactTaskSegment(file.fileName, taskKeys),
    href: `/artifacts/${encodeURIComponent(file.fileName)}`
  }));
}

function getDashboardState(taskKey) {
  const config = readConfig();
  const selectedTask = getTaskConfig(config, taskKey);
  const taskKeys = config.tasks.map((task) => task.key);

  return {
    selectedTaskKey: selectedTask.key,
    taskCount: config.tasks.length,
    activeJob: jobSummary(activeJob),
    jobHistory: jobHistory.slice(-10).reverse().map(jobSummary),
    recentLogs: mapRecentLogs(taskKeys),
    recentArtifacts: mapRecentArtifacts(taskKeys),
    paths: {
      projectRoot,
      logsDir,
      artifactsDir,
      profileDir: path.resolve(projectRoot, selectedTask.userDataDir || `./data/${selectedTask.key}-profile`)
    }
  };
}

function runScheduleScript(args) {
  const stdout = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scheduleScriptPath,
      ...args
    ],
    {
      cwd: projectRoot,
      encoding: "utf8"
    }
  ).trim();

  return stdout ? JSON.parse(stdout) : {};
}

function getConfiguredSchedule(task) {
  return {
    taskName: (task.schedule && task.schedule.taskName) || `AutoCheckin-${task.key}`,
    dailyTime: (task.schedule && task.schedule.dailyTime) || "09:00"
  };
}

function assertTaskHasLoginConfig(task) {
  if (!task.startUrl) {
    throw new Error(`Task "${task.siteName}" is missing startUrl.`);
  }
}

function assertTaskHasCheckinConfig(task) {
  assertTaskHasLoginConfig(task);
  if (!task.checkin || !task.checkin.openUrl) {
    throw new Error(`Task "${task.siteName}" is missing checkin.openUrl.`);
  }
}

function buildNodeArgs(scriptRelativePath, taskKey, extraArgs = []) {
  const args = [scriptRelativePath, "--task", taskKey];
  return args.concat(extraArgs);
}

function runManagedJob(name, args, task) {
  if (activeJob && activeJob.status === "running") {
    return null;
  }

  const job = {
    id: ++jobCounter,
    name,
    taskKey: task.key,
    taskName: task.siteName,
    args,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: "running",
    exitCode: null,
    outputLines: []
  };

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    windowsHide: true
  });

  job.child = child;
  activeJob = job;
  jobHistory.push(job);

  function appendOutput(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      job.outputLines.push(line);
    }
    if (job.outputLines.length > 300) {
      job.outputLines = job.outputLines.slice(-300);
    }
  }

  child.stdout.on("data", (chunk) => appendOutput(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => appendOutput(chunk.toString("utf8")));
  child.on("error", (error) => {
    appendOutput(`Process error: ${error.message}`);
  });
  child.on("close", (exitCode) => {
    job.exitCode = exitCode;
    job.status = exitCode === 0 ? "success" : "failed";
    job.endedAt = new Date().toISOString();
    delete job.child;
    activeJob = null;
  });

  return jobSummary(job);
}

function serveStaticFile(response, absolutePath) {
  if (!fs.existsSync(absolutePath)) {
    sendText(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[extension] || "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".webp"
      ? "no-store"
      : "no-cache"
  });

  fs.createReadStream(absolutePath).pipe(response);
}

function safeJoin(baseDir, requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const absolutePath = path.resolve(baseDir, decodedPath.replace(/^\/+/, ""));
  const relativePath = path.relative(baseDir, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return absolutePath;
}

function getTaskFromQuery(config, requestUrl) {
  return getTaskConfig(config, requestUrl.searchParams.get("taskKey"));
}

async function readSelectedTask(request, requireCheckinConfig) {
  const body = await safeReadJsonBody(request);
  const config = readConfig();
  const task = getTaskConfig(config, body.taskKey);

  if (requireCheckinConfig) {
    assertTaskHasCheckinConfig(task);
  } else {
    assertTaskHasLoginConfig(task);
  }

  return {
    body,
    config,
    task
  };
}

async function handleApiRequest(request, response, requestUrl) {
  const pathname = requestUrl.pathname;

  if (request.method === "GET" && pathname === "/api/status") {
    const config = readConfig();
    const task = getTaskFromQuery(config, requestUrl);
    sendJson(response, 200, getDashboardState(task.key));
    return;
  }

  if (request.method === "GET" && pathname === "/api/config") {
    sendJson(response, 200, readConfig());
    return;
  }

  if (request.method === "POST" && pathname === "/api/config") {
    const body = await safeReadJsonBody(request);
    writeConfig(body);
    sendJson(response, 200, { ok: true, config: readConfig() });
    return;
  }

  if (request.method === "GET" && pathname === "/api/schedule") {
    const config = readConfig();
    const task = getTaskFromQuery(config, requestUrl);
    const configuredSchedule = getConfiguredSchedule(task);
    const scheduleTask = runScheduleScript([
      "-Mode",
      "query",
      "-TaskName",
      configuredSchedule.taskName
    ]);

    sendJson(response, 200, {
      selectedTaskKey: task.key,
      configuredSchedule,
      task: scheduleTask
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/schedule/apply") {
    const { task } = await readSelectedTask(request, true);
    const configuredSchedule = getConfiguredSchedule(task);

    if (!/^\d{2}:\d{2}$/.test(configuredSchedule.dailyTime)) {
      sendJson(response, 400, { error: "dailyTime must use HH:mm format." });
      return;
    }

    const scheduleTask = runScheduleScript([
      "-Mode",
      "apply",
      "-TaskName",
      configuredSchedule.taskName,
      "-DailyTime",
      configuredSchedule.dailyTime,
      "-TaskScriptPath",
      scheduledRunScriptPath,
      "-TaskKey",
      task.key
    ]);

    sendJson(response, 200, {
      ok: true,
      selectedTaskKey: task.key,
      configuredSchedule,
      task: scheduleTask
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/schedule/delete") {
    const body = await safeReadJsonBody(request);
    const config = readConfig();
    const task = getTaskConfig(config, body.taskKey);
    const configuredSchedule = getConfiguredSchedule(task);
    const result = runScheduleScript([
      "-Mode",
      "delete",
      "-TaskName",
      configuredSchedule.taskName
    ]);

    sendJson(response, 200, {
      ok: true,
      selectedTaskKey: task.key,
      configuredSchedule,
      result
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/run/login-init") {
    const { task } = await readSelectedTask(request, false);
    const job = runManagedJob(
      `Initialize Login · ${task.siteName}`,
      buildNodeArgs("scripts/init-login.js", task.key),
      task
    );

    if (!job) {
      sendJson(response, 409, { error: "Another job is already running." });
      return;
    }

    sendJson(response, 200, { ok: true, job });
    return;
  }

  if (request.method === "POST" && pathname === "/api/run/checkin-test") {
    const { task } = await readSelectedTask(request, true);
    const job = runManagedJob(
      `Test Check-in · ${task.siteName}`,
      buildNodeArgs("scripts/run-checkin.js", task.key, ["--headed"]),
      task
    );

    if (!job) {
      sendJson(response, 409, { error: "Another job is already running." });
      return;
    }

    sendJson(response, 200, { ok: true, job });
    return;
  }

  if (request.method === "POST" && pathname === "/api/run/checkin-now") {
    const { task } = await readSelectedTask(request, true);
    const job = runManagedJob(
      `Run Check-in Now · ${task.siteName}`,
      buildNodeArgs("scripts/run-checkin.js", task.key),
      task
    );

    if (!job) {
      sendJson(response, 409, { error: "Another job is already running." });
      return;
    }

    sendJson(response, 200, { ok: true, job });
    return;
  }

  sendJson(response, 404, { error: "API endpoint not found." });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const pathname = requestUrl.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, requestUrl);
      return;
    }

    if (pathname.startsWith("/artifacts/")) {
      const absolutePath = safeJoin(artifactsDir, pathname.slice("/artifacts/".length));
      if (!absolutePath) {
        sendText(response, 400, "Invalid path", "text/plain; charset=utf-8");
        return;
      }
      serveStaticFile(response, absolutePath);
      return;
    }

    if (pathname.startsWith("/logs/")) {
      const absolutePath = safeJoin(logsDir, pathname.slice("/logs/".length));
      if (!absolutePath) {
        sendText(response, 400, "Invalid path", "text/plain; charset=utf-8");
        return;
      }
      serveStaticFile(response, absolutePath);
      return;
    }

    const staticPath = pathname === "/"
      ? path.join(webRoot, "index.html")
      : safeJoin(webRoot, pathname.slice(1));
    if (!staticPath) {
      sendText(response, 400, "Invalid path", "text/plain; charset=utf-8");
      return;
    }
    serveStaticFile(response, staticPath);
  } catch (error) {
    sendJson(response, 500, { error: error.message || String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  const config = readConfig();
  console.log(`Auto Check-in UI is running at http://127.0.0.1:${port}`);
  console.log(`Loaded ${config.tasks.length} check-in task(s).`);
  console.log("Use the dashboard to manage tasks, initialize login, and test check-in.");
});
