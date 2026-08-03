export class KnowledgeBaseUrlPolicyError extends Error {
  constructor(message = "knowledge_base_url_not_allowed") {
    super(message);
    this.name = "KnowledgeBaseUrlPolicyError";
  }
}

export function assertAllowedZhipuUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw new KnowledgeBaseUrlPolicyError();
  }
  const portAllowed = !url.port || url.port === "443";
  if (
    url.protocol !== "https:"
    || url.hostname !== "open.bigmodel.cn"
    || Boolean(url.username)
    || Boolean(url.password)
    || !portAllowed
  ) {
    throw new KnowledgeBaseUrlPolicyError();
  }
  return url;
}
