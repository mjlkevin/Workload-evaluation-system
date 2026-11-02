import { SystemBadge } from '../../components/system/SystemObjectList.jsx'

const json = value => JSON.stringify(value, null, 2)
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '刚刚'
export function SkillSimulatedSteps({ steps = [] }) {
  if (!steps.length) return null
  return <details className="min-w-0 text-sm text-warn-ink"><summary className="cursor-pointer">隔离工具步骤（{steps.length}，仅模拟执行）</summary><ol className="space-y-2 pl-5">{steps.map((step, index) => <li key={index} className="wrap-anywhere">{step.toolName} · {step.reason || 'dry-run'}<pre className="m-0 whitespace-pre-wrap font-mono text-xs wrap-anywhere">{json({ arguments: step.arguments, result: step.result })}</pre></li>)}</ol></details>
}
export default function SkillTrialEvidence({ trial, examples = [] }) {
  const result = trial.result
  const simulation = result.mode === 'simulation'
  return <article className="min-w-0 space-y-3 rounded-md border border-solid border-line p-3" aria-label={`试运行 ${trial.id}`}>
    <div className="flex flex-wrap items-center gap-2"><SystemBadge tone={result.passed ? 'brand' : 'warn'}>{result.passed ? '试运行通过' : '试运行失败'}</SystemBadge><span className="text-xs text-ink-2">{simulation ? '样例模拟 · 未调用模型 · 不用于发布' : '真实模型试运行'} · {time(trial.createdAt)}</span>{trial.current === false && <span className="text-xs text-warn-ink">已过期，不用于发布</span>}{trial.current === undefined && <span className="text-xs text-ink-2">发布资格待刷新确认</span>}</div>
    <div className="text-xs text-ink-2 wrap-anywhere">证据：{trial.id} · 定义：{trial.hash} · 依赖：{trial.contextHash}</div>
    <p className="m-0 text-xs text-ink-2">{simulation ? `模拟耗时：${result.usage?.elapsedMs ?? 0} ms` : `模型尝试：${result.usage?.modelAttempts ?? 0} · 输出 Tokens：${result.usage?.outputTokens ?? 0} · 工具调用：${result.usage?.toolCalls ?? 0} · 耗时：${result.usage?.elapsedMs ?? 0} ms`}</p>
    {result.failures?.length > 0 && <p className="m-0 text-sm text-err-ink wrap-anywhere">{result.failures.map(item => `${item.category}: ${item.code}`).join('；')}</p>}
    <div className="space-y-2">{result.cases?.map((item, index) => <details key={index} className="min-w-0 text-sm"><summary className="cursor-pointer">{item.title} · {item.passed ? '通过' : '失败'}</summary><div className="space-y-2 pt-2">
      <p className="m-0 text-xs text-ink-2">{simulation ? '期望样例回放，未调用模型' : item.providers?.map(provider => `${provider.provider} · ${provider.model}`).join('、') || '未返回模型信息'}</p>
      {item.failures?.length > 0 && <p className="m-0 text-err-ink wrap-anywhere">{item.failures.map(failure => `${failure.category}: ${failure.code}`).join('；')}</p>}
      {examples[index] && <details className="text-xs text-ink-2"><summary className="cursor-pointer">样例预期与业务断言</summary><pre className="whitespace-pre-wrap wrap-anywhere">{json({ expected: examples[index].expected, assertions: examples[index].assertions || [] })}</pre></details>}
      <pre className="m-0 max-w-full whitespace-pre-wrap rounded-md bg-bg-soft p-3 font-mono text-xs wrap-anywhere">{item.output === undefined ? '未返回输出' : json(item.output)}</pre>
      {item.toolSteps?.map((step, position) => <div key={position} className="text-xs text-ink-2 wrap-anywhere">{step.toolName} · {step.simulated ? 'dry-run，仅模拟执行' : '只读工具已执行'}<pre className="whitespace-pre-wrap wrap-anywhere">{json({ arguments: step.arguments, result: step.result })}</pre></div>)}
    </div></details>)}</div>
    <SkillSimulatedSteps steps={result.simulatedSteps} />
  </article>
}
