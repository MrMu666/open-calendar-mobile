#!/usr/bin/env python3
"""
在 `tauri android init` 之后，向 app/build.gradle.kts 注入 release 签名配置
（读取 src-tauri/gen/android/keystore.properties，与官方文档一致）。

仅在 keystore.properties 存在时注入；否则跳过（构建未签名 APK）。
幂等：已含 signingConfigs 时直接跳过。
"""
import pathlib
import sys

GEN_DIR = pathlib.Path("src-tauri/gen/android")
APP_DIR = GEN_DIR / "app"
GRADLE = APP_DIR / "build.gradle.kts"
KEYSTORE_PROPS = GEN_DIR / "keystore.properties"


def main() -> int:
    if not GRADLE.exists():
        print(f"[inject] 未找到 {GRADLE}，跳过")
        return 0

    text = GRADLE.read_text(encoding="utf-8")

    if "signingConfigs" in text:
        print("[inject] build.gradle.kts 已包含 signingConfigs，跳过")
        return 0

    if not KEYSTORE_PROPS.exists():
        print("[inject] keystore.properties 不存在（未配置签名 Secrets），构建未签名 APK")
        return 0

    # 1) 顶部 import
    text = text.replace(
        "import java.util.Properties\n",
        "import java.io.FileInputStream\nimport java.util.Properties\n",
        1,
    )

    # 2) android { 块首插入 signingConfigs（缩进 4 空格）
    signing_block = (
        "signingConfigs {\n"
        '        create("release") {\n'
        "            val keystorePropertiesFile = rootProject.file(\"keystore.properties\")\n"
        "            val keystoreProperties = Properties()\n"
        "            if (keystorePropertiesFile.exists()) {\n"
        "                keystoreProperties.load(FileInputStream(keystorePropertiesFile))\n"
        "            }\n"
        '            keyAlias = keystoreProperties["keyAlias"] as String\n'
        '            keyPassword = keystoreProperties["password"] as String\n'
        '            storeFile = file(keystoreProperties["storeFile"] as String)\n'
        '            storePassword = keystoreProperties["password"] as String\n'
        '            storeType = "PKCS12"\n'
        "        }\n"
        "    }\n"
    )
    text = text.replace("android {\n", "android {\n    " + signing_block, 1)

    # 3) release buildType 使用该签名
    text = text.replace(
        'getByName("release") {\n',
        'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")\n',
        1,
    )

    GRADLE.write_text(text, encoding="utf-8")
    print("[inject] 已注入 release 签名配置")
    return 0


if __name__ == "__main__":
    sys.exit(main())
