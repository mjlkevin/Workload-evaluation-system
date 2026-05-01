<template>
  <div class="presales-new-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span>新建需求包</span>
        </div>
      </template>

      <el-form :model="form" label-width="100px" @submit.prevent="handleSubmit">
        <el-form-item label="行业">
          <el-input v-model="form.industry" placeholder="如：制造业 / 食品" />
        </el-form-item>

        <el-form-item label="规模">
          <el-input v-model="form.scale" placeholder="如：集团型 / 500人 / 10家子公司" />
        </el-form-item>

        <el-form-item label="模块">
          <div v-for="(mod, idx) in form.modules" :key="idx" class="module-row">
            <el-input v-model="mod.moduleName" placeholder="模块名" style="width: 200px; margin-right: 8px;" />
            <el-input v-model="mod.subModulesText" placeholder="子模块（逗号分隔）" style="width: 280px; margin-right: 8px;" />
            <el-button link type="danger" @click="removeModule(idx)">删除</el-button>
          </div>
          <el-button link type="primary" @click="addModule">
            <el-icon><Plus /></el-icon> 添加模块
          </el-button>
        </el-form-item>

        <el-form-item label="约束条件">
          <div v-for="(_c, idx) in form.constraints" :key="idx" class="constraint-row">
            <el-input v-model="form.constraints[idx]" placeholder="约束条件" style="width: 400px; margin-right: 8px;" />
            <el-button link type="danger" @click="removeConstraint(idx)">删除</el-button>
          </div>
          <el-button link type="primary" @click="addConstraint">
            <el-icon><Plus /></el-icon> 添加约束
          </el-button>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">创建</el-button>
          <el-button @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { createPack, updatePack } from '@/api/presales'

const router = useRouter()
const loading = ref(false)

const form = reactive({
  industry: '',
  scale: '',
  modules: [] as Array<{ moduleName: string; subModulesText: string }>,
  constraints: [] as string[],
})

function addModule() {
  form.modules.push({ moduleName: '', subModulesText: '' })
}

function removeModule(idx: number) {
  form.modules.splice(idx, 1)
}

function addConstraint() {
  form.constraints.push('')
}

function removeConstraint(idx: number) {
  form.constraints.splice(idx, 1)
}

async function handleSubmit() {
  loading.value = true
  try {
    // Step 1: create empty pack
    const pack = await createPack({})

    // Step 2: patch with form data
    const modules = form.modules
      .filter((m) => m.moduleName.trim())
      .map((m) => ({
        moduleName: m.moduleName.trim(),
        subModules: m.subModulesText.split(',').map((s) => s.trim()).filter(Boolean),
      }))

    await updatePack(pack.requirementPackId, {
      industry: form.industry || null,
      scale: form.scale || null,
      modules,
      constraints: form.constraints.filter(Boolean),
    })

    ElMessage.success('创建成功')
    router.push(`/presales/${pack.requirementPackId}`)
  } catch (e) {
    console.error(e)
    ElMessage.error('创建失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.presales-new-page {
  max-width: 800px;
  margin: 0 auto;
}
.page-header {
  font-weight: 600;
}
.module-row,
.constraint-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
</style>
