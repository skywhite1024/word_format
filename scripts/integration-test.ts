import http from "node:http";
import { writeFile } from "node:fs/promises";
import worker from "../src/worker";

const HOST = "127.0.0.1";
const PORT = 8791;

function toHeaders(nodeHeaders: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (typeof value === "string") headers.set(key, value);
    if (Array.isArray(value)) headers.set(key, value.join(","));
  }
  return headers;
}

function startHarnessServer(): Promise<http.Server> {
  const env = {
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 }),
    },
  } as any;

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const request = new Request(`http://${HOST}:${PORT}${req.url ?? "/"}`, {
      method: req.method,
      headers: toHeaders(req.headers),
      body,
    });

    const response = await worker.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

async function main(): Promise<void> {
  const server = await startHarnessServer();

  try {
    const payload = {
      mode: "thesis",
      text: [
        "自动化排版系统设计",
        "",
        "摘要",
        "",
        "本文用于验证 Worker 版本端到端能力。",
        "",
        "第1章 绪论",
        "",
        "1.1 背景",
        "",
        "正文内容示例。",
        "",
        "参考文献",
        "",
        "[1] 王某. 示例文献.",
      ].join("\n"),
    };

    const formatResp = await fetch(`http://${HOST}:${PORT}/api/format`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!formatResp.ok) {
      throw new Error(`/api/format 失败: ${formatResp.status}`);
    }
    const formatData = await formatResp.json();

    const levels = formatData.structured.blocks
      .filter((item: { type: string }) => item.type === "heading")
      .map((item: { level: number }) => item.level);
    if (formatData.structured.mode !== "thesis") {
      throw new Error("模式识别失败，预期 thesis");
    }
    if (!levels.includes(1) || !levels.includes(2)) {
      throw new Error(`标题层级异常: ${levels.join(",")}`);
    }

    const docxResp = await fetch(`http://${HOST}:${PORT}/api/format/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!docxResp.ok) {
      throw new Error(`/api/format/docx 失败: ${docxResp.status}`);
    }
    const contentType = docxResp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      throw new Error(`content-type 异常: ${contentType}`);
    }

    const docxBuffer = Buffer.from(await docxResp.arrayBuffer());
    if (docxBuffer.length < 2000) {
      throw new Error("生成的 docx 体积异常，疑似失败");
    }
    await writeFile("worker_integration_output.docx", docxBuffer);

    console.log("integration_ok", {
      mode: formatData.structured.mode,
      headingCount: formatData.structured.stats.headingCount,
      referenceCount: formatData.structured.stats.referenceCount,
      docxSize: docxBuffer.length,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
