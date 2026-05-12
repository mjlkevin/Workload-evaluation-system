import React, { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import PageShell from '../components/Layout/PageShell.jsx'
import useRequirementDetail from '../hooks/useRequirementDetail.js'
import { useSetUnsavedDirty } from '../hooks/useUnsavedChanges.jsx'
import { downloadJSON } from '../utils/download.js'

const KIMI_MENU = [
  { key:'parse', label:'Kimi 解析需求' },
  { key:'preview', label:'Kimi 评估预览' },
  { key:'template', label:'Kimi 套用模板' },
  { key:'ambiguous', label:'Kimi 修复歧义' },
]
const D1_STEPS = ['上传','OCR','NLP','结构化','完成']
const D4_ITEMS = [] // AI 歧义修复条目由后端返回，无数据时为空
const TEMPLATES = [] // 模板列表由后端返回，无数据时为空
const DETAIL_TABS = [
  { key:'items', label:'条目明细' },
  { key:'history', label:'版本历史' },
  { key:'compare', label:'变更对比' },
  { key:'attachments', label:'附件 · 访谈纪要' },
]

function actionData(result) {
  return result && typeof result === 'object' && 'success' in result ? result.data : result
}

function parseSourceText(result) {
  if (!result) return ''
  if (result.mode === 'model') {
    return `本次解析由 ${result.model || 'Kimi 模型'} 提供`
  }
  if (result.mode === 'rule_fallback' || result.model === 'rule-fallback') {
    const reason = result.fallbackReason ? `，原因：${result.fallbackReason}` : ''
    return `本次解析由系统规则兜底生成${reason}`
  }
  return result.model ? `本次解析来源：${result.model}` : ''
}

export default function RequirementDetail() {
  const { id } = useParams()
  const detail = useRequirementDetail({ id })
  const { actions, actionLoading } = detail
  const [aiResult, setAiResult] = useState(null)
  const fileInputRef = useRef(null)

  const [dialog, setDialog] = useState(null)
  const [kimiOpen, setKimiOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('items')
  const [d1Step, setD1Step] = useState(0)
  const [d1Run, setD1Run] = useState(false)
  const [d1File, setD1File] = useState(null)
  const [d1Result, setD1Result] = useState(null)
  const [d1Error, setD1Error] = useState(null)
  const [d4Ans, setD4Ans] = useState({})
  const kimiRef = useRef(null)
  const setUnsavedDirty = useSetUnsavedDirty()
  const isCo = detail.vcs?.status === 'checked-out'
  const tabs = DETAIL_TABS.map((tab) => tab.key === 'history'
    ? { ...tab, count: detail.versionHistory?.length || 0 }
    : tab)

  useEffect(() => { function onDoc(e){ if(kimiRef.current && !kimiRef.current.contains(e.target)) setKimiOpen(false) } document.addEventListener('click',onDoc); return ()=>document.removeEventListener('click',onDoc) },[])
  useEffect(() => {
    setUnsavedDirty(Boolean(detail.vcs?.hasLocalChanges && detail.vcs?.status === 'checked-out'))
    return () => setUnsavedDirty(false)
  }, [detail.vcs?.hasLocalChanges, detail.vcs?.status, setUnsavedDirty])

  const startD1=()=>{ setD1Step(0); setD1Run(false); setD1File(null); setD1Result(null); setD1Error(null); setDialog('parse') }
  const d4Prog=Object.keys(d4Ans).length
  const handleVcs=async (key)=>{
    let result
    switch(key){
      case 'hist': setActiveTab('history'); return
      case 'promote': if (!actions) return; result = await actions.promote(); break
      case 'checkin': if (!actions) return; result = await actions.checkin(); break
      case 'undo': if (!actions) return; result = await actions.undoCheckout(); break
      case 'checkout': if (!actions) return; result = await actions.checkout(); break
      case 'unlock': if (!confirm('强制解锁会覆盖他人改动，确定？')) return; if (!actions) return; result = await actions.forceUnlock(); break
      case 'export': downloadJSON(detail, `requirement-${detail.code || id}.json`); return
      case 'save': if (!actions) return; result = await actions.saveDraft?.(); break
      default: return
    }
    if (result && !result.success) alert(result.error || '操作失败')
  }
  const vcsBtn=[
    {k:'hist',l:'🕘 历史',m:'always'},{k:'promote',l:'⬆ 升版',m:'always'},
    {k:'checkin',l:'🔒 检入',m:'checked-out',pri:true},{k:'undo',l:'↺ 撤销',m:'checked-out'},
    {k:'checkout',l:'🔓 检出',m:'checked-in'},{k:'unlock',l:'⚠ 解锁',m:'checked-out',dan:true},
    {k:'export',l:'↓ 导出',m:'always'},{k:'save',l:'⤒ 保存',m:'always',pri:true},
  ]
  const vcsEn=m=>m==='always'||(m==='checked-out'&&isCo)||(m==='checked-in'&&!isCo)

  return (
    <PageShell crumb="工作台 / 需求 / 需求详情" title="需求详情" subtitle={`${detail.code || ''} · ${detail.version || ''} · 模型 kimi-k2.5`}
      actions={[
        <div key="kimi" ref={kimiRef} style={{position:'relative'}}>
          <button type="button" className="btn" onClick={()=>setKimiOpen(v=>!v)} style={{
            height:32,fontSize:12,padding:'0 12px',background:'linear-gradient(135deg,oklch(.55 .22 295),oklch(.62 .20 320))',
            color:'#fff',border:'none',borderRadius:6,cursor:'pointer',boxShadow:'0 2px 8px oklch(.55 .22 320 / .35)',
            fontFamily:'inherit',fontWeight:600,display:'inline-flex',alignItems:'center',gap:6,
          }}><span>✦</span> Kimi-help <span>▾</span></button>
          {kimiOpen && (
            <div style={{position:'absolute',top:'calc(100% + 6px)',right:0,background:'#fff',border:'1px solid var(--line)',borderRadius:'var(--r-md)',boxShadow:'var(--shadow-2)',minWidth:180,zIndex:20,overflow:'hidden'}}>
              {KIMI_MENU.map(m=>(
                <button type="button" key={m.key} onClick={()=>{setKimiOpen(false);m.key==='parse'?startD1():setDialog(m.key)}}
                  style={{display:'block',width:'100%',textAlign:'left',padding:'8px 12px',fontSize:12,fontFamily:'inherit',background:'transparent',border:'none',borderBottom:'1px solid var(--line)',cursor:'pointer',color:'var(--ink)'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--bg-soft)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{m.label}</button>
              ))}
            </div>
          )}
        </div>,
        ...vcsBtn.map(b=>{
          const en=vcsEn(b.m)
          const actionKey = { undo: 'undoCheckout', unlock: 'forceUnlock', save: 'saveDraft' }[b.k] || b.k
          const loading = actionLoading[actionKey]
          const cls=b.pri?'btn btn-pri':b.dan?'btn btn-dan':'btn btn-ghost'
          return <button type="button" key={b.k} className={cls} disabled={!en || loading} onClick={()=>en&&!loading&&handleVcs(b.k)}
            style={{height:32,fontSize:12,padding:'0 10px',opacity:en&&!loading?1:0.45,cursor:en&&!loading?'pointer':'not-allowed'}}>{loading ? '…' : b.l}</button>
        }),
      ]}>
      <div className="tabs" style={{marginBottom:16}}>
        {tabs.map(t=>(
          <span
            key={t.key}
            role="tab"
            tabIndex={0}
            aria-selected={activeTab === t.key}
            className={`t${activeTab === t.key ? ' on' : ''}`}
            onClick={()=>setActiveTab(t.key)}
            onKeyDown={e=>{ if(e.key === 'Enter' || e.key === ' ') setActiveTab(t.key) }}
          >
            {t.label}
            {typeof t.count === 'number' && <span className="ct">{t.count}</span>}
          </span>
        ))}
      </div>
      <div className="grid-1fr-280" style={{gap:18}}>
        <div style={{display:'flex',flexDirection:'column',gap:14,minWidth:0}}>
          {activeTab === 'items' ? (
          <>
          <Panel rail="CONTEXT" title="版本与上下文" right="只读 · 检出后可编辑">
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,padding:16,background:'linear-gradient(135deg,#fff,var(--bg-soft))'}}>
              <Pm label="总方案版本号" value={detail.globalVersion || '请选择总方案版本'} muted={!detail.globalVersion}/>
              <Pm label="需求版本号" value={<><span style={{fontFamily:'var(--font-mono)'}}>{detail.version || detail.code || '—'}</span></>}/>
              <Pm label="检出状态" value={<Badge type={detail.vcs?.status === 'checked-out' ? 'co' : 'ci'}>{detail.vcs?.status === 'checked-out' ? '已检出' : '已检入'}</Badge>}/>
            </div>
          </Panel>

          <Panel rail="BASIC" title="基本情况" meta={<Badge type="ci">{detail.completionStats?.fields ? `已填 ${detail.completionStats.fields.current}/${detail.completionStats.fields.total}` : '—'}</Badge>} right="▾ 折叠">
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:14,padding:'16px 16px 10px'}}>
              {(detail.basicFields || []).map(f=><Field key={f.label} {...f} editable={isCo} onChange={(value) => actions?.updateBasicField?.(f.label, value)}/>)}
            </div>
            <div style={{padding:'0 16px 16px'}}>
              <LongField label="企业简介" value={detail.companyProfile || ''} editable={isCo} placeholder="暂无数据，检出后可编辑" onChange={(value) => actions?.updateLongField?.('companyProfile', value)} />
              <LongField label="项目背景和需求" value={detail.projectBackground || ''} editable={isCo} placeholder="暂无数据，检出后可编辑" onChange={(value) => actions?.updateLongField?.('projectBackground', value)} />
            </div>
          </Panel>

          <Panel rail="VALUE" title="价值主张" meta={<span style={{color:'var(--ink-3)',fontSize:11,fontFamily:'var(--font-mono)'}}>{detail.completionStats?.valueItems ?? (detail.valueItems || []).length} 项</span>} right="▾ 折叠">
            <div style={{display:'flex',flexDirection:'column',gap:10,padding:16,fontSize:13}}>
              {(detail.valueItems || []).map(item=><ValueLine key={item.label} {...item}/>)}
            </div>
          </Panel>

          <Panel rail="SCOPE" title="业务需求及问题" meta={<><Badge type="ci">{detail.completionStats?.totalCount ?? 0} 条</Badge>{detail.completionStats?.dslViolations ? <Badge type="co">{detail.completionStats.dslViolations} 规则违反</Badge> : null}</>} right="行高 36 · ⊞ 视图">
            <div style={{overflowX:'auto'}}>
              <table className="table" style={{minWidth:640,border:0,borderRadius:0}}>
                <thead><tr><th>分类</th><th>条目</th><th className="num">优先级</th><th>负责人</th><th>状态</th></tr></thead>
                <tbody>
                  {(detail.scopeRows || []).map((r,i)=>r.type==='group'
                    ? <tr key={r.label} className="group"><td colSpan="5">{r.label}</td></tr>
                    : <tr key={`${r.cat}-${i}`} className={r.error?'row-error':''}>
                        <td style={{fontWeight:600,color:r.error?'var(--err)':'var(--ink)'}}>{r.cat}</td>
                        <td style={{color:r.error?'var(--err)':'var(--ink-2)'}}>{r.item}</td>
                        <td className="num" style={{fontWeight:r.priority==='P0'?700:500,color:r.priority==='P0'?'var(--accent)':'var(--ink)'}}>{r.priority}</td>
                        <td>{r.owner}</td>
                        <td><Badge type={r.badge}>{r.status}</Badge></td>
                      </tr>)}
                  <tr className="total"><td colSpan="5" style={{textAlign:'left'}}>合计 · {detail.completionStats?.totalCount ?? 0} 条 / 已确认 {detail.completionStats?.structuredCount ?? 0}</td></tr>
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel rail="EXTRA" title="补充信息与会议纪要" meta={<span style={{color:'var(--ink-3)',fontSize:11,fontFamily:'var(--font-mono)'}}>{(detail.extraCards || []).length} 项</span>} dashed>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10,padding:16,fontSize:12}}>
              {(detail.extraCards || []).map(c=><ExtraCard key={c.title} {...c}/>)}
            </div>
            {(!detail.extraCards || detail.extraCards.length === 0) && (
              <div style={{padding:'0 16px 16px',textAlign:'center',color:'var(--ink-3)',fontSize:12}}>暂无补充信息，检出后可添加</div>
            )}
          </Panel>
          </>
          ) : activeTab === 'history' ? (
            <VersionHistoryPanel
              rows={detail.versionHistory || []}
              currentId={detail.id}
              onInspect={(row) => setAiResult({ type: 'versionSnapshot', data: row.snapshot })}
              onExport={(row) => downloadJSON(row.snapshot, `requirement-version-${row.version || row.id}.json`)}
            />
          ) : (
            <TabPlaceholder
              title={activeTab === 'compare' ? '变更对比' : '附件 · 访谈纪要'}
              desc={activeTab === 'compare'
                ? '选择两个历史版本后，可在这里展示字段级差异。当前先完成版本历史只读链路。'
                : '访谈纪要和附件列表待接入文件服务，当前可先通过 Kimi 解析上传需求文档。'}
            />
          )}
        </div>

        <aside style={{display:'flex',flexDirection:'column',gap:14,alignContent:'start',minWidth:0}}>
          <SidePanel title="完整度">
            <div style={{display:'flex',alignItems:'center',gap:14,padding:'14px 0',borderBottom:'1px dashed var(--line)'}}>
              <Donut percent={detail.completionStats?.percent ?? 0}/>
              <div style={{fontSize:11.5,color:'var(--ink-2)'}}><b style={{display:'block',fontSize:18,color:'var(--ink)',fontWeight:800}}>{detail.completionStats?.percent ?? 0}%</b>已结构化<br/><span style={{fontSize:11,color:'var(--ink-3)'}}>{detail.completionStats?.structuredCount ?? 0} / {detail.completionStats?.totalCount ?? 0} 条</span></div>
            </div>
            <Stat label="基本情况" value={detail.completionStats?.fields ? `${detail.completionStats.fields.current} / ${detail.completionStats.fields.total}` : '—'} color="var(--ok)"/>
            <Stat label="价值主张" value={`${detail.completionStats?.valueItems ?? 0} / 3`} color="var(--ok)"/>
            <Stat label="业务条目" value={`${detail.completionStats?.structuredCount ?? 0} / ${detail.completionStats?.totalCount ?? 0}`} color="var(--accent)"/>
            <Stat label="DSL 规则" value={detail.completionStats?.dslViolations ? `${detail.completionStats.dslViolations} 违反` : '0 违反'} color="var(--err)" last/>
          </SidePanel>

          <div style={{border:'1px solid var(--line)',borderRadius:12,background:'linear-gradient(135deg,var(--brand),oklch(.35 .18 285) 64%,oklch(.62 .20 320))',padding:18,color:'#fff',boxShadow:'var(--shadow-1)'}}>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:'.14em',fontFamily:'var(--font-mono)',marginBottom:12}}>✦ AI COPILOT</div>
            <p style={{lineHeight:1.65,fontSize:13,margin:'0 0 12px',fontWeight:700,opacity:0.7}}>检出需求后可点击"应用建议"，由 AI 分析当前需求条目并给出优化建议。</p>
            <div style={{display:'flex',gap:8}}>
              <button type="button" className="btn" style={{height:28,padding:'0 12px',fontSize:12,fontWeight:700,color:'var(--brand)',background:'#fff',border:0,borderRadius:6}} disabled={actionLoading.aiChat} onClick={async () => { const r = await actions.aiChat([{ role: 'user', content: '请基于当前需求条目，给出应用建议和修正方案。' }]); if (r?.success === false) alert(r.error || '请求失败'); else if (r) setAiResult({ type: 'chat', data: actionData(r) }) }}>{actionLoading.aiChat ? '请求中...' : '应用建议'}</button>
              <button type="button" className="btn" style={{height:28,padding:'0 12px',fontSize:12,color:'#fff',background:'rgba(255,255,255,.14)',border:0,borderRadius:6}} onClick={() => setAiResult({ type: 'evidence', data: Object.keys(detail).filter(k => typeof detail[k] !== 'object' && detail[k] !== undefined && detail[k] !== '') })}>查看依据</button>
            </div>
          </div>

          <SidePanel title="版本时间轴">
            <div style={{position:'relative',padding:'6px 0 2px'}}>
              <div style={{position:'absolute',left:7,top:8,bottom:8,width:2,background:'var(--line)'}}/>
              {(detail.versionTimeline || []).length ? (detail.versionTimeline || []).map(item=><TimelineItem key={`${item.version}-${item.time}`} {...item}/>) : (
                <div style={{padding:'10px 0 10px 28px',fontSize:12,color:'var(--ink-3)'}}>暂无版本记录</div>
              )}
            </div>
          </SidePanel>
        </aside>
      </div>

      {/* D1 — Kimi 解析需求 */}
      {dialog==='parse'&&(
        <DlgBack onClose={()=>{setDialog(null);setD1Run(false)}}>
          <DlgCard title="✦ Kimi 解析需求">
            <div style={{display:'grid',gap:12}}>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.xlsx,.txt" style={{display:'none'}} onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setD1File(file)
                setD1Result(null)
                setD1Error(null)
                setD1Run(true)
                setD1Step(0)
                try {
                  const result = await actions.parseFile(file)
                  setD1Step(D1_STEPS.length - 1)
                  setD1Run(false)
                  if (result?.success === false) {
                    setD1Error(result.error || '解析失败')
                  } else {
                    setD1Result(actionData(result))
                  }
                } catch (err) {
                  setD1Run(false)
                  setD1Error(err?.message || '上传或解析失败，请重试')
                }
              }} />
              {!d1File ? (
                <div style={{border:'2px dashed var(--line)',borderRadius:12,padding:24,textAlign:'center',cursor:'pointer',background:'var(--bg-soft)'}}
                  onClick={() => fileInputRef.current?.click()}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>📄 点击上传需求文档</div>
                  <div style={{fontSize:11,color:'var(--ink-3)'}}>支持 PDF / Word / Excel / TXT，最大 10MB</div>
                </div>
              ) : (
                <div style={{border:'1px solid var(--line)',borderRadius:12,padding:14,background:'#fff',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <span style={{fontSize:20}}>📄</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:600}}>{d1File.name}</div>
                      <div style={{fontSize:11,color:'var(--ink-3)'}}>{(d1File.size / 1024).toFixed(1)} KB</div>
                    </div>
                  </div>
                  {!d1Run && !d1Result && (
                    <button type="button" className="btn btn-ghost" style={{height:28,fontSize:11,padding:'0 10px'}} onClick={() => { setD1File(null); setD1Error(null); fileInputRef.current.value = '' }}>✕ 重选</button>
                  )}
                </div>
              )}
              {d1File && d1Run && (
                <div style={{display:'grid',gap:8}}>
                  {D1_STEPS.map((s,i)=>(<div key={s} style={{display:'flex',alignItems:'center',gap:10}}>
                    <span style={{width:22,height:22,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:11,fontWeight:700,background:i<=d1Step?'var(--brand)':'var(--line)',color:i<=d1Step?'#fff':'var(--ink-3)'}}>{i<d1Step?'✓':i+1}</span>
                    <span style={{fontSize:13,color:i<=d1Step?'var(--ink)':'var(--ink-3)'}}>{s}</span>
                    {i===d1Step&&<span style={{marginLeft:'auto',fontSize:11,color:'var(--brand)'}}>进行中…</span>}
                  </div>))}
                  <div style={{height:6,borderRadius:999,background:'var(--bg-soft)',overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${((d1Step+1)/D1_STEPS.length)*100}%`,background:'linear-gradient(90deg,var(--brand),oklch(.55 .22 295))',borderRadius:999,transition:'width .4s ease'}}/></div>
                </div>
              )}
              {d1Error && (
                <div style={{padding:12,borderRadius:8,background:'var(--err-soft)',color:'var(--err)',fontSize:12}}>
                  ✕ {d1Error}
                </div>
              )}
              {d1Result && !d1Run && (
                <div style={{padding:12,borderRadius:8,background:'var(--ok-soft)',color:'var(--ok-ink)',fontSize:12}}>
                  ✓ 解析完成 — 需求基本信息已提取，{parseSourceText(d1Result)}。可关闭窗口后在页面中查看更新
                </div>
              )}
            </div>
            <DlgAct>
              <button type="button" className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>{setDialog(null);setD1Run(false)}}>{d1Result ? '关闭' : '取消'}</button>
              {d1Result && <button type="button" className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>{setDialog(null);setAiResult({ type: 'parse', data: d1Result })}}>查看结果</button>}
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}

      {/* D2 — Kimi 评估预览 */}
      {dialog==='preview'&&(
        <DlgBack onClose={()=>setDialog(null)}>
          <DlgCard title="✦ Kimi 评估预览" wide>
            {actionLoading.previewAssessment ? (
              <div style={{padding:40,textAlign:'center',color:'var(--ink-3)'}}>正在调用 Kimi 评估，请稍候...</div>
            ) : aiResult?.type === 'preview' ? (
              <div className="grid-2-eq" style={{gap:14,minHeight:220}}>
                <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'var(--bg-soft)',fontSize:12,lineHeight:1.7,color:'var(--ink-2)'}}>
                  <b style={{color:'var(--ink)'}}>原文摘要</b><p style={{margin:'8px 0 0'}}>{detail.value || detail.basicFields?.[0]?.value || '暂无'}</p>
                </div>
                <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'#fff',fontSize:12,overflowY:'auto',maxHeight:300}}>
                  <b style={{fontSize:12,color:'var(--ink)'}}>API 响应</b>
                  <pre style={{margin:'8px 0 0',fontSize:11,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{JSON.stringify(aiResult.data, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <div style={{display:'grid',gap:12,minHeight:220,placeItems:'center'}}>
                <div style={{textAlign:'center',color:'var(--ink-2)',fontSize:13}}>点击"生成预览"，将当前需求数据发送至 Kimi 进行评估预览。</div>
              </div>
            )}
            <DlgAct>
              <button type="button" className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>{setDialog(null);setAiResult(null)}}>取消</button>
              <button type="button" className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} disabled={actionLoading.previewAssessment} onClick={async () => {
                const snapshot = {
                  projectName: detail.project,
                  customer: detail.customer,
                  industry: detail.industry,
                  solution: detail.solution,
                  scopeRows: detail.scopeRows,
                }
                const r = await actions.previewAssessment(snapshot)
                if (r?.success === false) alert(r.error || '生成失败')
                else if (r) setAiResult({ type: 'preview', data: actionData(r) })
              }}>{actionLoading.previewAssessment ? '生成中...' : '生成预览'}</button>
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}

      {/* D3 — Kimi 套用模板 */}
      {dialog==='template'&&(
        <DlgBack onClose={()=>setDialog(null)}>
          <DlgCard title="✦ Kimi 套用模板">
            <div style={{display:'grid',gap:10}}>{TEMPLATES.map(t=>(
              <div key={t.id} style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'var(--bg-soft)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                <div><div style={{fontWeight:600,fontSize:13}}>{t.name}</div><div style={{fontSize:11,color:'var(--ink-3)',marginTop:2}}>{t.desc}</div></div>
                <button type="button" className="btn btn-pri" style={{height:28,fontSize:12,padding:'0 12px',flexShrink:0}} disabled={actionLoading.applyTemplate} onClick={async () => {
                  const r = await actions.applyTemplate(t.name)
                  setDialog(null)
                  if (r?.success === false) alert(r.error || '套用失败')
                  else if (r) setAiResult({ type: 'template', data: actionData(r) })
                }}>{actionLoading.applyTemplate ? '请求中...' : '套用'}</button>
              </div>
            ))}</div>
            <DlgAct><button type="button" className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>setDialog(null)}>取消</button></DlgAct>
          </DlgCard>
        </DlgBack>
      )}

      {/* D4 */}
      {dialog==='ambiguous'&&(
        <DlgBack onClose={()=>setDialog(null)}>
          <DlgCard title="✦ Kimi 修复歧义">
            <div style={{display:'grid',gap:12}}>{D4_ITEMS.map(item=>{
              const ans=d4Ans[item.id]
              return <div key={item.id} style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'var(--bg-soft)'}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{item.text}</div>
                <div style={{display:'flex',gap:6}}>{[
                  {k:'A',l:item.a},{k:'B',l:item.b},{k:'skip',l:'跳过'}
                ].map(opt=><button type="button" key={opt.k} onClick={()=>setD4Ans(p=>({...p,[item.id]:opt.k}))}
                  style={{flex:1,padding:'6px 0',borderRadius:6,fontSize:12,fontFamily:'inherit',border:'1px solid '+(ans===opt.k?'var(--brand)':'var(--line)'),background:ans===opt.k?'var(--brand-soft)':'#fff',color:ans===opt.k?'var(--brand-ink)':'var(--ink)',cursor:'pointer',fontWeight:ans===opt.k?600:400}}>{opt.l}</button>)}</div>
              </div>
            })}</div>
            <div style={{height:6,borderRadius:999,background:'var(--bg-soft)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${(d4Prog/D4_ITEMS.length)*100}%`,background:'linear-gradient(90deg,var(--brand),oklch(.55 .22 295))',borderRadius:999,transition:'width .3s ease'}}/></div>
            <div style={{fontSize:11,color:'var(--ink-3)',textAlign:'right'}}>已完成 {d4Prog} / {D4_ITEMS.length}</div>
            <DlgAct>
              <button type="button" className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>setDialog(null)}>取消</button>
              <button type="button" className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} disabled={d4Prog<D4_ITEMS.length || actionLoading.fixAmbiguity} onClick={async () => {
                  const questions = D4_ITEMS.map(item => ({ id: item.id, text: item.text, answer: d4Ans[item.id] }))
                  const r = await actions.fixAmbiguity(questions)
                  setDialog(null)
                  if (r?.success === false) alert(r.error || '分析失败')
                  else if (r) setAiResult({ type: 'fixAmbiguity', data: actionData(r) })
                }}>{actionLoading.fixAmbiguity ? '分析中...' : '全部确认'}</button>
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}
      {/* AI Result Modal */}
      {aiResult && (
        <DlgBack onClose={() => setAiResult(null)}>
          <DlgCard title={`✦ AI 结果 · ${aiResult.type === 'chat' ? 'AI 对话' : aiResult.type === 'parse' ? '文件解析' : aiResult.type === 'preview' ? '评估预览' : aiResult.type === 'template' ? '模板应用' : aiResult.type === 'evidence' ? '数据依据' : aiResult.type === 'versionSnapshot' ? '版本快照' : '歧义修复'}`} wide>
            <div style={{maxHeight:'60vh',overflowY:'auto',fontSize:12,lineHeight:1.7}}>
              {aiResult.type === 'evidence' ? (
                <table className="table" style={{width:'100%'}}>
                  <thead><tr><th>字段</th><th>值</th></tr></thead>
                  <tbody>
                    {aiResult.data.map((k, i) => (
                      <tr key={k}><td style={{fontFamily:'var(--font-mono)',fontSize:11,fontWeight:600}}>{k}</td><td style={{fontSize:12}}>{typeof detail[k] === 'string' ? detail[k] : JSON.stringify(detail[k])}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <pre style={{margin:0,fontSize:11,lineHeight:1.6,whiteSpace:'pre-wrap',fontFamily:'var(--font-mono)'}}>
                  {JSON.stringify(aiResult.data, null, 2)}
                </pre>
              )}
            </div>
            <DlgAct>
              <button type="button" className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={() => setAiResult(null)}>关闭</button>
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}
    </PageShell>
  )
}

function VersionHistoryPanel({ rows, currentId, onInspect, onExport }) {
  const current = rows.find((row) => row.id === currentId || row.current) || rows[0]
  return <Panel rail="HISTORY" title="版本历史" meta={<Badge type="ci">{rows.length} 条</Badge>} right="只读 · 可查看快照 / 导出">
    <div style={{padding:16,display:'grid',gap:12}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10}}>
        <Pm label="当前版本" value={current?.version || '—'} />
        <Pm label="版本族" value={current?.baseCode || '—'} />
        <Pm label="历史归档" value={`${rows.filter((row) => row.archived).length} 条`} />
      </div>
      {rows.length ? (
        <div style={{overflowX:'auto',border:'1px solid var(--line)',borderRadius:10}}>
          <table className="table" style={{border:0,borderRadius:0,minWidth:760}}>
            <thead>
              <tr>
                <th>版本号</th>
                <th>单据状态</th>
                <th>检出状态</th>
                <th>操作人</th>
                <th>更新时间</th>
                <th>说明</th>
                <th className="num">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{background: row.current ? 'var(--brand-soft)' : undefined}}>
                  <td>
                    <b style={{fontFamily:'var(--font-mono)',fontSize:12}}>{row.version}</b>
                    {row.current && <span style={{marginLeft:8}}><Badge type="ci">当前</Badge></span>}
                    {row.archived && <span style={{marginLeft:8}}><Badge type="draft">归档</Badge></span>}
                  </td>
                  <td><StatusText value={row.status}/></td>
                  <td>{row.checkoutStatus}</td>
                  <td>{row.owner}</td>
                  <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--ink-3)'}}>{row.time ? String(row.time).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td style={{color:'var(--ink-2)',fontSize:12}}>{row.note || '—'}</td>
                  <td className="num">
                    <button type="button" className="btn btn-ghost" style={{height:26,fontSize:11,padding:'0 8px'}} onClick={() => onInspect(row)}>查看</button>
                    <button type="button" className="btn btn-ghost" style={{height:26,fontSize:11,padding:'0 8px',marginLeft:4}} onClick={() => onExport(row)}>导出</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:32,textAlign:'center',border:'1px dashed var(--line)',borderRadius:10,color:'var(--ink-3)',fontSize:13}}>
          暂无版本历史。完成检入或升版后，将在这里形成版本记录。
        </div>
      )}
    </div>
  </Panel>
}

function StatusText({ value }) {
  const map = {
    '已检出': 'co',
    '已检入': 'ci',
    '进行中': 'draft',
    '已归档': 'draft',
  }
  return <Badge type={map[value] || 'draft'}>{value || '—'}</Badge>
}

function TabPlaceholder({ title, desc }) {
  return <Panel rail="TODO" title={title} right="待后续接入">
    <div style={{padding:36,textAlign:'center',color:'var(--ink-3)',fontSize:13,lineHeight:1.8}}>
      {desc}
    </div>
  </Panel>
}

function Panel({rail,title,meta,right,children,dashed}){
  return <article style={{position:'relative',background:'#fff',border:'1px solid var(--line)',borderRadius:12,boxShadow:'var(--shadow-1)',borderStyle:dashed?'dashed':'solid',overflow:'visible'}}>
    <div style={{minHeight:48,padding:'12px 16px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10,fontSize:13,fontWeight:800,background:dashed?'var(--bg-soft)':'#fff',borderTopLeftRadius:12,borderTopRightRadius:12}}>
      <span>{title}</span>
      {meta}
      {right && <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--ink-3)',fontFamily:'var(--font-mono)',fontWeight:700}}>{right}</div>}
    </div>
    {children}
  </article>
}
function SidePanel({title,children}){
  return <div style={{border:'1px solid var(--line)',borderRadius:12,background:'#fff',overflow:'hidden',boxShadow:'var(--shadow-1)'}}>
    <div style={{padding:'12px 16px',borderBottom:'1px solid var(--line)',fontSize:13,fontWeight:800}}>{title}</div>
    <div style={{padding:'14px 16px'}}>{children}</div>
  </div>
}
function Pm({label,value,muted}){
  return <div style={{border:'1px solid var(--line)',borderRadius:8,padding:'10px 12px',background:'#fff',minHeight:64}}>
    <div style={{fontSize:11,color:'var(--ink-3)',marginBottom:7}}>{label}</div>
    <div style={{fontSize:12.5,fontWeight:700,color:muted?'var(--ink)':'var(--ink)'}}>{value}</div>
  </div>
}
function Field({label,value,required,muted,italic,badge,help,editable,onChange}){
  const displayValue = value || ''
  return <div style={{minHeight:48}}>
    <div style={{fontSize:11,color:'var(--ink-3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>
      {label}{required && <span style={{color:'var(--err)'}}> *</span>}{help && <span style={{color:'var(--ink-3)'}}> ?</span>}
    </div>
    {editable ? (
      <input
        className="input"
        value={displayValue === '—' ? '' : displayValue}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="请输入"
        style={{height:32,fontSize:13,fontWeight:600,background:'#fff'}}
      />
    ) : badge ? <Badge type={badge}>{value}</Badge> : <div style={{fontSize:13,color:muted?'var(--ink-3)':'var(--ink)',fontWeight:muted?400:700,fontStyle:italic?'italic':'normal'}}>{value}</div>}
  </div>
}
function LongField({label,value,children,editable,onChange,placeholder}){
  const text = value ?? children ?? ''
  return <div style={{marginTop:10}}>
    <div style={{fontSize:11,color:'var(--ink-3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'.06em',margin:'8px 0 4px'}}>{label}</div>
    {editable ? (
      <textarea
        className="input"
        value={text}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder || '请输入'}
        style={{height:'auto',minHeight:72,padding:'10px 12px',fontSize:12.5,lineHeight:1.65,resize:'vertical',background:'#fff'}}
      />
    ) : <div style={{fontSize:12.5,color:'var(--ink-2)',lineHeight:1.65}}>{text || placeholder}</div>}
  </div>
}
function ValueLine({label,tone,text}){
  const palette = {
    accent:{background:'var(--accent-soft)',color:'var(--accent)'},
    brand:{background:'var(--brand-soft)',color:'var(--brand-ink)'},
    teal:{background:'var(--teal-soft)',color:'var(--teal)'},
  }[tone]
  return <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
    <span style={{display:'inline-flex',height:22,alignItems:'center',borderRadius:999,padding:'0 8px',fontFamily:'var(--font-mono)',fontSize:10.5,fontWeight:800,flexShrink:0,marginTop:2,...palette}}>{label}</span>
    <span style={{color:'var(--ink-2)',lineHeight:1.7}}>{text}</span>
  </div>
}
function Badge({type,children}){
  const cls = ['ci','co','lock','draft'].includes(type) ? `bdg ${type}` : 'bdg'
  const custom = type === 'teal' ? {background:'var(--teal-soft)',color:'var(--teal)',fontSize:11,padding:'2px 8px'} : {fontSize:10.5,padding:'1px 8px',height:22}
  const dot = type === 'teal' ? 'var(--teal)' : undefined
  return <span className={cls} style={custom}><span className="dot" style={dot?{background:dot}:undefined}/>{children}</span>
}
function ExtraCard({title,desc,source}){
  return <div style={{padding:'10px 12px',background:'#fff',border:'1px solid var(--line)',borderRadius:8}}>
    <b style={{fontSize:12.5}}>{title}</b>
    <div style={{color:'var(--ink-3)',fontSize:11,marginTop:3}}>{desc}</div>
    <div style={{color:'var(--ink-3)',fontSize:10.5,fontFamily:'var(--font-mono)',marginTop:6}}>{source}</div>
  </div>
}
function Donut({ percent = 0 }){
  const circumference = 2 * Math.PI * 38 // r=38
  const dash = (percent / 100) * circumference
  return <svg width="92" height="92" viewBox="0 0 92 92" style={{flexShrink:0}}>
    <circle cx="46" cy="46" r="38" fill="none" stroke="var(--bg-soft)" strokeWidth="12"/>
    <circle cx="46" cy="46" r="38" fill="none" stroke="var(--ok)" strokeWidth="12" strokeDasharray={`${dash} ${circumference}`} transform="rotate(-90 46 46)"/>
  </svg>
}
function Stat({label,value,color,last}){
  return <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:last?'none':'1px dashed var(--line)',fontSize:12}}>
    <span style={{color:'var(--ink-2)'}}>{label}</span>
    <span style={{fontWeight:800,fontVariantNumeric:'tabular-nums',color}}>{value}</span>
  </div>
}
function TimelineItem({version,owner,time,current,checkoutStatus,docStatus}){
  return <div style={{position:'relative',padding:'8px 0 10px 28px'}}>
    <span style={{position:'absolute',left:0,top:12,width:14,height:14,borderRadius:'50%',background:current?'var(--brand)':'#fff',border:`2px solid ${current?'var(--brand)':'var(--line-2)'}`,zIndex:1}}/>
    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
      <span style={{fontSize:12.5,fontWeight:800,fontFamily:'var(--font-mono)'}}>{version}</span>
      {current && <Badge type="ci">当前</Badge>}
    </div>
    <div style={{fontSize:12,color:'var(--ink-2)',marginTop:4}}>{owner}</div>
    {(checkoutStatus || docStatus) && (
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
        {checkoutStatus && <StatusText value={checkoutStatus}/>}
        {docStatus && <StatusText value={docStatus}/>}
      </div>
    )}
    <div style={{fontSize:11,color:'var(--ink-3)',fontFamily:'var(--font-mono)',marginTop:4}}>{time}</div>
  </div>
}
function DlgBack({children,onClose}){ return <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.42)',display:'grid',placeItems:'center',padding:20,zIndex:50}}>{children}</div> }
function DlgCard({title,wide,children}){ return <div style={{width:wide?'min(720px, 100%)':'min(520px, 100%)',background:'#fff',borderRadius:'var(--r-lg)',boxShadow:'0 24px 64px rgba(15,23,42,0.24)',border:'1px solid var(--line)',padding:18}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}><strong style={{fontSize:14}}>{title}</strong></div>{children}</div> }
function DlgAct({children}){ return <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:14}}>{children}</div> }
