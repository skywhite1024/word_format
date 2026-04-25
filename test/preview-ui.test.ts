import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function createElementStub() {
  return {
    value: "",
    checked: false,
    disabled: false,
    innerHTML: "",
    textContent: "",
    addEventListener() {},
    focus() {},
    click() {},
  };
}

function loadPreviewContext(): {
  renderStructuredPreview: (structured: unknown, options?: { expanded?: boolean }) => string;
} {
  const code = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const elements = new Map<string, ReturnType<typeof createElementStub>>();
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: async () => ({ ok: false, headers: { get: () => "" }, json: async () => ({}) }),
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    document: {
      getElementById(id: string) {
        if (!elements.has(id)) {
          elements.set(id, createElementStub());
        }
        return elements.get(id);
      },
      createElement: createElementStub,
    },
    window: { open: () => null },
  });

  vm.runInContext(code, context);
  return context as unknown as {
    renderStructuredPreview: (structured: unknown, options?: { expanded?: boolean }) => string;
  };
}

describe("preview ui", () => {
  it("should render equation blocks as formatted math preview instead of raw latex", () => {
    const { renderStructuredPreview } = loadPreviewContext();
    const html = renderStructuredPreview({
      mode: "official",
      title: "机器学习公式介绍",
      stats: { paragraphCount: 2, headingCount: 1, referenceCount: 0 },
      blocks: [
        { type: "heading", level: 1, text: "1. 机器学习里最核心的总公式" },
        {
          type: "paragraph",
          level: 0,
          text: String.raw`$$\min_{\theta} \; J(\theta)=\frac{1}{n}\sum_{i=1}^{n} L\big(f_\theta(x_i),y_i\big)+\lambda\,\Omega(\theta)$$`,
        },
        {
          type: "paragraph",
          level: 0,
          text: "[\n\\text{数据} \\rightarrow \\text{模型} \\rightarrow \\text{评估}\n]",
        },
      ],
    });

    expect(html).toContain('class="math-frac"');
    expect(html).toContain("∑");
    expect(html).toContain("θ");
    expect(html).toContain("Ω");
    expect(html).toContain("→");
    expect(html).not.toContain("\\frac");
    expect(html).not.toContain("\\sum");
    expect(html).not.toContain("\\Omega");
    expect(html).not.toContain("rightarrow");
    expect(html).not.toContain("ightarrow");
  });

  it("should keep the large preview container cheap to scroll", () => {
    const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

    expect(css).not.toMatch(/\.preview-card\s*\{[^}]*position:\s*sticky/s);
    expect(css).not.toContain("radial-gradient");
    expect(css).not.toContain("blur(18px)");
    expect(css).toContain("content-visibility: auto");
    expect(css).toContain("contain-intrinsic-size");
    expect(css).toMatch(/\.card\s*\{[^}]*backdrop-filter:\s*none/s);
    expect(css).toMatch(/\.preview-card\s*\{[^}]*backdrop-filter:\s*none/s);
  });

  it("should render inline math inside preview tables", () => {
    const { renderStructuredPreview } = loadPreviewContext();
    const html = renderStructuredPreview({
      mode: "official",
      title: "table math",
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: [
            "| loss | formula | scene |",
            "| --- | --- | --- |",
            "| MSE | $L = (y - \\hat{y})^2$ | regression |",
            "| MAE | $L = |y - \\hat{y}|$ | robust |",
            "| CE | $L = -\\sum y \\log(\\hat{y})$ | classification |",
          ].join("\n"),
        },
      ],
    });

    expect(html).toContain("<table>");
    expect(html).toContain('class="inline-math"');
    expect(html).not.toContain("\\hat");
    expect(html).not.toContain("\\sum");
    expect(html).not.toContain("$L =");
  });

  it("should limit very large previews by default and allow full rendering on demand", () => {
    const { renderStructuredPreview } = loadPreviewContext();
    const blocks = Array.from({ length: 260 }, (_item, index) => ({
      type: "paragraph",
      level: 0,
      text: index === 259 ? "hidden-tail-marker" : `正文 ${index + 1}`,
    }));

    const limitedHtml = renderStructuredPreview({
      mode: "official",
      title: "性能测试",
      stats: { paragraphCount: blocks.length, headingCount: 0, referenceCount: 0 },
      blocks,
    });
    const expandedHtml = renderStructuredPreview(
      {
        mode: "official",
        title: "性能测试",
        stats: { paragraphCount: blocks.length, headingCount: 0, referenceCount: 0 },
        blocks,
      },
      { expanded: true },
    );

    expect(limitedHtml).toContain("preview-limit-notice");
    expect(limitedHtml).toContain('data-action="expand-preview"');
    expect(limitedHtml).not.toContain("hidden-tail-marker");
    expect(expandedHtml).not.toContain("preview-limit-notice");
    expect(expandedHtml).toContain("hidden-tail-marker");
  });
});
