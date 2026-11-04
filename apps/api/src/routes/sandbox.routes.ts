import { Router } from "express";
import { requireAuthenticated, requireCapability } from "../rbac/middleware";
import {
  getSandboxConnection,
  putSandboxConnection,
  testSandboxConnection,
  downloadSandboxArtifact,
} from "../modules/harness/sandbox/sandbox.controller";
export function createSandboxRouter() {
  const router = Router();
  router.use("/system/sandbox-connections", requireAuthenticated());
  const admin = (req: any, res: any, next: any) => {
    if (req.user?.role !== "admin") {
      res
        .status(403)
        .json({
          code: "SANDBOX_ADMIN_REQUIRED",
          message: "仅管理员可配置沙箱",
          data: null,
        });
      return;
    }
    next();
  };
  router.get("/system/sandbox-connections", admin, getSandboxConnection);
  router.put("/system/sandbox-connections", admin, putSandboxConnection);
  router.post("/system/sandbox-connections/test", admin, testSandboxConnection);
  router.get(
    "/ai-artifacts/:artifactId/download",
    requireCapability("estimates:read"),
    downloadSandboxArtifact,
  );
  router.get(
    "/ai-artifacts/:artifactId/preview",
    requireCapability("estimates:read"),
    downloadSandboxArtifact,
  );
  return router;
}
