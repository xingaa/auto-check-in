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

const addTaskFieldIds = {
  siteName: "newTaskSiteName",
  taskKey: "newTaskKey",
  browserChannel: "newTaskBrowserChannel",
  startUrl: "newTaskStartUrl",
  openUrl: "newTaskOpenUrl",
  checkinType: "newTaskCheckinType",
  dailyTime: "newTaskDailyTime"
};

const state = {
  config: null,
  selectedTaskKey: null,
  editingTaskKey: null,
  scheduleMap: {},
  scheduleLoadState: "idle",
  pendingScheduleActions: {},
  isManualRefreshing: false,
  statusSnapshot: null,
  paths: null,
  flashTimer: null,
  pollTimer: null,
  schedulePollTimer: null
};

const legacyApiNotFoundMessage = "API endpoint not found.";

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

function resolveButton(buttonOrId) {
  if (!buttonOrId) {
    return null;
  }
  if (typeof buttonOrId === "string") {
    return document.getElementById(buttonOrId);
  }
  return buttonOrId;
}

function setButtonLoading(buttonOrId, isLoading, loadingText) {
  const button = resolveButton(buttonOrId);
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  if (isLoading) {
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    if (loadingText) {
      button.textContent = loadingText;
    }
    return;
  }

  button.disabled = false;
  button.classList.remove("is-loading");
  button.removeAttribute("aria-busy");
  button.textContent = button.dataset.defaultLabel;
}

async function withButtonLoading(buttonOrId, loadingText, action) {
  const button = resolveButton(buttonOrId);
  setButtonLoading(button, true, loadingText);
  try {
    return await action();
  } finally {
    setButtonLoading(button, false);
  }
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

function getTaskByKey(taskKey) {
  return getTasks().find((task) => task.key === taskKey) || null;
}

function getSelectedTask() {
  const tasks = getTasks();
  if (!tasks.length) {
    return null;
  }

  return getTaskByKey(state.selectedTaskKey)
    || tasks.find((task) => state.config && task.key === state.config.defaultTaskKey)
    || tasks[0];
}

function ensureSelectedTaskKey() {
  const selectedTask = getSelectedTask();
  state.selectedTaskKey = selectedTask ? selectedTask.key : null;
}

function focusTask(taskKey) {
  if (!taskKey) {
    return;
  }
  state.selectedTaskKey = taskKey;
  renderHero();
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

function isModalOpen(id) {
  return !document.getElementById(id).classList.contains("hidden");
}

function syncBodyModalState() {
  const hasOpenModal = Array.from(document.querySelectorAll(".modal-shell"))
    .some((element) => !element.classList.contains("hidden"));
  document.body.classList.toggle("modal-open", hasOpenModal);
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  syncBodyModalState();
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  syncBodyModalState();
}

function resetAddTaskForm() {
  const form = document.getElementById("addTaskForm");
  form.reset();
  document.getElementById(addTaskFieldIds.siteName).value = "";
  document.getElementById(addTaskFieldIds.taskKey).value = "";
  document.getElementById(addTaskFieldIds.browserChannel).value = "chrome";
  document.getElementById(addTaskFieldIds.startUrl).value = "";
  document.getElementById(addTaskFieldIds.openUrl).value = "";
  document.getElementById(addTaskFieldIds.checkinType).value = "button";
  document.getElementById(addTaskFieldIds.dailyTime).value = "09:00";
}

function openAddTaskModal() {
  resetAddTaskForm();
  openModal("addTaskModal");
  document.getElementById(addTaskFieldIds.siteName).focus();
}

function closeAddTaskModal() {
  closeModal("addTaskModal");
}

function collectAddTaskForm() {
  const siteName = document.getElementById(addTaskFieldIds.siteName).value.trim();
  if (!siteName) {
    throw new Error("请先填写站点名称。");
  }

  return {
    siteName,
    taskKey: document.getElementById(addTaskFieldIds.taskKey).value.trim(),
    browserChannel: document.getElementById(addTaskFieldIds.browserChannel).value.trim() || "chrome",
    startUrl: document.getElementById(addTaskFieldIds.startUrl).value.trim(),
    openUrl: document.getElementById(addTaskFieldIds.openUrl).value.trim(),
    checkinType: document.getElementById(addTaskFieldIds.checkinType).value.trim() || "button",
    dailyTime: document.getElementById(addTaskFieldIds.dailyTime).value.trim() || "09:00"
  };
}

function createTaskFromModalInput(formValues) {
  const tasks = getTasks();
  const key = generateTaskKey(
    formValues.taskKey || formValues.siteName || `task-${tasks.length + 1}`,
    tasks
  );
  const task = createTaskDraft();
  task.key = key;
  task.siteName = formValues.siteName;
  task.browserChannel = formValues.browserChannel;
  task.startUrl = formValues.startUrl;
  task.userDataDir = `./data/${key}-profile`;
  task.checkin.openUrl = formValues.openUrl || formValues.startUrl;
  task.checkin.type = formValues.checkinType;
  task.checkin.refreshSuccessMode = formValues.checkinType === "refresh" ? "page_load" : "selector";
  task.schedule.taskName = `AutoCheckin-${key}`;
  task.schedule.dailyTime = formValues.dailyTime;
  return task;
}

function fillEditForm(task) {
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
  document.getElementById("editingTaskName").textContent = task.siteName || task.key || "未选择";
}

function collectEditedTaskFromForm() {
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

function openEditTaskModal(taskKey) {
  const task = getTaskByKey(taskKey);
  if (!task) {
    return;
  }
  state.editingTaskKey = task.key;
  focusTask(task.key);
  fillEditForm(task);
  openModal("editTaskModal");
  document.getElementById(fieldIds.siteName).focus();
}

function closeEditTaskModal() {
  state.editingTaskKey = null;
  closeModal("editTaskModal");
}

function openViewerShell(taskKey, kind) {
  const task = getTaskByKey(taskKey);
  const taskName = task ? task.siteName : taskKey;
  document.getElementById("viewerKicker").textContent = kind === "artifacts" ? "ARTIFACTS" : "LOGS";
  document.getElementById("viewerTitle").textContent = kind === "artifacts"
    ? `${taskName} · 最近截图`
    : `${taskName} · 最近日志`;
  document.getElementById("viewerSubtitle").textContent = kind === "artifacts"
    ? "这里展示该任务最近生成的截图，点击卡片可以查看原图。"
    : "这里展示该任务最近生成的日志，点击文件名可以打开完整日志。";
  const viewerBody = document.getElementById("viewerBody");
  viewerBody.className = "viewer-body empty-state";
  viewerBody.textContent = "加载中...";
  openModal("viewerModal");
}

function closeViewerModal() {
  closeModal("viewerModal");
}

function summarizeUrl(value) {
  if (!value) {
    return "未配置";
  }
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch (error) {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function createEmptyScheduleTask(overrides = {}) {
  return {
    exists: false,
    state: "未创建",
    nextRunTime: null,
    lastRunTime: null,
    ...overrides
  };
}

function createScheduleQueryingTask() {
  return createEmptyScheduleTask({
    state: "查询中",
    querying: true
  });
}

function getConfiguredSchedule(task) {
  return {
    taskName: (task.schedule && task.schedule.taskName) || `AutoCheckin-${task.key}`,
    dailyTime: (task.schedule && task.schedule.dailyTime) || "09:00"
  };
}

function toScheduleEntry(task, payload) {
  return {
    taskKey: task.key,
    taskName: task.siteName,
    configuredSchedule: payload && payload.configuredSchedule
      ? payload.configuredSchedule
      : getConfiguredSchedule(task),
    task: payload && payload.task
      ? createEmptyScheduleTask(payload.task)
      : createEmptyScheduleTask()
  };
}

function getScheduleSnapshot(task) {
  const snapshot = state.scheduleMap[task.key];
  if (snapshot) {
    return snapshot;
  }
  if (state.scheduleLoadState !== "loaded") {
    return toScheduleEntry(task, {
      configuredSchedule: getConfiguredSchedule(task),
      task: createScheduleQueryingTask()
    });
  }
  return toScheduleEntry(task);
}

function getScheduleStateMeta(scheduleTask) {
  if (!scheduleTask) {
    return {
      text: "未启用",
      className: "idle",
      note: "当前还没有创建系统定时任务。",
      action: "apply"
    };
  }

  if (scheduleTask.querying) {
    return {
      text: "查询中",
      className: "idle",
      note: "正在查询系统定时任务状态，请稍候。",
      action: null
    };
  }

  if (scheduleTask.error) {
    return {
      text: "查询失败",
      className: "failed",
      note: scheduleTask.error,
      action: "apply"
    };
  }

  const exists = Boolean(scheduleTask.exists);
  if (!exists) {
    return {
      text: "未启用",
      className: "idle",
      note: "当前还没有创建系统定时任务。",
      action: "apply"
    };
  }

  const rawState = String(scheduleTask.state || "").toLowerCase();
  if (rawState === "ready") {
    return {
      text: "已启用",
      className: "success",
      note: "系统定时任务已创建，等待 Windows 计划任务在下次时间点执行。",
      action: "delete"
    };
  }

  if (rawState === "running") {
    return {
      text: "运行中",
      className: "running",
      note: "Windows 计划任务当前正在执行这个签到任务。",
      action: "delete"
    };
  }

  if (rawState === "disabled") {
    return {
      text: "已禁用",
      className: "failed",
      note: "系统里已经有这个定时任务，但它目前处于禁用状态，可以重新启用。",
      action: "apply"
    };
  }

  if (rawState === "queued") {
    return {
      text: "排队中",
      className: "running",
      note: "系统定时任务已经排队，等待系统开始执行。",
      action: "delete"
    };
  }

  return {
    text: scheduleTask.state || "已创建",
    className: "success",
    note: "系统定时任务已经存在，你可以继续观察下一次运行时间。",
    action: "delete"
  };
}

function getFallbackViewerItems(taskKey, kind) {
  if (!state.statusSnapshot) {
    return [];
  }

  const source = kind === "artifacts"
    ? state.statusSnapshot.recentArtifacts
    : state.statusSnapshot.recentLogs;

  return (source || []).filter((item) => item.taskSegment === taskKey);
}

function hydrateScheduleMap(entries) {
  state.scheduleMap = {};
  for (const item of entries || []) {
    state.scheduleMap[item.taskKey] = item;
  }
}

function getActiveJob() {
  return state.statusSnapshot ? state.statusSnapshot.activeJob : null;
}

function getPendingScheduleAction(taskKey) {
  return state.pendingScheduleActions[taskKey] || null;
}

function setPendingScheduleAction(taskKey, payload) {
  if (!taskKey) {
    return;
  }
  if (payload) {
    state.pendingScheduleActions[taskKey] = payload;
  } else {
    delete state.pendingScheduleActions[taskKey];
  }
}

async function withPendingScheduleAction(taskKey, payload, action) {
  if (getPendingScheduleAction(taskKey)) {
    return;
  }

  setPendingScheduleAction(taskKey, payload);
  renderTaskList();
  try {
    return await action();
  } finally {
    setPendingScheduleAction(taskKey, null);
    renderTaskList();
  }
}

function createMetric(label, value) {
  const block = document.createElement("div");
  block.className = "task-metric";
  const caption = document.createElement("span");
  caption.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  block.append(caption, strong);
  return block;
}

function createActionButton(label, className, handler, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = options.loadingText && options.isLoading ? options.loadingText : label;
  if (options.disabled) {
    button.disabled = true;
  }
  if (options.title) {
    button.title = options.title;
  }
  if (options.isLoading) {
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
  }
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await handler(button);
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });
  return button;
}

function renderHero(paths) {
  if (paths) {
    state.paths = paths;
  }

  const resolvedPaths = state.paths || {};
  const selectedTask = getSelectedTask();
  const defaultTask = state.config
    ? getTaskByKey(state.config.defaultTaskKey)
    : null;
  const activeJob = getActiveJob();

  document.getElementById("selectedTaskName").textContent = selectedTask ? selectedTask.siteName : "未选择";
  document.getElementById("taskCount").textContent = String(getTasks().length);
  document.getElementById("defaultTaskName").textContent = defaultTask ? defaultTask.siteName : "未设置";
  document.getElementById("projectRoot").textContent = resolvedPaths.projectRoot || "-";
  document.getElementById("activeJobHeadline").textContent = activeJob
    ? `${activeJob.taskName || activeJob.taskKey || "任务"} · ${activeJob.name}`
    : "当前没有任务在运行";
}

function renderTaskList() {
  const container = document.getElementById("taskList");
  const tasks = getTasks();
  const defaultTaskKey = state.config ? state.config.defaultTaskKey : null;
  const activeJob = getActiveJob();
  container.innerHTML = "";

  if (!tasks.length) {
    container.className = "task-list empty-state";
    container.textContent = "还没有任务，先创建一个吧。";
    return;
  }

  container.className = "task-list";

  for (const task of tasks) {
    const scheduleSnapshot = getScheduleSnapshot(task);
    const configuredSchedule = scheduleSnapshot.configuredSchedule || getConfiguredSchedule(task);
    const scheduleTask = scheduleSnapshot.task || createEmptyScheduleTask();
    const scheduleStateMeta = getScheduleStateMeta(scheduleTask);
    const isRunningTask = activeJob && activeJob.status === "running" && activeJob.taskKey === task.key;
    const card = document.createElement("article");
    card.className = `task-card${isRunningTask ? " running" : ""}`;

    const top = document.createElement("div");
    top.className = "task-card-top";

    const titleWrap = document.createElement("div");
    titleWrap.className = "task-title-wrap";
    const taskKey = document.createElement("span");
    taskKey.className = "task-key-line";
    taskKey.textContent = task.key;
    const title = document.createElement("h3");
    title.className = "task-card-title";
    title.textContent = task.siteName || task.key;
    titleWrap.append(taskKey, title);

    const pendingScheduleAction = getPendingScheduleAction(task.key);
    const badgeWrap = document.createElement("div");
    badgeWrap.className = "task-badge-wrap";

    const taskRoleBadge = document.createElement("span");
    taskRoleBadge.className = `mini-pill${task.key === defaultTaskKey ? " active" : ""}`;
    taskRoleBadge.textContent = task.key === defaultTaskKey ? "默认任务" : "任务";

    const checkinTypeBadge = document.createElement("span");
    checkinTypeBadge.className = `task-type-pill ${task.checkin && task.checkin.type === "refresh" ? "refresh" : "button"}`;
    checkinTypeBadge.textContent = task.checkin && task.checkin.type === "refresh" ? "刷新签到" : "按钮签到";

    const scheduleBadge = document.createElement("span");
    scheduleBadge.className = `badge ${scheduleStateMeta.className}`;
    scheduleBadge.textContent = pendingScheduleAction ? pendingScheduleAction.text : scheduleStateMeta.text;

    badgeWrap.append(taskRoleBadge, checkinTypeBadge, scheduleBadge);
    if (isRunningTask) {
      badgeWrap.appendChild(Object.assign(document.createElement("span"), {
        className: "mini-pill active",
        textContent: "正在运行"
      }));
    }
    top.append(titleWrap, badgeWrap);

    const routeInfo = document.createElement("div");
    routeInfo.className = "task-route-info";
    const loginLine = document.createElement("p");
    loginLine.textContent = `登录页：${summarizeUrl(task.startUrl)}`;
    const checkinLine = document.createElement("p");
    checkinLine.textContent = `签到页：${summarizeUrl(task.checkin && task.checkin.openUrl)}`;
    routeInfo.append(loginLine, checkinLine);

    const scheduleInfo = document.createElement("div");
    scheduleInfo.className = "task-route-info task-schedule-info";
    const scheduleStateLine = document.createElement("p");
    scheduleStateLine.textContent = `定时状态：${pendingScheduleAction ? pendingScheduleAction.text : scheduleStateMeta.text}`;
    const scheduleTimeLine = document.createElement("p");
    scheduleTimeLine.textContent = `执行时间：${configuredSchedule.dailyTime || "09:00"}`;
    const scheduleTaskNameLine = document.createElement("p");
    scheduleTaskNameLine.textContent = `计划任务：${scheduleTask.taskName || configuredSchedule.taskName || "-"}`;
    const scheduleNextRunLine = document.createElement("p");
    scheduleNextRunLine.textContent = `下次运行：${scheduleTask.exists && scheduleTask.nextRunTime ? formatDateTime(scheduleTask.nextRunTime) : "-"}`;
    const scheduleLastRunLine = document.createElement("p");
    scheduleLastRunLine.textContent = `最近运行：${scheduleTask.exists && scheduleTask.lastRunTime ? formatDateTime(scheduleTask.lastRunTime) : "-"}`;
    scheduleInfo.append(
      scheduleStateLine,
      scheduleTimeLine,
      scheduleTaskNameLine,
      scheduleNextRunLine,
      scheduleLastRunLine
    );

    if (scheduleTask.error) {
      const scheduleErrorLine = document.createElement("p");
      scheduleErrorLine.className = "warning";
      scheduleErrorLine.textContent = `说明：${scheduleTask.error}`;
      scheduleInfo.append(scheduleErrorLine);
    }

    const jobLocked = Boolean(activeJob && activeJob.status === "running");
    const scheduleActionLocked = Boolean(pendingScheduleAction);

    const taskActions = document.createElement("div");
    taskActions.className = "task-actions";
    taskActions.append(
      createActionButton("编辑", "primary-button chip-button", () => {
        openEditTaskModal(task.key);
      }),
      createActionButton("复制", "secondary-button chip-button", (button) => (
        withButtonLoading(button, "正在复制...", () => duplicateTask(task.key))
      )),
      createActionButton("删除", "ghost-button danger-button chip-button", (button) => (
        withButtonLoading(button, "正在删除...", () => deleteTask(task.key))
      )),
      createActionButton("首次登录", "secondary-button chip-button", (button) => (
        withButtonLoading(button, "启动中...", () => runTaskAction(
          task.key,
          "/api/run/login-init",
          `已启动 ${task.siteName} 的登录初始化，请在弹出的浏览器里手动登录。`
        ))
      ), {
        disabled: jobLocked,
        title: jobLocked ? "当前已有任务在运行，请稍后再试。" : ""
      }),
      createActionButton("测试签到", "secondary-button chip-button", (button) => (
        withButtonLoading(button, "启动中...", () => runTaskAction(
          task.key,
          "/api/run/checkin-test",
          `已启动 ${task.siteName} 的有界面测试签到。`
        ))
      ), {
        disabled: jobLocked,
        title: jobLocked ? "当前已有任务在运行，请稍后再试。" : ""
      }),
      createActionButton("立即签到", "secondary-button chip-button", (button) => (
        withButtonLoading(button, "启动中...", () => runTaskAction(
          task.key,
          "/api/run/checkin-now",
          `已启动 ${task.siteName} 的立即签到。`
        ))
      ), {
        disabled: jobLocked,
        title: jobLocked ? "当前已有任务在运行，请稍后再试。" : ""
      })
    );

    const scheduleActionType = pendingScheduleAction ? pendingScheduleAction.type : scheduleStateMeta.action;
    if (!scheduleActionType) {
      taskActions.append(
        createActionButton("查询中...", "secondary-button chip-button", () => Promise.resolve(), {
          disabled: true,
          title: "系统正在查询这个任务的定时状态，请稍候。"
        })
      );
    } else if (scheduleActionType === "delete") {
      taskActions.append(
        createActionButton("删除定时", "secondary-button chip-button", () => (
          withPendingScheduleAction(task.key, {
            type: "delete",
            text: "删除中..."
          }, () => deleteSchedule(task.key))
        ), {
          disabled: scheduleActionLocked,
          isLoading: scheduleActionLocked,
          loadingText: pendingScheduleAction ? pendingScheduleAction.text : null,
          title: scheduleActionLocked ? "当前正在处理这个任务的定时操作，请稍候。" : ""
        })
      );
    } else {
      taskActions.append(
        createActionButton("启用定时", "primary-button chip-button", () => (
          withPendingScheduleAction(task.key, {
            type: "apply",
            text: "启用中..."
          }, () => applySchedule(task.key))
        ), {
          disabled: scheduleActionLocked,
          isLoading: scheduleActionLocked,
          loadingText: pendingScheduleAction ? pendingScheduleAction.text : null,
          title: scheduleActionLocked ? "当前正在处理这个任务的定时操作，请稍候。" : ""
        })
      );
    }

    taskActions.append(
      createActionButton("查看日志", "ghost-button chip-button", () => openViewer(task.key, "logs")),
      createActionButton("查看截图", "ghost-button chip-button", () => openViewer(task.key, "artifacts"))
    );

    card.append(top, routeInfo, scheduleInfo, taskActions);
    container.appendChild(card);
  }

  const defaultTask = tasks.find((task) => task.key === defaultTaskKey);
  document.getElementById("defaultTaskBadge").textContent = defaultTask ? `默认任务 · ${defaultTask.siteName}` : "默认任务";
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
  output.textContent = activeJob.outputLines && activeJob.outputLines.length
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

function renderLogItems(container, items) {
  if (!items || !items.length) {
    container.className = "viewer-body empty-state";
    container.textContent = "这个任务还没有日志。";
    return;
  }

  container.className = "viewer-body";
  const list = document.createElement("div");
  list.className = "log-list";

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
    list.appendChild(article);
  }

  container.replaceChildren(list);
}

function renderArtifactItems(container, items) {
  if (!items || !items.length) {
    container.className = "viewer-body empty-state";
    container.textContent = "这个任务还没有截图。";
    return;
  }

  container.className = "viewer-body";
  const grid = document.createElement("div");
  grid.className = "artifact-grid";

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
    grid.appendChild(link);
  }

  container.replaceChildren(grid);
}

async function openViewer(taskKey, kind) {
  focusTask(taskKey);
  openViewerShell(taskKey, kind);
  const container = document.getElementById("viewerBody");
  let items;

  try {
    const payload = await apiFetch(`/api/task-assets?taskKey=${encodeURIComponent(taskKey)}&kind=${encodeURIComponent(kind)}`, {
      method: "GET"
    });
    items = payload.items || [];
  } catch (error) {
    if (error.message !== legacyApiNotFoundMessage) {
      throw error;
    }
    items = getFallbackViewerItems(taskKey, kind);
  }

  if (kind === "artifacts") {
    renderArtifactItems(container, items);
  } else {
    renderLogItems(container, items);
  }
}

async function refreshStatus() {
  const selectedTask = getSelectedTask();
  const query = selectedTask ? `?taskKey=${encodeURIComponent(selectedTask.key)}` : "";
  const payload = await apiFetch(`/api/status${query}`, { method: "GET" });
  state.statusSnapshot = payload;
  renderHero(payload.paths || {});
  renderJob(payload.activeJob);
  renderHistory(payload.jobHistory || []);
  renderTaskList();
}

async function loadSchedules() {
  state.scheduleLoadState = "loading";
  renderTaskList();
  try {
    const payload = await apiFetch("/api/schedules", { method: "GET" });
    hydrateScheduleMap(payload.schedules || []);
  } catch (error) {
    if (error.message !== legacyApiNotFoundMessage) {
      throw error;
    }

    const tasks = getTasks();
    const entries = await Promise.all(tasks.map(async (task) => {
      try {
        const payload = await apiFetch(`/api/schedule?taskKey=${encodeURIComponent(task.key)}`, { method: "GET" });
        return toScheduleEntry(task, payload);
      } catch (singleError) {
        return {
          taskKey: task.key,
          taskName: task.siteName,
          configuredSchedule: getConfiguredSchedule(task),
          task: createEmptyScheduleTask({
            state: "Error",
            error: singleError.message
          })
        };
      }
    }));
    hydrateScheduleMap(entries);
  } finally {
    state.scheduleLoadState = "loaded";
  }

  renderTaskList();
}

async function loadConfig() {
  state.config = await apiFetch("/api/config", { method: "GET" });
  ensureSelectedTaskKey();
  if (!Object.keys(state.scheduleMap).length) {
    state.scheduleLoadState = "loading";
  }
  renderHero();
  renderTaskList();
}

async function persistConfig({ message, refreshStatusAfter = true, refreshSchedulesAfter = true } = {}) {
  const response = await apiFetch("/api/config", {
    method: "POST",
    body: JSON.stringify(state.config)
  });
  state.config = response.config;
  ensureSelectedTaskKey();
  renderHero();
  renderTaskList();
  if (message) {
    setFlashMessage(message, "success");
  }

  const jobs = [];
  if (refreshStatusAfter) {
    jobs.push(refreshStatus());
  }
  if (refreshSchedulesAfter) {
    jobs.push(loadSchedules());
  }
  if (jobs.length) {
    await Promise.all(jobs);
  }
}

async function saveEditedTask() {
  if (!state.editingTaskKey) {
    throw new Error("没有正在编辑的任务。");
  }

  const tasks = getTasks();
  const index = tasks.findIndex((task) => task.key === state.editingTaskKey);
  if (index === -1) {
    throw new Error("当前任务不存在，无法保存。");
  }

  const updatedTask = collectEditedTaskFromForm();
  state.config.tasks[index] = updatedTask;
  state.selectedTaskKey = updatedTask.key;
  await persistConfig({ message: "当前任务修改已保存。" });
  closeEditTaskModal();
}

async function addTaskFromModal() {
  const formValues = collectAddTaskForm();
  const task = createTaskFromModalInput(formValues);
  state.config.tasks.push(task);
  state.selectedTaskKey = task.key;
  await persistConfig({ message: "已新增任务。" });
  closeAddTaskModal();
  openEditTaskModal(task.key);
}

async function duplicateTask(taskKey) {
  const sourceTask = getTaskByKey(taskKey);
  if (!sourceTask) {
    throw new Error("要复制的任务不存在。");
  }
  const task = createTaskDraft(sourceTask);
  state.config.tasks.push(task);
  state.selectedTaskKey = task.key;
  await persistConfig({ message: "已复制当前任务，新任务会使用独立的资料目录和计划任务名。" });
}

async function deleteTask(taskKey) {
  if (getTasks().length <= 1) {
    throw new Error("至少需要保留一个任务。");
  }

  const task = getTaskByKey(taskKey);
  if (!task) {
    throw new Error("要删除的任务不存在。");
  }

  const confirmed = window.confirm(`确认删除任务“${task.siteName}”吗？如果它已经挂了计划任务，系统中的计划任务也会一并删除。`);
  if (!confirmed) {
    return;
  }

  await apiFetch("/api/schedule/delete", {
    method: "POST",
    body: JSON.stringify({ taskKey })
  }).catch(() => {
    // Ignore missing scheduled task and continue deleting the config entry.
  });

  const remainingTasks = getTasks().filter((item) => item.key !== taskKey);
  state.config.tasks = remainingTasks;
  if (state.config.defaultTaskKey === taskKey) {
    state.config.defaultTaskKey = remainingTasks[0].key;
  }
  state.selectedTaskKey = remainingTasks[0].key;
  await persistConfig({ message: "任务已删除。" });
}

async function runTaskAction(taskKey, path, successMessage) {
  focusTask(taskKey);
  const response = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify({ taskKey })
  });
  setFlashMessage(successMessage, "success");
  renderJob(response.job);
  await refreshStatus();
}

async function applySchedule(taskKey) {
  focusTask(taskKey);
  await apiFetch("/api/schedule/apply", {
    method: "POST",
    body: JSON.stringify({ taskKey })
  });
  await loadSchedules();
  setFlashMessage("该任务的定时任务已启用。", "success");
}

async function deleteSchedule(taskKey) {
  focusTask(taskKey);
  await apiFetch("/api/schedule/delete", {
    method: "POST",
    body: JSON.stringify({ taskKey })
  });
  await loadSchedules();
  setFlashMessage("该任务的定时任务已删除。", "success");
}

async function refreshDashboard({ showFeedback = false } = {}) {
  await Promise.all([refreshStatus(), loadSchedules()]);
  if (showFeedback) {
    setFlashMessage(`刷新成功 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`, "success");
  }
}

function bindEvents() {
  document.getElementById("refreshButton").addEventListener("click", async () => {
    if (state.isManualRefreshing) {
      return;
    }
    state.isManualRefreshing = true;
    try {
      await withButtonLoading("refreshButton", "刷新中...", () => refreshDashboard({ showFeedback: true }));
    } catch (error) {
      setFlashMessage(error.message, "error");
    } finally {
      state.isManualRefreshing = false;
    }
  });

  document.getElementById("addTaskButton").addEventListener("click", () => {
    openAddTaskModal();
  });

  document.getElementById("addTaskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withButtonLoading("confirmAddTaskButton", "正在创建...", addTaskFromModal);
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("cancelAddTaskButton").addEventListener("click", () => {
    closeAddTaskModal();
  });

  document.getElementById("closeAddTaskButton").addEventListener("click", () => {
    closeAddTaskModal();
  });

  document.getElementById("addTaskModal").addEventListener("click", (event) => {
    if (event.target.dataset.closeAddTask === "true") {
      closeAddTaskModal();
    }
  });

  document.getElementById("editTaskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withButtonLoading("saveTaskButton", "保存中...", saveEditedTask);
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  });

  document.getElementById("closeEditTaskButton").addEventListener("click", () => {
    closeEditTaskModal();
  });

  document.getElementById("editTaskModal").addEventListener("click", (event) => {
    if (event.target.dataset.closeEditTask === "true") {
      closeEditTaskModal();
    }
  });

  document.getElementById("closeViewerButton").addEventListener("click", () => {
    closeViewerModal();
  });

  document.getElementById("viewerModal").addEventListener("click", (event) => {
    if (event.target.dataset.closeViewer === "true") {
      closeViewerModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (isModalOpen("viewerModal")) {
      closeViewerModal();
      return;
    }

    if (isModalOpen("editTaskModal")) {
      closeEditTaskModal();
      return;
    }

    if (isModalOpen("addTaskModal")) {
      closeAddTaskModal();
    }
  });
}

async function bootstrap() {
  bindEvents();
  await loadConfig();
  await refreshDashboard();
  state.pollTimer = window.setInterval(() => {
    refreshStatus().catch(() => {
      // Keep polling even if one request fails.
    });
  }, 2000);
  state.schedulePollTimer = window.setInterval(() => {
    loadSchedules().catch(() => {
      // Keep polling even if one request fails.
    });
  }, 15000);
}

bootstrap().catch((error) => {
  setFlashMessage(error.message, "error");
});
