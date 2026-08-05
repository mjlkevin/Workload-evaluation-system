import React from 'react'
import { parseMarkdownBlocks } from '../../utils/markdownBlocks.js'

function markdownLinkBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost'
}

function normalizeMarkdownHref(href) {
  const trimmed = String(href || '').trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed, markdownLinkBaseUrl())
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return trimmed
    }
  } catch {
    return null
  }
  return null
}

function renderInlineMarkdown(text, keyPrefix) {
  /* Support: **bold**, *italic*, `inline code`, [text](url) */
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenRegex)
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={`${keyPrefix}-em-${index}`}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-code-${index}`} className="ai-inline-code">{part.slice(1, -1)}</code>
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const safeHref = normalizeMarkdownHref(linkMatch[2])
      if (!safeHref) {
        return (
          <span key={`${keyPrefix}-blocked-link-${index}`} className="ai-md-link-blocked" title="不安全链接已禁用">
            {linkMatch[1]}
          </span>
        )
      }
      return <a key={`${keyPrefix}-link-${index}`} href={safeHref} target="_blank" rel="noopener noreferrer" className="ai-md-link">{linkMatch[1]}</a>
    }
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
  })
}

function InteractiveOptionCard({ block, disabled, onSelect }) {
  return (
    <div className="ai-option-group" role="group" aria-label="AI 回复选项">
      {block.items.map((item, index) => (
        <button
          key={`${item.label}-${item.text}-${index}`}
          className="ai-option-card"
          type="button"
          disabled={disabled}
          onClick={() => onSelect?.(item.submitText)}
          title={`${item.label}：${item.text}`}
        >
          <span>{item.label}</span>
          <b>{item.text}</b>
        </button>
      ))}
    </div>
  )
}

export default function RichAiMessage({ text, optionDisabled = false, onOptionSelect }) {
  const blocks = parseMarkdownBlocks(text)
  return (
    <div className="ai-message-rich">
      {blocks.map((block, blockIndex) => {
        if (block.type === 'optionList') {
          return (
            <InteractiveOptionCard
              key={`options-${blockIndex}`}
              block={block}
              disabled={optionDisabled}
              onSelect={onOptionSelect}
            />
          )
        }

        if (block.type === 'orderedList' || block.type === 'unorderedList') {
          const ListTag = block.type === 'orderedList' ? 'ol' : 'ul'
          return (
            <ListTag key={`list-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`item-${blockIndex}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `item-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          )
        }

        if (block.type === 'table') {
          const previousBlock = blocks[blockIndex - 1]
          const tableLabel = previousBlock?.type === 'heading' ? previousBlock.text : 'AI 回复表格'
          return (
            <div key={`table-${blockIndex}`} className="ai-md-table-wrap">
              <table className="ai-md-table" aria-label={tableLabel}>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`table-head-${blockIndex}-${headerIndex}`} scope="col">
                        {renderInlineMarkdown(header, `table-head-${blockIndex}-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`table-row-${blockIndex}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`table-cell-${blockIndex}-${rowIndex}-${cellIndex}`}>
                          {renderInlineMarkdown(cell, `table-cell-${blockIndex}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        if (block.type === 'heading') {
          const HeadingTag = `h${Math.min(block.level, 4)}`
          return (
            <HeadingTag key={`heading-${blockIndex}`} className={`ai-md-h${block.level}`}>
              {renderInlineMarkdown(block.text, `heading-${blockIndex}`)}
            </HeadingTag>
          )
        }

        if (block.type === 'codeBlock') {
          return (
            <pre key={`code-${blockIndex}`} className="ai-code-block">
              <code>{block.text}</code>
            </pre>
          )
        }

        return (
          <p key={`paragraph-${blockIndex}`}>
            {renderInlineMarkdown(block.text, `paragraph-${blockIndex}`)}
          </p>
        )
      })}
    </div>
  )
}
