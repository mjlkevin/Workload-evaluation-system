"use client"

import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export function CTA() {
  return (
    <section className="py-24 sm:py-32 border-t border-border">
      <div className="mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative rounded-3xl bg-accent/5 border border-accent/20 overflow-hidden"
        >
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

          <div className="relative px-8 py-16 sm:px-16 sm:py-24 text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-balance">
              准备好开启高效协作了吗？
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              加入数千个已经在使用 Nova 的团队，体验全新的工作方式。
              免费开始，随时升级。
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="rounded-full px-8 gap-2 text-base">
                免费开始
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="lg" className="rounded-full px-8 text-base">
                预约演示
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              无需信用卡 · 随时取消 · 14天免费试用专业版功能
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
