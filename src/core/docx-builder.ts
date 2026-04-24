import {
  AlignmentType,
  Bookmark,
  Document,
  FileChild,
  Footer,
  HeadingLevel,
  InternalHyperlink,
  LevelFormat,
  LineRuleType,
  Math,
  type MathComponent,
  MathFraction,
  MathIntegral,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  Packer,
  PageNumber,
  type ParagraphChild,
  Paragraph,
  SimpleField,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  convertMillimetersToTwip,
} from "docx";
import JSZip from "jszip";
import type { Block, StructuredDoc } from "./types";

const FONT_CN_SONG = "宋体";
const FONT_CN_HEI = "黑体";
const FONT_CN_KAI = "楷体_GB2312";
const FONT_EN = "Times New Roman";
const COLOR_BLACK = "000000";
const TWO_CHAR_TWIP = 2 * 210;
const REFERENCE_NUMBERING_ID = "reference-numbering";
const EQUATION_SIDE_COL_MM = 15;
const EQUATION_MID_COL_MM = 120;
const SCRIPT_OPEN = "__SCRIPT_OPEN__";
const SCRIPT_CLOSE = "__SCRIPT_CLOSE__";
const CHAR_SUM = "\u2211";
const CHAR_INTEGRAL = "\u222B";
const CHAR_SQRT = "\u221A";

interface BuildDocxOptions {
  mathItalic?: boolean;
}

function textRun(
  text: string,
  cnFont: string,
  sizeHalfPt: number,
  bold = false,
  superScript = false,
): TextRun {
  return new TextRun({
    text,
    bold,
    superScript,
    size: sizeHalfPt,
    color: COLOR_BLACK,
    font: {
      ascii: FONT_EN,
      hAnsi: FONT_EN,
      eastAsia: cnFont,
    },
    characterSpacing: 0,
    boldComplexScript: bold,
  });
}

function baseParagraph(text: string): Paragraph {
  return baseParagraphWithCitations(text, new Map<number, string>());
}

function baseParagraphWithCitations(text: string, citationAnchorMap: Map<number, string>): Paragraph {
  const normalized = normalizeInlineFormulaText(text.trim());
  const inlineChildren = buildInlineChildrenWithCitation(normalized, citationAnchorMap);

  return new Paragraph({
    children: inlineChildren,
    alignment: AlignmentType.JUSTIFIED,
    indent: {
      firstLine: TWO_CHAR_TWIP,
    },
    spacing: {
      before: 0,
      after: 0,
      line: 360,
      lineRule: LineRuleType.AUTO,
    },
  });
}

function headingParagraph(block: Block): Paragraph {
  const headingText = normalizeHeadingText(block.text, block.level);

  if (block.level === 1) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [textRun(headingText, FONT_CN_HEI, 32, false)],
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    });
  }
  if (block.level === 2) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [textRun(headingText, FONT_CN_HEI, 24, false)],
      alignment: AlignmentType.LEFT,
      indent: { firstLine: TWO_CHAR_TWIP },
      spacing: { before: 0, after: 0, line: 360, lineRule: LineRuleType.AUTO },
    });
  }
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [textRun(headingText, FONT_CN_KAI, 24, false)],
    alignment: AlignmentType.LEFT,
    indent: { firstLine: TWO_CHAR_TWIP },
    spacing: { before: 0, after: 0, line: 360, lineRule: LineRuleType.AUTO },
  });
}

function normalizeHeadingText(text: string, level: number): string {
  const raw = text.trim();
  if (!raw) return raw;

  if (level === 1) {
    const withChapter = raw.replace(
      /^(第\s*[0-9一二三四五六七八九十百千]+\s*[章节部分篇])\s*/,
      "$1　",
    );
    return withChapter.replace(/^([一二三四五六七八九十]+、)\s*/, "$1　");
  }

  if (level === 2) {
    const withNumeric = raw.replace(/^(\d+\.\d+)\s*/, "$1　");
    return withNumeric.replace(/^([（(][0-9一二三四五六七八九十]+[）)])\s*/, "$1　");
  }

  const withDecimal = raw.replace(/^(\d+\.\d+\.\d+)\s*/, "$1　");
  return withDecimal.replace(/^(\d+、)\s*/, "$1　");
}

function referenceParagraph(raw: string): Paragraph {
  return referenceParagraphWithAnchor(raw);
}

function referenceParagraphWithAnchor(raw: string, anchorId?: string): Paragraph {
  const content = raw.replace(/^\[\d+\]\s*/, "").replace(/^\d+[).、]\s*/, "").trim();
  const contentRun = textRun(content, FONT_CN_KAI, 21);
  const children: ParagraphChild[] = anchorId
    ? [new Bookmark({ id: anchorId, children: [contentRun] })]
    : [contentRun];
  return new Paragraph({
    children,
    alignment: AlignmentType.LEFT,
    numbering: {
      reference: REFERENCE_NUMBERING_ID,
      level: 0,
    },
    indent: {
      left: TWO_CHAR_TWIP,
      hanging: TWO_CHAR_TWIP,
    },
    spacing: {
      before: 0,
      after: 0,
      line: 360,
      lineRule: LineRuleType.AUTO,
    },
  });
}

function extractEquationText(raw: string): string {
  const t = raw.trim();
  const blockMath = t.match(/^\$\$([\s\S]+)\$\$$/);
  if (blockMath) return blockMath[1].trim();

  const normalizeEquationBlockText = (block: string): string =>
    block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        if (/^=+$/.test(line)) {
          return ["="];
        }
        return [line.replace(/^#+\s*/, "")];
      })
      .filter((part, index, all) => part !== "=" || (index > 0 && index < all.length - 1))
      .join(" ")
      .trim();

  const latexBlock = t.match(/^\\\[([\s\S]+)\\\]$/);
  if (latexBlock) {
    return normalizeEquationBlockText(latexBlock[1]);
  }

  const bracketBlock = t.match(/^\[([\s\S]+)\]$/);
  if (bracketBlock) {
    return normalizeEquationBlockText(bracketBlock[1]);
  }

  const inlineMath = t.match(/^\$([^\n]+)\$$/);
  if (inlineMath) return inlineMath[1].trim();

  return t.replace(/\s+/g, " ").trim();
}

function normalizeInlineFormulaText(text: string): string {
  return normalizeMathArtifactText(normalizeLatexLikeText(text));
}

function readGroupedLatexValue(
  text: string,
  start: number,
  open = "{",
  close = "}",
): { value: string; end: number } | null {
  if (start >= text.length || text[start] !== open) {
    return null;
  }

  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const ch = text[cursor];
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          value: text.slice(start + 1, cursor),
          end: cursor + 1,
        };
      }
    }
  }

  return {
    value: text.slice(start + 1),
    end: text.length,
  };
}

function replaceLatexFractions(text: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < text.length) {
    const markerIndex = text.indexOf("\\frac", cursor);
    if (markerIndex === -1) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, markerIndex);
    let valueCursor = markerIndex + "\\frac".length;
    while (valueCursor < text.length && /\s/.test(text[valueCursor])) {
      valueCursor += 1;
    }

    const numerator = readGroupedLatexValue(text, valueCursor);
    if (!numerator) {
      output += "\\frac";
      cursor = valueCursor;
      continue;
    }

    valueCursor = numerator.end;
    while (valueCursor < text.length && /\s/.test(text[valueCursor])) {
      valueCursor += 1;
    }

    const denominator = readGroupedLatexValue(text, valueCursor);
    if (!denominator) {
      output += text.slice(markerIndex, numerator.end);
      cursor = numerator.end;
      continue;
    }

    output += `(${replaceLatexFractions(numerator.value.trim())})/(${replaceLatexFractions(
      denominator.value.trim(),
    )})`;
    cursor = denominator.end;
  }

  return output;
}

function replaceLatexRadicals(text: string): string {
  let output = "";

  for (let cursor = 0; cursor < text.length; ) {
    const markerIndex = text.indexOf("\\sqrt", cursor);
    if (markerIndex === -1) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, markerIndex);
    let valueCursor = markerIndex + "\\sqrt".length;
    while (valueCursor < text.length && /\s/.test(text[valueCursor])) {
      valueCursor += 1;
    }

    let degree = "";
    if (text[valueCursor] === "[") {
      const degreeGroup = readGroupedLatexValue(text, valueCursor, "[", "]");
      if (degreeGroup) {
        degree = degreeGroup.value.trim();
        valueCursor = degreeGroup.end;
      }
    }

    while (valueCursor < text.length && /\s/.test(text[valueCursor])) {
      valueCursor += 1;
    }

    const body = readGroupedLatexValue(text, valueCursor);
    if (!body) {
      output += "\\sqrt";
      cursor = valueCursor;
      continue;
    }

    const normalizedBody = replaceLatexRadicals(body.value.trim());
    const normalizedDegree = degree ? replaceLatexRadicals(degree) : "";
    output += normalizedDegree
      ? `${CHAR_SQRT}[${normalizedDegree}](${normalizedBody})`
      : `${CHAR_SQRT}(${normalizedBody})`;
    cursor = body.end;
  }

  return output;
}

function preserveBracedScripts(text: string): string {
  let output = "";

  for (let cursor = 0; cursor < text.length; ) {
    const marker = text[cursor];
    if ((marker === "_" || marker === "^") && text[cursor + 1] === "{") {
      const grouped = readGroupedLatexValue(text, cursor + 1);
      if (grouped) {
        output += `${marker}${SCRIPT_OPEN}${grouped.value}${SCRIPT_CLOSE}`;
        cursor = grouped.end;
        continue;
      }
    }

    output += marker;
    cursor += 1;
  }

  return output;
}

function normalizeLatexLikeText(text: string): string {
  let output = preserveBracedScripts(replaceLatexFractions(replaceLatexRadicals(text)));

  output = output
    .replace(/([A-Za-z0-9)\]\u03b1-\u03c9\u0391-\u03a9\u2211\u222b])\*_/g, "$1_")
    .replace(/([A-Za-z0-9)\]\u03b1-\u03c9\u0391-\u03a9\u2211\u222b])\*\{/g, "$1_{")
    .replace(/([A-Za-z0-9)\]\u03b1-\u03c9\u0391-\u03a9\u2211\u222b])\*([A-Za-z\\\u03b1-\u03c9\u0391-\u03a9])/g, "$1_$2")
    .replace(/([A-Za-zΑ-Ωα-ωτΔΣ])\*\{/g, "$1_{")
    .replace(/([A-Za-zΑ-Ωα-ωτΔΣ])\*([A-Za-z\\])/g, "$1_$2")
    .replace(/\\hat\{([^{}]+)\}/g, "$1̂")
    .replace(/\\tilde\{([^{}]+)\}/g, "$1̃")
    .replace(/\\bar\{([^{}]+)\}/g, "$1̄")
    .replace(/\\qquad/g, " ")
    .replace(/\\quad/g, " ")
    .replace(/\\tau/g, "τ")
    .replace(/\\theta/g, "θ")
    .replace(/\\phi/g, "φ")
    .replace(/\\pi/g, "π")
    .replace(/\\mu/g, "μ")
    .replace(/\\sigma/g, "σ")
    .replace(/\\xi/g, "ξ")
    .replace(/\\lambda/g, "λ")
    .replace(/\\eta/g, "η")
    .replace(/\\epsilon/g, "ε")
    .replace(/\\omega/g, "ω")
    .replace(/\\Omega/g, "Ω")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\delta/g, "δ")
    .replace(/\\infty/g, "∞")
    .replace(/\\mid/g, "|")
    .replace(/\\odot/g, "⊙")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\Rightarrow/g, "⇒")
    .replace(/\\to/g, "→")
    .replace(/\\sim/g, "~")
    .replace(/\\partial/g, "∂")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^{}]*)\}/g, "$1")
    .replace(/\\mathbf\{([^{}]*)\}/g, "$1")
    .replace(/\\mathbb\{([^{}]*)\}/g, "$1")
    .replace(/\\mathcal\{([^{}]*)\}/g, "$1")
    .replace(/\\operatorname\{([^{}]*)\}/g, "$1")
    .replace(/([A-Za-z0-9)\]\u03b1-\u03c9\u0391-\u03a9\u2211\u222b\u221a\u0302\u0303\u0304])\*_/g, "$1_")
    .replace(/([A-Za-z0-9)\]\u03b1-\u03c9\u0391-\u03a9\u2211\u222b\u221a\u0302\u0303\u0304])\*\{/g, "$1_{")
    .replace(/([A-Za-z0-9)\]\u03b1-\u03c9\u0391-\u03a9\u2211\u222b\u221a\u0302\u0303\u0304])\*([A-Za-z\\\u03b1-\u03c9\u0391-\u03a9])/g, "$1_$2")
    .replace(/\\arg\\max/g, "argmax")
    .replace(/\\arg\\min/g, "argmin")
    .replace(/\\dot\{([^{}]+)\}/g, "$1̇")
    .replace(/\\[;,!:]/g, " ")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\+lVert/g, "||")
    .replace(/\\+rVert/g, "||")
    .replace(/\\+Vert/g, "||")
    .replace(/\\+\|/g, "||")
    .replace(/‖/g, "||")
    .replace(/\\\\+/g, " ")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\sum/g, "∑")
    .replace(/\\int/g, "∫")
    .replace(/\\sqrt/g, "√")
    .replace(/\\_/g, "_")
    .replace(/\\forall/g, "∀")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/\\/g, " ")
    .replace(/([A-Za-zΑ-Ωα-ωτΔΣ0-9)\]̂̃̄])_\{([^{}]+)\}/g, "$1_$2")
    .replace(/([A-Za-zΑ-Ωα-ωτΔΣ0-9)\]̂̃̄])_([A-Za-zΑ-Ωα-ωτΔΣ0-9∞]+)/g, "$1_$2")
    .replace(/([A-Za-zΑ-Ωα-ωτΔΣ0-9)\]̂̃̄])\^\{([^{}]+)\}/g, "$1^$2")
    .replace(/([A-Za-zΑ-Ωα-ωτΔΣ0-9)\]̂̃̄])\^([A-Za-zΑ-Ωα-ωτΔΣ0-9∞+\-]+)/g, "$1^$2")
    .replace(/\s*[：:]\s*$/, "")
    .replace(/[{}]/g, "")
    .replace(new RegExp(SCRIPT_OPEN, "g"), "{")
    .replace(new RegExp(SCRIPT_CLOSE, "g"), "}")
    .replace(/\s+/g, " ")
    .trim();

  return output;
}

function isMathBaseStart(ch: string): boolean {
  return /[A-Za-z0-9Α-Ωα-ωτΔΣξ∑∫√∞∀∂]/.test(ch);
}

function isScriptBaseSymbol(ch: string): boolean {
  return /[)\]\}|]/.test(ch);
}

function isMathBaseChar(ch: string): boolean {
  return /[A-Za-z0-9Α-Ωα-ωτΔΣξ∑∫√∞∀∂∗̇̂̃̄]/.test(ch);
}

function isScriptTerminator(ch: string): boolean {
  return /[\s+\-*/<>≤≥×÷|(),;:]/.test(ch);
}

function readScriptValue(text: string, start: number): { value: string; end: number } {
  if (start >= text.length) {
    return { value: "", end: start };
  }

  if (text[start] === "*") {
    return { value: "∗", end: start + 1 };
  }
  if (/[+-]/.test(text[start])) {
    return { value: text[start], end: start + 1 };
  }

  if (text[start] === "{") {
    let depth = 0;
    let cursor = start;
    for (; cursor < text.length; cursor += 1) {
      const ch = text[cursor];
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const value = text.slice(start + 1, cursor).trim();
          return { value, end: cursor + 1 };
        }
      }
    }
    return { value: text.slice(start + 1).trim(), end: text.length };
  }

  let cursor = start;
  let value = "";
  while (cursor < text.length && !isScriptTerminator(text[cursor]) && text[cursor] !== "^" && text[cursor] !== "_") {
    const ch = text[cursor];
    if (/[A-Za-zΑ-Ωα-ωτΔΣ∑∫√]/.test(ch) && /^[0-9]+$/.test(value)) {
      break;
    }
    value += ch;
    cursor += 1;
  }
  return { value: value.trim(), end: cursor };
}

function skipMathWhitespace(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function readGroupedMathValue(
  text: string,
  start: number,
  open = "(",
  close = ")",
): { value: string; end: number } | null {
  if (start >= text.length || text[start] !== open) {
    return null;
  }

  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const ch = text[cursor];
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          value: text.slice(start + 1, cursor),
          end: cursor + 1,
        };
      }
    }
  }

  return {
    value: text.slice(start + 1),
    end: text.length,
  };
}

function readMathValue(text: string, start: number): { value: string; end: number } | null {
  if (start >= text.length) {
    return null;
  }

  if (text[start] === "(") {
    return readGroupedMathValue(text, start, "(", ")");
  }
  if (text[start] === "[") {
    return readGroupedMathValue(text, start, "[", "]");
  }
  if (text[start] === "{") {
    return readGroupedMathValue(text, start, "{", "}");
  }

  const value = readScriptValue(text, start);
  return value.value ? value : null;
}

function readRadicalComponent(
  expression: string,
  start: number,
): { component: MathComponent; end: number } | null {
  if (expression[start] !== CHAR_SQRT) {
    return null;
  }

  let cursor = skipMathWhitespace(expression, start + 1);
  let degree: MathComponent[] | undefined;

  if (expression[cursor] === "[") {
    const degreeValue = readGroupedMathValue(expression, cursor, "[", "]");
    if (degreeValue) {
      const normalizedDegree = degreeValue.value.trim();
      degree = normalizedDegree ? buildMathComponentsFromExpression(normalizedDegree) : undefined;
      cursor = skipMathWhitespace(expression, degreeValue.end);
    }
  }

  const body = readMathValue(expression, cursor);
  if (!body || !body.value.trim()) {
    return null;
  }

  return {
    component: new MathRadical({
      children: buildMathComponentsFromExpression(body.value.trim()),
      degree,
    }),
    end: body.end,
  };
}

function readFractionComponent(
  expression: string,
  start: number,
): { component: MathComponent; end: number } | null {
  const numerator = readGroupedMathValue(expression, start, "(", ")");
  if (!numerator) {
    return null;
  }

  let cursor = skipMathWhitespace(expression, numerator.end);
  if (expression[cursor] !== "/") {
    return null;
  }

  cursor = skipMathWhitespace(expression, cursor + 1);
  const radicalDenominator = readRadicalComponent(expression, cursor);
  if (radicalDenominator) {
    return {
      component: new MathFraction({
        numerator: buildMathComponentsFromExpression(numerator.value.trim()),
        denominator: [radicalDenominator.component],
      }),
      end: radicalDenominator.end,
    };
  }

  const denominator = readMathValue(expression, cursor);
  if (!denominator || !denominator.value.trim()) {
    return null;
  }

  return {
    component: new MathFraction({
      numerator: buildMathComponentsFromExpression(numerator.value.trim()),
      denominator: buildMathComponentsFromExpression(denominator.value.trim()),
    }),
    end: denominator.end,
  };
}

function readNaryOperand(expression: string, start: number): { value: string; end: number } {
  let cursor = skipMathWhitespace(expression, start);
  let roundDepth = 0;
  let squareDepth = 0;
  let braceDepth = 0;

  for (; cursor < expression.length; cursor += 1) {
    const ch = expression[cursor];
    if (ch === "(") {
      roundDepth += 1;
      continue;
    }
    if (ch === ")") {
      if (roundDepth === 0) break;
      roundDepth -= 1;
      continue;
    }
    if (ch === "[") {
      squareDepth += 1;
      continue;
    }
    if (ch === "]") {
      if (squareDepth === 0) break;
      squareDepth -= 1;
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      if (braceDepth === 0) break;
      braceDepth -= 1;
      continue;
    }
    if (roundDepth === 0 && squareDepth === 0 && braceDepth === 0 && (ch === "+" || ch === ",")) {
      break;
    }
  }

  return {
    value: expression.slice(start, cursor).trim(),
    end: cursor,
  };
}

function createScriptMathComponentFromChildren(
  baseChildren: MathComponent[],
  subScript?: string,
  superScript?: string,
): MathComponent {
  const subChildren: MathComponent[] = subScript ? buildMathComponentsFromExpression(subScript) : [];
  const superChildren: MathComponent[] = superScript ? buildMathComponentsFromExpression(superScript) : [];

  if (subChildren.length > 0 && superChildren.length > 0) {
    return new MathSubSuperScript({
      children: baseChildren,
      subScript: subChildren,
      superScript: superChildren,
    });
  }
  if (subChildren.length > 0) {
    return new MathSubScript({
      children: baseChildren,
      subScript: subChildren,
    });
  }
  if (superChildren.length > 0) {
    return new MathSuperScript({
      children: baseChildren,
      superScript: superChildren,
    });
  }
  return baseChildren.length === 1 ? baseChildren[0] : new MathRun("");
}

function createScriptMathComponent(base: string, subScript?: string, superScript?: string): MathComponent {
  return createScriptMathComponentFromChildren([new MathRun(base)], subScript, superScript);
}

function readMathScripts(
  expression: string,
  start: number,
): { subScript?: string; superScript?: string; end: number } {
  let subScript: string | undefined;
  let superScript: string | undefined;
  let cursor = start;

  while (cursor < expression.length && (expression[cursor] === "_" || expression[cursor] === "^")) {
    const marker = expression[cursor];
    const script = readScriptValue(expression, cursor + 1);
    if (!script.value) {
      break;
    }
    if (marker === "_") {
      subScript = subScript ? `${subScript}_${script.value}` : script.value;
    } else {
      superScript = superScript ? `${superScript}^${script.value}` : script.value;
    }
    cursor = script.end;
  }

  return { subScript, superScript, end: cursor };
}

function readDelimitedFenceGroup(
  expression: string,
  start: number,
  delimiter: string,
): { children: MathComponent[]; end: number } | null {
  if (!expression.startsWith(delimiter, start)) {
    return null;
  }

  let roundDepth = 0;
  let squareDepth = 0;
  let braceDepth = 0;

  for (let cursor = start + delimiter.length; cursor < expression.length; cursor += 1) {
    const ch = expression[cursor];
    if (ch === "(") {
      roundDepth += 1;
      continue;
    }
    if (ch === ")") {
      if (roundDepth > 0) {
        roundDepth -= 1;
      }
      continue;
    }
    if (ch === "[") {
      squareDepth += 1;
      continue;
    }
    if (ch === "]") {
      if (squareDepth > 0) {
        squareDepth -= 1;
      }
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      if (braceDepth > 0) {
        braceDepth -= 1;
      }
      continue;
    }

    if (expression.startsWith(delimiter, cursor) && roundDepth === 0 && squareDepth === 0 && braceDepth === 0) {
      const inner = expression.slice(start + delimiter.length, cursor).trim();
      const children: MathComponent[] = [...delimiter].map((part) => new MathRun(part));
      if (inner) {
        children.push(...buildMathComponentsFromExpression(inner));
      }
      children.push(...[...delimiter].map((part) => new MathRun(part)));
      return {
        children,
        end: cursor + delimiter.length,
      };
    }
  }

  return null;
}

function buildMathComponentsFromExpression(expression: string): MathComponent[] {
  const components: MathComponent[] = [];
  let cursor = 0;

  while (cursor < expression.length) {
    const fraction = readFractionComponent(expression, cursor);
    if (fraction) {
      components.push(fraction.component);
      cursor = fraction.end;
      continue;
    }

    const radical = readRadicalComponent(expression, cursor);
    if (radical) {
      components.push(radical.component);
      cursor = radical.end;
      continue;
    }

    const normGroup = readDelimitedFenceGroup(expression, cursor, "||");
    if (normGroup) {
      const scripts = readMathScripts(expression, normGroup.end);
      if (scripts.subScript || scripts.superScript) {
        components.push(
          createScriptMathComponentFromChildren(normGroup.children, scripts.subScript, scripts.superScript),
        );
      } else {
        components.push(...normGroup.children);
      }
      cursor = scripts.end;
      continue;
    }

    const absoluteGroup = readDelimitedFenceGroup(expression, cursor, "|");
    if (absoluteGroup) {
      const scripts = readMathScripts(expression, absoluteGroup.end);
      if (scripts.subScript || scripts.superScript) {
        components.push(
          createScriptMathComponentFromChildren(absoluteGroup.children, scripts.subScript, scripts.superScript),
        );
      } else {
        components.push(...absoluteGroup.children);
      }
      cursor = scripts.end;
      continue;
    }

    const ch = expression[cursor];
    const canBeBase = isMathBaseStart(ch) || isScriptBaseSymbol(ch);
    if (!canBeBase) {
      components.push(new MathRun(ch));
      cursor += 1;
      continue;
    }

    let end = cursor + 1;
    if (isMathBaseStart(ch)) {
      while (end < expression.length && isMathBaseChar(expression[end])) {
        end += 1;
      }
    }

    const base = expression.slice(cursor, end);
    const { subScript, superScript, end: tokenCursor } = readMathScripts(expression, end);

    if (base === CHAR_SUM || base === CHAR_INTEGRAL) {
      const operand = readNaryOperand(expression, tokenCursor);
      const operandChildren = operand.value
        ? buildMathComponentsFromExpression(operand.value)
        : [new MathRun("")];

      components.push(
        base === CHAR_SUM
          ? new MathSum({
              children: operandChildren,
              subScript: subScript ? buildMathComponentsFromExpression(subScript) : undefined,
              superScript: superScript ? buildMathComponentsFromExpression(superScript) : undefined,
            })
          : new MathIntegral({
              children: operandChildren,
              subScript: subScript ? buildMathComponentsFromExpression(subScript) : undefined,
              superScript: superScript ? buildMathComponentsFromExpression(superScript) : undefined,
            }),
      );
      cursor = operand.end > tokenCursor ? operand.end : tokenCursor;
      continue;
    }

    components.push(createScriptMathComponent(base, subScript, superScript));
    cursor = tokenCursor;
  }

  return components.length > 0 ? components : [new MathRun(expression)];
}

function normalizeMathArtifactText(text: string): string {
  let output = text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  output = output.normalize("NFKD");

  output = output
    .replace(/\b([A-Z])(task|energy|force|smoothness|safe|total)\b/g, "$1_$2")
    .replace(/\b([A-Z])\s+(task|energy|force|smoothness|safe|total)\b/gi, "$1_$2")
    .replace(/\bR[_\s]*(task|energy|force|smoothness|safe|total)\b/gi, (_m, s: string) => `R_${s.toLowerCase()}`)
    .replace(/\bF[_\s]*(c|safe)\b/gi, (_m, s: string) => `F_${s.toLowerCase()}`)
    .replace(/\bF\s+c\b/g, "F_c")
    .replace(/\bF\s+safe\b/gi, "F_safe")
    .replace(/\bR\s+task\b/gi, "R_task")
    .replace(/\bR\s+energy\b/gi, "R_energy")
    .replace(/\bR\s+force\b/gi, "R_force")
    .replace(/\bR\s+smoothness\b/gi, "R_smoothness")
    .replace(/\bR\s+safe\b/gi, "R_safe")
    .replace(/\bR\s+total\b/gi, "R_total")
    .replace(/\bτ\s*i\b/gi, "τ_i")
    .replace(/\bτ[_\s]*([A-Za-z0-9]+)\b/g, "τ_$1")
    .replace(/τ([A-Za-z0-9])/g, "τ_$1")
    .replace(/q\s*̇\s*/g, "q̇")
    .replace(/\bq\s*˙\s*i\b/gi, "q̇_i")
    .replace(/\bq˙\s*i\b/gi, "q̇_i")
    .replace(/\bq[_\s]*dot[_\s]*i\b/gi, "q̇_i")
    .replace(/q̇([A-Za-z0-9])/g, "q̇_$1")
    .replace(/([A-Za-zτqFR])\s*_\s*([A-Za-z0-9]+)/g, "$1_$2")
    .replace(/\b(R_(?:task|energy|force|smoothness|safe|total))(?:\s+R\s*(?:task|energy|force|smoothness|safe|total))+\b/gi, "$1")
    .replace(/\b(F_(?:c|safe))(?:\s+F\s*(?:c|safe))+\b/gi, "$1")
    .replace(/\b(τ_[A-Za-z0-9]+)(?:\s+τ\s*[A-Za-z0-9]+)+\b/g, "$1")
    .replace(/\b(q̇_[A-Za-z0-9]+)(?:\s+q\s*[˙̇]?\s*[A-Za-z0-9]+)+\b/gi, "$1")
    .replace(/\b([A-Za-zτ][A-Za-z0-9_̇]+)\s+\1\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return output;
}

function isInlineMathToken(token: string): boolean {
  if (!token) return false;
  if (token.length > 30) return false;
  return /_|̇|[τΔΣξα-ωΑ-Ω∀∂∗]/.test(token);
}

function isLikelyParenthesizedInlineMath(text: string): boolean {
  const normalized = normalizeInlineFormulaText(text).trim();
  if (!normalized) return false;
  if (/[\u4e00-\u9fff]{2,}/.test(normalized)) return false;
  if (/\\[A-Za-z]+/.test(text)) return true;
  if (/[_^=|<>≤≥×+\-*/]/.test(normalized)) return true;
  if (/[τΔΣξα-ωΑ-Ωθφπηλμσ∞∀∂]/.test(normalized)) return true;
  if (/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(normalized)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*(?:\([^)]*\))$/.test(normalized)) return true;
  return false;
}

function buildParenthesizedInlineMath(text: string): Math {
  const normalized = normalizeInlineFormulaText(text);
  return new Math({
    children: buildMathComponentsFromExpression(normalized),
  });
}

function extractBalancedParenthesisSegment(
  text: string,
  start: number,
): { segment: string; end: number } | null {
  const open = text[start];
  const close = open === "（" ? "）" : ")";
  if (open !== "(" && open !== "（") {
    return null;
  }

  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const ch = text[cursor];
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          segment: text.slice(start, cursor + 1),
          end: cursor + 1,
        };
      }
    }
  }

  return null;
}

function buildInlineChildrenFromPlainText(text: string): Array<TextRun | Math> {
  const children: Array<TextRun | Math> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch !== "(" && ch !== "（") {
      const nextIndex = text.slice(cursor).search(/[（(]/);
      const end = nextIndex === -1 ? text.length : cursor + nextIndex;
      children.push(...buildInlineMathChildrenFromToken(text.slice(cursor, end)));
      cursor = end;
      continue;
    }

    const segment = extractBalancedParenthesisSegment(text, cursor);
    if (!segment) {
      children.push(...buildInlineMathChildrenFromToken(text.slice(cursor)));
      break;
    }

    const inner = segment.segment.slice(1, -1).trim();
    if (isLikelyParenthesizedInlineMath(inner)) {
      children.push(buildParenthesizedInlineMath(segment.segment));
    } else {
      children.push(...buildInlineMathChildrenFromToken(segment.segment));
    }
    cursor = segment.end;
  }

  return children.length > 0 ? children : [textRun(text, FONT_CN_SONG, 24)];
}

function buildInlineMathChildrenFromToken(text: string): Array<TextRun | Math> {
  const children: Array<TextRun | Math> = [];
  const regex = /[A-Za-zΑ-Ωα-ωτΔΣξ][A-Za-z0-9̇̂̃̄]*(?:_[A-Za-zΑ-Ωα-ωξ0-9+\-∞]+)?(?:\^[A-Za-zΑ-Ωα-ωξ0-9+\-∞∗]+)?/g;
  let cursor = 0;

  for (const match of text.matchAll(regex)) {
    const token = match[0];
    const start = match.index ?? 0;
    const end = start + token.length;

    const plain = text.slice(cursor, start);
    if (plain) {
      children.push(textRun(plain, FONT_CN_SONG, 24));
    }

    if (isInlineMathToken(token)) {
      children.push(
        new Math({
          children: buildMathComponentsFromExpression(token),
        }),
      );
    } else {
      children.push(textRun(token, FONT_CN_SONG, 24));
    }

    cursor = end;
  }

  const tail = text.slice(cursor);
  if (tail) {
    children.push(textRun(tail, FONT_CN_SONG, 24));
  }

  if (children.length === 0) {
    children.push(textRun(text, FONT_CN_SONG, 24));
  }

  return children;
}

function hasInlineMath(text: string): boolean {
  return /\$[^$\n]+\$/.test(text);
}

function buildInlineMathChildren(text: string): Array<TextRun | Math> {
  const children: Array<TextRun | Math> = [];
  const regex = /\$([^$\n]+)\$/g;
  let cursor = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const plain = text.slice(cursor, start);
    if (plain) {
      children.push(...buildInlineChildrenFromPlainText(plain));
    }

    const mathText = normalizeLatexLikeText(match[1]);
    if (mathText) {
      children.push(
        new Math({
          children: buildMathComponentsFromExpression(mathText),
        }),
      );
    }
    cursor = end;
  }

  const tail = text.slice(cursor);
  if (tail) {
    const trailing = buildInlineChildrenFromPlainText(tail);
    children.push(...trailing);
  }

  if (children.length === 0 || !/\$[^$\n]+\$/.test(text)) {
    return buildInlineChildrenFromPlainText(text);
  }

  return children;
}

function citationRun(text: string): TextRun {
  return textRun(text, FONT_CN_SONG, 24, false, true);
}

function buildInlineChildrenWithCitation(
  text: string,
  citationAnchorMap: Map<number, string>,
): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  const regex = /\[(\d+)\]/g;
  let cursor = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    const plain = text.slice(cursor, start);
    if (plain) {
      children.push(...buildInlineMathChildren(plain));
    }

    const referenceIndex = Number.parseInt(match[1], 10);
    const anchorId = citationAnchorMap.get(referenceIndex);
    const run = citationRun(match[0]);

    if (anchorId) {
      children.push(
        new InternalHyperlink({
          anchor: anchorId,
          children: [run],
        }),
      );
    } else {
      children.push(run);
    }

    cursor = end;
  }

  const tail = text.slice(cursor);
  if (tail) {
    children.push(...buildInlineMathChildren(tail));
  }

  return children.length > 0 ? children : [textRun(text, FONT_CN_SONG, 24)];
}

function parseReferenceIndex(raw: string, fallbackIndex: number): number {
  const bracket = raw.match(/^\[(\d+)\]/);
  if (bracket) {
    return Number.parseInt(bracket[1], 10);
  }
  const numbered = raw.match(/^(\d+)[).、]/);
  if (numbered) {
    return Number.parseInt(numbered[1], 10);
  }
  return fallbackIndex;
}

function buildReferenceAnchorMap(blocks: Block[]): Map<number, string> {
  const result = new Map<number, string>();
  const used = new Set<string>();
  let fallbackIndex = 1;

  for (const block of blocks) {
    if (block.type !== "reference") continue;
    const index = parseReferenceIndex(block.text, fallbackIndex);
    fallbackIndex += 1;
    let anchor = `ref-${index}`;
    if (used.has(anchor)) {
      let suffix = 2;
      while (used.has(`${anchor}-${suffix}`)) {
        suffix += 1;
      }
      anchor = `${anchor}-${suffix}`;
    }
    used.add(anchor);
    if (!result.has(index)) {
      result.set(index, anchor);
    }
  }

  return result;
}

function isEquationNumberOnlyLine(text: string): boolean {
  return /^[（(]\d+[）)]$/.test(text.trim()) || /^\(\d+\)$/.test(text.trim());
}

function normalizeCaptionTitle(text: string): string {
  return text.trim().replace(/[。！？；：,.!?]+$/g, "");
}

function parseTableCaption(raw: string): { title: string } | null {
  const t = raw.trim();
  const match = t.match(/^表\s*(?:\d+(?:[-.]\d+)*)?\s*[：:.、]?\s*(.+)$/);
  if (!match) return null;
  const title = normalizeCaptionTitle(match[1]);
  if (!title) return null;
  return { title };
}

function parseFigureCaption(raw: string): { title: string } | null {
  const t = raw.trim();
  const match = t.match(/^图\s*(?:\d+(?:[-.]\d+)*)?\s*[：:.、]?\s*(.+)$/);
  if (!match) return null;
  const title = normalizeCaptionTitle(match[1]);
  if (!title) return null;
  return { title };
}

function splitTableCells(rawRow: string): string[] {
  return rawRow
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function isTableSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function parseInlineMarkdownTable(raw: string): string[][] | null {
  const trimmed = raw.trim();
  if (!trimmed.includes("|")) return null;

  const rowCandidates = trimmed.includes("||")
    ? trimmed
        .split(/\|\|+/)
        .map((row) => row.trim())
        .filter((row) => row.includes("|"))
    : trimmed
        .split(/\n+/)
        .map((row) => row.trim())
        .filter((row) => row.startsWith("|") && row.endsWith("|"));

  if (rowCandidates.length < 2) return null;

  const parsedRows = rowCandidates
    .map((row) => splitTableCells(row))
    .filter((cells) => cells.length > 0);

  if (parsedRows.length < 2) return null;

  const contentRows = parsedRows.filter((cells) => !isTableSeparatorRow(cells));
  if (contentRows.length < 2) return null;

  const columnCount = contentRows[0].length;
  if (columnCount < 2) return null;
  if (!contentRows.every((cells) => cells.length === columnCount)) return null;

  return contentRows;
}

function buildDocxTable(rows: string[][]): Table {
  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    borders: {
      top: { style: "single", size: 8, color: COLOR_BLACK },
      bottom: { style: "single", size: 8, color: COLOR_BLACK },
      left: { style: "none", size: 0, color: COLOR_BLACK },
      right: { style: "none", size: 0, color: COLOR_BLACK },
      insideHorizontal: { style: "none", size: 0, color: COLOR_BLACK },
      insideVertical: { style: "none", size: 0, color: COLOR_BLACK },
    },
    alignment: AlignmentType.CENTER,
    rows: rows.map((cells, rowIndex) =>
      new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              verticalAlign: VerticalAlignTable.CENTER,
              borders:
                rowIndex === 0
                  ? {
                      bottom: { style: "single", size: 8, color: COLOR_BLACK },
                    }
                  : undefined,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: {
                    before: 0,
                    after: 0,
                    line: 360,
                    lineRule: LineRuleType.AUTO,
                  },
                  children: [textRun(cell, FONT_CN_SONG, 21, rowIndex === 0)],
                }),
              ],
            }),
        ),
      }),
    ),
  });
}

function isLikelyEquation(raw: string): boolean {
  const trimmed = raw.trim();
  const isDisplayMath = /^\$\$[\s\S]+\$\$$/.test(trimmed);
  const isBracketBlock = /^\[[\s\S]+]$/.test(trimmed) || /^\\\[[\s\S]+\\\]$/.test(trimmed);
  if (isDisplayMath || isBracketBlock) return true;

  const text = extractEquationText(raw);
  if (!text) return false;
  if (text.length > 180) return false;
  if (/[。！？；：]/.test(text)) return false;

  const hasMathKeyword = /\\frac|\\sum|\\int|\\sqrt|\\mathbb|\\mathcal|\\hat|\\tilde|\\left|\\right|\\begin|\\end|∑|∫|√|∞|⊙/.test(raw);
  const hasMathCommand = /\\[A-Za-z]+/.test(raw);
  const hasEquationOperator = /[=<>≤≥]/.test(text);
  const hasScriptContext = /[_^]/.test(text);
  const hasMathContext = /[A-Za-zα-ωΑ-Ω0-9]/.test(text) && /[+\-*/^=<>≤≥×÷_|[\]()]/.test(text);
  const hasChineseProse = /[\u4e00-\u9fff]{2,}/.test(text);
  const hasListLikePrefix = /^\s*(?:\d+[.)]|[（(]\d+[）)]|[-*•])\s+/.test(trimmed);
  const proseOutsideInlineMath = trimmed
    .replace(/^\s*(?:\d+[.)]|[（(]\d+[）)]|[-*•])\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\$[^$\n]+\$/g, "")
    .replace(/[（(][^()（）\n]*[_^\\][^()（）\n]*[）)]/g, "")
    .trim();
  const hasProseOutsideMath = /[A-Za-z\u4e00-\u9fff]{2,}/.test(proseOutsideInlineMath);

  if (hasListLikePrefix && (hasChineseProse || hasProseOutsideMath) && !hasEquationOperator) {
    return false;
  }

  if (hasChineseProse) {
    return hasMathKeyword || (hasEquationOperator && hasMathContext);
  }

  return hasMathKeyword || hasMathCommand || hasScriptContext || (hasEquationOperator && hasMathContext);
}

function isStandaloneInlineMathLine(text: string): boolean {
  return /^\$[^$\n]+\$$/.test(text.trim());
}

function centeredInlineMathParagraph(rawText: string): Paragraph {
  const normalized = normalizeMathArtifactText(rawText.trim());
  return new Paragraph({
    children: buildInlineMathChildren(normalized),
    alignment: AlignmentType.CENTER,
    indent: { firstLine: 0 },
    spacing: {
      before: 120,
      after: 120,
      line: 360,
      lineRule: LineRuleType.AUTO,
    },
  });
}

function equationParagraph(raw: string, state: { current: number }): Table {
  const equationText = normalizeLatexLikeText(extractEquationText(raw));
  state.current += 1;
  const equationNumber = state.current;

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    columnWidths: [
      convertMillimetersToTwip(EQUATION_SIDE_COL_MM),
      convertMillimetersToTwip(EQUATION_MID_COL_MM),
      convertMillimetersToTwip(EQUATION_SIDE_COL_MM),
    ],
    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    },
    borders: {
      top: { style: "none", size: 0, color: COLOR_BLACK },
      bottom: { style: "none", size: 0, color: COLOR_BLACK },
      left: { style: "none", size: 0, color: COLOR_BLACK },
      right: { style: "none", size: 0, color: COLOR_BLACK },
      insideHorizontal: { style: "none", size: 0, color: COLOR_BLACK },
      insideVertical: { style: "none", size: 0, color: COLOR_BLACK },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: convertMillimetersToTwip(EQUATION_SIDE_COL_MM), type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { before: 120, after: 120, line: 360, lineRule: LineRuleType.AUTO },
                children: [textRun("", FONT_CN_SONG, 21)],
              }),
            ],
          }),
          new TableCell({
            width: { size: convertMillimetersToTwip(EQUATION_MID_COL_MM), type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                indent: { firstLine: 0 },
                spacing: { before: 120, after: 120, line: 360, lineRule: LineRuleType.AUTO },
                children: [
                  new Math({
                    children: buildMathComponentsFromExpression(equationText),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: convertMillimetersToTwip(EQUATION_SIDE_COL_MM), type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                indent: { firstLine: 0 },
                spacing: { before: 120, after: 120, line: 360, lineRule: LineRuleType.AUTO },
                children: [
                  textRun("(", FONT_CN_SONG, 21),
                  new SimpleField("SEQ Equation \\* ARABIC", String(equationNumber)),
                  textRun(")", FONT_CN_SONG, 21),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function tableCaptionParagraph(index: number, title: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: 120,
      after: 60,
      line: 360,
      lineRule: LineRuleType.AUTO,
    },
    children: [textRun(`表${index} ${title}`, FONT_CN_HEI, 21, false)],
  });
}

function figureCaptionParagraph(index: number, title: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: 60,
      after: 120,
      line: 360,
      lineRule: LineRuleType.AUTO,
    },
    children: [textRun(`图${index} ${title}`, FONT_CN_HEI, 21, false)],
  });
}

function buildBody(structured: StructuredDoc): FileChild[] {
  const paragraphs: FileChild[] = [];
  const referenceAnchorMap = buildReferenceAnchorMap(structured.blocks);
  const equationState = { current: 0 };
  let tableIndex = 0;
  let figureIndex = 0;

  if (structured.title) {
    paragraphs.push(
      new Paragraph({
        children: [textRun(structured.title, FONT_CN_HEI, 36, true)],
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
      }),
    );
  }

  if (structured.mode === "thesis") {
    paragraphs.push(
      new Paragraph({
        children: [textRun("目录", FONT_CN_HEI, 32, true)],
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
      }),
    );
    paragraphs.push(
      new TableOfContents("目录", {
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
    );
    paragraphs.push(new Paragraph({ text: "" }));
  }

  for (const block of structured.blocks) {
    if (block.type === "heading") {
      paragraphs.push(headingParagraph(block));
      continue;
    }
    if (block.type === "reference") {
      const referenceIndex = parseReferenceIndex(block.text, 0);
      const anchorId = referenceAnchorMap.get(referenceIndex);
      paragraphs.push(referenceParagraphWithAnchor(block.text, anchorId));
      continue;
    }

    const tableCaption = parseTableCaption(block.text);
    if (tableCaption) {
      tableIndex += 1;
      paragraphs.push(tableCaptionParagraph(tableIndex, tableCaption.title));
      continue;
    }

    const figureCaption = parseFigureCaption(block.text);
    if (figureCaption) {
      figureIndex += 1;
      paragraphs.push(figureCaptionParagraph(figureIndex, figureCaption.title));
      continue;
    }

    if (isEquationNumberOnlyLine(block.text)) {
      continue;
    }

    const tableRows = parseInlineMarkdownTable(block.text);
    if (tableRows) {
      paragraphs.push(buildDocxTable(tableRows));
      continue;
    }

    if (isLikelyEquation(block.text)) {
      paragraphs.push(equationParagraph(block.text, equationState));
      continue;
    }

    if (isStandaloneInlineMathLine(block.text)) {
      paragraphs.push(centeredInlineMathParagraph(block.text));
      continue;
    }

    if (hasInlineMath(block.text)) {
      paragraphs.push(baseParagraphWithCitations(block.text, referenceAnchorMap));
      continue;
    }

    paragraphs.push(baseParagraphWithCitations(block.text, referenceAnchorMap));
  }

  return paragraphs;
}

function patchFirstLineIndentToChars(xml: string): string {
  // Word 中字符缩进 2 字符对应 firstLineChars="200"
  return xml.replace(/w:firstLine="420"/g, 'w:firstLineChars="200"');
}

function patchMathItalic(xml: string, mathItalic: boolean): string {
  if (mathItalic) {
    return xml;
  }
  return xml.replace(/<m:r>\s*<m:t>/g, "<m:r><m:rPr><m:nor/></m:rPr><m:t>");
}

async function normalizeDocumentXml(rawBytes: Uint8Array, options: BuildDocxOptions): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(rawBytes);
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    return rawBytes;
  }

  const originalXml = await documentXmlFile.async("string");
  const indentPatched = patchFirstLineIndentToChars(originalXml);
  const patchedXml = patchMathItalic(indentPatched, options.mathItalic ?? true);
  zip.file("word/document.xml", patchedXml);

  return zip.generateAsync({ type: "uint8array" });
}

export async function buildDocx(structured: StructuredDoc, options: BuildDocxOptions = {}): Promise<Uint8Array> {
  const doc = new Document({
    features: {
      updateFields: true,
    },
    numbering: {
      config: [
        {
          reference: REFERENCE_NUMBERING_ID,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "[%1]",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(25),
              bottom: convertMillimetersToTwip(25),
              left: convertMillimetersToTwip(30),
              right: convertMillimetersToTwip(20),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  textRun("第 ", FONT_CN_SONG, 20),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 20,
                    color: COLOR_BLACK,
                    font: FONT_EN,
                  }),
                  textRun(" 页", FONT_CN_SONG, 20),
                ],
              }),
            ],
          }),
        },
        children: buildBody(structured),
      },
    ],
  });

  const rawBytes = await Packer.toBuffer(doc);
  return normalizeDocumentXml(rawBytes, options);
}
