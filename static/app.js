const inputText = document.getElementById("inputText");
const formatBtn = document.getElementById("formatBtn");
const downloadBtn = document.getElementById("downloadBtn");
const preview = document.getElementById("preview");
const stats = document.getElementById("stats");

async function formatContent() {
  const text = inputText.value || "";
  const resp = await fetch("/api/format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) {
    throw new Error("格式化请求失败");
  }

  return resp.json();
}

formatBtn.addEventListener("click", async () => {
  try {
    const result = await formatContent();
    preview.textContent = result.preview_text || "";

    const title = result.structured.title || "无";
    const paragraphCount = result.structured.stats.paragraph_count;
    const headingCount = result.structured.stats.heading_count;
    stats.textContent = `标题: ${title} | 段落数: ${paragraphCount} | 标题段: ${headingCount}`;
  } catch (error) {
    preview.textContent = error.message;
  }
});

downloadBtn.addEventListener("click", async () => {
  try {
    const text = inputText.value || "";
    const resp = await fetch("/api/format/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!resp.ok) {
      throw new Error("下载请求失败");
    }

    const blob = await resp.blob();
    const contentDisposition = resp.headers.get("Content-Disposition") || "";
    const match = contentDisposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "formatted.docx";

    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    preview.textContent = error.message;
  }
});
