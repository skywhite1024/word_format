import { analyzeText } from "./core/analyzer";
import { buildDocx } from "./core/docx-builder";
import { renderPreview } from "./core/preview";
import type { Mode } from "./core/types";

export interface Env {
  ASSETS: Fetcher;
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

async function parsePayload(request: Request): Promise<{ text: string; mode: Mode } | null> {
  try {
    const payload = (await request.json()) as { text?: unknown; mode?: unknown };
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
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("请求体解析失败。");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/format" && request.method === "POST") {
      try {
        const payload = await parsePayload(request);
        if (!payload) return badRequest("text 不能为空");
        const structured = analyzeText(payload.text, payload.mode);
        return jsonResponse({
          structured,
          previewText: renderPreview(structured),
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
        const structured = analyzeText(payload.text, payload.mode);
        const fileContent = await buildDocx(structured);
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
