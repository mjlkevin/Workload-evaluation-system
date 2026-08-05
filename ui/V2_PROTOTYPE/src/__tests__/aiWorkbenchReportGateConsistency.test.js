/**
 * 前后端口径一致性单测（O1 硬口径约束）。
 *
 * 「文件是上下文，用户意图才触发工作流」：前端 AiHomeWorkbench 的
 * isExplicitReportRequest 闸门必须与后端 chat.service.ts 的同名闸门
 * 对同一组样例文案给出完全一致的判定。
 *
 * 实现方式：直接从后端源码文件中提取 isExplicitReportRequest 的两条
 * 正则字面量并动态构造判定函数，避免前端测试对后端模块产生运行时
 * 依赖；同时断言双端正则源码逐字一致，防止单侧漂移。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isExplicitReportRequest } from '../pages/AiHomeWorkbench/utils/reportParser.js'

const BACKEND_SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/api/src/services/ai/chat.service.ts',
)

function extractBackendGate(source) {
  const fnMatch = source.match(/function isExplicitReportRequest\(text: string\): boolean \{\s*return\s+([^;]+);/)
  expect(fnMatch, '后端 chat.service.ts 必须保留 isExplicitReportRequest 闸门函数').toBeTruthy()
  const regexLiterals = [...fnMatch[1].matchAll(/\/((?:[^/\\]|\\.)+)\/([a-z]*)/g)]
  expect(regexLiterals.length, '后端闸门应由两条正则字面量组成').toBe(2)
  const [verb, noun] = regexLiterals.map((match) => new RegExp(match[1], match[2]))
  return {
    verb,
    noun,
    test: (text) => verb.test(text || '') && noun.test(text || ''),
  }
}

/* 覆盖正例、反例与口径边界（仅上传文件提问不得触发 Harness Run） */
const SAMPLE_TEXTS = [
  // 显式报告请求（正例）
  '请帮我生成需求解析报告',
  '输出需求包',
  '创建评估输入',
  '启动评估草稿',
  '请基于当前附件生成需求解析报告',
  '生成一下报告',
  // 仅提问 / 仅上下文（反例）
  '这份文件讲了什么？',
  '帮我看看这份需求文件',
  '这个项目的复杂度如何？',
  '我之前创建过哪些项目？',
  '报告里的风险有哪些？',
  '请解析这个文件并启动工作流。',
  '生成',
  '报告',
  '',
]

describe('前后端 isExplicitReportRequest 闸门口径一致性', () => {
  const backendSource = fs.readFileSync(BACKEND_SOURCE_PATH, 'utf8')
  const backend = extractBackendGate(backendSource)

  it('双端正则字面量逐字一致', () => {
    const frontendSource = isExplicitReportRequest.toString()
    const frontendRegexes = [...frontendSource.matchAll(/\/((?:[^/\\]|\\.)+)\/(?=[.)])/g)].map((match) => match[1])
    expect(frontendRegexes).toContain(backend.verb.source)
    expect(frontendRegexes).toContain(backend.noun.source)
  })

  it.each(SAMPLE_TEXTS.map((text) => [text === '' ? '(空文本)' : text, text]))(
    '同一文案双端判定一致：%s',
    (_label, text) => {
      expect(isExplicitReportRequest(text)).toBe(backend.test(text))
    },
  )

  it('上传文件但未明确提出报告请求的默认文案不触发 Harness Run', () => {
    const fileOnlyDefaultText = '请解析这个文件并启动工作流。'
    expect(isExplicitReportRequest(fileOnlyDefaultText)).toBe(false)
    expect(backend.test(fileOnlyDefaultText)).toBe(false)
  })
})
