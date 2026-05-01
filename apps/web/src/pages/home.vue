<template>
  <div class="home-page">
    <el-row :gutter="20">
      <el-col :span="24">
        <el-card class="welcome-card">
          <h1>👋 欢迎回来，{{ auth.user?.username }}</h1>
          <p class="role-line">
            当前角色：
            <el-tag type="primary" effect="dark" size="large">
              {{ auth.user?.role }}
            </el-tag>
          </p>
          <p class="hint">请选择以下工作台进入相应模块</p>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="cards-row">
      <el-col
        v-for="item in roleCards"
        :key="item.key"
        :xs="24"
        :sm="12"
        :md="8"
        :lg="8"
        class="card-col"
      >
        <el-card
          class="role-card"
          :class="{ disabled: item.disabled }"
          shadow="hover"
          @click="item.disabled ? null : $router.push(item.path)"
        >
          <div class="role-icon">{{ item.icon }}</div>
          <h3>{{ item.title }}</h3>
          <p class="role-desc">{{ item.desc }}</p>
          <el-tag v-if="item.disabled" type="info" effect="plain" size="small">
            建设中
          </el-tag>
          <el-tag v-else type="success" effect="plain" size="small">
            已开放
          </el-tag>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

interface RoleCard {
  key: string
  title: string
  desc: string
  icon: string
  path: string
  disabled: boolean
}

const roleCards = computed<RoleCard[]>(() => {
  const isAdmin = auth.isAdmin
  return [
    {
      key: 'admin',
      title: '系统管理',
      desc: '用户管理、系统配置、版本控制',
      icon: '⚙️',
      path: '/admin',
      disabled: !isAdmin,
    },
    {
      key: 'presales',
      title: '售前工作台',
      desc: '需求导入、商机简报、评估预览',
      icon: '📊',
      path: '/presales',
      disabled: true, // W4-A 待实现
    },
    {
      key: 'pm',
      title: 'PM 工作台',
      desc: '工作量估算、模板管理、规则集',
      icon: '📝',
      path: '/pm',
      disabled: true, // W4-B 待实现
    },
    {
      key: 'pmo',
      title: 'PMO 工作台',
      desc: '团队管理、总方案、WBS 派生',
      icon: '📁',
      path: '/pmo',
      disabled: true, // 待实现
    },
    {
      key: 'sales',
      title: '销售工作台',
      desc: '销售简报、机会跟踪',
      icon: '💼',
      path: '/sales',
      disabled: true, // 待实现
    },
  ]
})
</script>

<style scoped>
.home-page {
  max-width: 1200px;
  margin: 0 auto;
}

.welcome-card {
  margin-bottom: 20px;
}

.welcome-card h1 {
  margin: 0 0 12px;
  font-size: 24px;
}

.role-line {
  margin: 0 0 8px;
  font-size: 15px;
  color: #606266;
}

.hint {
  margin: 0;
  font-size: 14px;
  color: #909399;
}

.cards-row {
  margin-top: 8px;
}

.card-col {
  margin-bottom: 20px;
}

.role-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  text-align: center;
  height: 100%;
}

.role-card:not(.disabled):hover {
  transform: translateY(-4px);
}

.role-card.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.role-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.role-card h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: #303133;
}

.role-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  min-height: 36px;
}
</style>
