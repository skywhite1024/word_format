# AGENT.md

本文档面向接手本项目的大模型或自动化编码代理，目标是让你在最短时间内理解项目边界、关键入口和不可破坏的行为。

## 1. 项目定位

Word Format 是一个部署在 Cloudflare Workers 上的文本排版与 Word 导出工具。用户通常会输入直接复制来的中文文本、Markdown、ChatGPT/Gemini 分享链接，然后期望得到：

- 可读的网页预览。
- 可编辑的 `.docx`。
- 尽量准确的标题、表格、公式、引用和编号。
- 预览结果与下载 Word 结果一致。

当前生产主线是 TypeScript Worker，不是仓库里的 Python 原型。

## 2. 快速地图

| 路径 | 职责 |
| --- | --- |
| `public/index.html` | 单页界面结构。 |
| `public/app.js` | 前端交互、分享导入、预览渲染、DOCX 下载。 |
| `public/style.css` | 页面视觉与预览样式。 |
| `src/worker.ts` | Worker HTTP API 入口和请求调度。 |
| `src/core/analyzer.ts` | 规则引擎：文本清洗、标题识别、段落和块结构化。 |
| `src/core/docx-builder.ts` | DOCX 构建：段落、标题、表格、Office Math、公式编号。 |
| `src/core/share-import.ts` | ChatGPT / Gemini 公开分享链接导入。 |
| `src/core/llm-structurer.ts` | LLM 结构化、JSON 解析、结果校验和回退。 |
| `src/core/text-repair.ts` | 深度文本修复。 |
| `src/core/preview.ts` | 旧版结构化文本预览。 |
| `src/core/types.ts` | `Mode`、`Block`、`StructuredDoc` 等核心类型。 |
| `test/` | Vitest 回归测试。 |

## 3. 请求链路

```mermaid
flowchart TD
    A[用户输入文本或分享链接] --> B[public/app.js]
    B --> C[/api/import/share]
    B --> D[/api/format]
    B --> E[/api/format/docx]
    C --> F[src/core/share-import.ts]
    D --> G[src/worker.ts]
    E --> G
    G --> H[src/core/analyzer.ts]
    G --> I[src/core/llm-structurer.ts]
    H --> J[StructuredDoc]
    I --> J
    F --> J
    J --> K[前端预览]
    J --> L[src/core/docx-builder.ts]
    L --> M[DOCX]
```

关键点：前端下载 DOCX 时会把当前预览使用的 `structured` 一并提交到 `/api/format/docx`。后端若收到合法 `structured`，应直接复用，避免重新解析导致预览和 Word 不一致。

## 4. 常见任务路由

| 需求 | 优先查看 |
| --- | --- |
| 标题没有识别、列表误判、正文分块异常 | `src/core/analyzer.ts` 和相关测试。 |
| Word 中公式、编号、表格、样式异常 | `src/core/docx-builder.ts`。 |
| 预览公式或三线表显示异常 | `public/app.js`，必要时同步 `public/style.css`。 |
| 预览正确但 Word 错误 | 先查 `public/app.js` 是否传递 `structured`，再查 `src/core/docx-builder.ts`。 |
| ChatGPT / Gemini 导入异常 | `src/core/share-import.ts`。 |
| API 入参、响应头、缓存或路由问题 | `src/worker.ts`。 |
| 文本复制污染、转义符、零宽字符 | `src/core/text-repair.ts`。 |

## 5. 不变量

修改代码时必须保护这些行为：

- 预览和 DOCX 导出应尽量使用同一份 `StructuredDoc`。
- `/api/format`、`/api/format/docx`、`/api/import/share`、`/api/repair` 的基础合约不能随意破坏。
- 规则引擎必须可用；LLM 或外部分享导入失败时要有明确回退或错误信息。
- 表格解析必须允许数学表达式中出现竖线、双竖线、未闭合美元符号等异常输入。
- Gemini 导入不能接受明显“公式被剥离”的低质量 Reader 文本。
- DOCX 中公式应尽量生成可编辑 Office Math，而不是普通纯文本。
- 不提交密钥、Cookie、会话内容、调试 HTML 或临时二进制输出。

## 6. 分享链接导入注意事项

`share-import.ts` 是外部环境最不稳定的模块：

- ChatGPT 分享页可能返回 403 或序列化数据碎片，需要从 HTML、流式数据或 Reader 输出中提取正文。
- Gemini 分享页可能触发 Google abuse 页面、重定向、Jina Reader 限流或缺公式结果。
- Gemini 优先尝试 RPC 和渲染 HTML；Reader 结果如果公式明显丢失，应拒绝而不是导出坏文本。
- 导入成功后 Worker 会使用 Cache API 缓存结果，避免重复触发远端限制。

## 7. 公式与表格注意事项

公式相关问题通常跨越前端预览和 DOCX 导出两边：

- 前端预览的公式渲染主要在 `public/app.js`。
- Word 公式构建主要在 `src/core/docx-builder.ts`。
- 修改公式语法归一化时，检查范数、上下标、箭头、分式、求和、根式和括号。
- 修改 Markdown 表格解析时，注意 `|` 可能是列分隔符，也可能是数学表达式的一部分。
- 表格中出现 `Export to Sheets`、多余 `||`、未闭合 `$` 等 Gemini 残留时，应在解析层清理或归并。

## 8. 验证命令

优先执行：

```bash
node --check public/app.js
npm run build:check
npm test
```

如果涉及本地端到端行为：

```bash
npm run dev
npm run test:integration
```

如果涉及线上部署：

```bash
npx wrangler deploy
```

线上地址：

```text
https://word-format.aa15859014090.workers.dev/
```

## 9. 调试建议

- 先最小复现，再改解析规则，避免为了一个案例破坏其他案例。
- 对公式问题，分别检查“结构化块内容”“前端预览 HTML”“DOCX document.xml”。
- 对表格问题，先确认 Markdown 行是否被解析成二维数组，再查单元格内公式处理。
- 对分享导入问题，记录来源路径：原始 HTML、RPC、Jina Reader、CodeTabs 代理或缓存。
- 对性能问题，优先看前端渲染频率、大量 DOM 更新、公式预览成本和滚动监听。

## 10. 提交流程

除非用户明确要求，否则不要主动提交或推送。若用户已要求提交推送，建议流程：

```bash
git status --short
node --check public/app.js
npm run build:check
npm test
git add README.md AGENT.md
git commit -m "docs: 重构项目文档"
git push
```

提交前确认只包含本次任务相关文件，不要顺手加入临时输出、测试样本或密钥文件。
