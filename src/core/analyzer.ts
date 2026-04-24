import type { Block, Mode, StructuredDoc } from "./types";

const SENTENCE_ENDINGS = ["。", "！", "？", "；", "：", ".", "!", "?", ";", ":"];
const THESIS_HINTS = ["摘要", "ABSTRACT", "目录", "参考文献", "关键词", "致谢"];
const MD_HEADING_PREFIX = "@@MDHEADING@@";

function stripCitationArtifacts(text: string): string {
  return text
    .replace(/\[cite_start\]/gi, "")
    .replace(/\[cite_end\]/gi, "")
    .replace(/\[source_start\]/gi, "")
    .replace(/\[source_end\]/gi, "")
    .replace(/\[(?:cite|source)\s*:\s*[^\]]*?\]/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/（\s*）/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function sanitizeMarkdownText(rawText: string): string {
  const unified = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutFences = unified.replace(/^```[\w-]*\s*$/gm, "");

  const cleaned = withoutFences
    .replace(
      /(^|\n)([ \t]{0,3})(#{1,6})[ \t]+([^\n]*)/g,
      (_match, prefix: string, indent: string, hashes: string, content: string) => {
        const trimmed = content.trim();
        if (/^\\[A-Za-z]+/.test(trimmed)) {
          return `${prefix}${indent}${hashes} ${trimmed}`;
        }
        return `${prefix}${indent}${MD_HEADING_PREFIX}${Math.min(hashes.length, 3)} ${trimmed}`;
      },
    )
    .replace(/(^|\n)[ \t]{0,3}>[ \t]?/g, "$1")
    .replace(/(^|\n)[ \t]*([-*_])[ \t]*\2[ \t]*\2(?:[ \t]*\2+)?[ \t]*(?=\n|$)/g, "$1")
    .replace(/^([ \t]*[-+*][ \t]+)/gm, "")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1")
    .replace(/~~([\s\S]+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/(^|[\s(（“"'‘])\*([^*\n]+?)\*(?=([\s)）”"'’，。！？；：,.;!?]|$))/g, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");

  return stripCitationArtifacts(cleaned).trim();
}

function extractMarkdownHeadingLevel(paragraph: string): number | null {
  const match = paragraph.trim().match(new RegExp(`^${MD_HEADING_PREFIX}(\\d)\\s+`));
  if (!match) return null;
  const level = Number.parseInt(match[1], 10);
  return Number.isFinite(level) && level > 0 ? Math.min(level, 3) : null;
}

function stripMarkdownHeadingMarker(text: string): string {
  return text.trim().replace(new RegExp(`^${MD_HEADING_PREFIX}\\d\\s+`), "").trim();
}

function normalizeText(rawText: string): string {
  return sanitizeMarkdownText(rawText);
}

function detectMode(text: string, requestedMode: Mode): Exclude<Mode, "auto"> {
  if (requestedMode !== "auto") {
    return requestedMode;
  }
  const hitCount = THESIS_HINTS.filter((hint) =>
    text.toUpperCase().includes(hint.toUpperCase()),
  ).length;
  return hitCount >= 2 ? "thesis" : "official";
}

function shouldDemoteHeading(text: string, level: number): boolean {
  const t = text.trim();
  if (!t) return true;

  if (/^\d+、\s*/.test(t) || /^\d+[.．]\s+/.test(t)) {
    return true;
  }

  const structuredNumberHeading = /^\d+(?:\.\d+){1,2}\s+/.test(t);
  if (structuredNumberHeading) {
    return false;
  }

  const hasSentencePunctuation = /[；。！？]/.test(t);
  const isNumericList = /^\d+[、.]\s*/.test(t) || /^[（(]?\d+[）).、]/.test(t);

  if (isNumericList && t.length > 26) {
    return true;
  }
  if (level === 1 && isNumericList && t.length > 24 && hasSentencePunctuation) {
    return true;
  }
  if (level >= 1 && t.length > 40 && hasSentencePunctuation) {
    return true;
  }
  return false;
}

function headingLevel(paragraph: string): number | null {
  const markdownLevel = extractMarkdownHeadingLevel(paragraph);
  if (markdownLevel !== null) {
    return markdownLevel;
  }

  const p = paragraph.trim();
  if (!p) return null;

  let level: number | null = null;
  if (
    /^(摘要|ABSTRACT|目录|参考文献|结束语|致谢)$/i.test(p) ||
    /^第\s*[0-9一二三四五六七八九十百千]+\s*[章节部分篇]\s*/.test(p) ||
    /^[一二三四五六七八九十]+、\s*/.test(p) ||
    /^\d+\.\s+/.test(p)
  ) {
    level = 1;
  } else if (/^\d+\.\d+\.\d+\s+/.test(p)) {
    level = 3;
  } else if (
    /^\d+\.\d+\s+/.test(p) ||
    /^[（(][0-9一二三四五六七八九十]+[）)]\s+\S/.test(p)
  ) {
    level = 2;
  }

  if (level !== null && shouldDemoteHeading(p, level)) {
    return null;
  }
  return level;
}

function isLikelyTitle(paragraph: string): boolean {
  const markdownLevel = extractMarkdownHeadingLevel(paragraph);
  const p = markdownLevel !== null ? stripMarkdownHeadingMarker(paragraph) : paragraph.trim();
  if (!p || p.length > 45) return false;
  if (markdownLevel !== null) {
    if (/^\d+(?:\.\d+)*\.?\s+\S/.test(p)) return false;
  } else if (headingLevel(p) !== null) {
    return false;
  }
  if (/^(?:\d+[.)]|[（(]\d+[）)]|[一二三四五六七八九十百]+、)\s*/.test(p)) {
    return false;
  }
  if (/^(?:\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\]|\[[\s\S]+])$/.test(p)) {
    return false;
  }
  return !SENTENCE_ENDINGS.some((end) => p.endsWith(end));
}

function isBracketMathStart(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "[" || trimmed === "\\[";
}

function isBracketMathEnd(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "]" || trimmed === "\\]";
}

function splitParagraphs(text: string): string[] {
  const lines = text.split("\n");
  const paragraphs: string[] = [];
  let buffer = "";
  let mathBuffer: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (mathBuffer) {
      mathBuffer.push(line);
      if (isBracketMathEnd(line)) {
        paragraphs.push(mathBuffer.join("\n"));
        mathBuffer = null;
      }
      continue;
    }

    if (isBracketMathStart(line)) {
      if (buffer) {
        paragraphs.push(buffer);
        buffer = "";
      }
      mathBuffer = [line];
      if (isBracketMathEnd(line)) {
        paragraphs.push(mathBuffer.join("\n"));
        mathBuffer = null;
      }
      continue;
    }

    if (!line) {
      if (buffer) {
        paragraphs.push(buffer);
        buffer = "";
      }
      continue;
    }

    if (headingLevel(line) !== null || /^\d+、\s*/.test(line) || /^\d+[.．]\s+/.test(line)) {
      if (buffer) {
        paragraphs.push(buffer);
        buffer = "";
      }
      paragraphs.push(line);
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    if (SENTENCE_ENDINGS.some((ending) => buffer.endsWith(ending))) {
      paragraphs.push(buffer);
      buffer = line;
    } else {
      buffer += line;
    }
  }

  if (buffer) {
    paragraphs.push(buffer);
  }
  if (mathBuffer && mathBuffer.length > 0) {
    paragraphs.push(mathBuffer.join("\n"));
  }

  return paragraphs;
}

function looksLikeReference(text: string): boolean {
  const t = text.trim();
  return /^\[\d+\]/.test(t) || /^\d+[).、]\s+/.test(t);
}

function normalizeReferenceItems(blocks: Block[]): Block[] {
  const output: Block[] = [];
  let inRefSection = false;

  for (const block of blocks) {
    if (block.type === "heading" && /^参考文献$/i.test(block.text.trim())) {
      inRefSection = true;
      output.push(block);
      continue;
    }
    if (block.type === "heading" && inRefSection) {
      inRefSection = false;
    }

    if (inRefSection && block.type === "paragraph" && looksLikeReference(block.text)) {
      output.push({ ...block, type: "reference", level: 0 });
    } else {
      output.push(block);
    }
  }

  return output;
}

function toSafeMode(mode: Mode): Exclude<Mode, "auto"> {
  return mode === "auto" ? "official" : mode;
}

function normalizeSubItemText(text: string): string {
  const t = text.trim();
  const match = t.match(/^(\d+)(?:、\s*|[.．]\s+)(.*)$/);
  if (!match) return t;

  const index = Number.parseInt(match[1], 10);
  if (!Number.isFinite(index) || index <= 0) return t;
  return `（${index}）${match[2].trim()}`;
}

function sanitizeBlocks(blocks: Block[]): Block[] {
  return blocks
    .map((block) => {
      const rawText = (block.text ?? "").trim();
      const hadMarkdownHeading = extractMarkdownHeadingLevel(rawText) !== null;
      const text = stripMarkdownHeadingMarker(rawText);
      if (!text) return null;

      if (block.type === "heading") {
        const level = block.level >= 1 && block.level <= 3 ? block.level : 1;
        if (!hadMarkdownHeading && shouldDemoteHeading(text, level)) {
          return { type: "paragraph" as const, text: normalizeSubItemText(text), level: 0 };
        }
        return { type: "heading" as const, text, level };
      }
      if (block.type === "reference") {
        return { type: "reference" as const, text, level: 0 };
      }
      return { type: "paragraph" as const, text: normalizeSubItemText(text), level: 0 };
    })
    .filter((item): item is Block => item !== null);
}

export function composeStructuredDoc(
  mode: Mode,
  title: string,
  blocks: Block[],
): StructuredDoc {
  const targetMode = toSafeMode(mode);
  const cleanBlocks = sanitizeBlocks(blocks);
  const enhancedBlocks = normalizeReferenceItems(cleanBlocks);

  return {
    mode: targetMode,
    title: title.trim(),
    blocks: enhancedBlocks,
    stats: {
      paragraphCount: enhancedBlocks.filter((item) => item.type !== "heading").length,
      headingCount: enhancedBlocks.filter((item) => item.type === "heading").length,
      referenceCount: enhancedBlocks.filter((item) => item.type === "reference").length,
    },
  };
}

export function analyzeText(rawText: string, mode: Mode = "auto"): StructuredDoc {
  const normalized = normalizeText(rawText);
  const targetMode = detectMode(normalized, mode);
  const paragraphs = splitParagraphs(normalized);

  if (paragraphs.length === 0) {
    return {
      mode: targetMode,
      title: "",
      blocks: [],
      stats: { paragraphCount: 0, headingCount: 0, referenceCount: 0 },
    };
  }

  let title = "";
  let startIndex = 0;
  if (isLikelyTitle(paragraphs[0])) {
    title = stripMarkdownHeadingMarker(paragraphs[0]);
    startIndex = 1;
  }

  const blocks: Block[] = [];
  for (const paragraph of paragraphs.slice(startIndex)) {
    const level = headingLevel(paragraph);
    if (level !== null) {
      blocks.push({ type: "heading", text: paragraph, level });
    } else {
      blocks.push({ type: "paragraph", text: paragraph, level: 0 });
    }
  }

  return composeStructuredDoc(targetMode, title, blocks);
}
