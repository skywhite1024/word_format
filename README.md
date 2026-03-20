# 自动排版 Worker 项目

## 项目目标

把“未经排版文本 -> 专业 Word 文档”的能力部署到 Cloudflare，支持：

- Worker 化 API（无状态，可托管）
- 模板策略（公文 / 论文 / 自动识别）
- 目录与参考文献增强
- 大模型智能结构识别（ModelScope GLM-5，可自动回退规则引擎）

## 目录结构

- `public/*`：前端静态页面
- `src/worker.ts`：Worker API 入口
- `src/core/analyzer.ts`：规则引擎
- `src/core/llm-structurer.ts`：大模型结构化转换
- `src/core/docx-builder.ts`：DOCX 构建
- `test/*`：单元测试
- `scripts/integration-test.ts`：端到端集成测试

## 核心能力

### 1) 模板策略

- `auto`：自动识别为 `official` 或 `thesis`
- `official`（公文模式）：
  - 页边距：上/下 2.5cm，左 3.0cm，右 2.0cm
  - 正文：小四宋体，1.5 倍行距，首行缩进 2 字符
- `thesis`（论文模式）：
  - 自动插入目录（TOC）
  - 参考文献自动编号与悬挂缩进

### 2) 大模型智能处理

- 接口：`https://api-inference.modelscope.cn/v1/chat/completions`
- 模型：`ZhipuAI/GLM-5`
- 启用方式：请求体 `useLlm: true`
- 防护机制：
  - JSON 抽取容错（支持 code fence / 解释性返回）
  - 原文一致性校验（防止幻觉）
  - 失败自动回退到规则引擎

## 本地运行

```bash
npm install
npm run dev
```

访问：`http://127.0.0.1:8787`

## 测试命令

类型检查：

```bash
npm run build:check
```

单元测试：

```bash
npm test
```

端到端测试：

```bash
npm run test:integration
```

成功后会生成 `worker_integration_output.docx`。

## Cloudflare 配置

`wrangler.toml` 已配置：

- `MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1"`
- `MODELSCOPE_MODEL_ID = "ZhipuAI/GLM-5"`
- `MODELSCOPE_TIMEOUT_MS = "60000"`

你需要在 Cloudflare 中设置密钥（不要写入仓库）：

```bash
npx wrangler secret put MODELSCOPE_API_KEY
```

然后粘贴你的 API Key。

## 部署

```bash
npx wrangler deploy
```

## 兼容说明

- 仓库保留了早期 Python 文件（`app.py`、`formatter.py`）用于历史对照。
- 实际 Cloudflare 托管以 Worker 版本为准。
