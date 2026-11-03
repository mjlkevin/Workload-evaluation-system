import type { ExecutionManifest, ExecutionRequest, SourceReference } from './execution-manifest.types';
/** Reconstruct the original submitted references, preserving legacy omission of empty assets. */
export function executionRequestFromManifest(manifest: ExecutionManifest): ExecutionRequest & { sources: SourceReference[] } {
  const common = { input: manifest.initialInput, sources: manifest.sources,
    ...(manifest.assetBindings.length ? { assets: manifest.assetBindings.map(({ kind, templateId }) => ({ kind, templateId })) } : {}) };
  return manifest.kind === 'skill' ? { kind: 'skill', skillId: manifest.target.id, ...common }
    : { kind: 'workflow', workflowId: manifest.target.id, ...common };
}
