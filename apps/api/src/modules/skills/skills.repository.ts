import type { SkillActor, SkillDefinition, SkillRecord } from './skills.types';
export interface SkillRepository {
  list(): Promise<SkillRecord[]>;
  get(skillId: string): Promise<SkillRecord | null>;
  create(definition: SkillDefinition, actor: SkillActor): Promise<SkillRecord>;
  mutate(skillId: string, expectedRevision: number, actor: SkillActor, action: string,
    update: (record: SkillRecord, now: string) => void): Promise<SkillRecord>;
}
