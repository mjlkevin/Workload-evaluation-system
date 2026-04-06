"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function WbsListPage() {
  return (
    <ModuleDocListPage
      moduleType="wbs"
      title="WBS单据列表"
      description="展示当前用户在WBS模块下的单据列表，可进行预览、修改；历史版本能力暂不支持。"
      editorPath="/dashboard/wbs"
      breadcrumbs={[
        { label: "WBS", href: "/dashboard/wbs" },
        { label: "列表" },
      ]}
    />
  )
}

