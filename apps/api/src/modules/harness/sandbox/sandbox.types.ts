import type { SandboxConnection } from "../../../services/sandbox/sandbox-provider";
export type SandboxFormat = "html" | "docx" | "xlsx";
export type SandboxRequest = {
  title: string;
  language: "python" | "node";
  code: string;
  inputs: { sourceId: string; name: string }[];
  outputs: { path: string; format: SandboxFormat; title: string }[];
};
export type SandboxScope = {
  ownerId: string;
  sessionId: string;
  runId: string;
  attemptId: string;
  ordinal: number;
  stepKey: string;
  signal?: AbortSignal;
};
export type SandboxMaterial = {
  sourceId: string;
  name: string;
  sha256: string;
  bytes: Buffer;
};
export type SandboxPlan = {
  jobId: string;
  title: string;
  language: string;
  materials: { sourceId: string; name: string; sha256: string }[];
  outputs: SandboxRequest["outputs"];
  connectionHash: string;
  maxSeconds: number;
  digest: string;
};
export type SandboxJob = {
  id: string;
  ownerId: string;
  sessionId: string;
  runId: string;
  ordinal: number;
  requestDigest: string;
  request: SandboxRequest;
  plan: SandboxPlan;
  state: string;
  sandboxId: string | null;
  cleanup: string;
  result: Record<string, unknown> | null;
  execution?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};
export type SandboxArtifact = {
  id: string;
  jobId: string;
  ownerId: string;
  sessionId: string;
  runId: string;
  name: string;
  title: string;
  format: SandboxFormat;
  mimeType: string;
  sha256: string;
  size: number;
  expiresAt: Date;
};
export type SandboxConnectionRecord = {
  connection: SandboxConnection;
  keyVersion: number;
  credentialFingerprint?: string;
};
export interface SandboxRepository {
  connection(): Promise<SandboxConnectionRecord | null>;
  assertScope(scope: SandboxScope): Promise<void>;
  sources(
    scope: SandboxScope,
    inputs: SandboxRequest["inputs"],
  ): Promise<SandboxMaterial[]>;
  findJob(runId: string, ordinal: number): Promise<SandboxJob | null>;
  insertJob(job: SandboxJob): Promise<SandboxJob>;
  approval(
    scope: SandboxScope,
    args: Record<string, unknown>,
  ): Promise<boolean>;
  claim(jobId: string, scope: SandboxScope): Promise<boolean>;
  patch(
    jobId: string,
    patch: Partial<
      Pick<
        SandboxJob,
        "state" | "sandboxId" | "cleanup" | "result" | "execution"
      >
    >,
  ): Promise<void>;
  publish(
    job: SandboxJob,
    artifacts: SandboxArtifact[],
    result: Record<string, unknown>,
    scope: SandboxScope,
  ): Promise<void>;
}
export class SandboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
