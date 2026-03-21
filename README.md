<div align="center">

# 📄 Auto-Format Text to Word Worker

**基于 Cloudflare Worker 与大模型的智能文本排版引擎**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ModelScope](https://img.shields.io/badge/ModelScope_LLM-4A2B8D?style=for-the-badge)](https://modelscope.cn/)

<br>
</div>

本项目将“自然文本转专业排版 Word 文档”的能力部署在云端节点 [Cloudflare Workers](https://workers.cloudflare.com/) 上。借助轻量级、无状态的网络 API 与**大模型 (LLM) 智能结构分析**功能，提供开箱即用的智能化公文及论文排版支持。

## ✨ 核心能力 & 特性

- ⚡️ **边缘计算部署**：完全基于 Cloudflare Workers 构建的服务端入口，零冷启动。
- 🧠 **大模型智能识别**：深度集成 ModelScope 模型接口（默认配置 `ZhipuAI/GLM-5`），自感知、自拆分文本结构，并带有内置的自动回退容错降级机制。
- 🎨 **多重内置排版策略**：
  - `official` _(公文模式)_：严格遵循公文页边距约束（上/下 2.5cm，左 3.0cm，右 2.0cm），自动配置首行缩进（2 字符）并应用“小四宋体、1.5 倍行距”等样式。
  - `thesis` _(论文模式)_：自动插入目录（TOC），参考文献自动补充编号并设置完美悬挂缩进。
  - `auto` _(动态智推)_：利用规则或 LLM 自动将文档分类并派发为最合适的策略。

## 📁 项目架构

```text
.
├── public/                 # 前端可视化交互与静态演示页面
├── src/
│   ├── worker.ts           # Cloudflare Worker API 网络入口点
│   ├── core/
│   │   ├── analyzer.ts     # 基准规则分析引擎
│   │   ├── llm-structurer.ts # 大语言模型结构化转换映射服务
│   │   └── docx-builder.ts # DOCX 文档文件流自动构建核心
├── test/                   # 独立规则单元测试
├── scripts/
│   └── integration-test.ts # 端到端集成测试验证脚本
├── package.json            # Node 依赖描述文件
└── wrangler.toml           # Cloudflare Worker 全局配置声明
```

> **💡 历史兼容说明**：仓库内保留了早期基于 Python 开发的原型实现文件（`app.py`、`formatter.py`）仅供开发对比，实际基于云函数的应用均通过 TypeScript 构建。

---

## 🚀 快速上手与本地测试

通过以下命令安装必要依赖并在本地启动一键开发测试服务器：

```bash
# 全局安装项目依赖
npm install

# 本地启动 Worker 模拟运行环境
npm run dev
```

成功启动后，可以访问前端静态演示界面：  
👉 **[http://127.0.0.1:8787](http://127.0.0.1:8787)**

---

## 🛡️ 质量保证与自动化测试

项目集成了端到端测试链路与类型分析防护：

```bash
# 1. 运行独立的 TypeScript 类型检查
npm run build:check

# 2. 执行核心引擎单元测试
npm test

# 3. 运行端到端模拟集成测试
npm run test:integration
```

🌟 _提示：集成测试验证成功完成后，会在工程目录顺势生成 `worker_integration_output.docx` 结构化参考对照文件。_

---

## ⚙️ 环境参数配置

利用 Cloudflare `wrangler.toml` 文件进行环境变量声明管理。默认自带的模型推理参数如下：

```toml
MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1"
MODELSCOPE_MODEL_ID = "ZhipuAI/GLM-5"
MODELSCOPE_TIMEOUT_MS = "60000"
```

### 接入大模型 API 密钥

> ⚠️ **强烈禁止将密钥明文硬编码提交到 Git 仓库。**

部署生产前或在开发环境下，需通过 `wrangler` CLI 控制台将环境变量绑定为安全的密文凭据：

```bash
npx wrangler secret put MODELSCOPE_API_KEY
```

接下来根据终端要求提示，粘贴你从 ModelScope 申请获得的 API Key。

---

## 🌐 一键下发部署

当你配置完毕环境后，可以直接把当前微服务发布上线：

```bash
npx wrangler deploy
```

<br>

<div align="center">
  <i>构建属于你的智能排版助理 🖋️ —— 由 Cloudflare & 大模型驱动。</i>
</div>
