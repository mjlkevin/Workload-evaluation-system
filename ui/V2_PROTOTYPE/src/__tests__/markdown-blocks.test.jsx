/**
 * ISS-2026-08-10-005（流式回答 Markdown 格式散乱）：自研逐行解析器容错夹具测试。
 * 夹具来源：data/ai-sessions.json 服装行业特性功能问答落库原文（模型单行紧凑
 * pseudo-markdown 输出：`##` 后无空格、行内 `##` 不分段、列表项 `-**` 无换行）。
 * 提示词是劝导、解析器是兜底——本文件锁定兜底行为，禁止回归。
 */
import { describe, expect, test } from 'vitest'
import { parseMarkdownBlocks } from '../pages/AiHomeWorkbench/utils/markdownBlocks.js'

// data/ai-sessions.json 落库原文的紧凑单行部分（逐字符保留，含全角标点与行内 ** 粗体）
const APPAREL_COMPACT_LINE = `⚠️知识库未检索到相关文档，以下为模型通用知识，仅供参考，不代表官方方案。服装行业（Apparel&Fashion）的业务系统（ERP/PLM/SCM）通常具有以下**特性功能模块**，区别于标准制造业：##1.商品与SKU管理-**多维属性矩阵**：款式×颜色×尺码×面料×版型的组合管理（通常称为"色码管理"）-**矩阵式录入**：支持Color-SizeMatrix批量维护，避免逐条录入-**生命周期标签**：上市时间、正价期、打折期、退市期管理##2.产品生命周期（PLM）-**款式档案**：设计稿、工艺单、BOM（物料清单）版本管理-**面料管理**：幅宽、克重、色卡、缩水率、批次色差控制-**工艺路线**：缝制工序、标准工时（SAM）、外协工序衔接-**样衣管理**：头版、齐色样、产前样的流转与审批##3.供应链与采购-**多计量单位**：面料按"米/公斤/码"采购，按"件"耗用，需支持浮动换算-**批次追踪**：同批次面料色差控制（缸号管理）-**分段式采购**：期货（提前6-12个月）与现货（快反）双轨并行-**委外管理**：裁剪外发、缝制外发、后道加工（水洗、印花）的进度跟踪##4.库存与仓储-**箱码管理**：支持"混色混码"装箱（如1箱含S/M/L各3色）-**库位策略**：按季节、波段、渠道（直营/电商/加盟）分仓-**盘点适配**：支持按色码盘点，差异分析到具体SKU##5.销售与渠道-**配货-补货-调货**：针对门店的智能配货算法，基于销存比自动补货-**渠道政策**：加盟商保证金、订货会期货管理、退换货率控制-**预售与快反**：电商预售数据驱动生产补单（小单快反）-**价格体系**：吊牌价、区域价、会员折扣、季末清货阶梯折扣##6.生产执行（MES）-**裁剪管理**：排料图（Marker）优化、拉布层数控制-**流水线平衡**：工序分配、在制品（WIP）监控、计件工资核算-**质量检验**：裁片检验、半成品检验、成品检验（AQL标准）##7.数据分析-**畅滞销分析**：周销存比、动销率、齐码率（SizeCurve）-**商品企划**：OTB（采购限额计划）分配、品类结构规划-**ROI追踪**：单款投入产出比、面料利用率##实施建议若您正在评估WES工作量，建议重点关注**色码矩阵的数据量**（SKU爆炸指数通常达10³-10⁴级）和**季节性强弱**（影响库存周转模块复杂度）。需要针对具体业务场景（如高端定制vs快时尚）细化功能清单吗？`

describe('markdown-blocks: ISS-2026-08-10-005 解析器容错', () => {
  test('行首标题宽容：##1.商品（# 后无空格）解析为 heading', () => {
    const blocks = parseMarkdownBlocks('##1.商品与SKU管理')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2, text: '1.商品与SKU管理' })
  })

  test('服装行业单行紧凑样本端到端分块：≥5 个 heading 且列表项独立成块', () => {
    const blocks = parseMarkdownBlocks(APPAREL_COMPACT_LINE)

    // 开篇 ⚠️ 导语仍是段落
    expect(blocks[0].type).toBe('paragraph')
    expect(blocks[0].text).toContain('⚠️知识库未检索到相关文档')

    // 行内 ## 分段：7 个编号小节 + 实施建议，至少 5 个 heading
    const headings = blocks.filter((block) => block.type === 'heading')
    expect(headings.length).toBeGreaterThanOrEqual(5)
    const headingTexts = headings.map((block) => block.text)
    expect(headingTexts).toContain('1.商品与SKU管理')
    expect(headingTexts).toContain('4.库存与仓储')
    expect(headingTexts.some((text) => text.startsWith('实施建议'))).toBe(true)

    // 紧凑列表拆分：-** 紧邻前文的列表标记切分为独立列表项
    const listItems = blocks
      .filter((block) => block.type === 'unorderedList')
      .flatMap((block) => block.items)
    expect(listItems.length).toBeGreaterThanOrEqual(10)
    expect(listItems.some((item) => item.startsWith('**多维属性矩阵**'))).toBe(true)
    expect(listItems.some((item) => item.startsWith('**畅滞销分析**'))).toBe(true)

    // 容错后不再有任何段落裸显 ## 标题标记
    const paragraphTexts = blocks
      .filter((block) => block.type === 'paragraph')
      .map((block) => block.text)
    expect(paragraphTexts.every((text) => !text.includes('##'))).toBe(true)
  })

  test('容错不误伤：--- 分隔线与行内普通连字符保持原样', () => {
    const blocks = parseMarkdownBlocks('上文段落\n\n---\n\n打通设计-打样-采购的敏捷协同')
    expect(blocks.some((block) => block.type === 'unorderedList')).toBe(false)
    expect(blocks.some((block) => block.type === 'heading')).toBe(false)
    const last = blocks[blocks.length - 1]
    expect(last).toMatchObject({ type: 'paragraph', text: '打通设计-打样-采购的敏捷协同' })
  })

  test('标准写法不回归：## 标题、- 列表、1. 有序列表按原契约解析', () => {
    const blocks = parseMarkdownBlocks('## 标准标题\n\n- 列表项一\n- 列表项二\n\n1. 第一步\n2. 第二步')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2, text: '标准标题' })
    expect(blocks[1]).toMatchObject({ type: 'unorderedList', items: ['列表项一', '列表项二'] })
    expect(blocks[2]).toMatchObject({ type: 'orderedList', items: ['第一步', '第二步'] })
  })
})
