# OpenCalendar 移动端（open-calendar-mobile）

「日程移动端」：桌面端 [open-calendar-desktop](https://github.com/MrMu666/open-calendar-desktop) 的 **Android 复刻**。
Tauri 2 + React 19 + TypeScript + Vite。全中文 UI，底部三栏：**日历 / 事项 / 设置**。

数据为文件夹 Markdown（`yyyyMMdd-HHmmss_yyyyMMdd-HHmmss_P<级别>_<标题>[_<标签>].md`），
与桌面端格式完全一致，可把桌面端 `items/` 数据直接拷贝迁移。详见 [Agents.md](Agents.md)。

## 功能

- **日历**：月视图（含农历）、事项圆点、选中日日程列表、点击日期查看
- **事项**：未到期事项列表、优先级（P1 紧急/P2 优先/P3 一般/P4 长期）、标签、展开详情、
  设为长期 / 已完成 / 删除
- **编辑器**：底部弹层，标题 / 开始 / 截止时间、标签、优先级、Markdown 内容
- **设置**：背景色 / 透明度、强调色（与桌面端默认值一致）

## 开发

```bash
npm install
npm run dev        # 前端开发（无 Tauri 环境时）
npx tsc --noEmit   # 类型检查
npm run build      # 前端构建
```

Android 构建需要 JDK + Android SDK + Rust（本机未装，由 GitHub Actions 完成）。

## 自动构建（GitHub Actions）

推送 `main`/`master` 后自动触发，流程：

1. 递增小版本号（patch +1）并提交回仓库（`scripts/bump-version.mjs`）
2. 初始化 Android 工程 → 注入签名配置（`scripts/inject-android-signing.py`）
3. 构建带签名的 APK（`--split-per-abi`，按架构拆分）
4. 创建 GitHub Release 并上传各架构 APK，**直接从 Release 页下载 .apk 文件**（不用 Artifact，避免 zip 压缩包）

### 一次性配置签名（可选但推荐）

在 **Settings → Secrets and variables → Actions** 添加：

| Secret | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `sign/open-calendar-keystore.p12.base64` 全部内容 |
| `ANDROID_KEYSTORE_PASSWORD` | `sign/keystore-pass.txt` 内容 |
| `ANDROID_KEY_ALIAS` | `upload` |

未配置时构建未签名 APK（会输出警告）。详细说明见 [sign/README.md](sign/README.md)。

## 项目结构

```
src/                前端（React 19 + TS）
  lib/store.ts      FolderItemStore 移植（数据存储核心）
  lib/lunar.ts      农历封装
  components/       三栏视图 + 事项编辑器
src-tauri/          Tauri 2 壳（fs 插件 + 权限）
scripts/            CI 辅助脚本（版本递增、签名注入）
.github/workflows/  Android 构建 workflow
sign/               Android 签名（敏感，不入库）
```
