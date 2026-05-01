<template>
  <div class="pm-page">
    <el-card v-loading="loading">
      <template #header>
        <div class="page-header">
          <span>五段式叙事</span>
          <div class="header-actions">
            <el-button type="primary" :loading="generating" @click="handleGenerate">自动生成草稿</el-button>
            <el-button type="success" :loading="saving" @click="handleSave">保存</el-button>
            <el-button :loading="saving" @click="handleConfirm" :disabled="narrative?.status === 'confirmed'">确认</el-button>
          </div>
        </div>
      </template>

      <template v-if="narrative">
        <el-descriptions :column="2" border size="small" class="meta-desc">
          <el-descriptions-item label="ID">{{ narrative.narrativeId }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="narrative.status === 'confirmed' ? 'success' : 'info'">
              {{ narrative.status === 'confirmed' ? '已确认' : '草稿' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <div class="section-title">1. 组织与模块</div>
        <el-input v-model="form.orgAndModules" type="textarea" :rows="4" placeholder="描述客户组织架构与涉及模块..." />

        <div class="section-title">2. 数据治理</div>
        <el-input v-model="form.dataGovernance" type="textarea" :rows="4" placeholder="描述数据治理策略..." />

        <div class="section-title">3. 特殊场景</div>
        <el-input v-model="form.specialScenarios" type="textarea" :rows="4" placeholder="描述特殊业务场景..." />

        <div class="section-title">4. 验收范围</div>
        <el-input v-model="form.acceptanceScope" type="textarea" :rows="4" placeholder="描述验收标准与范围..." />

        <div class="section-title">5. 时间与成本</div>
        <el-input v-model="form.timelineAndCost" type="textarea" :rows="4" placeholder="描述实施周期与成本构成..." />
      </template>

      <el-empty v-else description="暂无叙事，点击上方按钮生成">
        <el-button type="primary" @click="handleGenerate">自动生成草稿</el-button>
      </el-empty>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createNarrative, generateNarrative, updateNarrative, type Narrative } from '@/api/pm'

const narrative = ref<Narrative | null>(null)
const loading = ref(false)
const generating = ref(false)
const saving = ref(false)

const form = reactive({
  orgAndModules: '',
  dataGovernance: '',
  specialScenarios: '',
  acceptanceScope: '',
  timelineAndCost: '',
})

function syncForm(n: Narrative) {
  narrative.value = n
  form.orgAndModules = n.orgAndModules || ''
  form.dataGovernance = n.dataGovernance || ''
  form.specialScenarios = n.specialScenarios || ''
  form.acceptanceScope = n.acceptanceScope || ''
  form.timelineAndCost = n.timelineAndCost || ''
}

async function handleGenerate() {
  generating.value = true
  try {
    const n = await generateNarrative({
      assessmentVersionId: '00000000-0000-0000-0000-000000000000',
      packData: {},
    })
    syncForm(n)
    ElMessage.success('生成成功')
  } catch (e) {
    ElMessage.error('生成失败')
  } finally {
    generating.value = false
  }
}

async function handleSave() {
  if (!narrative.value) {
    saving.value = true
    try {
      const n = await createNarrative({
        orgAndModules: form.orgAndModules,
        dataGovernance: form.dataGovernance,
        specialScenarios: form.specialScenarios,
        acceptanceScope: form.acceptanceScope,
        timelineAndCost: form.timelineAndCost,
      })
      syncForm(n)
      ElMessage.success('保存成功')
    } catch (e) {
      ElMessage.error('保存失败')
    } finally {
      saving.value = false
    }
    return
  }
  saving.value = true
  try {
    const n = await updateNarrative(narrative.value.narrativeId, {
      orgAndModules: form.orgAndModules,
      dataGovernance: form.dataGovernance,
      specialScenarios: form.specialScenarios,
      acceptanceScope: form.acceptanceScope,
      timelineAndCost: form.timelineAndCost,
    })
    syncForm(n)
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function handleConfirm() {
  if (!narrative.value) return
  saving.value = true
  try {
    const n = await updateNarrative(narrative.value.narrativeId, { status: 'confirmed' })
    syncForm(n)
    ElMessage.success('已确认')
  } catch (e) {
    ElMessage.error('操作失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.pm-page {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.meta-desc {
  margin-bottom: 16px;
}
.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
  font-size: 15px;
  color: #303133;
}
</style>
