import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { fetchSandboxArtifact } from "../api/sandboxArtifacts";
import ToolCallChip from "../pages/AiHomeWorkbench/components/ChatArea/ToolCallChip.jsx";
import { reduceToolCallTrail, mapSessionMessages } from "../pages/AiHomeWorkbench/utils/messageFormatter.js";
import SandboxArtifacts from "../pages/AiHomeWorkbench/components/ChatArea/SandboxArtifacts.jsx";
vi.mock("../api/sandboxArtifacts", () => ({
  fetchSandboxArtifact: vi.fn(
    async () => new Blob(["<html>safe</html>"], { type: "text/html" }),
  ),
}));
const file = {
  id: "3ed53b24-a2ee-4ecb-9137-f47439992c50",
  name: "report.html",
  title: "需求报告",
  format: "html",
  size: 100,
  expiresAt: "2099-01-01T00:00:00Z",
};
describe("Sandbox artifact delivery", () => {
  it("renders the exact authorized preview document including its CSP inside the isolated frame", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
    const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'"><h1>报告正文</h1>';
    fetchSandboxArtifact.mockResolvedValueOnce(new Blob([html], { type: "text/html" }));
    render(<SandboxArtifacts artifacts={[file]} />);
    fireEvent.click(screen.getByRole("button", { name: "预览 需求报告" }));
    const frame = await screen.findByTitle("预览 需求报告");
    expect(frame).toHaveAttribute("srcdoc", html);
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.queryByRole("heading", { name: "报告正文" })).not.toBeInTheDocument();
  });
  it("keeps non-HTML files download-only", () => {
    render(<SandboxArtifacts artifacts={[{ ...file, format: "xlsx", name: "estimate.xlsx" }]} />);
    expect(screen.getByText("estimate.xlsx")).toBeVisible();
    expect(screen.getByRole("button", { name: "下载 需求报告" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /预览/ })).not.toBeInTheDocument();
  });
  it("downloads through the existing request with the original filename", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:download"), revokeObjectURL: vi.fn() });
    const anchors = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      anchors.push({ name: this.download, href: this.href });
    });
    render(<SandboxArtifacts artifacts={[file]} />);
    fireEvent.click(screen.getByRole("button", { name: "下载 需求报告" }));
    await waitFor(() => expect(anchors).toEqual([{ name: "report.html", href: "blob:download" }]));
    expect(fetchSandboxArtifact).toHaveBeenLastCalledWith(file.id, expect.objectContaining({ preview: false }));
  });
  it("shows the actual filename alongside the report title", () => {
    render(<SandboxArtifacts artifacts={[file]} />);
    expect(screen.getByRole("heading", { name: "需求报告" })).toBeVisible();
    expect(screen.getByText("report.html")).toBeVisible();
    expect(screen.getByText("HTML")).toBeVisible();
  });
  it("marks the preview action busy without mislabeling the download action", async () => {
    let finish;
    fetchSandboxArtifact.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
    render(<SandboxArtifacts artifacts={[file]} />);
    const preview = screen.getByRole("button", { name: "预览 需求报告" });
    const download = screen.getByRole("button", { name: "下载 需求报告" });
    fireEvent.click(preview);
    expect(preview).toHaveAttribute("aria-busy", "true");
    expect(preview).toHaveTextContent("加载预览");
    expect(download).toHaveTextContent("下载");
    expect(download).toBeDisabled();
    await act(async () => finish(new Blob(["<html>safe</html>"])));
  });
  it("collapses the open preview from the same action, clears the document and restores focus", async () => {
    const fetchCount = fetchSandboxArtifact.mock.calls.length;
    const create = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    render(<SandboxArtifacts artifacts={[file]} />);
    const preview = screen.getByRole("button", { name: "预览 需求报告" });
    fireEvent.click(preview);
    await screen.findByTitle("预览 需求报告");
    expect(preview).toHaveAttribute("aria-expanded", "true");
    expect(preview).toHaveTextContent("收起预览");
    fireEvent.click(preview);
    expect(screen.queryByTitle("预览 需求报告")).not.toBeInTheDocument();
    expect(preview).toHaveAttribute("aria-expanded", "false");
    expect(preview).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
    expect(fetchSandboxArtifact.mock.calls.length).toBe(fetchCount + 1);
  });
  it("exposes saved file and isolated preview without scripts or same origin", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
    render(<SandboxArtifacts artifacts={[file]} />);
    expect(screen.getByText("需求报告")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览 需求报告" }));
    const frame = await screen.findByTitle("预览 需求报告");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).not.toHaveAttribute("allow-scripts");
    expect(frame).toHaveAttribute("srcdoc", "<html>safe</html>");
    expect(frame).not.toHaveAttribute("src");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });
  it("blocks expired artifact", async () => {
    render(
      <SandboxArtifacts
        artifacts={[{ ...file, expiresAt: "2020-01-01T00:00:00Z" }]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "下载 需求报告" }),
    ).toBeDisabled();
    expect(screen.getByText(/已过期/)).toBeInTheDocument();
  });
});

it("reports download failure without opening a phantom file", async () => {
  fetchSandboxArtifact.mockRejectedValueOnce(new Error("文件已失效，请重新生成"));
  const create = vi.fn();
  vi.stubGlobal("URL", {createObjectURL: create, revokeObjectURL: vi.fn()});
  render(<SandboxArtifacts artifacts={[file]} />);
  fireEvent.click(screen.getByRole("button", {name:"下载 需求报告"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("文件已失效，请重新生成");
  expect(create).not.toHaveBeenCalled();
});
it("rebuilds delivered files from live events and stored message metadata", () => {
  const calls = reduceToolCallTrail([
    {eventType:"tool.call.started", payload:{name:"sandbox_execute",callIndex:1}},
    {eventType:"tool.call.completed", payload:{name:"sandbox_execute",callIndex:1,artifacts:[{...file,storageKey:"private"}]}}
  ]);
  expect(calls[0].artifacts).toEqual([file]);
  const messages = mapSessionMessages({messages:[{id:"a",role:"assistant",content:"已生成",metadata:{toolCalls:calls}}]});
  expect(messages[0].toolCalls[0].artifacts).toEqual([file]);
  expect(JSON.stringify(messages)).not.toContain("storageKey");
});
it("shows frozen materials, formats and complete code before approving", () => {
  const approve = vi.fn(), code = "x".repeat(120000) + "SUFFIX";
  const call = {name:"sandbox_execute",status:"awaiting_approval",approval:{actionId:"frozen-action",arguments:{code,_sandboxPlan:{title:"生成需求报告",materials:[{name:"source.txt"}],outputs:[{format:"docx"}],maxSeconds:300}}}};
  render(<ToolCallChip call={call} onApprove={approve} />);
  expect(screen.getByLabelText("云端处理确认")).toHaveTextContent("source.txt");
  expect(screen.getByLabelText("云端处理确认")).toHaveTextContent("DOCX");
  expect(screen.getByText(code)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"同意 sandbox_execute"}));
  expect(approve).toHaveBeenCalledWith(call);
});
