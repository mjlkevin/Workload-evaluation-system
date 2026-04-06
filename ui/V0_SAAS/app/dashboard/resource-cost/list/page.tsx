"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function ResourceCostListPage() {
  return (
    <ModuleDocListPage
      moduleType="resource"
      title="资源人天及成本单据列表"
      description="展示当前用户在资源人天及成本模块下的最新单据，可进行预览、修改、删除和查看历史版本。"
      editorPath="/dashboard/resource-cost"
      breadcrumbs={[
        { label: "资源人天及成本", href: "/dashboard/resource-cost" },
        { label: "列表" },
      ]}
    />
  )
}

