语言: [EN](cloud-sharing.md) | 简中

# Recordly 云端分享

Recordly 的 **Export** 菜单提供下载当前编辑结果或 **Create share link**。左侧工具栏底部的 Account 按钮用于打开登录。分享会先将 MP4 渲染到一个临时文件，将其上传到 Recordly Share，最终确定其元数据，并在对话框关闭时删除临时文件。

桌面应用默认使用本地开发端点：

```text
http://localhost:8787/api/upload
```

该端点被有意设计为不可由用户配置。目前所有构建都使用上述本地服务。生产服务集成已在计划中，但尚未被任何构建选用。发布需要用户的 Recordly 访问令牌。应用中不暴露任何分享 API 密钥。

## 发布协议

1. `POST /api/upload` 创建一条录制并生成分享码。
2. 小文件使用 `PUT /api/upload-data/:shareCode`；超过 50 MB 的文件使用分片上传，以 25 MB 的可重试分块进行。
3. `POST /api/metadata/:shareCode` 发布标题和创作者说明。
4. 返回的 `/s/:shareCode` URL 会打开完整的观看与反馈页面。

该服务提供 R2 视频存储、D1 元数据、范围流式传输、响应式观看页面、带时间戳的评论、反应、字幕、密码保护、过期设置，以及私有视频库。本地和部署说明请参见[服务 README](../services/recordly-share/worker/README.md)。

## 评论

任何拥有有效链接的人都可以观看公开录制，并使用显示名称留下带时间戳的反馈。无需账户或登录。现有的按 IP 限流和 2,000 字符评论上限仍然适用。

## 第三方许可

该托管服务基于 MIT 许可的开源软件。所需的署名和完整许可证文本保留在 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) 和[内置许可证](../services/recordly-share/LICENSE)中。

自托管的 worker 是单所有者库。将 `OWNER_USER_ID` 设置为所有者的 Supabase 用户 ID。同一 Supabase 项目中的其他账户无法管理该库。缺少所有者配置会禁用 Supabase bearer 访问。
