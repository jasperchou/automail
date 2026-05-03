# Simple Mail Service

一个最小可用的邮件接收服务：

- 收到投递到白名单邮箱或域名下的邮件时，自动创建该邮箱并存储邮件
- SMTP 只接收白名单邮箱或域名下的收件人，避免被外部扫描器滥用
- 提供简单 HTTP 接口，按邮箱拉取邮件列表和邮件详情
- 先用本地端口跑通，后续你把域名 `MX` 指到这台机器即可

## 功能

- SMTP 收信
- 自动创建邮箱
- 收件白名单
- Postgres 存储
- HTTP 查询接口
- 本地查看器默认纯文本展示邮件正文，避免执行或加载不可信 HTML 内容

## 启动

```bash
npm install
npm start
```

项目根目录支持本地 `.env` 配置，适合测试环境。

默认端口：

- `SMTP_PORT=2525`
- `HTTP_PORT=3000`
- `API_KEY=` 留空时不校验，设置后接口需要带 key
- `ALLOWED_RECIPIENTS=` 逗号分隔的允许收件邮箱或域名
- `DATABASE_URL=` Postgres 连接串
- `DATA_DIR=./data` 项目内固定数据目录

也可以自定义：

```bash
SMTP_PORT=25 HTTP_PORT=3000 API_KEY=your-secret-key DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/mail_service npm start
```

如果你用本地 `.env`，直接写：

```env
HTTP_PORT=3000
SMTP_PORT=2525
API_KEY=your-secret-key
ALLOWED_RECIPIENTS=berich.xyz,mail.berich.xyz
DATA_DIR=./data
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/mail_service
```

## 容器

优先复用你已有的 Postgres。

只启动应用容器，连接外部或已有数据库：

```bash
./scripts/deploy.sh
```

如果本地没有可复用的 Postgres，再额外带上数据库：

```bash
./scripts/deploy.sh --with-postgres
```

容器方案说明：

- `compose.yml` 只定义应用服务，适合复用已有数据库
- `compose.postgres.yml` 是可选覆盖层，只在你需要本地 Postgres 时再启
- Postgres 数据固定挂到项目内 `./data/postgres`
- 应用保留 `./data:/app/data` 挂载，便于后续附件或导出文件复用
- 宿主机端口和容器内监听端口分开配置
- 默认宿主机 SMTP 暴露 `25`，容器内仍监听 `2525`

常用命令：

```bash
./scripts/deploy.sh
./scripts/deploy.sh --with-postgres
./scripts/logs.sh
docker compose ps
docker compose restart app
```

## 服务器部署

最省事的部署方式就是直接用 Docker Compose。

### 便捷部署

如果服务器上已经有可复用的 Postgres，直接执行：

```bash
git clone git@github.com:jasperchou/automail.git
cd automail
cp .env.example .env
vi .env
./scripts/deploy.sh
```

最少需要改这些配置：

```env
HTTP_PORT=3000
SMTP_PORT=2525
HTTP_BIND_PORT=3000
SMTP_BIND_PORT=25
API_KEY=replace-with-a-long-random-string
ALLOWED_RECIPIENTS=berich.xyz,mail.berich.xyz
DATA_DIR=./data
DATABASE_URL=postgres://postgres:strong-password@your-postgres-host:5432/mail_service
```

如果服务器上没有可复用的 Postgres，直接执行：

```bash
git clone git@github.com:jasperchou/automail.git
cd automail
cp .env.example .env
vi .env
./scripts/deploy.sh --with-postgres
```

部署后检查：

```bash
docker compose ps
./scripts/logs.sh
curl http://127.0.0.1:3000/health
```

这两种模式的区别：

- `./scripts/deploy.sh`：只起应用，复用现有 Postgres
- `./scripts/deploy.sh --with-postgres`：应用和 Postgres 一起起
- 如果带项目内 Postgres，数据库数据会落在 `data/postgres`

如果要复用另一个 Docker Compose 项目里的 Postgres，并且它没有暴露宿主机端口，可以让应用加入那个项目的 Docker 网络：

```env
DATABASE_URL=postgres://user:password@postgres:5432/automail
EXTERNAL_DOCKER_NETWORK=sub2api-deploy_sub2api-network
```

启动时带上外部网络覆盖文件：

```bash
docker compose -f compose.yml -f compose.external-network.yml up -d --build app
```

1. 安装 Docker 和 Docker Compose
2. 拉代码到服务器
3. 复制 `.env.example` 为 `.env`
4. 改好 `API_KEY`、`DATABASE_URL`、端口
5. 启动容器
6. 配域名 `A` 和 `MX`

示例：

```bash
git clone git@github.com:jasperchou/automail.git
cd automail
cp .env.example .env
./scripts/deploy.sh
```

如果服务器上没有可复用的 Postgres：

```bash
./scripts/deploy.sh --with-postgres
```

推荐服务器 `.env` 至少这样改：

```env
HTTP_PORT=3000
SMTP_PORT=2525
HTTP_BIND_PORT=3000
SMTP_BIND_PORT=25
API_KEY=replace-with-a-long-random-string
ALLOWED_RECIPIENTS=berich.xyz,mail.berich.xyz
DATA_DIR=./data
DATABASE_URL=postgres://postgres:strong-password@your-postgres-host:5432/mail_service
```

如果你使用项目自带 Postgres 容器，`DATABASE_URL` 不用手动改，override 文件会自动把应用指向容器里的 `postgres` 服务。

服务器上线前要确认：

- 安全组或防火墙放行 `25/tcp`
- 如果要直接开放接口，也放行 `3000/tcp`，或者挂到反向代理后面
- 域名 `A` 记录指向服务器 IP
- 域名 `MX` 记录指向收邮件主机名，比如 `mail.example.com`
- 你的云厂商没有拦截入站 `25`

## 接口

健康检查：

```bash
curl http://127.0.0.1:3000/health
```

查看已有邮箱：

```bash
curl -H "x-api-key: your-secret-key" http://127.0.0.1:3000/mailboxes
```

查看收件白名单：

```bash
curl -H "x-api-key: your-secret-key" http://127.0.0.1:3000/allowlist
```

添加允许收件域名或邮箱：

```bash
curl -X POST \
  -H "x-api-key: your-secret-key" \
  -H "content-type: application/json" \
  -d '{"entry":"berich.xyz"}' \
  http://127.0.0.1:3000/allowlist
```

删除白名单条目：

```bash
curl -X DELETE \
  -H "x-api-key: your-secret-key" \
  "http://127.0.0.1:3000/allowlist?entry=berich.xyz"
```

白名单说明：

- 条目可以是完整邮箱，例如 `jasper@mail.berich.xyz`
- 条目也可以是域名，例如 `mail.berich.xyz` 或 `berich.xyz`
- SMTP 在 `RCPT TO` 阶段拒绝非白名单收件人，拒收邮件不会入库

按邮箱查看邮件列表：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages?mailbox=test@example.com"
```

按最新 N 条拉取：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages?mailbox=test@example.com&limit=10"
```

分页拉取：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages?mailbox=test@example.com&limit=20&offset=20"
```

按发件人筛选：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages?mailbox=test@example.com&sender=alice@example.com"
```

按关键字筛选标题或正文：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages?mailbox=test@example.com&keyword=invoice"
```

按入库时间戳筛选：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages?mailbox=test@example.com&since=1714708800&until=1714795200"
```

说明：

- `since` / `until` 都是 Unix 时间戳
- 支持秒级时间戳，例如 `1714708800`
- 也支持毫秒级时间戳，例如 `1714708800000`

查看某封邮件详情：

```bash
curl -H "x-api-key: your-secret-key" "http://127.0.0.1:3000/messages/<message-id>?mailbox=test@example.com"
```

也支持 query 传参：

```bash
curl "http://127.0.0.1:3000/messages?mailbox=test@example.com&api_key=your-secret-key"
```

## 本地测试收信

如果你本地先不走真实域名，可以直接往 2525 发一封测试邮件：

```bash
curl --url smtp://127.0.0.1:2525 \
  --mail-from sender@demo.com \
  --mail-rcpt test@example.com \
  -T <(printf "From: sender@demo.com\nTo: test@example.com\nSubject: hello\n\nthis is a test mail\n")
```

然后拉取：

```bash
curl "http://127.0.0.1:3000/messages?mailbox=test@example.com"
```

## 域名配置

后面你有域名后，需要做这几件事：

1. 给邮件服务器准备一台公网机器，开放 SMTP 端口，通常是 `25`
2. 把域名的 `MX` 记录指向这台机器，例如 `mail.yourdomain.com`
3. 给 `mail.yourdomain.com` 配置 `A` 记录
4. 服务启动在公网可访问地址上

例如：

- `A`: `mail.example.com -> 你的服务器 IP`
- `MX`: `example.com -> mail.example.com`

## 存储说明

邮件内容现在存到 Postgres，不再存本地 JSON 文件。

本地和服务器都通过 `DATABASE_URL` 连接数据库，例如：

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/mail_service
```

项目里的 `data/` 目录保留为可挂载持久化目录，默认路径是：

```text
./data
```

建议固定用它来挂：

- Postgres 数据卷目录
- 后续附件文件目录
- 运行时导出文件

## 内容安全

投递进来的邮件内容按不可信输入处理：

- 服务端只用 `mailparser` 解析邮件并写入 Postgres，不会 `eval` 或执行邮件正文。
- SMTP 在 `RCPT TO` 阶段执行收件白名单校验，非白名单收件人会被拒收，不会入库。
- 结构化数据提取只做正则和字符串处理，内置提取六位验证码和用户可能需要点击的链接。
- 本地查看器不直接渲染邮件 HTML，详情正文默认显示纯文本；可点击链接来自后端结构化提取结果。

如果你使用项目自带的 Postgres 容器，数据库文件会在：

```text
data/postgres
```

每封邮件在数据库里包含：

- 发件人/收件人
- 标题
- 文本内容
- HTML 内容
- 附件元数据
- 原始 RFC822 邮件内容

## 测试

运行单元测试：

```bash
npm test
```

当前测试覆盖：

- `.env` 配置读取
- 文件存储与邮件落盘
- HTTP 鉴权
- 邮件列表分页与筛选
- 邮件详情接口行为

## 注意

这是一个简单版本，适合内部工具、测试环境或者最小业务原型。

生产环境通常还要补：

- 垃圾邮件过滤
- SPF / DKIM / DMARC
- TLS
- 更严格的鉴权和权限隔离
- 附件文件单独存储
- 数据库索引与分页
