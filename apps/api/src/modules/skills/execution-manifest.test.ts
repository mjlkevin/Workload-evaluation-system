import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createExecutionManifestService, readPersistedExecutionManifest } from './execution-manifest';
import { skillDefinitionHash as hash } from './skills.hash';
import type { AuthUser } from '../../types';
import type { SkillDefinition } from './skills.types';
import type { ExecutionSnapshot } from './execution-manifest.types';
import { DEFAULT_TOOL_POLICY_ENTRY } from '../../agent/tool-policy';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// Ephemeral fixture values are generated locally and are never real credentials.
const businessFieldValue = randomUUID();
const user = { id: 'caller', username: 'Caller', role: 'user', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const schema = { type: 'object', properties: { text: { type: 'string' }, apiKey: { type: 'string' } }, required: ['text'], additionalProperties: false };
const definition: SkillDefinition = { name: 'Frozen', description: '', category: 'test', instructions: 'Do the task', roles: ['pre_sales'], inputSchema: schema,
  outputSchema: { type: 'object' }, model: { scenario: 'generation', temperature: 0, maxTokens: 100, timeoutMs: 1000 }, references: [], tools: [], examples: [] };
function fixture(options: { authorityFailure?: boolean; reference?: boolean | 'double'; secret?: boolean; tool?: boolean; workflowTool?: boolean } = {}) {
  let snapshot: ExecutionSnapshot = { kind: 'skill', target: { id: 'skill-one', versionId: 'version-a', hash: hash(definition), definition: structuredClone(definition) }, skills: [] };
  snapshot.skills.push({ stepId: '$skill', skillId: 'skill-one', versionId: 'version-a', hash: hash(definition), definition: structuredClone(definition) });
  let prepared = 0; let verified = 0; let read = 0; let transactionActive = false;
  const material = { uri: 'wes://knowledge/ref-a', version: '2026-11-02T00:00:00.000Z', title: 'Exact title', content: 'Original material body' };
  const materials = options.reference === 'double' ? [material, { ...material, uri: 'wes://knowledge/ref-b', title: 'Second title', content: 'Second original body' }] : [material];
  const native = { name: 'read_fixture', description: 'Local read', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    mutates: false, exfiltrates: false, simulationOnly: false, source: 'code' as const, capability: 'estimates:read' as const, sandboxReadSafe: true };
  if (options.reference) {
    for (const d of [snapshot.target.definition as SkillDefinition, snapshot.skills[0].definition]) d.references = materials.map(m => ({ label: 'Source', uri: m.uri, version: m.version }));
  }
  if (options.tool) for (const d of [snapshot.target.definition as SkillDefinition, snapshot.skills[0].definition]) d.tools = [{ toolName: native.name, inputMapping: { text: '$.text' }, requiresConfirmation: false }];
  snapshot.target.hash = hash(snapshot.target.definition); snapshot.skills[0].hash = hash(snapshot.skills[0].definition);
  const toolContract = { name: native.name, description: native.description, parameters: native.parameters, mutates: native.mutates, exfiltrates: native.exfiltrates,
    simulationOnly: native.simulationOnly, source: native.source, capability: native.capability, requiresConfirmation: false, policy: DEFAULT_TOOL_POLICY_ENTRY };
  if (options.workflowTool) {
    const d = { name: 'Tool workflow', description: '', category: 'test', roles: ['pre_sales'], inputSchema: schema, outputSchema: { type: 'object' },
      steps: [{ id: 't', name: 'Local read', type: 'tool', toolName: native.name, requiresConfirmation: false, inputMapping: [{ target: 'text', source: { kind: 'path', path: '$.input.text' } }], onFailure: 'fail' }], outputMapping: [] };
    snapshot = { kind: 'workflow', target: { id: 'workflow-one', versionId: 'workflow-version-a', definition: d as never, hash: hash(d) }, skills: [],
      publishedDependencies: { schemaVersion: 1, skills: [], tools: [{ stepId: 't', contract: toolContract, hash: hash(toolContract) }] } };
  }
  const database = { transaction: async (callback: (tx: unknown) => unknown) => callback({}) };
  const service = createExecutionManifestService({ database: database as never,
    repository: { async read() { read++; return structuredClone(snapshot); }, async verifyCaller() {} },
    prepareAuthority: async (_uris, resolve) => ({ value: await resolve(), verify: async () => { verified++; if (options.authorityFailure) throw new Error('authority changed'); } }),
    loadReference: async id => { const m = materials.find(m => m.uri.endsWith(`/${id}`))!; return { id, ...m, updatedAt: m.version, createdAt: m.version, category: 'test', status: 'active' as const }; },
    loadSkillContext: async () => { assert.equal(transactionActive, false); prepared++; return { snapshot: { schemaVersion: 1, references: options.reference ? materials.map(m => ({ uri: m.uri, version: m.version, digest: hash({ title: m.title, content: m.content }) })) : [], tools: options.tool ? [{ native, policy: DEFAULT_TOOL_POLICY_ENTRY }] : [], roles: ['PRE_SALES'], model: { providerId: 'provider', model: 'exact-model', modelSource: 'binding', credentialScope: 'scope', baseUrlDigest: hash('endpoint'), params: definition.model, capabilities: [], supportedParams: [], ...(options.secret ? { apiKey: randomUUID() } : {}) } }, tools: options.tool ? [native] : [] } as never; },
    loadWorkflowTools: async () => options.workflowTool ? [{ ...toolContract, allowedRoles: ['pre_sales'] }] : [],
  });
  return { service, get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; }, counts: () => ({ prepared, verified, read }),
    commit: async (request: unknown = { kind: 'skill', skillId: 'skill-one', input: { text: 'hello', apiKey: businessFieldValue } }) => {
      const prepared = await service.prepareExecution(request, user); transactionActive = true;
      try { return await prepared.resolveInTransaction({} as never); } finally { transactionActive = false; }
    } };
}
test('freezes exact definitions, input, caller role, nonsecret model and empty unimplemented asset bindings', async () => {
  const f = fixture(); const manifest = await f.commit();
  assert.equal(manifest.target.versionId, 'version-a'); assert.equal(manifest.skills[0].versionId, 'version-a');
  assert.equal((manifest.initialInput as Record<string, unknown>).apiKey, businessFieldValue);
  assert.equal(manifest.caller.businessRole, 'pre_sales'); assert.deepEqual(manifest.assetBindings, []);
  assert.equal(manifest.skills[0].context.model.model, 'exact-model'); assert.equal(manifest.manifestHash.length, 64);
  assert.deepEqual(f.counts(), { prepared: 1, verified: 1, read: 2 });
  assert.deepEqual(readPersistedExecutionManifest(JSON.parse(JSON.stringify(manifest))), manifest);
});
test('rejects client definitions, versions, hash or manifest without reading storage', async () => {
  const f = fixture();
  for (const key of ['definition', 'versionId', 'hash', 'manifest', 'executionManifest'])
    await assert.rejects(f.commit({ kind: 'skill', skillId: 'skill-one', input: { text: 'x' }, [key]: {} }));
  for (const request of [null, { kind: 'skill', skillId: '', input: {} }, { kind: 'invented', input: {} }]) await assert.rejects(f.commit(request));
  assert.equal(f.counts().read, 0);
});
test('input schema and business role are checked before dependency resolution', async () => {
  const f = fixture(); await assert.rejects(f.commit({ kind: 'skill', skillId: 'skill-one', input: { text: 3 } }));
  f.snapshot.target.definition.roles = ['delivery']; f.snapshot.skills[0].definition.roles = ['delivery'];
  await assert.rejects(f.commit()); assert.equal(f.counts().prepared, 0);
});
test('preparation then active pointer/hash or authority changes reject, never return mixed snapshots', async () => {
  const f = fixture(); const prepared = await f.service.prepareExecution({ kind: 'skill', skillId: 'skill-one', input: { text: 'x' } }, user);
  f.snapshot.target.versionId = 'version-b';
  await assert.rejects(prepared.resolveInTransaction({} as never), (error: any) => error.code === 'EXECUTION_CONTEXT_CHANGED');
});
test('restore uses only persisted material and schemas after publication changes and ordinary disable', async () => {
  const f = fixture(); const manifest = await f.commit(); const before = f.counts();
  (f.snapshot.target.definition as SkillDefinition).instructions = 'changed latest'; f.snapshot.target.definition.inputSchema = { type: 'object' };
  const restored = readPersistedExecutionManifest(manifest);
  assert.equal((restored.target.definition as SkillDefinition).instructions, 'Do the task'); assert.deepEqual(f.counts(), before);
  (restored.target.definition as SkillDefinition).instructions = 'caller mutation'; assert.equal((manifest.target.definition as SkillDefinition).instructions, 'Do the task');
});
test('restore rejects unknown schema, changed content and internally inconsistent dependencies even with recomputed checksum', async () => {
  const manifest = await fixture().commit();
  const changedInput = structuredClone(manifest); (changedInput.initialInput as any).text = 'tampered'; assert.throws(() => readPersistedExecutionManifest(changedInput));
  for (const mutate of [(m: any) => { m.schemaVersion = 9; }, (m: any) => { m.skills[0].versionId = 'other'; }]) {
    const bad = structuredClone(manifest); mutate(bad); assert.throws(() => readPersistedExecutionManifest(bad));
    const { manifestHash: _, ...body } = bad; bad.manifestHash = hash(body);
    assert.throws(() => readPersistedExecutionManifest(bad));
  }
});
test('rejects unsafe JSON but preserves legitimate business keys; context credentials cannot enter manifest', async () => {
  const f = fixture();
  await assert.rejects(f.commit({ kind: 'skill', skillId: 'skill-one', input: JSON.parse('{"text":"x","__proto__":{}}') }));
  const request = { kind: 'skill', skillId: 'skill-one', input: { text: 'x' }, sources: [{ kind: 'conversation', id: 'message-a', location: 'body' }] };
  const prepared = await f.service.prepareExecution(request, user); request.input.text = 'mutated'; request.sources[0].id = 'mutated';
  const manifest = await prepared.resolveInTransaction({} as never); assert.equal((manifest.initialInput as any).text, 'x'); assert.equal(manifest.sources[0].id, 'message-a');
  await assert.rejects(fixture({ secret: true }).commit(), (error: any) => error.code === 'EXECUTION_UNSAFE_CONFIGURATION');
});
test('actual authority verifier failure rejects commit without rerunning any external resolver', async () => {
  const f = fixture({ authorityFailure: true }); await assert.rejects(f.commit(), /authority changed/);
  assert.deepEqual(f.counts(), { read: 2, prepared: 1, verified: 1 });
});
test('nonempty server material freezes original body/version/digest and corruption is rejected with recomputed checksum', async () => {
  const manifest = await fixture({ reference: true }).commit(); const material = manifest.skills[0].materials[0];
  assert.equal(material.content, 'Original material body'); assert.equal(material.version, '2026-11-02T00:00:00.000Z');
  assert.equal(material.digest, hash({ title: 'Exact title', content: material.content }));
  const restored = readPersistedExecutionManifest(JSON.parse(JSON.stringify(manifest))); assert.deepEqual(restored.skills[0].materials, [material]);
  const bad = structuredClone(manifest); bad.skills[0].materials[0].content = 'new body'; const { manifestHash: _, ...body } = bad; bad.manifestHash = hash(body);
  assert.throws(() => readPersistedExecutionManifest(bad));
});
test('current caller must satisfy workflow roles and every exact dependency role independently', async () => {
  for (const restricted of ['workflow', 'skill']) {
    const f = fixture(); const d = { name: 'Workflow', description: '', category: 'test', roles: restricted === 'workflow' ? ['delivery'] : ['pre_sales'], inputSchema: schema,
      outputSchema: { type: 'object' }, steps: [{ id: 's', type: 'skill', name: 'S', skillId: 'skill-one', skillVersionId: 'version-a', inputMapping: [], onFailure: 'fail' }], outputMapping: [] };
    f.snapshot.kind = 'workflow'; f.snapshot.target = { id: 'workflow-one', versionId: 'workflow-version-a', hash: hash(d), definition: d as never };
    f.snapshot.skills[0].stepId = 's'; f.snapshot.skills[0].definition.roles = restricted === 'skill' ? ['delivery'] : ['pre_sales'];
    await assert.rejects(f.commit({ kind: 'workflow', workflowId: 'workflow-one', input: { text: 'x' } }), (e: any) => e.code === 'EXECUTION_FORBIDDEN');
    assert.equal(f.counts().prepared, 0);
  }
});
test('restore rejects definition/tool contract inconsistency even after all definition checksums are recomputed', async () => {
  const manifest = await fixture().commit();
  const definition = manifest.skills[0].definition;
  definition.tools = [{ toolName: 'invented-native-tool', inputMapping: {}, requiresConfirmation: false }];
  manifest.target.definition = structuredClone(definition); manifest.skills[0].hash = hash(definition); manifest.target.hash = hash(definition);
  const { manifestHash: _, ...body } = manifest; manifest.manifestHash = hash(body);
  assert.throws(() => readPersistedExecutionManifest(manifest));
});
const rehash = (manifest: any) => { const { manifestHash: _, ...body } = manifest; manifest.manifestHash = hash(body); return manifest; };
for (const field of ['providerId', 'model', 'modelSource', 'credentialScope', 'baseUrlDigest', 'params', 'capabilities', 'supportedParams'])
  test(`restore requires runtime model field ${field}`, async () => {
    const bad = await fixture().commit(); delete (bad.skills[0].context.model as any)[field];
    assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
  });
test('restore requires the exact frozen native tool set with no invented or missing entries', async () => {
  const extra = await fixture().commit(); (extra.skills[0].context.tools as any[]).push({ native: { name: 'unknown' }, policy: {} });
  assert.throws(() => readPersistedExecutionManifest(rehash(extra)));
  const missing = await fixture({ tool: true }).commit(); missing.skills[0].context.tools = [];
  assert.throws(() => readPersistedExecutionManifest(rehash(missing)));
});
test('local native contract freezes and restores without executing its tool', async () => {
  const manifest = await fixture({ tool: true }).commit(); const restored = readPersistedExecutionManifest(manifest);
  assert.equal(restored.skills[0].context.tools[0].native.name, 'read_fixture');
  assert.deepEqual(restored.skills[0].context.tools[0].policy, DEFAULT_TOOL_POLICY_ENTRY);
  assert.equal(restored.skills[0].context.tools[0].native.source, 'code');
});
test('two exact references cannot be replaced by the same first material twice', async () => {
  const original = await fixture({ reference: 'double' }).commit();
  assert.equal(original.skills[0].materials[1].content, 'Second original body');
  const bad = structuredClone(original); bad.skills[0].materials[1] = structuredClone(bad.skills[0].materials[0]);
  assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
  assert.equal(readPersistedExecutionManifest(original).skills[0].materials[1].content, 'Second original body');
});
test('frozen material bodies must remain text even if all reference checksums are recomputed', async () => {
  const bad = await fixture({ reference: true }).commit(); const material = bad.skills[0].materials[0];
  (material as any).content = { unexpected: 'object' }; material.digest = hash({ title: material.title, content: material.content });
  bad.skills[0].context.references[0].digest = material.digest;
  assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
});
const workflowManifest = () => fixture({ workflowTool: true }).commit({ kind: 'workflow', workflowId: 'workflow-one', input: { text: 'read' } });
test('nonempty workflow native tool freezes and restores its complete contract without tool execution', async () => {
  const manifest = await workflowManifest(); const restored = readPersistedExecutionManifest(manifest);
  assert.equal(restored.tools[0].contract.name, 'read_fixture'); assert.equal(restored.tools[0].contract.source, 'code');
  assert.deepEqual(restored.tools, restored.publishedDependencies!.tools);
});
for (const field of ['mutates', 'exfiltrates', 'simulationOnly', 'source', 'capability', 'policy', 'requiresConfirmation'])
  test(`workflow runtime contract requires ${field} even with synchronized checksums`, async () => {
    const bad = await workflowManifest(); delete (bad.tools[0].contract as any)[field]; bad.tools[0].hash = hash(bad.tools[0].contract);
    bad.publishedDependencies!.tools = structuredClone(bad.tools);
    assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
  });
test('published dependency snapshot requires its own schemaVersion', async () => {
  const bad = await workflowManifest(); delete (bad.publishedDependencies as any).schemaVersion;
  assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
});
test('published tool contract must match its own digest, not only the runtime digest', async () => {
  const bad = await workflowManifest(); (bad.publishedDependencies!.tools[0] as any).contract = { name: 'different tool' };
  assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
});
test('published dependency tools must exactly match actual workflow steps with no extra binding', async () => {
  const bad = await workflowManifest(); bad.publishedDependencies!.tools.push({ ...structuredClone(bad.tools[0]), stepId: 'phantom' });
  assert.throws(() => readPersistedExecutionManifest(rehash(bad)));
});
const guardUrl = pathToFileURL(path.resolve(__dirname, '../../test-helpers/execution-database-guard.ts')).href;
function checkDatabaseBoundary(databaseUrl: string | undefined, testUrl: string | undefined) {
  const script = `const { resolveExecutionTestDatabaseUrl } = await import(${JSON.stringify(guardUrl)}); try { resolveExecutionTestDatabaseUrl(process.env); console.log('accepted'); } catch { console.log('rejected'); process.exitCode = 2; }`;
  const env = { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: testUrl, CREDENTIAL_KEK: 'boundary-secret-sentinel' };
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env, encoding: 'utf8' });
}
test('database boundary accepts local, CI and container test URLs without requiring or revealing KEK', () => {
  for (const url of ['postgres://kevin@localhost:5432/workload_eval_test', 'postgres://postgres:test@localhost:5432/workload_eval_test', 'postgresql://container:password@127.0.0.1:49152/workload_eval_test']) {
    const child = checkDatabaseBoundary(url, url);
    assert.equal(child.status, 0); assert.equal(child.stdout.trim(), 'accepted'); assert.equal(child.stderr, '');
  }
});
test('database boundary rejects missing, mismatched, malformed and non-test URLs without printing any environment value', () => {
  const testUrl = 'postgres://postgres:boundary-password@localhost:5432/workload_eval_test';
  for (const [a, b] of [[undefined, testUrl], [testUrl, undefined], [testUrl, `${testUrl}?different=1`], ['bad-url', 'bad-url'], [testUrl.replace('workload_eval_test', 'workload_eval'), testUrl.replace('workload_eval_test', 'workload_eval')]]) {
    const child = checkDatabaseBoundary(a, b);
    assert.equal(child.status, 2); assert.equal(child.stdout.trim(), 'rejected'); assert.equal(child.stderr, '');
  }
});
