export type SkillActor = { id: string; username: string };
export type SkillDefinition = {
  name: string; description: string; category: string; instructions: string; roles: string[];
  references: Array<{ label: string; uri: string; version: string }>;
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  model: { scenario: string; temperature: number; maxTokens: number; timeoutMs: number };
  tools: Array<{ toolName: string; inputMapping: Record<string, string>; requiresConfirmation: boolean }>;
  examples: Array<{ title: string; input: unknown; expected: unknown }>;
};
export type SkillVersion = {
  skillVersionId: string; versionCode: string; majorLetter: string; minorNumber: number;
  status: 'draft' | 'reviewed' | 'published'; checkoutStatus: 'checked_in' | 'checked_out';
  checkedOutBy: string | null; definition: SkillDefinition; hash: string;
  lastCheckinDefinition: SkillDefinition; createdAt: string; updatedAt: string;
};
export type SkillAudit = {
  id: string; action: string; actorId: string; actorName: string; createdAt: string; versionId: string;
};
export type SkillRecord = {
  skillId: string; enabled: boolean; archived: boolean; activeVersionId: string | null;
  currentVersionId: string; revision: number; versions: SkillVersion[]; audit: SkillAudit[];
  createdAt: string; updatedAt: string;
};
export class SkillError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details: Array<{ field: string; reason: string }> = [],
  ) { super(message); this.name = 'SkillError'; }
}
