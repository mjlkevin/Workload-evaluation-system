import { createHash } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { harnessSandboxConnections } from "../../../db/schema";
import { LocalSandboxArtifactStore } from "./sandbox-artifacts";
import { createBailianSandboxProvider } from "../../../services/sandbox/bailian-provider";
import { getApiKey } from "../../system/credentials.store";
import {
  createSandboxRepository,
  SANDBOX_CREDENTIAL_SCOPE,
} from "./sandbox.repository";
import { createSandboxService, sandboxHash } from "./sandbox.service";
import { SandboxError } from "./sandbox.types";
import type { SandboxConnection } from "../../../services/sandbox/sandbox-provider";
export const sandboxStoreRoot = path.resolve(
  process.env.WES_SANDBOX_ARTIFACT_DIR ||
    path.join(process.cwd(), "config", "private-sandbox-artifacts"),
);
export const sandboxStore = new LocalSandboxArtifactStore(sandboxStoreRoot);
export async function sandboxProvider(expectedConnectionHash?: string) {
  const [record] = await db
    .select()
    .from(harnessSandboxConnections)
    .where(eq(harnessSandboxConnections.id, "default"));
  const key = await getApiKey(SANDBOX_CREDENTIAL_SCOPE);
  const connection = record?.configuration as SandboxConnection | undefined;
  if (!connection?.enabled || !key.apiKey)
    throw new SandboxError(
      "SANDBOX_NOT_CONFIGURED",
      "沙箱连接尚未启用，请联系管理员",
      503,
    );
  if (
    expectedConnectionHash &&
    sandboxHash({
      connection,
      keyVersion: key.keyVersion,
      credentialFingerprint: createHash("sha256")
        .update(key.apiKey)
        .digest("hex"),
    }) !== expectedConnectionHash
  )
    throw new SandboxError(
      "SANDBOX_CONFIG_CHANGED",
      "连接配置或凭据版本已变化，请重新确认",
      409,
    );
  return createBailianSandboxProvider(structuredClone(connection), key.apiKey);
}
export const sandboxService = createSandboxService({
  repository: createSandboxRepository(sandboxStore),
  provider: sandboxProvider,
  store: sandboxStore,
});
export {
  sandboxSourceCatalog,
  readSandboxArtifact,
} from "./sandbox.repository";
export { SandboxError } from "./sandbox.types";
