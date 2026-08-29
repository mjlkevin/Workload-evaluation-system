import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import Shell from '../components/Layout/Shell.jsx'

const indexCss = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')
const layoutCss = readFileSync(join(process.cwd(), 'layout.css'), 'utf-8')

// 折叠按钮平时是透明的（layout.css:18 opacity:0，只有 .sidebar:hover 才显形）。
// 键盘 Tab 能落到它身上，但焦点环画在一个 opacity:0 的方块上——用户按下 Tab
// 之后看到的是「什么都没高亮」，再按一次回车侧栏突然动了，却不知道为什么。
// layout.css 全冻结，所以这条按仓库既有做法落在 index.css：
// 同类的 .ai-home-inspector__toggle:focus-visible（index.css:626）、
// .wes-dialog__close:focus-visible（components.css:92）都在各自的样式文件里补的。
const focusRule = indexCss.match(/\.sidebar \.toggle-btn:focus-visible\s*\{([^}]*)\}/)?.[1] ?? ''

describe('侧栏折叠按钮的焦点可见性', () => {
  test('index.css 里有针对折叠按钮的 :focus-visible 规则', () => {
    expect(focusRule).not.toBe('')
  })

  test('被键盘聚焦时按钮从透明变为可见', () => {
    expect(focusRule).toMatch(/opacity:\s*1/)
  })

  test('焦点指示复用既有 --shadow-focus token，不引入新色值', () => {
    expect(focusRule).toMatch(/box-shadow:\s*var\(--shadow-focus\)/)
    // 新写一条焦点环不该顺手造颜色
    expect(focusRule).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(|rgba?\(/i)
  })

  // 冻结令只被架构侧点名解冻过 components.css 的 .btn:disabled 一处，
  // layout.css 仍然全冻结：这条修复不得跑到冻结文件里去改 hover 规则。
  test('冻结的 layout.css 未被顺手改动', () => {
    expect(layoutCss).toMatch(/\.sidebar:hover \.toggle-btn\{opacity:1\}/)
    expect(layoutCss).not.toMatch(/\.toggle-btn:focus/)
  })

  test('折叠按钮有可读的无障碍名，Tab 落得上去', () => {
    render(
      <MemoryRouter>
        <Shell>
          <div>content</div>
        </Shell>
      </MemoryRouter>,
    )

    const toggle = screen.getByRole('button', { name: '收起' })
    // fireEvent.focus 只派发事件、不真的移动 DOM 焦点，这里要的是「Tab 落得上去」
    toggle.focus()
    expect(toggle).toHaveFocus()
  })
})
