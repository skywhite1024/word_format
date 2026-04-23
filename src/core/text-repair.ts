const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function normalizeEscapedWhitespace(text: string): string {
  let repaired = text;
  const escapedNewlineCount = (repaired.match(/\\n/g) ?? []).length;
  const realNewlineCount = (repaired.match(/\n/g) ?? []).length;

  if (escapedNewlineCount > 0 && escapedNewlineCount >= realNewlineCount) {
    repaired = repaired
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n");
  }

  if (/\\t/.test(repaired)) {
    repaired = repaired.replace(/\\t/g, "\t");
  }

  return repaired;
}

export function deepRepairText(rawText: string): string {
  let repaired = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  repaired = normalizeEscapedWhitespace(repaired);
  repaired = decodeUnicodeEscapes(repaired);
  repaired = repaired
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return repaired;
}
