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
  return rawRow
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTableSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseInlineMarkdownTable(raw) {
  const normalized = raw.replace(/\|\|/g, "|\n|");
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

  return [parsedRows[0], ...parsedRows.slice(2)];
}

function extractEquationText(raw) {
  const text = raw.trim();
  const blockMatch = text.match(/^\$\$([\s\S]+)\$\$$/);
  if (blockMatch) {
    return blockMatch[1].trim();
  }

  const latexBlock = text.match(/^\\\[([\s\S]+)\\\]$/);
  if (latexBlock) {
    return latexBlock[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^=+$/.test(line))
      .map((line) => line.replace(/^#+\s*/, ""))
      .join(" ")
      .trim();
  }

  const bracketBlock = text.match(/^\[([\s\S]+)\]$/);
  if (bracketBlock) {
    return bracketBlock[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^=+$/.test(line))
      .map((line) => line.replace(/^#+\s*/, ""))
      .join(" ")
      .trim();
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
  const match = raw.trim().match(/^表\s*\d+(?:[-—－]\d+)?\s*(.+)$/);
  return match ? { title: normalizeCaptionTitle(match[1]) } : null;
}

function parseFigureCaption(raw) {
  const match = raw.trim().match(/^图\s*\d+(?:[-—－]\d+)?\s*(.+)$/);
  return match ? { title: normalizeCaptionTitle(match[1]) } : null;
}

function isEquationNumberOnlyLine(text) {
  return /^\(\d+\)$/.test(text.trim());
}

function isStandaloneInlineMathLine(text) {
  return /^\$[^$\n]+\$$/.test(text.trim());
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

  if (hasListLikePrefix && hasChineseProse) {
    return false;
  }

  if (hasChineseProse) {
    return hasMathKeyword || (hasEquationOperator && hasMathContext);
  }

  return hasMathKeyword || hasMathCommand || hasScriptContext || (hasEquationOperator && hasMathContext);
}

function formatInlineContent(text) {
  return escapeHtml(text)
    .replace(/\\theta/g, "θ")
    .replace(/\\phi/g, "φ")
    .replace(/\\pi/g, "π")
    .replace(/\\mu/g, "μ")
    .replace(/\\sigma/g, "σ")
    .replace(/\\eta/g, "η")
    .replace(/\\epsilon/g, "ε")
    .replace(/\\lambda/g, "λ")
    .replace(/\\infty/g, "∞")
    .replace(/\\mid/g, "|")
    .replace(/\\mathbb\{([^{}]+)\}/g, "$1")
    .replace(/\\mathcal\{([^{}]+)\}/g, "$1")
    .replace(/`([^`\n]+)`/g, '<span class="inline-code">$1</span>')
    .replace(/\$([^$\n]+)\$/g, '<span class="inline-math">$1</span>')
    .replace(/\[(\d+)\]/g, '<span class="citation">[$1]</span>');
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

function renderStructuredPreview(structured) {
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

  for (const block of structured.blocks) {
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
      pieces.push(`<p class="caption paragraph-no-indent">表${tableIndex} ${formatInlineContent(tableCaption.title)}</p>`);
      continue;
    }

    const figureCaption = parseFigureCaption(text);
    if (figureCaption) {
      figureIndex += 1;
      pieces.push(`<p class="caption paragraph-no-indent">图${figureIndex} ${formatInlineContent(figureCaption.title)}</p>`);
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
          <div class="equation-text">${formatInlineContent(equationText)}</div>
          <div class="equation-no">(${equationNo})</div>
        </div>
      `);
      continue;
    }

    pieces.push(`<p>${formatInlineContent(text)}</p>`);
  }

  return pieces.join("");
}

function renderPreview(structured, meta) {
  lastStructured = structured;
  lastMeta = meta;
  setStats(structured, meta);
  preview.innerHTML = renderStructuredPreview(structured);
}

function createEmptyPreview() {
  lastStructured = null;
  lastMeta = null;
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

  setButtonsDisabled(true);
  setStatus("正在生成 Word 文档...");
  try {
    const response = await fetch("/api/format/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        mode: modeSelect.value || "auto",
        useLlm: !!useLlmInput.checked,
        mathItalic: !!mathItalicInput.checked,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "导出 Word 失败");
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
    setStatus(error instanceof Error ? error.message : "导出 Word 失败。");
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
        <article>${preview.innerHTML}</article>
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

inputText.addEventListener("input", () => {
  updateCounter();
  schedulePreviewRefresh();
});

[modeSelect, useLlmInput, mathItalicInput].forEach((element) => {
  element.addEventListener("change", () => {
    if (inputText.value.trim()) {
      refreshPreview({ silent: true });
    }
  });
});

updateCounter();
setStats(null, null);
preview.innerHTML = EMPTY_PREVIEW_HTML;
