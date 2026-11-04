import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createAiExecutionsRouter } from './ai-executions.routes';
import { createExecutionRecommendationService, type ExecutionRecommendations } from '../modules/skills/skills.recommendations';
import { getUsersRepository } from '../modules/auth/users.repository';
import { signAuthToken } from '../middleware/auth';
import { SkillError } from '../modules/skills/skills.types';
import type { AuthUser } from '../types';
const user = { id: 'http-recommend-a', username: 'a', role: 'admin', businessRole: 'pre_sales', status: 'active' } as AuthUser;
const other = { ...user, id: 'http-recommend-b', username: 'b' };
const noMatch = { outcome: 'no_match' as const, items: [], message: '请补充希望完成的业务目标，或继续普通对话。' };
function app(recommendations: { recommend: (actor: AuthUser, body: unknown) => Promise<ExecutionRecommendations> }, enabled = true) {
  const api = express(); api.use(express.json());
  const forbidden = new Proxy({}, { get() { assert.fail('recommendation must not call business run/message/write services'); } });
  api.use('/ai-executions', createAiExecutionsRouter({ enabled, recommendations, catalog: { list: async () => [] }, business: forbidden } as any));
  return api;
}
const path = '/ai-executions/recommendations';
test('recommendation HTTP endpoint requires JWT; X-Role and invalid token never reach service', async () => {
  let calls = 0; const api = app({ recommend: async () => { calls++; return noMatch; } });
  assert.equal((await request(api).post(path).set('X-Role', 'admin').send({ goal: '目标' })).status, 401);
  assert.equal((await request(api).post(path).set('Authorization', 'Bearer invalid').send({ goal: '目标' })).status, 401);
  assert.equal(calls, 0);
});
test('HTTP returns standard envelope using authenticated actor; disabled flag prevents all model work', async context => {
  context.mock.method(getUsersRepository(), 'findUserById', async () => user);
  let calls = 0;
  const recommendations = { recommend: async (actor: AuthUser, body: unknown) => {
    calls++; assert.deepEqual(actor, user); assert.deepEqual(body, { goal: '目标' }); return noMatch;
  } };
  const response = await request(app(recommendations)).post(path).set('Authorization', `Bearer ${signAuthToken(user)}`).send({ goal: '目标' });
  assert.equal(response.status, 200); assert.equal(response.body.code, 0); assert.deepEqual(response.body.data, noMatch); assert.equal(calls, 1);
  const disabled = await request(app(recommendations, false)).post(path).set('Authorization', `Bearer ${signAuthToken(user)}`).send({ goal: '目标' });
  assert.equal(disabled.status, 503); assert.equal(disabled.body.code, 'ASYNC_RUNS_DISABLED'); assert.equal(calls, 1);
});
test('HTTP real service validates body before discovery and exposes only safe authority/model errors', async context => {
  context.mock.method(getUsersRepository(), 'findUserById', async () => user);
  let catalogs = 0;
  const service = createExecutionRecommendationService({ catalog: { list: async () => { catalogs++; return []; } } });
  const api = app(service), token = signAuthToken(user);
  const invalid = await request(api).post(path).set('Authorization', `Bearer ${token}`).send({ goal: '目标', execution: { input: {} } });
  assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'EXECUTION_RECOMMENDATION_INPUT_INVALID'); assert.equal(catalogs, 0);
  const valid = await request(api).post(path).set('Authorization', `Bearer ${token}`).send({ goal: '目标' });
  assert.equal(valid.status, 200); assert.deepEqual(valid.body.data, noMatch); assert.equal(catalogs, 1);
  for (const error of [new Error('PRIVATE_PROVIDER_DETAIL'), new SkillError('EXECUTION_AUTHORITY_CHANGED', '当前用户权限已变化，请重新读取', 403)]) {
    const response = await request(app({ recommend: async () => { throw error; } })).post(path).set('Authorization', `Bearer ${token}`).send({ goal: '目标' });
    assert.equal(response.status, error instanceof SkillError ? 403 : 503);
    assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false); assert.equal(response.body.data, null);
  }
});
test('rate limiting counts authenticated users separately and does not invoke service after the limit', async context => {
  context.mock.method(getUsersRepository(), 'findUserById', async (id: string) => id === user.id ? user : other);
  let calls = 0; const api = app({ recommend: async () => { calls++; return noMatch; } });
  const post = (actor: AuthUser) => request(api).post(path).set('Authorization', `Bearer ${signAuthToken(actor)}`).send({ goal: '目标' });
  for (let i = 0; i < 20; i++) assert.equal((await post(user)).status, 200);
  const limited = await post(user);
  assert.equal(limited.status, 429); assert.equal(limited.body.code, 'EXECUTION_RECOMMENDATION_RATE_LIMIT'); assert.equal(limited.body.data, null);
  assert.equal(calls, 20); assert.equal((await post(other)).status, 200); assert.equal(calls, 21);
});
