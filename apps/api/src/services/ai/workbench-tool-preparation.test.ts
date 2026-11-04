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
test("closing a model stream closes provider and cannot cache late output", async () => {
  const { runWorkbenchToolLoopStream } = await import("./workbench-tool-loop");
  let closed = false, written = false, resume!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; });
  const stream = runWorkbenchToolLoopStream({messages:[],registry:new ToolRegistry(),agentUser:{id:"u",capabilities:[]},allowToolNames:new Set(),modelTurns:{read:async()=>undefined,save:async(_,out)=>{written=true;return out}},invokeStream:async function*(){try{yield {contentDelta:"first",model:"fixture",finishReason:"stop"};await held;yield {contentDelta:"late"};}finally{closed=true}}});
  await stream.next();
  await stream.return(undefined as any);
  resume();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(closed,true);
  assert.equal(written,false,"no model cache may commit after consumer cancellation");
});
test("model cache retains visible completion metadata and excludes reasoning", async () => {
  const {runWorkbenchToolLoopStream}=await import("./workbench-tool-loop");
  let saved:any, invokes=0;
  const input={messages:[],registry:new ToolRegistry(),agentUser:{id:"u",capabilities:[]},allowToolNames:new Set<string>(),modelTurns:{read:async()=>saved,save:async(_:number,value:any)=>(saved=JSON.parse(JSON.stringify(value)))},invokeStream:async function*(){invokes++;yield {contentDelta:"visible",reasoningContentDelta:"private-reasoning",model:"fixture-model",finishReason:"stop"}}};
  for await (const _ of runWorkbenchToolLoopStream(input)) {}
  const replay=[];
  for await (const c of runWorkbenchToolLoopStream(input)) replay.push(c);
  assert.equal(invokes,1);
  assert.equal(replay.at(-1)?.model,"fixture-model");
  assert.equal(replay.at(-1)?.finishReason,"stop");
  assert.equal(JSON.stringify(saved).includes("private-reasoning"),false);
});
test("partial model failure cannot save a decision or execute tools", async()=>{
  const {runWorkbenchToolLoopStream}=await import("./workbench-tool-loop");
  let saved=false;
  const stream=runWorkbenchToolLoopStream({messages:[],registry:new ToolRegistry(),agentUser:{id:"u",capabilities:[]},allowToolNames:new Set(),modelTurns:{read:async()=>undefined,save:async(_,value)=>{saved=true;return value}},invokeStream:async function*(){yield {contentDelta:"partial"};throw Error("fixture-offline")}});
  await assert.rejects(async()=>{for await(const _ of stream){}},/fixture-offline/);
  assert.equal(saved,false);
});
