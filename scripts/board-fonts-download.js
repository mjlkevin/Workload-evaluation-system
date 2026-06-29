#!/usr/bin/env node
/**
 * 看板字体本地化脚本
 * 从 Google Fonts 下载 Inter / JetBrains Mono / Noto Sans SC 到 assets/fonts/
 * 并生成本地 fonts.css（@font-face 指向本地文件）
 *
 * 用法: node scripts/board-fonts-download.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const FONTS_DIR = path.join(BOARD_DIR, 'assets', 'fonts');
const FONTS_CSS = path.join(FONTS_DIR, 'fonts.css');

// Google Fonts CSS URL — 请求 woff2 格式
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700;800&display=swap';

// 确保目录存在
if (!fs.existsSync(FONTS_DIR)) {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    }).on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

async function main() {
  console.log(' 获取 Google Fonts CSS ...');
  const css = await fetch(GOOGLE_FONTS_URL);

  // 提取所有 url(...) 中的字体文件 URL
  const urlRegex = /url\(([^)]+)\)/g;
  const fontUrls = [];
  let match;
  while ((match = urlRegex.exec(css)) !== null) {
    let url = match[1].replace(/['"]/g, '');
    if (url.startsWith('//')) url = 'https:' + url;
    fontUrls.push(url);
  }

  console.log(`🔤 发现 ${fontUrls.length} 个字体文件`);

  // 下载每个字体文件
  const downloaded = [];
  for (const url of fontUrls) {
    const fileName = path.basename(new URL(url).pathname);
    const dest = path.join(FONTS_DIR, fileName);
    if (fs.existsSync(dest)) {
      console.log(`  ⏭  ${fileName} 已存在，跳过`);
      downloaded.push({ fileName, url, localPath: `fonts/${fileName}` });
      continue;
    }
    console.log(`  ⬇  下载 ${fileName} ...`);
    try {
      await downloadFile(url, dest);
      const size = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`  ✅ ${fileName} (${size} KB)`);
      downloaded.push({ fileName, url, localPath: `fonts/${fileName}` });
    } catch (err) {
      console.error(`  ❌ ${fileName} 下载失败: ${err.message}`);
    }
  }

  // 生成本地 fonts.css
  // 从原始 CSS 提取 @font-face 块，替换 url() 为本地路径
  const fontFaceRegex = /@font-face\s*\{[^}]+\}/g;
  const fontFaces = css.match(fontFaceRegex) || [];

  let localCss = '/* 本地字体 — 由 scripts/board-fonts-download.js 自动生成 */\n';
  localCss += '/* 如果本地字体文件缺失，将回退到系统字体 */\n\n';

  for (const face of fontFaces) {
    let modified = face;
    // 替换 url(...) 为本地路径
    modified = modified.replace(/url\(([^)]+)\)/g, (m, url) => {
      let cleanUrl = url.replace(/['"]/g, '');
      if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
      const fileName = path.basename(new URL(cleanUrl).pathname);
      return `url('${fileName}')`;
    });
    localCss += modified + '\n\n';
  }

  fs.writeFileSync(FONTS_CSS, localCss, 'utf-8');
  console.log(`\n📝 已生成 ${FONTS_CSS}`);
  console.log(`📁 字体目录: ${FONTS_DIR}`);
  console.log(`\n✅ 字体本地化完成！共下载 ${downloaded.length} 个字体文件`);
}

main().catch((err) => {
  console.error('❌ 字体下载失败:', err.message);
  console.log('\n💡 回退方案：HTML 中将保留 Google Fonts 链接作为在线回退');
  process.exit(1);
});
