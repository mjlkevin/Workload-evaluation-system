import { createExecutionAssetPgRepository } from './mvp/execution-assets-pg.repository';
import { normalizeExecutionAssets, validateFrozenExecutionAssets, validateFrozenSourceMaterials, assertExecutionAssetPermission,
  type ExecutionAssetRepository, type ExecutionSourceContext } from './mvp/execution-assets';
import { db, type Database } from '../../db/client';
import Ajv from 'ajv';
import type { AuthUser } from '../../types';
import { TOOL_POLICY_APPROVAL_STRATEGIES, TOOL_POLICY_INJECTION_MODES } from '../../types';
import { V2_ROLES, legacyRoleToV2Roles } from '../../rbac/roles';
import { ROLE_CAPABILITIES } from '../../rbac/permissions';
import { resolveBusinessRole } from '../../middleware/auth';
import { getKnowledgeRepository } from '../knowledge/knowledge.module';
import { workflowToolMetadata, validateWorkflowDefinition, type WorkflowDefinition } from '../workflows/workflows.module';
import { SkillError } from './skills.types';
import { skillDefinitionHash as hash } from './skills.hash';
import { prepareSkillAuthority } from './skills.authority';
import { resolveSkillDependencyContext } from './skills.context';
import { compileSkillPayloadSchema, validateSkillDefinition } from './skills.validation';
import { copyTrialJson } from './skills.sandbox';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import type { ExecutionRequest, ExecutionManifest, ExecutionSnapshot, ExecutionManifestRepository, PreparedExecution, ReferenceMaterial, SourceReference, WorkflowToolAuthority } from './execution-manifest.types';
function invalid(code = 'EXECUTION_INVALID_REQUEST', status = 400): never { throw new SkillError(code, '执行请求或清单无效，请重新读取', status); }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max = 160): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
function json<T>(value: T): T {
  try { return copyTrialJson(value, 'definition') as T; } catch { return invalid(); }
}
function exactKeys(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key))) invalid(); }
export function validateExecutionRequest(value: unknown): ExecutionRequest {
  const request = json(value);
  if (!object(request) || !['skill', 'workflow'].includes(String(request.kind))) invalid();
  const idKey = request.kind === 'skill' ? 'skillId' : 'workflowId';
  exactKeys(request, ['kind', idKey, 'input', 'sources', 'assets']);
  if (!text(request[idKey]) || !Object.prototype.hasOwnProperty.call(request, 'input')) invalid();
  if (request.sources !== undefined) sourcesShape(request.sources);
  const assets = normalizeExecutionAssets(request.assets);
  delete request.assets; if (assets.length) request.assets = assets;
  return request as ExecutionRequest;
}
function sourcesShape(value: unknown): asserts value is SourceReference[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  for (const source of value) {
    if (!object(source)) invalid(); exactKeys(source, ['kind', 'id', 'location']);
    if (!['file', 'conversation'].includes(String(source.kind)) || !text(source.id)
      || (source.location !== undefined && !text(source.location, 1000))) invalid();
  }
}
/** Configuration has an explicit boundary. Business input is JSON-validated without stripping legitimate field names. */
function noCredentials(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passwordHash|private[_-]?key|secret|ciphertext|encryptedValue)$/i.test(key)) invalid('EXECUTION_UNSAFE_CONFIGURATION');
    noCredentials(child);
  }
}
const nonempty = { type: 'string', minLength: 1, maxLength: 300 };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const fields = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: nonempty, uniqueItems: true };
const toolFields = { name: nonempty, description: { type: 'string' }, parameters: { type: 'object' }, mutates: { type: 'boolean' },
  exfiltrates: { type: 'boolean' }, simulationOnly: { type: 'boolean' }, source: { enum: ['code', 'mcp'] },
  capability: { enum: [...new Set(Object.values(ROLE_CAPABILITIES).flat())] } };
const policyShape = fields({ enabled: { type: 'boolean' }, visibleRoles: { type: 'array', items: { enum: V2_ROLES }, uniqueItems: true },
  approvalStrategy: { enum: TOOL_POLICY_APPROVAL_STRATEGIES }, injectionMode: { enum: TOOL_POLICY_INJECTION_MODES } });
const native = fields({ ...toolFields, sandboxReadSafe: { type: 'boolean' } });
native.properties.outputSchema = { type: 'object' };
const contextShape = fields({ schemaVersion: { const: 1 },
  references: { type: 'array', maxItems: 30, items: fields({ uri: nonempty, version: nonempty, digest }) },
  tools: { type: 'array', maxItems: 30, items: fields({ native, policy: policyShape }) },
  roles: { type: 'array', items: { enum: V2_ROLES }, uniqueItems: true },
  model: fields({ providerId: nonempty, model: nonempty, modelSource: { enum: ['binding', 'legacy_ui', 'evaluation_fallback', 'env_fallback'] }, credentialScope: nonempty,
    baseUrlDigest: digest, params: { type: 'object' }, capabilities: strings, supportedParams: strings }) });
const compiler = new Ajv({ strict: false });
const validateContext = compiler.compile(contextShape);
const directToolContract = fields({ ...toolFields, requiresConfirmation: { type: 'boolean' }, policy: policyShape });
directToolContract.properties.outputSchema = { type: 'object' };
const toolBindingsShape = { type: 'array', maxItems: 50, items: fields({ stepId: nonempty, hash: digest, contract: directToolContract }) };
const validateToolBindings = compiler.compile(toolBindingsShape);
const validateToolAuthority = compiler.compile(fields({ schemaVersion: { const: 1 },
  roles: { type: 'array', minItems: 1, maxItems: V2_ROLES.length, items: { enum: V2_ROLES }, uniqueItems: true },
  tools: { type: 'array', minItems: 1, maxItems: 50, items: fields({ stepId: nonempty, sandboxReadSafe: { type: 'boolean' } }) } }));
const validatePublishedDependencies = compiler.compile(fields({ schemaVersion: { const: 1 }, tools: toolBindingsShape,
  skills: { type: 'array', maxItems: 50, items: fields({ stepId: nonempty, skillId: nonempty, skillVersionId: nonempty, hash: digest, context: contextShape }) } }));
const multiset = (values: unknown[]) => hash(values.map(value => hash(value)).sort());
const validateMaterials = new Ajv({ strict: false }).compile({ type: 'array', maxItems: 30, items: fields({ uri: nonempty, version: nonempty, digest,
  title: { type: 'string', maxLength: 24000 }, content: { type: 'string', maxLength: 24000 } }) });
function authorize(snapshot: ExecutionSnapshot, user: AuthUser, input: unknown) {
  if (user.status !== 'active' || !snapshot.target.definition.roles.includes(resolveBusinessRole(user))
    || snapshot.skills.some(skill => !skill.definition.roles.includes(resolveBusinessRole(user)))) invalid('EXECUTION_FORBIDDEN', 403);
  if (!compileSkillPayloadSchema(snapshot.target.definition.inputSchema, 'inputSchema')(input)) invalid('EXECUTION_INPUT_SCHEMA_FAILED');
}
type ServiceOptions = {
  database?: Database; repository?: ExecutionManifestRepository;
  loadSkillContext?: typeof resolveSkillDependencyContext; loadWorkflowTools?: typeof workflowToolMetadata;
  loadReference?: (id: string) => ReturnType<ReturnType<typeof getKnowledgeRepository>['get']>;
  prepareAuthority?: typeof prepareSkillAuthority; assetRepository?: ExecutionAssetRepository;
};
export function createExecutionManifestService(options: ServiceOptions = {}) {
  const database = options.database ?? db; const repository = options.repository ?? createExecutionManifestPgRepository();
  const assets = options.assetRepository ?? createExecutionAssetPgRepository();
  return { async prepareExecution(value: unknown, initialUser: AuthUser, sourceContext?: ExecutionSourceContext): Promise<PreparedExecution> {
    const request = validateExecutionRequest(value); const user = structuredClone(initialUser);
    const assetRefs = request.assets ?? [];
    if (assetRefs.length) assertExecutionAssetPermission(user);
    const sourceMaterials = sourceContext && json(sourceContext.sourceMaterials);
    if (sourceMaterials) {
      validateFrozenSourceMaterials(sourceMaterials);
      const refs = request.sources ?? [];
      if (refs.length !== sourceMaterials.length || refs.some(ref => !sourceMaterials.some(m => m.id === ref.id && m.kind === ref.kind))) invalid('EXECUTION_SOURCE_UNAVAILABLE', 409);
    }
    const { before, assetBindings } = await database.transaction(async tx => ({ before: await repository.read(tx, request, false),
      assetBindings: await assets.read(tx, assetRefs) }), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    validateFrozenExecutionAssets(assetBindings);
    if (hash(assetBindings.map(({ kind, templateId }) => ({ kind, templateId }))) !== hash(assetRefs)) invalid('EXECUTION_ASSET_UNAVAILABLE', 409);
    authorize(before, user, request.input);
    const uris = before.skills.flatMap(skill => skill.definition.references.map(ref => ref.uri));
    const authority = await (options.prepareAuthority ?? prepareSkillAuthority)(uris, async () => {
      const skills: ExecutionManifest['skills'] = [];
      for (const skill of before.skills) {
        const context = await (options.loadSkillContext ?? resolveSkillDependencyContext)(skill.definition, user, { requireModel: false });
        validateSkillDefinition(skill.definition, context.tools);
        const materials: ReferenceMaterial[] = [];
        for (const ref of skill.definition.references) {
          const id = /^wes:\/\/knowledge\/([A-Za-z0-9_-]{1,160})$/.exec(ref.uri)?.[1]; if (!id) invalid('EXECUTION_REFERENCE_UNAVAILABLE', 409);
          const entry = await (options.loadReference ?? (id => getKnowledgeRepository().get(id)))(id);
          const digest = entry && hash({ title: entry.title, content: entry.content });
          if (!entry || entry.status !== 'active' || entry.updatedAt !== ref.version
            || !context.snapshot.references.some(item => item.uri === ref.uri && item.version === ref.version && item.digest === digest)) invalid('EXECUTION_REFERENCE_UNAVAILABLE', 409);
          materials.push({ uri: ref.uri, version: ref.version, digest: digest!, title: entry.title, content: entry.content });
        }
        noCredentials(context.snapshot);
        skills.push({ ...skill, context: json(context.snapshot), materials });
      }
      const tools: ExecutionManifest['tools'] = [];
      const toolEvidence: WorkflowToolAuthority['tools'] = [];
      if (before.kind === 'workflow') {
        const definition = before.target.definition as WorkflowDefinition;
        const native = (await (options.loadWorkflowTools ?? workflowToolMetadata)(user)).filter(tool => tool.allowedRoles.includes(resolveBusinessRole(user)));
        validateWorkflowDefinition(definition, { skills: skills.map(skill => ({ stepId: skill.stepId, skillId: skill.skillId, skillVersionId: skill.versionId,
          hash: skill.hash, definition: skill.definition, enabled: true, archived: false, status: 'published' })), tools: native });
        for (const step of definition.steps) if (step.type === 'tool') {
          const current = native.find(tool => tool.name === step.toolName)!;
          if (typeof current.sandboxReadSafe !== 'boolean') invalid('EXECUTION_CONTEXT_CHANGED', 409);
          toolEvidence.push({ stepId: step.id, sandboxReadSafe: current.sandboxReadSafe });
          const contract = { name: current.name, description: current.description, parameters: current.parameters, mutates: current.mutates, exfiltrates: current.exfiltrates,
            simulationOnly: current.simulationOnly, source: current.source, capability: current.capability, requiresConfirmation: current.requiresConfirmation, policy: current.policy,
            ...(current.outputSchema !== undefined ? { outputSchema: current.outputSchema } : {}) };
          const published = before.publishedDependencies?.tools.find(tool => tool.stepId === step.id);
          if (!published || published.hash !== hash(contract)) invalid('EXECUTION_CONTEXT_CHANGED', 409);
          noCredentials(contract); tools.push({ stepId: step.id, contract, hash: hash(contract) });
        }
      }
      if (tools.length && !['admin', 'user', 'sub_admin'].includes(user.role)) invalid('EXECUTION_FORBIDDEN', 403);
      const version = tools.length ? { schemaVersion: 2 as const, toolAuthority: { schemaVersion: 1 as const,
        roles: legacyRoleToV2Roles(user.role), tools: toolEvidence } } : { schemaVersion: 1 as const };
      return json({ ...before, skills, tools, ...version });
    }, database);
    const body = json({ ...authority.value, caller: { id: user.id, businessRole: resolveBusinessRole(user) },
      initialInput: request.input, sources: request.sources ?? [], assetBindings, ...(sourceMaterials?.length ? { sourceMaterials } : {}) });
    const manifest: ExecutionManifest = { ...body, manifestHash: hash(body) };
    // The commit phase uses only the supplied connection and prepared authority; no provider, file I/O or pool acquisition.
    return { async resolveInTransaction(tx) {
      const current = await repository.read(tx, request, true);
      if (hash(current) !== hash(before)) invalid('EXECUTION_CONTEXT_CHANGED', 409);
      await repository.verifyCaller(tx, user);
      if (assetRefs.length) assertExecutionAssetPermission(user);
      if (hash(await assets.read(tx, assetRefs)) !== hash(assetBindings)) invalid('EXECUTION_CONTEXT_CHANGED', 409);
      await authority.verify(tx);
      return readPersistedExecutionManifest(manifest);
    } };
  } };
}
export const prepareExecution = (request: unknown, user: AuthUser, sources?: ExecutionSourceContext) => createExecutionManifestService().prepareExecution(request, user, sources);

/** Server-only persisted data reader. A checksum detects accidental corruption; it is not an authorization credential. */
export function readPersistedExecutionManifest(value: unknown): ExecutionManifest {
  const result = json(value) as ExecutionManifest;
  if (!object(result)) invalid('EXECUTION_MANIFEST_INVALID');
  exactKeys(result, ['schemaVersion', 'kind', 'target', 'skills', 'publishedDependencies', 'tools', 'caller', 'initialInput', 'sources', 'assetBindings', 'sourceMaterials', 'manifestHash',
    ...(result.schemaVersion === 2 ? ['toolAuthority'] : [])]);
  const { manifestHash, ...body } = result;
  if (![1, 2].includes(result.schemaVersion) || !['skill', 'workflow'].includes(result.kind) || manifestHash !== hash(body)
    || !object(result.target) || !text(result.target.id) || !text(result.target.versionId)
    || !object(result.target.definition) || result.target.hash !== hash(result.target.definition)
    || !object(result.caller) || !text(result.caller.id)
    || !Array.isArray(result.skills) || !validateToolBindings(result.tools)
    || (result.kind === 'workflow' && !validatePublishedDependencies(result.publishedDependencies))) invalid('EXECUTION_MANIFEST_INVALID');
  if (result.schemaVersion === 2 && (result.kind !== 'workflow' || !result.tools.length || !validateToolAuthority(result.toolAuthority)
    || new Set(result.toolAuthority.tools.map(tool => tool.stepId)).size !== result.tools.length
    || multiset(result.toolAuthority.tools.map(tool => tool.stepId)) !== multiset(result.tools.map(tool => tool.stepId)))) invalid('EXECUTION_MANIFEST_INVALID');
  sourcesShape(result.sources);
  try {
    validateFrozenExecutionAssets(result.assetBindings);
    if (result.sourceMaterials !== undefined) {
      validateFrozenSourceMaterials(result.sourceMaterials);
      if (result.sources.length !== result.sourceMaterials.length || result.sources.some(ref => !result.sourceMaterials!.some(m => m.id === ref.id && m.kind === ref.kind))) invalid();
    }
  } catch { invalid('EXECUTION_MANIFEST_INVALID'); }
  const definition = result.target.definition;
  if (!Array.isArray(definition.roles) || !definition.roles.includes(result.caller.businessRole)
    || !compileSkillPayloadSchema(definition.inputSchema, 'inputSchema')(result.initialInput)) invalid('EXECUTION_MANIFEST_INVALID');
  const refs = result.kind === 'skill' ? [{ id: '$skill', skillId: result.target.id, skillVersionId: result.target.versionId }]
    : (definition as WorkflowDefinition).steps.filter(step => step.type === 'skill');
  if (refs.length !== result.skills.length || new Set(result.skills.map(skill => skill.stepId)).size !== refs.length) invalid('EXECUTION_MANIFEST_INVALID');
  for (const skill of result.skills) {
    const ref = refs.find(item => item.id === skill.stepId);
    if (!ref || ref.skillId !== skill.skillId || ref.skillVersionId !== skill.versionId || skill.hash !== hash(skill.definition)
      || !skill.definition.roles.includes(result.caller.businessRole) || !object(skill.context) || skill.context.schemaVersion !== 1
      || !validateContext(skill.context) || hash(skill.context.model.params) !== hash(skill.definition.model) || !validateMaterials(skill.materials)
      || skill.definition.references.length !== skill.materials.length) invalid('EXECUTION_MANIFEST_INVALID');
    if (result.kind === 'skill' && (skill.hash !== result.target.hash || hash(skill.definition) !== hash(definition))) invalid('EXECUTION_MANIFEST_INVALID');
    if (result.kind === 'workflow' && !result.publishedDependencies?.skills.some(item => item.stepId === skill.stepId && item.skillId === skill.skillId && item.skillVersionId === skill.versionId && item.hash === skill.hash)) invalid('EXECUTION_MANIFEST_INVALID');
    noCredentials(skill.context);
    if (multiset(skill.context.tools.map(tool => tool.native.name)) !== multiset(skill.definition.tools.map(tool => tool.toolName))) invalid('EXECUTION_MANIFEST_INVALID');
    if (multiset(skill.definition.references.map(ref => [ref.uri, ref.version])) !== multiset(skill.materials.map(ref => [ref.uri, ref.version]))
      || multiset(skill.context.references.map(ref => [ref.uri, ref.version, ref.digest])) !== multiset(skill.materials.map(ref => [ref.uri, ref.version, ref.digest]))) invalid('EXECUTION_MANIFEST_INVALID');
    validateSkillDefinition(skill.definition, skill.context.tools.map(tool => tool.native));
    for (const material of skill.materials) if (material.digest !== hash({ title: material.title, content: material.content })
      || !skill.definition.references.some(ref => ref.uri === material.uri && ref.version === material.version)
      || !skill.context.references.some(ref => ref.uri === material.uri && ref.version === material.version && ref.digest === material.digest)) invalid('EXECUTION_MANIFEST_INVALID');
  }
  for (const tool of result.tools) { noCredentials(tool.contract); if (tool.hash !== hash(tool.contract)) invalid('EXECUTION_MANIFEST_INVALID'); }
  if (result.kind === 'workflow') {
    noCredentials(result.publishedDependencies);
    if (multiset(result.publishedDependencies!.skills.map(skill => [skill.stepId, skill.skillId, skill.skillVersionId, skill.hash]))
      !== multiset(result.skills.map(skill => [skill.stepId, skill.skillId, skill.versionId, skill.hash]))) invalid('EXECUTION_MANIFEST_INVALID');
    if (multiset(result.publishedDependencies!.tools.map(tool => [tool.stepId, tool.hash])) !== multiset(result.tools.map(tool => [tool.stepId, tool.hash]))) invalid('EXECUTION_MANIFEST_INVALID');
    for (const tool of result.publishedDependencies!.tools) if (tool.hash !== hash(tool.contract)) invalid('EXECUTION_MANIFEST_INVALID');
    const steps = (definition as WorkflowDefinition).steps.filter(step => step.type === 'tool');
    if (steps.length !== result.tools.length || new Set(result.tools.map(tool => tool.stepId)).size !== steps.length) invalid('EXECUTION_MANIFEST_INVALID');
    for (const tool of result.tools) if (!steps.some(step => step.id === tool.stepId && step.toolName === tool.contract.name)
      || !result.publishedDependencies?.tools.some(item => item.stepId === tool.stepId && item.hash === tool.hash)) invalid('EXECUTION_MANIFEST_INVALID');
    validateWorkflowDefinition(definition, { skills: result.skills.map(skill => ({ stepId: skill.stepId, skillId: skill.skillId, skillVersionId: skill.versionId,
      hash: skill.hash, definition: skill.definition, enabled: true, archived: false, status: 'published' })), tools: result.tools.map(tool => tool.contract) });
  } else if (result.tools.length || result.publishedDependencies) invalid('EXECUTION_MANIFEST_INVALID');
  return result;
}
