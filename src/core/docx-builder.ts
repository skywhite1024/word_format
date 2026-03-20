import JSZip from "jszip";
import {
  AlignmentType,
  Document,
  FileChild,
  Footer,
  HeadingLevel,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  TableOfContents,
  TabStopType,
  TextRun,
  convertMillimetersToTwip,
} from "docx";
import type { Block, StructuredDoc } from "./types";

const FONT_CN_SONG = "宋体";
const FONT_CN_HEI = "黑体";
const FONT_CN_KAI = "楷体_GB2312";
const FONT_EN = "Times New Roman";
const FONT_MATH = "Cambria Math";
const COLOR_BLACK = "000000";
const TWO_CHAR_TWIP = 2 * 210;
const PAGE_CONTENT_WIDTH_TWIP = convertMillimetersToTwip(210 - 30 - 20);

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

function mathRun(text: string): TextRun {
  return new TextRun({
    text,
    size: 24,
    color: COLOR_BLACK,
    font: {
      ascii: FONT_MATH,
      hAnsi: FONT_MATH,
      eastAsia: FONT_CN_SONG,
    },
    characterSpacing: 0,
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
  if (block.level === 1) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [textRun(block.text, FONT_CN_HEI, 32, true)],
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    });
  }
  if (block.level === 2) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [textRun(block.text, FONT_CN_HEI, 24, true)],
      alignment: AlignmentType.LEFT,
      indent: { firstLine: TWO_CHAR_TWIP },
      spacing: { before: 0, after: 0, line: 360, lineRule: LineRuleType.AUTO },
    });
  }
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [textRun(block.text, FONT_CN_KAI, 24, false)],
    alignment: AlignmentType.LEFT,
    indent: { firstLine: TWO_CHAR_TWIP },
    spacing: { before: 0, after: 0, line: 360, lineRule: LineRuleType.AUTO },
  });
}

function referenceParagraph(raw: string, index: number): Paragraph {
  const content = raw.replace(/^\[\d+\]\s*/, "").replace(/^\d+[).、]\s*/, "").trim();
  return new Paragraph({
    children: [textRun(`[${index}] ${content}`, FONT_CN_KAI, 21)],
    alignment: AlignmentType.LEFT,
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

function formulaParagraph(text: string): Paragraph {
  const content = text.trim();
  const withNo = content.match(/^(.+?)\s*\((\d+[-－]\d+)\)$/);
  if (!withNo) {
    return new Paragraph({
      children: [mathRun(content)],
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120, line: 360, lineRule: LineRuleType.AUTO },
    });
  }

  const expression = withNo[1].trim();
  const no = `(${withNo[2]})`;
  return new Paragraph({
    children: [new TextRun({ children: [new Tab()] }), mathRun(expression), new TextRun({ children: [new Tab()] }), textRun(no, FONT_CN_SONG, 21)],
    tabStops: [
      { type: TabStopType.CENTER, position: Math.floor(PAGE_CONTENT_WIDTH_TWIP / 2) },
      { type: TabStopType.RIGHT, position: PAGE_CONTENT_WIDTH_TWIP },
    ],
    spacing: { before: 120, after: 120, line: 360, lineRule: LineRuleType.AUTO },
  });
}

function buildBody(structured: StructuredDoc): FileChild[] {
  const paragraphs: FileChild[] = [];

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

  let refIdx = 1;
  for (const block of structured.blocks) {
    if (block.type === "heading") {
      paragraphs.push(headingParagraph(block));
      continue;
    }
    if (block.type === "reference") {
      paragraphs.push(referenceParagraph(block.text, refIdx));
      refIdx += 1;
      continue;
    }
    if (block.type === "formula") {
      paragraphs.push(formulaParagraph(block.text));
      continue;
    }
    paragraphs.push(baseParagraph(block.text));
  }

  return paragraphs;
}

function applyCharIndentXmlPatch(xml: string): string {
  return xml.replace(/<w:ind([^/>]*)\/>/g, (_full, rawAttrs: string) => {
    let attrs = rawAttrs;

    const hasFirstLine = /\bw:firstLine="[^"]*"/.test(attrs);
    const hasHanging = /\bw:hanging="[^"]*"/.test(attrs);

    if (hasFirstLine) {
      attrs = attrs.replace(/\s*w:firstLine="[^"]*"/g, "");
      if (!/\bw:firstLineChars=/.test(attrs)) {
        attrs += ' w:firstLineChars="200"';
      }
    }

    if (hasHanging) {
      attrs = attrs.replace(/\s*w:left="[^"]*"/g, "");
      attrs = attrs.replace(/\s*w:hanging="[^"]*"/g, "");
      if (!/\bw:leftChars=/.test(attrs)) {
        attrs += ' w:leftChars="200"';
      }
      if (!/\bw:hangingChars=/.test(attrs)) {
        attrs += ' w:hangingChars="200"';
      }
    }

    return `<w:ind${attrs}/>`;
  });
}

async function normalizeIndentToChars(docBytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docBytes);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) {
    return docBytes;
  }

  const originalXml = await docXmlFile.async("string");
  const patchedXml = applyCharIndentXmlPatch(originalXml);
  zip.file("word/document.xml", patchedXml);

  return zip.generateAsync({ type: "uint8array" });
}

export async function buildDocx(structured: StructuredDoc): Promise<Uint8Array> {
  const doc = new Document({
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
  return normalizeIndentToChars(rawBytes);
}
