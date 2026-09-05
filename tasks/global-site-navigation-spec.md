# Spec: LobeHub 全站导航

## Objective

将公开官网现有的“旅游群”共享导航直接挂载为 LobeHub Web 全局外壳，覆盖桌面 Web、手机 Web、认证页、分享页和工作台页。导航结构、链接、桌面菜单、手机抽屉、分享和主题行为都以 `website/assets` 为唯一来源，不在 LobeHub 复制第二套实现。

## Tech Stack

- React 19 + TypeScript（仅负责挂载共享外壳）
- 官网 `site-shell.js` / `site-navigation.css`
- 官网 `theme-switcher.js` / `site-share.js`
- `next-themes`（同步 LobeHub 与官网主题状态）

## Commands

- 聚焦检查：`bun run check <changed-files...>`
- 共享资源路由：`node --test website/tests/unified-dev-resilience.spec.mjs`
- 真实页面：复用已运行的 `http://localhost:3010/lobehub/` 统一入口

## Project Structure

- `src/features/TravelSiteNavigation/` — 全局导航、响应式菜单与页面外壳
- `src/spa/entry.{web,mobile,auth}.tsx` — LobeHub 主要 Web 入口
- `apps/{share,workbench}/src/entry.tsx` — 独立 Web 外壳入口

## Code Style

```tsx
<TravelSiteShell>
  <RouterProvider router={router} />
</TravelSiteShell>
```

React 组件只提供挂载点和内容占位；所有导航 DOM、链接、菜单与交互由官网共享脚本生成，不引入新依赖。

## Testing Strategy

- 路由测试：即使请求来自 `/lobehub/` 页面，`/assets/*` 仍由官网资源服务器提供。
- 入口聚焦检查：五个 Web 入口共用同一外壳。
- 真实浏览器：桌面与手机检查认证页和错误页，验证官网原版菜单、分享、明暗主题、无横向溢出和菜单开关。

## Boundaries

- Always: 保留 LobeHub 原页面布局和路由历史；导航内容只修改官网共享源；LobeHub 不复制导航数据或样式。
- Ask first: 改官网信息架构、新增依赖、改 Electron 原生窗口。
- Never: 将桌面菜单压缩到手机；依赖 hover 才能操作；修改外部 OAuth 提供商页面。

## Success Criteria

1. 五个 LobeHub Web 入口共用同一导航外壳。
2. 桌面直接显示官网当前的首页、案例、产品、服务和右侧全部操作。
3. 手机直接显示官网当前的紧凑头部和移动抽屉，320px 宽无横向溢出。
4. 主题切换同时更新 LobeHub `theme` 和官网 `techarin-color-theme` 偏好。
5. 导航固定占位，LobeHub 内容区获得剩余高度，不遮挡侧栏、表单或底部操作。

## Open Questions

无。用户已确认包括手机端；官网页脚不重复插入 LobeHub 应用内部，Electron 客户端和独立弹窗不属于 Web 全站导航范围。
