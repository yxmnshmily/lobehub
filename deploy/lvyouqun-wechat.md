# 旅游群网：服务器微信登录配置

- 网站入口：`https://lvyouqun.com/lobehub/`
- 微信开放平台「网站应用 → 授权回调域」：`lvyouqun.com`（不填协议、端口或路径）。
- 服务器环境变量：合并同目录 `lvyouqun-wechat.env.example`，保留已有数据库、存储、AUTH_SECRET 和其他配置；已有其他 SSO 提供商时，在列表中追加 `wechat`，不要覆盖。
- 微信 AppID / Secret 必须属于该已审核的网站应用；密钥只放服务器环境，不写进仓库。

## 部署要求

1. 域名解析到服务器并启用有效 HTTPS 证书。统一从上述域名进入登录页，不从 IP、localhost 或 www 别名发起登录。
2. 反向代理保留 `/lobehub` 挂载规则，正确传递 Host 和 HTTPS 协议信息；认证请求和回调转发到同一应用，不缓存认证接口。
3. 应用读取 `APP_URL=https://lvyouqun.com/lobehub` 后重新启动。不要在服务器运行项目根的 `scripts/unified-dev-server.mjs`：它是本地开发启动器，会覆盖 APP_URL 为回环地址。
4. 不要只单独硬改 redirect_uri；授权入口、回调和会话必须使用一致的公开域名。前端现在保留服务器生成的地址，不根据访问者 Host 改写。

## 上线验收（本地尚未执行）

- 检查微信授权请求中的 `redirect_uri` 为 `https://lvyouqun.com/lobehub/api/auth/callback/wechat`，`scope` 为 `snsapi_login`。
- 扫码、确认授权后回到同域网站；刷新后仍保持登录，不能出现 state / Cookie 错误。
- 分别验证桌面浏览器与手机微信内打开，确认回调后弹窗关闭并进入预期页面。
- 本地 localhost / 局域网地址没有登记为微信授权回调域，不能用它们验证真实微信登录。当前只完成域名配置准备和代码回归，不代表已经上线或通过扫码验收。
