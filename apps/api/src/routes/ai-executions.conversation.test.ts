import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createAiExecutionsRouter } from './ai-executions.routes';
import { getUsersRepository } from '../modules/auth/users.repository';
import { signAuthToken } from '../middleware/auth';
import { SkillError } from '../modules/skills/skills.types';
import type { AuthUser } from '../types';
const user = {id:'chat-http',username:'reader',role:'admin',businessRole:'pre_sales',status:'active'} as AuthUser;
function app(respond: (...args:any[])=>Promise<any>,enabled=true){const api=express();api.use(express.json());api.use('/ai-executions',createAiExecutionsRouter({enabled,conversation:{respond}}));return api}
const path='/ai-executions/conversation';
test('JWT与能力权限保护新对话入口，X-Role不能授权',async()=>{let calls=0;const api=app(async()=>{calls++});assert.equal((await request(api).post(path).set('X-Role','admin').send({})).status,401);assert.equal(calls,0)});
test('只使用认证身份、转发会话与原始输入，标准响应；关闭执行开关时不调用模型',async t=>{
 t.mock.method(getUsersRepository(),'findUserById',async()=>user);let calls=0;
 const service=async(actor:any,sessionId:any,body:any)=>{calls++;assert.equal(actor.id,user.id);assert.equal(sessionId,'session');assert.deepEqual(body,{content:'用途？'});return{action:'reply',message:'用途说明'}};
 const response=await request(app(service)).post(path).set('Authorization',`Bearer ${signAuthToken(user)}`).send({sessionId:'session',content:'用途？'});assert.equal(response.status,200);assert.equal(response.body.code,0);assert.equal(response.body.data.action,'reply');
 assert.equal((await request(app(service,false)).post(path).set('Authorization',`Bearer ${signAuthToken(user)}`).send({})).status,503);assert.equal(calls,1);
});
test('基础设施错误不泄露，明确权限错误保留状态',async t=>{
 t.mock.method(getUsersRepository(),'findUserById',async()=>user);
 for(const error of [new Error('PRIVATE KEY INTERNAL'),new SkillError('FORBIDDEN','权限变化',403)]){const response=await request(app(async()=>{throw error})).post(path).set('Authorization',`Bearer ${signAuthToken(user)}`).send({sessionId:'s'});assert.equal(response.status,error instanceof SkillError?403:503);assert.equal(JSON.stringify(response.body).includes('PRIVATE'),false)}
});
