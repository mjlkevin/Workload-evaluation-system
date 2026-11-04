import test from 'node:test';
import assert from 'node:assert/strict';
import { createBailianSandboxProvider, type BailianProviderDependencies } from './bailian-provider';

const connection = { id: 'connection-1', workspaceId: 'workspace-1', region: 'cn-beijing', templateCode: 'template-1', templateRevision: 'build-1', aliyunUid: '123456', enabled: true };
const jobId = '00000000-0000-4000-8000-000000000001';
function fixture(metadata: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: any[] }> = [];
  let commandResult = { exitCode: 0, stdout: '', stderr: '' };
  const info = { metadata: { wesManaged: 'true', wesConnectionId: connection.id, wesJobId: jobId, wesTemplateRevision: connection.templateRevision }, templateId: connection.templateCode };
  const sandbox = {
    sandboxId: 'managed-1', getInfo: async () => info,
    files: { write: async (...args: any[]) => { calls.push({ name: 'write', args }); } },
    commands: { run: async (...args: any[]) => {
      calls.push({ name: 'run', args });
      if (args[1]?.envs?.WES_LANGUAGE) return { exitCode: 0, stdout: JSON.stringify({ exitCode: commandResult.exitCode, stdout: Buffer.from(commandResult.stdout).toString('base64'), stderr: Buffer.from(commandResult.stderr).toString('base64') }), stderr: '' };
      if (args[1]?.envs?.WES_UPLOAD) return { exitCode: 0, stdout: '', stderr: '' };
      return commandResult;
    } },
    kill: async () => { calls.push({ name: 'kill', args: [] }); return true; },
  };
  const template = { templateID: connection.templateCode, builds: [{ buildID: 'build-1', status: 'ready' }], envConfig: {}, mntConfig: [], networkConfig: { allowOut: [], denyOut: ['0.0.0.0/0', '::/0'] }, ...metadata };
  const deps: BailianProviderDependencies = {
    fetch: async (...args: any[]) => { calls.push({ name: 'fetch', args }); return { ok: true, json: async () => template } as Response; },
    sdk: { create: async (...args: any[]) => { calls.push({ name: 'create', args }); return sandbox; }, connect: async (...args: any[]) => { calls.push({ name: 'connect', args }); return sandbox; } },
  };
  return { provider: createBailianSandboxProvider(connection, 'private-key', deps), calls, sandbox, info, setResult: (r: typeof commandResult) => { commandResult = r; } };
}

test('template verification fails closed on missing network/env/mount proof and revision drift', async () => {
  for (const metadata of [ { networkConfig: undefined }, { envConfig: undefined }, { mntConfig: undefined }, { envConfig: { API_KEY: 'secret' } }, { mntConfig: [{}] }, { builds: [{ buildID: 'other', status: 'ready' }] }, { builds: [{ buildID: 'build-1', status: 'building' }] }, { networkConfig: { allowOut: ['example.com'], denyOut: ['0.0.0.0/0', '::/0'] } }, { networkConfig: { allowOut: [], denyOut: ['0.0.0.0/0'] } } ]) {
    const f = fixture(metadata);
    await assert.rejects(f.provider.create(jobId, 300), /SANDBOX_TEMPLATE_UNVERIFIED/);
    assert.equal(f.calls.filter(c => c.name === 'create').length, 0);
  }
});

test('SDK uses real bearer auth, pinned template, no secret environment and TTL <=900 seconds', async () => {
  const f = fixture(); await f.provider.create(jobId, 9999);
  const args = f.calls.find(c => c.name === 'create')!.args;
  assert.equal(args[0], 'template-1'); assert.equal(args[1].timeoutMs, 900000);
  assert.equal(args[1].apiKey, 'e2b_123456'); assert.deepEqual(args[1].apiHeaders, { Authorization: 'Bearer private-key' });
  assert.deepEqual(args[1].envs, {}); assert.equal(JSON.stringify(args[1].metadata).includes('private-key'), false);
  assert.equal(args[1].metadata.wesManaged, 'true'); assert.equal(args[1].metadata.wesJobId, jobId);
});

test('model code is uploaded as bytes and only fixed entrypoints execute in a private job cwd', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300);
  await instance.execute('python', 'print("$(touch /bad)")', 999999);
  const run = f.calls.filter(c => c.name === 'run').at(-1)!;
  assert.match(run.args[0], /"python",\s*"task.py"/); assert.match(run.args[0], /"node",\s*"task.mjs"/);
  assert.equal(run.args[1].user, 'root'); assert.match(run.args[0], /user=account.pw_uid/);
  assert.equal(run.args[1].envs.WES_TIMEOUT_MS, '120000'); assert.equal(run.args[1].timeoutMs, 125000); assert.match(run.args[1].cwd, /^\/tmp\/wes-job-[a-f0-9-]+\/work$/);
  assert.equal(run.args[0].includes('touch'), false);
});

test('path traversal and oversize inputs are rejected before remote writes', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300);
  for (const path of ['../x', '/tmp/x', 'a/../../x', 'a\\x', 'a\u0000x', 'a//x']) await assert.rejects(instance.writeFile(path, Buffer.from('x')), /SANDBOX_INVALID_PATH/);
  await assert.rejects(instance.writeFile('x', Buffer.alloc(20 * 1024 * 1024 + 1)), /SANDBOX_FILE_TOO_LARGE/);
});

test('readOutput uses bounded no-follow remote reader and rejects invalid/oversize data', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300);
  f.setResult({ exitCode: 0, stdout: Buffer.from('report').toString('base64'), stderr: '' });
  assert.equal((await instance.readOutput('report.html', 20)).toString(), 'report');
  const read = f.calls.filter(c => c.name === 'run').at(-1)!;
  assert.match(read.args[0], /O_NOFOLLOW/); assert.match(read.args[0], /S_ISREG/);
  f.setResult({ exitCode: 0, stdout: Buffer.alloc(21).toString('base64'), stderr: '' });
  await assert.rejects(instance.readOutput('report.html', 20), /SANDBOX_OUTPUT_INVALID/);
  f.setResult({ exitCode: 1, stdout: '', stderr: 'symlink and private-key' });
  await assert.rejects(instance.readOutput('report.html', 20), /SANDBOX_OUTPUT_INVALID/);
});

test('connect refuses foreign metadata and never kills an unowned sandbox', async () => {
  const f = fixture(); f.info.metadata.wesConnectionId = 'other';
  await assert.rejects(f.provider.connect('managed-1'), /SANDBOX_NOT_MANAGED/);
  assert.equal(f.calls.some(c => c.name === 'kill'), false);
});

test('abort releases only the managed handle and repeated release is harmless', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300); const controller = new AbortController(); controller.abort();
  await assert.rejects(instance.execute('node', 'console.log(1)', 1000, controller.signal), /SANDBOX_CANCELLED/);
  await instance.release(); assert.equal(f.calls.filter(c => c.name === 'kill').length, 1);
});

test('concurrent release shares one cloud request and retries a failed release', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300);
  await Promise.all([instance.release(), instance.release(), instance.release()]);
  assert.equal(f.calls.filter(c => c.name === 'kill').length, 1);
  const g = fixture(); const second = await g.provider.create(jobId, 300); let attempts = 0;
  g.sandbox.kill = async () => { if (++attempts === 1) throw new Error('private-key'); return true; };
  await assert.rejects(second.release(), /SANDBOX_RELEASE_FAILED/); await second.release(); assert.equal(attempts, 2);
});

test('cloud errors never expose SDK tokens, keys or response bodies', async () => {
  const f = fixture(); f.sandbox.commands.run = async () => { throw new Error('Bearer private-key envd-access-token=private-token'); };
  await assert.rejects(f.provider.create(jobId, 300), error => error instanceof Error && error.message === 'SANDBOX_PROVISIONING_FAILED');
});

test('failed provisioning cleanup preserves only managed ID for durable compensation', async () => {
  const f = fixture(); f.sandbox.commands.run = async () => { throw new Error('private-key'); };
  f.sandbox.kill = async () => { throw new Error('envd-token private-key'); };
  await assert.rejects(f.provider.create(jobId, 300), error => error instanceof Error && error.message === 'SANDBOX_PROVISIONING_FAILED' && (error as Error & { managedSandboxId?: string }).managedSandboxId === 'managed-1' && !JSON.stringify(error).includes('private-key'));
});

test('bounded runner returns nonzero script exits as a known sanitized result', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300);
  f.setResult({ exitCode: 2, stdout: 'private-key', stderr: 'invalid input' });
  assert.deepEqual(await instance.execute('python', 'raise ValueError()', 1000), { exitCode: 2, stdout: '[redacted]', stderr: 'invalid input' });
});
test('untrusted streams terminate inside a bounded cloud runner before SDK transport', async () => {
  const f = fixture(); const instance = await f.provider.create(jobId, 300);
  f.setResult({ exitCode: 0, stdout: 'x'.repeat(16384), stderr: 'y'.repeat(16384) });
  const result = await instance.execute('node', 'console.log("flood")', 1000);
  assert.equal(result.stdout.length, 16384); assert.equal(result.stderr.length, 16384);
  const runner = f.calls.filter(c => c.name === 'run').at(-1)!;
  assert.match(runner.args[0], /selectors.DefaultSelector/); assert.match(runner.args[0], /os.read\(key.fd,65536\)/);
  assert.match(runner.args[0], /chunk\[:max\(0,LIMIT-len\(buffers\[name\]\)\)\]/);
  assert.match(runner.args[0], /start_new_session=True/); assert.match(runner.args[0], /os.killpg/);
  assert.match(runner.args[0], /time.monotonic/); assert.match(runner.args[0], /extra_groups=\[\]/);
  assert.equal(JSON.stringify(runner.args[1].envs).includes('private-key'), false);
  f.setResult({ exitCode: 0, stdout: 'x'.repeat(16385), stderr: '' });
  await assert.rejects(instance.execute('node', 'console.log(1)', 1000), /SANDBOX_EXECUTION_UNKNOWN/);
});
