<template>
  <el-container class="app-layout">
    <el-header class="layout-header">
      <div class="header-brand">
        <span class="brand-title">{{ title }}</span>
      </div>
      <div class="header-actions" v-if="auth.user">
        <el-tag size="small" effect="plain" class="role-tag">
          {{ auth.user.role }}
        </el-tag>
        <span class="username">{{ auth.user.username }}</span>
        <el-button link type="primary" @click="handleLogout">退出</el-button>
      </div>
    </el-header>
    <el-container class="layout-body">
      <el-aside v-if="showSidebar" width="200px" class="layout-aside">
        <slot name="sidebar">
          <el-menu
            :default-active="$route.path"
            router
            class="side-menu"
          >
            <el-menu-item index="/">
              <el-icon><HomeFilled /></el-icon>
              <span>首页</span>
            </el-menu-item>
            <el-menu-item index="/admin" v-if="auth.isAdmin">
              <el-icon><Setting /></el-icon>
              <span>系统管理</span>
            </el-menu-item>
          </el-menu>
        </slot>
      </el-aside>
      <el-main class="layout-main">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { HomeFilled, Setting } from '@element-plus/icons-vue'

withDefaults(defineProps<{
  title?: string
  showSidebar?: boolean
}>(), {
  title: 'Workload Evaluation',
  showSidebar: true,
})

const auth = useAuthStore()
const router = useRouter()

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.app-layout {
  height: 100vh;
}

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 24px;
}

.brand-title {
  font-size: 18px;
  font-weight: 600;
  color: #409eff;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.username {
  font-size: 14px;
  color: #606266;
}

.role-tag {
  text-transform: uppercase;
}

.layout-body {
  height: calc(100vh - 60px);
}

.layout-aside {
  background-color: #fff;
  border-right: 1px solid #e4e7ed;
}

.side-menu {
  border-right: none;
  height: 100%;
}

.layout-main {
  background-color: #f5f7fa;
  padding: 20px;
  overflow-y: auto;
}
</style>
