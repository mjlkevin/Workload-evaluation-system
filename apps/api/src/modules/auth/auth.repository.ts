import fs from "node:fs";
import path from "node:path";

import { InviteCodesStore, PasswordResetTokensStore } from "../../types";
import { inviteCodesStorePath, passwordResetTokensStorePath } from "../../utils";

export function loadInviteCodesStore(): InviteCodesStore {
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

export function saveInviteCodesStore(store: InviteCodesStore): void {
  const filePath = inviteCodesStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}

export function loadPasswordResetTokensStore(): PasswordResetTokensStore {
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

export function savePasswordResetTokensStore(store: PasswordResetTokensStore): void {
  const filePath = passwordResetTokensStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
}
