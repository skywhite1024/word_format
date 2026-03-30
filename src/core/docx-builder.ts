import {
  AlignmentType,
  Document,
  FileChild,
  Footer,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Math,
  MathRun,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  TabStopPosition,
  TabStopType,
  TableOfContents,
  TextRun,
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

function textRun(
  text: string,
  cnFont: string,
  sizeHalfPt: number,
  bold = false,
): TextRun {
  return new TextRun({
    text,
    bold,
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
  return new Paragraph({
    children: [textRun(text, FONT_CN_SONG, 24)],
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
      /^(第[0-9一二三四五六七八九十百千]+[章节部分篇])\s*/,
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
  const content = raw.replace(/^\[\d+\]\s*/, "").replace(/^\d+[).、]\s*/, "").trim();
  return new Paragraph({
    children: [textRun(content, FONT_CN_KAI, 21)],
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
  const equationText = extractEquationText(raw);
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
        children: [new MathRun(equationText)],
      }),
      new TextRun({ children: [new Tab()] }),
      textRun(`(${equationNumber})`, FONT_CN_SONG, 21),
    ],
  });
}

function buildBody(structured: StructuredDoc): FileChild[] {
  const paragraphs: FileChild[] = [];
  const equationIndexByKey = new Map<string, number>();
  const equationState = { current: 0 };

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
      paragraphs.push(referenceParagraph(block.text));
      continue;
    }

    if (isLikelyEquation(block.text)) {
      paragraphs.push(equationParagraph(block.text, equationIndexByKey, equationState));
      continue;
    }

    paragraphs.push(baseParagraph(block.text));
  }

  return paragraphs;
}

function patchFirstLineIndentToChars(xml: string): string {
  // Word 中字符缩进 2 字符对应 firstLineChars="200"
  return xml.replace(/w:firstLine="420"/g, 'w:firstLineChars="200"');
}

async function normalizeFirstLineIndentToChars(rawBytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(rawBytes);
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    return rawBytes;
  }

  const originalXml = await documentXmlFile.async("string");
  const patchedXml = patchFirstLineIndentToChars(originalXml);
  zip.file("word/document.xml", patchedXml);

  return zip.generateAsync({ type: "uint8array" });
}

export async function buildDocx(structured: StructuredDoc): Promise<Uint8Array> {
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
  return normalizeFirstLineIndentToChars(rawBytes);
}
