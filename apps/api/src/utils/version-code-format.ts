/**
 * 版本号编码格式占位符（与系统管理「版本号编码规则」一致）。
 * 长 token 先于短 token 替换，避免 `{N}` 误伤 `{NN}` / `{NNN}`。
 */
export type VersionCodeFormatInput = {
  prefix: string
  moduleCode: string
  /** 总方案编码片段，子模块规则里用于 {GL} */
  globalCode: string
  seq: number
  now: Date
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0")
}

export function applyVersionCodeFormat(format: string, input: VersionCodeFormatInput): string {
  const yyyy = String(input.now.getFullYear())
  const yy = yyyy.slice(-2)
  const mm = padNumber(input.now.getMonth() + 1, 2)
  const dd = padNumber(input.now.getDate(), 2)
  const pairs: Array<[string, string]> = [
    ["{PREFIX}", input.prefix],
    ["{MODULE}", input.moduleCode],
    ["{YYYYMMDD}", `${yyyy}${mm}${dd}`],
    ["{YYMMDD}", `${yy}${mm}${dd}`],
    ["{YYYYMM}", `${yyyy}${mm}`],
    ["{YYYY}", yyyy],
    ["{MM}", mm],
    ["{GL}", input.globalCode],
    ["{NNN}", padNumber(input.seq, 3)],
    ["{NN}", padNumber(input.seq, 2)],
    ["{N}", String(input.seq)],
  ]
  pairs.sort((a, b) => b[0].length - a[0].length)
  return pairs.reduce((result, [token, value]) => result.split(token).join(value), format)
}

/** 规则里是否包含序号类占位（用于生成唯一候选） */
export function formatHasSequenceToken(format: string): boolean {
  return (
    format.includes("{NNN}") || format.includes("{NN}") || /\{N\}/.test(format)
  )
}
