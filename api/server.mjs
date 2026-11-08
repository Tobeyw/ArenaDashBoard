import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import Decimal from 'decimal.js';
import {createClerkClient} from '@clerk/backend';
import {range,within,day,sum,periodPnl,executionPerformance,activityMetrics,strategyPerformance} from './metrics.mjs';
import {createDashboardAuth} from './auth.mjs';
import {createAggregateCache} from './aggregate-cache.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,options:'-c default_transaction_read_only=on -c statement_timeout=15000',connectionTimeoutMillis:5000});
const auth=createDashboardAuth({password:process.env.DASHBOARD_PASSWORD,ttlSeconds:process.env.SESSION_TTL_SECONDS});
const exclusions=new Set((process.env.EXCLUDED_USER_IDS||'').split(',').filter(Boolean));
const loginAttempts=new Map();
let cached,pending,identityCache,identityPending;
const aggregateCache=createAggregateCache();
async function identities(){
 if(!process.env.CLERK_SECRET_KEY)return {status:'UNAVAILABLE',reason:'未配置 Clerk',users:[],asOf:null};
 if(identityCache&&Date.now()-identityCache.time<300000)return identityCache.data;
 if(identityPending)return identityPending;
 identityPending=(async()=>{
  try{
   const client=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});const users=[];
   for(let offset=0;offset<100000;offset+=100){
    const page=await client.users.getUserList({limit:100,offset,orderBy:'+created_at'});
    users.push(...page.data.map(u=>({id:u.id,email:u.emailAddresses.find(e=>e.id===u.primaryEmailAddressId)?.emailAddress||'',registeredAt:new Date(u.createdAt).toISOString(),name:[u.firstName,u.lastName].filter(Boolean).join(' ')})));
    if(users.length>=page.totalCount||page.data.length<100)break;
   }
   const data={status:'AVAILABLE',users,asOf:new Date().toISOString()};identityCache={time:Date.now(),data};return data;
  }catch{return {status:'UNAVAILABLE',reason:'Clerk 读取失败，请检查密钥、网络及实例权限',users:[],asOf:null};}
 })().finally(()=>identityPending=null);return identityPending;
}
async function snapshot(){
 if(cached&&Date.now()-cached.time<60000)return cached.data;
 if(pending)return pending;
 pending=(async()=>{
  const client=await pool.connect();const data={};
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const sql={
    users:'SELECT u.*, p."clerkRegisteredAt" FROM "User" u LEFT JOIN "PlatformAccess" p ON p."userId"=u.id',
    agents:'SELECT a.*, u."clerkUserId", c."modelIds", c."positionMethod",c."allocationMode",f."availableToBet",f."syncRequired" FROM "Agent" a JOIN "User" u ON u.id=a."ownerId" JOIN "AgentConfigSnapshot" c ON c.id=a."currentConfigSnapshotId" LEFT JOIN "AgentFunds" f ON f."agentId"=a.id',
    platform:'SELECT "clerkUserId","modelId" FROM "PlatformModelAccount"',
    bindings:'SELECT "clerkUserId","createdAt","verifiedAt" FROM "PredictBinding"',
    executions:'SELECT e.*, s."agentId",s."modelId",s."canonicalEventId",s.id AS "signalId",c."positionMethod",a.name AS "agentName",r."competitionName" AS competition,CASE WHEN r.id IS NULL THEN NULL ELSE r."homeTeamName" || \' vs \' || r."awayTeamName" END AS "fixtureName" FROM "ProviderExecutionEvent" e LEFT JOIN "Order" o ON o.id=e."orderId" LEFT JOIN "Signal" s ON s.id=o."signalId" LEFT JOIN "AgentConfigSnapshot" c ON c.id=s."configSnapshotId" LEFT JOIN "Agent" a ON a.id=s."agentId" LEFT JOIN "CatalogEventRevision" r ON r.id=s."catalogEventRevisionId" WHERE e.scope=\'USER\' ORDER BY e."executedAt",e."sourceEventKey"',
    orders:'SELECT o.id,o."signalId",o."ownerClerkUserId",o.state,o."failureReason",o."failureSummary",o."requestedStake",o."createdAt",o."submittedAt",o."completedAt",o."attemptNumber",s."agentId",s."modelId",s."canonicalEventId",c."positionMethod",a.name AS "agentName",r."competitionName" AS competition,CASE WHEN r.id IS NULL THEN NULL ELSE r."homeTeamName" || \' vs \' || r."awayTeamName" END AS "fixtureName" FROM "Order" o JOIN "Signal" s ON s.id=o."signalId" LEFT JOIN "AgentConfigSnapshot" c ON c.id=s."configSnapshotId" LEFT JOIN "Agent" a ON a.id=s."agentId" LEFT JOIN "CatalogEventRevision" r ON r.id=s."catalogEventRevisionId"',
    signals:'SELECT id,"agentId","ownerClerkUserId","modelId",decision,"reasonCode","reasonSummary","targetStake","decidedAt" FROM "Signal"',
    analyses:'SELECT id,"modelId",state,"failureReason","analysisAt","createdAt" FROM "SharedModelAnalysis"',
    tasks:'SELECT "taskType",status,count(*)::int AS count FROM "WorkerTask" GROUP BY "taskType",status',
    sync:'SELECT "ownerClerkUserId","lastSyncedAt","activityLastSyncedAt","lastError" FROM "ProviderExecutionSyncState" WHERE scope=\'USER\'',
    funds:'SELECT "ownerClerkUserId","agentId","availableToBet","syncRequired","updatedAt" FROM "AgentFunds"',
    allocated:'SELECT DISTINCT "ownerClerkUserId" FROM "AgentFundEntry" WHERE kind=\'ALLOCATE\' AND amount>0',
    reserved:'SELECT "ownerClerkUserId",sum(reserved)::text AS value FROM "AgentFundOrder" GROUP BY "ownerClerkUserId"',
    platformFunds:'SELECT p."modelId",p."initialCapital",p.status,latest."asOf",latest."cashBalance",latest."positionsValue",latest."accountValue",latest."totalPnl" FROM "PlatformModelAccount" p LEFT JOIN LATERAL (SELECT s."asOf",s."cashBalance",s."positionsValue",s."accountValue",s."totalPnl" FROM "PlatformModelPerformanceSnapshot" s WHERE s."accountId"=p.id ORDER BY s."asOf" DESC LIMIT 1) latest ON true',
    platformSnapshots:'SELECT p."modelId",s."asOf",s."totalPnl",s."accountValue" FROM "PlatformModelPerformanceSnapshot" s JOIN "PlatformModelAccount" p ON p.id=s."accountId" WHERE s."totalPnl" IS NOT NULL ORDER BY p."modelId",s."asOf"',
    platformDecisions:'SELECT d.id,d."modelId",d.decision,d."requestedStake",d."decidedAt",d."canonicalEventId",o.id AS "orderId",o.state AS "orderState",o."requestedStake" AS "orderRequestedStake",r."competitionName" AS competition,CASE WHEN r.id IS NULL THEN NULL ELSE r."homeTeamName" || \' vs \' || r."awayTeamName" END AS "fixtureName" FROM "PlatformModelDecision" d LEFT JOIN "PlatformOrder" o ON o."decisionId"=d.id LEFT JOIN "CatalogEventRevision" r ON r.id=d."catalogEventRevisionId"',
    platformExecutions:'SELECT e.*,a."modelId",d."canonicalEventId",r."competitionName" AS competition,CASE WHEN r.id IS NULL THEN NULL ELSE r."homeTeamName" || \' vs \' || r."awayTeamName" END AS "fixtureName" FROM "ProviderExecutionEvent" e JOIN "PlatformModelAccount" a ON a.id=e."platformModelAccountId" LEFT JOIN "PlatformOrder" o ON o.id=e."platformOrderId" LEFT JOIN "PlatformModelDecision" d ON d.id=o."decisionId" LEFT JOIN "CatalogEventRevision" r ON r.id=d."catalogEventRevisionId" WHERE e.scope=\'PLATFORM\' ORDER BY e."executedAt",e."sourceEventKey"'
   };
   for(const [key,query] of Object.entries(sql))data[key]=(await client.query(query)).rows;
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const official=new Set([...data.platform.map(x=>x.clerkUserId),...exclusions]);
  data.users=data.users.filter(x=>!official.has(x.clerkUserId));
  data.agents=data.agents.filter(x=>!official.has(x.clerkUserId));
  for(const k of ['executions','orders','signals','sync','funds','allocated','reserved'])data[k]=data[k].filter(x=>!official.has(x.ownerClerkUserId));
  data.bindings=data.bindings.filter(x=>!official.has(x.clerkUserId));
  data.official=official;data.asOf=new Date().toISOString();cached={time:Date.now(),data};return data;
 })().finally(()=>pending=null);return pending;
}
function trendRows(dates,r){
 if(!dates.size&&r.kind==='all')return [];
 const keys=[...dates.keys()].sort();
 const first=r.kind==='all'?keys[0]:day(r.from);
 const last=day(new Date(new Date(r.to).getTime()-1));
 const rows=[];
 for(let cursor=new Date(`${first}T00:00:00+08:00`);day(cursor)<=last;cursor=new Date(cursor.getTime()+86400000)){
  const dateKey=day(cursor),events=dates.get(dateKey)||[];
  rows.push({date:dateKey,volume:sum(events,x=>x.actualFilledValue),orders:new Set(events.map(x=>x.orderId).filter(Boolean)).size,users:new Set(events.map(x=>x.ownerClerkUserId)).size});
 }
 return rows;
}
function aggregate(d,identity,r,market=''){
 if(market)d={...d,executions:d.executions.filter(x=>x.competition===market),orders:d.orders.filter(x=>x.competition===market)};
 const trades=d.executions.filter(e=>e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId&&within(e.executedAt,r));
 const first=new Map();const last=new Map();
 for(const e of d.executions.filter(e=>e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId)){
  if(!first.has(e.ownerClerkUserId))first.set(e.ownerClerkUserId,e.executedAt);last.set(e.ownerClerkUserId,e.executedAt);
 }
 const clerk=identity.users.filter(x=>!d.official.has(x.id));
 const pnl=periodPnl(d.executions,r);
 const dates=new Map();for(const e of trades){const k=day(e.executedAt);if(!dates.has(k))dates.set(k,[]);dates.get(k).push(e);}
 const trend=trendRows(dates,r);
 for(const row of trend){const models=new Map();for(const trade of dates.get(row.date)||[]){if(!models.has(trade.modelId))models.set(trade.modelId,new Decimal(0));models.set(trade.modelId,models.get(trade.modelId).plus(trade.actualFilledValue||0));}row.models=[...models].map(([modelId,value])=>({modelId,value:value.toFixed()}));}
 const performance=executionPerformance(d.executions,r,trend.map(x=>x.date));
 for(const row of performance.daily){const models=new Map();for(const item of performance.dailyModels.filter(x=>x.date===row.date)){if(!models.has(item.modelId))models.set(item.modelId,new Decimal(0));models.set(item.modelId,models.get(item.modelId).plus(item.realizedPnl));}row.models=[...models].map(([modelId,realizedPnl])=>({modelId,realizedPnl:realizedPnl.toFixed()}));}
 for(const row of trend){const pnlRow=performance.daily.find(x=>x.date===row.date);row.realizedPnl=pnlRow?.realizedPnl||'0';}
 const userIds=new Set([...d.users.map(x=>x.clerkUserId),...clerk.map(x=>x.id)]);
 const cm=new Map(clerk.map(x=>[x.id,x]));const pm=new Map(d.users.map(x=>[x.clerkUserId,x]));
 const agentsByUser=Map.groupBy(d.agents,x=>x.clerkUserId),tradesByUser=Map.groupBy(trades,x=>x.ownerClerkUserId),boundUsers=new Set(d.bindings.map(x=>x.clerkUserId));
 const users=[...userIds].map(id=>{const c=cm.get(id),local=pm.get(id);const agents=agentsByUser.get(id)||[];return {id,email:c?.email||null,registeredAt:c?.registeredAt||local?.clerkRegisteredAt||null,identitySource:c?'Clerk':local?.clerkRegisteredAt?'PG 注册时间副本':'仅本地业务记录',agentCount:agents.length,live:agents.some(x=>x.liveEnabled),bound:boundUsers.has(id),firstTrade:first.get(id)||null,lastTrade:last.get(id)||null,volume:sum(tradesByUser.get(id)||[],x=>x.actualFilledValue)};});
 const activity=activityMetrics(d.executions,users,r,d.asOf);
 const periodOrders=d.orders.filter(x=>within(x.createdAt,r));
 const periodSignals=d.signals.filter(x=>within(x.decidedAt,r));
 const periodConfiguredUsers=new Set(d.agents.filter(x=>within(x.createdAt,r)).map(x=>x.clerkUserId));
 const buySignals=periodSignals.filter(x=>x.decision==='BUY');
 const terminal=periodOrders.filter(x=>['FILLED','FAILED'].includes(x.state));
 const platformFunds={accounts:d.platformFunds.length,initialCapital:sum(d.platformFunds,x=>x.initialCapital),cash:sum(d.platformFunds,x=>x.cashBalance),positions:sum(d.platformFunds,x=>x.positionsValue),accountValue:sum(d.platformFunds,x=>x.accountValue),pnl:sum(d.platformFunds,x=>x.totalPnl),asOf:d.platformFunds.map(x=>x.asOf).filter(Boolean).toSorted().at(-1)||null};
 const platformByModel=new Map(d.platformFunds.map(x=>[x.modelId,{modelId:x.modelId,initialCapital:x.initialCapital,cash:x.cashBalance,accountValue:x.accountValue,realizedPnl:x.totalPnl,asOf:x.asOf,decisions:0,buyDecisions:0,requestedStake:'0',placedOrders:0,filledOrders:0,failedOrders:0,filledValue:'0'}]));
 for(const decision of d.platformDecisions.filter(x=>within(x.decidedAt,r))){if(!platformByModel.has(decision.modelId))platformByModel.set(decision.modelId,{modelId:decision.modelId,initialCapital:null,cash:null,accountValue:null,realizedPnl:null,asOf:null,decisions:0,buyDecisions:0,requestedStake:'0',placedOrders:0,filledOrders:0,failedOrders:0,filledValue:'0'});const item=platformByModel.get(decision.modelId);item.decisions++;if(decision.decision==='BUY'){item.buyDecisions++;item.requestedStake=new Decimal(item.requestedStake).plus(decision.requestedStake||0).toFixed();}if(decision.orderId){item.placedOrders++;if(decision.orderState==='FILLED')item.filledOrders++;if(decision.orderState==='FAILED')item.failedOrders++;}}
 for(const execution of d.platformExecutions.filter(x=>within(x.executedAt,r)&&x.executionKind==='TRADE'&&x.side==='BUY')){const item=platformByModel.get(execution.modelId);if(item)item.filledValue=new Decimal(item.filledValue).plus(execution.actualFilledValue||0).toFixed();}
 const platformModels=[...platformByModel.values()].sort((a,b)=>Number(b.realizedPnl||0)-Number(a.realizedPnl||0));
 const platformDaily=[],platformDailyModels=[];let platformCumulative=new Decimal(0);
 for(const dateKey of trend.map(x=>x.date)){const endAt=new Date(`${dateKey}T00:00:00+08:00`);endAt.setTime(endAt.getTime()+86400000);const startAt=new Date(`${dateKey}T00:00:00+08:00`);let dailyPnl=new Decimal(0);for(const model of platformModels){const snapshots=d.platformSnapshots.filter(x=>x.modelId===model.modelId);const latestAt=time=>snapshots.filter(x=>new Date(x.asOf)<time).at(-1)?.totalPnl||'0';const value=new Decimal(latestAt(endAt)).minus(latestAt(startAt));dailyPnl=dailyPnl.plus(value);platformDailyModels.push({date:dateKey,modelId:model.modelId,realizedPnl:value.toFixed()});}platformCumulative=platformCumulative.plus(dailyPnl);platformDaily.push({date:dateKey,realizedPnl:dailyPnl.toFixed(),cumulativePnl:platformCumulative.toFixed()});}
 const platformBalances=trend.map(row=>{const endAt=new Date(`${row.date}T00:00:00+08:00`);endAt.setTime(endAt.getTime()+86400000);return {date:row.date,models:platformModels.map(model=>({modelId:model.modelId,value:d.platformSnapshots.filter(x=>x.modelId===model.modelId&&new Date(x.asOf)<endAt).at(-1)?.accountValue||model.initialCapital||'0'}))};});platformFunds.analytics={daily:platformDaily,dailyModels:platformDailyModels,balances:platformBalances};
 const matchMap=new Map();
 for(const order of periodOrders){const eventId=order.canonicalEventId||`order:${order.id}`;if(!matchMap.has(eventId))matchMap.set(eventId,{eventId,competition:order.competition||null,fixtureName:order.fixtureName||null,userIds:new Set(),strategies:new Set(),models:new Set(),orderAttempts:0,filledOrders:0,failedOrders:0,requestedStake:new Decimal(0),filledValue:new Decimal(0),realizedPnl:new Decimal(0)});const item=matchMap.get(eventId);item.orderAttempts++;item.userIds.add(order.ownerClerkUserId);if(order.positionMethod)item.strategies.add(order.positionMethod);if(order.modelId)item.models.add(order.modelId);item.requestedStake=item.requestedStake.plus(order.requestedStake||0);if(order.state==='FILLED')item.filledOrders++;if(order.state==='FAILED')item.failedOrders++;}
 for(const detail of performance.details){if(!matchMap.has(detail.eventId))matchMap.set(detail.eventId,{eventId:detail.eventId,competition:detail.competition||null,fixtureName:detail.fixtureName||null,userIds:new Set(),strategies:new Set(),models:new Set(),orderAttempts:0,filledOrders:0,failedOrders:0,requestedStake:new Decimal(0),filledValue:new Decimal(0),realizedPnl:new Decimal(0)});const item=matchMap.get(detail.eventId);detail.userIds.forEach(x=>item.userIds.add(x));if(detail.modelId)item.models.add(detail.modelId);item.filledValue=item.filledValue.plus(detail.buyValue);item.realizedPnl=item.realizedPnl.plus(detail.realizedPnl);}
 const matchPerformance=[...matchMap.values()].map(x=>({...x,userCount:x.userIds.size,strategies:[...x.strategies],models:[...x.models],requestedStake:x.requestedStake.toFixed(),filledValue:x.filledValue.toFixed(),realizedPnl:x.realizedPnl.toFixed()})).sort((a,b)=>Number(b.filledValue)-Number(a.filledValue));
 const marketPnlMap=new Map();for(const item of performance.details){const marketName=item.competition||'未分类市场';marketPnlMap.set(marketName,(marketPnlMap.get(marketName)||new Decimal(0)).plus(item.realizedPnl||0));}const marketPnl=[...marketPnlMap].map(([market,value])=>({market,realizedPnl:value.toFixed()})).sort((a,b)=>new Decimal(b.realizedPnl).abs().minus(new Decimal(a.realizedPnl).abs()).toNumber());
 const buyExecutionsByOrder=Map.groupBy(d.executions.filter(x=>x.executionKind==='TRADE'&&x.side==='BUY'),x=>x.orderId);
 const quality={sourceLabel:process.env.DATA_SOURCE_LABEL||'PostgreSQL',pgReadAt:d.asOf,clerkStatus:identity.status,clerkReason:identity.reason,clerkReadAt:identity.asOf,localUsers:d.users.length,clerkUsers:identity.status==='AVAILABLE'?clerk.length:null,clerkWithoutLocal:identity.status==='AVAILABLE'?clerk.filter(x=>!pm.has(x.id)).length:null,localWithoutClerk:identity.status==='AVAILABLE'?d.users.filter(x=>!cm.has(x.clerkUserId)).length:null,firstExecution:d.executions[0]?.executedAt||null,lastExecution:d.executions.at(-1)?.executedAt||null,unattributed:d.executions.filter(x=>x.attributionStatus==='UNATTRIBUTED').length,conflicts:d.executions.filter(x=>x.attributionStatus==='CONFLICT').length,syncErrors:d.sync.filter(x=>x.lastError).length,sync:d.sync,notes:['当前状态指标不随日期回溯','首次成交与留存仅基于已收录历史','PG 为独立数据源；本地快照不会自动同步生产','Clerk 与 PG 时间点不同，用户差异不等同于同步故障']};
 return {range:r,quality,activity,summary:{registered:identity.status==='AVAILABLE'?clerk.length:null,newRegistered:identity.status==='AVAILABLE'?clerk.filter(x=>within(x.registeredAt,r)).length:null,configured:new Set(d.agents.map(x=>x.clerkUserId)).size,periodConfigured:periodConfiguredUsers.size,liveUsers:new Set(d.agents.filter(x=>x.liveEnabled).map(x=>x.clerkUserId)).size,tradingUsers:first.size,firstTraders:[...first.values()].filter(x=>within(x,r)).length,periodTraders:new Set(trades.map(x=>x.ownerClerkUserId)).size,volume:sum(trades,x=>x.actualFilledValue),buys:sum(trades.filter(x=>x.side==='BUY'),x=>x.actualFilledValue),sells:sum(trades.filter(x=>x.side==='SELL'),x=>x.actualFilledValue),orders:new Set(trades.map(x=>x.orderId).filter(Boolean)).size,matches:trades.length,agents:d.agents.length,liveAgents:d.agents.filter(x=>x.liveEnabled).length,modelSelections:d.agents.reduce((n,x)=>n+(Array.isArray(x.modelIds)?x.modelIds.length:0),0),bound:d.bindings.length,allocated:d.allocated.length,available:sum(d.funds,x=>x.availableToBet),reserved:sum(d.reserved,x=>x.value),fundSyncRequired:d.funds.filter(x=>x.syncRequired).length,orderAttempts:periodOrders.length,filledOrders:terminal.filter(x=>x.state==='FILLED').length,failedOrders:terminal.filter(x=>x.state==='FAILED').length,signals:periodSignals.length,buySignals:buySignals.length,noTradeSignals:periodSignals.filter(x=>x.decision==='NO_TRADE').length,signalUsers:new Set(periodSignals.map(x=>x.ownerClerkUserId)).size,buySignalUsers:new Set(buySignals.map(x=>x.ownerClerkUserId)).size,plannedStake:sum(buySignals,x=>x.targetStake)},pnl,marketPnl,platformFunds,platformModels,platformPerformance:{daily:platformDaily,dailyModels:platformDailyModels},performance,matchPerformance,trend,users,agents:d.agents,orders:periodOrders.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(o=>({...o,filledValue:sum(buyExecutionsByOrder.get(o.id)||[],x=>x.actualFilledValue)})),executions:trades,signals:periodSignals,analyses:d.analyses.filter(x=>within(x.createdAt,r)),tasks:d.tasks};
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function clientAddress(req){return String(req.socket.remoteAddress||'unknown');}
function loginAllowed(req){const key=clientAddress(req),now=Date.now();const attempts=(loginAttempts.get(key)||[]).filter(time=>now-time<10*60_000);loginAttempts.set(key,attempts);return attempts.length<5;}
function recordLoginFailure(req){const key=clientAddress(req);loginAttempts.set(key,[...(loginAttempts.get(key)||[]),Date.now()]);}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
async function staticFile(res,file){const contents=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('css')?'text/css':'text/javascript','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(contents);}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 try{
  if(url.pathname==='/api/health'){await pool.query('SELECT 1');return send(res,200,{status:'ok'});}
  if(req.method==='GET'&&url.pathname==='/login')return staticFile(res,'login.html');
  if(req.method==='GET'&&url.pathname==='/login.js')return staticFile(res,'login.js');
  if(req.method==='GET'&&url.pathname==='/login.css')return staticFile(res,'login.css');
  if(req.method==='GET'&&url.pathname==='/style.css')return staticFile(res,'style.css');
  if(req.method==='POST'&&url.pathname==='/auth/login'){
   if(!loginAllowed(req))return send(res,429,{error:'尝试次数过多，请 10 分钟后再试'});
   let input;try{input=await body(req);}catch{return send(res,400,{error:'请求格式无效'});}
   if(!auth.verifyPassword(input.password)){recordLoginFailure(req);return send(res,401,{error:'密码错误'});}
   loginAttempts.delete(clientAddress(req));res.setHeader('Set-Cookie',auth.sessionCookie(req));return send(res,200,{ok:true});
  }
  if(req.method==='POST'&&url.pathname==='/auth/logout'){res.setHeader('Set-Cookie',auth.clearCookie(req));return send(res,200,{ok:true});}
  if(!auth.isAuthenticated(req)){
   if(url.pathname.startsWith('/api/'))return send(res,401,{error:'请先登录'});
   const returnTo=url.pathname==='/'?'/':url.pathname;res.writeHead(302,{Location:`/login?returnTo=${encodeURIComponent(returnTo)}`,'Cache-Control':'no-store'});return res.end();
  }
  if(req.method!=='GET')return send(res,405,{error:'不支持此请求方法'});
  if(url.pathname.startsWith('/api/')){
   let r;try{r=range(url.searchParams);}catch(e){return send(res,400,{error:e.message});}
   const name=url.pathname.slice(5);if(!['activity','overview','users','agents','orders','executions','signals','analyses','funds','events','quality'].includes(name))return send(res,404,{error:'接口不存在'});
   const [d,c]=await Promise.all([snapshot(),identities()]);const market=url.searchParams.get('market')||'';const markets=[...new Set([...d.executions,...d.orders].map(x=>x.competition).filter(Boolean))].sort();const result=aggregateCache.get(d,c,r,market,()=>aggregate(d,c,r,market));
   if(name==='overview')return send(res,200,{range:r,market,markets,summary:result.summary,pnl:{...result.pnl,users:undefined},trend:result.trend,modelBreakdown:{volume:result.trend,pnl:result.performance.dailyModels},performance:{daily:result.performance.daily,models:result.performance.models},quality:result.quality});
   if(name==='activity')return send(res,200,{...result.activity,trend:result.trend,summary:result.summary});
   if(name==='quality')return send(res,200,{...result.quality,tasks:result.tasks});
   if(name==='events'){
    const modelIds=[...new Set([...d.agents.flatMap(x=>Array.isArray(x.modelIds)?x.modelIds:[]),...d.platform.map(x=>x.modelId),...d.signals.map(x=>x.modelId),...d.executions.map(x=>x.modelId)].filter(Boolean))].sort();
    const items=result.matchPerformance.map(event=>{
     const executions=result.executions.filter(e=>e.canonicalEventId===event.eventId);
     const all=d.executions.filter(e=>e.canonicalEventId===event.eventId&&e.attributionStatus==='ATTRIBUTED'&&e.agentId&&within(e.executedAt,r));
     const grouped=Map.groupBy(result.performance.details.filter(x=>x.eventId===event.eventId),x=>x.modelId);
     const models=[...grouped].map(([modelId,rows])=>({modelId,buyValue:sum(rows,x=>x.buyValue),realizedPnl:sum(rows,x=>x.realizedPnl),returnValue:sum(all.filter(x=>x.modelId===modelId&&(x.side==='SELL'||x.executionKind==='SETTLEMENT')),x=>x.actualFilledValue)})).sort((a,b)=>Number(b.realizedPnl)-Number(a.realizedPnl));
     return {...event,activityDate:executions[0]?.executedAt||null,returnValue:sum(all.filter(x=>x.side==='SELL'||x.executionKind==='SETTLEMENT'),x=>x.actualFilledValue),modelDetails:modelIds.map(modelId=>models.find(m=>m.modelId===modelId)||{modelId,buyValue:'0',returnValue:'0',realizedPnl:'0'}),bestModel:models[0]?.modelId||null,worstModel:models.at(-1)?.modelId||null};
    });return send(res,200,{items,markets,range:r});
   }
   if(name==='funds')return send(res,200,{market,markets,summary:result.summary,pnl:result.pnl,marketPnl:result.marketPnl,platformFunds:result.platformFunds,platformModels:result.platformModels,platformPerformance:result.platformPerformance,performance:result.performance,range:r});
   let rows=result[name];const owner=url.searchParams.get('owner');if(owner)rows=rows.filter(x=>(x.ownerClerkUserId??x.clerkUserId??x.id)===owner);const q=(url.searchParams.get('q')||'').toLowerCase().slice(0,200);const state=url.searchParams.get('status');
   if(q)rows=rows.filter(x=>Object.values(x).some(v=>typeof v==='string'&&v.toLowerCase().includes(q)));
   if(state)rows=rows.filter(x=>String(x.state??x.decision??x.liveEnabled)===state);
   const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20);
   if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)return send(res,400,{error:'分页参数无效'});
   send(res,200,{items:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,asOf:d.asOf,range:r,...(name==='agents'?{markets,modelPerformance:result.performance.models,platformModels:result.platformModels}:{}),...(name==='orders'?{matchPerformance:result.matchPerformance,markets,strategyPerformance:strategyPerformance(d.orders,d.executions,r,market)}:{})});return;
  }
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[url.pathname];
  if(!file)return send(res,404,{error:'页面不存在'});
  return staticFile(res,file);
 }catch(e){console.error('Request failed:',e.code||e.name);send(res,503,{error:'数据源暂时不可用，请检查 PostgreSQL 连接和服务配置'});}
});
server.listen(Number(process.env.PORT||4310),process.env.HOST||'127.0.0.1',()=>console.log(`Arena Dashboard: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||4310}`));
process.on('SIGTERM',()=>server.close(()=>pool.end()));
