# 自动排版 Worker 项目

## 目标

将“未经排版文本 -> 专业 Word 文档”能力部署到 Cloudflare，支持：

- Worker 化 API（无状态、可托管）
- 模板策略（公文/论文/自动识别）
- 目录与参考文献增强
- 前端静态页面直接调用 API

## 架构

- 前端：`public/*` 静态页面
- API：`src/worker.ts`
- 核心逻辑：`src/core/*`
  - `analyzer.ts`：结构识别与模式判断
  - `docx-builder.ts`：Word 生成
  - `preview.ts`：预览渲染

## 模板策略

- `auto`：通过文本特征自动判断是 `official` 还是 `thesis`
- `official`（公文模式）：
  - 页边距上/下 2.5cm，左 3.0cm，右 2.0cm
  - 正文小四宋体，1.5 倍行距，首行缩进 2 字符
  - 识别章节标题并分级排版
- `thesis`（论文模式）：
  - 继承上述版式
  - 自动插入目录（TOC）
  - “参考文献”节自动编号与悬挂缩进

## 本地运行

```bash
npm install
npm run dev
```

浏览器访问：`http://127.0.0.1:8787`

## 测试

单元测试：

```bash
npm test
```

端到端集成测试（会启动本地 wrangler 并请求 API）：

```bash
npm run test:integration
```

测试成功后会生成 `worker_integration_output.docx`。

## Cloudflare 部署

1. 登录 Cloudflare，并准备 `wrangler` 权限：
   - `npx wrangler login`
2. 部署：
   - `npx wrangler deploy`
3. 绑定自定义域名（可选）：
   - 在 Cloudflare 控制台给 Worker 绑定路由。

## 说明

- 当前仓库仍保留了早期 Python 版本文件（`app.py`、`formatter.py`）用于对照。
- Cloudflare 托管路径以 Worker 版本为准。
