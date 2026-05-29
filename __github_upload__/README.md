# Auto Check-in

这个小工程现在支持 `多个网页签到任务`，每个任务都可以有自己独立的：

- 登录态目录
- 登录成功/掉登录判断
- 签到方式（按钮签到 / 刷新签到）
- 计划任务名称
- 每日执行时间

## 目录说明

- `checkin.config.js`: 多任务配置文件
- `checkin.config.local.js`: 你本机私有配置，默认不提交到 GitHub
- `scripts/init-login.js`: 首次手动登录并保存指定任务的登录态
- `scripts/run-checkin.js`: 运行指定任务的自动签到
- `run-daily-checkin.ps1`: 给 Windows 计划任务调用的入口
- `scripts/web-ui-server.js`: 本地 Web UI 服务
- `logs/`: 每次运行日志
- `artifacts/`: 每次运行截图

## 1. 安装依赖

```powershell
cd C:\Users\yhllsz\Desktop\auto-checkin
npm install
```

## 2. 启动可视化控制台

```powershell
npm run ui:start
```

打开浏览器访问 `http://127.0.0.1:3210`。

如果你更想双击启动，也可以运行 [start-web-ui.cmd](C:/Users/yhllsz/Desktop/auto-checkin/start-web-ui.cmd)。

## 3. Web UI 现在怎么用

新的页面布局分成三块：

- 左侧：任务列表，可以新增、复制、删除任务
- 中间：当前任务配置
- 右侧：当前任务的操作面板、定时任务、当前运行状态、最近运行

也就是说：

- 你先在左侧切换到某个任务
- 再在中间改这个任务的地址、选择器、计划时间
- 右侧的“首次登录 / 测试签到 / 立即签到 / 定时任务”都会只作用于当前任务

## 4. 配置文件结构

公开仓库里的 `checkin.config.js` 是示例配置。

你本机如果存在 `checkin.config.local.js`，脚本会优先读取它；这也是推荐的日常使用方式，因为这样可以把你真实站点地址、任务名和个人选择器保留在本地，不会被提交到公开仓库。

`checkin.config.js` 示例结构是这样的：

```js
module.exports = {
  defaultTaskKey: "task-a",
  tasks: [
    {
      key: "task-a",
      siteName: "站点 A",
      browserChannel: "chrome",
      startUrl: "https://example.com/login",
      userDataDir: "./data/task-a-profile",
      headlessOnSchedule: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 15000,
      loginInitTimeoutMs: 600000,
      loginState: {
        loggedInSelectors: ['text="退出登录"'],
        loggedOutSelectors: ['text="登录"']
      },
      checkin: {
        openUrl: "https://example.com/checkin",
        type: "button",
        refreshSuccessMode: "selector",
        beforeClickSelectors: [],
        buttonSelectors: ['text="签到"'],
        successSelectors: ['text="签到成功"'],
        alreadyDoneSelectors: ['text="今日已签到"'],
        waitAfterActionMs: 3000
      },
      schedule: {
        taskName: "AutoCheckin-task-a",
        dailyTime: "09:00"
      }
    }
  ]
};
```

其中最重要的字段：

- `defaultTaskKey`: 命令行不传 `--task` 时默认执行哪个任务
- `tasks[].key`: 任务唯一标识
- `tasks[].userDataDir`: 这个任务自己的浏览器资料目录
- `tasks[].schedule.taskName`: 这个任务自己的 Windows 计划任务名
- `tasks[].schedule.dailyTime`: 这个任务自己的每日执行时间

推荐做法：

1. 保留仓库里的 `checkin.config.js` 作为模板
2. 在本机维护自己的 `checkin.config.local.js`
3. Web UI 保存配置时，也会优先写入 `checkin.config.local.js`

## 5. 刷新签到与按钮签到

### 按钮签到

```js
checkin: {
  type: "button"
}
```

会找 `buttonSelectors`，点按钮后再用 `successSelectors` / `alreadyDoneSelectors` 判断结果。

### 刷新签到

```js
checkin: {
  type: "refresh",
  refreshSuccessMode: "page_load"
}
```

会先打开签到页判断一次，如果还没出现完成状态，就再主动刷新一次页面。

`refreshSuccessMode` 有两种：

- `selector`: 必须命中成功文案
- `page_load`: 只要刷新成功且没有掉登录，就算签到成功

## 6. 首次登录某个任务

默认任务：

```powershell
npm run login:init
```

指定任务：

```powershell
node .\scripts\init-login.js --task anyrouter123
```

也可以直接在 Web UI 左侧切到目标任务后，点击右侧“首次登录并保存登录态”。

## 7. 手工测试某个任务

默认任务：

```powershell
npm run checkin:test
```

指定任务：

```powershell
node .\scripts\run-checkin.js --task anyrouter123 --headed
```

## 8. 立即执行某个任务

默认任务：

```powershell
npm run checkin:run
```

指定任务：

```powershell
node .\scripts\run-checkin.js --task anyrouter123
```

## 9. 定时任务怎么挂

现在推荐直接在 Web UI 操作：

1. 左侧选中某个任务
2. 中间填好 `计划任务名称` 和 `每日执行时间`
3. 右侧点击“保存并启用当前任务”

每个任务都能单独挂一个 Windows 计划任务，不会互相覆盖。

计划任务真正执行时，会调用：

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\Users\yhllsz\Desktop\auto-checkin\run-daily-checkin.ps1" -TaskKey "your-task-key"
```

## 10. 常见情况

- 某个站点掉登录了：切到这个任务，重新执行“首次登录并保存登录态”
- 两个站点不能共用登录：给它们不同的 `userDataDir`
- 页面不显示“签到成功”文案：把刷新签到的 `refreshSuccessMode` 改成 `page_load`
- 某个任务临时测试失败：先点“有界面测试签到”，再看右侧运行状态、底部日志和截图
- 旧版 Web UI 还在占 `3210` 端口：先关掉旧终端，再重新运行 `npm run ui:start`

## 11. 选择器怎么找

1. 打开浏览器开发者工具
2. 用元素检查器点中签到按钮或成功提示
3. 优先用稳定文本，比如 `text="签到成功"`
4. 如果文本不稳定，再用按钮类名或属性，比如 `button:has-text("签到")`
