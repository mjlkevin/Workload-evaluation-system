"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function RequirementImportListPage() {
  return (
    <ModuleDocListPage
      moduleType="requirementImport"
      title="需求单据列表"
      description="展示当前用户在需求模块下的最新单据，可进行预览、修改、删除和查看历史版本。"
      editorPath="/dashboard/requirement-import"
      breadcrumbs={[
        { label: "需求", href: "/dashboard/requirement-import" },
        { label: "列表" },
      ]}
    />
  )
}

