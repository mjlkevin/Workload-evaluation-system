"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function AssessmentListPage() {
  return (
    <ModuleDocListPage
      moduleType="assessment"
      title="实施评估单据列表"
      description="展示当前用户在实施评估模块下的最新单据，可进行预览、修改、删除和查看历史版本。"
      editorPath="/dashboard/assessment"
      breadcrumbs={[
        { label: "实施评估", href: "/dashboard/assessment" },
        { label: "列表" },
      ]}
    />
  )
}

