"use client"

import { motion } from "framer-motion"
import { Check, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

const showcaseItems = [
  {
    title: "更快的迭代",
    subtitle: "更多的创新",
    description: "让您的团队专注于发布功能，而不是管理基础设施。通过自动化 CI/CD、内置测试和集成协作功能，加速产品迭代。",
    features: [
      "自动化部署流水线",
      "实时预览环境",
      "A/B 测试内置支持",
      "回滚一键操作",
    ],
  },
  {
    title: "团队协作",
    subtitle: "无缝衔接",
    description: "为您的团队和利益相关者提供工具，让他们能够分享反馈、快速迭代，打破信息孤岛。",
    features: [
      "实时协作编辑",
      "评论与任务关联",
      "智能通知系统",
      "跨团队项目视图",
    ],
  },
]

export function ProductShowcase() {
  return (
    <section id="products" className="py-24 sm:py-32 border-t border-border">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-sm font-medium text-accent mb-4"
          >
            产品展示
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-balance"
          >
            构建下一代产品的
            <br />
            完整平台
          </motion.h2>
        </div>

        {/* Showcase Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {showcaseItems.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              className="rounded-3xl border border-border bg-card overflow-hidden"
            >
              {/* Mock UI Preview */}
              <div className="h-64 bg-secondary/30 relative overflow-hidden">
                <div className="absolute inset-4 rounded-lg bg-background/50 border border-border backdrop-blur-sm">
                  <div className="flex items-center gap-2 p-3 border-b border-border">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-destructive/60" />
                      <div className="w-3 h-3 rounded-full bg-accent/40" />
                      <div className="w-3 h-3 rounded-full bg-accent/60" />
                    </div>
                    <div className="flex-1 h-5 bg-secondary/50 rounded-md mx-8" />
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-secondary/50 rounded w-3/4" />
                    <div className="h-4 bg-secondary/50 rounded w-1/2" />
                    <div className="h-20 bg-secondary/30 rounded-lg mt-4" />
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-8">
                <p className="text-sm text-accent mb-2">{item.subtitle}</p>
                <h3 className="text-2xl font-semibold mb-4">{item.title}</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  {item.description}
                </p>
                <ul className="space-y-3 mb-6">
                  {item.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm">
                      <Check className="h-4 w-4 text-accent flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" className="gap-2 p-0 h-auto hover:bg-transparent hover:text-accent">
                  了解更多
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
