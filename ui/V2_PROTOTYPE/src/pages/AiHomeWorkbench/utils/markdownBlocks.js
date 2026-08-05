export function parseGuidedOptionLine(line) {
  const namedMatch = line.match(/^选项\s*([A-Za-z0-9一二三四五六七八九十]+)\s*[：:]\s*(.+)$/)
  if (namedMatch) {
    const label = `选项${namedMatch[1].toUpperCase()}`
    const text = namedMatch[2].trim()
    return {
      label,
      text,
      submitText: `启动${label}：${text}`,
    }
  }

  const numberedMatch = line.match(/^(\d+)[.、]\s+(.+)$/)
  if (numberedMatch) {
    const text = numberedMatch[2].trim()
    return {
      label: `问题${numberedMatch[1]}`,
      text,
      submitText: text,
    }
  }

  return null
}

function shouldPromoteOrderedListToOptions(previousBlock, items) {
  if (!previousBlock || previousBlock.type !== 'paragraph') return false
  if (items.length < 2 || items.length > 6) return false
  return /(选项|请选择|选择|回复|启动|以下问题|关键问题|待确认问题|补充问题|下一步|回复.*数字|输入.*编号|对应.*编号|建议.*操作|推荐.*方案|您可以)/.test(previousBlock.text)
}

function normalizeInteractiveOptionBlocks(blocks) {
  return blocks.map((block, index) => {
    if (block.type !== 'orderedList' || !shouldPromoteOrderedListToOptions(blocks[index - 1], block.items)) {
      return block
    }
    return {
      type: 'optionList',
      items: block.items.map((item, itemIndex) => ({
        label: `问题${itemIndex + 1}`,
        text: item,
        submitText: item,
      })),
    }
  })
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.includes('|')) return null
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
  return cells.length > 1 ? cells : null
}

function isMarkdownTableSeparator(line, expectedCells) {
  const cells = splitMarkdownTableRow(line)
  if (!cells || cells.length !== expectedCells) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
}

export function parseMarkdownBlocks(text) {
  const blocks = []
  const paragraphLines = []
  let currentList = null
  let currentOptions = null
  let codeFence = null // { lang, lines }

  function flushParagraph() {
    const paragraph = paragraphLines.join(' ').trim()
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph })
    paragraphLines.length = 0
  }

  function flushList() {
    if (currentList?.items.length) blocks.push(currentList)
    currentList = null
  }

  function flushCode() {
    if (codeFence) {
      blocks.push({ type: 'codeBlock', lang: codeFence.lang, text: codeFence.lines.join('\n') })
      codeFence = null
    }
  }

  function flushOptions() {
    if (currentOptions?.items.length) blocks.push(currentOptions)
    currentOptions = null
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    /* Fenced code block toggle */
    const fenceMatch = rawLine.match(/^```(\w*)/)
    if (fenceMatch) {
      if (codeFence) {
        flushCode()
      } else {
        flushParagraph()
        flushList()
        flushOptions()
        codeFence = { lang: fenceMatch[1] || '', lines: [] }
      }
      continue
    }
    if (codeFence) {
      codeFence.lines.push(rawLine)
      continue
    }

    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      flushOptions()
      continue
    }

    const tableHeaders = splitMarkdownTableRow(line)
    const nextLine = lines[index + 1]?.trim() || ''
    if (tableHeaders && isMarkdownTableSeparator(nextLine, tableHeaders.length)) {
      flushParagraph()
      flushList()
      flushOptions()

      const rows = []
      index += 2
      for (; index < lines.length; index += 1) {
        const rowCells = splitMarkdownTableRow(lines[index].trim())
        if (!rowCells || isMarkdownTableSeparator(lines[index], tableHeaders.length)) {
          index -= 1
          break
        }
        rows.push(tableHeaders.map((_, cellIndex) => rowCells[cellIndex] || ''))
      }

      blocks.push({ type: 'table', headers: tableHeaders, rows })
      continue
    }

    const guidedOption = parseGuidedOptionLine(line)
    if (guidedOption && /^选项\s*/.test(line)) {
      flushParagraph()
      flushList()
      if (!currentOptions) currentOptions = { type: 'optionList', items: [] }
      currentOptions.items.push(guidedOption)
      continue
    }

    /* Headings: # ... ###### */
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      flushOptions()
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] })
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    const listType = orderedMatch ? 'orderedList' : unorderedMatch ? 'unorderedList' : null

    if (listType) {
      flushParagraph()
      flushOptions()
      if (!currentList || currentList.type !== listType) {
        flushList()
        currentList = { type: listType, items: [] }
      }
      currentList.items.push(orderedMatch?.[1] || unorderedMatch?.[1])
      continue
    }

    flushList()
    flushOptions()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushList()
  flushOptions()
  flushCode()
  return normalizeInteractiveOptionBlocks(blocks.length ? blocks : [{ type: 'paragraph', text }])
}
