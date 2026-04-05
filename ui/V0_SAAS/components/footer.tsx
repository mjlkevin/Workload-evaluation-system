import Link from "next/link"

const footerLinks = {
  product: {
    title: "产品",
    links: [
      { name: "功能", href: "#features" },
      { name: "定价", href: "#pricing" },
      { name: "更新日志", href: "#" },
      { name: "路线图", href: "#" },
    ],
  },
  resources: {
    title: "资源",
    links: [
      { name: "文档", href: "#" },
      { name: "API 参考", href: "#" },
      { name: "指南", href: "#" },
      { name: "博客", href: "#" },
    ],
  },
  company: {
    title: "公司",
    links: [
      { name: "关于我们", href: "#" },
      { name: "招聘", href: "#" },
      { name: "联系我们", href: "#" },
      { name: "媒体资源", href: "#" },
    ],
  },
  legal: {
    title: "法律",
    links: [
      { name: "隐私政策", href: "#" },
      { name: "服务条款", href: "#" },
      { name: "Cookie 政策", href: "#" },
    ],
  },
}

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Logo & Description */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
                <span className="text-accent-foreground font-bold text-sm">N</span>
              </div>
              <span className="text-lg font-semibold tracking-tight">Nova</span>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              全新一代智能工作流平台，让团队协作更高效、更智能。
            </p>
          </div>

          {/* Links */}
          {Object.values(footerLinks).map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-medium">{section.title}</h3>
              <ul className="mt-4 space-y-3">
                {section.links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 Nova. 保留所有权利。
          </p>
          <div className="flex items-center gap-6">
            <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Twitter
            </Link>
            <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              GitHub
            </Link>
            <Link href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Discord
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
