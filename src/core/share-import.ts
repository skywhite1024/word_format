import { deepRepairText } from "./text-repair";

export type ShareSource = "chatgpt" | "gemini";

export interface ImportedShareDocument {
  source: ShareSource;
  title: string;
  text: string;
  url: string;
}

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
};

function decodeJsonStringToken(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeImportText(title: string, sections: string[]): string {
  const uniqueSections: string[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const trimmed = deepRepairText(section);
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueSections.push(trimmed);
  }

  const body = uniqueSections.join("\n\n");
  if (!title) {
    return body;
  }
  if (!body) {
    return `# ${title}`;
  }
  return `# ${title}\n\n${body}`;
}

function parseReaderMarkdown(readerOutput: string): string {
  const marker = "Markdown Content:";
  const index = readerOutput.indexOf(marker);
  if (index < 0) {
    return readerOutput.trim();
  }
  return readerOutput.slice(index + marker.length).trim();
}

function extractReaderTitle(readerOutput: string): string {
  const match = readerOutput.match(/^Title:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function cleanChatGptReaderMarkdown(
  markdown: string,
  shareUrl: string,
  fallbackTitle = "",
): { title: string; text: string } {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const titleLine = lines.find((line) => /^#\s+/.test(line)) ?? "";
  const title =
    titleLine.replace(/^#\s+/, "").replace(/^ChatGPT\s*-\s*/i, "").trim() ||
    fallbackTitle.replace(/^ChatGPT\s*-\s*/i, "").trim();
  const titleIndex = titleLine ? lines.indexOf(titleLine) : 0;

  const workingLines = lines
    .slice(titleIndex >= 0 ? titleIndex + 1 : 0)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed === shareUrl) return false;
      if (trimmed.includes("chatgpt.com/share/")) return false;
      if (
        /^(Skip to content|Chat history|New chat|Search chats|Images|Apps|Deep research|See plans and pricing|Settings|Help|Log in|Sign up for free|Voice|ChatGPT)$/i.test(
          trimmed,
        )
      ) {
        return false;
      }
      if (/^This is a copy of a conversation/i.test(trimmed)) return false;
      if (/^Report conversation$/i.test(trimmed)) return false;
      if (/^Thought for \d+s$/i.test(trimmed)) return false;
      if (/^Get responses tailored to you$/i.test(trimmed)) return false;
      if (/^Log in to get answers based on saved chats/i.test(trimmed)) return false;
      return true;
    });

  const compactLines = workingLines.filter((line) => line.trim() !== "");
  if (compactLines.length === 0) {
    return { title, text: title ? `# ${title}` : "" };
  }

  const firstPrompt = compactLines[0] ?? "";
  const answerLines = compactLines.slice(1);

  if (answerLines.length === 0) {
    return {
      title,
      text: normalizeImportText(title, [firstPrompt]),
    };
  }

  return {
    title,
    text: normalizeImportText(title, [`## 你说\n${firstPrompt}`, `## ChatGPT\n${answerLines.join("\n")}`]),
  };
}

function cleanGeminiReaderMarkdown(markdown: string, shareUrl: string): { title: string; text: string } {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const titleIndex = lines.findIndex((line) => /^#\s+\*\*.+\*\*$/.test(line) || /^#\s+.+$/.test(line));
  const startIndex = titleIndex >= 0 ? titleIndex : 0;
  const workingLines = lines.slice(startIndex).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (trimmed === shareUrl) return false;
    if (trimmed.includes("gemini.google.com/share/")) return false;
    if (/^\[(Sign in|Gemini|About Gemini|Subscriptions|For Business)/i.test(trimmed)) return false;
    if (/^Created with\b/i.test(trimmed)) return false;
    if (/^Published\b/i.test(trimmed)) return false;
    return true;
  });

  const titleLine = workingLines.find((line) => /^#\s+/.test(line)) ?? "";
  const title = titleLine.replace(/^#\s+/, "").replace(/\*\*/g, "").trim();
  const bodyLines = workingLines
    .filter((line, index) => index === 0 || line !== titleLine)
    .map((line) => {
      if (/^You said$/i.test(line.trim())) {
        return "## 你说";
      }
      return line.replace(/\*\*/g, "");
    });

  return {
    title,
    text: deepRepairText(bodyLines.join("\n").trim()),
  };
}

function parseGeminiHtmlFallback(html: string, shareUrl: string): { title: string; text: string } {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  const text = decodeHtmlEntities(withoutScripts)
    .replace(/\u200B/g, "")
    .replace(/\n{3,}/g, "\n\n");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => line === shareUrl || line.includes("/share/"));
  const bodyLines = (startIndex >= 0 ? lines.slice(startIndex + 1) : lines).filter((line) => {
    if (/^(登录|Sign in|Gemini|About Gemini|Subscriptions|For Business)$/i.test(line)) return false;
    return true;
  });
  const title = bodyLines[0] ?? "Gemini 分享内容";
  return {
    title,
    text: deepRepairText(bodyLines.join("\n")),
  };
}

function extractChatGptTitle(html: string): string {
  const escapedMatch = html.match(/\\"pageTitle\\",\\"((?:\\\\.|[^"\\])*)\\"/);
  if (escapedMatch?.[1]) {
    return decodeJsonStringToken(escapedMatch[1]).trim();
  }

  const titleMatch = html.match(/<title>ChatGPT\s*-\s*([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? "ChatGPT 分享内容";
}

function extractChatGptMessageParts(html: string): string[] {
  const patterns = [
    /content_type\\",\\"text\\",\\"parts\\",\[[^\]]*],\\"((?:\\.|[^"])*)\\"/g,
    /"content_type","text","parts",\[[^\]]*],"((?:\\.|[^"])*)"/g,
  ];

  const results: string[] = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const decoded = decodeJsonStringToken(match[1]).trim();
      if (!decoded) continue;
      if (decoded.length < 3) continue;
      results.push(decoded);
    }
    if (results.length > 0) {
      break;
    }
  }

  return results;
}

function normalizeShareUrl(rawUrl: string): URL {
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    throw new Error("分享链接格式不正确。");
  }

  if (target.protocol !== "https:") {
    throw new Error("仅支持 https 分享链接。");
  }

  return target;
}

function detectShareSource(url: URL): ShareSource {
  if (url.hostname === "chatgpt.com" && url.pathname.startsWith("/share/")) {
    return "chatgpt";
  }
  if (url.hostname === "gemini.google.com" && url.pathname.startsWith("/share/")) {
    return "gemini";
  }
  throw new Error("当前仅支持 ChatGPT 与 Gemini 的公开分享链接。");
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`抓取分享页失败(${response.status})。`);
  }
  return response.text();
}

async function importGeminiShare(url: URL): Promise<ImportedShareDocument> {
  try {
    const readerOutput = await fetchText(`https://r.jina.ai/http://${url.href}`);
    const markdown = parseReaderMarkdown(readerOutput);
    const parsed = cleanGeminiReaderMarkdown(markdown, url.href);
    if (parsed.text) {
      return {
        source: "gemini",
        title: parsed.title,
        text: parsed.text,
        url: url.href,
      };
    }
  } catch {
    // Gemini 公开分享页有时会触发代理抓取失败，继续使用 HTML 回退。
  }

  const html = await fetchText(url.href);
  const parsed = parseGeminiHtmlFallback(html, url.href);
  if (!parsed.text) {
    throw new Error("Gemini 分享页内容解析失败。");
  }

  return {
    source: "gemini",
    title: parsed.title,
    text: parsed.text,
    url: url.href,
  };
}

async function importChatGptShare(url: URL): Promise<ImportedShareDocument> {
  try {
    const readerOutput = await fetchText(`https://r.jina.ai/http://${url.href}`);
    const markdown = parseReaderMarkdown(readerOutput);
    const parsed = cleanChatGptReaderMarkdown(markdown, url.href, extractReaderTitle(readerOutput));
    if (parsed.text) {
      return {
        source: "chatgpt",
        title: parsed.title,
        text: parsed.text,
        url: url.href,
      };
    }
  } catch {
    // ChatGPT 分享页在 Worker 环境中直连经常被拒绝，优先尝试公开阅读代理，失败后再回退。
  }

  const html = await fetchText(url.href);
  const title = extractChatGptTitle(html);
  const parts = extractChatGptMessageParts(html);

  if (parts.length === 0) {
    throw new Error("ChatGPT 分享页内容解析失败。");
  }

  return {
    source: "chatgpt",
    title,
    text: normalizeImportText(title, parts),
    url: url.href,
  };
}

export async function importSharedConversation(rawUrl: string): Promise<ImportedShareDocument> {
  const url = normalizeShareUrl(rawUrl);
  const source = detectShareSource(url);

  if (source === "chatgpt") {
    return importChatGptShare(url);
  }

  return importGeminiShare(url);
}
