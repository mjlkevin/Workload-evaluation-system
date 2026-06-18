"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function DevAssessmentListPage() {
  return (
    <ModuleDocListPage
      moduleType="dev"
      title="开发评估单据列表"
      editorPath="/dashboard/dev-assessment"
      breadcrumbs={[
        { label: "开发评估", href: "/dashboard/dev-assessment" },
        { label: "列表" },
      ]}
    />
  )
}

