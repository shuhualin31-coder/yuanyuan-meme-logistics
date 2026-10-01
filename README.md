# 缘缘表情包物流站

一个用于导入、理解和人工审核表情包素材的第一阶段前端原型。它在浏览器中读取 ZIP 内的图片，不连接数据库、Supabase 或 AI 服务。

## 功能

- 点击或拖拽导入 ZIP，递归读取 `jpg`、`jpeg`、`png`、`webp` 与 `gif` 图片。
- 顺序处理图片并显示进度，避免一次性阻塞界面；失败项目可重试。
- 缩略图浏览、上一张/下一张及审核进度。
- 可编辑的结构化资料：name、description、tags、emotion、scenes、tone、intensity 与 status。
- 审核资料暂存于浏览器 `localStorage`。图片仅保留在当前浏览器会话中。

## 本地使用

```bash
npm run build
```

将 `dist/` 作为静态站点目录提供即可。GitHub Pages 工作流会在推送到 `main` 时构建并部署该目录。

## 第二阶段扩展点

`src/app.js` 中的 `LocalMemeRepository` 是数据访问适配层。未来可用 `SupabaseMemeRepository` 实现相同的 `load()` 与 `save()` 接口，并接入 Supabase Storage、`meme_library`、embedding 和既有 `search_sticker`，无需重做界面或审核状态模型。
