# Arena Dashboard

独立、只读的 Arena 运营看板。Node.js 同时提供页面和 `/api/*`，不依赖交易服务进程。默认监听 `127.0.0.1:4310`，页面与 API 均需密码会话鉴权。

## 启动

Node.js >= 22.18（推荐当前本机 Node 26）。

```sh
npm install
cp .env.example .env # 首次手工配置；已配置环境不要覆盖
npm start
```

数据库连接、Clerk 密钥和 `DASHBOARD_PASSWORD` 仅存于被 Git 忽略的 `.env`。访问密码至少 12 个字符；登录会话默认 12 小时，修改密码并重启服务后旧会话立即失效。除 `/api/health` 外，页面和 API 均要求登录。数据库连接强制只读事务、15 秒查询超时，连接池最多 3 个连接。生产使用专用只读角色。当前指向独立本地快照，不会随生产自动更新。Clerk 为实时源，缓存 5 分钟，PG 缓存 1 分钟。刷新按钮重新请求缓存，不强制上游全量重扫。

## 改版状态

新版首页已使用 `/api/operations`。实施范围、数据缺口和未完成验收项见 [改版记录](docs/redesign-status.md)，目前不能视为产品需求全量验收通过。

## 接口

GET `/api/overview`, `/api/users`, `/api/agents`, `/api/orders`, `/api/executions`, `/api/signals`, `/api/analyses`, `/api/funds`, `/api/quality`, `/api/health`。

通用参数 `range=today|7d|30d|all|custom`；custom 提供北京时间 `from=YYYY-MM-DD&to=YYYY-MM-DD`（结束日期包含当天）。明细支持 `q`, `page`, `pageSize`（1–100）, `status`。金额以十进制字符串返回。只接受 GET；不开放 CORS。

## 指标边界

- 注册：Clerk 当前存在账号，排除 PG 平台模型身份及 EXCLUDED_USER_IDS；不包含已注销历史。Clerk 不可用返回 null。
- 配置/Live/绑定/资金：当前状态，不提供历史回溯。
- 交易：USER scope，已归属且能关联 Agent 的 TRADE，按 executedAt 筛选，排除 SETTLEMENT；订单按本地 orderId 去重，重试尝试在订单明细独立保留。撮合按数据库唯一 sourceEventKey。
- 订单列表按创建时间筛选，累计成交额与首页期间成交额不同。
- 期间已实现盈亏：按账户从全历史重放，期末累计已实现值减去期初累计值。复用原项目 `execution-pnl.ts` 成本算法（独立 vendored 版本，Decimal 替换 Prisma.Decimal），不读取实时持仓估值。改动原项目规则后须同步核验。
- 归属冲突、未知费用、缺少开仓成本的账户不计总值，仍显示 PARTIAL 诊断值。所有盈亏标记 PARTIAL，因为现有表无法证明全历史回填完成；RECORDED 仅代表已收录证据可计算。缺失估值不影响已实现计算，但不提供浮盈。
- 页面不提供无数据依据的访问活跃、历史配置转化、历史删除、Live 关闭原因、完整资金关系和预计赎回金额。任务仅展示现存记录，不推断应执行分母。
- Clerk 与 PG 快照时间不同，身份差异仅供排查。

## 验证

`npm test` 测试时区边界、跨期间成本、缺失费用和金额精度。`npm run check` 检查服务与页面脚本语法。

## Docker deployment

Requires Docker Engine and Compose v2 supporting `up --wait`.

```sh
cp .env.docker.example .env.production
# Edit .env.production: set the production read-only PG URL and Clerk key.
chmod 600 .env.production
./scripts/docker.sh check .env.production
./scripts/docker.sh start .env.production
```

Open http://127.0.0.1:4310. Frontend and API run in the same container.

```sh
./scripts/docker.sh status .env.production
./scripts/docker.sh logs .env.production
./scripts/docker.sh restart .env.production
./scripts/docker.sh stop .env.production
```

`restart` rebuilds and recreates the container, applying new code and environment values. The script defaults to `.env` when no env-file argument is supplied. It never stops unrelated processes or deletes databases.

For a remote server, use an SSH tunnel:

```sh
ssh -N -L 4310:127.0.0.1:4310 USER@SERVER
```

- The image does not contain credentials. Compose injects environment variables at runtime; no `.env` mount is needed.
- Do not use the local backup URL unchanged: `127.0.0.1` inside a container points to the container itself. For PG on the Docker host, use `host.docker.internal`; PG must listen on a reachable address and allow the container network with a read-only role. For a remote PG instance, use its private hostname/IP.
- Container HOST/PORT are fixed to `0.0.0.0:4310`. Host binding defaults to `127.0.0.1:4310`; application pages and APIs require the configured password session.
- If 4310 is already occupied locally, set DASHBOARD_PORT=4311. Existing local processes are not stopped by the script.
- Node 24, non-root user, read-only filesystem, bounded log rotation. Health checks verify PG connectivity; Clerk failures are shown separately in the UI.
- `check` validates Compose syntax only. `start` waits for database health. Docker restarts exited containers, but an unhealthy status alone does not trigger a restart.

### Platform daily cash balance

The model PnL chart uses the original daily series: each model's last recorded cashBalance snapshot on each Beijing calendar date, before the selected period end. A date without a snapshot remains null and breaks the line. It uses the existing platformSnapshots source, which includes snapshots with non-null totalPnl. It does not apply the performance API's rolling window, strategy-version roster, or intraday sampling. Cash excludes position value and does not deduct open-order reservations.

Platform order direction uses the decision's canonical outcome and YES/NO side; missing directions are labelled unknown. Single-event kickoff times use the latest recorded CatalogEventRevision and display in Asia/Shanghai.
