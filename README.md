# VPS Value

一个简约的 VPS 开销记录工具，适合部署在 Cloudflare Pages，数据存储使用 Cloudflare D1。源码可以公开放在 GitHub，私人数据通过 `ADMIN_TOKEN` 访问令牌保护。

## 功能

- 新增、修改 VPS 信息
- 停用 VPS，并保留数据
- 停用后可恢复或永久删除
- 一键续费：按续费周期自动顺延到期时间
- 按实时汇率接口统一折算为 CNY
- 自动统计使用中的 VPS 数量、本周期合计、月均成本、年均成本

## VPS 字段

- 商家名称
- 套餐名称
- 价格和货币
- 到期时间
- 续费周期
- VPS 总数
- VPS 分类
- 商家官网链接

## 技术栈

- Vite + TypeScript
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1
- ExchangeRate-API 免费最新汇率接口

## 本地准备

```bash
npm install
cp .dev.vars.example .dev.vars
```

修改 `.dev.vars`：

```bash
ADMIN_TOKEN=your-local-token
```

创建 D1 数据库：

```bash
npx wrangler login
npx wrangler d1 create vps-value
```

把命令输出中的 `database_id` 填入 `wrangler.toml`。

执行本地迁移：

```bash
npm run db:migrate:local
```

运行 Cloudflare Pages 本地环境：

```bash
npm run pages:dev
```

只查看前端静态界面可以运行：

```bash
npm run dev
```

但新增、修改、查询等 API 功能需要 `npm run pages:dev`。

## 部署到 Cloudflare Pages

1. 将仓库推送到 GitHub。
2. 在 Cloudflare 创建 D1 数据库：

```bash
npx wrangler d1 create vps-value
```

3. 把 D1 的 `database_id` 更新到 `wrangler.toml`。
4. 执行远程数据库迁移：

```bash
npm run db:migrate:remote
```

5. 在 Cloudflare Pages 中连接 GitHub 仓库。
6. 设置构建命令为：

```bash
npm run build
```

7. 设置构建输出目录为：

```bash
dist
```

8. 在 Pages 项目的环境变量中设置：

```bash
ADMIN_TOKEN=your-secret-token
```

9. 确认 Pages Functions 绑定了 D1，绑定名必须是：

```bash
DB
```

完成后访问 Pages 域名，在页面右上角填入 `ADMIN_TOKEN` 即可使用。

## 数据库迁移

迁移文件在 `migrations/`。已有初始化迁移：

```text
migrations/0001_init.sql
```

后续新增字段时继续添加新的迁移文件，然后分别执行本地或远程迁移。

## 汇率说明

后端会请求：

```text
https://open.er-api.com/v6/latest/CNY
```

接口返回以 CNY 为基准的最新汇率。外币金额换算为 CNY 时使用：

```text
CNY = 外币金额 / rates[外币代码]
```

汇率结果会缓存 1 小时。接口暂时不可用时，CNY 价格仍可正常统计，其他货币会显示无法换算。

## 开源协议

MIT
