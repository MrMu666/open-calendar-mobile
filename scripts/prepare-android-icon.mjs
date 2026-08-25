/**
 * 生成 Android 自适应图标的前景图（app-icon-fg.png）。
 *
 * 背景：桌面端图标 app-256.png 内容占满全图（约 70% 图形 + 深蓝底），
 * 直接用作 Android 自适应图标前景会被系统放大到安全区外，视觉上"图标太大"。
 *
 * 做法：把源图内容缩放到画布中央约 66%（Android 自适应图标安全区直径），
 * 四周留透明边距，作为 ic_launcher_foreground 的前景层；背景层由
 * tauri icon 用 manifest 的 android_bg / bg_color 生成。
 *
 * 用法：node scripts/prepare-android-icon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const SRC = 'app-icon.png';
const OUT = 'app-icon-fg.png';
const OUT_BG = 'app-icon-bg.png';
const BG_COLOR = [0x24, 0x33, 0x4f]; // 与源图背景一致（#24334F）
const SIZE = 1024; // 输出画布（tauri icon 会再缩放各密度）
/** 前景内容占画布比例（Android 安全区约 66%）。 */
const CONTENT_RATIO = 0.66;

function main() {
  const src = PNG.sync.read(readFileSync(SRC));
  const { width: sw, height: sh, data: sdata } = src;

  // 计算源图不透明内容边界（去掉透明留白）
  let minX = sw, maxX = 0, minY = sh, maxY = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (sdata[(y * sw + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const contentSide = Math.max(cw, ch);

  // 目标内容边长 = 画布 * CONTENT_RATIO
  const targetSide = SIZE * CONTENT_RATIO;
  const scale = targetSide / contentSide;

  const out = new PNG({ width: SIZE, height: SIZE });
  const offsetX = Math.round((SIZE - cw * scale) / 2);
  const offsetY = Math.round((SIZE - ch * scale) / 2);

  // 双线性插值缩放（简化版：按目标像素映射回源图采样）
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 目标画布坐标 → 源图内容坐标
      const sx = (x - offsetX) / scale + minX;
      const sy = (y - offsetY) / scale + minY;
      const oi = (y * SIZE + x) * 4;

      if (sx < minX || sx >= maxX + 1 || sy < minY || sy >= maxY + 1) {
        out.data[oi + 3] = 0; // 透明
        continue;
      }

      // 双线性采样
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      for (let c = 0; c < 4; c++) {
        const v =
          sdata[i00 + c] * (1 - fx) * (1 - fy) +
          sdata[i10 + c] * fx * (1 - fy) +
          sdata[i01 + c] * (1 - fx) * fy +
          sdata[i11 + c] * fx * fy;
        out.data[oi + c] = Math.round(v);
      }
    }
  }

  writeFileSync(OUT, PNG.sync.write(out));
  console.log(`已生成 ${OUT}（画布 ${SIZE}x${SIZE}，内容占比 ${Math.round(CONTENT_RATIO * 100)}%）`);

  // 背景层：纯色填充，用于 ic_launcher.png 的非自适应图标叠加
  const bg = new PNG({ width: SIZE, height: SIZE });
  for (let i = 0; i < bg.data.length; i += 4) {
    bg.data[i] = BG_COLOR[0];
    bg.data[i + 1] = BG_COLOR[1];
    bg.data[i + 2] = BG_COLOR[2];
    bg.data[i + 3] = 255;
  }
  writeFileSync(OUT_BG, PNG.sync.write(bg));
  console.log(`已生成 ${OUT_BG}（纯色背景 #${BG_COLOR.map((n) => n.toString(16).padStart(2, '0')).join('')}）`);
}

main();
