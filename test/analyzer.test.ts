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
});
