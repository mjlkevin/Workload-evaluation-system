export type SandboxArtifactReference = {
  id: string;
  name: string;
  title: string;
  format: "html" | "docx" | "xlsx";
  size: number;
  expiresAt: string;
};
export function sandboxArtifactReferences(
  value: unknown,
): SandboxArtifactReference[] | undefined {
  const x = value as any;
  if (
    !x ||
    x.status !== "completed" ||
    !Array.isArray(x.artifacts) ||
    x.artifacts.length > 5
  )
    return;
  const out = x.artifacts
    .filter(
      (a: any) =>
        a &&
        /^[a-f0-9-]{36}$/i.test(a.id) &&
        typeof a.name === "string" &&
        /^[a-zA-Z0-9._-]{1,101}$/.test(a.name) &&
        typeof a.title === "string" &&
        a.title.length <= 160 &&
        ["html", "docx", "xlsx"].includes(a.format) &&
        Number.isSafeInteger(a.size) &&
        a.size > 0 &&
        a.size <= 20 * 1024 * 1024 &&
        typeof a.expiresAt === "string" &&
        Number.isFinite(Date.parse(a.expiresAt)),
    )
    .map(
      ({
        id,
        name,
        title,
        format,
        size,
        expiresAt,
      }: SandboxArtifactReference) => ({
        id,
        name,
        title,
        format,
        size,
        expiresAt,
      }),
    );
  return out.length ? out : undefined;
}
