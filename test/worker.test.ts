import { describe, expect, it } from "vitest";
import worker from "../src/worker";

describe("worker api", () => {
  it("should return structured result", async () => {
    const request = new Request("https://example.com/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "official",
        useLlm: false,
        text: "测试标题\n\n一、章节\n\n正文内容",
      }),
    });

    const response = await worker.fetch(request, {
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as any);

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      structured: { stats: { headingCount: number } };
    };
    expect(data.structured.stats.headingCount).toBe(1);
    expect((data as any).meta.engine).toBe("rule");
  });

  it("should return docx binary", async () => {
    const request = new Request("https://example.com/api/format/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "thesis",
        useLlm: false,
        text: "论文标题\n\n摘要\n\n测试内容\n\n参考文献\n\n[1] 张三. 示例文献.",
      }),
    });

    const response = await worker.fetch(request, {
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it("should sanitize markdown input before analysis", async () => {
    const request = new Request("https://example.com/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "official",
        useLlm: false,
        text: "## 测试标题\n\n**一、章节**\n\n- 正文内容",
      }),
    });

    const response = await worker.fetch(request, {
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as any);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.structured.title).toBe("测试标题");
    expect(data.previewText).not.toContain("##");
    expect(data.previewText).not.toContain("**");
  });
});
