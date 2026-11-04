import { asc, inArray, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { credentials, knowledgeEntries, systemConfigs } from '../../db/schema';
import type { SkillDbExecutor } from './skills-pg.repository';
import { skillDefinitionHash } from './skills.hash';
import { SkillError } from './skills.types';
/** Internal fence only: no raw authority rows or credential digests enter API responses or release snapshots. */
export async function prepareSkillAuthority<T>(referenceUris: string[], resolve: () => Promise<T>, database: Database = db) {
    const ids = [...new Set(referenceUris.map(uri => /^wes:\/\/knowledge\/([A-Za-z0-9_-]{1,160})$/.exec(uri)?.[1]).filter((id): id is string => Boolean(id)))].sort();
    const capture = async (tx: SkillDbExecutor) => {
        const settings = await tx.select().from(systemConfigs).where(inArray(systemConfigs.configKey, ['requirementSettings', 'toolPolicy', 'mcpConfig'])).orderBy(asc(systemConfigs.configKey));
        const keys = await tx.select().from(credentials).orderBy(asc(credentials.scope));
        const references = ids.length ? await tx.select().from(knowledgeEntries).where(inArray(knowledgeEntries.id, ids)).orderBy(asc(knowledgeEntries.id)) : [];
        return skillDefinitionHash({ settings, keys, references });
    };
    const read = () => database.transaction(tx => capture(tx), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const before = await read();
    // The resolver may query the DB and collect MCP inventory; no transaction connection is retained here.
    const value = await resolve();
    const after = await read();
    if (before !== after)
        throw new SkillError('SKILL_CONTEXT_CHANGED', '依赖配置在解析期间已变化，请重试', 409);
    return { value, async verify(tx: SkillDbExecutor) {
            // SHARE also fences missing rows/phantom inserts. All release paths use the same lock order.
            // Readers remain concurrent; only authority changes wait for this short validation/publish transaction.
            await tx.execute(sql `LOCK TABLE credentials, knowledge_entries, system_configs IN SHARE MODE`);
            if (await capture(tx) !== after)
                throw new SkillError('SKILL_CONTEXT_CHANGED', '依赖配置已变化，请重新验证', 409);
        } };
}
