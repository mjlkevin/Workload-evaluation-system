import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import HomePage from '../pages/HomePage.jsx'
import { ToastProvider } from '../hooks/useToast.jsx'
import { server } from './mocks/server.js'
it('真实工作台路由通过 / 选择标签，发送时携带提示词；选择本身不执行', async () => {
  let starts = 0, payload
  server.use(
    http.get('/api/v1/ai-executions/runs', () => HttpResponse.json({ data: { items: [] } })),
    http.get('/api/v1/ai-executions/catalog', () => HttpResponse.json({ data: { items: [{ kind: 'skill', id: 'skill-a', versionId: 'v1', name: '整理需求', inputSchema: { type: 'object', properties: {text:{type:'string'}}, required:['text'] } }] } })),
    http.post('/api/v1/ai-executions/conversation', async ({ request }) => { starts++; payload=await request.json(); return HttpResponse.json({ data: { action: 'execute', run: { runId: 'run-a' } } }) }),
  )
  render(<ToastProvider><MemoryRouter><HomePage /></MemoryRouter></ToastProvider>)
  const box=await screen.findByRole('textbox',{name:'AI 工作台输入'})
  expect(screen.queryByRole('button',{name:'选择业务任务'})).not.toBeInTheDocument()
  fireEvent.change(box,{target:{value:'/'}})
  fireEvent.click(await screen.findByRole('option',{name:/整理需求/}))
  expect(starts).toBe(0)
  expect(screen.getByRole('button',{name:'移除 Skill 整理需求'}).closest('.ai-composer')).toBeInTheDocument()
  fireEvent.change(box,{target:{value:'请拆解销售需求'}})
  fireEvent.click(screen.getByRole('button',{name:'发送消息'}))
  await screen.findByRole('button',{name:'发送消息',enabled:true})
  await waitFor(()=>expect(starts).toBe(1))
  expect(payload).toMatchObject({content:'请拆解销售需求',selection:{kind:'skill',id:'skill-a',versionId:'v1'}})
})
