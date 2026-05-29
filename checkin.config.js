module.exports = {
  defaultTaskKey: "demo-task",
  tasks: [
    {
      key: "demo-task",
      siteName: "演示签到任务",
      browserChannel: "chrome",
      startUrl: "https://example.com/login",
      userDataDir: "./data/demo-task-profile",
      headlessOnSchedule: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 15000,
      loginInitTimeoutMs: 600000,
      loginState: {
        loggedInSelectors: [
          "text=\"退出登录\"",
          "text=\"个人中心\""
        ],
        loggedOutSelectors: [
          "text=\"登录\"",
          "input[type=\"password\"]"
        ]
      },
      checkin: {
        openUrl: "https://example.com/checkin",
        type: "refresh",
        refreshSuccessMode: "page_load",
        beforeClickSelectors: [],
        buttonSelectors: [
          "text=\"签到\"",
          "button:has-text(\"签到\")"
        ],
        successSelectors: [
          "text=\"签到成功\"",
          "text=\"今日已签到\""
        ],
        alreadyDoneSelectors: [
          "text=\"已签到\"",
          "text=\"今日已完成\""
        ],
        waitAfterActionMs: 3000
      },
      schedule: {
        taskName: "AutoCheckin-demo-task",
        dailyTime: "09:00"
      }
    }
  ]
};
