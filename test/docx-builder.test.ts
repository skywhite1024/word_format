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
    const settingsXml = await zip.file("word/settings.xml")?.async("string");
    const docContent = documentXml ?? "";
    const settingsContent = settingsXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("<m:t>R</m:t>");
    expect(docContent).toContain("<m:t>total</m:t>");
    expect(docContent).not.toContain("\\text{");
    expect(docContent.match(/SEQ Equation/g)?.length ?? 0).toBe(2);
    expect(settingsContent).toContain("w:updateFields");
    expect(docContent).toContain("第 1 章　绪论");
    expect(docContent).toContain("表1 算法参数对照表");
    expect(docContent).toContain("图1 系统总体架构图");
    expect(docContent).toContain("<w:tbl>");
    expect(docContent).toContain('<w:jc w:val="right"');
    expect(docContent).toContain('<w:jc w:val="center"');
  });

  it("should render inline markdown math as editable math nodes", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "段内公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "（1）任务进度奖励（$R_{\\text{task}}$）： 该项用于引导灵巧手建立有效抓取。",
        },
        {
          type: "paragraph",
          level: 0,
          text: "定义为所有关节实际输出扭矩 $\\tau_i$ 与角速度 $\\dot{q}_i$ 绝对乘积的求和。",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("<m:t>task</m:t>");
    expect(docContent).toContain("<m:t>τ</m:t>");
    expect(docContent).toContain("<m:t>q̇</m:t>");
    expect(docContent).toContain("<m:t>i</m:t>");
  });

  it("should normalize noisy unicode math artifacts into editable inline math", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "噪声公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "（1）任务进度奖励（𝑅task R task）： 该项用于引导。",
        },
        {
          type: "paragraph",
          level: 0,
          text: "定义为扭矩 𝜏𝑖 τ i 与角速度 𝑞˙𝑖 q ˙ i 的乘积。",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("<m:t>task</m:t>");
    expect(docContent).toContain("<m:t>τ</m:t>");
    expect(docContent).toContain("<m:t>q̇</m:t>");
    expect(docContent).toContain("<m:t>i</m:t>");
  });

  it("should normalize mixed noisy formula text from pasted Word-like artifacts", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "复杂噪声公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "（2）能量消耗与柔顺约束（𝑅energy R energy ）：定义为扭矩 𝜏𝑖 τ i 与角速度 𝑞˙𝑖 q ˙ i 的绝对乘积。",
        },
        {
          type: "paragraph",
          level: 0,
          text: "接触力过载惩罚（𝐹𝑐 F c ）：当 𝐹𝑐 F c 超过设定的安全阈值 𝐹safe F safe 时施加惩罚。",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("<m:t>energy</m:t>");
    expect(docContent).toContain("<m:t>c</m:t>");
    expect(docContent).toContain("<m:t>safe</m:t>");
    expect(docContent).toContain("<m:t>τ</m:t>");
    expect(docContent).toContain("<m:t>q̇</m:t>");
  });

  it("should emit real subscript/superscript oMath nodes for latex formulas", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "上下标公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "本方案针对传统 PPO 设计了包含柔顺性内在约束的复合奖励函数 $R_{\\text{total}}$：",
        },
        {
          type: "paragraph",
          level: 0,
          text: "$$R_{\\text{total}} = w_1 R_{\\text{task}} + w_2 R_{\\text{energy}} + w_3 R_{\\text{force}} + w_4 R_{\\text{smoothness}}$$",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("total");
    expect(docContent).toContain("task");
    expect(docContent).toContain("energy");
    expect(docContent).toContain("force");
    expect(docContent).toContain("smoothness");
  });

  it("should emit sub-sup structure for combined scripts", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "上下标组合测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "$$R_{\\text{energy}} = - \\sum_{i=1}^{7} |\\tau_i \\cdot \\dot{q}_i|$$",
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:nary>");
    expect(docContent).toContain('<m:chr m:val="∑"/>');
    expect(docContent).toContain("<m:t>i</m:t>");
    expect(docContent).toContain("<m:t>=</m:t>");
    expect(docContent).toContain("<m:t>1</m:t>");
    expect(docContent).toContain("<m:t>7</m:t>");
  });

  it("should parse exponent and norm absolute bars in block equations", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "指数与范数测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "$$R_{\\text{force}} = - \\max(0, F_c - F_{\\text{safe}})^2$$",
        },
        {
          type: "paragraph",
          level: 0,
          text: "$$R_{\\text{smoothness}} = - \\|a_t - a_{t-1}\\|_2^2$$",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:sSup>");
    expect(docContent).toContain("<m:sSubSup>");
    expect(docContent).toContain("<m:t>2</m:t>");
    expect(docContent).toContain("<m:t>‖</m:t>");
  });

  it("should keep bracketed multiline equations as one numbered equation", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "PCA",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: [
            "[",
            "\\text{Explained Variance Ratio}_k",
            "=================================",
            "",
            "\\frac{\\lambda_k}{\\sum_j \\lambda_j}",
            "]",
          ].join("\n"),
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent.match(/SEQ Equation/g)?.length ?? 0).toBe(1);
    expect(docContent).toContain("<m:f>");
    expect(docContent).toContain("<m:t>=</m:t>");
    expect(docContent).toContain("<m:t>Explained</m:t>");
    expect(docContent).toContain("<m:t>Variance</m:t>");
    expect(docContent).toContain("<m:t>Ratio</m:t>");
  });

  it("should keep numbered prose with inline math as a normal paragraph", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "Inline Math List",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "1. **Model form (f_\\theta) differs**",
        },
        {
          type: "paragraph",
          level: 0,
          text: "3. **Regularizer (\\Omega) differs**",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).not.toContain("<w:tbl>");
    expect(docContent).not.toContain("SEQ Equation");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("Model");
    expect(docContent).toContain("Regularizer");
  });

  it("should render citations as superscript hyperlinks to references", async () => {
    const structured: StructuredDoc = {
      mode: "thesis",
      title: "引用跳转测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "该惩罚项实现柔顺接触过渡[20][21]。",
        },
        {
          type: "heading",
          level: 1,
          text: "参考文献",
        },
        {
          type: "reference",
          level: 0,
          text: "[20] A. Author, Citation Twenty.",
        },
        {
          type: "reference",
          level: 0,
          text: "[21] B. Author, Citation Twenty-One.",
        },
      ],
      stats: { paragraphCount: 3, headingCount: 1, referenceCount: 2 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain('w:anchor="ref-20"');
    expect(docContent).toContain('w:anchor="ref-21"');
    expect(docContent).toContain('w:name="ref-20"');
    expect(docContent).toContain('w:name="ref-21"');
    expect(docContent).toContain('w:val="superscript"');
    expect(docContent).toContain('w:sz w:val="24"');
  });

  it("should reconstruct inline markdown-like table into real docx table", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "表格恢复测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "| 配置模块 | Isaac Lab 关键参数/技术 | Unitree Dex3-1 对应映射与物理意义 ||---|---|---|| 资产与运动学 | UrdfConverterCfg, ArticulationCfg | 导入 Dex3-1 URDF。 || 驱动与柔顺性 | PDGainsCfg | 模拟顺应性。 |",
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<w:tbl>");
    expect(docContent).toContain('w:tblBorders');
    expect(docContent).toContain('w:top w:val="single"');
    expect(docContent).toContain('w:bottom w:val="single"');
    expect(docContent).toContain('w:left w:val="none"');
    expect(docContent).toContain('w:right w:val="none"');
    expect(docContent).toContain('w:vAlign w:val="center"');
    expect(docContent).toContain('w:jc w:val="center"');
    expect(docContent).toContain("配置模块");
    expect(docContent).toContain("资产与运动学");
    expect(docContent).toContain("驱动与柔顺性");
  });

  it("should support math italic toggle off by forcing normal math run", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "公式正体开关测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "$$R_{\\text{force}} = - \\max(0, F_c - F_{\\text{safe}})^2$$",
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured, { mathItalic: false });
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:nor/>");
  });

  it("should center standalone inline math line", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "单行公式居中测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "$R_{\\text{smoothness}} = - \\|a_t - a_{t-1}\\|_2^2$",
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain('<w:jc w:val="center"');
    expect(docContent).toContain('<m:oMath>');
  });

  it("should keep numbered prose with inline math as normal paragraphs", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "行内公式条目测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "1. **模型形式 (f_\\theta) 不同**",
        },
        {
          type: "paragraph",
          level: 0,
          text: "3. **正则项 (\\Omega) 不同**",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("模型形式");
    expect(docContent).toContain("正则项");
    expect(docContent).toContain("<m:t>θ</m:t>");
    expect(docContent).toContain("<m:t>Ω</m:t>");
    expect(docContent).not.toContain("SEQ Equation");
    expect(docContent).not.toContain("<w:tbl>");
  });

  it("should keep norm superscript attached to the whole norm group", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "范数公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "[\n\\min_{w,b}\\; \\frac{1}{2}\\|w\\|^2\n]",
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:f>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("<m:sSup>");
    expect(docContent).toContain("<m:t>‖</m:t>");
    expect(docContent).not.toContain("<m:t>|</m:t>");
  });

  it("should normalize right arrow blocks into math arrows instead of literal command text", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "箭头公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: [
            "[",
            "\\text{数据} \\rightarrow \\text{模型} \\rightarrow \\text{损失} \\rightarrow \\text{梯度} \\rightarrow \\text{更新} \\rightarrow \\text{评估}",
            "]",
          ].join("\n"),
        },
      ],
      stats: { paragraphCount: 1, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:t>→</m:t>");
    expect(docContent).not.toContain("rightarrow");
    expect(docContent).toContain("<m:t>数</m:t>");
    expect(docContent).toContain("<m:t>据</m:t>");
    expect(docContent).toContain("<m:t>评</m:t>");
    expect(docContent).toContain("<m:t>估</m:t>");
  });

  it("should render figure and table captions without bold", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "题注样式测试",
      blocks: [
        { type: "paragraph", level: 0, text: "表 1-1 参数对照" },
        { type: "paragraph", level: 0, text: "图 1-1 结构示意" },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("表1 参数对照");
    expect(docContent).toContain("图1 结构示意");
    expect(docContent).toContain('<w:b w:val="false"');
  });

  it("should preserve nested scripts and greek symbols in complex formulas", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "复杂公式测试",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: [
            "[",
            "\\mathcal{L}(\\theta,\\phi;x)",
            "## \\mathbb{E}_{q_\\phi(z\\mid x)}[\\log p_\\theta(x\\mid z)]",
            "D_{KL}(q_\\phi(z\\mid x)|p(z))",
            "]",
          ].join("\n"),
        },
        {
          type: "paragraph",
          level: 0,
          text: "$$V^\\pi(s)=\\mathbb{E}_{\\pi}\\left[\\sum_{t=0}^{\\infty}\\gamma^t r_t \\mid s_0=s\\right]$$",
        },
        {
          type: "paragraph",
          level: 0,
          text: "$$\\hat{m}_t=\\frac{m_t}{1-\\beta_1^t},\\qquad \\hat{v}_t=\\frac{v_t}{1-\\beta_2^t}$$",
        },
      ],
      stats: { paragraphCount: 3, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:oMath>");
    expect(docContent).toContain("<m:sSub>");
    expect(docContent).toContain("<m:sSup>");
    expect(docContent).toContain("<m:sSubSup>");
    expect(docContent).toContain("<m:t>θ</m:t>");
    expect(docContent).toContain("<m:t>φ</m:t>");
    expect(docContent).toContain("<m:t>π</m:t>");
    expect(docContent).toContain("<m:t>∞</m:t>");
    expect(docContent).toContain("<m:t>q</m:t>");
    expect(docContent).toContain("<m:t>KL</m:t>");
    expect(docContent.match(/SEQ Equation/g)?.length ?? 0).toBe(3);
  });

  it("should emit native fraction radical and n-ary nodes for advanced formulas", async () => {
    const structured: StructuredDoc = {
      mode: "official",
      title: "Advanced Formula Structures",
      blocks: [
        {
          type: "paragraph",
          level: 0,
          text: "[\\text{Attention}(Q,K,V)=\\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V]",
        },
        {
          type: "paragraph",
          level: 0,
          text: "[V^\\pi(s)=\\mathbb{E}_{\\pi}\\left[\\sum_{t=0}^{\\infty}\\gamma^t r_t \\mid s_0=s\\right]]",
        },
      ],
      stats: { paragraphCount: 2, headingCount: 0, referenceCount: 0 },
    };

    const bytes = await buildDocx(structured);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const docContent = documentXml ?? "";

    expect(docContent).toContain("<m:f>");
    expect(docContent).toContain("<m:rad>");
    expect(docContent).toContain("<m:nary>");
    expect(docContent).toContain('<m:chr m:val="∑"/>');
  });
});
