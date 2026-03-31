import { describe, expect, it } from "vitest";
import { analyzeText, sanitizeMarkdownText } from "../src/core/analyzer";

describe("analyzeText", () => {
  it("should detect thesis mode and references", () => {
    const text = [
      "基于规则的自动排版系统",
      "",
      "摘要",
      "",
      "本文研究自动化排版。",
      "",
      "参考文献",
      "",
      "[1] 王某. 文献条目一.",
      "[2] 李某. 文献条目二.",
    ].join("\n");

    const result = analyzeText(text, "auto");
    expect(result.mode).toBe("thesis");
    expect(result.title).toBe("基于规则的自动排版系统");
    expect(result.stats.referenceCount).toBe(2);
  });

  it("should normalize references even in official mode when section exists", () => {
    const text = [
      "工作通告",
      "",
      "参考文献",
      "",
      "[1] 张三. 文献条目一.",
      "[2] 李四. 文献条目二.",
    ].join("\n");

    const result = analyzeText(text, "official");
    expect(result.mode).toBe("official");
    expect(result.stats.referenceCount).toBe(2);
    expect(result.blocks.filter((b) => b.type === "reference")).toHaveLength(2);
  });

  it("should keep official mode when requested", () => {
    const text = "通知\n\n一、总体安排\n\n请各部门按时提交材料。";
    const result = analyzeText(text, "official");
    expect(result.mode).toBe("official");
    expect(result.stats.headingCount).toBe(1);
  });

  it("should not misclassify long numbered sentence as heading", () => {
    const text = [
      "调度模型",
      "",
      "1. 储能侧约束：即上述的储能运行约束模型，包括荷电状态、充放电功率、充放电状态等约束；",
      "",
      "3. 含不确定性的调度模型：考虑到电力市场中的电价、新能源出力、负荷需求均存在显著的不确定性。",
    ].join("\n");

    const result = analyzeText(text, "official");
    const headingTexts = result.blocks.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headingTexts).not.toContain(
      "1. 储能侧约束：即上述的储能运行约束模型，包括荷电状态、充放电功率、充放电状态等约束；",
    );
    expect(result.blocks.filter((b) => b.type === "paragraph").length).toBeGreaterThanOrEqual(2);
  });

  it("should classify 2.3.1 as level-3 heading", () => {
    const text = [
      "研究标题",
      "",
      "2.3 多指灵巧手操作与传统机械臂操作的本质区别",
      "",
      "2.3.1 数学维度：从确定性运动学到维度爆炸",
      "",
      "这里是正文内容。",
    ].join("\n");

    const result = analyzeText(text, "thesis");
    const level3 = result.blocks.find(
      (b) => b.type === "heading" && b.text.startsWith("2.3.1 "),
    );

    expect(level3).toBeDefined();
    expect(level3?.level).toBe(3);
  });

  it("should recognize long 5.1 and 5.2 headings", () => {
    const text = [
      "方案设计",
      "",
      "5.1 仿真环境搭建：基于 Isaac Lab 的高保真配置",
      "",
      "这里是 5.1 的正文。",
      "",
      "5.2 算法改进设计：包含柔顺性约束的复合奖励函数",
      "",
      "这里是 5.2 的正文。",
    ].join("\n");

    const result = analyzeText(text, "thesis");
    const targetHeadings = result.blocks.filter(
      (b) => b.type === "heading" && (b.text.startsWith("5.1 ") || b.text.startsWith("5.2 ")),
    );

    expect(targetHeadings).toHaveLength(2);
    expect(targetHeadings.every((h) => h.level === 2)).toBe(true);
  });

  it("should keep 1、2、3、 as paragraph items and normalize to parenthesized format", () => {
    const text = [
      "第四章 存在的主要技术与非技术问题",
      "",
      "4.1 技术难点分析",
      "",
      "1、极高维状态与动作空间的探索效率陷阱",
      "2、接触不稳定导致的奖励稀疏与语义陷阱",
      "3、Sim2Real 过程中的物理参数失真与柔顺建模难题",
    ].join("\n");

    const result = analyzeText(text, "thesis");
    const itemBlocks = result.blocks.filter(
      (b) => b.text.startsWith("（1）") || b.text.startsWith("（2）") || b.text.startsWith("（3）"),
    );

    expect(itemBlocks).toHaveLength(3);
    expect(itemBlocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(result.blocks.some((b) => b.type === "heading" && /^\d+、/.test(b.text))).toBe(false);
  });

  it("should convert 1.2.3. items under level-1/2 headings to paragraph sub-items", () => {
    const text = [
      "二、概述与研究背景",
      "",
      "2.4 非结构化复杂环境下的交互痛点",
      "",
      "1. 不可消除的感知误差与刚性碰撞灾难。",
      "2. 目标物体的脆弱性与物理属性盲盒效应。",
      "3. 复杂接触状态带来的实时控制困难。",
    ].join("\n");

    const result = analyzeText(text, "thesis");
    const itemBlocks = result.blocks.filter(
      (b) => b.text.startsWith("（1）") || b.text.startsWith("（2）") || b.text.startsWith("（3）"),
    );

    expect(itemBlocks).toHaveLength(3);
    expect(itemBlocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(result.blocks.some((b) => b.type === "heading" && /^\d+\.\s+/.test(b.text))).toBe(false);
  });

  it("should sanitize markdown markers from pasted text", () => {
    const raw = [
      "## 标题",
      "",
      "**加粗内容** 和 *强调内容*",
      "",
      "> 引用行",
      "",
      "- 列表项",
      "",
      "---",
      "",
      "[链接](https://example.com)",
    ].join("\n");

    const cleaned = sanitizeMarkdownText(raw);
    expect(cleaned).toContain("标题");
    expect(cleaned).toContain("加粗内容 和 强调内容");
    expect(cleaned).toContain("链接 (https://example.com)");
    expect(cleaned).not.toContain("##");
    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("> 引用行");
    expect(cleaned).not.toContain("---");
  });

  it("should detect chapter heading with spaces as level-1 heading", () => {
    const text = [
      "论文题目",
      "",
      "第 1 章 绪论",
      "",
      "正文段落。",
    ].join("\n");

    const result = analyzeText(text, "thesis");
    const chapter = result.blocks.find(
      (block) => block.type === "heading" && block.text.startsWith("第 1 章"),
    );

    expect(chapter).toBeDefined();
    expect(chapter?.level).toBe(1);
  });

  it("should not classify standalone equation number marker as heading", () => {
    const text = [
      "公式段",
      "",
      "R_{\\text{energy}} = - \\sum_{i=1}^{7} |\\tau_i \\cdot \\dot{q}_i|",
      "",
      "(2)",
      "",
      "后续说明文本。",
    ].join("\n");

    const result = analyzeText(text, "thesis");
    const markerAsHeading = result.blocks.find((block) => block.type === "heading" && block.text === "(2)");

    expect(markerAsHeading).toBeUndefined();
  });
});
