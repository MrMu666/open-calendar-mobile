# Android 签名（sign/）

本目录存放 Android APK 签名 keystore。**敏感文件已加入 `.gitignore`，不会提交到仓库**；
CI 构建时通过 GitHub Secrets 注入签名（见 `.github/workflows/build-android.yml`）。

## 本目录文件

| 文件 | 说明 | 是否入库 |
|---|---|---|
| `open-calendar-keystore.p12` | 签名 keystore（PKCS12，RSA 2048，有效期至 2054 年） | ❌ |
| `keystore-pass.txt` | keystore 密码（`storePassword` 与 `keyPassword` 相同） | ❌ |
| `open-calendar-keystore.p12.base64` | keystore 的 base64，用于填 GitHub Secret | ❌ |
| `README.md` | 本说明 | ✅ |

> keystore 别名（keyAlias）为 `upload`。

## 如何放入 GitHub（一次性配置）

在 GitHub 仓库页面打开 **Settings → Secrets and variables → Actions → New repository secret**，
依次添加以下 3 个 Secret（值分别取自本目录对应文件）：

| Secret 名称 | 值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `open-calendar-keystore.p12.base64` 的**全部内容**（单行粘贴） |
| `ANDROID_KEYSTORE_PASSWORD` | `keystore-pass.txt` 的内容 |
| `ANDROID_KEY_ALIAS` | `upload` |

配置完成后，推送代码即自动触发构建：每次推送先把版本号（patch）+1 提交回仓库，
再用签名 keystore 构建 APK 并上传为 Artifact（Actions 页 → 对应 run → Artifacts → 下载）。

若未配置 Secrets，workflow 会跳过签名（构建未签名 APK）并输出警告，不会失败。

## 重新生成 keystore

本机没有 Java，keystore 由 Git Bash 自带 OpenSSL 生成（AGP 完全支持 PKCS12）：

```bash
cd sign
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 10000 -nodes \
  -subj "/C=CN/O=MrMu666/CN=OpenCalendar"
openssl pkcs12 -export -inkey key.pem -in cert.pem -out open-calendar-keystore.p12 \
  -name upload -passout pass:"$(cat keystore-pass.txt)"
base64 -w0 open-calendar-keystore.p12 > open-calendar-keystore.p12.base64
rm key.pem cert.pem
```

> 注意：Android 应用一旦以某个 keystore 发布，升级包必须用**同一个 keystore** 签名，
> 否则设备无法覆盖安装。请妥善备份 `open-calendar-keystore.p12` 与密码。
