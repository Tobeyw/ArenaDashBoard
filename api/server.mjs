import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {createClerkClient} from '@clerk/backend';
import {range,within,day,sum,periodPnl,activityMetrics} from './metrics.mjs';
import {createDashboardAuth} from './auth.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,options:'-c default_transaction_read_only=on -c statement_timeout=15000',connectionTimeoutMillis:5000});
const auth=createDashboardAuth({password:process.env.DASHBOARD_PASSWORD,ttlSeconds:process.env.SESSION_TTL_SECONDS});
const exclusions=new Set((process.env.EXCLUDED_USER_IDS||'').split(',').filter(Boolean));
const loginAttempts=new Map();
let cached,pending,identityCache,identityPending;
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
    executions:'SELECT e.*, s."agentId",s."modelId",s."canonicalEventId",s.id AS "signalId" FROM "ProviderExecutionEvent" e LEFT JOIN "Order" o ON o.id=e."orderId" LEFT JOIN "Signal" s ON s.id=o."signalId" WHERE e.scope=\'USER\' ORDER BY e."executedAt",e."sourceEventKey"',
    orders:'SELECT o.id,o."signalId",o."ownerClerkUserId",o.state,o."failureReason",o."failureSummary",o."requestedStake",o."createdAt",o."submittedAt",o."completedAt",o."attemptNumber",s."agentId",s."modelId" FROM "Order" o JOIN "Signal" s ON s.id=o."signalId"',
    signals:'SELECT id,"agentId","ownerClerkUserId","modelId",decision,"reasonCode","reasonSummary","targetStake","decidedAt" FROM "Signal"',
    analyses:'SELECT id,"modelId",state,"failureReason","analysisAt","createdAt" FROM "SharedModelAnalysis"',
    tasks:'SELECT "taskType",status,count(*)::int AS count FROM "WorkerTask" GROUP BY "taskType",status',
    sync:'SELECT "ownerClerkUserId","lastSyncedAt","activityLastSyncedAt","lastError" FROM "ProviderExecutionSyncState" WHERE scope=\'USER\'',
    funds:'SELECT "ownerClerkUserId","agentId","availableToBet","syncRequired","updatedAt" FROM "AgentFunds"',
    allocated:'SELECT DISTINCT "ownerClerkUserId" FROM "AgentFundEntry" WHERE kind=\'ALLOCATE\' AND amount>0',
    reserved:'SELECT "ownerClerkUserId",sum(reserved)::text AS value FROM "AgentFundOrder" GROUP BY "ownerClerkUserId"'
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
function aggregate(d,identity,r){
 const trades=d.executions.filter(e=>e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId&&within(e.executedAt,r));
 const first=new Map();const last=new Map();
 for(const e of d.executions.filter(e=>e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId)){
  if(!first.has(e.ownerClerkUserId))first.set(e.ownerClerkUserId,e.executedAt);last.set(e.ownerClerkUserId,e.executedAt);
 }
 const clerk=identity.users.filter(x=>!d.official.has(x.id));
 const pnl=periodPnl(d.executions,r);
 const dates=new Map();for(const e of trades){const k=day(e.executedAt);if(!dates.has(k))dates.set(k,[]);dates.get(k).push(e);}
 const userIds=new Set([...d.users.map(x=>x.clerkUserId),...clerk.map(x=>x.id)]);
 const cm=new Map(clerk.map(x=>[x.id,x]));const pm=new Map(d.users.map(x=>[x.clerkUserId,x]));
 const users=[...userIds].map(id=>{const c=cm.get(id),local=pm.get(id);const agents=d.agents.filter(x=>x.clerkUserId===id);return {id,email:c?.email||null,registeredAt:c?.registeredAt||local?.clerkRegisteredAt||null,identitySource:c?'Clerk':local?.clerkRegisteredAt?'PG 注册时间副本':'仅本地业务记录',agentCount:agents.length,live:agents.some(x=>x.liveEnabled),bound:d.bindings.some(x=>x.clerkUserId===id),firstTrade:first.get(id)||null,lastTrade:last.get(id)||null,volume:sum(trades.filter(x=>x.ownerClerkUserId===id),x=>x.actualFilledValue)};});
 const activity=activityMetrics(d.executions,users,r,d.asOf);
 const terminal=d.orders.filter(x=>['FILLED','FAILED'].includes(x.state)&&within(x.createdAt,r));
 const quality={sourceLabel:process.env.DATA_SOURCE_LABEL||'PostgreSQL',pgReadAt:d.asOf,clerkStatus:identity.status,clerkReason:identity.reason,clerkReadAt:identity.asOf,localUsers:d.users.length,clerkUsers:identity.status==='AVAILABLE'?clerk.length:null,clerkWithoutLocal:identity.status==='AVAILABLE'?clerk.filter(x=>!pm.has(x.id)).length:null,localWithoutClerk:identity.status==='AVAILABLE'?d.users.filter(x=>!cm.has(x.clerkUserId)).length:null,firstExecution:d.executions[0]?.executedAt||null,lastExecution:d.executions.at(-1)?.executedAt||null,unattributed:d.executions.filter(x=>x.attributionStatus==='UNATTRIBUTED').length,conflicts:d.executions.filter(x=>x.attributionStatus==='CONFLICT').length,syncErrors:d.sync.filter(x=>x.lastError).length,sync:d.sync,notes:['当前状态指标不随日期回溯','首次成交与留存仅基于已收录历史','PG 为独立数据源；本地快照不会自动同步生产','Clerk 与 PG 时间点不同，用户差异不等同于同步故障']};
 return {range:r,quality,activity,summary:{registered:identity.status==='AVAILABLE'?clerk.length:null,newRegistered:identity.status==='AVAILABLE'?clerk.filter(x=>within(x.registeredAt,r)).length:null,configured:new Set(d.agents.map(x=>x.clerkUserId)).size,liveUsers:new Set(d.agents.filter(x=>x.liveEnabled).map(x=>x.clerkUserId)).size,tradingUsers:first.size,firstTraders:[...first.values()].filter(x=>within(x,r)).length,periodTraders:new Set(trades.map(x=>x.ownerClerkUserId)).size,volume:sum(trades,x=>x.actualFilledValue),buys:sum(trades.filter(x=>x.side==='BUY'),x=>x.actualFilledValue),sells:sum(trades.filter(x=>x.side==='SELL'),x=>x.actualFilledValue),orders:new Set(trades.map(x=>x.orderId).filter(Boolean)).size,matches:trades.length,agents:d.agents.length,liveAgents:d.agents.filter(x=>x.liveEnabled).length,bound:d.bindings.length,allocated:d.allocated.length,available:sum(d.funds,x=>x.availableToBet),reserved:sum(d.reserved,x=>x.value),fundSyncRequired:d.funds.filter(x=>x.syncRequired).length,failedOrders:terminal.filter(x=>x.state==='FAILED').length},pnl,trend:[...dates].sort(([a],[b])=>a.localeCompare(b)).map(([date,es])=>({date,volume:sum(es,x=>x.actualFilledValue),orders:new Set(es.map(x=>x.orderId).filter(Boolean)).size,users:new Set(es.map(x=>x.ownerClerkUserId)).size})),users,agents:d.agents,orders:d.orders.filter(x=>within(x.createdAt,r)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(o=>({...o,filledValue:sum(d.executions.filter(x=>x.orderId===o.id&&x.executionKind==='TRADE'),x=>x.actualFilledValue)})),executions:trades,signals:d.signals.filter(x=>within(x.decidedAt,r)),analyses:d.analyses.filter(x=>within(x.createdAt,r)),tasks:d.tasks};
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
   const name=url.pathname.slice(5);if(!['activity','overview','users','agents','orders','executions','signals','analyses','funds','quality'].includes(name))return send(res,404,{error:'接口不存在'});
   const [d,c]=await Promise.all([snapshot(),identities()]);const result=aggregate(d,c,r);
   if(name==='overview')return send(res,200,{range:r,summary:result.summary,pnl:{...result.pnl,users:undefined},trend:result.trend,quality:result.quality});
   if(name==='activity')return send(res,200,{...result.activity,trend:result.trend,summary:result.summary});
   if(name==='quality')return send(res,200,{...result.quality,tasks:result.tasks});
   if(name==='funds')return send(res,200,{summary:result.summary,pnl:result.pnl,range:r});
   let rows=result[name];const owner=url.searchParams.get('owner');if(owner)rows=rows.filter(x=>(x.ownerClerkUserId??x.clerkUserId??x.id)===owner);const q=(url.searchParams.get('q')||'').toLowerCase().slice(0,200);const state=url.searchParams.get('status');
   if(q)rows=rows.filter(x=>Object.values(x).some(v=>typeof v==='string'&&v.toLowerCase().includes(q)));
   if(state)rows=rows.filter(x=>String(x.state??x.decision??x.liveEnabled)===state);
   const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20);
   if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)return send(res,400,{error:'分页参数无效'});
   send(res,200,{items:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,asOf:d.asOf,range:r});return;
  }
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[url.pathname];
  if(!file)return send(res,404,{error:'页面不存在'});
  return staticFile(res,file);
 }catch(e){console.error('Request failed:',e.code||e.name);send(res,503,{error:'数据源暂时不可用，请检查 PostgreSQL 连接和服务配置'});}
});
server.listen(Number(process.env.PORT||4310),process.env.HOST||'127.0.0.1',()=>console.log(`Arena Dashboard: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||4310}`));
process.on('SIGTERM',()=>server.close(()=>pool.end()));
