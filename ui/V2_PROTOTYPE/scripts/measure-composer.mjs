#!/usr/bin/env node
/**
 * ISS-2026-09-04-001 窄屏 composer 裁切 · 真实浏览器逐元素度量
 *
 * 量的是「读不到 / 点不到」，不是「不好看」：
 *   - 逐元素 right > innerWidth 清单（不看 scrollWidth-clientWidth：
 *     html/body 都是 overflow-x:hidden，该差值恒为 0，只看它必然误判）
 *   - 每个越界元素最近滚动祖先的 overflow-x（auto=可滚可达，hidden=永久不可达）
 *
 * 浏览器走 playwright-core + 系统 Chrome，数据源用 page.route 打桩
 * （后端未起且 ProtectedLayout 在 /auth/me 失败时会跳登录）。
 * 浏览器 / CSS / 布局为真实，仅数据源为桩。
 */
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(uiRoot, '.cache', 'composer-clip')
const PORT = 4520
const WIDTHS = [360, 390, 414]
const TAG = process.argv[2] || 'measure'

const USER = { id: 1, username: 'kevin', displayName: 'kevin', role: 'admin', roles: ['admin'] }

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

async function stub(route) {
  const url = route.request().url()
  if (/\/auth\/me/.test(url)) return route.fulfill(json({ success: true, data: { user: USER }, user: USER }))
  if (/\/auth\/users/.test(url)) return route.fulfill(json({ success: true, data: { users: [USER] } }))
  if (/\/ai-sessions/.test(url)) return route.fulfill(json({ success: true, data: { sessions: [], items: [], list: [] } }))
  if (/\/ai-runs/.test(url)) return route.fulfill(json({ success: true, data: { runs: [], items: [], list: [] } }))
  if (/\/memory/.test(url)) return route.fulfill(json({ success: true, data: { items: [], list: [] } }))
  return route.fulfill(json({ success: true, data: { items: [], list: [], rows: [] } }))
}

const PROBE = () => {
  const vw = window.innerWidth
  const SEL = [
    '.ai-composer', '.ai-composer__inner', '.ai-composer__row',
    '.ai-composer__attach', '.ai-composer__textarea', '.ai-composer__send',
  ]
  const scrollableAncestor = (el) => {
    let n = el.parentElement
    while (n && n !== document.documentElement) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
        return {
          selector: n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''),
          overflowX: ox,
          canScroll: n.scrollWidth > n.clientWidth,
          clientWidth: Math.round(n.clientWidth),
          scrollWidth: Math.round(n.scrollWidth),
          right: Math.round(n.getBoundingClientRect().right),
        }
      }
      n = n.parentElement
    }
    return null
  }
  const rows = []
  for (const sel of SEL) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      rows.push({
        selector: sel,
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        overflows: Math.round(r.right) > vw,
        ancestor: Math.round(r.right) > vw ? scrollableAncestor(el) : null,
      })
    }
  }
  return {
    viewport: vw,
    docDelta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyDelta: document.body.scrollWidth - document.body.clientWidth,
    htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    rows,
    overflowing: rows.filter((r) => r.overflows).length,
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const server = await createServer({ root: uiRoot, server: { port: PORT, strictPort: true } })
  await server.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2 })
      await ctx.route('**/api/v1/**', stub)
      await ctx.addInitScript(() => { localStorage.setItem('wes_token', 'stub-token-for-layout-measurement') })
      const page = await ctx.newPage()
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.ai-composer__row', { timeout: 20000 })
      await page.waitForTimeout(400)
      const data = await page.evaluate(PROBE)
      results.push(data)
      await page.screenshot({ path: path.join(outDir, `${TAG}-${width}.png`), fullPage: false })
      await ctx.close()
      console.log(`[${width}] 越界元素 ${data.overflowing} 个 | docDelta=${data.docDelta} bodyDelta=${data.bodyDelta} (html/body overflow-x=${data.htmlOverflowX}/${data.bodyOverflowX})`)
      for (const r of data.rows.filter((x) => x.overflows)) {
        console.log(`   ✗ ${r.selector} right=${r.right} > vw=${width} | 最近滚动祖先: ${r.ancestor ? `${r.ancestor.selector.slice(0, 60)} overflow-x=${r.ancestor.overflowX} canScroll=${r.ancestor.canScroll}` : '(无)'}`)
      }
      for (const r of data.rows.filter((x) => !x.overflows)) {
        console.log(`   ✓ ${r.selector} right=${r.right} width=${r.width}`)
      }
    }
    writeFileSync(path.join(outDir, `${TAG}.json`), JSON.stringify(results, null, 2))
    console.log(`\nJSON → ${path.join(outDir, `${TAG}.json`)}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
