import { analyzeText, sanitizeMarkdownText } from "./core/analyzer";
import { buildDocx } from "./core/docx-builder";
import { structureTextWithLlm } from "./core/llm-structurer";
import { renderPreview } from "./core/preview";
import { importSharedConversation } from "./core/share-import";
import { deepRepairText } from "./core/text-repair";
import type { ImageData, Mode, StructuredDoc } from "./core/types";

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
  mathItalic: boolean;
  structured?: StructuredDoc;
  images?: Record<string, ImageData>;
}

interface TextOnlyPayload {
  text: string;
}

interface ShareUrlPayload {
  url: string;
}

const SHARE_IMPORT_CACHE_MAX_AGE_SECONDS = 86_400;
const SHARE_IMPORT_CACHE_VERSION = "v2";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getShareImportCacheKey(url: string): Request {
  return new Request(`https://word-format.cache/import/share/${SHARE_IMPORT_CACHE_VERSION}?url=${encodeURIComponent(url)}`, {
    method: "GET",
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

function sanitizeMathItalic(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    return !(input === "false" || input === "0");
  }
  return true;
}

function sanitizeImages(input: unknown): Record<string, ImageData> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const result: Record<string, ImageData> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const img = value as { base64?: unknown; type?: unknown };
    if (typeof img.base64 !== "string" || !img.base64) continue;
    const validTypes = new Set(["jpg", "png", "gif", "bmp"]);
    const type = validTypes.has(img.type as string) ? (img.type as ImageData["type"]) : "png";
    result[key.trim().toLowerCase()] = { base64: img.base64, type };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeStructuredPayload(input: unknown): StructuredDoc | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<StructuredDoc>;
  if (!Array.isArray(value.blocks)) return undefined;

  const mode = value.mode === "thesis" ? "thesis" : "official";
  const blocks = value.blocks
    .map((block) => {
      if (!block || typeof block !== "object") return null;
      const item = block as { type?: unknown; text?: unknown; level?: unknown };
      const type = item.type === "heading" || item.type === "reference" ? item.type : "paragraph";
      const text = typeof item.text === "string" ? item.text : "";
      if (!text.trim()) return null;
      const rawLevel = Number(item.level ?? 0);
      const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(3, rawLevel)) : 0;
      return { type, text, level };
    })
    .filter((block): block is StructuredDoc["blocks"][number] => block !== null);

  if (blocks.length === 0) return undefined;

  const fallbackStats = {
    paragraphCount: blocks.filter((block) => block.type === "paragraph").length,
    headingCount: blocks.filter((block) => block.type === "heading").length,
    referenceCount: blocks.filter((block) => block.type === "reference").length,
  };

  return {
    mode,
    title: typeof value.title === "string" ? value.title : "",
    blocks,
    stats: value.stats ?? fallbackStats,
  };
}

async function parsePayload(request: Request): Promise<RequestPayload | null> {
  try {
    const payload = (await request.json()) as {
      text?: unknown;
      mode?: unknown;
      useLlm?: unknown;
      mathItalic?: unknown;
      structured?: unknown;
      images?: unknown;
    };
    const rawText = typeof payload.text === "string" ? payload.text : "";
    const text = sanitizeMarkdownText(rawText);
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
      mathItalic: sanitizeMathItalic(payload.mathItalic),
      structured: sanitizeStructuredPayload(payload.structured),
      images: sanitizeImages(payload.images),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("请求体解析失败。");
  }
}

async function parseTextOnlyPayload(request: Request): Promise<TextOnlyPayload | null> {
  try {
    const payload = (await request.json()) as { text?: unknown };
    const text = typeof payload.text === "string" ? payload.text : "";
    return text.trim() ? { text } : null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("请求体解析失败。");
  }
}

async function parseShareUrlPayload(request: Request): Promise<ShareUrlPayload | null> {
  try {
    const payload = (await request.json()) as { url?: unknown };
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    return url ? { url } : null;
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

        const result = payload.structured
          ? { structured: payload.structured, engine: "preview" as const, fallbackReason: undefined }
          : await buildStructuredResult(payload, env);
        const fileContent = await buildDocx(result.structured, {
          mathItalic: payload.mathItalic,
          images: payload.images,
        });
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

    if (pathname === "/api/repair" && request.method === "POST") {
      try {
        const payload = await parseTextOnlyPayload(request);
        if (!payload) return badRequest("text 不能为空");

        const repaired = deepRepairText(payload.text);
        return jsonResponse({
          text: repaired,
          changed: repaired !== payload.text,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "深度修复失败";
        return badRequest(message);
      }
    }

    if (pathname === "/api/import/share" && request.method === "POST") {
      try {
        const payload = await parseShareUrlPayload(request);
        if (!payload) return badRequest("url 不能为空");

        const cacheStorage =
          typeof caches === "undefined" ? null : (caches as CacheStorage & { default?: Cache });
        const cache = cacheStorage?.default ?? null;
        const cacheKey = getShareImportCacheKey(payload.url);
        const cached = await cache?.match(cacheKey);
        if (cached) return cached;

        const imported = await importSharedConversation(payload.url);
        const response = jsonResponse(imported);
        response.headers.set("Cache-Control", `public, max-age=${SHARE_IMPORT_CACHE_MAX_AGE_SECONDS}`);
        await cache?.put(cacheKey, response.clone());
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "分享链接导入失败";
        return badRequest(message);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
