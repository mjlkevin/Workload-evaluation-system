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
 const h=mount();act(()=>h.result.current.selectTask(task));await act(()=>h.result.current.send());expect(wb.setComposer).not.toHaveBeenCalled()
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
 wb={...wb,composer:'新正文'};h.rerender();await act(async()=>{release({action:'reply',message:'答复'});await sending});expect(wb.setComposer).not.toHaveBeenCalled()
 wb={...wb,selectedFile:new File(['x'],'不支持.pdf')};h.rerender();await act(()=>h.result.current.send());expect(h.result.current.error).toMatch(/2 MiB/)
})
it('刷新后从最后追问恢复能力标签；移除后不被轮询重新加回',async()=>{
 wb.activeSession.messages=[{role:'assistant',metadata:{skillConversation:{action:'clarify',selection:{...task}}}}]
 const h=mount();await waitFor(()=>expect(h.result.current.selectedTask).toMatchObject({id:'skill-a'}));act(()=>h.result.current.removeTask());h.rerender();expect(h.result.current.selectedTask).toBeNull()
})
