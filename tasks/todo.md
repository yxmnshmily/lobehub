# LobeHub 全站导航任务

- [x] 先锁定 LobeHub 引用官网共享资源的路由回归
  - Acceptance: LobeHub Referer 下的 `/assets/*` 仍路由到官网服务
  - Verify: `node --test website/tests/unified-dev-resilience.spec.mjs`
- [x] 直接挂载官网共享导航和页面外壳
  - Acceptance: LobeHub 不含复制的导航数据和菜单样式；桌面/手机菜单、分享和主题由官网脚本执行
  - Verify: JS 语法、资源路由测试和 LobeHub 聚焦检查通过
- [x] 挂载五个 Web 入口
  - Acceptance: 主 Web、手机 Web、认证、分享、工作台使用同一外壳
  - Verify: `bun run check` 覆盖变更文件
- [x] 真实浏览器验收
  - Acceptance: 桌面和 320–390px 手机无遮挡、无溢出，官网菜单、分享和主题可用；认证/错误页均出现同一导航
  - Verify: 更新后网关行为的同一轮 Chrome 批量检查
