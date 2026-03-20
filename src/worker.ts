import { analyzeText } from "./core/analyzer";
import { buildDocx } from "./core/docx-builder";
import { structureTextWithLlm } from "./core/llm-structurer";
import { renderPreview } from "./core/preview";
import type { Mode, StructuredDoc } from "./core/types";

export interface Env {
  ASSETS: Fetcher;
  MODELSCOPE_API_KEY?: string;
  MODELSCOPE_BASE_URL?: string;
  MODELSCOPE_MODEL_ID?: string;
  MODELSCOPE_TIMEOUT_MS?: string;
}

interface RequestPayload {
  text: string;
  mode: Mode;
  useLlm: boolean;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

function sanitizeMode(input: unknown): Mode {
  if (input === "official" || input === "thesis" || input === "auto") {
    return input;
  }
  return "auto";
}

function sanitizeUseLlm(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    return input === "true" || input === "1";
  }
  return true;
}

async function parsePayload(request: Request): Promise<RequestPayload | null> {
  try {
    const payload = (await request.json()) as {
      text?: unknown;
      mode?: unknown;
      useLlm?: unknown;
    };
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text.trim()) {
      return null;
    }
    if (text.length > 200_000) {
      throw new Error("文本过长，当前版本限制为 200000 字符。");
    }
    return {
      text,
      mode: sanitizeMode(payload.mode),
      useLlm: sanitizeUseLlm(payload.useLlm),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("请求体解析失败。");
  }
}

async function buildStructuredResult(
  payload: RequestPayload,
  env: Env,
): Promise<{
  structured: StructuredDoc;
  engine: "llm" | "rule";
  fallbackReason?: string;
}> {
  if (payload.useLlm && env.MODELSCOPE_API_KEY) {
    try {
      const timeoutMs = Number(env.MODELSCOPE_TIMEOUT_MS ?? "60000");
      const structured = await structureTextWithLlm(payload.text, payload.mode, {
        apiKey: env.MODELSCOPE_API_KEY,
        baseUrl: env.MODELSCOPE_BASE_URL,
        modelId: env.MODELSCOPE_MODEL_ID,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 60000,
      });
      return { structured, engine: "llm" };
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : "LLM 调用失败";
      return {
        structured: analyzeText(payload.text, payload.mode),
        engine: "rule",
        fallbackReason,
      };
    }
  }

  return {
    structured: analyzeText(payload.text, payload.mode),
    engine: "rule",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/format" && request.method === "POST") {
      try {
        const payload = await parsePayload(request);
        if (!payload) return badRequest("text 不能为空");

        const result = await buildStructuredResult(payload, env);
        return jsonResponse({
          structured: result.structured,
          previewText: renderPreview(result.structured),
          meta: {
            engine: result.engine,
            fallbackReason: result.fallbackReason ?? null,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "格式化失败";
        return badRequest(message);
      }
    }

    if (pathname === "/api/format/docx" && request.method === "POST") {
      try {
        const payload = await parsePayload(request);
        if (!payload) return badRequest("text 不能为空");

        const result = await buildStructuredResult(payload, env);
        const fileContent = await buildDocx(result.structured);
        const filename = `formatted_${Date.now()}.docx`;
        const stableBytes = new Uint8Array(fileContent.byteLength);
        stableBytes.set(fileContent);
        const body = new Blob([stableBytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "X-Format-Engine": result.engine,
            "X-Format-Fallback": result.fallbackReason ?? "",
            "Cache-Control": "no-store",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "文档导出失败";
        return badRequest(message);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
