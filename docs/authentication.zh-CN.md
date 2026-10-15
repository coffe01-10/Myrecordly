语言: [EN](authentication.md) | 简中

# Recordly 身份验证设置

Google 登录与 Drive 使用桌面 OAuth 直连，无需 Supabase，首次在应用里导入 Desktop app 客户端 JSON 即可。参见 [Google 桌面登录配置](google-drive.zh-CN.md)。以下 Supabase 设置仅用于可选的邮箱、Microsoft、GitHub 和旧云端服务，其会话与 Google 桌面会话分开。

## 1. 创建项目

1. 创建一个 Supabase 项目。
2. 在 **Project settings → API** 中，复制项目 URL 和可发布密钥（publishable key）。
3. 将 `.env.example` 复制为 `.env.local` 并填入这两个值。切勿在桌面应用中使用 service-role 密钥。
4. 在 **Authentication → URL configuration** 中，将 `recordly://auth/callback` 和 `http://127.0.0.1:43821/auth/callback` 添加到重定向允许列表。

一旦启用邮箱认证并创建了用户，邮箱/密码即可使用。密码重置邮件使用同一个桌面回调。

## 2. Google

创建 **Desktop app** OAuth 客户端，启用 Drive API，并把测试邮箱加入测试用户，然后在 Recordly 中导入下载的 JSON。完整步骤见 [Google 桌面登录与 Drive](google-drive.zh-CN.md)，不再使用 Supabase 回调、服务端 Secrets、数据库或 Edge Function。

## 3. X

1. 在 X Developer Dashboard 中创建一个 OAuth 2.0 应用，并启用请求用户邮箱。
2. 将其回调 URL 设置为 `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`。
3. 在 Supabase 中启用 X/Twitter OAuth 2.0，并粘贴客户端 ID 和密钥。

## 4. SAML SSO（当前隐藏）

SAML 按客户工作区配置。Supabase 的 SAML 支持需要 Pro 或更高版本。

1. 在 Supabase Auth 提供方设置中启用 SAML。
2. 获取客户的 IdP 元数据 URL 或元数据 XML 文件。
3. 使用 Supabase CLI 注册连接及其邮箱域名，例如：

   ```sh
   supabase sso add --type saml --project-ref YOUR_PROJECT_REF \
     --metadata-url 'https://customer.example/idp/metadata' \
     --domains customer.example
   ```

Recordly 模态框会从输入的邮箱地址中提取域名，并启动匹配的 SAML 连接。

## 5. 本地验证

创建 `.env.local` 后重启 `npm run dev`。打开一个编辑器并验证：

1. 账户按钮会打开 **Sign into Recordly**。
2. 邮箱/密码会创建一个持久化的 Supabase 会话。
3. Google 会打开系统浏览器并返回 Recordly。
4. 在未登录状态下点击 **Create link** 会打开此模态框；身份验证成功后它会继续进入分享对话框。

将相同的 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY` 值添加到分享 Worker 的 secrets 或变量中。将 `OWNER_USER_ID` 设置为所有者的 Supabase 用户 ID。Worker 会用 Supabase 验证访问令牌，并在接受 API 请求前要求该所有者身份。`API_SECRET` 仅在服务端使用，仍可用于库管理和显式启用的本地集成测试；它绝不会被输入到桌面应用中，也不会由桌面应用暴露。
