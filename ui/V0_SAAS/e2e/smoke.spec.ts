import { test, expect } from "@playwright/test"

test.describe("主路径冒烟", () => {
  test("登录页渲染表单", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByText("WorkEvolutionSys")).toBeVisible()
    await expect(page.getByRole("heading", { name: "登录系统" })).toBeVisible()
    await expect(page.getByLabel("用户名")).toBeVisible()
    await expect(page.getByLabel("密码")).toBeVisible()
  })

  test("API 健康检查（需 API + Next 均已启动，并设置 E2E_WITH_API=1）", async ({ request }) => {
    test.skip(!process.env.E2E_WITH_API, "默认跳过；联调时 export E2E_WITH_API=1")
    const res = await request.get("/api/v1/health")
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { code?: number }
    expect(body.code).toBe(0)
  })
})
