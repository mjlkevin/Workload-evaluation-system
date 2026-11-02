/** Pure guard shared by the PG suite and subprocess boundary tests. Never include environment values in errors. */
export function resolveExecutionTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const target = env.TEST_DATABASE_URL;
  try {
    if (!target || env.DATABASE_URL !== target) throw new Error();
    const url = new URL(target);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname !== '/workload_eval_test') throw new Error();
    return target;
  } catch { throw new Error('EXECUTION_TEST_DATABASE_REQUIRED'); }
}
