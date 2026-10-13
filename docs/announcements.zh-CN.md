语言: [EN](announcements.md) | 简中

# 应用内公告

Recordly 可以在编辑器中以弹窗、轮播幻灯片、轻量实时通知或头部横幅的形式展示可关闭的公告。弹窗可以包含图片或视频；通知和横幅仅支持文字，并可带有可选按钮。

## 远程公告

编辑 `main` 分支上的 [`announcements.json`](../announcements.json)，即可在不发布新应用版本的情况下发布公告。已发布的客户端每个运行中的应用实例最多每六小时检查一次该 GitHub 原始文件。拉取失败是静默的，绝不会阻塞启动。

```json
{
	"settings": {
		"aspectRatio": "4:3"
	},
	"announcements": [
		{
			"id": "recordly-1.4-release",
			"title": "A faster Recordly is here",
			"body": "Exports are faster and cursor motion is smoother. Thanks for using Recordly!",
			"presentation": "popup",
			"audience": "editor",
			"priority": 10,
			"mediaMode": "cover",
			"displayDurationSeconds": 15,
			"maxImpressions": 3,
			"controls": {
				"close": true,
				"dismiss": false,
				"action": true,
				"navigation": false,
				"indicators": true
			},
			"startsAt": "2026-09-01T00:00:00Z",
			"endsAt": "2026-10-01T00:00:00Z",
			"minVersion": "1.4.0",
			"media": {
				"type": "image",
				"url": "https://example.com/recordly-1.4-banner.jpg",
				"alt": "Recordly 1.4 feature preview"
			},
			"action": {
				"label": "See what changed",
				"url": "https://github.com/webadderallorg/Recordly/releases"
			}
		},
		{
			"id": "recordly-maintenance-notice",
			"title": "Quick service notice",
			"body": "Cloud sharing will undergo brief maintenance tonight.",
			"presentation": "notification",
			"audience": "editor",
			"displayDurationSeconds": 10,
			"maxImpressions": 2,
			"startsAt": "2026-09-05T00:00:00Z",
			"endsAt": "2026-09-06T00:00:00Z"
		},
		{
			"id": "recordly-editor-banner",
			"title": "Try the new editor",
			"body": "The redesigned timeline is now available.",
			"presentation": "banner",
			"audience": "editor",
			"maxImpressions": 3,
			"action": {
				"label": "Open settings",
				"section": "settings"
			}
		}
	]
}
```

每当一条公告应再次出现时，请使用一个新的稳定 `id`。一旦用户关闭了某个 ID，它就会保持关闭状态。相同 ID 的远程条目会覆盖内置条目。

支持的字段：

- `settings.aspectRatio` 为整个弹窗轮播设置一个共享的 `width:height` 比例，例如 `16:9`、`4:3` 或 `1:1`。所有幻灯片保持相同尺寸。若省略，则使用内置默认值。
- `id`、`title` 和 `body` 为必填。
- `presentation` 为 `popup`、`notification` 或 `banner`，默认为 `popup`。通知以纯文字、非模态的 toast 形式出现，而横幅仅出现在编辑器中、紧跟其头部下方。通知和横幅会忽略媒体及 `mediaMode`。一次 feed 加载最多显示五条通知；横幅按优先级一次显示一条。
- `audience` 为 `all` 或 `editor`，默认为 `all`。
- `priority` 控制轮播顺序；数值越大越靠前。
- `mediaMode` 为 `banner` 或 `cover`。`banner` 是当前默认布局；`cover` 用媒体填满弹窗并叠加文字。
- `startsAt` 和 `endsAt` 是可选的 ISO 时间戳。
- `displayDurationSeconds` 接受 3–300 秒。它自动推进弹窗幻灯片；对于通知，它控制 toast 保持可见的时长，默认 10 秒。
- `maxImpressions` 可选地将一条公告限制在 1–100 个应用会话内。每条公告每个会话最多计数一次；显式关闭则始终永久隐藏它。
- `controls` 可以独立显示或隐藏 `close`、`dismiss`、`action`、`navigation` 和 `indicators`。每个控件默认均为 `true`。通知和横幅只使用 `close` 和 `action`；弹窗轮播使用其他控件。即使可见的关闭控件被隐藏，Escape 和点击弹窗外部仍然可用。
- `minVersion` 和 `maxVersion` 是可选的、含端点的应用版本范围。
- `media.type` 对弹窗为 `image` 或 `video`。媒体 URL 必须是 HTTPS 或根相对的打包资源。视频还可以指定 `posterUrl`。
- `action` 有一个标签和且仅有一个目标：一个在系统浏览器中打开的 HTTPS `url`，或一个在应用内打开的编辑器 `section`。支持的 section 有 `scene`、`cursor`、`webcam`、`captions`、`settings` 和 `extensions`。同时包含两个目标、两个都不包含或包含未知 section 的 action 会被忽略。

在启动应用前设置 `RECORDLY_ANNOUNCEMENTS_URL` 可使用不同的 HTTPS feed。将其设为 `off` 可禁用远程公告。

## 随更新一起打包的公告

在 `src/content/announcements.ts` 中添加带类型的条目。内置条目使用相同的 schema，并且可离线使用。当某条消息应随新版本原子化发布时，这很有用。

远程内容仅被当作数据处理：不渲染 HTML，URL 受限制，feed 有大小和时间限制，格式错误的条目会被忽略。
