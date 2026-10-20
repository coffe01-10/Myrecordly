# Recordly Automation — SDK、CLI 与 MCP

三个入口共用本机 Recordly 的工程、时间轴、撤销记录和导出引擎。AI 修改后可以在编辑器中继续手动调整，原始视频保持独立。

需要 Node.js 20+，以及包含 Automation 功能的 Recordly 桌面版。渲染由 Electron 执行；SDK 控制桌面应用，不能直接作为纯 Node 视频渲染器部署到服务器。

## 安装与启动

开发仓库：

```powershell
npm install
npm run build:automation
npm run build:win
```

SDK / CLI / MCP 发布包：

```powershell
npm install -g ./recordly-automation-0.1.0.tgz
recordly start --executable "C:/Apps/Recordly/Recordly.exe"
```

也可以直接启动桌面应用：

```powershell
& "C:/Apps/Recordly/Recordly.exe" --automation
```

应用仅在传入 `--automation` 或 `RECORDLY_AUTOMATION=1` 时开放本地接口。默认连接文件位于：

| 系统 | 连接文件 |
|---|---|
| Windows | `%APPDATA%/Recordly/automation.json` |
| macOS | `~/Library/Application Support/Recordly/automation.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Recordly/automation.json` |

连接文件包含本机端口和访问令牌。SDK 默认自动查找，也可通过 `--connection`、`connectionFile` 或 `RECORDLY_CONNECTION_FILE` 指定。服务仅监听 `127.0.0.1`，令牌用于防止网页访问本机编辑接口。

开发时启动独立实例：

```powershell
npm run recordly -- start --executable "./node_modules/electron/dist/electron.exe" --app "." --user-data "./.tmp/my-agent-session" --connection "./.tmp/my-agent-session/automation.json"
```

先完成桌面端构建。`--app` 仅用于开发版 Electron；安装版无需这个参数。独立实例使用自己的工程库与设置，可与正常桌面实例同时运行。

## TypeScript / JavaScript SDK

```ts
import { RecordlyClient } from "@recordly/automation";

const recordly = new RecordlyClient();
const project = await recordly.openProject("D:/Videos/demo.mp4");
const endMs = Math.min(project.durationMs, 1500);

await recordly.applyEdits([
  { type: "text", startMs: 0, endMs, text: "操作演示", x: 50, y: 20 },
  { type: "caption", startMs: 0, endMs, text: "下面演示操作步骤。" },
], project.revision);

await recordly.saveProject({ path: "D:/Videos/demo.recordly" });
const { jobId } = await recordly.exportVideo({
  outputPath: "D:/Videos/demo-edited.mp4",
  width: 1920, height: 1080, fps: 30,
});
const job = await recordly.waitForJob(jobId, {
  onProgress: job => console.log(job.status, job.progress),
});
console.log(job.result);
```

`RecordlyClient.launch({ executable, connectionFile, userDataDir?, appPath?, onLog? })` 可以启动实例，返回 `{ client, process }`。调用方管理自己启动的进程；连接已有应用时直接创建客户端。

`waitForJob` 的 AbortSignal 只停止等待；停止实际分析或渲染使用 `cancelJob(jobId)`。

## CLI

```powershell
recordly tools
recordly get_project
recordly open_project --file open.json
recordly analyze_media --wait
recordly apply_edits --file edits.json
recordly undo
recordly redo
recordly save_project --file save.json
recordly render_preview --file preview.json --wait
recordly export_video --file export.json --wait
```

每条命令在标准输出返回 JSON；错误写入标准错误并使用非零退出码。耗时命令默认立即返回 `jobId`，加 `--wait` 等待完成。等待期间按 Ctrl+C 会取消该任务。

`open.json`：

```json
{ "path": "D:/Videos/demo.mp4" }
```

`edits.json`（`expectedRevision` 使用刚读取的实际值；下列素材需长于 18 秒）：

```json
{
  "expectedRevision": 7,
  "edits": [
    { "type": "delete", "timeBase": "source", "startMs": 12000, "endMs": 18000 },
    { "type": "speed", "timeBase": "source", "startMs": 5000, "endMs": 10000, "speed": 4 }
  ]
}
```

`save.json`：

```json
{ "path": "D:/Videos/demo.recordly" }
```

`preview.json`：

```json
{ "startMs": 0, "endMs": 3000, "outputPath": "D:/Videos/preview.mp4", "width": 960, "height": 540 }
```

`export.json`：

```json
{ "outputPath": "D:/Videos/final.mp4", "width": 1920, "height": 1080, "fps": 30 }
```

可以用 `--args '{...}'` 代替参数文件。PowerShell 下推荐 JSON 文件，避免复杂引号转义。JSON 文件可以带 UTF-8 BOM。

## MCP

启动命令为 `recordly-mcp`，使用标准 stdio。先启动启用 Automation 的 Recordly，再配置 AI 客户端。支持 `mcpServers` 配置的客户端示例：

```json
{
  "mcpServers": {
    "recordly": {
      "command": "node",
      "args": ["D:/path/to/Myrecordly/packages/automation/dist/mcp.js"]
    }
  }
}
```

安装 npm 包后，也可以将 `args` 指向所安装包的 `dist/mcp.js`。自定义连接文件时，在 `args` 末尾添加 `"--connection", "D:/path/to/automation.json"`。MCP 标准输出只传递协议消息。

可对 AI 说：

> 打开 D:/Videos/demo.mp4，分析停顿并查看关键帧，删除不必要的等待，为重要操作添加缩放，加入中文字幕。检查预览后导出 1080p MP4，并保留可编辑工程。

## 工具与时间语义

所有时间均为**毫秒**，区间采用 `[startMs, endMs)`。

| 工具 | 输入与输出 |
|---|---|
| `get_project` | 当前工程、素材时长、剪后时长、clips、完整 editor、revision、ready 与撤销状态 |
| `open_project` | 打开视频或 `.recordly` 工程，等待预览就绪；先保存现有未保存编辑 |
| `save_project` | 保存可编辑 `.recordly` 工程，保留工程 ID；新路径覆盖已有文件需 `overwrite: true` |
| `apply_edits` | `expectedRevision` 与 `edits`；一批操作原子提交、一次撤销 |
| `undo` / `redo` | 与桌面编辑器共用撤销历史 |
| `analyze_media` | 返回 jobId；结果包含音轨静音交集、尺寸和时长。分析当前素材时还返回带活动分类的时间轴候选及 revision |
| `transcribe_media` | 返回 jobId；Whisper 输出素材时间的字幕。可指定 modelPath、executablePath、language |
| `get_frames` | 素材时间的 JPEG 图片；1～16 帧，宽度 64～1280。MCP 直接返回图片内容 |
| `render_preview` | 按剪后时间轴的 startMs/endMs 渲染 MP4；包含特效与音频，不修改工程 |
| `export_video` | 按当前工程快照导出 MP4；后续手动修改不影响该任务 |
| `get_job` | running / completed / failed / canceled，进度百分比、结果或错误 |
| `cancel_job` | 取消分析、转写、预览或导出，并清理新建的未完成输出 |

支持的编辑：

| type | 参数与语义 |
|---|---|
| `split` | atMs，时间轴位置 |
| `delete` | timeBase + startMs/endMs，删除后自动收拢时间轴 |
| `speed` | timeBase + startMs/endMs + speed，0.25～4 倍绝对速度，后续片段与关联效果随之移动 |
| `reorder` | clipId + index，调整片段顺序 |
| `mute` | clipId + muted，静音或取消静音 |
| `caption` | startMs/endMs + text，**素材时间**，随剪辑投射到时间轴 |
| `zoom` | startMs/endMs + depth（1～6）+ cx/cy（0～1），时间轴位置 |
| `text` | startMs/endMs + text；可选 x/y（0～100）、fontSize、color，时间轴位置 |
| `remove_effect` | id，删除字幕、缩放或文字标注 |

一批操作按顺序执行，后一个操作读取前一个操作修改后的时间轴。针对原视频的多个剪切通常使用 `timeBase: "source"`，避免前一次删除导致后续时间点错位。同一段原素材重复出现时，source 区间作用于每次出现；只编辑其中一次时使用 timeline 区间。

读取工程后若用户又手动编辑，旧 revision 的修改会被拒绝；重新读取并规划即可。它避免 AI 用过期的时间轴覆盖用户操作。素材时间的字幕不随删除直接改写，关联缩放和标注随保留画面移动，导入音频保留长度并移动锚点。

音频静音只表示候选停顿。没有光标记录时活动为 unknown，不能据此认定没有操作。转写需要本地 Whisper 模型；缺失时任务明确失败，其余工具继续可用。模型不会由接口自动下载。

导出支持 MP4、24/30/60 fps；不指定尺寸时使用工程画幅和默认导出质量。已存在的输出必须明确传入 `overwrite: true`；原视频、摄像头、工程及正在使用的音频文件不能作为导出覆盖目标。

## 测试

```powershell
npm run typecheck
npm run build:automation
npx vitest run src/automation electron/automation
npx vite build --config vite.config.ts
npm run smoke:automation
```

`smoke:automation` 创建独立用户目录和红／绿／蓝三段真实视频，通过 SDK 打开、修改，通过 CLI 撤销、重做、保存及预览，通过官方 MCP 客户端发现工具、修改并导出。它用 FFprobe 检查时长与音轨，并解码画面像素检查保留的是正确素材，同时验证过期 revision、批量失败回滚、输出覆盖保护、任务取消与原素材保留。生成的临时视频、用户目录和参数文件会清理。

测试安装包中的可执行文件：

```powershell
$env:RECORDLY_TEST_EXECUTABLE = "D:/path/to/win-unpacked/Recordly.exe"
npm run smoke:automation
Remove-Item Env:RECORDLY_TEST_EXECUTABLE
```

当前真实桌面端验证环境为 Windows x64；macOS/Linux 的安装包和原生渲染尚需在对应系统验证。
