# 个人效率工作台（Prodash）

深色主题的个人效率网页，将待办、时间管理、笔记、记账集中在一个工作台里。当前版本完整实现「待办清单」（列表 + 艾森豪威尔四象限双视图）。

- 在线地址：https://scofan-official.github.io/prodash/
- 当前版本：v0.1.0

## 功能特性

- **工作台外壳**：标题栏 + 顶部 Tab（待办 / 番茄钟 / 笔记 / 记账）
- **四象限待办**：添加任务时用「重要？」「紧急？」两个开关，自动归入四个象限
  - 重要·紧急 → 立即做
  - 重要·不紧急 → 计划做
  - 不重要·紧急 → 快速处理
  - 不重要·不紧急 → 尽量少做
- **双视图切换**：列表 / 四象限两种查看方式，切换不丢数据
- **数据持久化**：所有数据存浏览器 localStorage，刷新不丢失
- **错误兜底**：读写失败不崩溃，页面给出友好提示
- **响应式**：深色主题，手机窄屏自动适配

## 技术栈

- React 18 + Vite 8（JavaScript）
- Vitest 4 + React Testing Library（测试）
- 纯前端单页应用，无后端
- 部署：GitHub Pages + GitHub Actions

## 本地开发

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器（默认 http://localhost:5173/）
npm test           # 运行全部测试
npm run build      # 生产构建（输出到 dist/）
npm run preview    # 本地预览构建产物
```

## 部署

推送到 GitHub 的 `main` 分支后，GitHub Actions 会自动构建并发布到 GitHub Pages。部署前需在仓库 `Settings → Pages → Source` 选择 **GitHub Actions**。

## 版本管理

项目使用 **SemVer（语义化版本）**，格式为 `主版本.次版本.修订号`：

| 更新类型 | 场景 | 版本号变化 | 命令 |
|---------|------|-----------|------|
| 主版本（MAJOR） | 破坏性变更，不兼容旧版 | 1.x.x → 2.0.0 | `npm version major` |
| 次版本（MINOR） | 新增功能，向后兼容 | 1.0.x → 1.1.0 | `npm version minor` |
| 修订号（PATCH） | Bug 修复，向后兼容 | 1.0.0 → 1.0.1 | `npm version patch` |

发版流程：

```bash
npm version minor        # 升级版本号（自动更新 package.json 并打 v1.1.0 标签）
git push origin main --tags   # 推送代码与版本标签
```

每个版本同时做两件事：**更新 `package.json` 的 `version` 字段**，并**打一个 `vX.Y.Z` 的 git 标签**，方便回溯任意一次更新。每次发版记得在本 README 的「版本历史」中追加一条记录。

### 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-08-05 | 首个版本：工作台外壳 + 四象限待办（双视图、持久化、深色响应式）、GitHub Pages 部署 |

## 未来规划

1. 番茄钟（时间管理）
2. 笔记工具
3. 记账工具
4. AI 智能录入：一句话描述任务，AI 追问 Deadline 等细节后自动评估重要/紧急
