# Google 登录与 Drive：桌面直连

当前版本不再需要 Supabase、数据库或云端函数来使用 Google 登录和 Drive。登录流程为：**点击 Google → 系统浏览器选择账号并授权 → 返回 Recordly → 管理自己的 Drive 文件**。

首次需要为这个应用配置一次 Google OAuth 客户端。普通使用者在应用已内置客户端配置后，只需点击登录；你自己开发和使用时，可以在应用里导入 Google 下载的 JSON。

## 一次性配置（个人测试）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择项目。
2. 在 **API 和服务 → 库** 中找到 **Google Drive API**，点击启用。
3. 进入 **Google Auth Platform**，设置应用名称（如 My Recordly）、支持邮箱和联系邮箱。
4. 在 Audience 设置受众；个人 Google 账号通常使用 External。测试状态下，把准备登录的 Google 邮箱加入 Test users。
5. 在 Data Access 添加 `openid`、`userinfo.email`、`userinfo.profile` 和 `https://www.googleapis.com/auth/drive.file`。
6. 在 **Clients → Create client** 选择 **Desktop app（桌面应用 / 电脑版应用程式）**，名称可填 `Recordly Desktop`。这里不是 Web application。
7. 创建后下载客户端 JSON，根节点应为 `installed`。不要使用 API key、service account 或 Web 客户端 JSON。
8. 打开 **Recordly 最新开发版 → 登录 → 导入 Google 桌面客户端 JSON**，选择下载的文件。
9. 点击 **Google**，在系统浏览器选账号并允许 Drive 文件权限，然后回到应用。无需 Supabase 项目、`.env.local` 或手工设置回调端口。

应用会自动使用空闲本机端口接收回调，以 PKCE 和随机 state 绑定本次授权。账号密码只在 Google 官方页面输入。等待期间可点击“取消浏览器登录”。

## 使用

- **共享 → Google Drive**：查看 Recordly 文件夹，上传/下载素材，新建文件夹、重命名、移入 Google 回收站。
- **导出 → Google Drive → 保存到 Google Drive**：渲染成片后直传自己的网盘，支持进度与取消。
- **管理访问权限**：按邮箱邀请查看者/编辑者、移除直接权限、开启/关闭链接查看。文件夹继承权限也会应用到子文件，需在源文件夹修改。
- **退出 / 断开连接**：删除本机 Google 会话，不删除网盘文件。要撤销 Google 侧授权，可在 [Google 账号连接](https://myaccount.google.com/connections) 中移除应用。

新建的 Recordly 根文件夹默认没有公开权限，上传不会自动开启分享；共享过父文件夹后，新文件会继承共享权限。

## 本机保存与发布

导入配置位于应用用户数据目录。Windows 开发版为 `%APPDATA%\Recordly-dev\google-oauth-desktop.json`，安装版使用自己的 Recordly 用户数据目录。

Google access token / refresh token 由 Electron 主进程管理，通过系统凭据加密保存在 `google-session.bin`。渲染界面只收到账号资料、状态和一次性传输票据，不收到 Google token。令牌到期时自动续期，授权被撤销时提示重新登录。

系统无法提供有效加密时使用内存会话并显示提示，重启后需重新登录，不将 token 明文写盘。登录页的“更换 Google 客户端配置”可重新导入；更换客户端会退出旧 Google 会话。

发布版可在构建前放入 `public/google-oauth-desktop.json`，构建时复制到应用资源，使用者无需自己导入。它是桌面 OAuth 应用标识配置；不要放入 Supabase service-role key 或服务账号私钥。用户自己导入的配置优先于内置配置。

## 范围与排错

- `drive.file` 访问应用创建或用户明确授权的文件，不扫描整个网盘。直接在 Drive 网页拖入文件夹的已有文件不一定可见，请使用应用内上传入口。
- 当前覆盖成片和素材，不自动同步可编辑项目。`.recordly` 引用本机素材路径，单独上传无法跨机器还原项目。
- 上传失败后可以重试，暂不跨应用重启续传。视频流式传输，不整体载入 JS 内存。
- 客户端 JSON 不正确：确认创建的是 Desktop app，并重新下载。
- Google 不允许该用户：把邮箱加入同一项目的测试用户。组织账号可能受 Workspace 管理员限制。
- `invalid_client`：确认客户端有效、未被删除或禁用，再重新导入。
- Drive 权限不足：重新点击 Google 并允许访问 Recordly 使用的 Drive 文件。
- 测试模式下含离线权限的 refresh token 通常七天到期，重新登录即可；面向他人发布时按 Google 要求配置受众、发布状态与验证。
- 邮箱、Microsoft、GitHub、旧 Recordly Share/反馈服务仍为可选 Supabase 功能。Google 桌面会话不会被当成 Supabase token。只用 Google + Drive 无需配置这些服务，未配置时旧分享入口不显示。

本地验证使用模拟 Google 响应和真实本机 HTTP 回调，覆盖 OAuth、PKCE、取消、刷新、账号隔离、权限和流式传输。真实 Google 联调需创建并导入客户端后进行；本次没有创建项目、导入你的凭据或访问真实网盘文件。

参考：[Google 桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Drive 权限范围](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Drive 分享权限](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。
