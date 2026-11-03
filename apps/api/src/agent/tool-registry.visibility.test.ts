import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentTool, AgentUser } from './agent.types';
import { ToolRegistry } from './tool-registry';
import { buildListToolsTool } from './tools/list-tools.tools';
import { runAgent } from './orchestrator';

const user: AgentUser = { id: 'visibility-owner', capabilities: ['estimates:read'] };
function tool(name: string, overrides: Partial<AgentTool> = {}): AgentTool {
  return { name, description: 'fixture search match', parameters: { type: 'object' },
    capability: 'estimates:read', mutates: false, execute: async () => name, ...overrides };
}
function fixture() {
  const registry = new ToolRegistry();
  for (const entry of [
    tool('ordinary_core'), tool('ordinary_discoverable', { discoverable: true }),
    tool('explicit_false', { businessExecutionOnly: false }),
    tool('restricted_core', { businessExecutionOnly: true }),
    tool('restricted_discoverable', { businessExecutionOnly: true, discoverable: true }),
    tool('restricted_discovery', { businessExecutionOnly: true, category: 'discovery' }),
    tool('unauthorized', { capability: 'system:manage', discoverable: true }),
  ]) registry.register(entry);
  registry.register(buildListToolsTool(registry));
  return registry;
}
const names = (definitions: ReturnType<ToolRegistry['listToolsFor']>) => definitions.map(item => item.function.name);

const selectorCases: Array<[string, (registry: ToolRegistry) => string[], string[]]> = [
  ['listToolsFor', registry => names(registry.listToolsFor(user)), ['ordinary_core', 'ordinary_discoverable', 'explicit_false', 'list_tools']],
  ['listFullToolsFor', registry => names(registry.listFullToolsFor(user)), ['ordinary_core', 'ordinary_discoverable', 'explicit_false']],
  ['listCoreToolsFor', registry => names(registry.listCoreToolsFor(user)), ['ordinary_core', 'explicit_false']],
  ['listDiscoveryToolsFor', registry => names(registry.listDiscoveryToolsFor(user)), ['list_tools']],
  ['searchToolsFor', registry => registry.searchToolsFor(user, {}).map(item => item.name), ['ordinary_discoverable']],
  ['listDiscoveredToolDefinitionsFor', registry => names(registry.listDiscoveredToolDefinitionsFor(user,
    ['ordinary_discoverable', 'restricted_discoverable', 'unauthorized'])), ['ordinary_discoverable']],
];
for (const [selector, select, expected] of selectorCases) {
  test(`${selector} excludes business-only tools and retains capability checks and legacy defaults`, () => {
    assert.deepEqual(select(fixture()), expected);
  });
}
test('discovery intent and category filters cannot reveal a business-only tool', () => {
  const registry = fixture();
  assert.deepEqual(registry.searchToolsFor(user, { intent: 'fixture' }).map(item => item.name), ['ordinary_discoverable']);
  assert.deepEqual(registry.searchToolsFor(user, { category: 'discovery' }), []);
});

test('list_tools cannot disclose business-only tools even when queried by exact name', async () => {
  const registry = fixture();
  for (const args of [{}, { intent: 'restricted_discoverable' }]) {
    const result = await registry.execute('list_tools', args, user) as { tools: Array<{ name: string }> };
    assert.deepEqual(result.tools.map(item => item.name), 'intent' in args ? [] : ['ordinary_discoverable']);
  }
});

test('raw catalog, clones and explicit execution retain business tools without granting capability', async () => {
  const registry = fixture();
  const original = registry.get('restricted_core');
  assert.ok(original);
  assert.ok(registry.allTools().includes(original));
  const cloned = registry.cloneWithMcpTools([]);
  assert.equal(cloned.get(original.name), original);
  assert.equal(await cloned.execute(original.name, {}, user), original.name);
  await assert.rejects(cloned.execute(original.name, {}, { ...user, capabilities: [] }), /无权限调用工具/);
  assert.deepEqual(names(cloned.listFullToolsFor(user)), ['ordinary_core', 'ordinary_discoverable', 'explicit_false']);
});

for (const mode of ['full', 'discovery'] as const) {
  test(`legacy ${mode} channel rejects guessed business tools and discovery cannot reintroduce them`, async () => {
    const registry = fixture();
    let executed = 0;
    registry.get('restricted_discoverable')!.execute = async () => { executed++; return {}; };
    // Even a poisoned manual cannot bypass the discovered-definition selector.
    registry.get('list_tools')!.execute = async () => ({ tools: [{ name: 'restricted_discoverable' }] });
    const injected: string[][] = [];
    await runAgent({ registry, user, userMessage: 'fixture', toolInjectionMode: mode,
      onEvent: () => {}, confirm: async () => true,
      runner: { async chatCompletion(request) {
        injected.push((request.tools ?? []).map(item => item.function.name));
        const toolCalls = injected.length === 1 && mode === 'discovery'
          ? [{ id: 'discover', name: 'list_tools', arguments: {} }]
          : injected.length <= (mode === 'discovery' ? 2 : 1)
            ? [{ id: 'guess', name: 'restricted_discoverable', arguments: {} }] : undefined;
        return { content: 'done', rawContent: 'done', model: 'fixture', provider: 'fixture', attempts: 1, toolCalls };
      } },
    });
    assert.equal(executed, 0);
    assert.ok(injected.length >= 2);
    assert.ok(injected.every(tools => !tools.some(name => name.startsWith('restricted_'))));
  });
}
