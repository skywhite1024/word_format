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
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  Packer,
  PageNumber,
  type ParagraphChild,
  Paragraph,
  Tab,
  TabStopPosition,
  TabStopType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
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
  const normalized = normalizeMathArtifactText(text.trim());
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
      children: [textRun(headingText, FONT_CN_HEI, 32, true)],
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    });
  }
  if (block.level === 2) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [textRun(headingText, FONT_CN_HEI, 24, true)],
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

  const inlineMath = t.match(/^\$([^\n]+)\$$/);
  if (inlineMath) return inlineMath[1].trim();

  return t;
}

function normalizeLatexLikeText(text: string): string {
  let output = text;

  while (/\\frac\{[^{}]+\}\{[^{}]+\}/.test(output)) {
    output = output.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");
  }

  output = output
    .replace(/\\tau/g, "τ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\delta/g, "δ")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^{}]*)\}/g, "$1")
    .replace(/\\mathbf\{([^{}]*)\}/g, "$1")
    .replace(/\\dot\{([^{}]+)\}/g, "$1̇")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\\|/g, "|")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\sum/g, "∑")
    .replace(/\\int/g, "∫")
    .replace(/\\sqrt/g, "√")
    .replace(/\\_/g, "_")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/([A-Za-z0-9)])_\{([^{}]+)\}/g, "$1_$2")
    .replace(/([A-Za-z0-9)])_([A-Za-z0-9]+)/g, "$1_$2")
    .replace(/([A-Za-z0-9)])\^\{([^{}]+)\}/g, "$1^$2")
    .replace(/([A-Za-z0-9)])\^([A-Za-z0-9]+)/g, "$1^$2")
    .replace(/[{}]/g, "")
    .replace(/\s*[：:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return output;
}

function isMathBaseStart(ch: string): boolean {
  return /[A-Za-zΑ-Ωα-ωτΔΣ∑∫√]/.test(ch);
}

function isScriptBaseSymbol(ch: string): boolean {
  return /[)\]\}|]/.test(ch);
}

function isMathBaseChar(ch: string): boolean {
  return /[A-Za-z0-9Α-Ωα-ωτΔΣ∑∫√̇]/.test(ch);
}

function isScriptTerminator(ch: string): boolean {
  return /[\s+\-*/<>≤≥×÷|(),;:]/.test(ch);
}

function readScriptValue(text: string, start: number): { value: string; end: number } {
  if (start >= text.length) {
    return { value: "", end: start };
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

function createScriptMathComponent(base: string, subScript?: string, superScript?: string): MathComponent {
  const baseChildren: MathComponent[] = [new MathRun(base)];
  const subChildren: MathComponent[] = subScript ? [new MathRun(subScript)] : [];
  const superChildren: MathComponent[] = superScript ? [new MathRun(superScript)] : [];

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
  return new MathRun(base);
}

function buildMathComponentsFromExpression(expression: string): MathComponent[] {
  const components: MathComponent[] = [];
  let cursor = 0;

  while (cursor < expression.length) {
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
    let subScript: string | undefined;
    let superScript: string | undefined;
    let tokenCursor = end;

    while (tokenCursor < expression.length && (expression[tokenCursor] === "_" || expression[tokenCursor] === "^")) {
      const marker = expression[tokenCursor];
      const script = readScriptValue(expression, tokenCursor + 1);
      if (!script.value) {
        break;
      }
      if (marker === "_" && !subScript) {
        subScript = script.value;
      } else if (marker === "^" && !superScript) {
        superScript = script.value;
      } else {
        break;
      }
      tokenCursor = script.end;
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
  return /_|̇|[τΔΣα-ωΑ-Ω]/.test(token);
}

function buildInlineMathChildrenFromToken(text: string): Array<TextRun | Math> {
  const children: Array<TextRun | Math> = [];
  const regex = /[A-Za-zΑ-Ωα-ωτΔΣ][A-Za-z0-9̇]*(?:_[A-Za-z0-9]+)?(?:\^[A-Za-z0-9]+)?/g;
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
      children.push(textRun(plain, FONT_CN_SONG, 24));
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
    const trailing = buildInlineMathChildrenFromToken(tail);
    children.push(...trailing);
  }

  if (children.length === 0 || !/\$[^$\n]+\$/.test(text)) {
    return buildInlineMathChildrenFromToken(text);
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
    rows: rows.map((cells, rowIndex) =>
      new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
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
  const text = extractEquationText(raw);
  if (!text) return false;
  if (text.length > 180) return false;
  if (/[。！？；：]/.test(text)) return false;

  const hasMathKeyword = /\\frac|\\sum|\\int|\\sqrt|∑|∫|√/.test(text);
  const hasEquationOperator = /[=<>≤≥]/.test(text);
  const hasMathContext = /[A-Za-zα-ωΑ-Ω0-9]/.test(text) && /[+\-*/^=<>≤≥×÷]/.test(text);
  return hasMathKeyword || (hasEquationOperator && hasMathContext);
}

function normalizeEquationKey(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function equationParagraph(
  raw: string,
  equationIndexByKey: Map<string, number>,
  state: { current: number },
): Paragraph {
  const equationText = normalizeLatexLikeText(extractEquationText(raw));
  const key = normalizeEquationKey(equationText);
  const existing = equationIndexByKey.get(key);
  const equationNumber = existing ?? state.current + 1;
  if (existing === undefined) {
    state.current = equationNumber;
    equationIndexByKey.set(key, equationNumber);
  }

  return new Paragraph({
    alignment: AlignmentType.LEFT,
    indent: { firstLine: 0 },
    spacing: {
      before: 120,
      after: 120,
      line: 360,
      lineRule: LineRuleType.AUTO,
    },
    tabStops: [
      {
        type: TabStopType.RIGHT,
        position: TabStopPosition.MAX,
      },
    ],
    children: [
      new Math({
        children: buildMathComponentsFromExpression(equationText),
      }),
      new TextRun({ children: [new Tab()] }),
      textRun(`(${equationNumber})`, FONT_CN_SONG, 21),
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
    children: [textRun(`表${index} ${title}`, FONT_CN_HEI, 21, true)],
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
    children: [textRun(`图${index}　${title}`, FONT_CN_HEI, 21, true)],
  });
}

function buildBody(structured: StructuredDoc): FileChild[] {
  const paragraphs: FileChild[] = [];
  const referenceAnchorMap = buildReferenceAnchorMap(structured.blocks);
  const equationIndexByKey = new Map<string, number>();
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
      paragraphs.push(equationParagraph(block.text, equationIndexByKey, equationState));
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
