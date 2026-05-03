import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeText, sanitizeMarkdownText } from "./core/analyzer";
import { buildDocx } from "./core/docx-builder";
import { structureTextWithLlm } from "./core/llm-structurer";
import { renderPreview } from "./core/preview";
import { importSharedConversation } from "./core/share-import";
import { deepRepairText } from "./core/text-repair";
import type { ImageData, Mode, StructuredDoc } from "./core/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const IMAGE_TEMP_DIR = path.resolve(__dirname, "../.image-uploads");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || "8788");

// Ensure temp dir exists
if (!fs.existsSync(IMAGE_TEMP_DIR)) {
  fs.mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function badRequest(res: http.ServerResponse, message: string) {
  jsonResponse(res, { error: message }, 400);
}

function sanitizeMode(input: unknown): Mode {
  if (input === "official" || input === "thesis" || input === "auto") return input;
  return "auto";
}

function sanitizeBoolean(input: unknown, defaultValue: boolean): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    if (defaultValue) return !(input === "false" || input === "0");
    return input === "true" || input === "1";
  }
  return defaultValue;
}

interface FormatPayload {
  text: string;
  mode: Mode;
  useLlm: boolean;
  mathItalic: boolean;
  useOriginalCaptionIndex: boolean;
  structured?: StructuredDoc;
  images?: Record<string, ImageData>;
  imageIds?: string[];
}

function parseFormatPayload(body: string): FormatPayload | null {
  const payload = JSON.parse(body) as Record<string, unknown>;
  const rawText = typeof payload.text === "string" ? payload.text : "";
  const text = sanitizeMarkdownText(rawText);
  if (!text.trim()) return null;
  if (text.length > 10_000_000) throw new Error("文本过长。");

  const imageIds = Array.isArray(payload.imageIds)
    ? (payload.imageIds as unknown[]).filter((id): id is string => typeof id === "string")
    : undefined;

  // Load images from disk by ID
  let images: Record<string, ImageData> | undefined;
  if (imageIds && imageIds.length > 0) {
    images = {};
    for (const id of imageIds) {
      const metaPath = path.join(IMAGE_TEMP_DIR, `${id}.json`);
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { name: string; type: string; filePath: string };
      if (!fs.existsSync(meta.filePath)) continue;
      const buffer = fs.readFileSync(meta.filePath);
      const base64 = buffer.toString("base64");
      const key = meta.name.replace(/\.[^.]+$/, "").trim().toLowerCase();
      images[key] = { base64, type: meta.type as ImageData["type"] };
    }
    if (Object.keys(images).length === 0) images = undefined;
  }

  return {
    text,
    mode: sanitizeMode(payload.mode),
    useLlm: sanitizeBoolean(payload.useLlm, true),
    mathItalic: sanitizeBoolean(payload.mathItalic, true),
    useOriginalCaptionIndex: sanitizeBoolean(payload.useOriginalCaptionIndex, false),
    structured: undefined,
    images,
  };
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
    .filter((b): b is StructuredDoc["blocks"][number] => b !== null);
  if (blocks.length === 0) return undefined;
  return {
    mode,
    title: typeof value.title === "string" ? value.title : "",
    blocks,
    stats: value.stats ?? {
      paragraphCount: blocks.filter((b) => b.type === "paragraph").length,
      headingCount: blocks.filter((b) => b.type === "heading").length,
      referenceCount: blocks.filter((b) => b.type === "reference").length,
    },
  };
}

async function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return (await readBodyBuffer(req)).toString("utf-8");
}

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse) {
  let urlPath = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(PUBLIC_DIR, urlPath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const mimeType = getMimeType(resolved);
  const content = fs.readFileSync(resolved);
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": "no-cache",
  });
  res.end(content);
}

async function buildStructuredResult(payload: FormatPayload): Promise<{
  structured: StructuredDoc;
  engine: "llm" | "rule";
  fallbackReason?: string;
}> {
  if (payload.useLlm && process.env.MODELSCOPE_API_KEY) {
    try {
      const timeoutMs = Number(process.env.MODELSCOPE_TIMEOUT_MS ?? "60000");
      const structured = await structureTextWithLlm(payload.text, payload.mode, {
        apiKey: process.env.MODELSCOPE_API_KEY,
        baseUrl: process.env.MODELSCOPE_BASE_URL,
        modelId: process.env.MODELSCOPE_MODEL_ID,
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

function openBrowser(url: string) {
  try {
    if (process.platform === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else if (process.platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
  } catch {
    console.log(`[提示] 无法自动打开浏览器，请手动访问: ${url}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const { pathname } = url;

  try {
    // POST /api/upload-image — raw binary upload
    if (pathname === "/api/upload-image" && req.method === "POST") {
      const rawName = req.headers["x-image-name"];
      const imageName = decodeURIComponent(Array.isArray(rawName) ? rawName[0] || "image" : rawName || "image");
      const rawType = req.headers["x-image-type"];
      const imageType = (Array.isArray(rawType) ? rawType[0] || "png" : rawType || "png").toLowerCase();

      const validTypes = new Set(["jpg", "png", "gif", "bmp"]);
      const type = validTypes.has(imageType) ? imageType : "png";

      const buffer = await readBodyBuffer(req);
      if (buffer.length === 0) return badRequest(res, "图片数据为空");

      const id = crypto.randomBytes(8).toString("hex");
      const ext = type === "jpg" ? "jpg" : type;
      const filePath = path.join(IMAGE_TEMP_DIR, `${id}.${ext}`);

      fs.writeFileSync(filePath, buffer);
      fs.writeFileSync(path.join(IMAGE_TEMP_DIR, `${id}.json`), JSON.stringify({
        name: imageName,
        type,
        filePath,
        size: buffer.length,
      }));

      const name = imageName.replace(/\.[^.]+$/, "").trim().toLowerCase();
      console.log(`[图片] 已上传: ${name}.${type} (${(buffer.length / 1024).toFixed(0)}KB) -> ${id}`);

      return jsonResponse(res, { id, name, type, size: buffer.length });
    }

    // GET /api/image/:id — serve uploaded image
    if (pathname.startsWith("/api/image/") && req.method === "GET") {
      const id = pathname.split("/")[3];
      if (!id) { res.writeHead(404); return res.end("Not Found"); }

      const metaPath = path.join(IMAGE_TEMP_DIR, `${id}.json`);
      if (!fs.existsSync(metaPath)) { res.writeHead(404); return res.end("Not Found"); }

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { filePath: string; type: string };
      if (!fs.existsSync(meta.filePath)) { res.writeHead(404); return res.end("Not Found"); }

      const content = fs.readFileSync(meta.filePath);
      res.writeHead(200, {
        "Content-Type": `image/${meta.type === "jpg" ? "jpeg" : meta.type}`,
        "Cache-Control": "public, max-age=3600",
      });
      return res.end(content);
    }

    // DELETE /api/image/:id — delete uploaded image
    if (pathname.startsWith("/api/image/") && req.method === "DELETE") {
      const id = pathname.split("/")[3];
      if (!id) return badRequest(res, "missing id");

      const metaPath = path.join(IMAGE_TEMP_DIR, `${id}.json`);
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { filePath: string };
        if (fs.existsSync(meta.filePath)) fs.unlinkSync(meta.filePath);
        fs.unlinkSync(metaPath);
      }
      return jsonResponse(res, { ok: true });
    }

    // POST /api/format
    if (pathname === "/api/format" && req.method === "POST") {
      const body = await readBody(req);
      const payload = parseFormatPayload(body);
      if (!payload) return badRequest(res, "text 不能为空");
      const result = await buildStructuredResult(payload);
      return jsonResponse(res, {
        structured: result.structured,
        previewText: renderPreview(result.structured),
        meta: { engine: result.engine, fallbackReason: result.fallbackReason ?? null },
      });
    }

    // POST /api/format/docx
    if (pathname === "/api/format/docx" && req.method === "POST") {
      const body = await readBody(req);
      const payload = parseFormatPayload(body);
      if (!payload) return badRequest(res, "text 不能为空");

      const structuredPayload = (JSON.parse(body) as { structured?: unknown }).structured;
      const result = structuredPayload
        ? { structured: sanitizeStructuredPayload(structuredPayload)!, engine: "preview" as const, fallbackReason: undefined }
        : await buildStructuredResult(payload);

      if (!result.structured) return badRequest(res, "无法解析文档结构");

      const fileContent = await buildDocx(result.structured, {
        mathItalic: payload.mathItalic,
        images: payload.images,
        useOriginalCaptionIndex: payload.useOriginalCaptionIndex,
      });
      const filename = `formatted_${Date.now()}.docx`;
      const stableBytes = new Uint8Array(fileContent.byteLength);
      stableBytes.set(fileContent);

      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Format-Engine": result.engine,
        "X-Format-Fallback": result.fallbackReason ?? "",
        "Cache-Control": "no-store",
      });
      return res.end(Buffer.from(stableBytes));
    }

    // POST /api/repair
    if (pathname === "/api/repair" && req.method === "POST") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as { text?: unknown };
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text.trim()) return badRequest(res, "text 不能为空");
      const repaired = deepRepairText(text);
      return jsonResponse(res, { text: repaired, changed: repaired !== text });
    }

    // POST /api/import/share
    if (pathname === "/api/import/share" && req.method === "POST") {
      const body = await readBody(req);
      const payload = JSON.parse(body) as { url?: unknown };
      const urlStr = typeof payload.url === "string" ? payload.url.trim() : "";
      if (!urlStr) return badRequest(res, "url 不能为空");
      const imported = await importSharedConversation(urlStr);
      return jsonResponse(res, imported);
    }

    // Static files
    serveStaticFile(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器内部错误";
    console.error(`[错误] ${pathname}: ${message}`);
    if (!res.headersSent) {
      badRequest(res, message);
    }
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`
╔══════════════════════════════════════════════════════╗
║        Word Format 本地服务已启动                      ║
╠══════════════════════════════════════════════════════╣
║  地址: ${url.padEnd(43)}║
║  按 Ctrl+C 停止服务                                   ║
╚══════════════════════════════════════════════════════╝
  `);
  console.log("[启动] 正在打开浏览器...");
  openBrowser(url);
});
