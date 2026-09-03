/**
 * 批次 0.5 · Part2：AI 应答通道降级的**可见**侧。
 *
 * 一句话职责：备用通道被启用的事实必须出现在界面上，并且用普通人能看懂的话说清
 * 「现在是什么状态、对使用有什么影响、怎么恢复」。
 *
 * 文案硬约束（本批裁决）：
 * - 不得出现「同步路径」「异步 run」「durable」「闭锁」「降级」等内部词——用户不需要
 *   理解我们的通道拆分，只需要知道变慢了、以及刷新的确能解决它。
 * - 闭锁态（`latched`）与单轮态措辞必须分开：单轮失败只影响这一轮，说成整页已坏
 *   是误导；反之闭锁态说成「仅本轮」会让人以为下一轮自然恢复，也是误导。
 * - 不提供「重试」按钮：本批明确不做自动重试/自动恢复，恢复手段只有刷新页面。
 */

/** 闭锁态：本页剩余每一轮都走备用通道，只有刷新能恢复 */
const LATCHED_TEXT =
  'AI 的快速应答通道暂时连不上，这一页接下来的回答会改走备用通道：速度更慢，也看不到处理过程。刷新页面即可恢复。'

/** 单轮态：只有这一轮改走了备用通道，下一轮仍会重新尝试 */
const PER_TURN_TEXT =
  '这一轮的回答改走了备用通道，所以速度更慢、看不到处理过程。刷新页面通常能恢复。'

export default function AiDegradationNotice({ notice }) {
  if (!notice) return null
  return (
    <div
      role="status"
      aria-label="备用通道提示"
      className="mx-5 my-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-xs leading-relaxed text-ink-2"
    >
      {notice.latched ? LATCHED_TEXT : PER_TURN_TEXT}
    </div>
  )
}
