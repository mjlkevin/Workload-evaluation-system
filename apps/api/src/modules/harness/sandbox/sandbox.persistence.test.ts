import {test,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {eq} from 'drizzle-orm';import request from 'supertest';
import {db,pool} from '../../../db/client';import {aiSessions,harnessRuns,harnessRunAttempts,harnessRunEvents,harnessSandboxJobs,harnessSandboxArtifacts} from '../../../db/schema';
import {createTestUser,cleanupOneTestUser} from '../../../test-helpers/test-users';import {createSandboxRepository,readSandboxArtifact} from './sandbox.repository';import type {SandboxJob} from './sandbox.types';import {createApp} from '../../../app';import {signAuthToken} from '../../../middleware/auth';
const rows:{sessionId:string;runId:string;username:string}[]=[];
after(async()=>{for(const x of rows){await db.delete(harnessRuns).where(eq(harnessRuns.harnessRunId,x.runId));await db.delete(aiSessions).where(eq(aiSessions.sessionId,x.sessionId));await cleanupOneTestUser(x.username)}await pool.end()});
async function fixture(){const user=await createTestUser('wes-sandbox-persistence');const sessionId=randomUUID(),runId=randomUUID(),attemptId=randomUUID();rows.push({sessionId,runId,username:user.username});const now=new Date();
 await db.insert(aiSessions).values({sessionId,ownerUserId:user.id,ownerUsername:user.username,title:'沙箱隔离',domain:'workbench',workflowKey:'free_chat',businessRole:'pre_sales',status:'active',createdAt:now,updatedAt:now,attachments:[{attachmentId:'own-file',name:'source.txt',parsedSummary:'仅自己的材料'}]});
 await db.insert(harnessRuns).values({harnessRunId:runId,ownerUserId:user.id,ownerUsername:user.username,mode:'interactive',stage:'chat',status:'running',title:'任务',aiSessionId:sessionId,runKind:'workbench_chat',workflowId:'sandbox-task-v1',workflowVersion:'1.0.0'});
 await db.insert(harnessRunAttempts).values({harnessRunAttemptId:attemptId,harnessRunId:runId,attemptNo:1,workerId:'sandbox-test',status:'running',leaseExpiresAt:new Date(Date.now()+120000),heartbeatAt:now});
 return {user,scope:{ownerId:user.id,sessionId,runId,attemptId,ordinal:1,stepKey:'chat'},repo:createSandboxRepository({read:async()=>Buffer.from('file')})};
}
test('PG scope fences owner, lease, cancelled task and source ownership',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const f=await fixture();await f.repo.assertScope(f.scope);await assert.rejects(()=>f.repo.assertScope({...f.scope,ownerId:randomUUID()}));
 const own=await f.repo.sources(f.scope,[{sourceId:'own-file',name:'a.txt'}]);assert.equal(own[0].bytes.toString(),'仅自己的材料');await assert.rejects(()=>f.repo.sources(f.scope,[{sourceId:randomUUID(),name:'a.txt'}]));
 await db.update(harnessRuns).set({cancelRequestedAt:new Date()}).where(eq(harnessRuns.harnessRunId,f.scope.runId));await assert.rejects(()=>f.repo.assertScope(f.scope),/取消|租约/);
});
test('PG atomic claim is unique and expired or other-owner files are unavailable',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const f=await fixture(),id=randomUUID(),now=new Date();const job:SandboxJob={id,...f.scope,requestDigest:'hash',request:{title:'报告',language:'python',code:'print(1)',inputs:[],outputs:[]},plan:{jobId:id,title:'报告',language:'python',materials:[],outputs:[],connectionHash:'hash',maxSeconds:300,digest:'hash'},state:'planned',sandboxId:null,cleanup:'none',result:null,createdAt:now,updatedAt:now,expiresAt:new Date(Date.now()+10000)};
 await f.repo.insertJob(job);const claimed=await Promise.all([f.repo.claim(id,f.scope),f.repo.claim(id,f.scope)]);assert.equal(claimed.filter(Boolean).length,1);
 const file={id:randomUUID(),jobId:id,ownerId:f.user.id,sessionId:f.scope.sessionId,runId:f.scope.runId,name:'a.html',title:'报告',format:'html',mimeType:'text/html',sha256:'hash',size:1,expiresAt:new Date(Date.now()+60000)};
 await db.insert(harnessSandboxArtifacts).values(file);assert.equal((await readSandboxArtifact(file.id,f.user.id)).id,file.id);await assert.rejects(()=>readSandboxArtifact(file.id,randomUUID()));await db.update(harnessSandboxArtifacts).set({expiresAt:new Date(0)}).where(eq(harnessSandboxArtifacts.id,file.id));await assert.rejects(()=>readSandboxArtifact(file.id,f.user.id));
});
test('admin configuration authenticates JWT and refuses normal user',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const f=await fixture(),app=createApp();assert.equal((await request(app).get('/api/v1/system/sandbox-connections')).status,401);assert.equal((await request(app).get('/api/v1/system/sandbox-connections').set('Authorization','Bearer '+signAuthToken(f.user))).status,403);assert.equal((await request(app).get('/api/v1/ai-artifacts/'+randomUUID()+'/download').set('Authorization','Bearer '+signAuthToken(f.user))).status,404);
});
