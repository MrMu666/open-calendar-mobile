# Agents.md — open-calendar-mobile（日程移动端）

面向 AI 编码代理与维护者的项目要点摘要。重点是本仓库的约定、架构与易踩坑之处，不想重复读全部源码时可先看这里。

## 这是什么

「日程移动端」：桌面端 [open-calendar-desktop](https://github.com/MrMu666/open-calendar-desktop)（WPF/.NET）的 **Android 移动端复刻**，用 Tauri 2 + React 19 + TypeScript + Vite 实现。全中文 UI，底部三栏导航：**日历 / 事项 / 设置**。

- 日历月视图：6×7 网格、农历显示、事项圆点（存在未到期事项=红，仅有已到期事项=绿，色值同事项卡片起止日期）、选中日日程列表
- 事项列表：未到期事项、优先级/标签、展开详情、设为长期/已完成、删除
- 编辑器：底部弹层，标题/开始/截止时间、标签、优先级、Markdown 内容
- 设置：亮色/暗色主题切换（默认亮色）、强调色、自定义数据存储目录（appData 子目录 或
  外部绝对路径，后者需 Android 所有文件访问权限；桌面端的"开机自启/背景色/透明度"在移动端无对应项）

## 技术栈

- Tauri 2（`tauri` crate v2，`tauri-plugin-fs` v2 带 `watch` feature）
- React 19 + TypeScript + Vite 7
- `lunar-javascript`（农历；`@tauri-apps/plugin-fs` 已内置文件监听）
- **无状态管理库、无 UI 组件库**：全部手写（对齐桌面端零依赖风格）
- Android 构建在 **GitHub Actions** 完成（本机无 JDK/Android SDK；Rust 仅用于本地 `tauri android init` 等命令）

## 代码结构

```
package.json                 # 版本唯一来源（CI 每次推送自动 patch+1）
scripts/
  bump-version.mjs           # CI 版本递增（同步 package.json / tauri.conf.json）
  inject-android-signing.py  # CI 签名注入（init 后改写 build.gradle.kts）
.github/workflows/
  build-android.yml          # 推送触发：bump 版本 → init → 诊断插件接线 → 签名 → 构建分架构 APK → 断言 MANAGE 权限合并 → 发 Release
app-icon.png                 # 图标源图（桌面端 Assets/app-256.png 的副本）
app-icon.json                # tauri icon manifest：android_fg/android_bg/缩放/背景色
app-icon-fg.png / app-icon-bg.png  # 预处理生成的 Android 前景/背景层（勿手改）
scripts/prepare-android-icon.mjs   # 生成上述前景/背景层（内容缩放居中，避免图标过大）
sign/                        # Android 签名 keystore（敏感，.gitignore 排除，见 README.md）
src/
  main.tsx / App.tsx         # 应用外壳：三栏 keep-alive 常驻（仅显隐，切 Tab 不卸载）+ 编辑器弹层状态
  types.ts                   # ScheduleEvent / 视图类型（对齐桌面端 Models）
  lib/
    store.ts                 # FolderItemStore 移植：文件名解析/归档/删除/监听
    lunar.ts                 # 农历（lunar-javascript 封装，含闰月处理）
    format.ts                # 时间格式化（yyyyMMdd-HHmmss / 中文显示）
    tags.ts                  # 标签（工作/生活/学习/健康/财务）
    settings.ts              # 设置读写（$APPDATA/settings.json，与数据目录独立）
  components/
    TabBar.tsx / CalendarView.tsx / TasksView.tsx / ItemEditor.tsx / SettingsView.tsx / ItemCard.tsx
src-tauri/
  tauri.conf.json            # version 指向 ../package.json（版本唯一来源）
  capabilities/default.json  # fs 权限（app 递归读写 + watch + 外部路径 scope）与插件权限
  src/lib.rs                 # 注册 fs / opener / all-files-access 插件
  plugins/all-files-access/  # 本地移动插件：MANAGE_EXTERNAL_STORAGE 声明+授权桥（Rust+Kotlin），
                             # manifest 随 tauri android init 自动合并，改动只改这里
```

## 关键架构决策

### 数据存储：文件夹 Markdown（与桌面端完全一致，可迁移）
- **唯一存储是 `store.ts`（FolderStore 单例）**，两种后端（`StorageAdapter` 抽象，
  均为 `@tauri-apps/plugin-fs` 直接读写）：
  - **appData（默认）**：`$APPDATA` 下任意子目录（默认 `calendar`），`baseDir = AppData`。
  - **external（用户指定）**：外部绝对路径（如 `/storage/emulated/0/Download`），
    无 baseDir 直接访问，需 Android 所有文件访问权限（`MANAGE_EXTERNAL_STORAGE`，
    经自研 `all-files-access` 插件跳设置页开启）+ capabilities 的 `fs:scope` 放行
    `/storage/emulated/0/**`。两种后端监听（watch）同级生效，无 SAF 式轮询特例。
  切换后仅显示新目录事项，旧目录数据保留。根目录下 `items/*.md` 文件名即数据，
  格式 `items/yyyyMMdd-HHmmss_yyyyMMdd-HHmmss_P<级别>_<净化标题>[_<标签>].md`
  （规则与桌面端 `存储目录设计.md` 相同）。
- **归档**：截止已过的事项移入 `<root>/archive/YYYY/`；删除进 `<root>/deleted/`（软删除）。
  `Update(old, new)` 按新截止时间决定落点（未来→items/，过期→archive/）。
- **应用设置与数据分离**：`settings.json` 固定存于 `$APPDATA` 根，只保存
  主题 / 强调色 / 数据目录位置三项，不随数据目录迁移（`loadSettings` 会从旧位置
  `calendar/settings.json` 做一次性迁移读取）。
- **查询边界**：事项列表只读 items/（未过期）；日历圆点/选中日日程同时读 items/+archive/，
  已完成事项仍显示在它开始的那天，可继续编辑/设为长期/删除（与桌面端 GetUpcoming 语义一致）。
  日历圆点颜色：该日存在未到期事项=红（`var(--red)`，同 `.item-end`）、仅有已到期事项=绿
  （`var(--green)`，同 `.item-start`）、无事项隐藏；选中格圆点为白色（CSS 覆盖）。
- **文件监听 + 内存缓存 + 持久化缓存**：`store.ts` 的 FolderStore 单例拥有独立后台监视、
  内存缓存（`cache`/`cacheFingerprint`/`loadGen`）与 localStorage 持久化缓存
  （key 按存储位置隔离，`PERSISTED_CACHE_VERSION` 控制失效），三视图共享：`open()` 先同步
  用持久化缓存预热内存（首屏即时），再启动时全量预取一次，之后仅在监视到变动时整体重读；
  `getUpcoming/getItems/count` 只读内存。重读时以 **mtime+size 双相等** 为命中条件跳过正文
  （SAF 的 `readDir` 自带 size/lastModified，appData 端走 `stat`；取不到元数据回退必读，
  宁慢勿脏）；应用内写后与每 10 次轮询强制全读正文，防粗粒度 mtime/保留时间戳漏检。
  底层监视用 `@tauri-apps/plugin-fs` 的 `watch`（notify 后端，300ms 去抖，需 Rust 侧
  `features=["watch"]` + 权限 `fs:allow-watch`）；监听失败时降级为 30s 轮询兜底
  （`pollCheck()` 重读 + 指纹比对，无变化不通知视图，只做过期归档检查）。
  应用内写操作走 `afterWrite()` 重读后通知，不等 watcher。监视状态经
  `getWatchStatus()` 暴露，设置页底部"文件监视"区块据此提示（watch 生效 / SAF 轮询 / 降级轮询）。

### 版本号
- **`package.json` 是版本唯一来源**；`tauri.conf.json` 的 `"version": "../package.json"` 引用它。
- **每次推送 CI 自动递增 patch**（0.1.0 → 0.1.1 → …）：`scripts/bump-version.mjs` 改版本并
  提交回仓库（commit message 带 `[skip ci]`）。versionCode 由 Tauri 按
  `major*1000000 + minor*1000 + patch` 推导，随版本递增。
- **注意**：CI 的 bump 提交会 push 到仓库，本地需 pull 后再改代码，避免冲突。

### CI 分发：按架构拆分 APK + GitHub Release
- `tauri android build -- --apk --split-per-abi` 为各 ABI 各产出一个独立 APK
  （输出在 `gen/android/app/build/outputs/apk/<abi>/release/`，abi 目录名如
  `arm64-v8a`/`armeabi-v7a`/`x86_64`/`x86`）。Collect 步骤用
  `apk/*/release/*.apk` + 两级 `dirname` 的 `basename` 提取 abi 名（只取一级会
  拿到 `release` 导致同名覆盖、release 只剩一个 APK——已踩坑）。
- **图标必须 init 后再跑一次 `tauri icon`**：`tauri icon` 在
  `gen/android/app/src/main/res/` 已存在时会把图标直接写进 Android 工程；
  否则只写 `src-tauri/icons/android/`，而 `tauri android init` 模板自带默认图标，
  不覆盖则 APK 图标是 Tauri 默认 logo（已踩坑）。
- **不用 `actions/upload-artifact`**：Artifact 下载永远是 zip 压缩包；改由
  `softprops/action-gh-release` 把 APK 作为 **Release 资产**上传，直接从 Release 页
  下载原始 `.apk` 文件。每次构建打 `v<patch 版本>` tag 并创建 Release。

### Android 签名（CI 注入）
- 官方约定：`src-tauri/gen/android/keystore.properties` + `app/build.gradle.kts` 的
  `signingConfigs`/`buildTypes.release` 引用签名。**Tauri 不支持在 tauri.conf.json 直接配签名**。
- 由于 `gen/android` 每次 CI 重新 init，签名通过 `scripts/inject-android-signing.py` 注入
  （在 `tauri android init` 之后运行，幂等；keystore.properties 缺失时跳过 → 未签名 APK）。
- keystore 由 OpenSSL 生成（PKCS12/RSA2048，`storeType="PKCS12"`，keyAlias=`upload`），
  存于 `sign/`（**.gitignore 排除，勿提交**）。GitHub Secrets：
  `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS`。
  详见 `sign/README.md`。

### 权限（capabilities/default.json）
- `fs:default` + `fs:allow-app-read-recursive` / `fs:allow-app-write-recursive` /
  `fs:allow-app-meta-recursive`（$APPDATA 递归读写，含 mkdir/remove/rename/readDir）
- `fs:allow-watch` / `fs:allow-unwatch`（文件监听，含外部绝对路径）
- `fs:scope` 放行 `/storage/emulated/0/**`（外部直连目录用，见上）
- `all-files-access:default`（本地插件：授权查询 + 跳设置页）
- `core:default`、`opener:default`
- **不要随意收紧/放宽**：前端所有 IO 都走这些权限；Android 上 `$APPDATA` 即应用私有目录。

### 与桌面端的差异（刻意为之）
- 移动端在应用数据目录（`$APPDATA`）下由用户指定数据根目录（默认 `calendar/`），
  不能选系统任意文件夹（Android SAF 在 Tauri v2 的 dialog/fs 插件中不完整）；
  数据可直接从桌面端 `items/` 拷贝迁移。
- 无开机自启、无系统托盘、无玻璃壁纸效果（桌面端核心特色，移动端不适用）。
- 桌面端用 `FileSystemWatcher`；移动端用 fs 插件 watch + 轮询兜底。
- 设置：亮/暗主题（**默认亮色**）+ 强调色 + 数据目录（appData 子目录 或外部绝对路径），
  存 `$APPDATA/settings.json`（与数据目录独立）。external 模式存 `externalPath`，
  应用启动时校验所有文件访问授权仍有效，失效则回退 appData。
  主题在 `App.tsx` 切换 `theme-dark`/`theme-light` class，两套配色定义在 `App.css` 变量区。
  **`.app` 必须声明 `color: var(--text)`**：`html/body` 的 `var(--text)` 解析自 `:root`（暗色值），
  不在此处覆盖时所有靠继承取色的元素在亮色下仍为白字（已踩坑）。
- **外部绝对路径后端注意事项**：路径经 `sanitizeExternalPath` 校验（必须 `/` 开头、
  禁 `..`）；`directFsAdapter` 用绝对路径调 fs 插件（不传 baseDir），`rename` 同目录
  内直接改名（无 SAF 跨目录限制）；写入前 `mkdir` 验证，失败（无授权/路径非法）即
  回退 appData。`fs:scope` 目前按 `/storage/emulated/0/**` 静态放行（MANAGE 授权
  本就覆盖该范围），收紧需改 capabilities。
- **Android 状态栏**：Tauri 默认 `enableEdgeToEdge()` 沉浸式，`.app` 已加
  `padding-top: env(safe-area-inset-top)` 避让顶部状态栏（底部 TabBar/弹层同样处理）。
- **Android 图标**：桌面端图标内容满幅（98%），直接做自适应图标前景会视觉过大。
  CI 构建前跑 `scripts/prepare-android-icon.mjs` 生成缩放居中（66% 安全区）的
  前景图 + 同色背景层，再 `tauri icon app-icon.json` 生成全套图标（含写入
  `gen/android/.../res/`）。改图标时同步更新 `app-icon.json` 与脚本参数。

## 常用命令

- 前端 typecheck：`npx tsc --noEmit`
- 前端构建：`npm run build`（= `tsc && vite build`）
- 本地运行前端（无 Tauri 环境时）：`npm run dev`
- Android 构建（需 JDK+Android SDK，本机无；**CI 负责**）：`npm run tauri android build -- --apk`
- 本地初始化 Android 工程（需 JDK）：`npm run tauri android init`

## 约定与注意

- **每次修改完代码后，检查是否有必要同步更新本文件（AGENTS.md）**：架构/约定/踩坑点
  变了就改，保持摘要与代码一致；只改实现细节、无新约定时不改。
- **本地 Git 分支约定**：仓库默认分支为 `main`（GitHub），本地初始化时默认 `master`；
  推送前统一改名为 `main`。workflow 监听 `main` 和 `master` 双分支，推送哪个都触发构建。
- UI 文案、错误消息用中文；标识符用英文。
- 数据格式/文件名解析规则与桌面端严格一致（`_` 分隔、`P1..P4`、净化标题），改动前先看
  `store.ts` 注释与桌面端 `存储目录设计.md`，避免破坏与桌面端的数据互通。
- 农历封装 `lunar.ts` 依赖 `lunar-javascript`（桌面端用内置 `ChineseLunisolarCalendar`，
  二者输出一致：闰月返回负数月份、`闰六` 带前缀）。
- `src-tauri/Cargo.toml` 的 `tauri-plugin-fs` **必须保留 `features = ["watch"]`**，否则
  `watch()` 调用在 Rust 侧不存在，Android 运行时报错。
- 改了 `capabilities/*.json` 后，若在支持的环境跑 `tauri dev/build` 会重新生成
  `gen/schemas`；`src-tauri/.gitignore` 已忽略 `gen/schemas`，不影响提交。
- `.omo/` 未跟踪（本工具状态目录，勿提交）。
