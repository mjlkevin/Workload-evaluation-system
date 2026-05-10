import React, { useState, useRef, useEffect } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'

const REQ = {
  code: 'RQ-04001', project: '金石制造数字化二期', submitter: '张鹏', submittedAt: '2026-04-18',
  status: '已检入', version: 'v03 / VA2', customer: '金石制造集团', location: '江苏苏州',
  industry: '离散制造', revenue: '8–12 亿/年', it: '已有 ERP，需升级', goLive: '2026-10',
  value: '打通订单到交付全链路，缩短交付周期 20%。统一主数据口径，减少跨系统对账成本。',
  urgency: '高', priority: 'P1',
  scopeIn: ['ERP 核心模块升级','多基地协同','精细化成本核算'],
  scopeOut: ['MES 集成','WMS 改造'],
  assumptions: ['现有主数据可迁移','用户培训周期 2 周'],
  solution: [
    { id:1, module:'总账', desc:'凭证自动化与成本核算', days:45, owner:'李雷' },
    { id:2, module:'销售', desc:'订单到发货全流程跟踪', days:60, owner:'王芳' },
    { id:3, module:'采购', desc:'询比价与供应商协同', days:40, owner:'赵强' },
    { id:4, module:'库存', desc:'多基地库存可视与调拨', days:55, owner:'刘洋' },
    { id:5, module:'报表', desc:'经营看板与明细钻取', days:30, owner:'陈静' },
  ],
  attach: [
    { name:'需求访谈纪要-0418.pdf', size:'2.4 MB', date:'2026-04-18' },
    { name:'现状调研报告.docx', size:'1.8 MB', date:'2026-04-15' },
  ],
  summary: { complexity:'高', mandays:230, risk:'中' },
  vcs: { status:'checked-in', hasLocalChanges:false },
}

const KIMI_MENU = [
  { key:'parse', label:'Kimi 解析需求' },
  { key:'preview', label:'Kimi 评估预览' },
  { key:'template', label:'Kimi 套用模板' },
  { key:'ambiguous', label:'Kimi 修复歧义' },
]
const D1_STEPS = ['上传','OCR','NLP','结构化','完成']
const D4_ITEMS = [
  { id:1, text:'「多基地协同」是否包含海外工厂？', a:'包含', b:'不包含' },
  { id:2, text:'「精细化成本核算」需细化到工序级还是产品级？', a:'工序级', b:'产品级' },
  { id:3, text:'预期上线时间 2026-10 是否为硬截止？', a:'硬截止', b:'可协商' },
]
const TEMPLATES = [
  { id:'T1', name:'实施评估标准版', desc:'适用于中大型离散制造项目，含 120+ SKU 条目。' },
  { id:'T2', name:'快速交付轻量版', desc:'适用于 200 人以下组织，快速上线场景。' },
  { id:'T3', name:'定制开发扩展版', desc:'含接口开发、报表定制、第三方集成评估。' },
]

export default function RequirementDetail() {
  const [dialog, setDialog] = useState(null)
  const [kimiOpen, setKimiOpen] = useState(false)
  const [rows, setRows] = useState(REQ.solution)
  const [d1Step, setD1Step] = useState(0)
  const [d1Run, setD1Run] = useState(false)
  const [d4Ans, setD4Ans] = useState({})
  const kimiRef = useRef(null)
  const isCo = REQ.vcs.status === 'checked-out'

  useEffect(() => { function onDoc(e){ if(kimiRef.current && !kimiRef.current.contains(e.target)) setKimiOpen(false) } document.addEventListener('click',onDoc); return ()=>document.removeEventListener('click',onDoc) },[])
  useEffect(() => { if(!d1Run || d1Step>=D1_STEPS.length-1){ if(d1Step>=D1_STEPS.length-1) setD1Run(false); return } const t=setTimeout(()=>setD1Step(s=>s+1),600); return ()=>clearTimeout(t) },[d1Run,d1Step])

  const startD1=()=>{ setD1Step(0); setD1Run(true); setDialog('parse') }
  const addRow=()=>setRows(p=>[...p,{id:Date.now(),module:'新模块',desc:'请填写描述',days:0,owner:'待分配'}])
  const rmRow=id=>setRows(p=>p.filter(r=>r.id!==id))
  const d4Prog=Object.keys(d4Ans).length
  const vcsBtn=[
    {k:'hist',l:'🕘 历史',m:'always'},{k:'promote',l:'⬆ 升版',m:'always'},
    {k:'checkin',l:'🔒 检入',m:'checked-out',pri:true},{k:'undo',l:'↺ 撤销',m:'checked-out'},
    {k:'checkout',l:'🔓 检出',m:'checked-in'},{k:'unlock',l:'⚠ 解锁',m:'checked-out',dan:true},
    {k:'export',l:'↓ 导出',m:'always'},{k:'save',l:'⤒ 保存',m:'always',pri:true},
  ]
  const vcsEn=m=>m==='always'||(m==='checked-out'&&isCo)||(m==='checked-in'&&!isCo)

  return (
    <PageShell crumb="工作台 / 需求 / 需求详情" title="需求详情" subtitle={`${REQ.code} · ${REQ.version} · 模型 kimi-k2.5`}
      actions={[
        <div key="kimi" ref={kimiRef} style={{position:'relative'}}>
          <button className="btn" onClick={()=>setKimiOpen(v=>!v)} style={{
            height:32,fontSize:12,padding:'0 12px',background:'linear-gradient(135deg,oklch(.55 .22 295),oklch(.62 .20 320))',
            color:'#fff',border:'none',borderRadius:6,cursor:'pointer',boxShadow:'0 2px 8px oklch(.55 .22 320 / .35)',
            fontFamily:'inherit',fontWeight:600,display:'inline-flex',alignItems:'center',gap:6,
          }}><span>✦</span> Kimi-help <span>▾</span></button>
          {kimiOpen && (
            <div style={{position:'absolute',top:'calc(100% + 6px)',right:0,background:'#fff',border:'1px solid var(--line)',borderRadius:'var(--r-md)',boxShadow:'var(--shadow-2)',minWidth:180,zIndex:20,overflow:'hidden'}}>
              {KIMI_MENU.map(m=>(
                <button key={m.key} onClick={()=>{setKimiOpen(false);m.key==='parse'?startD1():setDialog(m.key)}}
                  style={{display:'block',width:'100%',textAlign:'left',padding:'8px 12px',fontSize:12,fontFamily:'inherit',background:'transparent',border:'none',borderBottom:'1px solid var(--line)',cursor:'pointer',color:'var(--ink)'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--bg-soft)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{m.label}</button>
              ))}
            </div>
          )}
        </div>,
        ...vcsBtn.map(b=>{
          const en=vcsEn(b.m)
          const cls=b.pri?'btn btn-pri':b.dan?'btn btn-dan':'btn btn-ghost'
          return <button key={b.k} className={cls} disabled={!en} onClick={()=>en&&alert(`Phase A · mock · [${b.l}]`)}
            style={{height:32,fontSize:12,padding:'0 10px',opacity:en?1:0.45,cursor:en?'pointer':'not-allowed'}}>{b.l}</button>
        }),
      ]}>
      <div className="tabs" style={{marginBottom:16}}>
        {['条目明细 (22)','版本历史 (8)','变更对比','附件','SOW','DSL 规则审阅'].map((t,i)=>(
          <span key={t} className={i===0?'on':''} style={{cursor:'pointer'}}>{t}</span>
        ))}
      </div>
      <div className="grid-1fr-280">
        <div style={{display:'grid',gap:16}}>
          <Sec badge="CONTEXT" title="上下文" action="编辑">
            <Grid3><Kv k="项目" v={REQ.project}/><Kv k="客户" v={REQ.customer}/><Kv k="行业" v={REQ.industry}/>
              <Kv k="地点" v={REQ.location}/><Kv k="提交人" v={REQ.submitter}/><Kv k="提交时间" v={REQ.submittedAt}/></Grid3>
          </Sec>
          <Sec badge="BASIC" title="基本信息" action="编辑">
            <Grid3><Kv k="需求编号" v={REQ.code}/><Kv k="状态" v={REQ.status}/><Kv k="版本" v={REQ.version}/>
              <Kv k="企业营收" v={REQ.revenue}/><Kv k="信息化现状" v={REQ.it}/><Kv k="预期上线" v={REQ.goLive}/>
              <div style={{gridColumn:'1 / -1'}}><Kv k="企业简介" v="金石制造集团成立于 2008 年，专注于精密零部件加工，年营收约 10 亿，员工 2400 人。现有 ERP 已使用 5 年，无法支撑多基地协同与精细化成本核算，需升级核心模块。"/></div></Grid3>
          </Sec>
          <Sec badge="VALUE" title="业务价值" action="编辑">
            <div style={{display:'grid',gap:10}}>
              <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:'10px 12px',background:'var(--bg-soft)',lineHeight:1.6}}>{REQ.value}</div>
              <div className="grid-2-eq"><Kv k="紧急度" v={REQ.urgency}/><Kv k="优先级" v={REQ.priority}/></div>
            </div>
          </Sec>
          <Sec badge="SCOPE" title="范围与边界" action="编辑">
            <div style={{display:'grid',gap:10}}>
              <div><div style={{fontSize:11,color:'var(--ink-3)',marginBottom:4,fontWeight:600}}>包含</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{REQ.scopeIn.map(s=><span key={s} className="bdg ok" style={{fontSize:11,padding:'2px 8px'}}><span className="dot"/>{s}</span>)}</div></div>
              <div><div style={{fontSize:11,color:'var(--ink-3)',marginBottom:4,fontWeight:600}}>不包含</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{REQ.scopeOut.map(s=><span key={s} className="bdg draft" style={{fontSize:11,padding:'2px 8px'}}><span className="dot"/>{s}</span>)}</div></div>
              <div><div style={{fontSize:11,color:'var(--ink-3)',marginBottom:4,fontWeight:600}}>假设条件</div><ul style={{margin:0,paddingLeft:18,fontSize:12,color:'var(--ink-2)',lineHeight:1.7}}>{REQ.assumptions.map(a=><li key={a}>{a}</li>)}</ul></div>
            </div>
          </Sec>
          <Sec badge="SOLUTION" title="方案要点" action="编辑">
            <div style={{overflowX:'auto'}}><table className="table" style={{minWidth:520}}><thead><tr><th>模块</th><th>描述</th><th className="num">人天</th><th>负责人</th><th style={{width:40}}/></tr></thead>
              <tbody>{rows.map(r=>(<tr key={r.id}><td style={{fontWeight:600}}>{r.module}</td><td>{r.desc}</td><td className="num">{r.days}</td><td>{r.owner}</td><td><button className="btn btn-ghost" style={{fontSize:11,padding:'2px 6px',height:24,color:'var(--err)'}} onClick={()=>rmRow(r.id)}>✕</button></td></tr>))}</tbody>
            </table></div>
            <button className="btn btn-pri" style={{marginTop:10,height:28,fontSize:12,padding:'0 12px'}} onClick={addRow}>+ 新增行</button>
          </Sec>
          <Sec badge="ATTACH" title="PRD / RFC 附件" action="上传">
            <div style={{display:'grid',gap:8}}>{REQ.attach.map(a=>(
              <div key={a.name} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',border:'1px solid var(--line)',borderRadius:'var(--r-md)',background:'#fff'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:16}}>📄</span><div><div style={{fontSize:13,fontWeight:600}}>{a.name}</div><div style={{fontSize:11,color:'var(--ink-3)'}}>{a.size} · {a.date}</div></div></div>
                <button className="btn btn-ghost" style={{fontSize:11,padding:'4px 10px',height:26}}>下载</button>
              </div>
            ))}</div>
          </Sec>
        </div>
        <aside style={{display:'grid',gap:16,alignContent:'start'}}>
          <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-lg)',background:'var(--surface)',padding:16,boxShadow:'var(--shadow-1)'}}>
            <h4 style={{margin:'0 0 10px'}}>评估总览</h4>
            <div style={{display:'grid',gap:10}}>
              <Kpi label="复杂度" value={REQ.summary.complexity} c="var(--accent)"/>
              <Kpi label="工期估算" value={`${REQ.summary.mandays} 人天`} c="var(--brand)"/>
              <Kpi label="风险等级" value={REQ.summary.risk} c="var(--warn)"/>
            </div>
          </div>
          <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-lg)',background:'linear-gradient(180deg,color-mix(in oklab,oklch(.62 .20 320) 14%,var(--surface)),var(--surface))',padding:16,boxShadow:'var(--shadow-1)'}}>
            <span style={{display:'inline-flex',alignItems:'center',padding:'4px 8px',borderRadius:999,background:'oklch(.95 .03 295)',color:'oklch(.45 .22 295)',fontSize:11,fontWeight:800,letterSpacing:'.04em'}}>✦ AI COPILOT</span>
            <p style={{lineHeight:1.7,color:'var(--ink)',fontSize:13,marginTop:10}}>建议优先固化 DSL 冲突条目并同步到实施评估页，再以 Kimi 评估预览补足风险与公式校准，减少后续版本回滚。</p>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
              <button className="btn btn-pri" style={{height:32,fontSize:12,padding:'0 12px'}} onClick={()=>alert('Phase A · mock · [应用建议]')}>应用建议</button>
              <button className="btn btn-ghost" style={{height:32,fontSize:12,padding:'0 12px'}} onClick={()=>alert('Phase A · mock · [查看依据]')}>查看依据</button>
            </div>
          </div>
        </aside>
      </div>

      {/* D1 */}
      {dialog==='parse'&&(
        <DlgBack onClose={()=>{setDialog(null);setD1Run(false)}}>
          <DlgCard title="✦ Kimi 解析需求">
            <div style={{display:'grid',gap:12}}>
              {D1_STEPS.map((s,i)=>(<div key={s} style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{width:22,height:22,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:11,fontWeight:700,background:i<=d1Step?'var(--brand)':'var(--line)',color:i<=d1Step?'#fff':'var(--ink-3)'}}>{i<d1Step?'✓':i+1}</span>
                <span style={{fontSize:13,color:i<=d1Step?'var(--ink)':'var(--ink-3)'}}>{s}</span>
                {i===d1Step&&d1Run&&<span style={{marginLeft:'auto',fontSize:11,color:'var(--brand)'}}>进行中…</span>}
              </div>))}
              <div style={{height:6,borderRadius:999,background:'var(--bg-soft)',overflow:'hidden',marginTop:4}}>
                <div style={{height:'100%',width:`${((d1Step+1)/D1_STEPS.length)*100}%`,background:'linear-gradient(90deg,var(--brand),oklch(.55 .22 295))',borderRadius:999,transition:'width .4s ease'}}/></div>
            </div>
            <DlgAct>
              <button className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>{setDialog(null);setD1Run(false)}}>取消</button>
              {d1Step>=D1_STEPS.length-1&&<button className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>setDialog(null)}>完成</button>}
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}

      {/* D2 */}
      {dialog==='preview'&&(
        <DlgBack onClose={()=>setDialog(null)}>
          <DlgCard title="✦ Kimi 评估预览" wide>
            <div className="grid-2-eq" style={{gap:14,minHeight:220}}>
              <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'var(--bg-soft)',fontSize:12,lineHeight:1.7,color:'var(--ink-2)'}}>
                <b style={{color:'var(--ink)'}}>原文摘要</b><p style={{margin:'8px 0 0'}}>金石制造集团希望升级现有 ERP 系统，实现多基地协同与精细化成本核算。核心需求包括总账自动化、销售订单跟踪、采购询比价、库存可视与经营看板。</p>
              </div>
              <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'#fff'}}>
                <b style={{fontSize:12,color:'var(--ink)'}}>抽取字段</b>
                <table style={{width:'100%',fontSize:12,marginTop:8,borderCollapse:'collapse'}}><tbody>
                  {[{k:'客户',v:'金石制造集团'},{k:'行业',v:'离散制造'},{k:'规模',v:'2400 人'},{k:'核心模块',v:'总账/销售/采购/库存/报表'},{k:'预期上线',v:'2026-10'}].map(x=>[
                    <tr key={x.k} style={{borderBottom:'1px solid var(--line)'}}><td style={{padding:'6px 0',color:'var(--ink-3)',width:80}}>{x.k}</td><td style={{padding:'6px 0',fontWeight:600}}>{x.v}</td></tr>
                  ])}
                </tbody></table>
              </div>
            </div>
            <DlgAct>
              <button className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>setDialog(null)}>取消</button>
              <button className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>{alert('Phase A · mock · [应用预览]');setDialog(null)}}>应用</button>
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}

      {/* D3 */}
      {dialog==='template'&&(
        <DlgBack onClose={()=>setDialog(null)}>
          <DlgCard title="✦ Kimi 套用模板">
            <div style={{display:'grid',gap:10}}>{TEMPLATES.map(t=>(
              <div key={t.id} style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:12,background:'var(--bg-soft)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                <div><div style={{fontWeight:600,fontSize:13}}>{t.name}</div><div style={{fontSize:11,color:'var(--ink-3)',marginTop:2}}>{t.desc}</div></div>
                <button className="btn btn-pri" style={{height:28,fontSize:12,padding:'0 12px',flexShrink:0}} onClick={()=>{alert(`Phase A · mock · [套用「${t.name}」]`);setDialog(null)}}>套用</button>
              </div>
            ))}</div>
            <DlgAct><button className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>setDialog(null)}>取消</button></DlgAct>
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
                ].map(opt=><button key={opt.k} onClick={()=>setD4Ans(p=>({...p,[item.id]:opt.k}))}
                  style={{flex:1,padding:'6px 0',borderRadius:6,fontSize:12,fontFamily:'inherit',border:'1px solid '+(ans===opt.k?'var(--brand)':'var(--line)'),background:ans===opt.k?'var(--brand-soft)':'#fff',color:ans===opt.k?'var(--brand-ink)':'var(--ink)',cursor:'pointer',fontWeight:ans===opt.k?600:400}}>{opt.l}</button>)}</div>
              </div>
            })}</div>
            <div style={{height:6,borderRadius:999,background:'var(--bg-soft)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${(d4Prog/D4_ITEMS.length)*100}%`,background:'linear-gradient(90deg,var(--brand),oklch(.55 .22 295))',borderRadius:999,transition:'width .3s ease'}}/></div>
            <div style={{fontSize:11,color:'var(--ink-3)',textAlign:'right'}}>已完成 {d4Prog} / {D4_ITEMS.length}</div>
            <DlgAct>
              <button className="btn btn-out" style={{height:30,fontSize:12,padding:'0 14px'}} onClick={()=>setDialog(null)}>取消</button>
              <button className="btn btn-pri" style={{height:30,fontSize:12,padding:'0 14px'}} disabled={d4Prog<D4_ITEMS.length} onClick={()=>{alert('Phase A · mock · [歧义已全部确认]');setDialog(null)}}>全部确认</button>
            </DlgAct>
          </DlgCard>
        </DlgBack>
      )}
    </PageShell>
  )
}

function Sec({badge,title,action,children}){
  return <article className="reg" style={{position:'relative',background:'var(--surface)',border:'1px solid var(--line)',borderRadius:'var(--r-lg)',padding:'18px 18px 16px',boxShadow:'var(--shadow-1)'}}>
    <div style={{position:'absolute',left:14,top:-11,padding:'0 8px',background:'var(--surface)',fontSize:12,fontWeight:800,letterSpacing:'.08em',color:'var(--ink-3)'}}>{badge}</div>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}><h3 style={{margin:0}}>{title}</h3><button className="btn btn-ghost" style={{height:26,fontSize:12,padding:'0 10px'}} onClick={()=>alert('Phase A · mock · [编辑]')}>{action}</button></div>
    {children}
  </article>
}
function Grid3({children}){ return <div className="grid-3-eq">{children}</div> }
function Kv({k,v}){ return <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-md)',padding:'10px 12px',background:'var(--bg-soft)'}}><div style={{fontSize:12,color:'var(--ink-3)'}}>{k}</div><div style={{marginTop:4,fontWeight:600,fontSize:13}}>{v}</div></div> }
function Kpi({label,value,c}){ return <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',borderRadius:'var(--r-md)',background:'var(--bg-soft)',border:'1px solid var(--line)'}}><span style={{fontSize:12,color:'var(--ink-3)'}}>{label}</span><span style={{fontSize:16,fontWeight:800,color:c}}>{value}</span></div> }
function DlgBack({children,onClose}){ return <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.42)',display:'grid',placeItems:'center',padding:20,zIndex:50}}>{children}</div> }
function DlgCard({title,wide,children}){ return <div style={{width:wide?'min(720px, 100%)':'min(520px, 100%)',background:'#fff',borderRadius:'var(--r-lg)',boxShadow:'0 24px 64px rgba(15,23,42,0.24)',border:'1px solid var(--line)',padding:18}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}><strong style={{fontSize:14}}>{title}</strong></div>{children}</div> }
function DlgAct({children}){ return <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:14}}>{children}</div> }
