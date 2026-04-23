import { describe, expect, it, vi } from "vitest";
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

  it("should repair escaped text payload", async () => {
    const request = new Request("https://example.com/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "第一行\\n\\n第二行\\u4E2D\\u6587",
      }),
    });

    const response = await worker.fetch(request, {
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as any);

    expect(response.status).toBe(200);
    const data = (await response.json()) as { text: string; changed: boolean };
    expect(data.changed).toBe(true);
    expect(data.text).toContain("第一行");
    expect(data.text).toContain("第二行中文");
  });

  it("should import gemini share content from reader markdown", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            "Title: Gemini - direct access to Google AI",
            "",
            "URL Source: https://gemini.google.com/share/demo",
            "",
            "Markdown Content:",
            "# **高三三角函数常用值与技巧**",
            "",
            "[https://gemini.google.com/share/demo](https://gemini.google.com/share/demo)",
            "",
            "Created with Pro Published today",
            "",
            "You said",
            "用表格展示高三三角函数常用值",
            "",
            "这是整理后的正文。",
          ].join("\n"),
          {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        ),
      ),
    );

    try {
      const request = new Request("https://example.com/api/import/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://gemini.google.com/share/demo",
        }),
      });

      const response = await worker.fetch(request, {
        ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
      } as any);

      expect(response.status).toBe(200);
      const data = (await response.json()) as { source: string; title: string; text: string };
      expect(data.source).toBe("gemini");
      expect(data.title).toBe("高三三角函数常用值与技巧");
      expect(data.text).toContain("## 你说");
      expect(data.text).toContain("这是整理后的正文。");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should import chatgpt share content from page html", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            "<html><head><title>ChatGPT - 测试标题</title></head><body>",
            '<script>window.__reactRouterContext={};window.__reactRouterContext.streamController={enqueue(){}};</script>',
            '<script nonce="test">',
            'window.__reactRouterContext.streamController.enqueue("[{\\"_1\\":2},\\"pageTitle\\",\\"测试标题\\",\\"content_type\\",\\"text\\",\\"parts\\",[1],\\"请输出一个摘要\\",\\"content_type\\",\\"text\\",\\"parts\\",[2],\\"这是导入后的正文内容。\\"]");',
            "</script>",
            "</body></html>",
          ].join(""),
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        ),
      ),
    );

    try {
      const request = new Request("https://example.com/api/import/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://chatgpt.com/share/demo-id",
        }),
      });

      const response = await worker.fetch(request, {
        ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
      } as any);

      expect(response.status).toBe(200);
      const data = (await response.json()) as { source: string; title: string; text: string };
      expect(data.source).toBe("chatgpt");
      expect(data.title).toBe("测试标题");
      expect(data.text).toContain("# 测试标题");
      expect(data.text).toContain("请输出一个摘要");
      expect(data.text).toContain("这是导入后的正文内容。");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
