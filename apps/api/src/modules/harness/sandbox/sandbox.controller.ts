import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../../db/client";
import { harnessSandboxConnections } from "../../../db/schema";
import {
  getApiKey,
  setApiKey,
  rotateApiKey,
  clearApiKey,
} from "../../system/credentials.store";
import {
  sandboxStore,
  sandboxProvider,
  readSandboxArtifact,
} from "./sandbox.module";
import { SANDBOX_HTML_CSP } from "./sandbox-artifacts";
import { SANDBOX_CREDENTIAL_SCOPE } from "./sandbox.repository";
import { SandboxError } from "./sandbox.types";
import type { SandboxConnection } from "../../../services/sandbox/sandbox-provider";
export function sandboxRouteError(res: Response, cause: unknown) {
  const known = cause instanceof SandboxError;
  res
    .status(known ? cause.status : 503)
    .json({
      code: known ? cause.code : "SANDBOX_UNAVAILABLE",
      message: known ? cause.message : "沙箱暂不可用，请联系管理员",
      data: null,
    });
}
export async function getSandboxConnection(_req: Request, res: Response) {
  try {
    const [row] = await db
      .select()
      .from(harnessSandboxConnections)
      .where(eq(harnessSandboxConnections.id, "default"));
    const { apiKey, keyVersion } = await getApiKey(SANDBOX_CREDENTIAL_SCOPE);
    res.json({
      code: 0,
      message: "ok",
      data: {
        connection: row?.configuration ?? null,
        hasApiKey: !!apiKey,
        keyVersion,
      },
    });
  } catch (e) {
    sandboxRouteError(res, e);
  }
}
export async function putSandboxConnection(req: Request, res: Response) {
  try {
    const body = req.body;
    if (
      !body ||
      Object.keys(body).some(
        (k) => !["connection", "apiKey", "clearApiKey"].includes(k),
      )
    )
      throw new SandboxError("SANDBOX_CONFIG_INVALID", "连接配置无效");
    const c = body.connection as SandboxConnection;
    if (
      !c ||
      Object.keys(c).sort().join(",") !==
        "aliyunUid,enabled,id,region,templateCode,templateRevision,workspaceId" ||
      c.id !== "default" ||
      typeof c.enabled !== "boolean" ||
      typeof c.workspaceId !== "string" ||
      !/^llm-[a-z0-9-]{1,80}$/.test(c.workspaceId) ||
      c.region !== "cn-beijing" ||
      typeof c.aliyunUid !== "string" ||
      !/^\d{6,30}$/.test(c.aliyunUid) ||
      typeof c.templateCode !== "string" ||
      !/^[a-zA-Z0-9-]{1,160}$/.test(c.templateCode) ||
      typeof c.templateRevision !== "string" ||
      !c.templateRevision ||
      c.templateRevision.length > 160
    )
      throw new SandboxError(
        "SANDBOX_CONFIG_INVALID",
        "请填写北京地域、业务空间、模板及构建版本",
      );
    if (
      body.apiKey !== undefined &&
      (typeof body.apiKey !== "string" ||
        !/^sk-[A-Za-z0-9._-]{8,1024}$/.test(body.apiKey))
    )
      throw new SandboxError("SANDBOX_CONFIG_INVALID", "API密钥格式无效");
    if (body.apiKey && body.clearApiKey)
      throw new SandboxError(
        "SANDBOX_CONFIG_INVALID",
        "密钥写入与清除不能同时提交",
      );
    if (body.apiKey) {
      const old = await getApiKey(SANDBOX_CREDENTIAL_SCOPE);
      if (old.apiKey)
        await rotateApiKey(SANDBOX_CREDENTIAL_SCOPE, body.apiKey, req.user!.id);
      else await setApiKey(SANDBOX_CREDENTIAL_SCOPE, body.apiKey, req.user!.id);
    }
    if (body.clearApiKey === true)
      await clearApiKey(SANDBOX_CREDENTIAL_SCOPE, req.user!.id);
    if (c.enabled && !(await getApiKey(SANDBOX_CREDENTIAL_SCOPE)).apiKey)
      throw new SandboxError(
        "SANDBOX_CONFIG_INVALID",
        "启用沙箱前请配置独立按量付费API密钥",
      );
    await db
      .insert(harnessSandboxConnections)
      .values({ id: "default", configuration: c })
      .onConflictDoUpdate({
        target: harnessSandboxConnections.id,
        set: { configuration: c, updatedAt: new Date() },
      });
    await getSandboxConnection(req, res);
  } catch (e) {
    sandboxRouteError(res, e);
  }
}
export async function testSandboxConnection(_req: Request, res: Response) {
  try {
    await (await sandboxProvider()).verifyTemplate();
    res.json({
      code: 0,
      message: "模板与连接检查通过，未创建实例",
      data: { ready: true },
    });
  } catch (e) {
    sandboxRouteError(res, e);
  }
}
export async function downloadSandboxArtifact(req: Request, res: Response) {
  try {
    const a = await readSandboxArtifact(
      String(req.params.artifactId),
      req.user!.id,
    );
    const bytes = await sandboxStore.read(a.id);
    if (
      bytes.length !== a.size ||
      createHash("sha256").update(bytes).digest("hex") !== a.sha256
    )
      throw new SandboxError(
        "SANDBOX_FILE_CORRUPT",
        "文件校验失败，暂不可下载",
        409,
      );
    const preview = req.path.endsWith("/preview");
    if (preview && a.format !== "html")
      throw new SandboxError("SANDBOX_PREVIEW_INVALID", "此文件仅支持下载");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", a.mimeType);
    res.setHeader(
      "Content-Disposition",
      `${preview ? "inline" : "attachment"}; filename="${a.name}"`,
    );
    res.setHeader("Content-Security-Policy", SANDBOX_HTML_CSP);
    res.setHeader("Referrer-Policy", "no-referrer");
    // Prefix the policy before every untrusted byte, including comments containing fake head tags.
    const body = preview
      ? Buffer.from(
          `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_HTML_CSP.replace(/"/g, "&quot;")}">` +
            bytes.toString("utf8"),
        )
      : bytes;
    res.send(body);
  } catch (e) {
    sandboxRouteError(res, e);
  }
}
