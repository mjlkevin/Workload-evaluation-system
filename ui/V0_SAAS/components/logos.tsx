"use client"

import { motion } from "framer-motion"

const logos = [
  { name: "TechCorp", text: "TechCorp" },
  { name: "InnovateLab", text: "InnovateLab" },
  { name: "CloudFlow", text: "CloudFlow" },
  { name: "DataSync", text: "DataSync" },
  { name: "ScaleUp", text: "ScaleUp" },
]

export function Logos() {
  return (
    <section className="py-16 border-t border-border">
      <div className="mx-auto max-w-7xl px-6">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-sm text-muted-foreground mb-10"
        >
          深受全球领先企业信赖
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8"
        >
          {logos.map((logo) => (
            <div
              key={logo.name}
              className="text-xl sm:text-2xl font-semibold text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {logo.text}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
