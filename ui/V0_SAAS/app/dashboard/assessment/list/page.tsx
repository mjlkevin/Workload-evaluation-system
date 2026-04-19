"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function AssessmentListPage() {
  return (
    <ModuleDocListPage
      moduleType="assessment"
      title="实施评估单据列表"
      editorPath="/dashboard/assessment"
      breadcrumbs={[
        { label: "实施评估", href: "/dashboard/assessment" },
        { label: "列表" },
      ]}
    />
  )
}

