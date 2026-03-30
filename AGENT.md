# AGENT.md

## 1. 项目背景

本仓库是一个“文本智能排版并导出 Word”的服务：

- 主实现基于 **Cloudflare Workers + TypeScript**。
- 通过 `src/worker.ts` 提供 HTTP API。
- 支持两类引擎：
  - 规则引擎（`src/core/analyzer.ts`）
  - LLM 结构化引擎（`src/core/llm-structurer.ts`，ModelScope 接口）
- 最终由 `src/core/docx-builder.ts` 生成 `.docx`。
- `public/` 提供前端演示页面。

仓库中还保留了早期 Python 原型（`app.py`、`formatter.py`），当前生产路径以 TypeScript Worker 为准。

---

## 2. 关键目录与职责

- `src/worker.ts`：路由与请求入口，统一处理 `/api/format`、`/api/format/docx`。
- `src/core/types.ts`：结构化文档类型定义（`Mode`、`Block`、`StructuredDoc`）。
- `src/core/analyzer.ts`：规则分段、标题识别、模式判断（`official`/`thesis`）。
- `src/core/llm-structurer.ts`：LLM 调用、JSON 解析、有效性校验与回退策略。
- `src/core/docx-builder.ts`：样式、目录、参考文献编号、页脚页码与 docx 输出。
- `src/core/preview.ts`：结构化结果的纯文本预览。
- `test/`：Vitest 单元测试。
- `scripts/integration-test.ts`：端到端集成测试脚本（本地启动 harness 并验证输出）。
- `wrangler.toml`：Worker 与环境变量配置。

---

## 3. API 行为速览

### `POST /api/format`
输入：

```json
{
  "text": "原始文本",
  "mode": "auto|official|thesis",
  "useLlm": true
}
```

输出：结构化结果 + 预览文本 + 引擎元信息。

### `POST /api/format/docx`
输入同上，输出 `.docx` 二进制流。响应头包含：

- `X-Format-Engine`：`llm` 或 `rule`
- `X-Format-Fallback`：LLM 失败时的回退原因

---

## 4. 开发与验证（Windows `cmd.exe`）

安装依赖：

```bat
npm install
```

本地开发：

```bat
npm run dev
```

类型检查：

```bat
npm run build:check
```

单元测试：

```bat
npm test
```

集成测试：

```bat
npm run test:integration
```

---

## 5. 环境变量与密钥

`wrangler.toml` 中可配置：

- `MODELSCOPE_BASE_URL`
- `MODELSCOPE_MODEL_ID`
- `MODELSCOPE_TIMEOUT_MS`

密钥请通过 Wrangler Secret 注入，不要写入代码：

```bat
npx wrangler secret put MODELSCOPE_API_KEY
```

---

## 6. Agent 协作规范

1. **优先最小改动**：只改与任务直接相关的文件，避免大范围重构。
2. **保持回退路径**：涉及 LLM 逻辑时，确保规则引擎回退仍然可用。
3. **先类型后测试**：提交前至少执行 `npm run build:check` 与相关测试。
4. **遵循现有风格**：TypeScript ESM、现有命名与模块边界不随意变更。
5. **不要提交密钥**：任何 API Key 一律使用环境变量/secret。
6. **关注接口兼容性**：避免破坏 `/api/format` 和 `/api/format/docx` 的输入输出结构。

---

## 7. 常见改动入口建议

- 想提升规则识别：优先修改 `src/core/analyzer.ts`。
- 想优化 LLM 输出健壮性：修改 `src/core/llm-structurer.ts`。
- 想调整 Word 样式：修改 `src/core/docx-builder.ts`。
- 想改前端交互：修改 `public/app.js` 与 `public/index.html`。
- 想补回归保障：在 `test/*.test.ts` 增加对应测试。

---

## 8. 交付标准（对 Agent）

当 Agent 完成改动时，应确保：

- 代码可通过 TypeScript 检查。
- 相关测试通过（至少变更相关测试）。
- 文档/API 行为变化已同步到 README 或对应文档。
- 输出说明中明确：改了什么、为什么、如何验证。
