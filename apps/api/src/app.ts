// ============================================================
// Express 应用配置 - 负责组装中间件和路由
// ============================================================

import express, { Express } from "express";
import multer from "multer";

import { config } from "./config/env";
import routes from "./routes";
import { downloadFile } from "./modules/exports/exports.module";
import { errorHandler } from "./middleware";

/**
 * 创建并配置 Express 应用
 */
export function createApp(): Express {
  const app = express();

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
