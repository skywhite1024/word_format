import { deepRepairText, protectLatexCommands } from "./text-repair";

export type ShareSource = "chatgpt" | "gemini";

export interface ImportedShareDocument {
  source: ShareSource;
  title: string;
  text: string;
  url: string;
}

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36";

const BROWSER_REQUEST_HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Chromium";v="118", "Not=A?Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

const READER_REQUEST_HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept: "text/plain,text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const CODETABS_PROXY_BASE = "https://api.codetabs.com/v1/proxy?quest=";
const GEMINI_RPC_ID = "ujx1Bf";

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

function normalizeImportedMathDelimiters(text: string): string {
  return text
    .replace(/\\\\(?=[()[\]A-Za-z])/g, "\\")
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) => `(${inner.trim()})`)
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, inner: string) => `[\n${inner.trim()}\n]`);
}

function expandLiteralLineBreaks(text: string): string {
  const { text: protectedText, restore } = protectLatexCommands(text);
  return restore(protectedText.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n"));
}

function normalizeImportText(title: string, sections: string[]): string {
  const uniqueSections: string[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const normalized = normalizeImportedMathDelimiters(section);
    const { text: protectedText, restore } = protectLatexCommands(normalized);
    const escapedWhitespaceNormalized = protectedText
      .replace(/(?:\\\\)+r(?:\\\\)+n/g, "\n")
      .replace(/(?:\\\\)+n/g, "\n")
      .replace(/(?:\\\\)+r/g, "\n")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n");
    const trimmed = restore(deepRepairText(escapedWhitespaceNormalized));
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueSections.push(trimmed);
  }

  const body = expandLiteralLineBreaks(uniqueSections.join("\n\n"));
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

function htmlToVisibleLines(html: string): string[] {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  )
    .replace(/\u200B/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isPlausibleChatGptPromptCandidate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4 || trimmed.length > 2_000) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^(system|assistant|developer|tool|GLOBAL)$/i.test(trimmed)) return false;
  return /[\u4e00-\u9fffA-Za-z]/.test(trimmed);
}

function extractChatGptPromptFromStream(html: string): string {
  const patterns = [
    /\\"((?:\\\\.|[^"\\]){4,2000})\\",\\"user\\",\{\}/g,
    /"((?:\\.|[^"\\]){4,2000})","user",\{\}/g,
  ];

  const candidates: string[] = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const decoded = normalizeChatGptExtractedText(decodeJsonStringToken(match[1]));
      if (!isPlausibleChatGptPromptCandidate(decoded)) continue;
      candidates.push(decoded);
    }
    if (candidates.length > 0) {
      break;
    }
  }

  return candidates.find((candidate) => /[\u4e00-\u9fff?.!？！]/.test(candidate)) ?? candidates[0] ?? "";
}

function extractChatGptPromptFromHtml(html: string): string {
  const promptFromStream = extractChatGptPromptFromStream(html);
  if (promptFromStream) {
    return promptFromStream;
  }

  const lines = htmlToVisibleLines(html);
  const promptIndex = lines.findIndex((line) => /^(你说[:：]?|You said:?)/i.test(line));
  if (promptIndex < 0) return "";

  const inlinePrompt = lines[promptIndex].replace(/^(你说[:：]?|You said:?)/i, "").trim();
  if (inlinePrompt) {
    return inlinePrompt;
  }

  const answerIndex = lines.findIndex((line, index) => index > promptIndex && /^(ChatGPT\s*说[:：]?|ChatGPT:?)/i.test(line));
  const promptLines = lines
    .slice(promptIndex + 1, answerIndex > promptIndex ? answerIndex : promptIndex + 4)
    .filter((line) => !/^Thought for \d+s$/i.test(line));

  return normalizeChatGptExtractedText(promptLines.join("\n"));
}

function stripChatGptSerializedTail(text: string): string {
  let output = expandLiteralLineBreaks(text).replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  let cutIndex = output.length;

  const markerStrings = [
    '","role","assistant"',
    '\\"role\\",\\"assistant\\"',
    '","traceId"',
    "traceId",
    "conversation-turn-",
    'GLOBAL","https://',
    'GLOBAL","http://',
  ];
  for (const marker of markerStrings) {
    const index = output.indexOf(marker);
    if (index >= 0) {
      cutIndex = Math.min(cutIndex, index);
    }
  }

  const markerPatterns = [/(?:^|[,\s])"_\d+":\d+/, /\bthoughts\b/i, /"_actions","_actions"/];
  for (const pattern of markerPatterns) {
    const index = output.search(pattern);
    if (index >= 0) {
      cutIndex = Math.min(cutIndex, index);
    }
  }

  if (cutIndex < output.length) {
    output = output.slice(0, cutIndex);
  }

  return output
    .split("\n")
    .filter((line) => !/^Thought for \d+s$/i.test(line.trim()))
    .join("\n")
    .replace(/[,\]}\s"]+$/g, "")
    .trim();
}

function isLikelyChatGptArtifactSoup(text: string): boolean {
  const compact = text.replace(/\s+/g, " ");
  const artifactSignals = [
    /"_\d+":\d+/.test(compact),
    /\btraceId\b/i.test(compact),
    /\bconversation-turn-[a-f0-9-]+\b/i.test(compact),
    /"role","assistant"/.test(compact),
    /\bGLOBAL","https?:\/\//.test(compact),
    /"_actions","_actions"/.test(compact),
  ].filter(Boolean).length;

  return artifactSignals >= 2;
}

function normalizeChatGptExtractedText(text: string): string {
  const normalized = stripChatGptSerializedTail(text);
  if (!normalized) return "";
  if (isLikelyChatGptArtifactSoup(normalized)) return "";
  return normalized;
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

function isLikelyInvalidShareBody(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length < 24) return true;
  if (/^Too many redirects\./i.test(trimmed)) return true;
  if (/^\s*\{\s*"code"\s*:\s*429\b/.test(trimmed)) return true;
  if (/Per IP rate limit exceeded/i.test(trimmed)) return true;

  const compact = trimmed.replace(/\s+/g, " ");
  if (/www\.google\.com\/sorry\/index/i.test(compact)) return true;
  if (/google_abuse=GOOGLE_ABUSE_EXEMPTION/i.test(compact)) return true;
  if (
    /(?:^|\s)(Sign in|Gemini|About Gemini|Subscriptions|For Business)(?:\s|$)/i.test(compact) &&
    !/[。！？.!?]/.test(compact)
  ) {
    return true;
  }

  return false;
}

function finalizeGeminiImportedText(title: string, text: string): { title: string; text: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { title, text: trimmed };
  }

  if (/^#\s+/m.test(trimmed) || /^##\s+(?:Gemini|你说)/m.test(trimmed)) {
    return { title, text: trimmed };
  }

  return {
    title,
    text: normalizeImportText(title, [`## Gemini\n${trimmed}`]),
  };
}

function cleanGeminiReaderMarkdown(
  markdown: string,
  shareUrl: string,
  fallbackTitle = "",
): { title: string; text: string } {
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
  const normalizedFallbackTitle = fallbackTitle
    .replace(/^‎?Gemini\s*-\s*/i, "")
    .replace(/^‎?Bard\s*-\s*/i, "")
    .trim();
  const title =
    titleLine.replace(/^#\s+/, "").replace(/\*\*/g, "").trim() ||
    (/^direct access to google ai$/i.test(normalizedFallbackTitle) ? "" : normalizedFallbackTitle);
  const bodyLines = workingLines
    .filter((line, index) => index === 0 || line !== titleLine)
    .map((line) => {
      if (/^You said$/i.test(line.trim())) {
        return "## 你说";
      }
      return line.replace(/\*\*/g, "");
    });
  const body = bodyLines.join("\n").trim();
  const sections =
    /^##\s+/m.test(body) || !body
      ? [body]
      : [`## Gemini\n${body}`];

  return {
    title,
    text: normalizeImportText(title, sections),
  };
}

function parseGeminiHtmlFallback(html: string, shareUrl: string): { title: string; text: string } {
  const lines = htmlToVisibleLines(html);
  const startIndex = lines.findIndex((line) => line === shareUrl || line.includes("/share/"));
  const bodyLines = (startIndex >= 0 ? lines.slice(startIndex + 1) : lines).filter((line) => {
    if (/^(登录|Sign in|Gemini|About Gemini|Subscriptions|For Business)$/i.test(line)) return false;
    return true;
  });
  const title = bodyLines[0] ?? "Gemini 分享内容";
  return {
    title,
    text: normalizeImportText(title, [bodyLines.join("\n")]),
  };
}

function extractChatGptTitle(html: string): string {
  const embeddedMatches = [
    html.match(/\\"pageTitle\\",\\"((?:\\\\.|[^"\\])*)\\"/),
    html.match(/"pageTitle","((?:\\.|[^"\\])*)"/),
  ];
  for (const match of embeddedMatches) {
    if (!match?.[1]) continue;
    const title = decodeJsonStringToken(match[1]).trim();
    if (title) {
      return title.replace(/^ChatGPT\s*-\s*/i, "").trim();
    }
  }

  const pageTitleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const pageTitle = pageTitleMatch?.[1]?.trim() ?? "";
  if (pageTitle && !/^ChatGPT$/i.test(pageTitle)) {
    return pageTitle.replace(/^ChatGPT\s*-\s*/i, "").trim();
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
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const decoded = normalizeChatGptExtractedText(decodeJsonStringToken(match[1]));
      if (!decoded) continue;
      if (decoded.length < 3) continue;
      if (seen.has(decoded)) continue;
      seen.add(decoded);
      results.push(decoded);
    }
    if (results.length > 0) {
      break;
    }
  }

  return results;
}

function extractGeminiBuildLabel(html: string): string {
  return html.match(/boq_assistant-bard-web-server_[^"'&\s<]+/)?.[0] ?? "";
}

async function fetchGeminiBuildLabel(baseOrigin = "https://gemini.google.com"): Promise<string> {
  const html = await fetchText(`${baseOrigin}/`, {}, { allowChallengeRetry: true });
  const buildLabel = extractGeminiBuildLabel(html);
  if (!buildLabel) {
    throw new Error("Gemini 构建标识抓取失败。");
  }
  return buildLabel;
}

function parseGeminiRpcLines(responseText: string): unknown[] {
  return responseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[["))
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    });
}

function walkUnknownTree(node: unknown, visit: (value: unknown) => boolean | void): boolean {
  if (visit(node) === true) {
    return true;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      if (walkUnknownTree(item, visit)) {
        return true;
      }
    }
    return false;
  }

  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      if (walkUnknownTree(value, visit)) {
        return true;
      }
    }
  }

  return false;
}

function findGeminiPrompt(node: unknown): string {
  let prompt = "";
  walkUnknownTree(node, (value) => {
    if (
      Array.isArray(value) &&
      Array.isArray(value[0]) &&
      value[0].length === 1 &&
      typeof value[0][0] === "string" &&
      value[0][0].trim() &&
      value[1] === 2
    ) {
      prompt = value[0][0].trim();
      return true;
    }
    return false;
  });
  return prompt;
}

function findGeminiShareTitle(node: unknown): string {
  let title = "";
  walkUnknownTree(node, (value) => {
    if (
      Array.isArray(value) &&
      value[0] === true &&
      typeof value[1] === "string" &&
      value[1].trim() &&
      !/^https?:\/\//i.test(value[1])
    ) {
      title = value[1].trim();
      return true;
    }
    return false;
  });
  return title;
}

function findGeminiMarkdownAnswer(node: unknown): string {
  let best = "";
  walkUnknownTree(node, (value) => {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.length <= best.length) return false;
    if (/^https?:\/\//i.test(trimmed)) return false;
    if (/^[cr]_[a-f0-9]{8,}$/i.test(trimmed)) return false;
    if (!/[\n$\\#*|]|^1\.\s/m.test(trimmed) && trimmed.length < 300) return false;
    best = trimmed;
    return false;
  });
  return best;
}

function parseGeminiRpcConversation(responseText: string): { title: string; prompt: string; answer: string } {
  let title = "";
  let prompt = "";
  let answer = "";

  for (const entry of parseGeminiRpcLines(responseText)) {
    if (!Array.isArray(entry) || entry[1] !== GEMINI_RPC_ID || typeof entry[2] !== "string") {
      continue;
    }

    try {
      const payload = JSON.parse(entry[2]) as unknown;
      title ||= findGeminiShareTitle(payload);
      prompt ||= findGeminiPrompt(payload);

      const candidate = findGeminiMarkdownAnswer(payload);
      if (candidate.length > answer.length) {
        answer = candidate;
      }
    } catch {
      continue;
    }
  }

  return { title, prompt, answer };
}

function createGeminiRpcBody(shareId: string): string {
  return `f.req=${encodeURIComponent(JSON.stringify([[[GEMINI_RPC_ID, JSON.stringify([null, shareId, [4]]), null, "generic"]]]))}&`;
}

async function fetchGeminiRpcMarkdown(
  url: URL,
  buildLabel: string,
  baseOrigin = "https://gemini.google.com",
): Promise<{ title: string; text: string } | null> {
  const shareId = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!shareId || !buildLabel) return null;

  const rpcUrl =
    `${baseOrigin}/_/BardChatUi/data/batchexecute?rpcids=${GEMINI_RPC_ID}` +
    `&source-path=${encodeURIComponent(url.pathname)}` +
    `&bl=${encodeURIComponent(buildLabel)}` +
    `&hl=zh-CN&_reqid=${Date.now() % 1000000}&rt=c`;
  const responseText = await fetchText(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Same-Domain": "1",
      Referer: `${baseOrigin}/`,
    },
    body: createGeminiRpcBody(shareId),
  }, { allowChallengeRetry: true });

  const parsed = parseGeminiRpcConversation(responseText);
  if (!parsed.answer) return null;

  const sections = parsed.prompt ? [`## 你说\n${parsed.prompt}`, `## Gemini\n${parsed.answer}`] : [`## Gemini\n${parsed.answer}`];
  return {
    title: parsed.title,
    text: normalizeImportText(parsed.title, sections),
  };
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
  if (
    (url.hostname === "gemini.google.com" || url.hostname === "bard.google.com") &&
    url.pathname.startsWith("/share/")
  ) {
    return "gemini";
  }
  throw new Error("当前仅支持 ChatGPT 与 Gemini 的公开分享链接。");
}

type FetchProfile = "browser" | "reader";

interface FetchTextOptions {
  allowChallengeRetry?: boolean;
  profile?: FetchProfile;
}

function resolveBaseHeaders(profile: FetchProfile): Record<string, string> {
  return profile === "reader" ? READER_REQUEST_HEADERS : BROWSER_REQUEST_HEADERS;
}

function mergeHeaders(
  baseHeaders: Record<string, string>,
  extraHeaders?: HeadersInit,
  cookieHeader?: string,
): Headers {
  const headers = new Headers(baseHeaders);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  return headers;
}

function splitCombinedSetCookieHeader(rawHeader: string): string[] {
  return rawHeader
    .split(/,(?=\s*[^;,\s]+=)/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSetCookieValues(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & {
    getAll?: (name: string) => string[];
    getSetCookie?: () => string[];
  };

  if (typeof extendedHeaders.getSetCookie === "function") {
    return extendedHeaders.getSetCookie().filter(Boolean);
  }
  if (typeof extendedHeaders.getAll === "function") {
    try {
      return extendedHeaders.getAll("set-cookie").filter(Boolean);
    } catch {
      // ignore unsupported getAll implementations
    }
  }

  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookieHeader(combined) : [];
}

function extractCookieHeader(headers: Headers): string {
  return getSetCookieValues(headers)
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function isCloudflareChallengeResponse(response: Response): boolean {
  return response.status === 403 && /challenge/i.test(response.headers.get("cf-mitigated") ?? "");
}

function buildCodeTabsProxyUrl(targetUrl: string): string {
  return `${CODETABS_PROXY_BASE}${encodeURIComponent(targetUrl)}`;
}

function buildBardShareUrl(url: URL): URL {
  const normalized = new URL(url.href);
  normalized.hostname = "bard.google.com";
  return normalized;
}

async function fetchText(
  url: string,
  init: RequestInit = {},
  options: FetchTextOptions = {},
): Promise<string> {
  const profile = options.profile ?? "browser";
  const baseHeaders = resolveBaseHeaders(profile);
  const requestInit: RequestInit = {
    ...init,
    headers: mergeHeaders(baseHeaders, init.headers),
  };

  let response = await fetch(url, requestInit);
  if (!response.ok && options.allowChallengeRetry && isCloudflareChallengeResponse(response)) {
    const cookieHeader = extractCookieHeader(response.headers);
    if (cookieHeader) {
      response = await fetch(url, {
        ...init,
        headers: mergeHeaders(baseHeaders, init.headers, cookieHeader),
      });
    }
  }

  if (!response.ok) {
    throw new Error(`抓取分享页失败(${response.status})。`);
  }
  return response.text();
}

async function fetchTextViaCodeTabs(url: string, init: RequestInit = {}): Promise<string> {
  return fetchText(buildCodeTabsProxyUrl(url), init);
}

async function fetchGeminiBuildLabelForShare(url: URL): Promise<string> {
  try {
    return await fetchGeminiBuildLabel("https://bard.google.com");
  } catch {
    const proxiedHtml = await fetchTextViaCodeTabs(url.href);
    const buildLabel = extractGeminiBuildLabel(proxiedHtml);
    if (!buildLabel) {
      throw new Error("Gemini 构建标识抓取失败。");
    }
    return buildLabel;
  }
}

function parseChatGptHtmlDocument(html: string): { title: string; text: string } | null {
  const title = extractChatGptTitle(html);
  const parts = extractChatGptMessageParts(html);
  const prompt = extractChatGptPromptFromHtml(html);

  if (parts.length === 0) {
    return null;
  }

  const sections = prompt
    ? [`## 你说\n${prompt}`, `## ChatGPT\n${parts[0]}`, ...parts.slice(1)]
    : [`## ChatGPT\n${parts[0]}`, ...parts.slice(1)];

  return {
    title,
    text: normalizeImportText(title, sections),
  };
}

async function importGeminiShare(url: URL): Promise<ImportedShareDocument> {
  const normalizedUrl = buildBardShareUrl(url);
  const failures: string[] = [];
  const pushFailure = (step: string, error?: unknown) => {
    const detail = error instanceof Error ? error.message : "";
    failures.push(detail ? `${step}:${detail}` : step);
  };

  try {
    const buildLabel = await fetchGeminiBuildLabelForShare(normalizedUrl);
    const rpcParsed = await fetchGeminiRpcMarkdown(normalizedUrl, buildLabel, "https://bard.google.com");
    if (rpcParsed?.text) {
      const finalized = finalizeGeminiImportedText(rpcParsed.title, rpcParsed.text);
      return {
        source: "gemini",
        title: finalized.title,
        text: finalized.text,
        url: url.href,
      };
    }
    failures.push("rpc-empty");
  } catch (error) {
    pushFailure("rpc-fetch", error);
    // Bard RPC 失败后退回阅读代理。
  }

  try {
    const readerOutput = await fetchText(`https://r.jina.ai/http://${normalizedUrl.href}`, {}, { profile: "reader" });
    const markdown = parseReaderMarkdown(readerOutput);
    const parsed = cleanGeminiReaderMarkdown(markdown, normalizedUrl.href, extractReaderTitle(readerOutput));
    if (parsed.text && !isLikelyInvalidShareBody(parsed.text)) {
      const finalized = finalizeGeminiImportedText(parsed.title, parsed.text);
      return {
        source: "gemini",
        title: finalized.title,
        text: finalized.text,
        url: url.href,
      };
    }
    failures.push("reader-invalid");
  } catch (error) {
    pushFailure("reader-fetch", error);
    // 阅读代理失败后再回退到直连 HTML。
  }

  try {
    const proxiedReaderOutput = await fetchTextViaCodeTabs(`https://r.jina.ai/http://${normalizedUrl.href}`);
    const markdown = parseReaderMarkdown(proxiedReaderOutput);
    const parsed = cleanGeminiReaderMarkdown(markdown, normalizedUrl.href, extractReaderTitle(proxiedReaderOutput));
    if (parsed.text && !isLikelyInvalidShareBody(parsed.text)) {
      const finalized = finalizeGeminiImportedText(parsed.title, parsed.text);
      return {
        source: "gemini",
        title: finalized.title,
        text: finalized.text,
        url: url.href,
      };
    }
    failures.push("codetabs-reader-invalid");
  } catch (error) {
    pushFailure("codetabs-reader-fetch", error);
    // codetabs -> jina fallback
  }

  try {
    const html = await fetchText(normalizedUrl.href, {}, { allowChallengeRetry: true });
    const parsed = parseGeminiHtmlFallback(html, normalizedUrl.href);
    if (parsed.text && !isLikelyInvalidShareBody(parsed.text)) {
      const finalized = finalizeGeminiImportedText(parsed.title, parsed.text);
      return {
        source: "gemini",
        title: finalized.title,
        text: finalized.text,
        url: url.href,
      };
    }
    failures.push("html-invalid");
  } catch (error) {
    pushFailure("html-fetch", error);
    // direct html fallback
  }

  throw new Error(`Gemini 分享内容抓取失败，请稍后重试或直接粘贴文本。(${failures.join(" | ")})`);
}

async function importChatGptShare(url: URL): Promise<ImportedShareDocument> {
  let readerFallback: ImportedShareDocument | null = null;
  const failures: string[] = [];
  const pushFailure = (step: string, error?: unknown) => {
    const detail = error instanceof Error ? error.message : "";
    failures.push(detail ? `${step}:${detail}` : step);
  };

  try {
    const html = await fetchText(url.href, {}, { allowChallengeRetry: true });
    const parsed = parseChatGptHtmlDocument(html);
    if (parsed) {
      return {
        source: "chatgpt",
        title: parsed.title,
        text: parsed.text,
        url: url.href,
      };
    }
    failures.push("html-invalid");
  } catch (error) {
    pushFailure("html-fetch", error);
    // ChatGPT 分享页直连在部分环境会被挑战页或证书代理影响，失败后继续回退。
  }

  try {
    const proxiedHtml = await fetchTextViaCodeTabs(url.href);
    const parsed = parseChatGptHtmlDocument(proxiedHtml);
    if (parsed) {
      return {
        source: "chatgpt",
        title: parsed.title,
        text: parsed.text,
        url: url.href,
      };
    }
    failures.push("codetabs-invalid");
  } catch (error) {
    pushFailure("codetabs-fetch", error);
    // codetabs fallback
  }

  try {
    const readerOutput = await fetchText(`https://r.jina.ai/http://${url.href}`, {}, { profile: "reader" });
    const markdown = parseReaderMarkdown(readerOutput);
    const parsed = cleanChatGptReaderMarkdown(markdown, url.href, extractReaderTitle(readerOutput));
    if (parsed.text && !isLikelyInvalidShareBody(parsed.text)) {
      readerFallback = {
        source: "chatgpt",
        title: parsed.title,
        text: parsed.text,
        url: url.href,
      };
    } else {
      failures.push("reader-invalid");
    }
  } catch (error) {
    pushFailure("reader-fetch", error);
    // reader fallback
  }

  if (readerFallback) {
    return readerFallback;
  }

  throw new Error(`ChatGPT 分享内容抓取失败，请稍后重试或直接粘贴文本。(${failures.join(" | ")})`);
}

export async function importSharedConversation(rawUrl: string): Promise<ImportedShareDocument> {
  const url = normalizeShareUrl(rawUrl);
  const source = detectShareSource(url);

  if (source === "chatgpt") {
    return importChatGptShare(url);
  }

  return importGeminiShare(url);
}
