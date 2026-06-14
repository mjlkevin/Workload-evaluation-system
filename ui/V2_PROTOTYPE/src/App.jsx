import React from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
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

function Layout({ children }) {
  const location = useLocation()
  const isLogin = location.pathname === '/login'
  if (isLogin) return children
  return <Shell>{children}</Shell>
}

export default function App() {
  return (
    <Layout>
      <Routes>
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
        <Route path="/system" element={<SystemManagement />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/api-keys" element={<ApiKeys />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </Layout>
  )
}
