import { createContextRef } from "./context-ref";
import type { ContextRef, RunState } from "./context.types";

export type RunStateSessionSnapshot = {
  sessionId: string;
  status?: string;
  messages?: readonly unknown[];
  attachments?: readonly { attachmentId: string; name?: string }[];
  artifacts?: readonly { artifactId: string; type: string; version?: string; status: string }[];
  pendingActions?: readonly { actionId: string; actionType: string; status: string }[];
  linkedRecords?: { projectId?: string };
};

export type RunStateHarnessSnapshot = {
  run: { harnessRunId: string; stage?: string; status?: string };
  artifacts?: readonly {
    harnessArtifactId: string;
    artifactType: string;
    version?: string;
    status: string;
  }[];
  toolEvents?: readonly {
    harnessToolEventId: string;
    actionId?: string | null;
    eventType: string;
    status: string;
  }[];
};

export type BuildRunStateInput = {
  session?: RunStateSessionSnapshot | null;
  harness?: RunStateHarnessSnapshot | null;
};

function uniqueRefs(refs: ContextRef[]): ContextRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.id}:${ref.version ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildRunState(input: BuildRunStateInput): RunState {
  const session = input.session ?? undefined;
  const harness = input.harness ?? undefined;
  const artifacts = [
    ...(session?.artifacts ?? []).map((artifact) => Object.freeze({ ...artifact })),
    ...(harness?.artifacts ?? []).map((artifact) => Object.freeze({
      artifactId: artifact.harnessArtifactId,
      type: artifact.artifactType,
      ...(artifact.version ? { version: artifact.version } : {}),
      status: artifact.status,
    })),
  ];
  const pendingActions = [
    ...(session?.pendingActions ?? [])
      .filter((action) => action.status === "pending")
      .map((action) => Object.freeze({ ...action })),
    ...(harness?.toolEvents ?? [])
      .filter((event) => event.status === "pending")
      .map((event) => Object.freeze({
        actionId: event.actionId || event.harnessToolEventId,
        actionType: event.eventType,
        status: event.status,
      })),
  ];
  const contextRefs: ContextRef[] = [];

  for (const attachment of session?.attachments ?? []) {
    contextRefs.push(createContextRef({
      type: "attachment",
      id: attachment.attachmentId,
      includedInModel: false,
    }));
  }
  if (session?.linkedRecords?.projectId) {
    contextRefs.push(createContextRef({ type: "project", id: session.linkedRecords.projectId }));
  }
  if (harness?.run.harnessRunId) {
    contextRefs.push(createContextRef({ type: "harness", id: harness.run.harnessRunId }));
  }
  for (const artifact of artifacts) {
    contextRefs.push(createContextRef({
      type: "artifact",
      id: artifact.artifactId,
      version: artifact.version,
    }));
  }

  return Object.freeze({
    conversation: Object.freeze({
      ...(session?.sessionId ? { aiSessionId: session.sessionId } : {}),
      messageCount: session?.messages?.length ?? 0,
      ...(session?.status ? { status: session.status } : {}),
    }),
    execution: Object.freeze({
      ...(harness?.run.harnessRunId ? { harnessRunId: harness.run.harnessRunId } : {}),
      ...(harness?.run.stage ? { stage: harness.run.stage } : {}),
      ...(harness?.run.status ? { status: harness.run.status } : {}),
    }),
    artifacts: Object.freeze(artifacts),
    pendingActions: Object.freeze(pendingActions),
    contextRefs: Object.freeze(uniqueRefs(contextRefs)),
  });
}
