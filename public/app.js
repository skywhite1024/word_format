const inputText = document.getElementById("inputText");
const modeSelect = document.getElementById("mode");
const formatBtn = document.getElementById("formatBtn");
const downloadBtn = document.getElementById("downloadBtn");
const stats = document.getElementById("stats");
const preview = document.getElementById("preview");

async function callFormatApi(path) {
  const payload = {
    text: inputText.value || "",
    mode: modeSelect.value || "auto",
  };
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response;
}

formatBtn.addEventListener("click", async () => {
  try {
    const response = await callFormatApi("/api/format");
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "格式化失败");
    }
    const data = await response.json();
    const { structured } = data;

    stats.textContent = [
      `模式: ${structured.mode}`,
      `标题: ${structured.title || "无"}`,
      `段落数: ${structured.stats.paragraphCount}`,
      `标题数: ${structured.stats.headingCount}`,
      `参考文献条目: ${structured.stats.referenceCount}`,
    ].join(" | ");

    preview.textContent = data.previewText || "";
  } catch (error) {
    preview.textContent = error instanceof Error ? error.message : "未知错误";
  }
});

downloadBtn.addEventListener("click", async () => {
  try {
    const response = await callFormatApi("/api/format/docx");
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "导出失败");
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
  } catch (error) {
    preview.textContent = error instanceof Error ? error.message : "未知错误";
  }
});
