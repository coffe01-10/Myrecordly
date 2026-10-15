# Google 登录与 Drive 存储

Recordly 沿用 Supabase Auth 登录，在 Google 授权时额外申请 `drive.file` 和离线访问权限。成片和手动上传的素材保存到用户自己 Drive 中的 **Recordly** 文件夹，存储空间计入该 Google 账号。

“共享”页面现在有 **Google Drive / Recordly Share** 两个入口。Drive 支持上传、下载、新建文件夹、重命名、移入回收站、按邮箱邀请查看者或编辑者、移除权限，以及开启/关闭链接查看。导出面板选择 **Google Drive → 保存到 Google Drive**，会先渲染成片，再上传；临时成片在结束或取消后清理。上传不会自动创建公开权限。

## 架构与会话

```text
系统浏览器 → Google OAuth → Supabase Auth → Recordly PKCE 回调
                                                ↓
                                   google-drive Edge Function
                                   校验应用会话 / Google 令牌续期
                                                ↓
                                   用户自己的 Google Drive

Electron 主进程 ← 短期 Google 令牌 + 上传会话 → Drive 流式传输
```

Google Client Secret 和长期 refresh token 不编译进桌面应用。连接记录存放在 Supabase 的 `google_drive_connections`，按 Supabase 用户 ID 分开；表禁止匿名和普通登录客户端直接读写，只允许服务端使用。函数通过 `auth.getUser` 验证调用者，使用该用户的连接操作 Drive。桌面在连接时转交初始授权信息，传输时获得短期令牌。视频字节从本机直传 Google，不经过 Supabase 函数或存储桶。

Google 授权和 Recordly 登录是两种会话。重新打开应用后保留 Recordly 登录，服务端在 Google 令牌过期时续期；Google 撤销授权后提示重新连接。退出 Recordly 结束应用登录；“断开连接”删除服务端连接，不删除云端文件。要撤销 Google 侧授权，可在 [Google 账号第三方连接](https://myaccount.google.com/connections) 中移除 Recordly。

## 1. Google 项目

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建项目，启用 **Google Drive API**。
2. 在 **Google Auth Platform** 配置品牌、支持邮箱、受众。个人测试阶段添加自己的 Google 邮箱为测试用户。
3. 在 Data Access 添加 `openid`、`userinfo.email`、`userinfo.profile` 和 `https://www.googleapis.com/auth/drive.file`。
4. 创建 **Web application** 类型的 OAuth Client。这里由 Supabase 接收 Google 回调，因此不是 Desktop 类型。
5. 添加授权重定向 URI：`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`。创建 Supabase 项目后从其 Google Provider 页面复制实际值。
6. 保存 Client ID / Client Secret，填入 Supabase Provider 和下文函数 Secrets。不要写进 Git、`VITE_*` 变量或发到聊天中。

`drive.file` 只访问应用创建或用户明确授权给应用的文件，不扫描整个个人网盘。本版本通过应用内上传管理素材；直接在 Drive 网页拖进 Recordly 文件夹的已有文件，不一定对此权限可见。Google Picker 和全盘访问不属于本版本。

## 2. Supabase 项目与登录

1. 创建项目，在 API 设置取得 Project URL 和 publishable key。
2. 将仓库 `.env.example` 复制为 `.env.local`，填写：

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

3. 在 **Authentication → Sign In / Providers → Google** 启用 Google，填写同一个 Web Client 的 ID 和 Secret。
4. 在 **Authentication → URL Configuration → Redirect URLs** 添加：

   ```text
   http://127.0.0.1:43821/auth/callback
   recordly://auth/callback
   ```

本地开发用 loopback 回调；安装版用应用注册的 `recordly://` 协议。邮箱登录继续可用，但连接 Google 后才能操作 Drive。本地演示账号没有云端权限。

## 3. 部署 Drive 服务

在 Supabase SQL Editor 执行 [202610150001_google_drive.sql](../services/supabase/migrations/202610150001_google_drive.sql)。不要另加普通用户可读 token 的策略。

在 Dashboard 的 **Edge Functions → Secrets** 添加 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，值与登录 Provider 中的 Web Client 相同。托管函数默认提供 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，它们仅供服务端使用。

在仓库根目录执行：

```powershell
supabase login
supabase functions deploy google-drive --workdir services --project-ref YOUR_PROJECT_REF
```

`services/supabase/config.toml` 已设置函数网关 `verify_jwt = false`，由函数自行验证 Supabase 会话，内部的 `auth.getUser` 认证仍然必须通过。

Drive 不需要 Cloudflare Worker 或 `VITE_CLOUD_SHARE_ENDPOINT`。原有 Recordly Share 的评论/观看页面仍使用其原来的服务。

## 4. 本机使用

配置 `.env.local` 后重启开发应用。用桌面的“Recordly 最新开发版”快捷方式打开；若已有旧实例，先正常退出再打开，以载入环境配置。

1. 点击 Google 登录，在系统浏览器授权后回到应用。“共享 → Google Drive”应显示真实 Google 邮箱和 Recordly 文件夹。
2. 录制短视频并编辑，选择“导出 → Google Drive → 保存到 Google Drive”，成功后在 Drive 网页播放。
3. 上传素材、新建/进入文件夹、重命名、下载并打开本地文件。移入回收站后，可在 Drive 网页恢复。
4. 邀请另一邮箱为查看者，并用该邮箱打开链接；要改为编辑者可先移除再邀请。开启链接查看后用未登录浏览器访问；移除“任何拥有链接的人”后应重新受限。
5. 重启后应保持连接。Google 撤销授权后，再次操作应提示重新连接。

文件夹继承权限也会应用到子文件；继承权限需在源文件夹中修改。移除直接权限不保证移除经由文件夹或群组获得的权限。Google Workspace 组织策略可能禁止外部分享，应用显示 Google 返回的原因。

## 当前边界与排错

- 这是成片/素材文件管理体系，不自动同步可编辑项目。`.recordly` 引用本机素材路径，单独上传无法在另一台机器还原项目，因此上传入口仅列出支持的视频和 GIF；可移植项目打包需另行实现。
- 上传使用 Google resumable session 流式发送，支持进度与取消。网络中断后可重新上传；不跨应用重启恢复未完成上传。大视频不会整体读入 JS 内存。
- 新文件遵循目标文件夹权限；新建 Recordly 根文件夹通常私有。若共享过父文件夹，后续上传的文件会继承共享。
- “尚未配置 Google 登录”：检查 `.env.local` 并重启。
- Drive 服务不可用：检查 SQL 迁移、函数部署和服务端 OAuth Secrets。
- `redirect_uri_mismatch`：Google 配置中应填写 Supabase 回调，不是桌面回调。
- 需要重新连接：重新走 Google 授权。测试模式下含离线访问的 Google refresh token 通常七天到期；长期使用需按 Google 要求配置发布状态。
- 看不到其他网盘文件：这是 `drive.file` 的范围，使用应用内上传入口。

本地测试覆盖账号隔离、续期/撤销、私有上传、分页、分享权限、账号切换取消、流式传输和下载失败保护。本次未配置真实 Google/Supabase 项目，真实 OAuth、函数部署和 Google 落盘/分享尚未执行，不视为已实测通过。

参考：[Supabase Google 登录](https://supabase.com/docs/guides/auth/social-login/auth-google)、[Google Drive 权限范围](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[上传文件](https://developers.google.com/workspace/drive/api/guides/manage-uploads)、[分享权限](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。
