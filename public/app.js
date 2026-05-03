const inputText = document.getElementById("inputText");
const shareLink = document.getElementById("shareLink");
const modeSelect = document.getElementById("mode");
const useLlmInput = document.getElementById("useLlm");
const mathItalicInput = document.getElementById("mathItalic");
const formatBtn = document.getElementById("formatBtn");
const repairBtn = document.getElementById("repairBtn");
const downloadBtn = document.getElementById("downloadBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const importShareBtn = document.getElementById("importShareBtn");
const clearBtn = document.getElementById("clearBtn");
const stats = document.getElementById("stats");
const statusText = document.getElementById("statusText");
const preview = document.getElementById("preview");
const previewMeta = document.getElementById("previewMeta");
const inputCounter = document.getElementById("inputCounter");
const imageFilesInput = document.getElementById("imageFiles");
const imagePreviewList = document.getElementById("imagePreviewList");
const useOriginalCaptionIndexInput = document.getElementById("useOriginalCaptionIndex");

const EMPTY_PREVIEW_HTML = `
  <div class="empty-state">
    <h3>暂无预览内容</h3>
    <p>输入正文或导入分享链接后，右侧会展示接近最终 Word 的结构化预览。</p>
  </div>
`;

let previewAbortController = null;
let previewTimer = null;
let lastStructured = null;
let lastMeta = null;
let lastImport = null;
let previewExpanded = false;
const DEFAULT_PREVIEW_BLOCK_LIMIT = 220;

const uploadedImages = new Map();
const isLocalMode = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";

function normalizeImageKey(name) {
  return name.replace(/\.[^.]+$/, "").trim().toLowerCase();
}

function extractFigureNumber(text) {
  const match = text.trim().match(/^图\s*(\d+(?:[-—－]\d+)?)/);
  return match ? match[1].replace(/[-—－]/g, "-") : null;
}

function findMatchingImage(figureText, images) {
  const num = extractFigureNumber(figureText);
  if (!num) return null;
  const candidates = [`图${num}`, num, `图 ${num}`, `图${num.replace(/-/g, "-")}`, num.replace(/-/g, "-")];
  for (const key of candidates) {
    const norm = key.trim().toLowerCase();
    if (images.has(norm)) return images.get(norm);
  }
  for (const [key, val] of images) {
    if (key.includes(num) || num.includes(key)) return val;
  }
  return null;
}

function getImageSrc(img) {
  if (isLocalMode && img.id) return `/api/image/${img.id}`;
  return `data:image/${img.type};base64,${img.base64}`;
}

function renderImagePreviewList() {
  if (uploadedImages.size === 0) {
    imagePreviewList.innerHTML = "";
    return;
  }
  const items = [];
  for (const [key, img] of uploadedImages) {
    items.push(`
      <div class="image-preview-item" data-key="${escapeHtml(key)}">
        <img src="${getImageSrc(img)}" alt="${escapeHtml(key)}" />
        <span class="image-preview-name">${escapeHtml(key)}</span>
        <button type="button" class="image-remove-btn" data-key="${escapeHtml(key)}">删除</button>
      </div>
    `);
  }
  imagePreviewList.innerHTML = items.join("");
}

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB (before compression)
const COMPRESS_MAX_WIDTH = 1500;
const COMPRESS_QUALITY = 0.8;
const COMPRESS_THRESHOLD_BYTES = 1024 * 1024; // 1MB

function compressImage(dataUrl, fileName) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const needsResize = width > COMPRESS_MAX_WIDTH;
      if (needsResize) {
        height = Math.round(height * (COMPRESS_MAX_WIDTH / width));
        width = COMPRESS_MAX_WIDTH;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const ext = fileName.split(".").pop().toLowerCase();
      const isPhoto = ext === "jpg" || ext === "jpeg" || dataUrl.startsWith("data:image/jpeg");
      const useJpeg = isPhoto || ext === "bmp";

      const outputType = useJpeg ? "image/jpeg" : "image/png";
      const quality = useJpeg ? COMPRESS_QUALITY : undefined;
      const outputUrl = canvas.toDataURL(outputType, quality);

      const base64 = outputUrl.replace(/^data:image\/[^;]+;base64,/, "");
      const outType = useJpeg ? "jpg" : "png";
      resolve({ base64, type: outType, width, height });
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = dataUrl;
  });
}

async function uploadImageLocal(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const typeMap = { jpg: "jpg", jpeg: "jpg", png: "png", gif: "gif", bmp: "bmp" };
  const type = typeMap[ext] || "png";
  const key = normalizeImageKey(file.name);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Image-Name": encodeURIComponent(file.name),
      "X-Image-Type": type,
    },
    body: file,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "上传失败");
  }

  const result = await response.json();
  uploadedImages.set(key, { id: result.id, name: result.name, type: result.type });
  return result;
}

function handleImageUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  if (isLocalMode) {
    let pendingCount = files.length;
    for (const file of files) {
      const key = normalizeImageKey(file.name);
      setStatus(`正在上传图片: ${file.name}...`);
      uploadImageLocal(file)
        .then((result) => {
          const sizeKB = (result.size / 1024).toFixed(0);
          setStatus(`已上传 ${file.name}（${sizeKB}KB，共 ${uploadedImages.size} 张）`);
        })
        .catch((err) => {
          setStatus(`图片 ${file.name} 上传失败: ${err.message}`);
        })
        .finally(() => {
          renderImagePreviewList();
          pendingCount -= 1;
          if (pendingCount === 0) paintPreview();
        });
    }
    event.target.value = "";
    return;
  }

  let pendingCount = files.length;

  for (const file of files) {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setStatus(`图片 ${file.name} 超过 20MB 限制，已跳过。`);
      pendingCount -= 1;
      if (pendingCount === 0) paintPreview();
      continue;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const key = normalizeImageKey(file.name);
      try {
        const base64Raw = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
        const ext = file.name.split(".").pop().toLowerCase();
        const typeMap = { jpg: "jpg", jpeg: "jpg", png: "png", gif: "gif", bmp: "bmp" };
        const type = typeMap[ext] || "png";
        const needsCompress = file.size > COMPRESS_THRESHOLD_BYTES && type !== "gif";

        if (needsCompress) {
          try {
            setStatus(`正在压缩图片: ${file.name}...`);
            const compressed = await compressImage(dataUrl, file.name);
            uploadedImages.set(key, { base64: compressed.base64, type: compressed.type });
            const savedMB = ((file.size - compressed.base64.length * 3 / 4) / 1024 / 1024).toFixed(1);
            setStatus(`已压缩 ${file.name}（节省 ${savedMB}MB，共 ${uploadedImages.size} 张）`);
          } catch {
            // Compression failed (e.g. invalid image), fall back to original
            uploadedImages.set(key, { base64: base64Raw, type });
            setStatus(`已上传图片: ${file.name}（压缩失败，使用原图，共 ${uploadedImages.size} 张）`);
          }
        } else {
          uploadedImages.set(key, { base64: base64Raw, type });
          setStatus(`已上传图片: ${file.name}（共 ${uploadedImages.size} 张）`);
        }
      } catch (err) {
        setStatus(`图片 ${file.name} 处理失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
      renderImagePreviewList();
      pendingCount -= 1;
      if (pendingCount === 0) paintPreview();
    };
    reader.readAsDataURL(file);
  }
  event.target.value = "";
}

function removeImage(key) {
  const img = uploadedImages.get(key);
  if (isLocalMode && img?.id) {
    fetch(`/api/image/${img.id}`, { method: "DELETE" }).catch(() => {});
  }
  uploadedImages.delete(key);
  renderImagePreviewList();
  setStatus(`已移除图片: ${key}`);
  paintPreview();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(message) {
  statusText.textContent = message;
}

function setStats(structured, meta) {
  if (!structured) {
    stats.innerHTML = [
      "模式: 未识别",
      "标题: 无",
      "段落数: 0",
      "标题数: 0",
      "参考文献: 0",
      "引擎: rule",
    ]
      .map((item) => `<span class="stat-pill">${escapeHtml(item)}</span>`)
      .join("");
    return;
  }

  const fallback = meta?.fallbackReason ? ` | 回退: ${meta.fallbackReason}` : "";
  const items = [
    `模式: ${structured.mode}`,
    `标题: ${structured.title || "无"}`,
    `段落数: ${structured.stats.paragraphCount}`,
    `标题数: ${structured.stats.headingCount}`,
    `参考文献: ${structured.stats.referenceCount}`,
    `引擎: ${meta?.engine || "rule"}${fallback}`,
  ];
  stats.innerHTML = items
    .map((item) => `<span class="stat-pill">${escapeHtml(item)}</span>`)
    .join("");
}

function setPreviewMeta(importInfo) {
  if (!importInfo) {
    previewMeta.innerHTML = "";
    return;
  }

  const chips = [
    `导入来源: ${importInfo.source}`,
    importInfo.title ? `分享标题: ${importInfo.title}` : "",
    importInfo.url ? `分享链接: ${importInfo.url}` : "",
  ].filter(Boolean);
  previewMeta.innerHTML = chips
    .map((item) => `<span class="preview-chip">${escapeHtml(item)}</span>`)
    .join("");
}

function updateCounter() {
  inputCounter.textContent = `${inputText.value.length} 字`;
}

function setButtonsDisabled(disabled) {
  [formatBtn, repairBtn, downloadBtn, exportPdfBtn, importShareBtn, clearBtn].forEach((button) => {
    button.disabled = disabled;
  });
}

async function postJson(path, payload, signal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let message = "请求失败";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Ignore JSON parse errors from unexpected responses.
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response;
}

function splitTableCells(rawRow) {
  let row = rawRow.trim();
  if (row.startsWith("|")) {
    row = row.slice(1);
  }
  if (row.endsWith("|") && row[row.length - 2] !== "\\") {
    row = row.slice(0, -1);
  }

  const cells = [];
  let cell = "";
  let inMath = false;

  for (let cursor = 0; cursor < row.length; cursor += 1) {
    const ch = row[cursor];
    const next = row[cursor + 1] || "";
    const escaped = cursor > 0 && row[cursor - 1] === "\\";

    if (ch === "\\" && next === "|") {
      cell += "|";
      cursor += 1;
      continue;
    }

    if (ch === "$" && !escaped) {
      inMath = !inMath;
      cell += ch;
      continue;
    }

    const hasClosingDollar = inMath && row.indexOf("$", cursor + 1) >= 0;
    if (ch === "|" && (!inMath || !hasClosingDollar)) {
      const value = cell.trim();
      if (value) {
        cells.push(value);
      }
      cell = "";
      continue;
    }

    cell += ch;
  }

  const tail = cell.trim();
  if (tail) {
    cells.push(tail);
  }

  return cells;
}

function countDollarSigns(text) {
  return (text.match(/(?<!\\)\$/g) || []).length;
}

function looksLikeMathTableFragment(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[\u4e00-\u9fff]{2,}/.test(trimmed)) return false;
  return /\\[A-Za-z]+|[_^=+\-*/]|[A-Za-z]\s*[-+]/.test(trimmed);
}

function normalizeTableCell(cell) {
  const trimmed = cell.trim();
  return countDollarSigns(trimmed) % 2 === 1 ? `${trimmed}$` : trimmed;
}

function normalizeTableRowWidth(cells, columnCount) {
  let row = [...cells];

  if (columnCount >= 3 && row.length >= 3 && countDollarSigns(row[1]) % 2 === 1 && looksLikeMathTableFragment(row[2])) {
    const mathTail = row[2].replace(/^\|/, "").replace(/\|$/, "").trim();
    row = [row[0], `${row[1].trim()} | ${mathTail} |$`, ...row.slice(3)];
  }

  if (row.length < columnCount) {
    row = [...row, ...Array.from({ length: columnCount - row.length }, () => "")];
  }
  if (row.length > columnCount) {
    row = [...row.slice(0, columnCount - 1), row.slice(columnCount - 1).join(" | ")];
  }

  return row.map(normalizeTableCell);
}

function isTableSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseInlineMarkdownTable(raw) {
  const normalized = raw.replace(/\|?\s*Export to Sheets\s*$/i, "").replace(/\|\|/g, "|\n|");
  const rows = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (rows.length < 2) {
    return null;
  }

  const parsedRows = rows.map(splitTableCells).filter((cells) => cells.length > 0);
  if (parsedRows.length < 2 || !isTableSeparatorRow(parsedRows[1])) {
    return null;
  }

  const contentRows = [parsedRows[0], ...parsedRows.slice(2)];
  const columnCount = contentRows[0].length;
  return contentRows.map((cells) => normalizeTableRowWidth(cells, columnCount));
}

function extractEquationText(raw) {
  const text = raw.trim();
  const blockMatch = text.match(/^\$\$([\s\S]+)\$\$$/);
  if (blockMatch) {
    return blockMatch[1].trim();
  }

  const normalizeEquationBlockText = (block) =>
    block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        if (/^=+$/.test(line)) {
          return ["="];
        }
        return [line.replace(/^#+\s*/, "")];
      })
      .filter((part, index, all) => part !== "=" || (index > 0 && index < all.length - 1))
      .join(" ")
      .trim();

  const latexBlock = text.match(/^\\\[([\s\S]+)\\\]$/);
  if (latexBlock) {
    return normalizeEquationBlockText(latexBlock[1]);
  }

  const bracketBlock = text.match(/^\[([\s\S]+)\]$/);
  if (bracketBlock) {
    return normalizeEquationBlockText(bracketBlock[1]);
  }

  const inlineMatch = text.match(/^\$([^\n]+)\$$/);
  if (inlineMatch) {
    return inlineMatch[1].trim();
  }

  return text.replace(/\s+\(\d+\)\s*$/, "").replace(/\s+/g, " ").trim();
}

function normalizeCaptionTitle(raw) {
  return raw.replace(/[。.;；：:]+$/, "").trim();
}

function parseTableCaption(raw) {
  const match = raw.trim().match(/^表\s*(\d+(?:[-—－]\d+)?)?\s*(.+)$/);
  if (!match) return null;
  return { title: normalizeCaptionTitle(match[2]), index: match[1] || "" };
}

function parseFigureCaption(raw) {
  const match = raw.trim().match(/^图\s*(\d+(?:[-—－]\d+)?)?\s*(.+)$/);
  if (!match) return null;
  return { title: normalizeCaptionTitle(match[2]), index: match[1] || "" };
}

function isEquationNumberOnlyLine(text) {
  return /^\(\d+\)$/.test(text.trim());
}

function isStandaloneInlineMathLine(text) {
  return /^\$[^$\n]+\$$/.test(text.trim());
}

function hasListItemProseOutsideMath(text) {
  return /[A-Za-z\u4e00-\u9fff]{2,}/.test(
    text
      .replace(/^\s*(?:\d+[.)]|[（(]\d+[）)]|[-*•])\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/\$[^$\n]+\$/g, "")
      .replace(/[（(][^()（）\n]*[_^\\][^()（）\n]*[）)]/g, "")
      .trim(),
  );
}

function isLikelyEquation(text) {
  const trimmed = text.trim();
  const isDisplayMath = /^\$\$[\s\S]+\$\$$/.test(trimmed);
  const isBracketBlock = /^\[[\s\S]+]$/.test(trimmed) || /^\\\[[\s\S]+\\\]$/.test(trimmed);
  if (isDisplayMath || isBracketBlock) {
    return true;
  }
  if (isStandaloneInlineMathLine(trimmed)) {
    return true;
  }

  const hasMathKeyword = /\\frac|\\sum|\\int|\\sqrt|\\mathbb|\\mathcal|\\hat|\\tilde|\\left|\\right|\\begin|\\end|∑|∫|√|∞|⊙/.test(trimmed);
  const hasMathCommand = /\\[A-Za-z]+/.test(trimmed);
  const hasEquationOperator = /[=<>≤≥]/.test(trimmed);
  const hasScriptContext = /[_^]/.test(trimmed);
  const hasMathContext = /[A-Za-zα-ωΑ-Ω0-9]/.test(trimmed) && /[+\-*/^=<>≤≥×÷_|[\]()]/.test(trimmed);
  const hasChineseProse = /[\u4e00-\u9fff]{2,}/.test(trimmed);
  const hasListLikePrefix = /^\s*(?:\d+[.)]|[（(]\d+[）)]|[-*•])\s+/.test(trimmed);

  if (hasListLikePrefix && (hasChineseProse || hasListItemProseOutsideMath(trimmed)) && !hasEquationOperator) {
    return false;
  }

  if (hasChineseProse) {
    return hasMathKeyword || (hasEquationOperator && hasMathContext);
  }

  return hasMathKeyword || hasMathCommand || hasScriptContext || (hasEquationOperator && hasMathContext);
}

const PREVIEW_COMMAND_TEXT = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  eta: "η",
  lambda: "λ",
  mu: "μ",
  Omega: "Ω",
  omega: "ω",
  phi: "φ",
  pi: "π",
  sigma: "σ",
  theta: "θ",
  xi: "ξ",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  cdot: "·",
  times: "×",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  neq: "≠",
  mid: "|",
  rightarrow: "→",
  Rightarrow: "⇒",
  to: "→",
  sum: "∑",
  int: "∫",
};

const PREVIEW_IGNORED_COMMANDS = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "quad", "qquad"]);
const equationPreviewCache = new Map();

function readPreviewGroup(text, start, open = "{", close = "}") {
  if (text[start] !== open) return null;
  let depth = 0;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const ch = text[cursor];
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          value: text.slice(start + 1, cursor),
          end: cursor + 1,
        };
      }
    }
  }
  return { value: text.slice(start + 1), end: text.length };
}

function readPreviewScriptValue(text, start) {
  let cursor = start;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

  const grouped = readPreviewGroup(text, cursor);
  if (grouped) return grouped;

  if (text[cursor] === "\\") {
    const command = text.slice(cursor + 1).match(/^[A-Za-z]+/);
    if (command) {
      return { value: text.slice(cursor, cursor + 1 + command[0].length), end: cursor + 1 + command[0].length };
    }
  }

  let value = "";
  while (
    cursor < text.length &&
    !/[\s+\-*/=<>≤≥×÷_|()[\]{},;]/.test(text[cursor]) &&
    text[cursor] !== "^"
  ) {
    value += text[cursor];
    cursor += 1;
  }
  return { value: value || text[start] || "", end: cursor > start ? cursor : start + 1 };
}

function normalizeEquationPreviewSource(text) {
  return text
    .replace(/\\\\(?=[()[\]A-Za-z|])/g, "\\")
    .replace(/\\lVert|\\rVert|\\Vert/g, "||")
    .replace(/\\\|/g, "||")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\s+/g, " ")
    .trim();
}

function renderEquationExpression(rawText) {
  const text = normalizeEquationPreviewSource(rawText);
  let output = "";
  let cursor = 0;

  while (cursor < text.length) {
    const ch = text[cursor];

    if (ch === "_" || ch === "^") {
      const script = readPreviewScriptValue(text, cursor + 1);
      const tag = ch === "_" ? "sub" : "sup";
      output += `<${tag}>${renderEquationExpression(script.value)}</${tag}>`;
      cursor = script.end;
      continue;
    }

    if (ch === "\\") {
      const next = text[cursor + 1] || "";
      if (!/[A-Za-z]/.test(next)) {
        output += /[,;:]/.test(next) ? " " : next === "!" ? "" : escapeHtml(next);
        cursor += 2;
        continue;
      }

      const commandMatch = text.slice(cursor + 1).match(/^[A-Za-z]+/);
      const command = commandMatch?.[0] || "";
      const commandEnd = cursor + 1 + command.length;

      if (command === "frac") {
        const numerator = readPreviewGroup(text, commandEnd);
        const denominator = numerator ? readPreviewGroup(text, numerator.end) : null;
        if (numerator && denominator) {
          output += `<span class="math-frac"><span>${renderEquationExpression(numerator.value)}</span><span>${renderEquationExpression(
            denominator.value,
          )}</span></span>`;
          cursor = denominator.end;
          continue;
        }
      }

      if (command === "sqrt") {
        const body = readPreviewGroup(text, commandEnd);
        if (body) {
          output += `<span class="math-radical">√<span>${renderEquationExpression(body.value)}</span></span>`;
          cursor = body.end;
          continue;
        }
      }

      if (command === "hat" || command === "bar" || command === "tilde") {
        const body = readPreviewGroup(text, commandEnd);
        if (body) {
          const accent = command === "hat" ? "̂" : command === "bar" ? "̄" : "̃";
          output += `${renderEquationExpression(body.value)}${accent}`;
          cursor = body.end;
          continue;
        }
      }

      if (["text", "mathrm", "mathbf", "mathbb", "mathcal", "operatorname"].includes(command)) {
        const body = readPreviewGroup(text, commandEnd);
        if (body) {
          output += renderEquationExpression(body.value);
          cursor = body.end;
          continue;
        }
      }

      if (PREVIEW_IGNORED_COMMANDS.has(command)) {
        cursor = commandEnd;
        continue;
      }

      if (command === "min" || command === "max" || command === "argmin" || command === "argmax") {
        output += escapeHtml(command);
        cursor = commandEnd;
        continue;
      }

      output += escapeHtml(PREVIEW_COMMAND_TEXT[command] || command);
      cursor = commandEnd;
      continue;
    }

    output += escapeHtml(ch);
    cursor += 1;
  }

  return output;
}

function formatEquationContent(text) {
  const key = text.replace(/\s+/g, " ").trim();
  const cached = equationPreviewCache.get(key);
  if (cached) {
    return cached;
  }
  if (equationPreviewCache.size > 500) {
    equationPreviewCache.clear();
  }
  const html = `<span class="equation-formula">${renderEquationExpression(text)}</span>`;
  equationPreviewCache.set(key, html);
  return html;
}

function formatPlainInlinePreviewText(text) {
  return escapeHtml(text)
    .replace(/\\(?:mathbb|mathcal)\{([^{}]+)\}/g, "$1")
    .replace(/\\([A-Za-z]+)/g, (_match, command) => PREVIEW_COMMAND_TEXT[command] || command)
    .replace(/`([^`\n]+)`/g, '<span class="inline-code">$1</span>')
    .replace(/\[(\d+)\]/g, '<span class="citation">[$1]</span>');
}

function formatInlineContent(text) {
  const regex = /\$([^$\n]+)\$/g;
  let output = "";
  let cursor = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index || 0;
    output += formatPlainInlinePreviewText(text.slice(cursor, start));
    output += `<span class="inline-math">${renderEquationExpression(match[1])}</span>`;
    cursor = start + match[0].length;
  }

  output += formatPlainInlinePreviewText(text.slice(cursor));
  return output;
}

function buildTableHtml(rows) {
  if (!rows || rows.length === 0) {
    return "";
  }

  const [header, ...body] = rows;
  const thead = `<thead><tr>${header
    .map((cell) => `<th>${formatInlineContent(cell)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${formatInlineContent(cell)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function renderStructuredPreview(structured, options = {}) {
  if (!structured || !Array.isArray(structured.blocks) || structured.blocks.length === 0) {
    return EMPTY_PREVIEW_HTML;
  }

  const pieces = [];
  const equationIndexByKey = new Map();
  let equationCounter = 0;
  let tableIndex = 0;
  let figureIndex = 0;

  if (structured.title) {
    pieces.push(`<h1>${formatInlineContent(structured.title)}</h1>`);
  }

  const expanded = options.expanded === true;
  const shouldLimit = !expanded && structured.blocks.length > DEFAULT_PREVIEW_BLOCK_LIMIT;
  const visibleBlocks = shouldLimit
    ? structured.blocks.slice(0, DEFAULT_PREVIEW_BLOCK_LIMIT)
    : structured.blocks;

  for (const block of visibleBlocks) {
    const text = (block.text || "").trim();
    if (!text) continue;

    if (block.type === "heading") {
      const level = Math.min(3, Math.max(1, Number(block.level || 1)));
      const tag = level === 1 ? "h2" : level === 2 ? "h3" : "h3";
      pieces.push(`<${tag}>${formatInlineContent(text)}</${tag}>`);
      continue;
    }

    if (block.type === "reference") {
      pieces.push(`<p class="preview-reference">${formatInlineContent(text)}</p>`);
      continue;
    }

    const tableCaption = parseTableCaption(text);
    if (tableCaption) {
      tableIndex += 1;
      const tableLabel = useOriginalCaptionIndexInput.checked && tableCaption.index ? tableCaption.index : tableIndex;
      pieces.push(`<p class="caption paragraph-no-indent">表${tableLabel} ${formatInlineContent(tableCaption.title)}</p>`);
      continue;
    }

    const figureCaption = parseFigureCaption(text);
    if (figureCaption) {
      figureIndex += 1;
      const figureLabel = useOriginalCaptionIndexInput.checked && figureCaption.index ? figureCaption.index : figureIndex;
      const matched = findMatchingImage(text, uploadedImages);
      if (matched) {
        pieces.push(`<div class="figure-image"><img src="${getImageSrc(matched)}" alt="图${figureLabel}" /></div>`);
      }
      pieces.push(`<p class="caption paragraph-no-indent">图${figureLabel} ${formatInlineContent(figureCaption.title)}</p>`);
      continue;
    }

    if (isEquationNumberOnlyLine(text)) {
      continue;
    }

    const tableRows = parseInlineMarkdownTable(text);
    if (tableRows) {
      pieces.push(buildTableHtml(tableRows));
      continue;
    }

    if (isLikelyEquation(text)) {
      const equationText = extractEquationText(text);
      const key = equationText.replace(/\s+/g, " ").trim();
      if (!equationIndexByKey.has(key)) {
        equationCounter += 1;
        equationIndexByKey.set(key, equationCounter);
      }
      const equationNo = equationIndexByKey.get(key);
      pieces.push(`
        <div class="equation-block">
          <div class="equation-text">${formatEquationContent(equationText)}</div>
          <div class="equation-no">(${equationNo})</div>
        </div>
      `);
      continue;
    }

    pieces.push(`<p>${formatInlineContent(text)}</p>`);
  }

  if (shouldLimit) {
    const hiddenCount = structured.blocks.length - visibleBlocks.length;
    pieces.push(`
      <div class="preview-limit-notice paragraph-no-indent">
        为保持页面滚动流畅，当前仅显示前 ${visibleBlocks.length} 个结构块，已隐藏 ${hiddenCount} 个结构块；Word/PDF 导出仍包含全文。
        <button type="button" class="inline-preview-action" data-action="expand-preview">显示完整预览</button>
      </div>
    `);
  }

  return pieces.join("");
}

function getImageTotalSizeMB() {
  if (uploadedImages.size === 0) return 0;
  if (isLocalMode) return 0; // images stored on disk, not in memory
  let totalBase64Len = 0;
  for (const [, img] of uploadedImages) {
    totalBase64Len += img.base64?.length || 0;
  }
  return (totalBase64Len * 3 / 4) / (1024 * 1024);
}

function buildImageSizeWarning() {
  if (isLocalMode) return "";
  const sizeMB = getImageTotalSizeMB();
  if (sizeMB <= 8) return "";
  const level = sizeMB > 20 ? "error" : "warn";
  const icon = level === "error" ? "!!" : "!";
  const msg = level === "error"
    ? `图片数据总量约 ${sizeMB.toFixed(1)}MB，过大可能导致导出超时或失败。建议减少图片数量。`
    : `图片数据总量约 ${sizeMB.toFixed(1)}MB，导出可能较慢，请耐心等待。`;
  return `<div class="image-size-warning image-size-warning--${level}">${icon} ${escapeHtml(msg)}</div>`;
}

function paintPreview() {
  if (!lastStructured) {
    preview.innerHTML = EMPTY_PREVIEW_HTML;
    return;
  }
  const warning = buildImageSizeWarning();
  preview.innerHTML = warning + renderStructuredPreview(lastStructured, { expanded: previewExpanded });
}

function renderPreview(structured, meta) {
  lastStructured = structured;
  lastMeta = meta;
  previewExpanded = false;
  setStats(structured, meta);
  paintPreview();
}

function createEmptyPreview() {
  lastStructured = null;
  lastMeta = null;
  previewExpanded = false;
  setStats(null, null);
  previewMeta.innerHTML = "";
  preview.innerHTML = EMPTY_PREVIEW_HTML;
}

async function refreshPreview(options = {}) {
  const text = inputText.value.trim();
  updateCounter();

  if (!text) {
    setStatus("等待输入内容...");
    createEmptyPreview();
    return;
  }

  if (previewAbortController) {
    previewAbortController.abort();
  }

  previewAbortController = new AbortController();
  const signal = previewAbortController.signal;

  if (!options.silent) {
    setStatus("正在分析结构并刷新预览...");
  }

  try {
    const data = await postJson(
      "/api/format",
      {
        text,
        mode: modeSelect.value || "auto",
        useLlm: !!useLlmInput.checked,
        mathItalic: !!mathItalicInput.checked,
      },
      signal,
    );
    renderPreview(data.structured, data.meta);
    setPreviewMeta(lastImport);
    setStatus("预览已更新，可直接导出 Word 或打印为 PDF。");
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    preview.innerHTML = `<div class="empty-state"><h3>预览失败</h3><p>${escapeHtml(
      error instanceof Error ? error.message : "未知错误",
    )}</p></div>`;
    setStatus("预览更新失败。");
  }
}

function schedulePreviewRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    refreshPreview({ silent: true });
  }, 520);
}

async function importShare() {
  const url = shareLink.value.trim();
  if (!url) {
    setStatus("请先粘贴公开分享链接。");
    shareLink.focus();
    return;
  }

  setButtonsDisabled(true);
  setStatus("正在导入公开分享页内容...");
  try {
    const data = await postJson("/api/import/share", { url });
    inputText.value = data.text || "";
    lastImport = data;
    updateCounter();
    setPreviewMeta(lastImport);
    setStatus(`已导入 ${data.source} 分享内容，正在刷新预览...`);
    await refreshPreview();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "分享链接导入失败。");
  } finally {
    setButtonsDisabled(false);
  }
}

async function repairText() {
  const text = inputText.value;
  if (!text.trim()) {
    setStatus("当前没有可修复的内容。");
    return;
  }

  setButtonsDisabled(true);
  setStatus("正在执行深度乱码修复...");
  try {
    const data = await postJson("/api/repair", { text });
    inputText.value = data.text || text;
    updateCounter();
    setStatus(data.changed ? "已完成深度修复。" : "未发现需要修复的明显问题。");
    await refreshPreview();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "深度修复失败。");
  } finally {
    setButtonsDisabled(false);
  }
}

async function downloadDocx() {
  const text = inputText.value.trim();
  if (!text) {
    setStatus("请先输入内容后再导出 Word。");
    return;
  }

  // In remote mode, warn user if image data is very large
  if (!isLocalMode) {
    const sizeMB = getImageTotalSizeMB();
    if (sizeMB > 20) {
      const proceed = confirm(`图片数据总量约 ${sizeMB.toFixed(1)}MB，过大可能导致导出超时或失败。\n是否仍要尝试导出？`);
      if (!proceed) {
        setStatus("已取消导出。");
        return;
      }
    }
  }

  setButtonsDisabled(true);
  setStatus("正在生成 Word 文档...");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), isLocalMode ? 300000 : 120000);

    // In local mode, send imageIds (server loads from disk); in remote mode, send base64 images
    const imagePayload = isLocalMode
      ? { imageIds: Array.from(uploadedImages.values()).filter(img => img.id).map(img => img.id) }
      : { images: uploadedImages.size > 0 ? Object.fromEntries(uploadedImages) : undefined };

    const response = await fetch("/api/format/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        mode: modeSelect.value || "auto",
        useLlm: !!useLlmInput.checked,
        mathItalic: !!mathItalicInput.checked,
        useOriginalCaptionIndex: !!useOriginalCaptionIndexInput.checked,
        structured: lastStructured,
        ...imagePayload,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errMsg = "导出 Word 失败";
      try {
        const data = await response.json();
        errMsg = data.error || errMsg;
      } catch { /* ignore */ }
      throw new Error(errMsg);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get("Content-Disposition") || "";
    const match = contentDisposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "formatted.docx";

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);

    const engine = response.headers.get("X-Format-Engine") || "rule";
    setStatus(`Word 已导出，使用引擎: ${engine}。`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setStatus("生成 Word 超时，请减少图片数量或使用更小的图片后重试。");
    } else {
      setStatus(error instanceof Error ? error.message : "导出 Word 失败。");
    }
  } finally {
    setButtonsDisabled(false);
  }
}

function exportPdf() {
  if (!lastStructured) {
    setStatus("请先生成预览后再导出 PDF。");
    return;
  }

  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1080,height=900");
  if (!printWindow) {
    setStatus("浏览器阻止了打印窗口，请允许弹窗后重试。");
    return;
  }

  const previewHtml = lastStructured
    ? renderStructuredPreview(lastStructured, { expanded: true })
    : preview.innerHTML;

  printWindow.document.write(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>预览导出 PDF</title>
        <style>
          body {
            margin: 0;
            padding: 28px;
            color: #162033;
            background: #f4f7fb;
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
          }
          article {
            max-width: 860px;
            margin: 0 auto;
            padding: 28px 34px;
            background: #fff;
            box-shadow: 0 18px 40px rgba(28, 49, 87, 0.12);
          }
          h1, h2, h3 {
            font-family: "Noto Serif SC", "Songti SC", serif;
          }
          h1 {
            text-align: center;
            font-size: 30px;
          }
          h2 { font-size: 22px; margin-top: 20px; }
          h3 { font-size: 18px; margin-top: 16px; }
          p {
            line-height: 1.88;
            font-size: 15px;
            text-indent: 2em;
          }
          .paragraph-no-indent,
          .preview-reference,
          .caption,
          .equation-text {
            text-indent: 0;
          }
          .preview-reference {
            padding-left: 2em;
            text-indent: -1.4em;
          }
          .caption {
            text-align: center;
            font-weight: 600;
          }
          .equation-block {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 12px;
            align-items: center;
            padding: 12px 0;
          }
          .equation-text {
            text-align: center;
            font-family: "Cambria Math", "Times New Roman", serif;
          }
          .equation-formula {
            display: inline-block;
            white-space: normal;
            word-break: keep-all;
          }
          .equation-formula sub,
          .equation-formula sup {
            font-size: 0.68em;
            line-height: 0;
          }
          .math-frac {
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin: 0 0.16em;
            vertical-align: middle;
            line-height: 1.08;
          }
          .math-frac > span:first-child {
            min-width: 1.1em;
            padding: 0 0.18em 0.12em;
            border-bottom: 1px solid currentColor;
          }
          .math-frac > span:last-child {
            padding: 0.12em 0.18em 0;
          }
          .math-radical {
            display: inline-flex;
            align-items: baseline;
            gap: 0.06em;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
          }
          th, td {
            padding: 8px 10px;
            border-bottom: 1px solid rgba(22, 32, 51, 0.12);
            text-align: center;
          }
          th {
            border-top: 2px solid #243753;
            border-bottom: 1px solid rgba(22, 32, 51, 0.35);
          }
          tr:last-child td {
            border-bottom: 2px solid #243753;
          }
          .inline-math, .inline-code {
            font-family: "Cambria Math", "JetBrains Mono", monospace;
            background: rgba(31, 94, 255, 0.08);
            padding: 0.05em 0.35em;
            border-radius: 6px;
          }
          .citation {
            vertical-align: super;
            font-size: 0.8em;
          }
          @media print {
            body {
              background: #fff;
              padding: 0;
            }
            article {
              box-shadow: none;
              max-width: none;
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <article>${previewHtml}</article>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function clearContent() {
  inputText.value = "";
  shareLink.value = "";
  lastImport = null;
  if (isLocalMode) {
    for (const [, img] of uploadedImages) {
      if (img.id) fetch(`/api/image/${img.id}`, { method: "DELETE" }).catch(() => {});
    }
  }
  uploadedImages.clear();
  renderImagePreviewList();
  updateCounter();
  setPreviewMeta(null);
  createEmptyPreview();
  setStatus("内容已清空。");
}

formatBtn.addEventListener("click", () => {
  refreshPreview();
});

importShareBtn.addEventListener("click", () => {
  importShare();
});

repairBtn.addEventListener("click", () => {
  repairText();
});

downloadBtn.addEventListener("click", () => {
  downloadDocx();
});

exportPdfBtn.addEventListener("click", () => {
  exportPdf();
});

clearBtn.addEventListener("click", () => {
  clearContent();
});

preview.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("[data-action='expand-preview']")) {
    return;
  }
  previewExpanded = true;
  paintPreview();
});

inputText.addEventListener("input", () => {
  updateCounter();
  schedulePreviewRefresh();
});

[modeSelect, useLlmInput, mathItalicInput, useOriginalCaptionIndexInput].forEach((element) => {
  element.addEventListener("change", () => {
    if (inputText.value.trim()) {
      refreshPreview({ silent: true });
    }
  });
});

imageFilesInput.addEventListener("change", handleImageUpload);

imagePreviewList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const btn = target?.closest(".image-remove-btn");
  if (btn) {
    removeImage(btn.dataset.key);
  }
});

updateCounter();
setStats(null, null);
preview.innerHTML = EMPTY_PREVIEW_HTML;
