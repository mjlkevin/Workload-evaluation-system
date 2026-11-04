import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import Composer from '../pages/AiHomeWorkbench/components/ChatArea/Composer.jsx'
import { listExecutionCatalog } from '../api/businessExecutions.js'
vi.mock('../api/businessExecutions.js', () => ({ listExecutionCatalog: vi.fn() }))
const tasks = [{ kind: 'skill', id: 's1', name: '需求拆解', description: '拆分业务诉求' }, { kind: 'workflow', id: 'w1', name: '需求到评估', description: '完整评估流程' }]
let send, choose
beforeEach(() => { listExecutionCatalog.mockResolvedValue(tasks); send = vi.fn(); choose = vi.fn() })
function Host() {
 const [composer, setComposer] = useState(''), [selectedTask, setTask] = useState(null)
 return <Composer composer={composer} setComposer={setComposer} selectedTask={selectedTask} onSelectTask={task => { choose(task); setTask(task) }} onRemoveTask={() => setTask(null)} onSend={send} fileInputRef={{ current: null }} />
}
it('独立 / 在输入区唤起授权清单；过滤并选成标签，正文保留且不启动', async () => {
 render(<Host />)
 const box = screen.getByRole('textbox', { name: 'AI 工作台输入' })
 fireEvent.change(box, { target: { value: '请处理 /拆解', selectionStart: 7 } })
 fireEvent.click(await screen.findByRole('option', { name: /需求拆解/ }))
 expect(choose).toHaveBeenCalledWith(tasks[0]); expect(send).not.toHaveBeenCalled()
 expect(box).toHaveValue('请处理 ')
 expect(screen.getByRole('button', { name: '移除 Skill 需求拆解' })).toBeInTheDocument()
 expect(box).toHaveFocus()
 fireEvent.click(screen.getByRole('button', { name: '移除 Skill 需求拆解' }))
 expect(box).toHaveValue('请处理 ')
 expect(screen.queryByRole('button', { name: '选择业务任务' })).not.toBeInTheDocument()
})
it('方向键与回车只选择；Escape关闭，之后普通Enter发送；输入法Enter不选不发', async () => {
 render(<Host />); const box = screen.getByRole('textbox')
 fireEvent.change(box, { target: { value: '/' } }); await screen.findByRole('option', { name: /需求拆解/ })
 fireEvent.keyDown(box, { key: 'Enter', isComposing: true }); expect(choose).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
 fireEvent.keyDown(box, { key: 'ArrowDown' }); fireEvent.keyDown(box, { key: 'Enter' })
 expect(choose).toHaveBeenCalledWith(tasks[1]); expect(send).not.toHaveBeenCalled()
 fireEvent.change(box, { target: { value: '/' } }); await screen.findByRole('listbox')
 fireEvent.keyDown(box, { key: 'Escape' }); expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
 fireEvent.change(box, { target: { value: '继续' } }); fireEvent.keyDown(box, { key: 'Enter' }); expect(send).toHaveBeenCalledTimes(1)
})
it('URL斜杠不唤起；空结果或加载中Enter不把命令当消息发出', async () => {
 render(<Host />); const box=screen.getByRole('textbox')
 fireEvent.change(box, { target: { value: 'https://example.com/path' } }); expect(listExecutionCatalog).not.toHaveBeenCalled()
 fireEvent.change(box, { target: { value: '/没有匹配' } }); await screen.findByText('没有匹配的 Skill 或流程')
 fireEvent.keyDown(box, { key: 'Enter' }); expect(send).not.toHaveBeenCalled()
})
it('目录失败可重试；选择后删除标签不会删除附件或正文', async () => {
 listExecutionCatalog.mockRejectedValueOnce(new Error('offline'))
 render(<Host />); const box=screen.getByRole('textbox')
 fireEvent.change(box, { target: { value: '/' } }); await screen.findByRole('alert')
 fireEvent.click(screen.getByRole('button', { name: '重试加载技能' })); await screen.findByRole('option', { name: /需求拆解/ })
 fireEvent.keyDown(box,{key:'Escape'}); expect(box).toHaveValue('/')
})
it('候选搜索支持光标处命令，选择保留其后的正文；迟到目录不重开已关闭清单', async () => {
 let release; listExecutionCatalog.mockImplementation(() => new Promise(resolve=>{ release=resolve }))
 render(<Host />); const box=screen.getByRole('textbox')
 fireEvent.change(box,{target:{value:'/拆解 后面的正文',selectionStart:3}})
 await waitFor(()=>expect(release).toBeTypeOf('function'))
 await act(async()=>release(tasks))
 fireEvent.click(await screen.findByRole('option',{name:/需求拆解/}))
 expect(box).toHaveValue(' 后面的正文')
})
