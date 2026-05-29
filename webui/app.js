const fieldIds = {
  taskKey: "taskKey",
  siteName: "siteName",
  browserChannel: "browserChannel",
  startUrl: "startUrl",
  userDataDir: "userDataDir",
  headlessOnSchedule: "headlessOnSchedule",
  navigationTimeoutMs: "navigationTimeoutMs",
  actionTimeoutMs: "actionTimeoutMs",
  loginInitTimeoutMs: "loginInitTimeoutMs",
  openUrl: "openUrl",
  checkinType: "checkinType",
  refreshSuccessMode: "refreshSuccessMode",
  waitAfterActionMs: "waitAfterActionMs",
  scheduleTaskName: "scheduleTaskName",
  scheduleDailyTime: "scheduleDailyTime",
  loggedInSelectors: "loggedInSelectors",
  loggedOutSelectors: "loggedOutSelectors",
  beforeClickSelectors: "beforeClickSelectors",
  buttonSelectors: "buttonSelectors",
  successSelectors: "successSelectors",
  alreadyDoneSelectors: "alreadyDoneSelectors"
};

const state = {
  config: null,
  selectedTaskKey: null,
  lastPaths: null,
  flashTimer: null,
  pollTimer: null,
  schedulePollTimer: null
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function textAreaToArray(id) {
  return document.getElementById(id).value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToText(value) {
  return (value || []).join("\n");
}

function setFlashMessage(message, kind = "info") {
  const box = document.getElementById("flashMessage");
  box.textContent = message;
  box.className = `flash-message ${kind}`;
  box.classList.remove("hidden");
  window.clearTimeout(state.flashTimer);
  state.flashTimer = window.setTimeout(() => {
    box.classList.add("hidden");
  }, 3600);
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function slugifyTaskKey(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "task";
}

function generateTaskKey(seedValue, tasks) {
  const used = new Set((tasks || []).map((task) => task.key));
  const base = slugifyTaskKey(seedValue);
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function getTasks() {
  return state.config && Array.isArray(state.config.tasks) ? state.config.tasks : [];
}

function getSelectedTask() {
  const tasks = getTasks();
  if (!tasks.length) {
    return null;
  }

  return tasks.find((task) => task.key === state.selectedTaskKey)
    || tasks.find((task) => state.config && task.key === state.config.defaultTaskKey)
    || tasks[0];
}

function ensureSelectedTaskKey() {
  const selectedTask = getSelectedTask();
  state.selectedTaskKey = selectedTask ? selectedTask.key : null;
}

function createTaskDraft(sourceTask) {
  const tasks = getTasks();
  const seed = sourceTask ? `${sourceTask.key}-copy` : `task-${tasks.length + 1}`;
  const key = generateTaskKey(seed, tasks);

  return {
    key,
    siteName: sourceTask ? `${sourceTask.siteName} 副本` : `签到任务 ${tasks.length + 1}`,
    browserChannel: sourceTask ? sourceTask.browserChannel : "chrome",
    startUrl: sourceTask ? sourceTask.startUrl : "",
    userDataDir: `./data/${key}-profile`,
    headlessOnSchedule: sourceTask ? Boolean(sourceTask.headlessOnSchedule) : true,
    navigationTimeoutMs: sourceTask ? Number(sourceTask.navigationTimeoutMs) || 30000 : 30000,
    actionTimeoutMs: sourceTask ? Number(sourceTask.actionTimeoutMs) || 15000 : 15000,
    loginInitTimeoutMs: sourceTask ? Number(sourceTask.loginInitTimeoutMs) || 600000 : 600000,
    loginState: {
      loggedInSelectors: sourceTask ? deepClone(sourceTask.loginState.loggedInSelectors || []) : [],
      loggedOutSelectors: sourceTask ? deepClone(sourceTask.loginState.loggedOutSelectors || []) : []
    },
    checkin: {
      openUrl: sourceTask ? sourceTask.checkin.openUrl : "",
      type: sourceTask ? sourceTask.checkin.type : "button",
      refreshSuccessMode: sourceTask ? sourceTask.checkin.refreshSuccessMode : "selector",
      beforeClickSelectors: sourceTask ? deepClone(sourceTask.checkin.beforeClickSelectors || []) : [],
      buttonSelectors: sourceTask ? deepClone(sourceTask.checkin.buttonSelectors || []) : [],
      successSelectors: sourceTask ? deepClone(sourceTask.checkin.successSelectors || []) : [],
      alreadyDoneSelectors: sourceTask ? deepClone(sourceTask.checkin.alreadyDoneSelectors || []) : [],
      waitAfterActionMs: sourceTask ? Number(sourceTask.checkin.waitAfterActionMs || 3000) : 3000
    },
    schedule: {
      taskName: `AutoCheckin-${key}`,
      dailyTime: sourceTask ? sourceTask.schedule.dailyTime : "09:00"
    }
  };
}

function renderHero(paths) {
  if (paths) {
    state.lastPaths = paths;
  }
  const resolvedPaths = paths || state.lastPaths || {};
  const selectedTask = getSelectedTask();
  const projectRoot = resolvedPaths.projectRoot || "-";
  const selectedProfileDir = selectedTask && resolvedPaths.projectRoot
    ? `${resolvedPaths.projectRoot}\\${(selectedTask.userDataDir || "").replace(/^\.\//, "").replace(/\//g, "\\")}`
    : resolvedPaths.profileDir || "-";
  document.getElementById("selectedTaskName").textContent = selectedTask ? selectedTask.siteName : "未选择";
  document.getElementById("taskCount").textContent = String(getTasks().length);
  document.getElementById("projectRoot").textContent = projectRoot;
  document.getElementById("profileDir").textContent = selectedProfileDir;
  document.getElementById("runnerTaskBadge").textContent = selectedTask ? selectedTask.siteName : "当前任务";
  document.getElementById("scheduleTaskOwner").textContent = selectedTask ? selectedTask.siteName : "-";
}

function fillConfigForm(task) {
  if (!task) {
    return;
  }

  document.getElementById(fieldIds.taskKey).value = task.key || "";
  document.getElementById(fieldIds.siteName).value = task.siteName || "";
  document.getElementById(fieldIds.browserChannel).value = task.browserChannel || "";
  document.getElementById(fieldIds.startUrl).value = task.startUrl || "";
  document.getElementById(fieldIds.userDataDir).value = task.userDataDir || "";
  document.getElementById(fieldIds.headlessOnSchedule).checked = Boolean(task.headlessOnSchedule);
  document.getElementById(fieldIds.navigationTimeoutMs).value = task.navigationTimeoutMs || 30000;
  document.getElementById(fieldIds.actionTimeoutMs).value = task.actionTimeoutMs || 15000;
  document.getElementById(fieldIds.loginInitTimeoutMs).value = task.loginInitTimeoutMs || 600000;
  document.getElementById(fieldIds.openUrl).value = (task.checkin && task.checkin.openUrl) || "";
  document.getElementById(fieldIds.checkinType).value = (task.checkin && task.checkin.type) || "button";
  document.getElementById(fieldIds.refreshSuccessMode).value = (task.checkin && task.checkin.refreshSuccessMode) || "selector";
  document.getElementById(fieldIds.waitAfterActionMs).value =
    (task.checkin && task.checkin.waitAfterActionMs) || 3000;
  document.getElementById(fieldIds.scheduleTaskName).value = (task.schedule && task.schedule.taskName) || "";
  document.getElementById(fieldIds.scheduleDailyTime).value = (task.schedule && task.schedule.dailyTime) || "09:00";
  document.getElementById(fieldIds.loggedInSelectors).value = arrayToText(task.loginState && task.loginState.loggedInSelectors);
  document.getElementById(fieldIds.loggedOutSelectors).value = arrayToText(task.loginState && task.loginState.loggedOutSelectors);
  document.getElementById(fieldIds.beforeClickSelectors).value = arrayToText(task.checkin && task.checkin.beforeClickSelectors);
  document.getElementById(fieldIds.buttonSelectors).value = arrayToText(task.checkin && task.checkin.buttonSelectors);
  document.getElementById(fieldIds.successSelectors).value = arrayToText(task.checkin && task.checkin.successSelectors);
  document.getElementById(fieldIds.alreadyDoneSelectors).value = arrayToText(task.checkin && task.checkin.alreadyDoneSelectors);
}

function collectTaskFromForm() {
  return {
    key: document.getElementById(fieldIds.taskKey).value.trim(),
    siteName: document.getElementById(fieldIds.siteName).value.trim(),
    browserChannel: document.getElementById(fieldIds.browserChannel).value.trim(),
    startUrl: document.getElementById(fieldIds.startUrl).value.trim(),
    userDataDir: document.getElementById(fieldIds.userDataDir).value.trim(),
    headlessOnSchedule: document.getElementById(fieldIds.headlessOnSchedule).checked,
    navigationTimeoutMs: Number(document.getElementById(fieldIds.navigationTimeoutMs).value),
    actionTimeoutMs: Number(document.getElementById(fieldIds.actionTimeoutMs).value),
    loginInitTimeoutMs: Number(document.getElementById(fieldIds.loginInitTimeoutMs).value),
    loginState: {
      loggedInSelectors: textAreaToArray(fieldIds.loggedInSelectors),
      loggedOutSelectors: textAreaToArray(fieldIds.loggedOutSelectors)
    },
    checkin: {
      openUrl: document.getElementById(fieldIds.openUrl).value.trim(),
      type: document.getElementById(fieldIds.checkinType).value.trim(),
      refreshSuccessMode: document.getElementById(fieldIds.refreshSuccessMode).value.trim(),
      beforeClickSelectors: textAreaToArray(fieldIds.beforeClickSelectors),
      buttonSelectors: textAreaToArray(fieldIds.buttonSelectors),
      successSelectors: textAreaToArray(fieldIds.successSelectors),
      alreadyDoneSelectors: textAreaToArray(fieldIds.alreadyDoneSelectors),
      waitAfterActionMs: Number(document.getElementById(fieldIds.waitAfterActionMs).value)
    },
    schedule: {
      taskName: document.getElementById(fieldIds.scheduleTaskName).value.trim(),
      dailyTime: document.getElementById(fieldIds.scheduleDailyTime).value.trim()
    }
  };
}

function syncCurrentTaskFromForm() {
  if (!state.config || !state.selectedTaskKey) {
    return;
  }

  const tasks = getTasks();
  const index = tasks.findIndex((task) => task.key === state.selectedTaskKey);
  if (index === -1) {
    return;
  }

  state.config.tasks[index] = collectTaskFromForm();
}

function renderTaskList() {
  const container = document.getElementById("taskList");
  const tasks = getTasks();
  const defaultTaskKey = state.config ? state.config.defaultTaskKey : null;
  container.innerHTML = "";

  for (const task of tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `task-item${task.key === state.selectedTaskKey ? " selected" : ""}`;
    button.addEventListener("click", () => {
      syncCurrentTaskFromForm();
      state.selectedTaskKey = task.key;
      fillConfigForm(task);
      renderTaskList();
      renderHero();
      refreshStatus().catch((error) => setFlashMessage(error.message, "error"));
      loadSchedule().catch((error) => setFlashMessage(error.message, "error"));
    });

    const top = document.createElement("div");
    top.className = "task-item-top";
    const title = document.createElement("strong");
    title.textContent = task.siteName || task.key;
    const badge = document.createElement("span");
    badge.className = `task-type-pill ${task.checkin && task.checkin.type === "refresh" ? "refresh" : "button"}`;
    badge.textContent = task.checkin && task.checkin.type === "refresh" ? "刷新签到" : "按钮签到";
    top.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "task-item-meta";
    meta.textContent = `${task.schedule && task.schedule.dailyTime ? task.schedule.dailyTime : "--:--"} · ${task.schedule && task.schedule.taskName ? task.schedule.taskName : "未命名计划任务"}`;

    const footer = document.createElement("div");
    footer.className = "task-item-footer";
    const key = document.createElement("span");
    key.textContent = task.key;
    const defaultPill = document.createElement("span");
    defaultPill.className = `mini-pill${task.key === defaultTaskKey ? " active" : ""}`;
    defaultPill.textContent = task.key === defaultTaskKey ? "默认任务" : "可切换";
    footer.append(key, defaultPill);

    button.append(top, meta, footer);
    container.appendChild(button);
  }

  const defaultTask = tasks.find((task) => task.key === defaultTaskKey);
  document.getElementById("defaultTaskBadge").textContent = defaultTask ? defaultTask.siteName : "默认任务";
}

function renderJob(activeJob) {
  const badge = document.getElementById("jobBadge");
  const name = document.getElementById("jobName");
  const startedAt = document.getElementById("jobStartedAt");
  const endedAt = document.getElementById("jobEndedAt");
  const output = document.getElementById("jobOutput");

  if (!activeJob) {
    badge.textContent = "空闲";
    badge.className = "badge idle";
    name.textContent = "暂无";
    startedAt.textContent = "-";
    endedAt.textContent = "-";
    output.textContent = "等待任务输出...";
    return;
  }

  badge.textContent = activeJob.status === "running" ? "运行中" : activeJob.status;
  badge.className = `badge ${activeJob.status}`;
  name.textContent = activeJob.taskName
    ? `${activeJob.taskName} · ${activeJob.name}`
    : activeJob.name;
  startedAt.textContent = new Date(activeJob.startedAt).toLocaleString();
  endedAt.textContent = activeJob.endedAt ? new Date(activeJob.endedAt).toLocaleString() : "-";
  output.textContent = activeJob.outputLines.length
    ? activeJob.outputLines.join("\n")
    : "任务已启动，等待输出...";
}

function renderHistory(items) {
  const container = document.getElementById("jobHistory");
  const template = document.getElementById("historyItemTemplate");
  container.innerHTML = "";

  if (!items || !items.length) {
    container.className = "history-list empty-state";
    container.textContent = "还没有历史记录。";
    return;
  }

  container.className = "history-list";
  for (const item of items) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".history-name").textContent = item.name;
    node.querySelector(".history-badge").textContent = item.status;
    node.querySelector(".history-badge").className = `history-badge ${item.status}`;
    node.querySelector(".history-task").textContent = item.taskName
      ? `${item.taskName} · ${item.taskKey}`
      : item.taskKey || "";
    node.querySelector(".history-time").textContent =
      `${new Date(item.startedAt).toLocaleString()}${item.endedAt ? ` -> ${new Date(item.endedAt).toLocaleTimeString()}` : ""}`;
    container.appendChild(node);
  }
}

function createTag(text) {
  const tag = document.createElement("span");
  tag.className = "file-tag";
  tag.textContent = text;
  return tag;
}

function renderLogs(items) {
  const container = document.getElementById("recentLogs");
  container.innerHTML = "";

  if (!items || !items.length) {
    container.className = "log-list empty-state";
    container.textContent = "还没有日志。";
    return;
  }

  container.className = "log-list";
  for (const item of items) {
    const article = document.createElement("article");
    article.className = "log-item";

    const top = document.createElement("div");
    top.className = "log-top";
    const link = document.createElement("a");
    link.href = item.href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.name;
    const info = document.createElement("div");
    info.className = "file-meta";
    if (item.taskSegment) {
      info.appendChild(createTag(item.taskSegment));
    }
    const time = document.createElement("span");
    time.textContent = new Date(item.updatedAt).toLocaleString();
    info.appendChild(time);
    top.append(link, info);

    const pre = document.createElement("pre");
    pre.textContent = item.preview || "(empty)";

    article.append(top, pre);
    container.appendChild(article);
  }
}

function renderArtifacts(items) {
  const container = document.getElementById("recentArtifacts");
  container.innerHTML = "";

  if (!items || !items.length) {
    container.className = "artifact-grid empty-state";
    container.textContent = "还没有截图。";
    return;
  }

  container.className = "artifact-grid";
  for (const item of items) {
    const link = document.createElement("a");
    link.href = item.href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "artifact-card";

    const image = document.createElement("img");
    image.src = item.href;
    image.alt = item.name;

    const info = document.createElement("div");
    info.className = "artifact-info";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    if (item.taskSegment) {
      meta.appendChild(createTag(item.taskSegment));
    }
    const time = document.createElement("span");
    time.textContent = new Date(item.updatedAt).toLocaleString();
    meta.appendChild(time);

    info.append(name, meta);
    link.append(image, info);
    container.appendChild(link);
  }
}

function renderSchedule(payload) {
  const configuredSchedule = payload && payload.configuredSchedule ? payload.configuredSchedule : {};
  const task = payload && payload.task ? payload.task : null;
  const badge = document.getElementById("scheduleBadge");

  document.getElementById("scheduleTaskDisplay").textContent = configuredSchedule.taskName || "-";

  if (!task || !task.exists) {
    badge.textContent = "未创建";
    badge.className = "badge idle";
    document.getElementById("scheduleStateDisplay").textContent = "未创建";
    document.getElementById("scheduleNextRunDisplay").textContent = "-";
    document.getElementById("scheduleLastRunDisplay").textContent = "-";
    return;
  }

  const currentState = task.state || "Unknown";
  const normalizedState = currentState.toLowerCase();
  badge.textContent = currentState;
  badge.className = `badge ${normalizedState === "ready" || normalizedState === "running" ? "success" : "idle"}`;
  document.getElementById("scheduleStateDisplay").textContent = currentState;
  document.getElementById("scheduleNextRunDisplay").textContent = task.nextRunTime
    ? new Date(task.nextRunTime).toLocaleString()
    : "-";
  document.getElementById("scheduleLastRunDisplay").textContent = task.lastRunTime
    ? new Date(task.lastRunTime).toLocaleString()
    : "-";
}

async function refreshStatus() {
  const selectedTask = getSelectedTask();
  const query = selectedTask ? `?taskKey=${encodeURIComponent(selectedTask.key)}` : "";
  const payload = await apiFetch(`/api/status${query}`, { method: "GET" });
  renderHero(payload.paths || {});
  renderJob(payload.activeJob);
  renderHistory(payload.jobHistory || []);
  renderLogs(payload.recentLogs || []);
  renderArtifacts(payload.recentArtifacts || []);
}

async function loadSchedule() {
  const selectedTask = getSelectedTask();
  const query = selectedTask ? `?taskKey=${encodeURIComponent(selectedTask.key)}` : "";
  const payload = await apiFetch(`/api/schedule${query}`, { method: "GET" });
  renderSchedule(payload);
}

async function loadConfig() {
  state.config = await apiFetch("/api/config", { method: "GET" });
  ensureSelectedTaskKey();
  fillConfigForm(getSelectedTask());
  renderTaskList();
}

async function saveConfig({ message = "配置已保存。" } = {}) {
  syncCurrentTaskFromForm();
  const response = await apiFetch("/api/config", {
    method: "POST",
    body: JSON.stringify(state.config)
  });
  state.config = response.config;
  ensureSelectedTaskKey();
  fillConfigForm(getSelectedTask());
  renderTaskList();
  setFlashMessage(message, "success");
  await Promise.all([refreshStatus(), loadSchedule()]);
}

async function runAction(path, successMessage) {
  const selectedTask = getSelectedTask();
  const response = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify({ taskKey: selectedTask.key })
  });
  setFlashMessage(successMessage, "success");
  renderJob(response.job);
  await refreshStatus();
}

async function applySchedule() {
  const selectedTask = getSelectedTask();
  const payload = await apiFetch("/api/schedule/apply", {
    method: "POST",
    body: JSON.stringify({ taskKey: selectedTask.key })
  });
  renderSchedule(payload);
  setFlashMessage("当前任务的定时任务已保存并启用。", "success");
}

async function deleteSchedule() {
  const selectedTask = getSelectedTask();
  await apiFetch("/api/schedule/delete", {
    method: "POST",
    body: JSON.stringify({ taskKey: selectedTask.key })
  });
  await loadSchedule();
  setFlashMessage("当前任务的定时任务已删除。", "success");
}

async function addTask() {
  syncCurrentTaskFromForm();
  const task = createTaskDraft();
  state.config.tasks.push(task);
  state.selectedTaskKey = task.key;
  await saveConfig({ message: "已新增任务，请继续补充它的地址和选择器。" });
}

async function duplicateTask() {
  syncCurrentTaskFromForm();
  const selectedTask = getSelectedTask();
  const task = createTaskDraft(selectedTask);
  state.config.tasks.push(task);
  state.selectedTaskKey = task.key;
  await saveConfig({ message: "已复制当前任务，新任务会使用独立的资料目录和计划任务名。" });
}

async function deleteTask() {
  if (getTasks().length <= 1) {
    throw new Error("至少需要保留一个任务。");
  }

  const selectedTask = getSelectedTask();
  const confirmed = window.confirm(`确认删除任务“${selectedTask.siteName}”吗？如果它已经挂了计划任务，系统中的计划任务也会一并删除。`);
  if (!confirmed) {
    return;
  }

  await apiFetch("/api/schedule/delete", {
    method: "POST",
    body: JSON.stringify({ taskKey: selectedTask.key })
  }).catch(() => {
    // Ignore missing scheduled task and continue deleting the config entry.
  });

  const remainingTasks = getTasks().filter((task) => task.key !== selectedTask.key);
  state.config.tasks = remainingTasks;
  if (state.config.defaultTaskKey === selectedTask.key) {
    state.config.defaultTaskKey = remainingTasks[0].key;
  }
  state.selectedTaskKey = remainingTasks[0].key;
  await saveConfig({ message: "任务已删除。" });
}

function bindEvents() {
  document.getElementById("configForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveConfig();
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("refreshButton").addEventListener("click", async () => {
    try {
      await Promise.all([refreshStatus(), loadSchedule()]);
      setFlashMessage("状态已刷新。", "info");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("loginInitButton").addEventListener("click", async () => {
    try {
      await saveConfig({ message: "配置已保存。" });
      await runAction("/api/run/login-init", "已启动登录初始化，请在弹出的浏览器里手动登录当前任务。");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("checkinTestButton").addEventListener("click", async () => {
    try {
      await saveConfig({ message: "配置已保存。" });
      await runAction("/api/run/checkin-test", "已启动当前任务的有界面测试签到。");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("checkinNowButton").addEventListener("click", async () => {
    try {
      await saveConfig({ message: "配置已保存。" });
      await runAction("/api/run/checkin-now", "已启动当前任务的即时签到。");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("applyScheduleButton").addEventListener("click", async () => {
    try {
      await saveConfig({ message: "配置已保存。" });
      await applySchedule();
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("deleteScheduleButton").addEventListener("click", async () => {
    try {
      await saveConfig({ message: "配置已保存。" });
      await deleteSchedule();
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("addTaskButton").addEventListener("click", async () => {
    try {
      await addTask();
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("duplicateTaskButton").addEventListener("click", async () => {
    try {
      await duplicateTask();
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("deleteTaskButton").addEventListener("click", async () => {
    try {
      await deleteTask();
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });
}

async function bootstrap() {
  bindEvents();
  await loadConfig();
  await Promise.all([refreshStatus(), loadSchedule()]);
  state.pollTimer = window.setInterval(() => {
    refreshStatus().catch(() => {
      // Keep polling even if one request fails.
    });
  }, 2000);
  state.schedulePollTimer = window.setInterval(() => {
    loadSchedule().catch(() => {
      // Keep polling even if one request fails.
    });
  }, 15000);
}

bootstrap().catch((error) => {
  setFlashMessage(error.message, "error");
});
