import { describe, expect, it, vi } from "vitest";
import { structureTextWithLlm } from "../src/core/llm-structurer";

describe("structureTextWithLlm", () => {
  it("should parse structured response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "测试标题",
                  mode: "official",
                  blocks: [
                    { type: "heading", level: 1, text: "一、总体安排" },
                    { type: "paragraph", text: "请按时提交材料。" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const oldFetch = globalThis.fetch;
    vi.stubGlobal("fetch", mockFetch);
    try {
      const result = await structureTextWithLlm(
        "测试标题\n\n一、总体安排\n\n请按时提交材料。",
        "auto",
        {
        apiKey: "mock-key",
        },
      );
      expect(result.title).toBe("测试标题");
      expect(result.blocks.length).toBe(2);
      expect(result.blocks[0].type).toBe("heading");
    } finally {
      vi.stubGlobal("fetch", oldFetch);
    }
  });

  it("should throw when api key missing", async () => {
    await expect(
      structureTextWithLlm("raw", "auto", {
        apiKey: "",
      }),
    ).rejects.toThrow("未配置 ModelScope API Key");
  });

  it("should convert 1、 and 2. items to paragraph with parenthesized index", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "测试标题",
                  mode: "thesis",
                  blocks: [
                    { type: "heading", level: 2, text: "5.1 仿真环境搭建" },
                    { type: "heading", level: 3, text: "1、资产与运动学" },
                    { type: "heading", level: 3, text: "2. 驱动与柔顺性" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const oldFetch = globalThis.fetch;
    vi.stubGlobal("fetch", mockFetch);
    try {
      const result = await structureTextWithLlm(
        "5.1 仿真环境搭建\n\n1、资产与运动学\n2. 驱动与柔顺性",
        "thesis",
        {
          apiKey: "mock-key",
        },
      );

      const item1 = result.blocks.find((block) => block.text.startsWith("（1）"));
      const item2 = result.blocks.find((block) => block.text.startsWith("（2）"));
      expect(item1).toBeDefined();
      expect(item1?.type).toBe("paragraph");
      expect(item2).toBeDefined();
      expect(item2?.type).toBe("paragraph");
    } finally {
      vi.stubGlobal("fetch", oldFetch);
    }
  });
});
