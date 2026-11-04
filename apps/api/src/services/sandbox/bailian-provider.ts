import { randomUUID } from 'node:crypto';
import { assertSandboxRelativePath, SANDBOX_MAX_FILE_BYTES, SANDBOX_UUID, type SandboxConnection, type SandboxInstance, type SandboxProvider } from './sandbox-provider';

interface RemoteSandbox {
  sandboxId: string;
  files: { write(path: string, bytes: ArrayBuffer, opts?: { user: string }): Promise<unknown> };
  commands: { run(command: string, opts: { cwd?: string; user: string; timeoutMs: number; envs?: Record<string, string>; signal?: AbortSignal }): Promise<{ exitCode: number; stdout: string; stderr: string }> };
  getInfo(): Promise<{ templateId: string; metadata: Record<string, string> }>;
  kill(): Promise<unknown>;
}
export interface BailianProviderDependencies {
  fetch?: typeof fetch;
  sdk?: {
    create(template: string, opts: Record<string, unknown>): Promise<RemoteSandbox>;
    connect(id: string, opts: Record<string, unknown>): Promise<RemoteSandbox>;
  };
}

// These scripts are authored by the server and execute ONLY in the cloud. Values
// enter through envs, never shell interpolation. Untrusted code runs as `user`;
// root-owned staging and sticky work directories protect subsequent script writes.
const BOOTSTRAP = `import os
r=os.environ["WES_ROOT"]
os.mkdir(r,0o711)
os.mkdir(r+"/staging",0o700)
os.mkdir(r+"/work",0o1777)
os.chmod(r+"/work",0o1777)
`;
const OPEN_PARENT = `import os,stat,base64
r=os.environ["WES_ROOT"]
parts=os.environ["WES_PATH"].split("/")
fd=os.open(r+"/work",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
for p in parts[:-1]:
 fd2=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
 os.close(fd)
 fd=fd2
`;
const WRITE_INPUT = OPEN_PARENT + `src=os.open(r+"/staging/"+os.environ["WES_UPLOAD"],os.O_RDONLY|os.O_NOFOLLOW)
s=os.fstat(src)
if not stat.S_ISREG(s.st_mode) or s.st_size>20971520: raise ValueError("invalid")
tmp=".wes-"+os.environ["WES_UPLOAD"]
out=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444,dir_fd=fd)
while True:
 b=os.read(src,65536)
 if not b: break
 os.write(out,b)
os.close(out)
os.close(src)
os.rename(tmp,parts[-1],src_dir_fd=fd,dst_dir_fd=fd)
os.unlink(r+"/staging/"+os.environ["WES_UPLOAD"])
os.close(fd)
`;
const READ_OUTPUT = OPEN_PARENT + `f=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
s=os.fstat(f)
n=int(os.environ["WES_MAX"])
if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>n: raise ValueError("invalid")
b=b""
while len(b)<=n:
 c=os.read(f,min(65536,n+1-len(b)))
 if not c: break
 b+=c
if len(b)>n: raise ValueError("invalid")
print(base64.b64encode(b).decode("ascii"),end="")
os.close(f)
os.close(fd)
`;
const helperCommand = (script: string) => "python -I -c '" + script.replace(/'/g, "'\"'\"'") + "'";

export function createBailianSandboxProvider(connection: SandboxConnection, apiKey: string, deps: BailianProviderDependencies = {}): SandboxProvider {
  // Never accept endpoints or credential-bearing strings from model arguments.
  if (!connection.enabled || !/^[a-zA-Z0-9-]+$/.test(connection.workspaceId) || !/^cn-[a-z0-9-]+$/.test(connection.region) || !/^[0-9a-f]+$/.test(connection.aliyunUid) || !/^[a-zA-Z0-9_-]+$/.test(connection.templateCode) || !connection.id || !connection.templateRevision || !apiKey || /[\r\n]/.test(apiKey)) throw new Error('SANDBOX_CONNECTION_INVALID');
  const config = { ...connection };
  const baseUrl = `https://${config.workspaceId}.${config.region}.maas.aliyuncs.com/api/v1/agentstudio/sandbox`;
  const options = { apiUrl: baseUrl, apiKey: `e2b_${config.aliyunUid}`, apiHeaders: { Authorization: `Bearer ${apiKey}` }, requestTimeoutMs: 15000 };
  const sdk: NonNullable<BailianProviderDependencies['sdk']> = deps.sdk ?? {
    create: async (template, opts) => { const { Sandbox } = await import('e2b'); return Sandbox.create(template, opts); },
    connect: async (id, opts) => { const { Sandbox } = await import('e2b'); return Sandbox.connect(id, opts); },
  };
  const fetcher = deps.fetch ?? fetch;
  const safeText = (value: string) => Buffer.from(value.split(apiKey).join('[redacted]').replace(/(?:Bearer\s+|(?:envd|traffic)[-_ ]?(?:access[-_ ]?)?token[=: ]+)[^\s]+/gi, '[redacted]')).subarray(0, 16384).toString('utf8');

  async function verifyTemplate(): Promise<void> {
    try {
      const response = await fetcher(`${baseUrl}/templates/${encodeURIComponent(config.templateCode)}`, { headers: options.apiHeaders, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const template = await response.json() as Record<string, any>;
      // `builds` is documented as the CURRENT version's builds. Ambiguity fails
      // closed: an older ready build anywhere in history is not sufficient.
      const network = template.networkConfig;
      if (template.templateID !== config.templateCode || !Array.isArray(template.builds) || template.builds.length !== 1 || template.builds[0].buildID !== config.templateRevision || template.builds[0].status !== 'ready' || !template.envConfig || typeof template.envConfig !== 'object' || Array.isArray(template.envConfig) || Object.keys(template.envConfig).length !== 0 || !Array.isArray(template.mntConfig) || template.mntConfig.length !== 0 || !network || !Array.isArray(network.allowOut) || network.allowOut.length !== 0 || !Array.isArray(network.denyOut) || !network.denyOut.includes('0.0.0.0/0') || !network.denyOut.includes('::/0')) throw new Error();
    } catch { throw new Error('SANDBOX_TEMPLATE_UNVERIFIED'); }
  }

  function wrap(sandbox: RemoteSandbox, jobId: string): SandboxInstance {
    const root = `/tmp/wes-job-${jobId}`;
    let released = false;
    let running = false;
    let releasePending: Promise<void> | undefined;
    const requireActive = () => { if (released) throw new Error('SANDBOX_RELEASED'); };
    const helper = async (script: string, envs: Record<string, string>) => {
      const result = await sandbox.commands.run(helperCommand(script), { user: 'root', timeoutMs: 15000, envs: { WES_ROOT: root, ...envs } });
      if (result.exitCode !== 0) throw new Error('SANDBOX_FILE_OPERATION_FAILED');
      return result;
    };
    const writeInput = async (path: string, bytes: Uint8Array) => {
      const upload = randomUUID();
      await sandbox.files.write(`${root}/staging/${upload}`, Uint8Array.from(bytes).buffer, { user: 'root' });
      await helper(WRITE_INPUT, { WES_PATH: path, WES_UPLOAD: upload });
    };
    const instance: SandboxInstance = {
      id: sandbox.sandboxId,
      async writeFile(path, bytes) {
        requireActive(); assertSandboxRelativePath(path);
        if (bytes.byteLength > SANDBOX_MAX_FILE_BYTES) throw new Error('SANDBOX_FILE_TOO_LARGE');
        if (running) throw new Error('SANDBOX_BUSY');
        running = true;
        try { await writeInput(path, bytes); }
        catch { throw new Error('SANDBOX_FILE_OPERATION_FAILED'); }
        finally { running = false; }
      },
      async execute(language, code, timeoutMs, signal) {
        requireActive();
        if (signal?.aborted) { await instance.release().catch(() => undefined); throw new Error('SANDBOX_CANCELLED'); }
        if (language !== 'python' && language !== 'node') throw new Error('SANDBOX_LANGUAGE_INVALID');
        if (Buffer.byteLength(code, 'utf8') > 128 * 1024 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('SANDBOX_EXECUTION_INVALID');
        if (running) throw new Error('SANDBOX_BUSY');
        const entry = language === 'python' ? 'task.py' : 'task.mjs';
        const abort = () => { void instance.release().catch(() => undefined); };
        running = true;
        let dispatched = false;
        signal?.addEventListener('abort', abort, { once: true });
        try {
          await writeInput(entry, Buffer.from(code));
          if (signal?.aborted) throw new Error();
          dispatched = true;
          const result = await sandbox.commands.run(language === 'python' ? 'python task.py' : 'node task.mjs', { cwd: `${root}/work`, user: 'user', timeoutMs: Math.min(Math.floor(timeoutMs), 120000), envs: {}, signal });
          if (signal?.aborted) throw new Error();
          return { exitCode: result.exitCode, stdout: safeText(result.stdout), stderr: safeText(result.stderr) };
        } catch (error) {
          const result = error as { name?: string; exitCode?: number; stdout?: string; stderr?: string };
          if (!signal?.aborted && dispatched && result?.name === 'CommandExitError' && Number.isInteger(result.exitCode) && typeof result.stdout === 'string' && typeof result.stderr === 'string') return { exitCode: result.exitCode!, stdout: safeText(result.stdout), stderr: safeText(result.stderr) };
          throw new Error(signal?.aborted ? 'SANDBOX_CANCELLED' : 'SANDBOX_EXECUTION_UNKNOWN');
        }
        finally { running = false; signal?.removeEventListener('abort', abort); }
      },
      async readOutput(path, maxBytes) {
        requireActive(); assertSandboxRelativePath(path);
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > SANDBOX_MAX_FILE_BYTES || running) throw new Error('SANDBOX_OUTPUT_INVALID');
        running = true;
        try {
          const result = await helper(READ_OUTPUT, { WES_PATH: path, WES_MAX: String(maxBytes) });
          if (result.stdout.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.stdout)) throw new Error();
          const bytes = Buffer.from(result.stdout, 'base64');
          if (bytes.length > maxBytes) throw new Error();
          return bytes;
        } catch { throw new Error('SANDBOX_OUTPUT_INVALID'); }
        finally { running = false; }
      },
      async release() {
        if (released) return;
        if (!releasePending) releasePending = (async () => {
          try { await sandbox.kill(); released = true; }
          catch { throw new Error('SANDBOX_RELEASE_FAILED'); }
          finally { releasePending = undefined; }
        })();
        await releasePending;
      },
    };
    return instance;
  }

  return {
    verifyTemplate,
    async create(jobId, ttlSeconds) {
      if (!SANDBOX_UUID.test(jobId) || !Number.isFinite(ttlSeconds) || ttlSeconds < 1) throw new Error('SANDBOX_JOB_INVALID');
      await verifyTemplate();
      let sandbox: RemoteSandbox | undefined;
      try {
        sandbox = await sdk.create(config.templateCode, { ...options, timeoutMs: Math.min(Math.floor(ttlSeconds), 900) * 1000, envs: {}, metadata: { wesManaged: 'true', wesConnectionId: config.id, wesJobId: jobId, wesTemplateRevision: config.templateRevision }, allowInternetAccess: false });
        const result = await sandbox.commands.run(helperCommand(BOOTSTRAP), { user: 'root', timeoutMs: 15000, envs: { WES_ROOT: `/tmp/wes-job-${jobId}` } });
        if (result.exitCode !== 0) throw new Error();
        return wrap(sandbox, jobId);
      } catch {
        // This handle was returned by our create call; never list/delete others.
        const error: Error & { managedSandboxId?: string } = new Error('SANDBOX_PROVISIONING_FAILED');
        if (sandbox) {
          try { await sandbox.kill(); }
          catch { error.managedSandboxId = sandbox.sandboxId; }
        }
        throw error;
      }
    },
    async connect(id) {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('SANDBOX_NOT_MANAGED');
      await verifyTemplate();
      try {
        const sandbox = await sdk.connect(id, options);
        const info = await sandbox.getInfo();
        if (sandbox.sandboxId !== id || info.templateId !== config.templateCode || info.metadata.wesManaged !== 'true' || info.metadata.wesConnectionId !== config.id || info.metadata.wesTemplateRevision !== config.templateRevision || !SANDBOX_UUID.test(info.metadata.wesJobId)) throw new Error();
        return wrap(sandbox, info.metadata.wesJobId);
      } catch { throw new Error('SANDBOX_NOT_MANAGED'); }
    },
  };
}
