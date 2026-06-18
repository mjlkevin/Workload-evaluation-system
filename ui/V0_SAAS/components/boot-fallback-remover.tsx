"use client"

import { useEffect } from "react"

/** 移除根布局中的纯 HTML 占位层，避免在未水合或首包较慢时整页纯白。 */
export function BootFallbackRemover() {
  useEffect(() => {
    document.getElementById("wes-static-boot")?.remove()
  }, [])
  return null
}
