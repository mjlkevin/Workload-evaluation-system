import { redirect } from "next/navigation"

/** 服务端重定向，避免仅客户端 replace 时在未执行 JS 或首包慢时像「打不开」 */
export default function HomePage() {
  redirect("/dashboard")
}
