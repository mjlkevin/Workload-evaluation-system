import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkbenchToolLoop } from "./workbench-tool-loop";
import { ToolRegistry } from "../../agent/tool-registry";
test("server preparation freezes the same arguments for UI, approval and execution", async () => {
  const registry = new ToolRegistry();
  let executed: any;
  const observed: any[] = [];
  registry.register({
    name: "cloud",
    description: "cloud",
    capability: "estimates:read",
    mutates: false,
    exfiltrates: true,
    parameters: { type: "object" },
    prepareForApproval: async (args: any) => ({ ...args, frozen: "server" }),
    execute: async (args: any) => {
      executed = args;
      return { ok: true };
    },
  } as any);
  const out = await runWorkbenchToolLoop({
    messages: [],
    registry,
    agentUser: { id: "u", capabilities: ["estimates:read"] },
    allowToolNames: new Set(),
    injectedToolNames: new Set(["cloud"]),
    toolApprovalGate: async (c) => {
      observed.push(c.arguments);
      return { decision: "execute" };
    },
    onEvent: (e) => {
      if (e.kind === "tool_call") observed.push(e.arguments);
    },
    invoke: async ({ turnOrdinal }) =>
      turnOrdinal === 1
        ? {
            content: "",
            toolCalls: [
              { id: "c", name: "cloud", arguments: { code: "test" } },
            ],
          }
        : { content: "done" },
  });
  assert.equal(out.content, "done");
  assert.deepEqual(executed, { code: "test", frozen: "server" });
  assert.deepEqual(observed, [executed, executed]);
});
test("non-injected tool cannot mark raw model arguments as server-prepared", async () => {
  const registry = new ToolRegistry(), events: any[] = [];
  let prepared = false;
  registry.register({name:"hidden",description:"hidden",capability:"estimates:read",mutates:false,parameters:{type:"object"},prepareForApproval:async(a: any)=>{prepared=true;return a},execute:async()=>{throw Error("must not execute")}} as any);
  await runWorkbenchToolLoop({messages:[],registry,agentUser:{id:"u",capabilities:["estimates:read"]},allowToolNames:new Set(),injectedToolNames:new Set(),onEvent:e=>events.push(e),invoke:async({turnOrdinal})=>turnOrdinal===1?{content:"",toolCalls:[{id:"c",name:"hidden",arguments:{code:"raw"}}]}:{content:"done"}});
  assert.equal(prepared,false);
  assert.notEqual(events.find(e=>e.kind==="tool_call")?.preparedForApproval,true);
});
