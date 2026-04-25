const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export function protectLatexCommands(text: string): { text: string; restore: (value: string) => string } {
  const preserved: string[] = [];
  const protectedText = text.replace(/\\(?!u[0-9a-fA-F]{4})(?![nrt]\b)([A-Za-z]+)/g, (match) => {
    const index = preserved.push(match) - 1;
    return `__LATEX_CMD_${index}__`;
  });

  return {
    text: protectedText,
    restore: (value: string) => value.replace(/__LATEX_CMD_(\d+)__/g, (_match, index: string) => preserved[Number(index)] ?? ""),
  };
}

function normalizeEscapedWhitespace(text: string): string {
  let repaired = text;
  const escapedNewlineCount = (repaired.match(/\\n/g) ?? []).length;
  const realNewlineCount = (repaired.match(/\n/g) ?? []).length;

  if (escapedNewlineCount > 0 && escapedNewlineCount >= realNewlineCount) {
    const { text: protectedText, restore } = protectLatexCommands(repaired);
    repaired = restore(
      protectedText
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n"),
    );
  }

  if (/\\t/.test(repaired)) {
    const { text: protectedText, restore } = protectLatexCommands(repaired);
    repaired = restore(protectedText.replace(/\\t/g, "\t"));
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
