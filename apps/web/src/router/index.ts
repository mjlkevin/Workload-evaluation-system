import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'
import type { RouteRecordRaw } from 'vue-router'

export type AppRole = 'PRE_SALES' | 'PM' | 'PMO' | 'SALES' | 'DEV' | 'ADMIN'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/login.vue'),
    meta: { layout: 'blank', public: true },
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('@/pages/home.vue'),
    meta: { auth: true },
  },
  {
    path: '/presales',
    name: 'Presales',
    component: () => import('@/pages/presales/index.vue'),
    meta: { auth: true, roles: ['PRE_SALES', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/pm',
    name: 'PMWorkbench',
    component: () => import('@/pages/pm-workbench/index.vue'),
    meta: { auth: true, roles: ['PM', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/pm/handoff',
    name: 'PMHandoff',
    component: () => import('@/pages/pm-workbench/handoff.vue'),
    meta: { auth: true, roles: ['PM', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/pm/narrative',
    name: 'PMNarrative',
    component: () => import('@/pages/pm-workbench/narrative.vue'),
    meta: { auth: true, roles: ['PM', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/pm/deliverables',
    name: 'PMDeliverables',
    component: () => import('@/pages/pm-workbench/deliverables.vue'),
    meta: { auth: true, roles: ['PM', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/pm/review',
    name: 'PMReview',
    component: () => import('@/pages/pm-workbench/review.vue'),
    meta: { auth: true, roles: ['PM', 'PMO', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/pmo',
    name: 'PMO',
    component: () => import('@/pages/pmo/index.vue'),
    meta: { auth: true, roles: ['PMO', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/sales',
    name: 'Sales',
    component: () => import('@/pages/sales/index.vue'),
    meta: { auth: true, roles: ['SALES', 'ADMIN'] as AppRole[] },
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('@/pages/admin/index.vue'),
    meta: { auth: true, roles: ['ADMIN'] as AppRole[] },
  },
  {
    path: '/404',
    name: 'NotFound',
    component: () => import('@/pages/404.vue'),
    meta: { public: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'CatchAll',
    component: () => import('@/pages/404.vue'),
    meta: { public: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()

  // 公开页面直接放行
  if (to.meta.public) {
    return next()
  }

  // 需要登录但未登录 → 跳登录页
  if (to.meta.auth && !auth.isLoggedIn) {
    return next('/login')
  }

  // 需要特定角色
  const requiredRoles = to.meta.roles as AppRole[] | undefined
  if (requiredRoles && requiredRoles.length > 0) {
    if (!auth.hasAnyRole(requiredRoles)) {
      ElMessage.warning('权限不足，无法访问该页面')
      return next('/')
    }
  }

  next()
})

export default router
