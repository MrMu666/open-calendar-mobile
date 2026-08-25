/**
 * 每次推送自动递增小版本号（patch+1），并保持 package.json / tauri.conf.json 同步。
 *
 * 供 .github/workflows/build-android.yml 使用。打印新版本号。
 * 用法：node scripts/bump-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
}

function writeJson(rel, obj) {
  writeFileSync(resolve(root, rel), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// package.json 为版本唯一来源
const pkg = readJson('package.json');
const [major, minor, patch] = String(pkg.version)
  .split('.')
  .map((n) => parseInt(n, 10));
if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
  console.error(`无法解析版本号: ${pkg.version}`);
  process.exit(1);
}
const next = `${major}.${minor}.${patch + 1}`;
pkg.version = next;
writeJson('package.json', pkg);

// tauri.conf.json 的 version 字段指向 package.json（相对路径），无需单独改
const conf = readJson('src-tauri/tauri.conf.json');
conf.version = '../package.json';
writeJson('src-tauri/tauri.conf.json', conf);

console.log(next);
