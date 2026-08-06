// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createPublisher,
  MockPublisher,
  FilePublisher,
  DwsCliPublisher,
  parseDwsOutput,
} from './index.js';

describe('MockPublisher', () => {
  it('console.log 记录并返回固定 nodeId/url', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const p = new MockPublisher();
      const result = await p.publish({ date: '2026-08-06', title: '日报 2026-08-06', content: '正文' });
      expect(result).toEqual({
        nodeId: 'mock-2026-08-06',
        url: 'https://mock.local/daily/2026-08-06',
      });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('FilePublisher', () => {
  it('写入 <outputDir>/日报-<date>.md，existingNodeId 存在时覆盖同一文件', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodash-pub-'));
    try {
      const p = new FilePublisher(dir);
      const result = await p.publish({ date: '2026-08-06', title: '日报', content: '第一版内容' });
      const filePath = path.join(dir, '日报-2026-08-06.md');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('第一版内容');
      expect(result.nodeId).toBe('file-2026-08-06');
      expect(result.url).toContain('日报-2026-08-06.md');

      await p.publish({ date: '2026-08-06', title: '日报', content: '第二版内容', existingNodeId: 'file-2026-08-06' });
      expect(fs.readFileSync(filePath, 'utf8')).toBe('第二版内容');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('默认 outputDir 为 reports-output/，目录自动创建', async () => {
    const p = new FilePublisher();
    expect(p.outputDir).toBe('reports-output/');
  });
});

describe('DwsCliPublisher', () => {
  it('create：调用 dws doc create --content-file，解析 nodeId/url，临时文件被清理', async () => {
    const execFileImpl = vi
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify({ nodeId: 'abc123', url: 'https://wiki.example/doc/1' }), stderr: '' });
    const p = new DwsCliPublisher({ wsId: 'WS1', folderId: 'F1', dwsBin: 'dws', execFileImpl });

    const result = await p.publish({ date: '2026-08-06', title: '日报 2026-08-06', content: '正文' });

    const [bin, args] = execFileImpl.mock.calls[0];
    expect(bin).toBe('dws');
    expect(args).toEqual([
      'doc', 'create',
      '--name', '日报 2026-08-06',
      '--content-file', expect.any(String),
      '--workspace', 'WS1',
      '--folder', 'F1',
      '--format', 'json',
    ]);
    expect(result).toEqual({ nodeId: 'abc123', url: 'https://wiki.example/doc/1' });
    const tmpFile = args[5];
    expect(fs.existsSync(path.dirname(tmpFile))).toBe(false);
  });

  it('update：existingNodeId 存在时调用 dws doc update --node', async () => {
    const execFileImpl = vi.fn().mockResolvedValue({
      stdout: `created: ${JSON.stringify({ node_id: 'n9', doc_url: 'https://x/9' })}`,
      stderr: '',
    });
    const p = new DwsCliPublisher({ wsId: 'WS1', folderId: 'F1', dwsBin: 'dws', execFileImpl });

    const result = await p.publish({ date: '2026-08-06', title: '日报', content: 'c', existingNodeId: 'old-node' });

    const [bin, args] = execFileImpl.mock.calls[0];
    expect(bin).toBe('dws');
    expect(args).toEqual([
      'doc', 'update',
      '--node', 'old-node',
      '--content-file', expect.any(String),
      '--format', 'json',
    ]);
    // lenient 解析：前缀文案 + node_id/doc_url
    expect(result).toEqual({ nodeId: 'n9', url: 'https://x/9' });
  });

  it('dwsScript 提供时按 node + dws.js 前缀调用（Windows .cmd shim 场景）', async () => {
    const execFileImpl = vi
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify({ nodeId: 'abc123', url: 'https://wiki.example/doc/1' }), stderr: '' });
    const p = new DwsCliPublisher({
      wsId: 'WS1',
      folderId: 'F1',
      dwsBin: 'C:/Program Files/nodejs/node.exe',
      dwsScript: 'D:/dws/bin/dws.js',
      execFileImpl,
    });

    await p.publish({ date: '2026-08-06', content: '正文' });

    const [bin, args] = execFileImpl.mock.calls[0];
    expect(bin).toBe('C:/Program Files/nodejs/node.exe');
    expect(args[0]).toBe('D:/dws/bin/dws.js');
    expect(args.slice(1)).toEqual([
      'doc', 'create',
      '--name', '日报 2026-08-06',
      '--content-file', expect.any(String),
      '--workspace', 'WS1',
      '--folder', 'F1',
      '--format', 'json',
    ]);
  });

  it('缺 wsId 且为 create 时抛错', async () => {
    const execFileImpl = vi.fn();
    const p = new DwsCliPublisher({ folderId: 'F1', dwsBin: 'dws', execFileImpl });
    await expect(p.publish({ date: '2026-08-06', content: 'c' })).rejects.toThrow(/wsId/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('dws 不存在/失败时抛错（由 service 转 publish_failed）', async () => {
    const execFileImpl = vi.fn().mockRejectedValue(new Error('spawn dws ENOENT'));
    const p = new DwsCliPublisher({ wsId: 'WS1', folderId: 'F1', dwsBin: 'dws', execFileImpl });
    await expect(p.publish({ date: '2026-08-06', content: 'c' })).rejects.toThrow();
  });

  it('输出无法解析出 nodeId/docUrl 时抛错', async () => {
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: 'done, no doc here', stderr: '' });
    const p = new DwsCliPublisher({ wsId: 'WS1', folderId: 'F1', dwsBin: 'dws', execFileImpl });
    await expect(p.publish({ date: '2026-08-06', content: 'c' })).rejects.toThrow(/nodeId|docUrl/);
  });
});

describe('parseDwsOutput lenient 解析', () => {
  it('整体 JSON', () => {
    expect(parseDwsOutput('{"nodeId":"a","url":"u"}')).toEqual({ nodeId: 'a', url: 'u' });
  });
  it('前缀文案 + 嵌套 data', () => {
    expect(parseDwsOutput('prefix {"data":{"node_id":"b","doc_url":"v"}}')).toEqual({ nodeId: 'b', url: 'v' });
  });
  it('仅 docUrl 也可解析', () => {
    expect(parseDwsOutput('{"docUrl":"w"}')).toEqual({ nodeId: null, url: 'w' });
  });
  it('dws doc create 真实输出：serverResponse.docUrl 被提取', () => {
    const real = {
      success: true,
      nodeId: 'ZX6GRezwJl75MzDzhgm66gNqVdqbropQ',
      chunksWritten: 1,
      serverResponse: {
        docUrl: 'https://alidocs.dingtalk.com/i/nodes/ZX6GRezwJl75MzDzhgm66gNqVdqbropQ',
        name: '日报 2026-08-06',
        nodeId: 'ZX6GRezwJl75MzDzhgm66gNqVdqbropQ',
        success: true,
      },
    };
    expect(parseDwsOutput(JSON.stringify(real))).toEqual({
      nodeId: 'ZX6GRezwJl75MzDzhgm66gNqVdqbropQ',
      url: 'https://alidocs.dingtalk.com/i/nodes/ZX6GRezwJl75MzDzhgm66gNqVdqbropQ',
    });
  });
  it('无有效 JSON 返回空', () => {
    expect(parseDwsOutput('nothing here')).toEqual({ nodeId: null, url: null });
    expect(parseDwsOutput('')).toEqual({ nodeId: null, url: null });
  });
});

describe('createPublisher', () => {
  it('默认 mock', () => {
    expect(createPublisher()).toBeInstanceOf(MockPublisher);
    expect(createPublisher('mock')).toBeInstanceOf(MockPublisher);
  });
  it('file/dws 返回对应实现', () => {
    expect(createPublisher('file', { outputDir: os.tmpdir() })).toBeInstanceOf(FilePublisher);
    expect(createPublisher('dws', { wsId: 'w', folderId: 'f' })).toBeInstanceOf(DwsCliPublisher);
  });
  it('未知类型抛错', () => {
    expect(() => createPublisher('email')).toThrow(/不支持的发布器类型/);
  });
});
