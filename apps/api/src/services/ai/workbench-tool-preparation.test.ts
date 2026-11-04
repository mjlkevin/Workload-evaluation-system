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

test("ordinary tool approval still regenerates arguments until a sandbox decision activates caching", async () => {
  const registry = new ToolRegistry(), saved = new Map<number, any>(), asked: string[] = [];
  registry.register({name:"ordinary_write",description:"write",capability:"estimates:read",mutates:true,parameters:{type:"object"},execute:async()=>{throw Error("pending must not execute")}});
  const modelTurns = {activationTool:"sandbox_execute",read:async(n:number)=>saved.get(n),save:async(n:number,value:any)=>{saved.set(n,value);return value}};
  for (const project of ["first", "changed"]) {
    await assert.rejects(runWorkbenchToolLoop({messages:[],registry,agentUser:{id:"u",capabilities:["estimates:read"]},allowToolNames:new Set(),modelTurns,
      toolApprovalGate:async call=>{asked.push(String(call.arguments.project));throw Error("pending")},
      invoke:async()=>({content:"",toolCalls:[{id:"write",name:"ordinary_write",arguments:{project}}]})}),/pending/);
  }
  assert.deepEqual(asked,["first","changed"]);
  assert.equal(saved.size,0,"ordinary approvals must retain their existing regeneration semantics");
});

test("first sandbox decision freezes earlier model turns so preceding tool ordinals survive resume", async () => {
  const {runWorkbenchToolLoopStream} = await import("./workbench-tool-loop");
  const registry = new ToolRegistry(), saved = new Map<number,any>(), effects = new Map<number,any>();
  const invoked:number[] = [], preparedOrdinals:number[] = [], executedCodes:string[] = [];
  let approved = false, reads = 0;
  registry.register({name:"lookup",description:"read",capability:"estimates:read",mutates:false,parameters:{type:"object"},execute:async()=>{reads++;return {data:"owned"}}});
  registry.register({name:"sandbox_execute",description:"cloud",capability:"estimates:read",mutates:false,exfiltrates:true,parameters:{type:"object"},
    prepareForApproval:async(args,_,runtime)=>{preparedOrdinals.push(runtime!.toolOrdinal!);return args},execute:async(args)=>{executedCodes.push(String(args.code));return {status:"completed"}}});
  const input: Parameters<typeof runWorkbenchToolLoopStream>[0] = {messages:[],registry,agentUser:{id:"u",capabilities:["estimates:read"]},runtime:{actor:{userId:"u"}} as any,allowToolNames:new Set(["lookup"]),
    modelTurns:{activationTool:"sandbox_execute",read:async(n:number)=>saved.get(n),save:async(n:number,value:any)=>{saved.set(n,structuredClone(value));return saved.get(n)}},
    recordToolEffect:async(n:number,execute:any)=>{if(effects.has(n))return effects.get(n);const out=await execute();effects.set(n,out);return out},
    toolApprovalGate:async()=>{if(!approved)throw Error("pending");return {decision:"execute" as const}},
    invokeStream:async function*({turnOrdinal}:{turnOrdinal:number}){invoked.push(turnOrdinal);if(turnOrdinal===1)yield {contentDelta:"",toolCalls:[{id:"lookup-call",name:"lookup",arguments:{}}]};
      else if(turnOrdinal===2)yield {contentDelta:"",toolCalls:[{id:"cloud-call",name:"sandbox_execute",arguments:{code:approved?"changed-code":"frozen-code"}}]};else yield {contentDelta:"done",model:"fixture",finishReason:"stop"}}};
  await assert.rejects(async()=>{for await(const _ of runWorkbenchToolLoopStream(input)){}},/pending/);
  assert.deepEqual([...saved.keys()],[1,2]);
  approved = true;
  for await(const _ of runWorkbenchToolLoopStream(input)){}
  assert.deepEqual(invoked,[1,2,3]);
  assert.deepEqual(preparedOrdinals,[2,2]);
  assert.deepEqual(executedCodes,["frozen-code"]);
  assert.equal(reads,1);
});
