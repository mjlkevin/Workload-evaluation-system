"use client"

import { Button } from "@/components/ui/button"
import { ArrowRight, Play } from "lucide-react"
import { motion } from "framer-motion"

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/5 via-background to-background" />
      
      <div className="relative mx-auto max-w-7xl px-6 py-24 text-center">
        {/* Announcement Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-sm mb-8"
        >
          <span className="flex h-2 w-2 rounded-full bg-accent" />
          <span className="text-muted-foreground">全新发布</span>
          <span className="text-foreground">Nova 2.0 正式上线</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
        </motion.div>

        {/* Main Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-balance max-w-4xl mx-auto"
        >
          全新一代
          <br />
          <span className="text-accent">智能工作流平台</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto text-balance"
        >
          通过 AI 驱动的自动化工具，让您的团队专注于创造性工作。
          <br className="hidden sm:block" />
          安全构建、快速部署、无限扩展。
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button size="lg" className="rounded-full px-8 gap-2 text-base">
            免费开始
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="lg" className="rounded-full px-8 gap-2 text-base">
            <Play className="h-4 w-4" />
            观看演示
          </Button>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-border pt-10"
        >
          {[
            { value: "10K+", label: "活跃团队" },
            { value: "99.9%", label: "可用性保证" },
            { value: "50M+", label: "任务处理" },
            { value: "150+", label: "国家覆盖" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl sm:text-4xl font-semibold tracking-tight">{stat.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
