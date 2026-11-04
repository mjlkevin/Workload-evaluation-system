import { useEffect, useId, useRef, useState } from "react";
import { fetchSandboxArtifact } from "../../../../api/sandboxArtifacts";

const actionClass = "inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none";
const iconPaths = {
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 15v5h14v-5" /></>,
  preview: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
function FileIcon({ name, className = "size-4" }) {
  return <svg aria-hidden="true" className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

function Artifact({ file }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const descriptionId = useId(), previewId = useId();
  const mounted = useRef(true), controller = useRef(null);
  const previewButton = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const expired = !Number.isFinite(Date.parse(file.expiresAt)) || Date.parse(file.expiresAt) <= Date.now();
  const isHtml = file.format === "html";
  function closePreview() {
    setPreview("");
    previewButton.current?.focus();
  }
  async function open(asPreview) {
    if (pending || expired) return;
    if (asPreview && preview) { closePreview(); return; }
    setPending(asPreview ? "preview" : "download");
    setError("");
    controller.current = new AbortController();
    try {
      const blob = await fetchSandboxArtifact(file.id, {
        preview: asPreview,
        signal: controller.current.signal,
      });
      if (!mounted.current) return;
      if (asPreview) {
        const documentText = await blob.text();
        if (!mounted.current) return;
        if (!documentText.trim()) throw new Error("预览内容为空，请下载文件查看");
        setPreview(documentText);
      } else {
        const next = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = next;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(next), 1000);
      }
    } catch (e) {
      if (mounted.current && e?.name !== "AbortError") setError(e?.message || "文件暂不可用，请重试");
    } finally {
      if (mounted.current) setPending("");
    }
  }
  return (
    <article className="w-full min-w-0 max-w-xl overflow-hidden rounded-md border border-line bg-surface" aria-label={`文件 ${file.title}`} aria-busy={Boolean(pending)}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 basis-52 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand"><FileIcon name="file" className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 break-words text-sm font-semibold leading-5 text-ink">{file.title}</h3>
            <div id={descriptionId} className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-ink-2">
              <span className="min-w-0 break-all">{file.name}</span>
              <span aria-hidden="true" className="text-line-2">·</span>
              <span>{String(file.format).toUpperCase()}</span>
              <span className="tabular-nums">{Math.ceil(file.size / 1024)} KB</span>
              <span aria-hidden="true" className="text-line-2">·</span>
              {expired ? <span>已过期</span> : <span>保留至 <time dateTime={file.expiresAt}>{new Date(file.expiresAt).toLocaleDateString()}</time></span>}
            </div>
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          {isHtml && <button ref={previewButton} type="button"
            className={`${actionClass} ${preview ? "border-brand/20 bg-brand-soft text-brand-ink hover:bg-bg-2" : "border-brand bg-brand text-surface hover:bg-brand-ink"}`}
            disabled={Boolean(pending) || expired} onClick={() => open(true)}
            aria-label={`${preview ? "收起预览" : "预览"} ${file.title}`} aria-expanded={Boolean(preview)} aria-controls={preview ? previewId : undefined}
            aria-describedby={descriptionId} aria-busy={pending === "preview"}>
            <FileIcon name={preview ? "close" : "preview"} />
            {pending === "preview" ? "加载预览…" : preview ? "收起预览" : "预览"}
          </button>}
          <button type="button"
            className={`${actionClass} ${isHtml ? "border-line bg-surface text-ink-2 hover:bg-bg-soft" : "border-brand bg-brand text-surface hover:bg-brand-ink"}`}
            disabled={Boolean(pending) || expired} onClick={() => open(false)}
            aria-label={`下载 ${file.title}`} aria-describedby={descriptionId} aria-busy={pending === "download"}>
            <FileIcon name="download" />{pending === "download" ? "下载中…" : "下载"}
          </button>
        </div>
      </div>
      {pending && <span role="status" className="sr-only">{pending === "preview" ? "正在加载文件预览" : "正在读取下载文件"}</span>}
      {error && <p role="alert" className="mx-4 mt-0 mb-4 rounded-md bg-err-soft px-3 py-2 text-xs leading-5 text-err-ink">{error}</p>}
      {preview && <section id={previewId} aria-label={`文件预览 ${file.title}`} className="min-w-0 border-t border-line bg-bg">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="text-xs font-medium text-ink-2">文件预览</span>
          <button type="button" className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-1 text-xs text-ink-2 hover:text-brand focus-visible:outline-2 focus-visible:outline-brand" onClick={closePreview}>
            <FileIcon name="close" className="size-3.5" />关闭预览
          </button>
        </div>
        {/* Preserve the authorized response and its CSP verbatim inside a strict sandbox.
            srcDoc avoids blank Blob navigation in the embedded browser. */}
        <iframe title={`预览 ${file.title}`} srcDoc={preview} sandbox="" referrerPolicy="no-referrer" className="block h-80 w-full border-0 bg-surface sm:h-96" />
      </section>}
    </article>
  );
}
export default function SandboxArtifacts({ artifacts }) {
  const list = Array.isArray(artifacts) ? artifacts.filter(f => f && typeof f.id === "string" && ["html", "docx", "xlsx"].includes(f.format)) : [];
  if (!list.length) return null;
  return (
    <div className="my-3 grid min-w-0 gap-2" role="group" aria-label="生成的文件">
      {list.map(file => <Artifact key={file.id} file={file} />)}
    </div>
  );
}
