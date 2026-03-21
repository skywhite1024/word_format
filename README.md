<div align="center">
  <h1>✨ 自动排版 Worker (Word Formatter) ✨</h1>
  <p>轻量级、无状态的云端智能排版服务：将“未经排版文本”自动转化为“公文/论文标准 Word 文档”</p>

  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="ModelScope" src="https://img.shields.io/badge/LLM-ModelScope_GLM_5-7B68EE?style=for-the-badge" />
</div>

---

## 🚀 项目概览

本项目将传统的“未经排版文本 -> 专业 Word 文档 (.docx)”的转换能力托管至 **Cloudflare Workers** 边缘网络。通过内置的规则引擎与 LLM（大模型）结构分析的深度结合，我们为您提供开箱即用、完全无服务器的高级排版生成 API。

## 🌟 核心特性

### 📝 1) 模板自适应策略

- **`auto` 自动识别**：智能匹配为公文格式或论文格式。
- **`official` （公文模式）**：
  - **页边距**：上/下 `2.5cm`，左 `3.0cm`，右 `2.0cm`
  - **正文规范**：小四宋体，`1.5` 倍行距，首行缩进 `2` 字符
- **`thesis` （论文模式）**：
  - **结构增强**：自动插入跨页目录（TOC）
  - **引用对齐**：参考文献自动进行编号与悬挂缩进排版

### 🧠 2) 大模型（LLM）智能处理

项目深度集成了 **ModelScope** 服务（默认底层模型为 _ZhipuAI/GLM-5_）：

- 开启方式极简（请求体携带 `useLlm: true` 即生效）
- 具备严格的 JSON 抽取容错，甚至可解析带解释性的 Markdown Code Fence
- 自带 **原文一致性校验机制**，有效防范模型“幻觉”擅改核心文本
- **优雅降级**：当大模型处理失败时，API 会自动回退至高可用的纯规则分析引擎

### ⚡ 3) 现代化开发与测试

- 基于纯洁的 **TypeScript** 生态系统与 Node.js 兼容特性，冷启动快于传统 Python（如历史留存的 `app.py` 方案）。
- 涵盖完善的 **单元测试 (Vitest)** 与 **端到端测试**，全方位保障代码健壮性。

---

## 📂 目录结构

```text
.
├── public/                 # 前端 HTML 静态展示与交互页面
├── src/
│   ├── worker.ts           # Cloudflare Worker API 主入口
│   └── core/
│       ├── analyzer.ts     # 基础规则分析引擎
│       ├── llm-structurer.ts # 大模型智能结构转换逻辑
│       └── docx-builder.ts # 原生 DOCX 文件构造器
├── test/                   # Vitest 单元测试用例
├── scripts/
│   └── integration-test.ts # 端到端（E2E）集成测试脚本
└── wrangler.toml           # Cloudflare Worker 全局配置参数
```

---

## 🛠️ 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

> **提示**：启动后，您可以直接访问 `http://127.0.0.1:8787` 查看内置的格式预览前端并进行接口调试。

### 3. 进行测试保障

本项目提供了多级测试，请在每次提交变更前执行：

```bash
# 执行强类型检查
npm run build:check

# 运行单元测试
npm test

# 运行端到端集成测试（成功后将在项目根目录输出演示性质的 worker_integration_output.docx）
npm run test:integration
```

---

## ☁️ 部署至 Cloudflare

此程序天生为 Serverless 设计，利用 Wrangler 可以一步部署到全球边缘。

### 1. 注入访问凭证

您需要在 Cloudflare Secret 中设置 ModelScope 的大模型访问密钥（注意：由于安全原因，禁止将秘钥写入代码仓库或 `wrangler.toml`）。

```bash
npx wrangler secret put MODELSCOPE_API_KEY
```

_(在终端提示时，请直接粘贴并保存您的 API Key)_

配置已注入 `wrangler.toml` 中的环境变量：

- `MODELSCOPE_BASE_URL`：`"https://api-inference.modelscope.cn/v1"`
- `MODELSCOPE_MODEL_ID`：`"ZhipuAI/GLM-5"`
- `MODELSCOPE_TIMEOUT_MS`：`"60000"`

### 2. 发布上线

一切就绪后，通过控制台指令一键发布到您的域下：

```bash
npx wrangler deploy
```

---

## 📜 兼容性声明

> - 本仓库根目录中保留了早期的 Python 文件（`app.py`、`formatter.py` 等），主要用于历史对照与参考。
> - 实际部署到 Cloudflare 托管环境的代码均以 `src/` 中的纯 TS/Worker 版本为准。

<div align="center">
  <sub>Made with ❤️ via Cloudflare Workers and TypeScript.</sub>
</div>
