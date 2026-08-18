import fs from "node:fs";
import path from "node:path";

import { InviteCodesStore, PasswordResetTokensStore } from "../../types";
import { inviteCodesStorePath, passwordResetTokensStorePath } from "../../utils";

/**
 * 阶段 1 批 3：签名改 async（Promise<InviteCodesStore>），函数体一字未动。
 */
export async function loadInviteCodesStore(): Promise<InviteCodesStore> {
  const filePath = inviteCodesStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: InviteCodesStore = { codes: [] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as InviteCodesStore;
    if (!parsed || !Array.isArray(parsed.codes)) {
      return { codes: [] };
    }
    return { codes: parsed.codes };
  } catch {
    return { codes: [] };
  }
}

/**
 * 阶段 1 批 3：签名改 async（Promise<void>），函数体一字未动。
 */
export async function saveInviteCodesStore(store: InviteCodesStore): Promise<void> {
  const filePath = inviteCodesStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * 阶段 1 批 3：签名改 async（Promise<PasswordResetTokensStore>），函数体一字未动。
 */
export async function loadPasswordResetTokensStore(): Promise<PasswordResetTokensStore> {
  const filePath = passwordResetTokensStorePath();
  if (!fs.existsSync(filePath)) {
    const initStore: PasswordResetTokensStore = { tokens: [] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(initStore, null, 2), "utf-8");
    return initStore;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PasswordResetTokensStore;
    if (!parsed || !Array.isArray(parsed.tokens)) {
      return { tokens: [] };
    }
    return { tokens: parsed.tokens };
  } catch {
    return { tokens: [] };
  }
}

/**
 * 阶段 1 批 3：签名改 async（Promise<void>），函数体一字未动。
 */
export async function savePasswordResetTokensStore(store: PasswordResetTokensStore): Promise<void> {
  const filePath = passwordResetTokensStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}
