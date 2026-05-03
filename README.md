# Automail

Automail 是一个面向 AI 自动化流程的轻量邮件接收服务。它负责直接接收 SMTP 邮件，按收件地址自动创建邮箱，把邮件存入 Postgres，并提供简单 HTTP API 供 Agent、脚本、测试流程或内部自动化系统拉取邮件。

典型用途：

- AI Agent 注册第三方服务后，自动等待验证码邮件并读取六位验证码。
- 自动化测试为每次任务生成一个临时邮箱，收到邮件后通过 API 拉取最新内容。
- 内部工具用统一收件域名承接回调、邀请、确认链接，再把结构化信息交给下游流程。
- 本地查看器快速查看所有邮箱和最新邮件，辅助调试自动化链路。

## 核心功能

- **自动收信**：内置 SMTP server，可直接接收投递到服务器的邮件。
- **自动创建邮箱**：邮件到达时，收件地址对应的邮箱会自动入库，无需提前创建。
- **收件白名单**：只接收允许的完整邮箱或域名，非白名单收件人在 `RCPT TO` 阶段拒收。
- **邮件 API**：提供邮箱列表、邮件列表、邮件详情、收件白名单管理等 HTTP API。
- **AI 友好查询**：邮件列表按最新优先，支持 `mailbox=all`、分页、最新 N 条、发件人、关键字、时间戳筛选。
- **结构化提取**：收信时提取六位数字验证码和邮件希望用户点击的有效链接，方便自动化流程直接消费。
- **Postgres 存储**：邮件正文、HTML、headers、附件元数据、原始 RFC822 内容和结构化数据都存入 Postgres。
- **本地 Viewer**：提供一个本地三栏页面查看邮箱、邮件列表和详情，支持自动刷新、复制验证码/链接和 HTML/Text 渲染切换。

## 最快部署运行

如果服务器上已经有可复用的 Postgres：

```bash
git clone git@github.com:your-org/automail.git
cd automail
cp .env.example .env
vi .env
./scripts/deploy.sh
```

`.env` 至少改这些值：

```env
API_KEY=replace-with-a-long-random-api-key
ALLOWED_RECIPIENTS=example.com,mail.example.com
DATABASE_URL=postgres://postgres:strong-password@your-postgres-host:5432/mail_service
```

如果没有现成 Postgres，可以一起启动应用和数据库：

```bash
./scripts/deploy.sh --with-postgres
```

部署后检查：

```bash
docker compose ps
curl http://127.0.0.1:3000/health
curl -H "x-api-key: replace-with-a-long-random-api-key" http://127.0.0.1:3000/mailboxes
```

让真实邮件能投递进来，还需要在 DNS 和服务器侧完成：

1. 给收信主机配置 `A` 记录，例如 `mail.example.com -> server-ip`。
2. 给收信域名配置 `MX` 记录，例如 `example.com -> mail.example.com`。
3. 确认服务器和云厂商放行入站 `25/tcp`。
4. HTTP API 可直接开放 `3000/tcp`，也可以放到 Caddy/Nginx 后面。

SMTP 不走反向代理，邮件投递方会连接 `MX` 指向主机的 `25/tcp`。Caddy/Nginx 只适合代理 HTTP API。

## 本地快速试用

本地开发不需要真实域名，可以用 `2525` 端口模拟 SMTP 投递：

```bash
npm install
cp .env.example .env
vi .env
npm start
```

本地 `npm start` 前要确保 `.env` 里的 `DATABASE_URL` 指向可用 Postgres。如果你不想单独准备数据库，也可以直接用容器方式启动本地 Postgres：

```bash
./scripts/deploy.sh --with-postgres
```

发送一封测试邮件：

```bash
curl --url smtp://127.0.0.1:2525 \
  --mail-from sender@example.com \
  --mail-rcpt test@example.com \
  -T <(printf "From: sender@example.com\nTo: test@example.com\nSubject: hello\n\ncode 123456\n")
```

拉取最新邮件：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=test@example.com&limit=10"
```

## 配置

主要配置都放在 `.env`。仓库只提交 `.env.example`，真实 `.env` 不要提交。

| 变量 | 说明 | 默认示例 |
| --- | --- | --- |
| `HTTP_PORT` | 应用容器内 HTTP 监听端口 | `3000` |
| `SMTP_PORT` | 应用容器内 SMTP 监听端口 | `2525` |
| `HTTP_BIND_PORT` | 宿主机 HTTP 暴露端口 | `3000` |
| `SMTP_BIND_PORT` | 宿主机 SMTP 暴露端口 | `25` |
| `HTTP_HOST` | HTTP 监听地址 | `0.0.0.0` |
| `SMTP_HOST` | SMTP 监听地址 | `0.0.0.0` |
| `API_KEY` | HTTP API bootstrap key，启动时会写入数据库 key 表 | `replace-with-your-api-key` |
| `ALLOWED_RECIPIENTS` | 允许收信的邮箱或域名，逗号分隔 | `example.com,mail.example.com` |
| `DATABASE_URL` | Postgres 连接串 | `postgres://...` |
| `DATA_DIR` | 应用挂载的数据目录 | `./data` |
| `EXTERNAL_DOCKER_NETWORK` | 可选，复用已有 Docker 网络 | 空 |

收件白名单说明：

- `example.com` 表示允许 `*@example.com`。
- `mail.example.com` 表示允许 `*@mail.example.com`。
- `user@example.com` 只允许这个完整邮箱。
- SMTP 会在 `RCPT TO` 阶段拒绝不匹配白名单的收件人，拒收邮件不会入库。

## Docker 和 Postgres

项目默认优先复用已有 Postgres，避免为每个服务重复启动数据库。

只启动应用，连接 `.env` 中的 `DATABASE_URL`：

```bash
./scripts/deploy.sh
```

应用和 Postgres 一起启动：

```bash
./scripts/deploy.sh --with-postgres
```

相关文件：

- `compose.yml`：只定义应用服务，适合复用已有数据库。
- `compose.postgres.yml`：可选 Postgres 覆盖层。
- `compose.external-network.yml`：可选，把应用加入已有 Docker 网络。
- `scripts/deploy.sh`：封装常用启动命令。
- `scripts/logs.sh`：查看服务日志。

如果复用另一个 Compose 项目里的 Postgres，并且数据库没有暴露宿主机端口，可以让 Automail 应用加入那个项目的 Docker 网络：

```env
DATABASE_URL=postgres://user:password@postgres:5432/mail_service
EXTERNAL_DOCKER_NETWORK=existing-postgres-network
```

启动时使用外部网络覆盖文件：

```bash
docker compose -f compose.yml -f compose.external-network.yml up -d --build app
```

数据路径：

- 应用运行目录默认挂载为 `./data:/app/data`。
- 如果使用内置 Postgres，数据库文件固定在 `./data/postgres`。
- `data/` 是运行时目录，已被 git 忽略，不要提交。

## HTTP API

所有拉取和管理 API 都建议带 `x-api-key`：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" http://127.0.0.1:3000/mailboxes
```

也支持 `api_key` query 参数，主要用于简单脚本调试：

```bash
curl "http://127.0.0.1:3000/mailboxes?api_key=replace-with-a-long-random-api-key"
```

### API Key 管理

Automail 启动时会把 `.env` 中的 `API_KEY` 写入 Postgres 的 `api_keys` 表。运行时鉴权优先检查数据库里的 active keys；数据库没有 active key 时才回退到 `.env API_KEY`。数据库只保存 key 的 SHA-256 hash，不保存明文。

不要通过覆盖 `.env API_KEY` 来做常规轮换，因为其他服务可能仍在使用旧 key。推荐流程是先新增 key，迁移调用方，再禁用旧 key：

```bash
curl -X POST \
  -H "x-api-key: current-api-key" \
  -H "content-type: application/json" \
  -d '{"key":"new-long-random-api-key","label":"automation worker"}' \
  http://127.0.0.1:3000/api-keys
```

查看 key 元信息。响应只包含 `id`、`label`、`active`、`createdAt`、`lastUsedAt`，不会返回明文 key 或 hash：

```bash
curl -H "x-api-key: current-api-key" \
  http://127.0.0.1:3000/api-keys
```

确认调用方都迁移后，再禁用旧 key：

```bash
curl -X DELETE \
  -H "x-api-key: current-api-key" \
  http://127.0.0.1:3000/api-keys/1
```

### 健康检查

```bash
curl http://127.0.0.1:3000/health
```

### 邮箱列表

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  http://127.0.0.1:3000/mailboxes
```

### 邮件列表

按单个邮箱拉取：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=test@example.com"
```

拉取所有邮箱的最新邮件：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=all&limit=20"
```

分页：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=all&limit=20&offset=20"
```

筛选发件人：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=all&sender=alice@example.com"
```

筛选标题或正文关键字：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=all&keyword=verification"
```

按入库时间戳筛选：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages?mailbox=all&since=1714708800&until=1714795200"
```

`since` 和 `until` 支持 Unix 秒级时间戳，也支持毫秒级时间戳。

列表响应包含：

- `total`：匹配总数。
- `limit` / `offset`：当前分页参数。
- `messages`：最新优先的邮件摘要。

### 邮件详情

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/messages/<message-id>?mailbox=test@example.com"
```

详情包含：

- envelope 发件人和收件人。
- subject、from、to、cc、bcc、date。
- text 和 html 正文。
- headers。
- attachments 元数据。
- structuredData。
- raw 原始 RFC822 内容。

### 收件白名单

查看：

```bash
curl -H "x-api-key: replace-with-a-long-random-api-key" \
  http://127.0.0.1:3000/allowlist
```

添加：

```bash
curl -X POST \
  -H "x-api-key: replace-with-a-long-random-api-key" \
  -H "content-type: application/json" \
  -d '{"entry":"example.com"}' \
  http://127.0.0.1:3000/allowlist
```

删除：

```bash
curl -X DELETE \
  -H "x-api-key: replace-with-a-long-random-api-key" \
  "http://127.0.0.1:3000/allowlist?entry=example.com"
```

## 结构化数据

Automail 会在收信时把常见自动化信息存到 `structuredData`：

- `verification_code`：六位数字验证码。
- `link`：邮件中用户可能需要点击的有效链接。

链接提取会过滤图片、字体、CSS、JS、manifest、source map、常见 open tracking 等静态或追踪资源。HTML 邮件优先提取可见锚点链接，不把图片-only 链接当作有效操作链接。

历史邮件可以重新计算结构化数据：

```bash
npm run backfill:structured
npm run backfill:structured -- --mailbox=user@example.com
```

## 本地 Viewer

`viewer/` 是本地调试页面，不需要部署到服务器。

直接用静态文件服务打开：

```bash
cd viewer
python3 -m http.server 5173
```

然后访问：

```text
http://127.0.0.1:5173
```

仓库内的 `viewer/config.js` 只保留安全默认值。真实 API 地址和 key 放到被 git 忽略的 `viewer/config.local.js`：

```js
export const DEFAULT_API_BASE = 'https://mail.example.com';
export const DEFAULT_API_KEY = 'replace-with-your-api-key';
```

Viewer 能力：

- 左列邮箱列表，包含 `All`。
- 中列邮件列表，最新优先。
- 右列邮件详情。
- 顶部筛选发件人、关键字和最新数量。
- 默认 5 秒自动刷新。
- 邮箱、验证码、结构化链接支持点击复制。
- 右上角 Settings 可切换默认 HTML/Text 正文渲染。
- HTML 正文在 sandbox iframe 中渲染，不允许脚本执行。

## 域名和反向代理

邮件投递需要 DNS：

```text
A   mail.example.com -> server-ip
MX  example.com      -> mail.example.com
```

HTTP API 可以放到 Caddy/Nginx 后面，例如把 `https://mail.example.com` 反代到 `http://127.0.0.1:3000`。如果使用反向代理，建议在代理层要求请求带有 API key header，同时后端仍然校验真实 key。

SMTP 不建议也不需要走 Caddy/Nginx。公网邮件投递只依赖 `MX` 和 `25/tcp`。

## 存储

邮件数据存储在 Postgres：

- `mailboxes`：自动创建的邮箱地址。
- `messages`：邮件正文、HTML、headers、附件元数据、结构化数据和原始内容。
- `recipient_allowlist`：允许收件的邮箱或域名。
- `api_keys`：API key 的 hash、label、active 状态和最近使用时间。

项目内 `./data` 只作为稳定运行时目录：

- 内置 Postgres 数据：`./data/postgres`。
- 应用挂载目录：`./data:/app/data`。
- 后续附件、导出或临时文件可继续复用该路径。

## 安全和隐私

- 生产环境必须设置足够长的 `API_KEY`。
- API key 支持多把 active key 并存；新增 key 不会自动禁用旧 key。
- 常规轮换应通过 `/api-keys` 新增，再逐步迁移调用方，最后禁用旧 key。
- 不要提交 `.env`、`data/`、`node_modules/`、`viewer/config.local.js`。
- 文档、示例、测试和 viewer 默认配置不要写入真实域名、API key、服务器地址、部署路径或个人账号信息。
- SMTP 收件白名单必须保持开启，避免服务变成开放收信入口。
- 邮件正文是外部不可信输入。服务端只解析并存储，不执行正文内容。
- 本地 Viewer 的 HTML 渲染使用 sandbox iframe，并禁止脚本执行。
- 如果公开 HTTP API，建议使用 HTTPS 和反向代理限流。

## 测试

运行单元测试：

```bash
npm test
```

检查 Viewer JavaScript 语法：

```bash
node --check viewer/*.js
```

当前测试覆盖：

- 配置读取。
- HTTP 鉴权、CORS 和路由行为。
- 邮件列表分页、筛选和时间戳解析。
- Postgres 存储接口逻辑。
- 收件白名单管理。
- 结构化验证码和链接提取。
- 历史结构化数据回填参数解析。

## 生产注意事项

Automail 的目标是轻量、直接、方便 AI 自动化接入。生产环境通常还需要根据实际风险补充：

- SPF、DKIM、DMARC 和邮件来源信誉策略。
- 垃圾邮件过滤和速率限制。
- 更细粒度的 API 权限隔离。
- 附件文件的独立存储和大小限制。
- 数据库备份、索引维护和保留周期。
- HTTP 反向代理的 HTTPS、访问日志和限流。
