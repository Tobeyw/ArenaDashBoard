# Arena Dashboard

独立、只读的 Arena 运营看板。Node.js 同时提供页面和 `/api/*`，不依赖交易服务进程。默认监听 `127.0.0.1:4310`，按需求无应用层鉴权，勿直接暴露公网。

## 启动

Node.js >= 22.18（推荐当前本机 Node 26）。

```sh
npm install
cp .env.example .env # 首次手工配置；已配置环境不要覆盖
npm start
```

数据库连接和 Clerk 密钥仅存于被 Git 忽略的 `.env`。数据库连接强制只读事务、15 秒查询超时，连接池最多 3 个连接。生产使用专用只读角色。当前指向独立本地快照，不会随生产自动更新。Clerk 为实时源，缓存 5 分钟，PG 缓存 1 分钟。刷新按钮重新请求缓存，不强制上游全量重扫。

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
