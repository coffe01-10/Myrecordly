语言: [EN](RELEASING.md) | 简中

# 发布 Recordly

本仓库现在使用 `electron-builder` + `electron-updater`，为 macOS、Windows 和 Linux 提供自动更新。

对于这个 Electron 应用而言，这才是正确的做法，而不是直接接入 Sparkle.framework。在 macOS 上，`electron-updater` 会处理原生应用原本由 Sparkle 负责的发布元数据和更新流程，同时仍与 Windows、Linux 共用同一套 GitHub Releases 流水线。

## 发布工作流做了什么

当你发布一个标签形如 `v1.2.3` 的 GitHub release 时，`.github/workflows/release.yml` 将会：

- 校验 `package.json` 中的版本也是 `1.2.3`
- 构建已签名的 macOS x64 和 arm64 产物
- 对 macOS 构建进行公证（notarize）
- 将双架构的 `latest-mac.yml` 元数据合并为单个发布资源
- 构建并签名 Windows NSIS 安装程序
- 构建 Linux AppImage
- 将安装程序产物和自动更新元数据文件发布到 GitHub release
- 在发布资源就绪后，触发 Homebrew tap 工作流

打包后的应用随后会从 GitHub Releases 检查以下文件：

- `latest-mac.yml`
- `latest.yml`
- `latest-linux.yml`

## 必需的 GitHub secrets

### macOS 签名与公证

设置以下仓库 secrets：

- `APPLE_SIGNING_CERTIFICATE_P12_BASE64`
- `APPLE_SIGNING_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

`APPLE_SIGNING_CERTIFICATE_P12_BASE64` 必须是一个 `Developer ID Application` 证书导出的 `.p12` 文件，再经 base64 编码后的内容。

如果你现有的证书只是 `Apple Development`，那不足以用于面向公众的公证发布和自动更新分发。你需要 `Developer ID Application`。

导出并编码证书：

```bash
security export -k ~/Library/Keychains/login.keychain-db -t identities -f pkcs12 -P "YOUR_P12_PASSWORD" -o recordly-mac-signing.p12
base64 < recordly-mac-signing.p12 | pbcopy
```

将复制得到的 base64 内容粘贴到 `APPLE_SIGNING_CERTIFICATE_P12_BASE64`，将导出密码粘贴到 `APPLE_SIGNING_CERTIFICATE_PASSWORD`。

### Windows 签名

设置以下仓库 secrets：

- `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64`
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`

它们应指向一个导出的 Authenticode 代码签名证书 `.p12` 文件，再经 base64 编码。

### Homebrew tap 自动化

如果你希望 cask PR 自动创建，请设置以下仓库 secret：

- `HOMEBREW_TAP_TOKEN`

可选的仓库变量：

- `HOMEBREW_TAP_REPO`
- `HOMEBREW_TAP_AUTO_MERGE`

## 发布流程

1. 将 `package.json` 的版本号提升到你要发布的版本。
2. 提交并推送该版本。
3. 创建形如 `vX.Y.Z` 的 Git 标签。
4. 为该标签创建并发布 GitHub release。建议使用辅助脚本，这样自定义说明会被前置，同时 GitHub 仍会生成贡献者区块：

```bash
npm run release:create -- --tag v1.2.3 --title "v1.2.3" --notes-file ./release-notes.md
```

预发布版本：

```bash
npm run release:create -- --tag v1.2.0-beta.2 --title "v1.2.0 beta-2" --prerelease --notes-file ./release-notes.md
```

这会调用 `gh release create --generate-notes`，从而保留 GitHub 生成的变更摘要和贡献者列表，而不是用一份完全手写的发布正文将其替换掉。

5. `Publish Release` 工作流会执行构建、签名、公证、上传并发布更新元数据。

如果你想要"点击新建 release，剩下的交给 CI"，这就是标准路径。

## 重新构建已有 release

如果你需要为某个已有标签重新运行发布流程，请手动触发 `.github/workflows/release.yml`，并提供该已有标签。

## 说明

- macOS 自动更新除了 `dmg` 之外还需要 `zip` 目标，因为 `latest-mac.yml` 是由 zip 构建生成的。
- macOS arm64 和 x64 构建都会发布 updater zip，发布工作流会将它们合并为一个 `latest-mac.yml`，这样 `electron-updater` 就能自动选择正确的架构。
- 发布工作流会发布带版本号的产物名称，以便生成的更新元数据与上传的文件相匹配。
- `build.yml` 被有意强制为 `--publish never`，以免临时的 CI 构建意外上传到草稿 release。
