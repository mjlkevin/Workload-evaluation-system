import { getToken, clearToken } from "./auth";
export async function fetchSandboxArtifact(
  id,
  { preview = false, signal } = {},
) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("文件引用无效");
  const token = getToken();
  if (!token) throw new Error("请先登录");
  const response = await fetch(
    `/api/v1/ai-artifacts/${id}/${preview ? "preview" : "download"}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    },
  );
  if (response.status === 401) {
    clearToken();
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "文件暂不可用，请重试");
  }
  return response.blob();
}
