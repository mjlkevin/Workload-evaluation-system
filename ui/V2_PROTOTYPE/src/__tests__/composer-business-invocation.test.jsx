import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import useComposerBusinessTask from '../pages/AiHomeWorkbench/hooks/useComposerBusinessTask.js'
import * as api from '../api/businessExecutions.js'
vi.mock('../api/businessExecutions.js')
const task={kind:'skill',id:'skill-a',name:'拆解',versionId:'v1',inputSchema:{type:'object',properties:{text:{type:'string',minLength:1}},required:['text']}}
let wb, onStarted
beforeEach(()=>{
 vi.clearAllMocks(); api.listExecutionCatalog.mockResolvedValue([task]);api.startBusinessExecution.mockResolvedValue({runId:'new-run'});api.listExecutionTemplates.mockResolvedValue([])
 wb={activeSession:{sessionId:'a'},composer:'原始提示词',selectedFile:null,setComposer:vi.fn(),setSelectedFile:vi.fn(),clearComposerDraft:vi.fn(),createSession:vi.fn()};onStarted=vi.fn()
})
function mount(){return renderHook(()=>useComposerBusinessTask({workbench:wb,onStarted,userId:'u1'}))}
it('选标签不执行；发送实际提示词与Skill输入，成功后清空且通知',async()=>{
 const h=mount();act(()=>h.result.current.selectTask(task));expect(api.startBusinessExecution).not.toHaveBeenCalled()
 await act(()=>h.result.current.send())
 expect(api.startBusinessExecution).toHaveBeenCalledWith('a',expect.objectContaining({content:'原始提示词',execution:{kind:'skill',skillId:'skill-a',input:{text:'原始提示词'}}}))
 expect(onStarted).toHaveBeenCalled();expect(wb.setComposer).toHaveBeenCalledWith('');expect(h.result.current.selectedTask).toBeNull()
})
it('附件走受控原文上传，发送把文件引用和提示词同时交给业务执行',async()=>{
 wb.selectedFile=new File(['原文'],'需求.xlsx');api.uploadExecutionSource.mockResolvedValue({attachmentId:'file-1',sourceAvailable:true})
 const h=mount();act(()=>h.result.current.selectTask(task));await act(()=>h.result.current.send())
 expect(api.uploadExecutionSource).toHaveBeenCalledWith('a',wb.selectedFile)
 expect(api.startBusinessExecution.mock.calls[0][1].execution.sources).toEqual([{kind:'file',id:'file-1'}])
})
it('失败保留草稿标签与附件；重复发送复用submissionKey及已上传原文',async()=>{
 wb.selectedFile=new File(['原文'],'需求.txt');api.uploadExecutionSource.mockResolvedValue({attachmentId:'file-1',sourceAvailable:true});api.startBusinessExecution.mockRejectedValueOnce(new Error('network'))
 const h=mount();act(()=>h.result.current.selectTask(task));await act(()=>h.result.current.send())
 expect(wb.setComposer).not.toHaveBeenCalled();expect(h.result.current.selectedTask).toEqual(task)
 await act(()=>h.result.current.send())
 expect(api.startBusinessExecution.mock.calls[0][1].submissionKey).toBe(api.startBusinessExecution.mock.calls[1][1].submissionKey);expect(api.uploadExecutionSource).toHaveBeenCalledTimes(1)
})
it('缺少必填参数先补齐，取消不清空；Workflow也携带实际提示词',async()=>{
 const workflow={...task,kind:'workflow',id:'w1',inputSchema:{type:'object',properties:{description:{type:'string'},projectName:{type:'string'}},required:['projectName','description']}}
 api.listExecutionCatalog.mockResolvedValue([workflow]);const h=mount();act(()=>h.result.current.selectTask(workflow));await act(()=>h.result.current.send())
 expect(api.startBusinessExecution).not.toHaveBeenCalled();expect(h.result.current.parameters.input).toEqual({description:'原始提示词'})
 act(()=>h.result.current.cancelParameters());expect(wb.setComposer).not.toHaveBeenCalled()
 await act(()=>h.result.current.send());act(()=>h.result.current.changeInput({description:'原始提示词',projectName:'验收'}));await act(()=>h.result.current.submitParameters())
 expect(api.startBusinessExecution.mock.calls[0][1]).toMatchObject({content:'原始提示词',execution:{kind:'workflow',workflowId:'w1',input:{projectName:'验收'}}})
})
it('切会话使迟到上传失效，不启动、不清新草稿；相同会话A→B→A也失效',async()=>{
 let release;wb.selectedFile=new File(['a'],'需求.txt');api.uploadExecutionSource.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
 const h=mount();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(release).toBeTypeOf('function'))
 wb={...wb,activeSession:{sessionId:'b'},composer:'新草稿'};h.rerender();wb={...wb,activeSession:{sessionId:'a'},composer:'新的A草稿'};h.rerender()
 await act(async()=>{release({attachmentId:'old',sourceAvailable:true});await sending})
 expect(api.startBusinessExecution).not.toHaveBeenCalled();expect(wb.setComposer).not.toHaveBeenCalled();expect(h.result.current.selectedTask).toBeNull()
})
it('双击发送只提交一次；目录版本变化明确拒绝而不退回普通聊天',async()=>{
 const h=mount();act(()=>h.result.current.selectTask(task));api.listExecutionCatalog.mockResolvedValue([{...task,versionId:'v2'}])
 await act(async()=>{await Promise.all([h.result.current.send(),h.result.current.send()])})
 expect(api.startBusinessExecution).not.toHaveBeenCalled();expect(h.result.current.error).toMatch(/目录已变化/)
})

it('空会话创建返回父状态之前保留提交；上传失败与不支持材料不启动',async()=>{
 wb.activeSession=null;wb.createSession.mockResolvedValue({sessionId:'created'});wb.selectedFile=new File(['x'],'需求.txt')
 api.uploadExecutionSource.mockRejectedValueOnce(new Error('upload failed'))
 const h=mount();act(()=>h.result.current.selectTask(task));await act(()=>h.result.current.send())
 expect(api.startBusinessExecution).not.toHaveBeenCalled();expect(wb.setComposer).not.toHaveBeenCalled()
 wb.selectedFile=new File(['x'],'不支持.pdf');h.rerender();await act(()=>h.result.current.send());expect(h.result.current.error).toMatch(/2 MiB/)
})
it('提交响应迟到时不擦除同会话的新正文',async()=>{
 let release;api.startBusinessExecution.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
 const h=mount();act(()=>h.result.current.selectTask(task));let sending;act(()=>{sending=h.result.current.send()});await waitFor(()=>expect(release).toBeTypeOf('function'))
 wb={...wb,composer:'新的未发送正文'};h.rerender();await act(async()=>{release({runId:'r'});await sending})
 expect(wb.setComposer).not.toHaveBeenCalled();expect(onStarted).toHaveBeenCalledTimes(1)
})
