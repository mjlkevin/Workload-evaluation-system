"use client"

import { motion } from "framer-motion"
import { 
  Zap, 
  Shield, 
  Layers, 
  BarChart3, 
  Globe, 
  Lock,
  Workflow,
  Users
} from "lucide-react"

const features = [
  {
    icon: Zap,
    title: "闪电般的速度",
    description: "基于边缘计算的全球分布式架构，毫秒级响应，让您的工作流始终保持高效运转。",
  },
  {
    icon: Shield,
    title: "企业级安全",
    description: "SOC 2 Type II 认证，端到端加密，GDPR 合规。您的数据安全是我们的首要任务。",
  },
  {
    icon: Layers,
    title: "无缝集成",
    description: "与 200+ 主流工具深度集成，包括 Slack、GitHub、Notion 等，一站式管理所有工作流。",
  },
  {
    icon: BarChart3,
    title: "智能分析",
    description: "AI 驱动的数据洞察，实时监控团队效率，识别瓶颈，提供优化建议。",
  },
  {
    icon: Workflow,
    title: "可视化工作流",
    description: "拖拽式流程设计器，无需代码即可创建复杂的自动化工作流，降低使用门槛。",
  },
  {
    icon: Users,
    title: "团队协作",
    description: "实时协作编辑，任务分配追踪，评论反馈系统，让团队沟通更加顺畅。",
  },
  {
    icon: Globe,
    title: "全球部署",
    description: "一键部署至全球 30+ 数据中心，自动选择最优节点，确保全球用户的极致体验。",
  },
  {
    icon: Lock,
    title: "精细权限",
    description: "基于角色的访问控制，审计日志，SSO 单点登录，满足企业合规要求。",
  },
]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
}

export function Features() {
  return (
    <section id="features" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-sm font-medium text-accent mb-4"
          >
            功能特性
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-balance"
          >
            为现代团队打造的
            <br />
            全方位解决方案
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-lg text-muted-foreground text-balance"
          >
            从个人到企业，我们提供灵活可扩展的工具，帮助您的团队更快地交付价值。
          </motion.p>
        </div>

        {/* Features Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className="group relative rounded-2xl border border-border bg-card p-6 hover:bg-secondary/50 transition-colors duration-300"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-medium">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
