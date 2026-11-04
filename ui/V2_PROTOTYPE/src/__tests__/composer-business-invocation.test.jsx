import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import useComposerBusinessTask from '../pages/AiHomeWorkbench/hooks/useComposerBusinessTask.js'
import * as api from '../api/businessExecutions.js'
vi.mock('../api/businessExecutions.js')
const task = { kind:'skill', id:'skill-a', name:'拆解', versionId:'v1', inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']} }
let wb, onStarted
beforeEach(() => {
 vi.clearAllMocks(); api.listExecutionCatalog.mockResolvedValue([task]); api.sendSkillConversation.mockResolvedValue({ action:'execute',run:{runId:'new-run'} })
 wb={activeSession:{sessionId:'a',messages:[]},composer:'原始提示词',selectedFile:null,setComposer:vi.fn(),setSelectedFile:vi.fn(),clearComposerDraft:vi.fn(),createSession:vi.fn(),loadSessions:vi.fn().mockResolvedValue([])};onStarted=vi.fn()
})
function mount(){return renderHook(()=>useComposerBusinessTask({workbench:wb,onStarted,userId:'u1'}))}
it('选择只带能力上下文，发送后由服务端判断，前端不构造业务输入或强行执行',async()=>{
 const h=mount();act(()=>h.result.current.selectTask(task));expect(api.sendSkillConversation).not.toHaveBeenCalled()
 await act(()=>h.result.current.send())
 expect(api.sendSkillConversation).toHaveBeenCalledWith('a',expect.objectContaining({content:'原始提示词',selection:{kind:'skill',id:'skill-a',versionId:'v1'}}))
 expect(api.startBusinessExecution).not.toHaveBeenCalled(); expect(onStarted).toHaveBeenCalledWith({runId:'new-run'}); expect(h.result.current.selectedTask).toBeNull()
})
it('问用途自然回答，保留标签，刷新会话消息，不通知任务开始',async()=>{
 wb.composer='这个skill能做什么？';api.sendSkillConversation.mockResolvedValue({action:'reply',message:'拆解原始需求'})
 const h=mount();act(()=>h.result.current.selectTask(task));await act(()=>h.result.current.send())
 expect(h.result.current.selectedTask).toEqual(task);expect(wb.loadSessions).toHaveBeenCalled();expect(onStarted).not.toHaveBeenCalled();expect(wb.setComposer).toHaveBeenCalledWith('')
})
it('缺失输入由中央消息追问，继续补充走相同能力，不弹参数表',async()=>{
 const workflow={...task,kind:'workflow',id:'w1'};api.listExecutionCatalog.mockResolvedValue([workflow]);api.sendSkillConversation.mockResolvedValueOnce({action:'clarify',message:'客户名称是什么？'})
 const h=mount();act(()=>h.result.current.selectTask(workflow));await act(()=>h.result.current.send())
 expect(h.result.current.parameters).toBeUndefined();expect(h.result.current.selectedTask).toEqual(workflow)
 wb={...wb,composer:'客户甲'};h.rerender();await act(()=>h.result.current.send())
 expect(api.sendSkillConversation.mock.calls[1][1]).toMatchObject({content:'客户甲',selection:{kind:'workflow',id:'w1'}});expect(onStarted).toHaveBeenCalledTimes(1)
})
it('附件受控上传交给对话，失败重试复用上传与提交键',async()=>{
 wb.selectedFile=new File(['原文'],'需求.txt');api.uploadExecutionSource.mockResolvedValue({attachmentId:'file-1',sourceAvailable:true});api.sendSkillConversation.mockRejectedValueOnce(new Error('network'))
 const h=mount();act(()=>h.result.current.selectTask(task));await act(()=>h.result.current.send());expect(wb.setComposer).toHaveBeenCalledWith('');expect(wb.setComposer.mock.calls.at(-1)[0]('')).toBe('原始提示词')
 await act(()=>h.result.current.send())
 expect(api.sendSkillConversation.mock.calls[0][1].sources).toEqual([{kind:'file',id:'file-1'}]);expect(api.sendSkillConversation.mock.calls[0][1].submissionKey).toBe(api.sendSkillConversation.mock.calls[1][1].submissionKey);expect(api.uploadExecutionSource).toHaveBeenCalledTimes(1)
})
it('切会话A→B→A让迟到上传失效',async()=>{
 let release;wb.selectedFile=new File(['a'],'需求.txt');api.uploadExecutionSource.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
 const h=mount();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(release).toBeTypeOf('function'))
 wb={...wb,activeSession:{sessionId:'b'},composer:'新草稿'};h.rerender();wb={...wb,activeSession:{sessionId:'a'},composer:'新的A草稿'};h.rerender()
 await act(async()=>{release({attachmentId:'old',sourceAvailable:true});await sending})
 expect(api.sendSkillConversation).not.toHaveBeenCalled();expect(wb.setComposer).not.toHaveBeenCalled();expect(h.result.current.selectedTask).toBeNull()
})
it('双击只发送一次，目录版本变化明确拒绝',async()=>{
 const h=mount();act(()=>h.result.current.selectTask(task));api.listExecutionCatalog.mockResolvedValue([{...task,versionId:'v2'}]);await act(async()=>{await Promise.all([h.result.current.send(),h.result.current.send()])})
 expect(api.sendSkillConversation).not.toHaveBeenCalled();expect(h.result.current.error).toMatch(/目录已变化/)
})
it('响应迟到不擦除同会话新正文；不支持材料不发送',async()=>{
 let release;api.sendSkillConversation.mockImplementation(()=>new Promise(resolve=>{release=resolve}));const h=mount();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(release).toBeTypeOf('function'))
 wb={...wb,composer:'新正文'};h.rerender();await act(async()=>{release({action:'reply',message:'答复'});await sending});expect(wb.setComposer).toHaveBeenCalledTimes(1);expect(wb.setComposer).toHaveBeenCalledWith('')
 wb={...wb,selectedFile:new File(['x'],'不支持.pdf')};h.rerender();await act(()=>h.result.current.send());expect(h.result.current.error).toMatch(/2 MiB/)
})
it('刷新后从最后追问恢复能力标签；移除后不被轮询重新加回',async()=>{
 wb.activeSession.messages=[{role:'assistant',metadata:{skillConversation:{action:'clarify',selection:{...task}}}}]
 const h=mount();await waitFor(()=>expect(h.result.current.selectedTask).toMatchObject({id:'skill-a'}));act(()=>h.result.current.removeTask());h.rerender();expect(h.result.current.selectedTask).toBeNull()
})

function mountControlled() {
 return renderHook(() => {
  const [composer,setComposer]=useState(wb.composer)
  const invocation=useComposerBusinessTask({workbench:{...wb,composer,setComposer},onStarted,userId:'u1'})
  return {...invocation,composer,setComposer}
 })
}
it('消息进入流时立即清空编辑框，不等待模型返回，消息保留完整原文',async()=>{
 let resolve;api.sendSkillConversation.mockImplementation(()=>new Promise(done=>{resolve=done}))
 const h=mountControlled();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()})
 await waitFor(()=>expect(resolve).toBeTypeOf('function'))
 expect(h.result.current.busy).toBe(true);expect(h.result.current.composer).toBe('');expect(h.result.current.pendingMessages[0].text).toBe('原始提示词')
 await act(async()=>{resolve({action:'reply',message:'回答'});await sending})
 expect(h.result.current.composer).toBe('')
})
it('发送失败恢复刚清空的原文，保留能力标签与重试信息',async()=>{
 let reject;api.sendSkillConversation.mockImplementation(()=>new Promise((_,fail)=>{reject=fail}))
 const h=mountControlled();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(reject).toBeTypeOf('function'))
 expect(h.result.current.composer).toBe('');await act(async()=>{reject(new Error('network'));await sending})
 expect(h.result.current.composer).toBe('原始提示词');expect(h.result.current.selectedTask.id).toBe('skill-a');expect(h.result.current.error).toBeTruthy()
})
it.each(['success','failure'])('迟到%s不清除或覆盖用户新写的草稿',async outcome=>{
 let resolve,reject;api.sendSkillConversation.mockImplementation(()=>new Promise((done,fail)=>{resolve=done;reject=fail}))
 const h=mountControlled();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(resolve).toBeTypeOf('function'))
 act(()=>h.result.current.setComposer('下一条草稿'))
 await act(async()=>{if(outcome==='success')resolve({action:'reply',message:'回答'});else reject(new Error('network'));await sending})
 expect(h.result.current.composer).toBe('下一条草稿')
})

function mountControlledAttachment() {
 return renderHook(() => {
  const [composer,setComposer]=useState(wb.composer)
  const [selectedFile,setSelectedFile]=useState(wb.selectedFile)
  const invocation=useComposerBusinessTask({workbench:{...wb,composer,setComposer,selectedFile,setSelectedFile},onStarted,userId:'u1'})
  return {...invocation,composer,setComposer,selectedFile,setSelectedFile}
 })
}
function prepareAttachment() {
 wb.selectedFile=new File(['原始需求材料'],'需求.md',{type:'text/markdown'})
 api.uploadExecutionSource.mockResolvedValue({attachmentId:'file-1',sourceAvailable:true})
 return wb.selectedFile
}
it('附件随用户消息入流立即离开编辑区，等待模型期间气泡保留文件信息',async()=>{
 const file=prepareAttachment();let resolve
 api.sendSkillConversation.mockImplementation(()=>new Promise(done=>{resolve=done}))
 const h=mountControlledAttachment();act(()=>h.result.current.selectTask(task));let sending
 act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(resolve).toBeTypeOf('function'))
 expect(h.result.current.selectedFile).toBeNull()
 expect(h.result.current.pendingMessages[0].file).toEqual({name:file.name,size:file.size,type:file.type})
 await act(async()=>{resolve({action:'execute',run:{runId:'new-run'}});await sending})
 expect(h.result.current.selectedFile).toBeNull()
})
it('发送失败恢复同一File，重试复用已上传材料与提交键',async()=>{
 const file=prepareAttachment();let reject
 api.sendSkillConversation.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail}))
 const h=mountControlledAttachment();act(()=>h.result.current.selectTask(task));let sending
 act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(reject).toBeTypeOf('function'))
 expect(h.result.current.selectedFile).toBeNull()
 await act(async()=>{reject(new Error('network'));await sending})
 expect(h.result.current.selectedFile).toBe(file);expect(h.result.current.composer).toBe('原始提示词')
 const key=api.sendSkillConversation.mock.calls[0][1].submissionKey
 await act(()=>h.result.current.send())
 expect(api.uploadExecutionSource).toHaveBeenCalledTimes(1)
 expect(api.sendSkillConversation.mock.calls[1][1]).toMatchObject({submissionKey:key,sources:[{kind:'file',id:'file-1'}]})
})
it.each(['success','failure'])('迟到%s不清除或覆盖新选择的附件',async outcome=>{
 prepareAttachment();let resolve,reject
 api.sendSkillConversation.mockImplementation(()=>new Promise((done,fail)=>{resolve=done;reject=fail}))
 const h=mountControlledAttachment();act(()=>h.result.current.selectTask(task));let sending
 act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(resolve).toBeTypeOf('function'))
 const next=new File(['下一份'],'新材料.md');act(()=>h.result.current.setSelectedFile(next))
 await act(async()=>{if(outcome==='success')resolve({action:'reply',message:'回答'});else reject(new Error('network'));await sending})
 expect(h.result.current.selectedFile).toBe(next)
})
it('请求发出后A→B→A的迟到失败不恢复旧附件或旧正文',async()=>{
 prepareAttachment();let reject
 api.sendSkillConversation.mockImplementation(()=>new Promise((_,fail)=>{reject=fail}))
 const h=mountControlledAttachment();act(()=>h.result.current.selectTask(task));let sending
 act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(reject).toBeTypeOf('function'))
 wb={...wb,activeSession:{sessionId:'b'}};h.rerender()
 wb={...wb,activeSession:{sessionId:'a'}};h.rerender()
 await act(async()=>{reject(new Error('old request'));await sending})
 expect(h.result.current.selectedFile).toBeNull();expect(h.result.current.composer).toBe('')
 expect(h.result.current.error).toBe('');expect(h.result.current.busy).toBe(false)
})
