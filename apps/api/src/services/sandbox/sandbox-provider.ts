/** Server-owned cloud boundary. Neither credentials nor SDK handles cross this interface. */
export interface SandboxConnection {
  id: string;
  workspaceId: string;
  region: string;
  templateCode: string;
  templateRevision: string;
  aliyunUid: string;
  enabled: boolean;
}

export interface SandboxInstance {
  id: string;
  writeFile(relativePath: string, bytes: Uint8Array): Promise<void>;
  execute(language: 'python' | 'node', code: string, timeoutMs: number, signal?: AbortSignal): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readOutput(relativePath: string, maxBytes: number): Promise<Buffer>;
  release(): Promise<void>;
}

export interface SandboxProvider {
  verifyTemplate(): Promise<void>;
  create(jobId: string, ttlSeconds: number): Promise<SandboxInstance>;
  /** Caller must first establish ownership from its durable managed job record. */
  connect(sandboxId: string): Promise<SandboxInstance>;
}

export const SANDBOX_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const SANDBOX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertSandboxRelativePath(path: string): void {
  if (typeof path !== 'string' || path.length > 240 || !path || !path.split('/').every(p => /^[a-zA-Z0-9_\-.\u4e00-\u9fff ]{1,100}$/.test(p) && p !== '.' && p !== '..')) throw new Error('SANDBOX_INVALID_PATH');
}
