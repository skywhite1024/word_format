import type { StructuredDoc } from "./types";

export function renderPreview(structured: StructuredDoc): string {
  const lines: string[] = [];
  if (structured.title) {
    lines.push(structured.title);
    lines.push("");
  }

  for (const block of structured.blocks) {
    if (block.type === "heading") {
      lines.push(block.text);
    } else if (block.type === "formula") {
      lines.push(`[公式] ${block.text}`);
    } else if (block.type === "reference") {
      lines.push(`[参考] ${block.text}`);
    } else {
      lines.push(`　　${block.text}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
