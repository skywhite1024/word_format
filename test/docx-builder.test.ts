import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/core/docx-builder";
import type { StructuredDoc } from "../src/core/types";

describe("docx-builder", () => {
  it("should enforce black heading color, character indents, and numbered references", async () => {
    const structured: StructuredDoc = {
      mode: "thesis",
      title: "Demo Title",
      blocks: [
        { type: "heading", level: 1, text: "Chapter 1" },
        { type: "paragraph", level: 0, text: "Body paragraph example." },
        { type: "heading", level: 1, text: "References" },
        { type: "reference", level: 0, text: "[9] Reference item sample." },
      ],
      stats: { paragraphCount: 2, headingCount: 2, referenceCount: 1 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const numberingXml = await zip.file("word/numbering.xml")?.async("string");
    expect(documentXml).toBeTruthy();
    expect(numberingXml).toBeTruthy();

    const docContent = documentXml ?? "";
    const numberingContent = numberingXml ?? "";

    expect(docContent).toContain('w:color w:val="000000"');
    expect(docContent).toContain('w:firstLineChars="200"');
    expect(docContent).not.toContain('w:firstLine="420"');
    expect(docContent).toContain('w:hanging="420"');
    expect(docContent).toContain("<w:numPr>");
    expect(docContent).toContain("Reference item sample.");
    expect(docContent).not.toContain("[9] Reference item sample.");

    expect(numberingContent).toContain('w:numFmt w:val="decimal"');
    expect(numberingContent).toContain('w:lvlText w:val="[%1]"');
  });

  it("should render equations as editable math with continuous numbering", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "公式测试",
      blocks: [
        { type: "heading", level: 1, text: "第 1 章 绪论" },
        { type: "paragraph", level: 0, text: "$$R_{\\text{total}} = w_1R_{\\text{task}} + w_2R_{\\text{energy}}$$" },
        { type: "paragraph", level: 0, text: "$$R_{\\text{total}} = w_1R_{\\text{task}} + w_2R_{\\text{energy}}$$" },
        { type: "paragraph", level: 0, text: "表 3-2 算法参数对照表。" },
        { type: "paragraph", level: 0, text: "图 2-1 系统总体架构图。" },
      ],
      stats: { paragraphCount: 4, headingCount: 1, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("R_total");
    expect(docContent).not.toContain("\\text{");
    expect(docContent).toContain("(1)");
    expect(docContent).not.toContain("(2)");
    expect(docContent).toContain("第 1 章　绪论");
    expect(docContent).toContain("表1 算法参数对照表");
    expect(docContent).toContain("图1　系统总体架构图");
  });
});
