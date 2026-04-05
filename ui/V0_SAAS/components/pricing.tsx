"use client"

import { motion } from "framer-motion"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const plans = [
  {
    name: "免费版",
    price: "¥0",
    period: "/月",
    description: "适合个人探索和小型项目",
    features: [
      "最多 3 个项目",
      "1GB 存储空间",
      "基础分析报告",
      "社区支持",
      "GitHub 集成",
    ],
    cta: "开始使用",
    highlighted: false,
  },
  {
    name: "专业版",
    price: "¥99",
    period: "/月",
    description: "适合成长中的团队和专业用户",
    features: [
      "无限项目",
      "100GB 存储空间",
      "高级分析与报告",
      "优先邮件支持",
      "所有集成",
      "自定义域名",
      "API 访问",
    ],
    cta: "升级到专业版",
    highlighted: true,
    badge: "推荐",
  },
  {
    name: "团队版",
    price: "¥299",
    period: "/用户/月",
    description: "适合快速发展的团队协作",
    features: [
      "专业版全部功能",
      "无限存储空间",
      "团队协作工具",
      "角色权限管理",
      "审计日志",
      "SSO 单点登录",
      "专属客户成功经理",
    ],
    cta: "开始团队试用",
    highlighted: false,
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="py-24 sm:py-32 border-t border-border">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-sm mb-6"
          >
            <span className="flex h-2 w-2 rounded-full bg-accent" />
            <span>全新积分定价模式</span>
            <span className="text-muted-foreground">了解更多 →</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight"
          >
            套餐与定价
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-lg text-muted-foreground"
          >
            立即免费开始。升级解锁更多额度、功能和协作能力。
          </motion.p>
        </div>

        {/* Pricing Cards */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={cn(
                "relative rounded-2xl border p-8 flex flex-col",
                plan.highlighted
                  ? "border-accent bg-accent/5"
                  : "border-border bg-card"
              )}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-accent text-accent-foreground text-xs font-medium px-3 py-1 rounded-full">
                    {plan.badge}
                  </span>
                </div>
              )}

              <div>
                <h3 className="text-lg font-medium">{plan.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              <ul className="mt-8 space-y-4 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className={cn(
                      "h-4 w-4 mt-0.5 flex-shrink-0",
                      plan.highlighted ? "text-accent" : "text-muted-foreground"
                    )} />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                className={cn(
                  "mt-8 w-full rounded-full",
                  plan.highlighted
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {plan.cta}
              </Button>
            </motion.div>
          ))}
        </div>

        {/* Enterprise CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 rounded-2xl border border-border bg-card p-8 md:p-12"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h3 className="text-2xl font-semibold">企业版</h3>
              <p className="mt-2 text-muted-foreground max-w-xl">
                适合大型企业，需要额外的安全性、合规性和定制化支持。
                包含培训默认禁用、SAML SSO、优先性能保障和专属客户支持。
              </p>
            </div>
            <Button variant="outline" className="rounded-full px-8 flex-shrink-0">
              联系我们
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
