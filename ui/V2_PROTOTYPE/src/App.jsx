import React from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Shell from './components/Layout/Shell.jsx'
import HomePage from './pages/HomePage.jsx'
import AssessmentList from './pages/AssessmentList.jsx'
import AssessmentDetail from './pages/AssessmentDetail.jsx'
import RequirementList from './pages/RequirementList.jsx'
import RequirementDetail from './pages/RequirementDetail.jsx'
import RequirementAiWorkbench from './pages/RequirementAiWorkbench.jsx'
import DevAssessmentList from './pages/DevAssessmentList.jsx'
import DevAssessmentDetail from './pages/DevAssessmentDetail.jsx'
import ResourceCostList from './pages/ResourceCostList.jsx'
import ResourceCostDetail from './pages/ResourceCostDetail.jsx'
import ReviewList from './pages/ReviewList.jsx'
import ReviewDetail from './pages/ReviewDetail.jsx'
import WbsList from './pages/WbsList.jsx'
import HistoryList from './pages/HistoryList.jsx'
import HistoryDetail from './pages/HistoryDetail.jsx'
import SystemManagement from './pages/SystemManagement.jsx'
import UserManagement from './pages/UserManagement.jsx'
import ApiKeys from './pages/ApiKeys.jsx'
import Login from './pages/Login.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import { isAuthenticated } from './api/auth.js'
import { DEFAULT_SYSTEM_MANAGEMENT_ROUTE, SYSTEM_MANAGEMENT_SECTIONS } from './config/systemManagementSections.js'
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
      <Outlet />
    </Shell>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomePage />} />
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
        <Route path="/system" element={<Navigate to={DEFAULT_SYSTEM_MANAGEMENT_ROUTE} replace />} />
        {SYSTEM_MANAGEMENT_SECTIONS.map((section) => (
          <Route
            key={section.id}
            path={section.route}
            element={<SystemManagement sectionId={section.id} />}
          />
        ))}
        <Route path="/users" element={<UserManagement />} />
        <Route path="/api-keys" element={<ApiKeys />} />
      </Route>
    </Routes>
  )
}
