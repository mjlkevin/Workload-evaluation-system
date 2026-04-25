// ============================================================
// Express 应用配置 - 负责组装中间件和路由
// ============================================================

import express, { Express } from "express";
import multer from "multer";

import { config } from "./config/env";
import routes from "./routes";
import { downloadFile } from "./modules/exports/exports.module";
import { errorHandler } from "./middleware";
import { bootstrapAiProviders } from "./ai/bootstrap";

function isPrivateNetworkOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return false;
    const o = [1, 2, 3, 4].map((i) => Number(m[i]));
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 创建并配置 Express 应用
 */
export function createApp(): Express {
  // 注册 AI Provider（KimiProvider）—— 业务层从 defaultProviderRegistry 取用，
  // 不再直接 new。凭据每次请求级覆盖（credentialsOverride）。幂等。
  bootstrapAiProviders();

  const app = express();

  // 浏览器直连 API（:3000）时需 CORS。开发环境全开；生产环境仅对私网 Origin 反射，避免公网任意 Origin。
  const corsOpen = process.env.NODE_ENV !== "production";
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowOrigin =
      origin &&
      typeof origin === "string" &&
      (corsOpen || isPrivateNetworkOrigin(origin));
    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  // ========== 基础中间件 ==========
  // 默认 100kb 不足以承载「大模板 + itemSelection + serverResult」的版本保存体；超限会走 error-handler 表现为 500
  app.use(express.json({ limit: "5mb" }));
  
  // 文件上传配置
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.constants.MAX_FILE_SIZE },
  });
  
  // 将 multer 实例挂载到 app 供路由使用
  app.set("upload", upload);

  // ========== 文件下载 ==========
  // 下载必须经过鉴权与归属校验，不能直接暴露静态目录
  app.get("/downloads/:fileName", downloadFile);

  // ========== API 路由 ==========
  app.use("/api/v1", routes);

  // ========== 全局错误处理 ==========
  app.use(errorHandler);

  return app;
}

export { Express };
