import { describe, expect, it, vi } from "vitest";
import { analyzeText } from "../src/core/analyzer";
import JSZip from "jszip";
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

  it("should export docx from preview structured payload without re-structuring", async () => {
    const request = new Request("https://example.com/api/format/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "official",
        useLlm: true,
        text: "这段原文不应进入导出。",
        structured: {
          mode: "official",
          title: "预览结构导出",
          blocks: [
            {
              type: "paragraph",
              level: 0,
              text: "| 损失函数名称 | 数学表达式 | 适用场景 || --- | --- | --- || 均方误差 | $L = (y - \\\\hat{y})^2$ | 回归问题 || 平均绝对误差 | $L = | y - \\\\hat{y} || 交叉熵 | $L = -\\\\sum y \\\\log(\\\\hat{y})$ | 分类问题 |Export to Sheets",
            },
          ],
          stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
        },
      }),
    });

    const response = await worker.fetch(request, {
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Format-Engine")).toBe("preview");
    const bytes = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<w:tbl>");
    expect(docContent).toContain("损失函数名称");
    expect(docContent).not.toContain("这段原文不应进入导出");
    expect(docContent).not.toContain("Export to Sheets");
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
        text: "第一行\\n\\n第二行\\u4E2D\\u6587\\n\\n[\\n\\text{数据} \\rightarrow \\text{模型}\\n]",
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
    expect(data.text).toContain("\\text{数据}");
    expect(data.text).toContain("\\rightarrow");
    expect(data.text).not.toContain("\nightarrow");
  });

  it("should import gemini share content from reader markdown", async () => {
    const originalFetch = globalThis.fetch;
    const readerContent = [
      "Title: Gemini - direct access to Google AI",
      "",
      "URL Source: https://bard.google.com/share/demo",
      "",
      "Markdown Content:",
      "# **高三三角函数常用值与技巧**",
      "",
      "[https://bard.google.com/share/demo](https://bard.google.com/share/demo)",
      "",
      "Created with Pro Published today",
      "",
      "You said",
      "用表格展示高三三角函数常用值",
      "",
      "这是整理后的正文。",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("reader html unavailable"))
        .mockRejectedValueOnce(new Error("gemini root unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockRejectedValueOnce(new Error("bard root unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(readerContent, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
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
      expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toContain(
        "r.jina.ai/http://https://bard.google.com/share/demo",
      );
      expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toBe("https://bard.google.com/");
      expect(vi.mocked(globalThis.fetch).mock.calls[2]?.[0]).toBe(
        "https://api.codetabs.com/v1/proxy?quest=https%3A%2F%2Fbard.google.com%2Fshare%2Fdemo",
      );
      expect(vi.mocked(globalThis.fetch).mock.calls[3]?.[0]).toContain(
        "r.jina.ai/http://https://bard.google.com/share/demo",
      );
      expect(vi.mocked(globalThis.fetch).mock.calls[4]?.[0]).toBe("https://gemini.google.com/");
      expect(vi.mocked(globalThis.fetch).mock.calls[5]?.[0]).toBe(
        "https://api.codetabs.com/v1/proxy?quest=https%3A%2F%2Fgemini.google.com%2Fshare%2Fdemo",
      );
      expect(vi.mocked(globalThis.fetch).mock.calls[6]?.[0]).toContain(
        "r.jina.ai/http://https://gemini.google.com/share/demo",
      );
      expect(vi.mocked(globalThis.fetch).mock.calls[7]?.[0]).toContain(
        "r.jina.ai/http://https://bard.google.com/share/demo",
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should import gemini share content from codetabs reader fallback", async () => {
    const originalFetch = globalThis.fetch;
    const readerContent = [
      "Title: Gemini - direct access to Google AI",
      "",
      "URL Source: https://bard.google.com/share/demo",
      "",
      "Markdown Content:",
      "# **高三三角函数常用值与技巧**",
      "",
      "[https://bard.google.com/share/demo](https://bard.google.com/share/demo)",
      "",
      "Created with Pro Published today",
      "",
      "You said",
      "用表格展示高三三角函数常用值",
      "",
      "这是整理后的正文。",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("reader html unavailable"))
        .mockRejectedValueOnce(new Error("gemini root unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockRejectedValueOnce(new Error("bard root unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockRejectedValueOnce(new Error("reader unavailable"))
        .mockResolvedValueOnce(
          new Response(readerContent, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
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
      expect(vi.mocked(globalThis.fetch).mock.calls[8]?.[0]).toBe(
        "https://api.codetabs.com/v1/proxy?quest=https%3A%2F%2Fr.jina.ai%2Fhttp%3A%2F%2Fhttps%3A%2F%2Fbard.google.com%2Fshare%2Fdemo",
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should skip rate-limited gemini reader output and normalize fallback text", async () => {
    const originalFetch = globalThis.fetch;
    const rateLimitedReader = [
      "Title: Gemini - direct access to Google AI",
      "",
      "URL Source: https://bard.google.com/share/demo",
      "",
      "Markdown Content:",
      '{"code":429,"data":null,"message":"Per IP rate limit exceeded"}',
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("reader html unavailable"))
        .mockRejectedValueOnce(new Error("gemini root unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockRejectedValueOnce(new Error("bard root unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>missing build label</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(rateLimitedReader, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
        )
        .mockRejectedValueOnce(new Error("codetabs reader unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body><main><p>机器学习公式概览</p><p>损失函数与优化方法。</p></main></body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
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
      expect(data.text).not.toContain("Per IP rate limit exceeded");
      expect(data.text).toContain("# 机器学习公式概览");
      expect(data.text).toContain("损失函数与优化方法。");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should import gemini share content from bard rpc before reader fallback", async () => {
    const originalFetch = globalThis.fetch;
    const rpcPayload = JSON.stringify([
      null,
      [
        [
          ["c_demo", "r_demo"],
          null,
          [["详细介绍一下机器学习中的各种公式"], 2, null, 0, "demo", 0, null, null, false, null, []],
          [
            [
              [
                "rc_demo",
                [
                  "下面这份可以当作“机器学习公式总览”。\n\n1. **模型形式 \\(f_\\theta\\) 不同**\n2. **损失函数 \\(L\\) 不同**\n\n### 线性回归\n* **假设函数:** $$y = w^T x + b$$\n    其中 $w$ 是权重向量，$b$ 是偏置。\n* **损失函数 (MSE):**\n    $$J(w, b) = \\frac{1}{2m} \\sum_{i=1}^{m} (h_w(x^{(i)}) - y^{(i)})^2$$\n    它衡量预测值与真实值之间的距离。\n\n\\[\n\\hat{y} = w^T x + b\n\\]",
                ],
              ],
            ],
          ],
          null,
          null,
          null,
          null,
          null,
          true,
          false,
          null,
          [],
          [true, "机器学习公式详解与应用", null, null, null, ["", "", ""], null, [2, "demo", "思考"], true],
          "24f5db20a7b8",
        ],
      ],
    ]);
    const rpcResponse = [")]}'", "512", JSON.stringify([["wrb.fr", "ujx1Bf", rpcPayload, null, null, null, "generic"]])].join("\n");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("reader html unavailable"))
        .mockResolvedValueOnce(
          new Response("<html><body>boq_assistant-bard-web-server_test-build-p0</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(rpcResponse, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
        ),
    );

    try {
      const request = new Request("https://example.com/api/import/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://gemini.google.com/share/24f5db20a7b8",
        }),
      });

      const response = await worker.fetch(request, {
        ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
      } as any);

      expect(response.status).toBe(200);
      const data = (await response.json()) as { source: string; title: string; text: string };
      expect(data.source).toBe("gemini");
      expect(data.title).toBe("机器学习公式详解与应用");
      expect(data.text).toContain("## 你说");
      expect(data.text).toContain("## Gemini");
      expect(data.text).toContain("模型形式");
      expect(data.text).toContain("\\theta");
      expect(data.text).toContain("$f_\\theta$");
      expect(data.text).not.toContain("(f_\\theta)");
      expect(data.text).toContain("\\hat{y} = w^T x + b");
      expect(data.text).toContain("**假设函数:**\n\n$$y = w^T x + b$$");
      expect(data.text).toContain("**损失函数 (MSE):**\n\n$$J(w, b) = \\frac{1}{2m}");

      const structured = analyzeText(data.text, "auto");
      expect(structured.blocks.some((block) => block.text === "$$y = w^T x + b$$")).toBe(true);
      expect(structured.blocks.some((block) => block.text.startsWith("$$J(w, b) = \\frac{1}{2m}"))).toBe(true);
      expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toBe("https://bard.google.com/");
      expect(vi.mocked(globalThis.fetch).mock.calls[2]?.[0]).toContain(
        "https://bard.google.com/_/BardChatUi/data/batchexecute",
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should import chatgpt share content from reader markdown", async () => {
    const originalFetch = globalThis.fetch;
    const readerContent = [
      "Title: 来看看这段对话",
      "",
      "URL Source: https://chatgpt.com/share/demo-id",
      "",
      "Markdown Content:",
      "# ChatGPT - 测试标题",
      "",
      "Skip to content",
      "Chat history",
      "New chat",
      "This is a copy of a conversation between ChatGPT & Anonymous.",
      "Report conversation",
      "请输出一个摘要",
      "",
      "Thought for 31s",
      "",
      "这是导入后的正文内容。",
      "",
      "[",
      "\\text{数据} \\rightarrow \\text{模型} \\rightarrow \\text{评估}",
      "]",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(readerContent, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
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
      expect(data.text).toContain("## 你说");
      expect(data.text).toContain("## ChatGPT");
      expect(data.text).toContain("请输出一个摘要");
      expect(data.text).toContain("这是导入后的正文内容。");
      expect(data.text).toContain("\\text{数据}");
      expect(data.text).toContain("\\rightarrow");
      expect(data.text).not.toContain("\nightarrow");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should prefer chatgpt html payload over reader markdown when available", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            "<html><head><title>机器学习公式介绍</title></head><body>",
            "<h4>你说：</h4><div>详细介绍一下机器学习中的各种公式</div>",
            "<h4>ChatGPT 说：</h4>",
            '<script nonce="test">',
            'window.__reactRouterContext={};window.__reactRouterContext.streamController={enqueue(){}};',
            'window.__reactRouterContext.streamController.enqueue("[{\\"_1\\":2},\\"pageTitle\\",\\"机器学习公式介绍\\",\\"content_type\\",\\"text\\",\\"parts\\",[1],\\"下面这份可以当作“机器学习公式总览”。\\\\n\\\\n1. **模型形式 \\\\\\\\(f_\\\\theta\\\\\\\\) 不同**\\\\n2. **损失函数 \\\\\\\\(L\\\\\\\\) 不同**\\\\n\\\\n\\\\\\\\[\\\\n\\\\hat{y} = w^T x + b\\\\n\\\\\\\\]\\" ]");',
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
      expect(data.title).toBe("机器学习公式介绍");
      expect(data.text).toContain("## 你说");
      expect(data.text).toContain("## ChatGPT");
      expect(data.text).toContain("模型形式");
      expect(data.text).toContain("\\theta");
      expect(data.text).toContain("\\hat{y} = w^T x + b");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should strip serialized chatgpt stream artifacts from imported html content", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            "<html><head><title>机器学习公式介绍</title></head><body>",
            "<h4>你说：</h4><div>详细介绍一下机器学习中的各种公式</div>",
            "<h4>ChatGPT 说：</h4>",
            '<script nonce="test">',
            'window.__reactRouterContext={};window.__reactRouterContext.streamController={enqueue(){}};',
            'window.__reactRouterContext.streamController.enqueue("[{\\"_1\\":2},\\"pageTitle\\",\\"机器学习公式介绍\\",\\"content_type\\",\\"text\\",\\"parts\\",[1],\\"我会按先搭框架再讲公式的方式来讲。\\\\n\\\\n其中目标函数是 \\\\\\\\|w\\\\\\\\|^2。\\",\\"role\\",\\"assistant\\",,\\"_95\\":99,\\"traceId\\",\\"16803574083938886017\\" ]");',
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
      expect(data.text).toContain("目标函数是 \\\\|w\\\\|^2");
      expect(data.text).not.toContain('","role","assistant"');
      expect(data.text).not.toContain("traceId");
      expect(data.text).not.toContain('"_95":99');
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should import chatgpt share content from codetabs html when direct fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("html unavailable"))
        .mockResolvedValueOnce(
          new Response(
            [
              "<html><head><title>机器学习公式介绍</title></head><body>",
              "<h4>你说：</h4><div>详细介绍一下机器学习中的各种公式</div>",
              "<h4>ChatGPT 说：</h4>",
              '<script nonce="test">',
              'window.__reactRouterContext={};window.__reactRouterContext.streamController={enqueue(){}};',
              'window.__reactRouterContext.streamController.enqueue("[{\\"_1\\":2},\\"pageTitle\\",\\"机器学习公式介绍\\",\\"content_type\\",\\"text\\",\\"parts\\",[1],\\"下面这份可以当作“机器学习公式总览”。\\\\n\\\\n1. **模型形式 \\\\\\\\(f_\\\\theta\\\\\\\\) 不同**\\\\n\\\\n\\\\\\\\[\\\\n\\\\hat{y} = w^T x + b\\\\n\\\\\\\\]\\" ]");',
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
      expect(data.title).toBe("机器学习公式介绍");
      expect(data.text).toContain("## 你说");
      expect(data.text).toContain("## ChatGPT");
      expect(data.text).toContain("模型形式");
      expect(data.text).toContain("\\hat{y} = w^T x + b");
      expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toBe(
        "https://api.codetabs.com/v1/proxy?quest=https%3A%2F%2Fchatgpt.com%2Fshare%2Fdemo-id",
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should retry chatgpt share html after cloudflare challenge response", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("challenge", {
            status: 403,
            headers: {
              "cf-mitigated": "challenge",
              "set-cookie": "__cf_bm=test-token; Path=/; Secure; HttpOnly",
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            [
              "<html><head><title>机器学习公式介绍</title></head><body>",
              "<h4>你说：</h4><div>详细介绍一下机器学习中的各种公式</div>",
              "<h4>ChatGPT 说：</h4>",
              '<script nonce="test">',
              'window.__reactRouterContext={};window.__reactRouterContext.streamController={enqueue(){}};',
              'window.__reactRouterContext.streamController.enqueue("[{\\"_1\\":2},\\"pageTitle\\",\\"机器学习公式介绍\\",\\"content_type\\",\\"text\\",\\"parts\\",[1],\\"下面这份可以当作“机器学习公式总览”。\\\\n\\\\n1. **模型形式 \\\\\\\\(f_\\\\theta\\\\\\\\) 不同**\\\\n\\\\n\\\\\\\\[\\\\n\\\\hat{y} = w^T x + b\\\\n\\\\\\\\]\\" ]");',
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
      expect(data.title).toBe("机器学习公式介绍");
      expect(data.text).toContain("## ChatGPT");
      expect(data.text).toContain("\\hat{y} = w^T x + b");

      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[1]?.[1]).toMatchObject({
        headers: expect.any(Headers),
      });
      const retryHeaders = fetchCalls[1]?.[1]?.headers as Headers;
      expect(retryHeaders.get("cookie")).toContain("__cf_bm=test-token");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("should return chatgpt import error after html, codetabs, and reader attempts fail", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("html unavailable"))
        .mockRejectedValueOnce(new Error("codetabs unavailable"))
        .mockRejectedValueOnce(new Error("reader unavailable")),
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

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toContain("ChatGPT");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
