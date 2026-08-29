#!/usr/bin/env node
/**
 * Datum 前端 · 真实浏览器复测（批 3 收尾）
 *
 * 补的是 jsdom 和 iframe 截图量不到的三件事，都是 12 页巡检报告里明写
 * 「本次不下结论」的那几笔账：
 *
 *  1. 「每个端点被调用 2 次」是不是生产缺陷。
 *     dev 下 React.StrictMode（src/main.jsx:9）会把 effect 双调用，这是已知行为，
 *     所以只看 dev 永远分不清。这里同一串路由各跑一遍 dev 和 build+preview，
 *     把每个 /api/ 端点的请求数并排打出来——只有 preview 也翻倍才算真缺陷。
 *
 *  2. 360 档此前是 iframe 的布局视口，不是真实设备度量。这里走 CDP
 *     Emulation.setDeviceMetricsOverride（Playwright 的 isMobile/hasTouch），
 *     把巡检没覆盖的三件事补上：触摸/指针媒体查询、移动浏览器 chrome 对
 *     100dvh 的影响、overlay 滚动条宽度（后者直接决定 P1-2 那对滚动箭头
 *     在真机上到底是被滚条挤掉还是叠在内容上）。
 *
 *  3. 生产构建那份 bundle 的启动链路里有没有 console error / React 警告。
 *
 * 用法：
 *   CHECK_USERNAME=… CHECK_PASSWORD=… npm run check:browser --prefix ui/V2_PROTOTYPE
 *   可选项：CHECK_API_ORIGIN（默认 http://localhost:3000）、CHECK_CHROME_PATH
 *
 * 凭据只从环境变量读，不写进文件、不进 git。
 *
 * 浏览器走 playwright-core + 系统 Chrome（channel: 'chrome'），不下载浏览器二进制。
 * 这是本地工具，不接 CI 门禁：它需要一个活着的后端和一个真账号，CI 两样都没有。
 */
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build, createServer, preview } from 'vite'
import { chromium } from 'playwright-core'

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(uiRoot, '.cache', 'browser-check')
const DEV_PORT = 4510
const PREVIEW_PORT = 4511
const API_TARGET = process.env.CHECK_API_ORIGIN || 'http://localhost:3000'
const PROXY = { '/api/': { target: API_TARGET, changeOrigin: true } }

// dev 与 preview 必须走同一串路由，否则请求数没法对比。
const COUNT_ROUTES = ['/', '/projects', '/assessments']
// 360 档横向溢出检查的路由；页签条那一项单独跑，需要先塞足够多的页签才会溢出。
const MOBILE_ROUTES = ['/', '/projects', '/assessments']
const SEED_TABS = [
  { path: '/', title: 'AI 工作台' },
  { path: '/projects', title: '项目评估' },
  { path: '/assessments', title: '实施评估' },
  { path: '/dev-assessments', title: '开发评估' },
  { path: '/resource-costs', title: '资源成本' },
  { path: '/reviews', title: '评审管理' },
  { path: '/requirements', title: '需求管理' },
  { path: '/api-keys', title: 'API 密钥' },
]

const USERNAME = process.env.CHECK_USERNAME
const PASSWORD = process.env.CHECK_PASSWORD

function log(...args) {
  console.log(...args)
}

async function newPage(browser, viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  })
  return { context, page: await context.newPage() }
}

function collect(page, bag) {
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) return
    // 必须带上 query：/versions?type=requirementImport 与 ?type=assessment 是两个
    // 不同端点，只看 pathname 会把它计成「同一端点请求 2 次」——假阳性。
    const key = `${req.method()} ${url.pathname}${url.search}`
    const target = bag.current || bag.requests
    target.set(key, (target.get(key) || 0) + 1)
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return
    bag.messages.push(`[${msg.type()}] ${msg.text().slice(0, 220)}`)
  })
  page.on('pageerror', (err) => bag.messages.push(`[pageerror] ${String(err).slice(0, 220)}`))
}

async function openRoute(page, origin, route) {
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(600)
}

async function login(page, origin) {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login-username', USERNAME)
  await page.fill('#login-password', PASSWORD)
  await page.click('button[type="submit"]:visible')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 })
}

/**
 * dev / preview 各跑一遍，逐路由记下「这个端点在这一页被请求了几次」。
 * 必须分路由计：整个会话累加会把「3 个页面各请求 1 次」误读成「重复请求」。
 * 两端跑同一串路由，才能直接对比。bag.current 由调用方翻页时切换。
 */
async function countRequests(browser, origin) {
  const bag = { requests: new Map(), byRoute: [], current: null, messages: [] }
  const { context, page } = await newPage(browser, { width: 1280, height: 900 })
  bag.current = bag.requests
  collect(page, bag)
  await login(page, origin)
  for (const route of COUNT_ROUTES) {
    const bucket = new Map()
    bag.byRoute.push({ route, requests: bucket })
    bag.current = bucket
    await openRoute(page, origin, route)
  }
  bag.current = null
  await context.close()
  return { requests: bag.requests, byRoute: bag.byRoute, messages: bag.messages.filter((m) => !m.startsWith('---')) }
}

/** 360 真实移动度量下，每页的横向溢出与被判定为溢出的元素。 */
async function checkMobileLayout(browser, origin) {
  const rows = []
  const messages = []
  const { context, page } = await newPage(browser, { width: 360, height: 780 }, true)
  collect(page, { requests: new Map(), messages })
  await login(page, origin)
  for (const route of MOBILE_ROUTES) {
    await openRoute(page, origin, route)
    rows.push({ route, ...(await page.evaluate(measureLayout)) })
  }
  await context.close()
  return { rows, messages }
}

function measureLayout() {
  const vw = window.innerWidth
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= vw + 1 && r.left >= -1) continue
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    offenders.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${Math.round(r.left)}→${Math.round(r.right)}]`)
    if (offenders.length >= 8) break
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;left:0;top:0;height:100dvh;width:1px;pointer-events:none'
  document.body.appendChild(probe)
  const dvhPx = Math.round(probe.getBoundingClientRect().height)
  probe.remove()
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: vw,
    overflow: document.documentElement.scrollWidth > vw + 1,
    offenders,
    pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    hoverNone: window.matchMedia('(hover: none)').matches,
    innerHeight: window.innerHeight,
    dvhPx,
    scrollbarGutter: window.outerWidth - vw,
  }
}

/**
 * P1-2 的验收：页签条溢出时那对箭头在真机上到底长什么样。
 * jsdom 里几何是 stub 出来的，这里量的是真的 scrollWidth / boundingBox。
 */
async function checkTabStripCue(browser, origin) {
  const messages = []
  const { context, page } = await newPage(browser, { width: 360, height: 780 }, true)
  collect(page, { requests: new Map(), messages })
  await login(page, origin)
  await page.evaluate((tabs) => {
    window.localStorage.setItem('wes-v2-workspace-tabs-v1', JSON.stringify(tabs))
  }, SEED_TABS)
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)

  const strip = page.locator('.workspace-tabs')
  const geom = await strip.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    position: getComputedStyle(el).position,
    backdrop: getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter,
  }))

  const rightCue = page.getByRole('button', { name: '页签向右滚动' })
  const exists = (await rightCue.count()) > 0
  let cue = { exists }
  if (exists) {
    const box = await rightCue.boundingBox()
    cue = {
      ...cue,
      box,
      onScreen: !!box && box.x >= 0 && box.x + box.width <= 360 && box.y >= 0,
      position: await rightCue.evaluate((el) => getComputedStyle(el).position),
      opacity: await rightCue.evaluate((el) => getComputedStyle(el).opacity),
    }
    await rightCue.click()
    await page.waitForTimeout(700)
    cue.scrollLeftAfterClick = await strip.evaluate((el) => Math.round(el.scrollLeft))
    // 滚到中间后：左箭头该出现、右箭头还在（没到最右）
    cue.leftCueAfterScroll = (await page.getByRole('button', { name: '页签向左滚动' }).count()) > 0
    cue.rightCueStillThere = (await rightCue.count()) > 0
    await page.screenshot({ path: path.join(outDir, 'tab-strip-360-scrolled.png'), clip: await strip.boundingBox() })
    // 滚回最左：左箭头该消失
    await strip.evaluate((el) => el.scrollTo({ left: 0 }))
    await page.waitForTimeout(400)
    cue.leftCueBackAtStart = (await page.getByRole('button', { name: '页签向左滚动' }).count()) > 0
    // 滚到最右：右箭头该消失
    await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await page.waitForTimeout(400)
    cue.rightCueAtEnd = (await rightCue.count()) > 0
    await strip.evaluate((el) => el.scrollTo({ left: 0 }))
    await page.waitForTimeout(400)
  }

  await page.screenshot({ path: path.join(outDir, 'tab-strip-360.png'), clip: await strip.boundingBox() })
  await context.close()
  return { geom, cue, messages }
}

function printCounts(label, result) {
  log(`\n[${label}]`)
  log(`  登录阶段：${[...result.requests.entries()].map(([k, n]) => `${n}× ${k}`).join('，') || '无'}`)
  for (const { route, requests } of result.byRoute) {
    log(`  ${route}：`)
    for (const [k, n] of [...requests.entries()].sort()) log(`      ${String(n).padStart(2)}×  ${k}`)
    const over = [...requests.entries()].filter(([, n]) => n > 1)
    if (!over.length) log('      （无重复：每个端点都只 1 次）')
  }
}

/** dev 与 preview 逐路由逐端点对比，只列出数量不一致的。 */
function diffCounts(dev, prod) {
  const rows = []
  for (const { route, requests: devMap } of dev.byRoute) {
    const prodMap = prod.byRoute.find((r) => r.route === route)?.requests || new Map()
    const keys = new Set([...devMap.keys(), ...prodMap.keys()])
    for (const k of [...keys].sort()) {
      const d = devMap.get(k) || 0
      const p = prodMap.get(k) || 0
      if (d !== p) rows.push(`  ${route}  ${k}: dev ${d}× / preview ${p}×`)
    }
  }
  return rows
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    console.error('需要 CHECK_USERNAME / CHECK_PASSWORD —— 复测要走真实登录，凭据不落文件。')
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })

  log('构建生产包（build:web 同一份配置）…')
  await build({ root: uiRoot, logLevel: 'warn' })

  const devServer = await createServer({ root: uiRoot, logLevel: 'warn', server: { port: DEV_PORT, strictPort: true, host: '127.0.0.1' } })
  await devServer.listen()
  const previewServer = await preview({ root: uiRoot, logLevel: 'warn', preview: { port: PREVIEW_PORT, strictPort: true, host: '127.0.0.1', proxy: PROXY } })

  const devOrigin = `http://127.0.0.1:${DEV_PORT}`
  const prodOrigin = `http://127.0.0.1:${PREVIEW_PORT}`
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHECK_CHROME_PATH ? { executablePath: process.env.CHECK_CHROME_PATH } : { channel: 'chrome' }),
  })

  try {
    log(`\n${'='.repeat(68)}\n一、StrictMode：同一端点在 dev 与生产包里各被请求几次\n${'='.repeat(68)}`)
    const dev = await countRequests(browser, devOrigin)
    const prod = await countRequests(browser, prodOrigin)
    printCounts(`dev ${devOrigin}（StrictMode 双调用开着）`, dev)
    printCounts(`preview ${prodOrigin}（生产 bundle）`, prod)
    const diff = diffCounts(dev, prod)
    log('\ndev 与 preview 请求数不一致的端点（一致 = 与 StrictMode 无关，得单独查）：')
    log(diff.length ? diff.join('\n') : '  无：两端逐个端点相同')
    log('\npreview（生产）侧的 console error/warning：')
    log(prod.messages.length ? prod.messages.map((m) => `  ${m}`).join('\n') : '  无')
    log('\ndev 侧的 console error/warning（StrictMode 提示预期在此出现）：')
    log(dev.messages.length ? dev.messages.map((m) => `  ${m}`).join('\n') : '  无')

    log(`\n${'='.repeat(68)}\n二、360 档真实移动度量（CDP setDeviceMetricsOverride，非 iframe）\n${'='.repeat(68)}`)
    const mobile = await checkMobileLayout(browser, prodOrigin)
    for (const r of mobile.rows) {
      log(`\n${r.route}`)
      log(`  scrollWidth ${r.scrollWidth} vs innerWidth ${r.innerWidth} → ${r.overflow ? '有横向溢出' : '不溢出'}`)
      log(`  pointer:coarse=${r.pointerCoarse} hover:none=${r.hoverNone}（触摸媒体查询是否命中）`)
      log(`  innerHeight ${r.innerHeight} / 100dvh 实测 ${r.dvhPx}px / outerWidth-innerWidth ${r.scrollbarGutter}`)
      log(`  溢出元素${r.offenders.length ? `：\n    ${r.offenders.join('\n    ')}` : '：无'}`)
    }
    if (mobile.messages.length) log(`\n移动端侧 console：\n${mobile.messages.map((m) => `  ${m}`).join('\n')}`)

    log(`\n${'='.repeat(68)}\n三、P1-2 页签条滚动箭头在真机上的实际形态\n${'='.repeat(68)}`)
    const tab = await checkTabStripCue(browser, prodOrigin)
    log(`  .workspace-tabs scrollWidth ${tab.geom.scrollWidth} / clientWidth ${tab.geom.clientWidth}` +
      `（溢出 ${tab.geom.scrollWidth - tab.geom.clientWidth}px）position=${tab.geom.position} backdrop=${tab.geom.backdrop}`)
    log(`  右箭头渲染：${tab.cue.exists ? '是' : '否（溢出却没出箭头 = 真缺陷）'}`)
    if (tab.cue.exists) {
      log(`  右箭头 position=${tab.cue.position} opacity=${tab.cue.opacity} 盒=${tab.cue.box && JSON.stringify(tab.cue.box)}`)
      log(`  完整落在 360 视口内：${tab.cue.onScreen ? '是' : '否（被切掉/跑出视口）'}`)
      log(`  点一次后 scrollLeft=${tab.cue.scrollLeftAfterClick}（>0 才算真滚得动）`)
      log(`  滚到中间：左箭头出现=${tab.cue.leftCueAfterScroll}，右箭头仍在=${tab.cue.rightCueStillThere}`)
      log(`  滚回最左：左箭头已收起=${!tab.cue.leftCueBackAtStart}`)
      log(`  滚到最右：右箭头已收起=${!tab.cue.rightCueAtEnd}`)
      log(`  截图：${outDir}/tab-strip-360.png（未滚）与 tab-strip-360-scrolled.png（滚到中间）`)
    }
    if (tab.messages.length) log(`  console：\n${tab.messages.map((m) => `    ${m}`).join('\n')}`)
  } finally {
    await browser.close()
    await devServer.close()
    await previewServer.httpServer.close()
  }
}

main().catch((err) => {
  console.error('\n复测未完成：', err?.message || err)
  console.error('常见原因：后端没起（默认 http://localhost:3000）、端口被占、系统里没有 Chrome。')
  process.exit(1)
})
