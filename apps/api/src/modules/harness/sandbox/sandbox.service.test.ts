import { test } from "node:test";
import assert from "node:assert/strict";
import { createSandboxService, parseSandboxRequest } from "./sandbox.service";
import type {
  SandboxRepository,
  SandboxScope,
  SandboxJob,
} from "./sandbox.types";
const scope: SandboxScope = {
  ownerId: "u",
  sessionId: "s",
  runId: "r",
  attemptId: "a",
  ordinal: 1,
  stepKey: "chat",
};
const args = {
  title: "报告",
  language: "python",
  code: "print(1)",
  inputs: [],
  outputs: [{ path: "report.html", format: "html", title: "报告" }],
};
function fixture() {
  let job: SandboxJob | null = null,
    approved = false,
    create = 0,
    run = 0,
    release = 0;
  const repository: SandboxRepository = {
    connection: async () => ({
      connection: {
        id: "default",
        workspaceId: "w",
        region: "cn-beijing",
        templateCode: "t",
        templateRevision: "v1",
        aliyunUid: "123",
        enabled: true,
      },
      keyVersion: 1,
      credentialFingerprint: "fixture-A",
    }),
    assertScope: async () => {},
    sources: async () => [],
    findJob: async () => job,
    insertJob: async (j) => (job = j),
    approval: async () => approved,
    claim: async () => {
      if (job!.state !== "planned") return false;
      job!.state = "provisioning";
      return true;
    },
    patch: async (_, p) => {
      Object.assign(job!, p);
    },
    publish: async (_, artifacts, result) => {
      job!.state = "completed";
      job!.result = result;
    },
  };
  const provider = {
    verifyTemplate: async () => {},
    create: async () => {
      create++;
      return {
        id: "cloud",
        writeFile: async () => {},
        execute: async () => {
          run++;
          return { exitCode: 0, stdout: "ok", stderr: "" };
        },
        readOutput: async () =>
          Buffer.from(
            '<!doctype html><html><head><meta charset="utf-8"></head><body>报告</body></html>',
          ),
        release: async () => {
          release++;
        },
      };
    },
    connect: async () => {
      throw Error("unused");
    },
  };
  const store = {
    write: async () => {},
    read: async () => Buffer.alloc(0),
    remove: async () => {},
  };
  const service = createSandboxService({
    repository,
    provider: async () => provider,
    store,
  });
  return {
    service,
    repository,
    provider,
    approve: () => {
      approved = true;
    },
    counts: () => ({ create, run, release }),
    job: () => job!,
  };
}
test("reject untrusted owner/URL/path and excessive code before allocating", () => {
  for (const value of [
    { ...args, ownerId: "other" },
    {
      ...args,
      outputs: [{ path: "../evil.html", format: "html", title: "x" }],
    },
    { ...args, code: "x".repeat(131073) },
    { ...args, inputs: [{ sourceId: "https://evil", name: "data.txt" }] },
  ])
    assert.throws(() => parseSandboxRequest(value));
});
test("preparation is local only and execution requires durable approval", async () => {
  const f = fixture();
  const ready = await f.service.prepare(scope, args);
  assert.deepEqual(f.counts(), { create: 0, run: 0, release: 0 });
  await assert.rejects(() => f.service.execute(scope, ready), /确认/);
  assert.equal(f.counts().create, 0);
});
test("approved output persists before release and replay returns saved artifacts without cloud calls", async () => {
  const f = fixture();
  const ready = await f.service.prepare(scope, args);
  f.approve();
  const out = await f.service.execute(scope, ready);
  assert.equal(out.status, "completed");
  assert.equal((out.artifacts as any[]).length, 1);
  await f.service.execute(scope, ready);
  assert.deepEqual(f.counts(), { create: 1, run: 1, release: 1 });
});
test("provisioning unknown never creates another instance on replay", async () => {
  const f = fixture();
  const ready = await f.service.prepare(scope, args);
  f.approve();
  f.provider.create = async () => {
    throw Error("cloud response containing secret");
  };
  await assert.rejects(() => f.service.execute(scope, ready), /状态未知/);
  assert.equal(f.job().state, "unknown");
  await assert.rejects(() => f.service.execute(scope, ready), /状态未知/);
});
test("changed connection revokes old confirmation before cloud provisioning", async () => {
  const f = fixture();
  const ready = await f.service.prepare(scope, args);
  f.approve();
  f.repository.connection = async () => ({
    connection: {
      id: "default",
      workspaceId: "w",
      region: "cn-beijing",
      templateCode: "changed",
      templateRevision: "v1",
      aliyunUid: "123",
      enabled: true,
    },
    keyVersion: 2,
    credentialFingerprint: "fixture-B",
  });
  await assert.rejects(() => f.service.execute(scope, ready), /变化/);
  assert.equal(f.counts().create, 0);
});
test("release failure preserves downloadable result and durable cleanup compensation", async () => {
  const f = fixture();
  const create = f.provider.create;
  f.provider.create = async () => ({
    ...(await create()),
    release: async () => {
      throw Error("secret transport");
    },
  });
  const plan = await f.service.prepare(scope, args);
  f.approve();
  const result = await f.service.execute(scope, plan);
  assert.equal(result.status, "completed");
  assert.equal(f.job().cleanup, "pending");
});
test("cancel after cloud command prevents artifact publication and still releases instance", async () => {
  const f = fixture(),
    controller = new AbortController();
  const create = f.provider.create;
  f.provider.create = async () => ({
    ...(await create()),
    execute: async () => {
      controller.abort();
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const s = { ...scope, signal: controller.signal };
  const plan = await f.service.prepare(s, args);
  f.approve();
  await assert.rejects(() => f.service.execute(s, plan), /取消|时间/);
  assert.equal(f.job().state, "cancelled");
  assert.equal(f.job().cleanup, "cleaned");
});
test("bootstrap handle survives ambiguous create failure for compensating cleanup", async () => {
  const f = fixture();
  f.provider.create = async () => {
    throw Object.assign(new Error("secret"), { managedSandboxId: "sbx-owned" });
  };
  const plan = await f.service.prepare(scope, args);
  f.approve();
  await assert.rejects(() => f.service.execute(scope, plan), /未知/);
  assert.equal(f.job().sandboxId, "sbx-owned");
  assert.equal(f.job().cleanup, "pending");
});

test("lost acknowledgement after committed artifact publication reuses durable completion", async () => {
  const f = fixture();
  const publish = f.repository.publish;
  f.repository.publish = async (...args) => {
    await publish(...args);
    throw Error("lost acknowledgement");
  };
  const plan = await f.service.prepare(scope, args);
  f.approve();
  const result = await f.service.execute(scope, plan);
  assert.equal(result.status, "completed");
  assert.equal(f.job().state, "completed");
  assert.equal(f.job().cleanup, "cleaned");
});
test("clearing and recreating credential cannot reuse old approval even when numeric version resets", async () => {
  const f = fixture();
  const plan = await f.service.prepare(scope, args);
  f.approve();
  const get = f.repository.connection;
  f.repository.connection = async () =>
    ({
      ...(await get()!),
      credentialFingerprint: "different-key-same-version",
    }) as any;
  await assert.rejects(() => f.service.execute(scope, plan), /变化/);
  assert.equal(f.counts().create, 0);
});
test("known created handle is retained if initial database write and subsequent release fail", async () => {
  const f = fixture();
  const patch = f.repository.patch;
  let first = true;
  f.repository.patch = async (id, p) => {
    if (first && p.sandboxId) {
      first = false;
      throw Error("db temporary");
    }
    await patch(id, p);
  };
  const create = f.provider.create;
  f.provider.create = async () => ({
    ...(await create()),
    release: async () => {
      throw Error("release temporary");
    },
  });
  const plan = await f.service.prepare(scope, args);
  f.approve();
  await assert.rejects(() => f.service.execute(scope, plan));
  assert.equal(f.job().sandboxId, "cloud");
  assert.equal(f.job().cleanup, "pending");
});
test("same-attempt duplicate cannot invalidate an active collecting task", async () => {
  const f = fixture();
  const originalCreate = f.provider.create;
  let arrived!: () => void, resume!: () => void;
  const collecting = new Promise<void>(resolve => { arrived = resolve; });
  const held = new Promise<void>(resolve => { resume = resolve; });
  f.provider.create = async () => {
    const instance = await originalCreate();
    const read = instance.readOutput;
    instance.readOutput = async () => { arrived(); await held; return read(); };
    return instance;
  };
  const publish = f.repository.publish;
  f.repository.publish = async (...values) => {
    assert.equal(f.job().state, "collecting", "duplicate must not overwrite active state");
    return publish(...values);
  };
  const ready = await f.service.prepare(scope, args);
  f.approve();
  const first = f.service.execute(scope, ready);
  await collecting;
  try {
    await assert.rejects(() => f.service.execute(scope, ready), (e: any) => e.code === "SANDBOX_IN_PROGRESS");
  } finally { resume(); }
  assert.equal((await first).status, "completed");
  assert.deepEqual(f.counts(), { create: 1, run: 1, release: 1 });
});
