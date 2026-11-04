import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { harnessSandboxConnections } from '../../../db/schema';
import { LocalSandboxArtifactStore } from './sandbox-artifacts';
import { createBailianSandboxProvider } from '../../../services/sandbox/bailian-provider';
import { getApiKey } from '../../system/credentials.store';
import { createSandboxRepository, SANDBOX_CREDENTIAL_SCOPE } from './sandbox.repository';
import { createSandboxService } from './sandbox.service';
import { SandboxError } from './sandbox.types';
import type { SandboxConnection } from '../../../services/sandbox/sandbox-provider';
export const sandboxStore=new LocalSandboxArtifactStore(path.resolve(process.env.WES_SANDBOX_ARTIFACT_DIR||path.join(process.cwd(),'config','private-sandbox-artifacts')));
export async function sandboxProvider(){
 const [record]=await db.select().from(harnessSandboxConnections).where(eq(harnessSandboxConnections.id,'default'));
 const key=await getApiKey(SANDBOX_CREDENTIAL_SCOPE);
 const connection=record?.configuration as SandboxConnection|undefined;
 if(!connection?.enabled||!key.apiKey)throw new SandboxError('SANDBOX_NOT_CONFIGURED','沙箱连接尚未启用，请联系管理员',503);
 return createBailianSandboxProvider(connection,key.apiKey);
}
export const sandboxService=createSandboxService({repository:createSandboxRepository(sandboxStore),provider:sandboxProvider,store:sandboxStore});
export { sandboxSourceCatalog, readSandboxArtifact } from './sandbox.repository';
export { SandboxError } from './sandbox.types';
