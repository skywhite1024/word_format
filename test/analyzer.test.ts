import { describe, expect, it } from "vitest";
import { analyzeText } from "../src/core/analyzer";

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
});
