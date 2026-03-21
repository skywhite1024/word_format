import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/core/docx-builder";
import type { StructuredDoc } from "../src/core/types";

describe("docx-builder", () => {
  it("should enforce black heading color and proper indents", async () => {
    const structured: StructuredDoc = {
      mode: "thesis",
      title: "示例标题",
      blocks: [
        { type: "heading", level: 1, text: "一、一级标题" },
        { type: "paragraph", level: 0, text: "正文段落示例。" },
        { type: "heading", level: 1, text: "参考文献" },
        { type: "reference", level: 0, text: "[1] 张三. 参考文献示例." },
      ],
      stats: { paragraphCount: 2, headingCount: 2, referenceCount: 1 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toBeTruthy();

    const content = xml ?? "";
    expect(content).toContain('w:color w:val="000000"');
    expect(content).toContain('w:firstLine="420"');
    expect(content).toContain('w:hanging="420"');
  });
});
