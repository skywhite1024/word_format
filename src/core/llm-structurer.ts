import { composeStructuredDoc } from "./analyzer";
import type { Block, Mode, StructuredDoc } from "./types";

export interface LlmConfig {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  timeoutMs?: number;
}

interface ModelScopeChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface LlmStructuredPayload {
  title?: unknown;
  mode?: unknown;
  blocks?: unknown;
}

function stripCodeFence(text: string): string {
  const content = text.trim();
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : content;
}

function extractFirstJsonObject(text: string): string {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) {
    throw new Error("LLM 输出中未找到 JSON 起始符。");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  throw new Error("LLM 输出中的 JSON 不完整。");
}

function safeJsonParse(text: string): LlmStructuredPayload {
  const jsonText = extractFirstJsonObject(text);
  return JSON.parse(jsonText) as LlmStructuredPayload;
}

function normalizeMode(mode: unknown, fallback: Mode): Mode {
  if (mode === "official" || mode === "thesis" || mode === "auto") return mode;
  return fallback;
}

function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { type?: unknown; text?: unknown; level?: unknown };
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text) return null;

  const type = candidate.type;
  if (type === "heading") {
    const parsedLevel = Number(candidate.level);
    const level = Number.isFinite(parsedLevel) && parsedLevel >= 1 && parsedLevel <= 3 ? parsedLevel : 1;
    return { type: "heading", text, level };
  }
  if (type === "reference") {
    return { type: "reference", text, level: 0 };
  }
  return { type: "paragraph", text, level: 0 };
}

function createPrompt(rawText: string, mode: Mode): string {
  return [
    "你是专业中文文档排版分析器。",
    "请将输入文本转换为结构化文档数据。",
    "必须输出严格 JSON，不要输出 markdown，不要输出额外解释。",
    "JSON 格式如下：",
    '{"title":"", "mode":"official|thesis", "blocks":[{"type":"heading|paragraph|reference","level":1,"text":""}]}',
    "规则：",
    "1) 只能使用原文中的句子或短语，不允许编造新主题。",
    "2) 必须保持原文顺序，不可重排段落。",
    "3) 标题层级仅允许 1/2/3，正文为 paragraph，参考文献条目为 reference。",
    "4) 识别标题时，优先识别短标题（一般 <= 26 字）。",
    "5) 凡是编号句（如 1. / 2. / （1））且内容较长、包含说明性标点（：；。），通常判为 paragraph，不要判为 heading。",
    "6) 如果识别到摘要/目录/参考文献/致谢等学术结构，mode 推荐 thesis，否则 official。",
    `7) 用户请求模式为：${mode}。若不是 auto，请优先遵循用户请求。`,
    "8) 若无法确定结构，按原文逐段输出 paragraph。",
    "",
    "原始文本如下：",
    rawText,
  ].join("\n");
}

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}

function validateGrounding(blocks: Block[], inputText: string): void {
  const source = compactText(inputText);
  if (!source) return;

  let groundedCount = 0;
  for (const block of blocks) {
    const t = compactText(block.text);
    if (!t) continue;
    if (t.length <= 6 || source.includes(t)) {
      groundedCount += 1;
    }
  }

  const ratio = groundedCount / blocks.length;
  if (ratio < 0.6) {
    throw new Error("LLM 输出与原文一致性不足，已触发回退。");
  }
}

export async function structureTextWithLlm(
  text: string,
  mode: Mode,
  config: LlmConfig,
): Promise<StructuredDoc> {
  if (!config.apiKey) {
    throw new Error("未配置 ModelScope API Key。");
  }

  const baseUrl = config.baseUrl ?? "https://api-inference.modelscope.cn/v1";
  const modelId = config.modelId ?? "ZhipuAI/GLM-5";
  const timeoutMs = config.timeoutMs ?? 25_000;

  let lastError: unknown = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("LLM 请求超时"), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: "你是结构化文本解析助手，只输出 JSON。",
            },
            {
              role: "user",
              content: createPrompt(text, mode),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ModelScope 接口失败(${response.status}): ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as ModelScopeChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("ModelScope 返回为空。");
      }

      const payload = safeJsonParse(content);
      const title = typeof payload.title === "string" ? payload.title : "";
      const modelMode = normalizeMode(payload.mode, mode);
      const rawBlocks = Array.isArray(payload.blocks) ? payload.blocks : [];
      const blocks = rawBlocks
        .map((item) => normalizeBlock(item))
        .filter((item): item is Block => item !== null);

      if (blocks.length === 0) {
        throw new Error("LLM 未返回有效段落结构。");
      }
      validateGrounding(blocks, text);

      return composeStructuredDoc(modelMode, title, blocks);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("LLM 调用失败");
}
