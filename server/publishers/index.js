// 发布器抽象：统一签名 publish({ date, title, content, existingNodeId }) -> Promise<{ nodeId, url }>。
// 三种实现：
//   mock —— 仅 console.log 记录，返回固定 nodeId/url（默认）；
//   file —— 写入 <outputDir>/日报-<date>.md，existingNodeId 存在时覆盖同一文件；
//   dws  —— 用 execFile（非 shell 拼接，避免注入）调 dws CLI，lenient 解析 nodeId/url/docUrl。
// createPublisher(type, { wsId, folderId, dwsBin, outputDir }) 工厂，type 默认 'mock'。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export class MockPublisher {
  async publish({ date, title, content, existingNodeId }) {
    // eslint-disable-next-line no-console
    console.log(`[publisher/mock] publish ${title || `日报 ${date}`} (${date})`);
    return { nodeId: `mock-${date}`, url: `https://mock.local/daily/${date}` };
  }
}

export class FilePublisher {
  constructor(outputDir = 'reports-output/') {
    this.outputDir = outputDir;
  }

  async publish({ date, content, existingNodeId }) {
    await fs.promises.mkdir(this.outputDir, { recursive: true });
    const filename = `日报-${date}.md`;
    const filePath = path.join(this.outputDir, filename);
    await fs.promises.writeFile(filePath, content ?? '', 'utf8');
    // 相对路径作为 url（跨平台统一为正斜杠）
    const url = path.relative(process.cwd(), filePath).split(path.sep).join('/');
    return { nodeId: `file-${date}`, url };
  }
}

/**
 * 从任意对象中 lenient 提取 nodeId 与 url（兼容 nodeId/node_id、docUrl/url/doc_url，
 * 含 data 一层嵌套）。
 */
export function extractDwsResult(obj) {
  const root = obj && typeof obj === 'object' ? obj : {};
  const nodeId =
    root.nodeId ?? root.node_id ?? root.data?.nodeId ?? root.data?.node_id ?? null;
  const url =
    root.docUrl ?? root.url ?? root.doc_url ??
    root.data?.docUrl ?? root.data?.url ?? root.data?.doc_url ?? null;
  return { nodeId, url };
}

/** 解析 dws CLI stdout：先整体 JSON.parse；失败则取首个 { 到末尾 } 再解析（容错前缀文案）。 */
export function parseDwsOutput(stdout) {
  const text = String(stdout ?? '');
  try {
    return extractDwsResult(JSON.parse(text));
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return extractDwsResult(JSON.parse(text.slice(start, end + 1)));
      } catch {
        return { nodeId: null, url: null };
      }
    }
    return { nodeId: null, url: null };
  }
}

export class DwsCliPublisher {
  /**
   * @param {object} opts
   * @param {string} opts.wsId   工作空间 ID（创建必需）
   * @param {string} [opts.folderId] 文件夹 ID（可选）
   * @param {string} [opts.dwsBin]  dws 二进制路径，默认 'dws'
   * @param {Function} [opts.execFileImpl] 测试注入的 execFile 实现
   */
  constructor({ wsId, folderId, dwsBin = 'dws', execFileImpl } = {}) {
    this.wsId = wsId;
    this.folderId = folderId;
    this.dwsBin = dwsBin;
    this.execFile = execFileImpl || execFileAsync;
  }

  async publish({ date, title, content, existingNodeId }) {
    // 内容写入临时 md 文件，避免 Windows 下命令行引号转义问题
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodash-dws-'));
    const tmpFile = path.join(dir, 'report.md');
    await fs.promises.writeFile(tmpFile, content ?? '', 'utf8');

    const args = [];
    try {
      if (existingNodeId) {
        args.push(
          'doc', 'update',
          '--node', String(existingNodeId),
          '--content-file', tmpFile,
          '--format', 'json',
        );
      } else {
        if (!this.wsId) {
          throw new Error('DwsCliPublisher 缺少 wsId（DINGTALK_WIKI_WS_ID），无法创建文档');
        }
        args.push(
          'doc', 'create',
          '--name', `日报 ${date}`,
          '--content-file', tmpFile,
          '--workspace', String(this.wsId),
        );
        if (this.folderId) args.push('--folder', String(this.folderId));
        args.push('--format', 'json');
      }

      const { stdout } = await this.execFile(this.dwsBin, args, { maxBuffer: 16 * 1024 * 1024 });
      const { nodeId, url } = parseDwsOutput(stdout);
      if (!nodeId && !url) {
        throw new Error('dws 输出中未找到 nodeId/docUrl');
      }
      return { nodeId, url };
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function createPublisher(type = 'mock', opts = {}) {
  switch (type) {
    case 'mock':
      return new MockPublisher();
    case 'file':
      return new FilePublisher(opts.outputDir);
    case 'dws':
      return new DwsCliPublisher(opts);
    default:
      throw new Error(`不支持的发布器类型: ${type}（支持 mock/file/dws）`);
  }
}
