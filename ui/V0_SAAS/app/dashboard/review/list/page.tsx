"use client"

import { ModuleDocListPage } from "@/components/workload/module-doc-list-page"

export default function ReviewListPage() {
  return (
    <ModuleDocListPage
      moduleType="review"
      title="评审单据列表"
      description="展示当前用户在评审模块下的单据列表，可进行预览、修改；历史版本能力暂不支持。"
      editorPath="/dashboard/review"
      breadcrumbs={[
        { label: "评审", href: "/dashboard/review" },
        { label: "列表" },
      ]}
    />
  )
}

