import { useEffect, useRef, useState } from "react";
import { fetchSandboxArtifact } from "../../../../api/sandboxArtifacts";
function Artifact({ file }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  const mounted = useRef(true),
    controller = useRef(null),
    url = useRef("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  const expired =
    !Number.isFinite(Date.parse(file.expiresAt)) ||
    Date.parse(file.expiresAt) <= Date.now();
  async function open(asPreview) {
    if (pending || expired) return;
    setPending(true);
    setError("");
    controller.current = new AbortController();
    try {
      const blob = await fetchSandboxArtifact(file.id, {
        preview: asPreview,
        signal: controller.current.signal,
      });
      if (!mounted.current) return;
      const next = URL.createObjectURL(blob);
      if (asPreview) {
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = next;
        setPreview(next);
      } else {
        const a = document.createElement("a");
        a.href = next;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(next), 1000);
      }
    } catch (e) {
      if (mounted.current && e?.name !== "AbortError")
        setError(e?.message || "文件暂不可用，请重试");
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <article
      className="min-w-0 rounded-md border border-line bg-surface p-3"
      aria-label={`文件 ${file.title}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <b className="break-words text-sm text-ink">{file.title}</b>
          <div className="mt-1 text-xs text-ink-3">
            {String(file.format).toUpperCase()} · {Math.ceil(file.size / 1024)}{" "}
            KB ·{" "}
            {expired
              ? "已过期"
              : `保留至 ${new Date(file.expiresAt).toLocaleDateString()}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-out"
            disabled={pending || expired}
            onClick={() => open(false)}
            aria-label={`下载 ${file.title}`}
          >
            {pending ? "读取中…" : "下载"}
          </button>
          {file.format === "html" && (
            <button
              type="button"
              className="btn btn-out"
              disabled={pending || expired}
              onClick={() => open(true)}
              aria-label={`预览 ${file.title}`}
              aria-expanded={!!preview}
            >
              预览
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-err">
          {error}
        </p>
      )}
      {preview && (
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-out mb-2"
            onClick={() => {
              URL.revokeObjectURL(url.current);
              url.current = "";
              setPreview("");
            }}
          >
            关闭预览
          </button>
          <iframe
            title={`预览 ${file.title}`}
            src={preview}
            sandbox=""
            referrerPolicy="no-referrer"
            className="h-96 w-full rounded-md border border-line bg-surface"
          />
        </div>
      )}
    </article>
  );
}
export default function SandboxArtifacts({ artifacts }) {
  const list = Array.isArray(artifacts)
    ? artifacts.filter(
        (f) =>
          f &&
          typeof f.id === "string" &&
          ["html", "docx", "xlsx"].includes(f.format),
      )
    : [];
  if (!list.length) return null;
  return (
    <div
      className="my-3 grid min-w-0 gap-2"
      role="group"
      aria-label="生成的文件"
    >
      {list.map((file) => (
        <Artifact key={file.id} file={file} />
      ))}
    </div>
  );
}
