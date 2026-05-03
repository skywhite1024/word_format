import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeText } from "./core/analyzer";
import { buildDocx } from "./core/docx-builder";
import { deepRepairText } from "./core/text-repair";
import type { ImageData, Mode } from "./core/types";

const SUPPORTED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp"]);
const VERSION = "1.0.0";

interface CliOptions {
  inputPath: string;
  outputPath: string;
  imagesDir: string | null;
  mode: Mode;
  mathItalic: boolean;
  useOriginalCaptionIndex: boolean;
  repair: boolean;
}

function printHelp() {
  console.log(`
word-format CLI v${VERSION} - 本地 Word 文档生成工具

用法:
  npx tsx src/cli.ts <input> [options]

参数:
  <input>                输入文本文件路径，使用 "-" 从 stdin 读取

选项:
  -o, --output <file>    输出文件路径 (默认: formatted.docx)
  -d, --images <dir>     图片目录路径
  -m, --mode <mode>      模式: auto | official | thesis (默认: auto)
  --math-italic          公式变量斜体 (默认开启)
  --no-math-italic       关闭公式变量斜体
  --original-captions    保留原始图表编号 (如 图1-1, 图1-2)
  --repair               先执行深度乱码修复
  -h, --help             显示帮助信息
  -v, --version          显示版本号

示例:
  npx tsx src/cli.ts paper.txt --images ./figures/ -o paper.docx
  npx tsx src/cli.ts paper.txt --images ./img/ --mode thesis --original-captions
  cat input.txt | npx tsx src/cli.ts - --images ./figures/ -o output.docx
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const options: CliOptions = {
    inputPath: "",
    outputPath: "formatted.docx",
    imagesDir: null,
    mode: "auto",
    mathItalic: true,
    useOriginalCaptionIndex: false,
    repair: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "-v" || arg === "--version") {
      console.log(`word-format CLI v${VERSION}`);
      process.exit(0);
    }

    if (arg === "--repair") {
      options.repair = true;
      i++;
      continue;
    }

    if (arg === "--math-italic") {
      options.mathItalic = true;
      i++;
      continue;
    }

    if (arg === "--no-math-italic") {
      options.mathItalic = false;
      i++;
      continue;
    }

    if (arg === "--original-captions") {
      options.useOriginalCaptionIndex = true;
      i++;
      continue;
    }

    if ((arg === "-o" || arg === "--output") && i + 1 < args.length) {
      options.outputPath = args[++i];
      i++;
      continue;
    }

    if ((arg === "-d" || arg === "--images") && i + 1 < args.length) {
      options.imagesDir = args[++i];
      i++;
      continue;
    }

    if ((arg === "-m" || arg === "--mode") && i + 1 < args.length) {
      const mode = args[++i];
      if (mode === "auto" || mode === "official" || mode === "thesis") {
        options.mode = mode;
      } else {
        console.error(`错误: 无效的模式 "${mode}"，可选: auto, official, thesis`);
        process.exit(1);
      }
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      console.error(`错误: 未知选项 "${arg}"`);
      process.exit(1);
    }

    if (!options.inputPath) {
      options.inputPath = arg;
      i++;
      continue;
    }

    console.error(`错误: 多余的参数 "${arg}"`);
    process.exit(1);
  }

  if (!options.inputPath) {
    console.error("错误: 请指定输入文件路径。使用 -h 查看帮助。");
    process.exit(1);
  }

  return options;
}

function loadImagesFromDir(dirPath: string): Record<string, ImageData> {
  const images: Record<string, ImageData> = {};

  if (!fs.existsSync(dirPath)) {
    console.error(`错误: 图片目录不存在: ${dirPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    console.error(`错误: 图片路径不是目录: ${dirPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase().replace(".", "");
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const filePath = path.join(dirPath, file);
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const type = ext === "jpeg" ? "jpg" : ext;
    const key = path.basename(file, path.extname(file)).toLowerCase();
    images[key] = { base64, type: type as ImageData["type"] };
  }

  return images;
}

async function main() {
  const options = parseArgs(process.argv);

  // Read input
  let text: string;
  if (options.inputPath === "-") {
    text = fs.readFileSync(0, "utf-8");
  } else {
    if (!fs.existsSync(options.inputPath)) {
      console.error(`错误: 输入文件不存在: ${options.inputPath}`);
      process.exit(1);
    }
    text = fs.readFileSync(options.inputPath, "utf-8");
  }

  if (!text.trim()) {
    console.error("错误: 输入文本为空。");
    process.exit(1);
  }

  // Optional repair
  if (options.repair) {
    const before = text.length;
    text = deepRepairText(text);
    const after = text.length;
    console.log(`[修复] 深度乱码修复完成 (${before} -> ${after} 字符)`);
  }

  // Analyze
  console.log(`[分析] 正在分析文本结构 (模式: ${options.mode})...`);
  const structured = analyzeText(text, options.mode);
  console.log(`[分析] 识别结果: ${structured.mode} 模式`);
  console.log(`[分析] 标题: ${structured.title || "(无)"}`);
  console.log(`[分析] 段落: ${structured.stats.paragraphCount}, 标题: ${structured.stats.headingCount}, 参考文献: ${structured.stats.referenceCount}`);

  // Load images
  let images: Record<string, ImageData> | undefined;
  if (options.imagesDir) {
    images = loadImagesFromDir(options.imagesDir);
    const imageKeys = Object.keys(images);
    if (imageKeys.length > 0) {
      const totalMB = Object.values(images)
        .reduce((sum, img) => sum + img.base64.length * 3 / 4, 0) / (1024 * 1024);
      console.log(`[图片] 加载 ${imageKeys.length} 张图片 (${totalMB.toFixed(1)}MB):`);
      for (const key of imageKeys) {
        const sizeKB = (images[key].base64.length * 3 / 4) / 1024;
        console.log(`  - ${key}.${images[key].type} (${sizeKB.toFixed(0)}KB)`);
      }
    } else {
      console.log("[图片] 目录中未找到支持的图片文件 (png/jpg/jpeg/gif/bmp)");
    }
  }

  // Build DOCX
  console.log("[生成] 正在生成 Word 文档...");
  const result = await buildDocx(structured, {
    mathItalic: options.mathItalic,
    images,
    useOriginalCaptionIndex: options.useOriginalCaptionIndex,
  });

  // Write output
  const outputPath = path.resolve(options.outputPath);
  fs.writeFileSync(outputPath, Buffer.from(result));
  const sizeKB = result.byteLength / 1024;
  console.log(`[完成] Word 文档已生成: ${outputPath} (${sizeKB.toFixed(0)}KB)`);
}

main().catch((error) => {
  console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
