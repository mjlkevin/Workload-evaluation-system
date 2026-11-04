import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toExecutionCatalogEntry } from './skills.workbench';
import { buildBusinessExecutionView } from './skills.workbench-view';

test('catalog metadata is an allowlist and excludes instructions, tool policy and credentials', () => {
  const entry = toExecutionCatalogEntry({ kind: 'skill', target: { id: 's1', versionId: 'v1', hash: 'private',
    definition: { name: 'Estimate', description: 'Business output', inputSchema: { type: 'object' }, instructions: 'private instruction',
      model: { credentialScope: 'secret' }, tools: [{ policy: 'secret' }] } }, skills: [] } as any);
  assert.deepEqual(entry, { kind: 'skill', id: 's1', versionId: 'v1', name: 'Estimate', description: 'Business output', inputSchema: { type: 'object' } });
});

test('safe projection selects fixed metadata and results without leaking host cursor/model context', () => {
  const manifest = { kind: 'skill', target: { id: 's1', versionId: 'v1', definition: { name: 'Estimate', description: '', instructions: 'PRIVATE',
    model: { credentialScope: 'PRIVATE' } } }, skills: [{ stepId: '$skill', versionId: 'v1' }] } as any;
  const view = buildBusinessExecutionView(manifest, { schemaVersion: 1, kind: 'skill', skill: { phase: 'completed', stepId: '$skill',
    output: { days: 12 }, toolResults: [{ callId: 'PRIVATE', toolName: 'create_project', arguments: { name: 'Owned' }, simulated: false, result: { projectId: 'p1' } }],
    model: { credentialScope: 'PRIVATE' }, pendingBatch: [], seenCallIds: ['PRIVATE'] } } as any);
  assert.equal(view.target.versionId, 'v1'); assert.deepEqual(view.results.output, { days: 12 });
  assert.deepEqual(view.results.effects, [{ toolName: 'create_project', parameters: { name: 'Owned' }, result: { projectId: 'p1' } }]);
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
});

test('safe projection removes reserved configuration keys nested inside owned business results', () => {
 const manifest = { kind: 'skill', target: { id: 's1', versionId: 'v1', definition: { name: 'Estimate', description: '' } }, skills: [] } as any;
 const state = { kind: 'skill', skill: { phase: 'completed', stepId: '$skill', toolResults: [], output: {
  days: 7, nested: { credentialScope: 'PRIVATE', apiKey: 'PRIVATE', executionAuthority: { internal: true }, note: 'Owned material' },
 } } } as any;
 const view = buildBusinessExecutionView(manifest, state);
 assert.deepEqual(view.results.output, { days: 7, nested: { note: 'Owned material' } });
 assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
});

test('business snapshot never spreads configuration, metadata, private checkpoint state or attempt errors', async () => {
 const { sanitizeBusinessRunSnapshot } = await import('./skills.workbench-view');
 const result = sanitizeBusinessRunSnapshot({ run: { harnessRunId: 'r', ownerUserId: 'owner', status: 'waiting', workflowId: 'business',
  executionConfig: { secret: 'PRIVATE' }, metadata: { credentialScope: 'PRIVATE', basis: { identity: 'PRIVATE', executionAuthority: 'PRIVATE', currentToolsHash: 'PRIVATE' } }, errorMessage: 'PRIVATE' },
  checkpoint: { harnessRunCheckpointId: 'cp', sequence: 1, state: { secret: 'PRIVATE' }, runtimeValidation: { basis: 'PRIVATE' } },
  attempt: { harnessRunAttemptId: 'a', status: 'failed', errorMessage: 'PRIVATE' },
  output: { status: 'final', content: { days: 3, apiKey: 'PRIVATE' }, metadata: 'PRIVATE' },
 });
 assert.equal(result.run.harnessRunId, 'r'); assert.equal(result.checkpoint.sequence, 1); assert.equal(result.attempt.status, 'failed');
 assert.deepEqual(result.output.content, { days: 3 }); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
 assert.equal('executionConfig' in result.run, false); assert.equal('metadata' in result.run, false); assert.equal('state' in result.checkpoint, false);
});

test('safe business projection preserves assessment adjustment basis while excluding authorization envelopes', () => {
 const output = { aiAdjustments: [{ reqId: 'REQ-1', proposedDays: 3, basis: '新增接口字段及联调范围' }] };
 const manifest = { kind: 'skill', initialInput: { basis: '业务输入依据' }, target: { id: 's1', versionId: 'v1', definition: { name: 'Assessment', description: '' } }, skills: [] } as any;
 const view = buildBusinessExecutionView(manifest, { kind: 'skill', skill: { phase: 'completed', stepId: '$skill', toolResults: [], output } } as any);
 assert.deepEqual(view.input, { basis: '业务输入依据' }); assert.deepEqual(view.results.output, output);
});

test('summary projection omits unconsumed tool and step copies while preserving sanitized final output', () => {
 const manifest = { kind: 'skill', target: { id: 's1', versionId: 'v1', definition: { name: 'Summary', description: '' } } } as any;
 const state = { skill: { phase: 'completed', stepId: '$skill', output: { days: 3, credentialScope: 'PRIVATE' },
  toolResults: [{ toolName: 'read', arguments: {}, result: { rows: [1, 2, 3] } }] } } as any;
 const view = buildBusinessExecutionView(manifest, state, { includeDetails: false });
 assert.deepEqual(view.results.steps, []); assert.deepEqual(view.results.effects, []);
 assert.deepEqual(view.results.output, { days: 3 });
});
