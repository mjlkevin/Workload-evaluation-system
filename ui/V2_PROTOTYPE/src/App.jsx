import React, { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Shell from './components/Layout/Shell.jsx'
import ToastContainer from './components/ui/ToastContainer.jsx'
import { ToastProvider } from './hooks/useToast.jsx'
// 前端插批（项三）：首屏必需路径保持 eager（懒加载反增往返）：
// Login / ResetPassword（未登录首屏）、HomePage（登录后默认落地页，
// 含 AI 工作台）、ProtectedLayout 与 Shell（布局骨架）。
import HomePage from './pages/HomePage.jsx'
import Login from './pages/Login.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
// 前端插批（项三）：其余 18 个路由页面改为路由级懒加载，
// 配合 vite manualChunks 切分，登录页不再下载整个应用
const TraditionalHomeDashboard = lazy(() => import('./pages/TraditionalHomeDashboard.jsx'))
const AssessmentList = lazy(() => import('./pages/AssessmentList.jsx'))
const AssessmentDetail = lazy(() => import('./pages/AssessmentDetail.jsx'))
const RequirementList = lazy(() => import('./pages/RequirementList.jsx'))
const RequirementDetail = lazy(() => import('./pages/RequirementDetail.jsx'))
const RequirementAiWorkbench = lazy(() => import('./pages/RequirementAiWorkbench.jsx'))
const DevAssessmentList = lazy(() => import('./pages/DevAssessmentList.jsx'))
const DevAssessmentDetail = lazy(() => import('./pages/DevAssessmentDetail.jsx'))
const ResourceCostList = lazy(() => import('./pages/ResourceCostList.jsx'))
const ResourceCostDetail = lazy(() => import('./pages/ResourceCostDetail.jsx'))
const ReviewList = lazy(() => import('./pages/ReviewList.jsx'))
const ReviewDetail = lazy(() => import('./pages/ReviewDetail.jsx'))
const WbsList = lazy(() => import('./pages/WbsList.jsx'))
const HistoryList = lazy(() => import('./pages/HistoryList.jsx'))
const HistoryDetail = lazy(() => import('./pages/HistoryDetail.jsx'))
const SystemManagement = lazy(() => import('./pages/SystemManagement.jsx'))
const UserManagement = lazy(() => import('./pages/UserManagement.jsx'))
const ApiKeys = lazy(() => import('./pages/ApiKeys.jsx'))
import { isAuthenticated } from './api/auth.js'
import { DEFAULT_SYSTEM_MANAGEMENT_ROUTE, SYSTEM_MANAGEMENT_PARENT_ROUTE, SYSTEM_MANAGEMENT_SECTIONS } from './config/systemManagementSections.js'
import useCurrentUser from './hooks/useCurrentUser.js'
import { isAdminOnlyPath, isAdminUser } from './utils/adminAccess.js'

function ProtectedLayout() {
  const location = useLocation()
  const authenticated = isAuthenticated()
  const { user, loading, error } = useCurrentUser({ enabled: authenticated })

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (loading) {
    return <div role="status" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>正在验证登录状态...</div>
  }
  if (error || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (isAdminOnlyPath(location.pathname) && !isAdminUser(user)) {
    return <Navigate to="/" replace />
  }

  return (
    <Shell currentUser={user}>
      {/* 前端插批（项三）：懒加载页面的统一加载态（Shell 骨架已可见） */}
      <Suspense fallback={(
        <div role="status" style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
          页面加载中…
        </div>
      )}
      >
        <Outlet />
      </Suspense>
    </Shell>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ToastContainer />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects" element={<TraditionalHomeDashboard />} />
        <Route path="/assessments" element={<AssessmentList />} />
        <Route path="/assessments/:id" element={<AssessmentDetail />} />
        <Route path="/requirements" element={<RequirementList />} />
        <Route path="/requirements/:id" element={<RequirementDetail />} />
        <Route path="/requirements/:id/ai-evaluation" element={<RequirementAiWorkbench />} />
        <Route path="/dev-assessments" element={<DevAssessmentList />} />
        <Route path="/dev-assessments/:id" element={<DevAssessmentDetail />} />
        <Route path="/resource-costs" element={<ResourceCostList />} />
        <Route path="/resource-costs/:id" element={<ResourceCostDetail />} />
        <Route path="/reviews" element={<ReviewList />} />
        <Route path="/reviews/:id" element={<ReviewDetail />} />
        <Route path="/wbs" element={<WbsList />} />
        <Route path="/history" element={<HistoryList />} />
        <Route path="/history/:id" element={<HistoryDetail />} />
        <Route path={SYSTEM_MANAGEMENT_PARENT_ROUTE} element={<Navigate to={DEFAULT_SYSTEM_MANAGEMENT_ROUTE} replace />} />
        {SYSTEM_MANAGEMENT_SECTIONS.map((section) => (
          <Route
            key={section.id}
            path={section.route}
            element={<SystemManagement sectionId={section.id} />}
          />
        ))}
        <Route path="/users" element={<UserManagement />} />
        <Route path="/api-keys" element={<ApiKeys />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </ToastProvider>
  )
}
