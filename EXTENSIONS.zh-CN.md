语言: [EN](EXTENSIONS.md) | 简中

# Recordly 扩展 API

完整且会定期更新的文档请访问 https://www.marketplace.recordly.dev/extensions

Recordly 扩展运行在编辑器渲染进程中，使用一套受权限门控的宿主 API。它们可以绘制到渲染管线中、响应播放和导出事件、注册光标特效、添加设置面板，并贡献打包资源，例如边框、壁纸和光标样式。

## 快速开始

对于本地用户安装的扩展，请在应用中使用 `Extensions -> Open Directory`。Recordly 会将它们存放在应用的 `userData/extensions` 目录中。本仓库还在 `extension-examples/` 下包含了可安装的示例包。

### 最小扩展

```text
my-extension/
  recordly-extension.json
  index.js
```

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A short description",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "permissions": ["render"]
}
```

```js
export function activate(api) {
  api.log("Hello from my extension");
}

export function deactivate() {}
```

### TypeScript

扩展可以用 TypeScript 编写。从本仓库的 `types.ts` 导入 `RecordlyExtensionAPI` 类型，即可获得完整的 IDE 自动补全和编译期检查：

```ts
import type { RecordlyExtensionAPI } from "./types";

export function activate(api: RecordlyExtensionAPI) {
  api.registerRenderHook("final", (ctx) => {
    ctx.ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.ctx.fillRect(0, 0, ctx.width, 30);
  });
}

export function deactivate() {}
```

Recordly 会从清单（manifest）中加载 `main` 入口，它必须是一个 `.js` 文件。如果你用 TypeScript 编写，请在打包前编译或打包成 JavaScript。由于扩展运行在 Chromium 渲染进程中，一个带有 `"module": "ESNext"` 和 `"target": "ESNext"` 的 `tsconfig.json` 就能很好地工作。

### 清单截图

扩展可以在清单中包含 `screenshots`，以便在市场（marketplace）中展示预览图：

```json
{
  "id": "com.example.my-extension",
  "screenshots": [
    "screenshots/preview-1.png",
    "screenshots/preview-2.png"
  ]
}
```

路径相对于扩展根目录。市场会在应用内详情弹窗和网页详情页上以轮播形式展示截图。

## 清单

`recordly-extension.json` 会在扩展加载时以及 zip 上传到市场时进行校验。

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `id` | `string` | 是 | 唯一标识符，例如 `yourname.cool-effect` |
| `name` | `string` | 是 | 在 UI 中展示的可读名称 |
| `version` | `string` | 是 | 严格的 semver 版本号，例如 `1.0.0` |
| `description` | `string` | 是 | 一行简介 |
| `author` | `string` | 否 | 作者或组织 |
| `homepage` | `string` | 否 | HTTPS 主页或仓库 URL |
| `license` | `string` | 否 | SPDX 许可证标识符 |
| `engine` | `string` | 否 | 支持的最低 Recordly 版本 |
| `icon` | `string` | 否 | PNG 图标的相对路径 |
| `screenshots` | `string[]` | 否 | 市场中展示的预览图相对路径 |
| `main` | `string` | 是 | 相对入口 JS 文件 |
| `permissions` | `string[]` | 是 | 所需能力 |
| `contributes` | `object` | 否 | 打包边框、光标样式、音效、壁纸和摄像头边框的元数据 |

`contributes` 目前仅为元数据。Recordly 不会从清单自动注册运行时行为。请使用 `activate()` 调用诸如 `registerFrame()`、`registerWallpaper()`、`registerCursorStyle()`、`registerSettingsPanel()` 和 `playSound()` 等 API。

## 权限

| 权限 | 授予对以下内容的访问 |
|-----------|------------------|
| `render` | 渲染钩子注册 |
| `cursor` | 光标遥测与光标特效注册 |
| `audio` | 打包音效播放 |
| `timeline` | 播放与时间线事件 |
| `ui` | 设置面板与设备边框注册 |
| `assets` | 打包资源解析，以及壁纸和光标样式注册 |
| `export` | 导出生命周期事件 |

## 渲染管线

渲染钩子会在特定阶段绘制到 `hookCtx.ctx`（一个 `CanvasRenderingContext2D`）中。

| 阶段 | 预览 | 导出 | 说明 |
|-------|---------|--------|-------|
| `background` | 保留 | 保留 | 存在于类型表面中，但尚未派发 |
| `post-video` | 是 | 是 | 在场景变换内部运行 |
| `post-zoom` | 是 | 是 | 在场景变换内部运行 |
| `post-cursor` | 是 | 是 | 在场景变换内部运行 |
| `post-webcam` | 是 | 是 | 在内置变换之后运行 |
| `post-annotations` | 是 | 是 | 在内置变换之后运行 |
| `final` | 是 | 是 | 用于 HUD 式叠加层的最后一遍绘制 |

### 场景变换内部 vs 外部

- `post-video`、`post-zoom` 和 `post-cursor` 在预览和导出中已经跟随缩放和运动。
- `post-webcam`、`post-annotations` 和 `final` 在 Recordly 恢复画布变换之后运行。如果你希望这些叠加层随场景一起移动，请手动使用 `sceneTransform`。

### RenderHookContext

```ts
{
  width: number;
  height: number;
  timeMs: number;
  durationMs: number;
  cursor: { cx: number; cy: number; interactionType?: string } | null;
  smoothedCursor?: {
    cx: number;
    cy: number;
    trail: Array<{ cx: number; cy: number }>;
  } | null;
  ctx: CanvasRenderingContext2D;
  videoLayout?: {
    maskRect: { x: number; y: number; width: number; height: number };
    borderRadius: number;
    padding: number;
  };
  zoom?: { scale: number; focusX: number; focusY: number; progress: number };
  sceneTransform?: { scale: number; x: number; y: number };
  shadow?: { enabled: boolean; intensity: number };
  getPixelColor(x: number, y: number): { r: number; g: number; b: number; a: number };
  getAverageSceneColor(): { r: number; g: number; b: number; a: number };
  getEdgeAverageColor(edgeWidth?: number): { r: number; g: number; b: number; a: number };
  getDominantColors(count?: number): Array<{ r: number; g: number; b: number; frequency: number }>;
}
```

使用 `videoLayout.maskRect` 和 `videoLayout.borderRadius` 进行相对于场景的尺寸计算。这样你就能得到真正的场景边界和形状正确的圆角，而不是横跨整个画布的叠加层。

## 光标特效

光标特效回调会在一次点击之后逐帧运行，直到它们返回 `false`。

```js
api.registerCursorEffect((ctx) => {
  const progress = ctx.elapsedMs / 400;
  if (progress >= 1) return false;

  const sceneWidth = ctx.videoLayout?.maskRect.width ?? ctx.width;
  const x = ctx.cx * ctx.width;
  const y = ctx.cy * ctx.height;
  const radius = sceneWidth * 0.03 * progress;

  ctx.ctx.beginPath();
  ctx.ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.ctx.stroke();
  return true;
});
```

`CursorEffectContext` 现在包含 `videoLayout`、`zoom` 和 `sceneTransform`，因此特效可以相对于场景缩放，而不是相对于整个画布。

## API 表面

### 注册

```js
api.registerRenderHook(phase, hook);
api.registerCursorEffect(effect);
api.registerFrame(frame);
api.registerWallpaper(wallpaper);
api.registerCursorStyle(cursorStyle);
api.registerSettingsPanel(panel);
api.on(event, handler);
```

每次注册都会返回一个 dispose（释放）函数。

### 设置

```js
api.getSetting(settingId);
api.setSetting(settingId, value);
api.onSettingChange((settingId, value) => {});
api.getAllSettings();
```

支持的设置字段类型有 `toggle`、`slider`、`select`、`color` 和 `text`。

### 资源与音频

```js
api.resolveAsset("images/overlay.png");
api.playSound("sounds/click.mp3", { volume: 0.8 });
api.log("hello", payload);
```

### 只读查询

```js
api.getVideoInfo();
api.getVideoLayout();
api.getCursorAt(timeMs);
api.getSmoothedCursor();
api.getZoomState();
api.getShadowConfig();
api.getKeystrokesInRange(startMs, endMs);
api.getAspectRatio();
api.getActiveFrame();
api.isExtensionActive(extensionId);
api.getPlaybackState();
api.getCanvasDimensions();
api.drawIcon(ctx, "Sparkle", 100, 100, 20, "#2563EB", "regular");
```

### 绘制图标

扩展可以直接在画布上下文上绘制 Recordly 内置 Phosphor 图标集中的图标：

```js
api.drawIcon(
  ctx,
  "ArrowClockwise", // icon name from @phosphor-icons/react
  120,              // x (center)
  80,               // y (center)
  18,               // size in px
  "#ffffff",        // color
  "bold",           // optional weight: thin | light | regular | bold | fill
);
```

这对于轻量级叠加层很有用，可以避免打包你自己的图标资源。

## 设置面板

```js
api.registerSettingsPanel({
  id: "my-settings",
  label: "My Extension",
  icon: "sparkles",
  parentSection: "cursor",
  fields: [
    { id: "enabled", label: "Enable", type: "toggle", defaultValue: true },
    { id: "size", label: "Size", type: "slider", defaultValue: 1, min: 0.1, max: 3, step: 0.1 },
    {
      id: "style",
      label: "Style",
      type: "select",
      defaultValue: "ripple",
      options: [{ label: "Ripple", value: "ripple" }, { label: "Pulse", value: "pulse" }],
    },
    { id: "color", label: "Color", type: "color", defaultValue: "#2563EB" },
  ],
});
```

使用 `parentSection` 可将你的面板嵌套到已有区域中，例如 `cursor` 或 `scene`。

## 事件

| 事件 | 权限 | 说明 |
|-------|------------|-------------|
| `playback:timeupdate` | `timeline` | 每次播放 tick 时触发 |
| `playback:play` | `timeline` | 播放开始 |
| `playback:pause` | `timeline` | 播放暂停 |
| `cursor:click` | `cursor` | 检测到光标点击 |
| `cursor:move` | `cursor` | 检测到光标移动 |
| `timeline:region-added` | `timeline` | 添加了区域 |
| `timeline:region-removed` | `timeline` | 移除了区域 |
| `export:start` | `export` | 导出开始 |
| `export:frame` | `export` | 导出期间渲染了一帧 |
| `export:complete` | `export` | 导出完成 |

## 边框、壁纸和光标样式

- `registerFrame()` 是设备边框的运行时 API。尽可能使用 `draw(ctx, width, height)` 函数以获得分辨率无关的输出。
- `registerWallpaper()` 贡献场景背景。
- `registerCursorStyle()` 贡献光标图像包。
- 这三者都依赖相对于扩展根目录的打包文件。

## 生命周期

1. 发现：Recordly 扫描内置扩展和用户扩展目录。
2. 激活：运行 `activate(api)`，你在此注册钩子、特效、面板和资源。
3. 运行时：已注册的回调会根据各自阶段在预览和导出中执行。
4. 停用：运行 `deactivate()`，所有注册都会自动释放。

## 示例

- `extension-examples/webadderall.more-wallpapers` 展示了一个用户可安装的壁纸包，它通过 `registerWallpaper()` 注册了 180 张打包壁纸。
