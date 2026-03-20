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
});
