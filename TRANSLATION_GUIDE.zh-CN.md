语言: [EN](TRANSLATION_GUIDE.md) | 简中

# 翻译指南

本项目使用基于命名空间（namespace）的 i18n 方案，让贡献者可以在不修改应用逻辑的前提下安全地进行本地化。

## 语言文件

所有语言文件位于：

- `src/i18n/locales/en/`
- `src/i18n/locales/es/`
- `src/i18n/locales/zh-CN/`

每个语言都有相同的命名空间文件：

- `common.json`
- `launch.json`
- `editor.json`
- `timeline.json`
- `settings.json`
- `dialogs.json`
- `shortcuts.json`

英语（`en`）是键结构的唯一权威来源。

## 键规则

- 各语言之间保持相同的键路径。
- 除非同步修改代码，否则不要重命名已有键。
- 新键先加入 `en`，再同步到其他所有语言。
- 优先使用描述性强、稳定的键名。例如：`app.editorTitle`。
- 支持使用 `{{name}}` 风格的占位符进行插值。

## 翻译的读取方式

- 带命名空间前缀的键（如 `settings.export.title`）使用该命名空间。
- 不带命名空间的键默认归属 `common`。
- 缺失的翻译会依次回退到英语、提供的 fallback 字符串，最后回退到键名本身。

## 校验语言结构

运行：

```bash
npm run i18n:check
```

它会检查：

- 缺失的命名空间文件
- 相比 `en` 缺失的键
- `en` 中不存在的多余键

## 贡献者工作流

1. 拉取最新的 `main`。
2. 如有需要，在 `en/<namespace>.json` 中更新新键。
3. 在其他语言文件中添加对应的键。
4. 运行 `npm run i18n:check`。
5. 在本地运行应用（`npm run dev`）并抽查 UI 文案。
6. 提交 PR，并附上变更命名空间的简要说明。

## 范围说明

当前框架是应用级的，已准备好进行全面本地化推广。
并非所有 UI 字符串都已迁移完成。迁移应按命名空间逐步进行，以保持 PR 易于审查、风险可控。
