// ============================================================
// AI Provider - 注册表
// ============================================================
// 作为全局单一访问入口，避免业务层直接 new KimiProvider。
// 未来接入多家厂商时，在启动阶段统一注册；业务层通过 name 取用。
//
// 约定：Provider 名称大小写不敏感，统一使用小写存储。

import type { ModelProvider } from "./model-provider";

export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  private defaultProviderName: string | undefined;

  register(provider: ModelProvider, options: { asDefault?: boolean } = {}): void {
    const key = normalizeName(provider.name);
    if (!key) {
      throw new Error("ProviderRegistry.register: provider.name 不能为空");
    }
    this.providers.set(key, provider);
    if (options.asDefault || this.defaultProviderName === undefined) {
      this.defaultProviderName = key;
    }
  }

  unregister(name: string): boolean {
    const key = normalizeName(name);
    const removed = this.providers.delete(key);
    if (removed && this.defaultProviderName === key) {
      const next = this.providers.keys().next();
      this.defaultProviderName = next.done ? undefined : next.value;
    }
    return removed;
  }

  get(name: string): ModelProvider | undefined {
    return this.providers.get(normalizeName(name));
  }

  getOrThrow(name: string): ModelProvider {
    const p = this.get(name);
    if (!p) throw new Error(`ProviderRegistry: 未找到 provider "${name}"`);
    return p;
  }

  getDefault(): ModelProvider | undefined {
    if (!this.defaultProviderName) return undefined;
    return this.providers.get(this.defaultProviderName);
  }

  list(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  listAvailable(): ModelProvider[] {
    return this.list().filter((p) => p.isAvailable());
  }

  has(name: string): boolean {
    return this.providers.has(normalizeName(name));
  }

  clear(): void {
    this.providers.clear();
    this.defaultProviderName = undefined;
  }
}

function normalizeName(name: string): string {
  return String(name || "").trim().toLowerCase();
}

/** 进程级默认注册表；绝大多数业务调用走这里 */
export const defaultProviderRegistry = new ProviderRegistry();
