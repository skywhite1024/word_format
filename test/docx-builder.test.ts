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
});
