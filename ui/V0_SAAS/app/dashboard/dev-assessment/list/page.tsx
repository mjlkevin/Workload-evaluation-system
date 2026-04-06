"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function DevAssessmentListPage() {
  return (
    <ModuleDocListPage
      moduleType="dev"
      title="开发评估单据列表"
      description="展示当前用户在开发评估模块下的最新单据，可进行预览、修改、删除和查看历史版本。"
      editorPath="/dashboard/dev-assessment"
      breadcrumbs={[
        { label: "开发评估", href: "/dashboard/dev-assessment" },
        { label: "列表" },
      ]}
    />
  )
}

