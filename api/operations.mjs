import {linkedInsights,registrationGroup,sevenDayMembers} from './linked-insights.mjs';
import Decimal from 'decimal.js';
import {day,within,sum,periodPnl,executionPerformance} from './metrics.mjs';
export const views=['overview','users','user-list','user-details','agents','funds','orders','order-list','executions','failures','platform','platform-orders','platform-pnl','platform-pnl-details','events','signals','analyses','quality'];
const unique=xs=>[...new Set(xs.filter(x=>x!==null&&x!==undefined&&x!==''))];
const metric=(key,label,value,unit='',extra={})=>({key,label,value,unit,...extra});
const directionLabel=o=>{const outcome={HOME:`${o.homeTeamName||'主队'}胜`,AWAY:`${o.awayTeamName||'客队'}胜`,DRAW:'平局',home_win:`${o.homeTeamName||'主队'}胜`,away_win:`${o.awayTeamName||'客队'}胜`,draw:'平局'}[o.canonicalOutcome];return outcome?(o.positionSide==='NO'?`否：${outcome}`:o.positionSide==='YES'?outcome:`${outcome}（买入方向未记录）`):'未记录';};

export function compare(value,previous,kind='number'){
 if(value==null||previous==null)return {text:'—',direction:0};
 const a=new Decimal(value),b=new Decimal(previous),d=a.minus(b),direction=d.cmp(0);
 if(!direction)return {text:'持平',direction:0};
 const sign=direction>0?'+':'';
 if(kind==='rate')return {text:`${sign}${d.toFixed(2)} 个百分点`,direction};
 if(kind==='pnl'&&(b.lte(0)||a.lt(0)))return {text:`${b.lt(0)&&a.gte(0)?'转盈 · ':b.gte(0)&&a.lt(0)?'转亏 · ':''}${sign}${d.toFixed(2)} USDT`,direction};
 return {text:b.eq(0)?`${sign}${d.toFixed(2)}`:`${sign}${d.div(b.abs()).times(100).toFixed(1)}%`,direction};
}
export function previousRange(r,asOf){
 if(r.kind==='all')return null;
 const end=Math.min(new Date(r.to).getTime(),new Date(asOf).getTime()),start=new Date(r.from).getTime();
 if(end<=start)return null;
 return {...r,from:new Date(start-(end-start)).toISOString(),to:new Date(start).toISOString()};
}
export function sortRows(rows,key,direction){
 const numeric=new Set(['volume','orders','filled','failed','amount','requestedStake','actualFilledValue','realizedPnl','value','fees','count','agentCount','availableToBet','unrealizedPnl','buyValue','orderCount','rate','eligible','returned']);
 return [...rows].sort((a,b)=>{const x=a[key],y=b[key];if(x==null)return y==null?0:1;if(y==null)return -1;const result=numeric.has(key)?new Decimal(x).cmp(y):String(x).localeCompare(String(y));return (direction==='asc'?1:-1)*result;});
}
const column=(key,label,type='text')=>({key,label,type});
export function operations(d,identity,input,r){
 const view=input.get('view')||'overview';if(!views.includes(view))throw Error('无效页面');
 const platform=view.startsWith('platform'),asOf=d.asOf;
 const effective={...r,to:new Date(Math.min(new Date(r.to),new Date(asOf))).toISOString()};
 if(input.has('comparisonFrom')||input.has('comparisonTo')){
  const from=Date.parse(input.get('comparisonFrom')||effective.from),to=Date.parse(input.get('comparisonTo')||effective.to);
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error('无效比较时间范围');
  effective.from=new Date(Math.max(+new Date(effective.from),from)).toISOString();effective.to=new Date(Math.min(+new Date(effective.to),to)).toISOString();
 }
 const previous=previousRange(effective,asOf);
 const clerk=identity.users.filter(u=>!d.official.has(u.id));
 const userEmails=new Map(clerk.map(u=>[u.id,u.email||null]));
 const local=new Map(d.users.map(u=>[u.clerkUserId,u]));
 const baseUsers=unique([...clerk.map(u=>u.id),...local.keys()]).map(id=>{const c=clerk.find(u=>u.id===id),a=d.agents.filter(a=>a.clerkUserId===id);return {id,email:c?.email||null,registeredAt:c?.registeredAt||local.get(id)?.clerkRegisteredAt||null,agentCount:a.length,live:a.some(a=>a.liveEnabled),bound:d.bindings.some(b=>b.clerkUserId===id),traded:d.executions.some(e=>e.ownerClerkUserId===id&&e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId),stage:null};}).map(u=>({...u,stage:u.traded?'已成交':u.live?'已开启未成交':u.agentCount?'已配置未开启':'未配置'}));
 const userPages=['overview','users','user-list','user-details','agents','funds'];
 const userScope=userPages.includes(view),queryUserScope=userScope||input.get('searchScope')==='users',query=(input.get('q')||'').trim().toLowerCase();
 const pick=(key,value)=>!input.getAll(key).filter(Boolean).length||input.getAll(key).includes(String(value??'未记录'));
 const textMatch=row=>!query||[...Object.values(row),userEmails.get(row.ownerClerkUserId||row.clerkUserId)].some(v=>typeof v==='string'&&v.toLowerCase().includes(query));
 const agentBands=['0 个 Agent','1 个 Agent','2 个 Agent','3 个 Agent','4 个 Agent','5 个及以上 Agent'];
 const agentBand=count=>agentBands[Math.min(count,5)];
 const users=baseUsers.filter(u=>(!input.get('registrationGroup')||registrationGroup(u,effective)===input.get('registrationGroup'))&&(!input.get('registeredFrom')||u.registeredAt&&day(u.registeredAt)>=input.get('registeredFrom'))&&(!input.get('registeredTo')||u.registeredAt&&day(u.registeredAt)<=input.get('registeredTo'))&&pick('agentBand',agentBand(u.agentCount))&&pick('stage',u.stage)&&pick('bound',u.bound)&&(!queryUserScope||textMatch(u)||(view==='agents'&&d.agents.some(a=>a.clerkUserId===u.id&&textMatch({id:a.id,name:a.name}))))&&pick('owner',u.id));
 const ids=new Set(users.map(u=>u.id));
 const allOrders=platform?d.platformOrders:d.orders;
 const liveAgents=new Set(d.agents.filter(a=>pick('liveState',a.liveEnabled)).map(a=>a.id));
 const dimensions=o=>(!input.get('liveState')||liveAgents.has(o.agentId))&&pick('market',o.competition||null)&&pick('event',o.canonicalEventId||null)&&pick('model',o.modelId)&&pick('strategy',o.positionMethod)&&pick('agent',o.agentId);
 const orderCandidates=allOrders.filter(o=>(platform||ids.has(o.ownerClerkUserId))&&dimensions(o)&&pick('status',o.state)&&pick('reason',o.failureReason||'未记录')&&(queryUserScope||textMatch(o))&&(!input.get('min')||new Decimal(o.requestedStake||0).gte(input.get('min')))&&(!input.get('max')||new Decimal(o.requestedStake||0).lte(input.get('max'))));
 const orderMap=new Map(orderCandidates.map(o=>[o.id,o]));
 const restricted=['status','reason','min','max'].some(k=>input.get(k))||(!queryUserScope&&query);
 const platformOrderMetadata=new Map((d.platformOrders||[]).map(o=>[o.id,o]));
 const executions=(platform?d.platformExecutions.map(e=>({...e,modelId:d.platform.find(a=>a.id===e.platformModelAccountId)?.modelId??e.modelId,positionMethod:platformOrderMetadata.get(e.platformOrderId)?.positionMethod})):d.executions).filter(e=>(platform||ids.has(e.ownerClerkUserId))&&dimensions(e)&&(!restricted||orderMap.has(platform?e.platformOrderId:e.orderId))&&pick('side',e.side)).filter(e=>!(view==='funds'||view==='events'&&input.get('excludeUnattributed')==='1')||e.attributionStatus==='CONFLICT'||(e.attributionStatus==='ATTRIBUTED'&&e.agentId)).map(e=>platform?{...e,ownerClerkUserId:e.platformModelAccountId,agentId:e.platformModelAccountId,orderId:e.platformOrderId}:e);
 const eligible=executions.filter(e=>e.attributionStatus==='ATTRIBUTED'&&e.agentId);
 const options={liveState:['true','false'],agentBand:agentBands,market:unique(allOrders.map(o=>o.competition)),model:unique(platform?d.platform.map(x=>x.modelId):allOrders.map(o=>o.modelId)),strategy:unique(allOrders.map(o=>o.positionMethod)),status:unique(allOrders.map(o=>o.state)),stage:['已成交','已开启未成交','已配置未开启','未配置'],bound:['true','false'],side:unique((platform?d.platformExecutions:d.executions).filter(e=>e.executionKind==='TRADE').map(e=>e.side)),agent:unique(allOrders.map(o=>o.agentId))};
 const flows=period=>{const os=orderCandidates.filter(o=>within(o.createdAt,period)),es=eligible.filter(e=>e.executionKind==='TRADE'&&within(e.executedAt,period));return {os,es,orders:os.length,failed:os.filter(o=>o.state==='FAILED').length,filled:unique(es.map(e=>e.orderId)).length,volume:sum(es,e=>e.actualFilledValue),traders:unique(es.map(e=>e.ownerClerkUserId)).length,registered:identity.status==='AVAILABLE'?users.filter(u=>within(u.registeredAt,period)).length:null,configured:unique(d.agents.filter(a=>ids.has(a.clerkUserId)&&within(a.createdAt,period)).map(a=>a.clerkUserId)).length,executedAgents:unique(os.map(o=>o.agentId)).length,tradeAgents:unique(es.map(e=>e.agentId)).length,rate:os.length?os.filter(o=>o.state==='FAILED').length/os.length*100:null};};
 const current=flows(effective),prior=previous?flows(previous):null;
 const firstTrades=new Map();for(const e of d.executions){if(e.executionKind!=='TRADE'||e.attributionStatus!=='ATTRIBUTED'||!e.agentId||!ids.has(e.ownerClerkUserId))continue;const time=new Date(e.executedAt);if(!firstTrades.has(e.ownerClerkUserId)||time<firstTrades.get(e.ownerClerkUserId))firstTrades.set(e.ownerClerkUserId,time);}
 current.firstTraders=[...firstTrades.values()].filter(t=>within(t,effective)).length;if(prior)prior.firstTraders=[...firstTrades.values()].filter(t=>within(t,previous)).length;

 let metrics=[metric('orders','本期下单订单',current.orders,'笔'),metric('filled','本期有成交订单',current.filled,'笔'),metric('volume','本期成交额',current.volume,'USDT'),metric('traders','本期成交用户',current.traders,'人'),metric('failed','本期创建的失败订单',current.failed,'笔'),metric('rate','订单当前失败率',current.rate,'%',{kind:'rate',badUp:true})];
 if(userScope)metrics=[metric('registered','本期新增注册',current.registered,'人'),metric('configured','本期新配置用户',current.configured,'人'),metric('traders','本期成交用户',current.traders,'人'),metric('orders','本期下单订单',current.orders,'笔'),metric('filled','本期有成交订单',current.filled,'笔'),metric('volume','本期成交额',current.volume,'USDT')];
 if(view==='overview')metrics=metrics.map(m=>m.key==='volume'?metric('firstTraders','本期首次成交',current.firstTraders,'人',{note:'已收录历史首次成交 · 用户去重'}):m);
 if(view==='agents')metrics=[metric('configured','本期新配置用户',current.configured,'人'),metric('executedAgents','本期有下单 Agent',current.executedAgents,'个'),metric('tradeAgents','本期有成交 Agent',current.tradeAgents,'个'),...metrics.slice(3)];
 if(platform)metrics=metrics.filter(m=>m.key!=='traders');
 metrics=metrics.map(m=>({...m,previous:prior?.[m.key]??null,change:compare(m.value,prior?.[m.key],m.kind)}));
 const start=r.kind==='all'?Math.min(...[...current.os.map(o=>o.createdAt),...current.es.map(e=>e.executedAt),...users.map(u=>u.registeredAt)].filter(Boolean).map(x=>+new Date(x)),+new Date(effective.to)):+new Date(r.from);
 const days=[];for(let t=+new Date(day(start)+'T00:00:00+08:00');t<+new Date(effective.to)&&days.length<3660;t+=86400000)days.push(day(t));
 const series=days.map(date=>{const es=current.es.filter(e=>day(e.executedAt)===date),os=current.os.filter(o=>day(o.createdAt)===date);return {date,orders:os.length,volume:sum(es,e=>e.actualFilledValue),filled:unique(es.map(e=>e.orderId)).length,registered:identity.status==='AVAILABLE'?users.filter(u=>u.registeredAt&&day(u.registeredAt)===date).length:null};});
 for(const row of series){if(!previous)continue;const dayStart=Math.max(+new Date(effective.from),+new Date(row.date+'T00:00:00+08:00')),dayEnd=Math.min(+new Date(effective.to),+new Date(row.date+'T00:00:00+08:00')+86400000),offset=+new Date(previous.from)-new Date(effective.from);const values=flows({from:new Date(dayStart+offset).toISOString(),to:new Date(dayEnd+offset).toISOString()});row.previousOrders=values.orders;row.previousFilled=values.filled;row.previousVolume=values.volume;row.previousRegistered=values.registered;row.previousOrderedUsers=unique(values.os.map(o=>o.ownerClerkUserId)).length;row.previousTradedUsers=values.traders;}
 let linkedPerformance=null;
 const charts=[];const bars=(title,rows,key,label,unit,filter)=>charts.push({title,type:'bars',rows,key,label,unit,filter});
 charts.push({title:userScope?'每日新增注册':'每日下单订单',type:'line',rows:series,key:userScope?'registered':'orders',label:'date',unit:userScope?'人':'笔',previousKey:previous?(userScope?'previousRegistered':'previousOrders'):null,filter:'date'});
 charts.push({title:'每日实际成交额',type:'line',rows:series,key:'volume',label:'date',unit:'USDT',previousKey:previous?'previousVolume':null,filter:'date'});
 const group=(rows,key,value)=>[...Map.groupBy(rows,x=>x[key]||'未记录')].map(([name,items])=>({name,value:value?sum(items,value):items.length}));
 bars('订单当前状态分布',group(current.os,'state'),'value','name','笔','status');
 bars('市场成交贡献',group(current.es,'competition',e=>e.actualFilledValue),'value','name','USDT','market');
 let eventRows=[],unassignedEventQuality=null;
 let rows=current.os.map(o=>({...o,amount:sum(eligible.filter(e=>e.orderId===o.id&&e.executionKind==='TRADE'&&new Date(e.executedAt)<new Date(effective.to)),e=>e.actualFilledValue)}));
 let columns=[column('id','订单'),column('createdAt','创建时间','date'),column('ownerClerkUserId','用户'),column('agentId','Agent'),column('modelId','模型'),column('fixtureName','赛事'),column('positionMethod','仓位策略'),column('state','当前状态'),column('requestedStake','请求额 USDT','money'),column('amount','截至期末成交额 USDT','money'),column('failureReason','失败原因')];
 let notes=['下单按订单 ID 去重、创建时间统计；成交按流水发生时间统计，含买入与卖出。','订单状态为当前状态，不能回溯为历史终态；失败率比较也是当前状态下的创建批次比较。'];
 if(userScope){rows=users.map(u=>({...u,volume:sum(current.es.filter(e=>e.ownerClerkUserId===u.id),e=>e.actualFilledValue),orders:current.os.filter(o=>o.ownerClerkUserId===u.id).length}));columns=[column('id','用户'),column('email','邮箱'),column('registeredAt','注册时间','date'),column('stage','当前阶段'),column('bound','当前绑定'),column('agentCount','当前 Agent 数','number'),column('orders','本期订单','number'),column('volume','本期成交额 USDT','money')];bars('用户当前阶段（互斥）',group(rows,'stage'),'value','name','人','stage');notes.push('用户阶段、绑定、实盘开关为当前状态；不作为历史转化漏斗。');}
 if(['user-list','user-details'].includes(view)){
  const distribution=agentBands.map(name=>{const members=users.filter(u=>agentBand(u.agentCount)===name);return {name,value:members.length,percentage:users.length?members.length/users.length*100:null,agentTotal:members.reduce((total,u)=>total+u.agentCount,0)};});
  const retained=charts.filter(c=>!(c.type==='line'&&['registered','volume'].includes(c.key)));
  charts.splice(0,charts.length,{title:'用户与 Agent 数量分布',type:'progress',rows:distribution,key:'value',label:'name',unit:'人',filter:'agentBand',note:'按当前拥有的 Agent 数分组 · 悬浮查看用户占比及 Agent 总数 · 点击分组筛选明细'},...retained);
  notes.push('用户与 Agent 数量分布按当前筛选用户及其现存 Agent 统计，包含 0 个 Agent 的用户；属于当前存量，不随时间范围回溯。时间范围仍影响本期交易指标。');
 }
 if(view==='agents'){rows=d.agents.filter(a=>ids.has(a.clerkUserId)).map(a=>({...a,orders:current.os.filter(o=>o.agentId===a.id).length,volume:sum(current.es.filter(e=>e.agentId===a.id),e=>e.actualFilledValue)}));columns=[column('id','Agent'),column('name','名称'),column('clerkUserId','用户'),column('positionMethod','仓位策略'),column('liveEnabled','当前开启实盘'),column('orders','本期订单','number'),column('volume','本期成交额 USDT','money')];}
 if(view==='executions'){
  charts[0]={title:'每日成交订单',type:'line',rows:series,key:'filled',label:'date',unit:'笔',previousKey:previous?'previousFilled':null,filter:'date',note:'按成交发生日期统计 · 当天订单 ID 去重 · 不含结算流水'};
  notes.push('每日成交订单统计当天发生真实成交的去重订单，含部分成交；同一订单跨日成交可在多天出现，日值之和不等于周期去重订单总数。');
 }
 if(view==='executions'){rows=eligible.filter(e=>within(e.executedAt,effective));columns=[column('sourceEventKey','流水'),column('executedAt','发生时间','date'),column('ownerClerkUserId','用户'),column('orderId','订单'),column('fixtureName','赛事'),column('executionKind','成交／结算'),column('side','方向'),column('actualFilledValue','实际金额 USDT','money'),column('feeAmount','手续费','money'),column('feeType','手续费单位')];}
 if(view==='failures'){
  rows=rows.filter(o=>['FAILED','AMBIGUOUS'].includes(o.state));
  notes.push('失败异常明细仅展示本期创建、当前为失败或状态不明的订单；上方状态分布用于对比全部订单状态。');
  const statuses=['PENDING','SUBMITTING','SUBMITTED','OPEN','FILLED','FAILED','AMBIGUOUS',...options.status.filter(s=>!['PENDING','SUBMITTING','SUBMITTED','OPEN','FILLED','FAILED','AMBIGUOUS'].includes(s))];
  const seriesLabels={PENDING:'待处理',SUBMITTING:'提交中',SUBMITTED:'已提交',OPEN:'挂单中',FILLED:'已成交',FAILED:'失败',AMBIGUOUS:'状态不明',PARTIALLY_FILLED:'部分成交',CANCELLED:'已取消'};
  const seriesColors={PENDING:'#8495ac',SUBMITTING:'#8959e9',SUBMITTED:'#397bf1',OPEN:'#11a6c2',FILLED:'#08a75c',FAILED:'#db4b45',AMBIGUOUS:'#f78b26',PARTIALLY_FILLED:'#18b1a2',CANCELLED:'#b47c93'};
  const counts=new Map();for(const order of current.os){const date=day(order.createdAt);if(!counts.has(date))counts.set(date,{});const bucket=counts.get(date);bucket[order.state]=(bucket[order.state]||0)+1;}
  const dailyStatuses=days.map(date=>({date,...Object.fromEntries(statuses.map(status=>[status,counts.get(date)?.[status]||0]))}));
  charts.splice(0,charts.length,{title:'订单当前状态分布',type:'timeBars',rows:dailyStatuses,key:statuses[0],seriesKeys:statuses,seriesLabels,seriesColors,label:'date',unit:'笔',axis:'订单数（笔）',integerTicks:true,filter:'date',note:'按订单创建日期对比当前状态 · 悬浮日期查看各状态数量'});
  bars('失败原因',group(current.os.filter(o=>o.state==='FAILED'),'failureReason'),'value','name','笔','reason');
 }

 if(['platform','platform-pnl','platform-pnl-details','funds','events'].includes(view)){
  const perf=executionPerformance(eligible,effective,days),pnl=periodPnl(executions,effective);const prevPnl=previous?periodPnl(executions,previous):null;
  linkedPerformance=perf;
  metrics.push(metric('pnl','已归属已实现盈亏分量',pnl.value,'USDT',{previous:prevPnl?.value??null,change:compare(pnl.value,prevPnl?.value,'pnl')}));
  notes.push(pnl.note,'已实现盈亏按既有成本投影计入可识别手续费；缺少费用或成本的账户为部分覆盖。未实现盈亏与未结算订单数尚无可靠同口径统计，显示为 —。');
  charts.push({title:'每日已实现盈亏分量',type:'bars',rows:perf.daily,key:'realizedPnl',label:'date',unit:'USDT',filter:'date'},{title:'本期累计已实现盈亏分量',type:'line',rows:perf.daily,key:'cumulativePnl',label:'date',unit:'USDT',filter:'date'});
  if(platform){rows=d.platform.filter(m=>pick('model',m.modelId)).map(m=>{const ps=perf.models.find(x=>x.modelId===m.modelId),os=current.os.filter(o=>o.modelId===m.modelId),es=current.es.filter(e=>e.modelId===m.modelId),unresolved=executions.some(e=>e.modelId===m.modelId&&e.attributionStatus!=='ATTRIBUTED'&&within(e.executedAt,effective));return {modelId:m.modelId,orders:os.length,filled:unique(es.map(e=>e.orderId)).length,volume:sum(es,e=>e.actualFilledValue),realizedPnl:ps?.realizedPnl??(unresolved?null:'0'),coverage:unresolved?'存在待归属流水':'仅已归属分量',unrealizedPnl:null};});columns=[column('modelId','平台模型'),column('orders','本期订单','number'),column('filled','本期有成交订单','number'),column('volume','本期成交额 USDT','money'),column('realizedPnl','已实现盈亏分量 USDT','money'),column('unrealizedPnl','未实现盈亏','money'),column('coverage','覆盖范围')];bars('平台模型成交额',rows,'volume','modelId','USDT','model');bars('平台模型盈亏分量',rows,'realizedPnl','modelId','USDT','model');}
  if(view==='funds'){
   rows=pnl.users.map(row=>({...row,pendingCount:0,pendingDestination:null})).filter(row=>pick('coverage',row.status));
   notes.push('本页面排除所有待归属流水（包括历史流水及缺少 Agent 归属的流水），仅保留已归属可计算金额；仅有待归属流水的用户不展示。此处盈亏不代表账户全部盈亏。归属冲突、成本或手续费缺失等其他问题仍标记为不完整；完整性筛选仅影响明细。');
   columns=[column('id','用户'),column('value','已实现盈亏分量 USDT','money'),column('fees','已计入手续费 USDT','money'),column('status','覆盖状态'),column('issues','数据问题')];const markets=group(perf.details,'competition',x=>x.realizedPnl);charts.push({title:'市场累计盈亏绝对值占比',type:'pie',rows:markets,key:'value',label:'name',labelType:'market',unit:'USDT',filter:null});}
  if(view==='events'){rows=perf.events.map(e=>({...e,models:[...Map.groupBy(perf.details.filter(x=>x.eventId===e.eventId),x=>x.modelId)].map(([modelId,items])=>({modelId,buyValue:sum(items,x=>x.buyValue),realizedPnl:sum(items,x=>x.realizedPnl),returnValue:sum(eligible.filter(x=>x.canonicalEventId===e.eventId&&x.modelId===modelId&&within(x.executedAt,effective)&&(x.side==='SELL'||x.executionKind==='SETTLEMENT')),x=>x.actualFilledValue)}))}));columns=[column('fixtureName','赛事'),column('competition','市场'),column('buyValue','实际买入 USDT','money'),column('realizedPnl','已实现盈亏分量 USDT','money'),column('orderCount','有成交订单','number')];bars('比赛盈亏排名',rows,'realizedPnl','fixtureName','USDT',null);}
 }
 if(view==='platform'){
  const modelRows=sortRows(rows,'realizedPnl','desc');
  charts.splice(0,charts.length,...[
   {title:'模型下单数对比',key:'orders',unit:'笔',note:'本期创建订单 · 按订单 ID 去重'},
   {title:'模型成交金额对比',key:'volume',unit:'USDT',note:'本期实际成交金额 · 买入与卖出'},
   {title:'模型累计已实现盈亏对比',key:'realizedPnl',unit:'USDT',note:'所选周期累计 · 已归属可计算分量',signed:true}
  ].map(c=>({...c,type:'modelComparison',rows:modelRows,label:'modelId',filter:'model'})));
  columns=[column('modelId','平台模型'),column('orders','本期下单订单','number'),column('filled','本期有成交订单','number'),column('volume','本期成交金额 USDT','money'),column('realizedPnl','本期累计已实现盈亏 USDT','money'),column('coverage','盈亏覆盖范围')];
  const metricCopy={orders:['下单订单','本期创建 · 去重订单'],filled:['成交订单','本期成交 · 去重订单'],volume:['成交金额','本期成交 · 买入与卖出'],failed:['失败订单','本期创建 · 当前失败'],pnl:['已实现盈亏','本期累计 · 已归属分量']};
  metrics=metrics.filter(m=>m.key!=='rate').map(m=>({...m,label:metricCopy[m.key]?.[0]||m.label,note:metricCopy[m.key]?.[1]||m.note,...(m.key==='failed'?{secondary:{label:'失败率',value:current.rate,unit:'%'}}:{})}));
  metrics.unshift(metric('modelCount','模型数量',unique(rows.map(m=>m.modelId)).length,'个',{note:'当前配置 · 按型号去重'}));
  notes.push('失败率为本期创建且当前失败的订单数 / 本期创建订单数；失败订单卡片的环比按失败订单数计算。模型数量包含本期无下单的已配置模型。');
  notes.push('模型对比仅包含平台自有模型，三张图采用相同模型顺序。下单数按本期创建订单统计，成交金额按本期成交流水统计；累计盈亏为所选周期内已实现盈亏分量之和，不是账户历史总盈亏。无业务记录的已配置模型保留为 0；无法计算的盈亏显示 —。');
 }
 if(view==='platform-pnl'){
  const models=d.platform.filter(m=>pick('model',m.modelId)).map(m=>m.modelId);
  const balances=days.map(date=>{const row={date};for(const model of models){const snapshots=(d.platformSnapshots||[]).filter(s=>s.modelId===model&&day(s.asOf)===date&&new Date(s.asOf)<new Date(effective.to));row[model]=snapshots.at(-1)?.cashBalance??null;}return row;});
  charts.push({title:'平台各模型每日现金余额',type:'multi',rows:balances,key:models[0],seriesKeys:models,label:'date',unit:'USDT',filter:null,footnotes:[
   '总账户余额（账户总价值）＝现金余额＋持仓当前价值。本图只展示现金部分，不是总账户余额；三者须按同一模型、同一快照时点比较。',
   '例如：现金余额 200 USDT，持仓当前价值 300 USDT，则总账户余额为 500 USDT（仅用于说明计算关系）。',
   '现金余额是模型账户的链上 USDT 余额，不含持仓价值；持仓当前价值按当前估值计算，不是买入成本。买入会将现金转为持仓，因此现金减少不等于亏损，卖出或结算回款也不等于全部盈利。',
   '现金余额未扣除未完成订单的预留金额，不等于可下单额度。本图按北京时间取每天最后一条已收录快照；缺失日期留空、断线，不补零。'
  ]});
  notes.push('现金余额为当日最后一条已收录快照；没有当日快照显示缺失，折线断开，不补零。账户余额不按赛事／订单筛选拆分。');
  if(['market','event','status','strategy'].some(k=>input.get(k)))charts.pop();
  const removed=new Set(['每日下单订单','每日实际成交额','订单当前状态分布','市场成交贡献']);
  const retained=charts.filter(c=>!removed.has(c.title)).map(c=>c.key==='realizedPnl'&&c.label==='date'?{...c,type:'timeBars',signed:true,axis:'已实现盈亏（USDT）'}:c.key==='cumulativePnl'?{...c,signed:true,axis:'累计已实现盈亏（USDT）'}:c);
  charts.splice(0,charts.length,...retained);
 }
 if(['platform','platform-orders'].includes(view)){
  if(view==='platform-orders')columns=columns.filter(c=>!['ownerClerkUserId','agentId'].includes(c.key));
  const strategies=unique([...current.os,...current.es].map(x=>x.positionMethod||'未记录'));
  const strategyRows=strategies.map(name=>{
   const os=current.os.filter(o=>(o.positionMethod||'未记录')===name),es=current.es.filter(e=>(e.positionMethod||'未记录')===name);
   const failed=os.filter(o=>o.state==='FAILED').length;
   return {name,orders:os.length,requested:sum(os,o=>o.requestedStake),filled:unique(es.map(e=>e.orderId).filter(Boolean)).length,volume:sum(es,e=>e.actualFilledValue),failed,rate:os.length?failed/os.length*100:null};
  }).sort((a,b)=>b.orders-a.orders||a.name.localeCompare(b.name));
  charts.push({title:'策略分析',type:'strategyAnalysis',rows:strategyRows,key:'orders',label:'name',unit:'笔',filter:'strategy'});
  notes.push('策略分析仅统计平台模型订单，策略取下单时的策略快照。下单及失败率按创建时间统计，成交订单及成交额按真实成交流水发生时间统计；跨期成交可能使成交订单数大于本期下单数。缺少策略记录的归入未记录。');
 }

 if(['signals','analyses'].includes(view)){rows=(view==='signals'?d.signals.filter(x=>ids.has(x.ownerClerkUserId)):d.analyses).filter(x=>within(x.decidedAt||x.createdAt,effective)&&pick('model',x.modelId)&&textMatch(x));columns=[column('id','记录'),column('modelId','模型'),column(view==='signals'?'decidedAt':'createdAt','时间','date'),column(view==='signals'?'decision':'state','结果'),column(view==='signals'?'reasonCode':'failureReason','原因')];metrics=[metric('count','本期记录',rows.length,'条')];charts.length=0;bars('结果分布',group(rows,view==='signals'?'decision':'state'),'value','name','条',null);bars('模型记录分布',group(rows,'modelId'),'value','name','条','model');}
 if(view==='analyses'){
  Object.assign(charts.find(c=>c.title==='模型记录分布'),{type:'pie',note:'按模型记录数计算占比 · 悬浮查看数量和比例'});
  const statusLabels={PENDING:'待完成',COMPLETED:'已完成',FAILED:'失败'};
  const linked=list=>Map.groupBy((list||[]).filter(x=>x.sharedModelAnalysisId&&x.decidedAt&&new Date(x.decidedAt)<new Date(effective.to)),x=>x.sharedModelAnalysisId);
  const signalsByAnalysis=linked(d.signals),decisionsByAnalysis=linked(d.platformDecisions);
  const signalSummary=list=>{if(!list?.length)return '暂无关联记录';const counts=new Map();for(const item of list){const label=item.decision==='BUY'?`买入 · ${directionLabel(item)}`:item.decision==='NO_TRADE'?'不交易':`未知决策（${item.decision||'未记录'}）`;counts.set(label,(counts.get(label)||0)+1);}return [...counts].map(([label,count])=>`${label}：${count} 条`).join('；');};
  rows=rows.map(row=>{const probabilities=row.outcomeProbabilities;const predicted=row.state==='COMPLETED'?['home_win','draw','away_win'].map((key,i)=>{const value=probabilities?.[key],valid=value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1;return `${['主胜','平局','客胜'][i]} ${valid?(Number(value)*100).toFixed(1)+'%':'未记录'}`;}).join(' / '):'暂无有效预测';return {...row,stateLabel:statusLabels[row.state]||row.state,predictedProbabilities:predicted,agentSignals:signalSummary(signalsByAnalysis.get(row.id)),platformDecisionSummary:signalSummary(decisionsByAnalysis.get(row.id))};});
  columns.push(column('predictedProbabilities','模型预测概率'),column('agentSignals','用户 Agent 信号'),column('platformDecisionSummary','平台模型决策'));
  notes.push('模型预测概率是共享分析的输出，不等于交易信号。用户 Agent 信号与平台模型决策仅通过 sharedModelAnalysisId 精确关联，按截至期末已生成记录汇总；买入不代表下单成功或成交，暂无关联记录不等于不交易。同一分析可被多个 Agent 使用并产生不同方向。');
  columns=columns.map(c=>c.key==='state'?{...c,key:'stateLabel'}:c);
  const results=charts.find(c=>c.title==='结果分布');
  const counts=new Map(results.rows.map(row=>[row.name,row.value]));
  results.rows=Object.entries(statusLabels).map(([state,name])=>({name,value:counts.get(state)||0}));
  results.showValues=true;results.filter='analysisState';
 }
 if(view==='quality'){rows=[...d.executions,...d.platformExecutions].filter(e=>e.attributionStatus!=='ATTRIBUTED'&&within(e.executedAt,effective)&&textMatch(e));columns=[column('sourceEventKey','流水'),column('scope','业务范围'),column('attributionStatus','归属状态'),column('executedAt','发生时间','date'),column('actualFilledValue','金额 USDT','money')];metrics=[metric('count','归属待确认流水',rows.length,'条')];charts.length=0;bars('归属异常分布',group(rows,'attributionStatus'),'value','name','条',null);notes=['待确认流水排除在正式成交汇总之外；按原始 scope 标记，不猜测归属。'];}
 if(view==='users'){
  const cohortUsers=users.filter(u=>clerk.some(c=>c.id===u.id));
  const cohort=registrationCohort(cohortUsers,d.bindings,d.agents,d.executions,effective,effective.to),old=previous?registrationCohort(cohortUsers,d.bindings,d.agents,d.executions,previous,effective.to):null;
  const known=identity.status==='AVAILABLE';
  const atEnd=cutoff=>cohortUsers.filter(u=>u.registeredAt&&new Date(u.registeredAt)<new Date(cutoff));
  const registeredEnd=known?atEnd(effective.to).length:null,registeredBefore=known&&previous?atEnd(previous.to).length:null;
  const bindingRate=cutoff=>{const population=atEnd(cutoff);return known&&population.length?population.filter(u=>d.bindings.some(b=>b.clerkUserId===u.id&&b.verifiedAt&&new Date(b.verifiedAt)<new Date(cutoff))).length/population.length*100:null;};
  const configRate=c=>known&&c?.sample?c.configured/c.sample*100:null;
  const make=(key,label,value,before,unit,note,kind='number')=>metric(key,label,value,unit,{previous:before,change:compare(value,before,kind),note});
  metrics=[
   make('registeredEnd','累计注册用户',registeredEnd,registeredBefore,'','较上一期末存量 · 当前可见账号'),
   make('registered','本期新增注册',current.registered,prior?.registered??null,'','较上一等长周期'),
   make('bindingRate','账户绑定率',bindingRate(effective.to),previous?bindingRate(previous.to):null,'%','注册并绑定交易账户','rate'),
   make('configConversion','7日配置转化率',configRate(cohort),configRate(old),'%','完成账户绑定并创建agent','rate'),
   make('cohortConversion','7日首次成交转化率',known?cohort.conversion:null,known?old?.conversion??null:null,'%','注册后 7 日内首次成交；不是首次下单','rate'),
   make('traders','本期成交用户',current.traders,prior?.traders??null,'','周期内买入或卖出成交用户去重；下单未成交不计')
  ];
  const definitions={registeredEnd:'截至所选期末的累计注册用户，限 Clerk 当前可见账号；缺少已注销账号历史。',registered:'注册时间落在所选周期内的用户。',bindingRate:'绑定指已验证 Predict 交易账户及其 Privy 代签钱包引用，不只是注册或连接钱包。分子：截至所选期末已收录验证绑定的注册用户；分母：截至所选期末注册用户。比率 = 分子 ÷ 分母 × 100%。已绑定不代表已充值、开启实盘或成交；历史解绑／重绑可能缺失。',configConversion:'本期注册且截至期末已满 7 天的同一批用户为分母；分子须在注册后 7×24 小时内完成绑定与 Agent 配置。',cohortConversion:'统计首次真实成交，不是首次提交订单。分母：所选周期内注册，且截至所选期末已注册满 7 天的用户；分子：同一批用户中，注册后 7×24 小时内已完成验证绑定、配置 Agent，并发生已归属真实成交的用户。转化率 = 分子 ÷ 分母 × 100%。未满 7 天的用户仍在观察，不纳入分母；下单未成交不计入分子；无成熟样本时显示 —。',traders:'原“活跃用户”实际指成交用户：按实际成交时间，统计所选周期内有已归属用户 Agent 的真实买入或卖出成交的去重用户。同一用户多笔成交只计 1 人；包含新用户和老用户。不含仅注册、登录、访问、开启实盘、下单未成交或仅结算的用户，不代表访问活跃人数。'};
  metrics=metrics.map(m=>({...m,definition:definitions[m.key]}));
  notes.push('截至期末注册人数按 Clerk 当前可见账号的注册时间回溯，缺少已注销账号历史。绑定率按当前保留的 verifiedAt 回溯已收录验证绑定，不代表完整历史绑定状态；存在解绑／重绑记录缺失的限制。本期成交用户按实际成交时间去重，包含买入与卖出，不含下单未成交或仅结算，不代表访问活跃。');
  charts.push({title:'注册后 7 日转化漏斗 · 同一成熟批次',type:'bars',rows:[{name:'成熟注册用户',value:known?cohort.sample:null},{name:'7 日内已验证绑定',value:known?cohort.bound:null},{name:'已绑定且 7 日内配置',value:known?cohort.configured:null},{name:'以上人群 7 日内首次成交',value:known?cohort.traded:null}],key:'value',label:'name',unit:'人',filter:null});
  notes.push(`成熟注册样本 ${known?cohort.sample:'—'} 人；观察中 ${known?cohort.observing:'—'} 人。漏斗逐层取交集，均要求在注册后 7×24 小时内完成；历史实盘开启步骤未纳入。已删除身份和 Agent 的历史缺口未补齐，分母限于 Clerk 当前可见账号。比较批次均以本期期末判断成熟度。`);
 }
 if(view==='overview'){
  const latestTrade=new Map(),periodTrades=Map.groupBy(current.es,e=>e.ownerClerkUserId);
  for(const e of eligible){if(e.executionKind!=='TRADE'||new Date(e.executedAt)>=new Date(effective.to))continue;const last=latestTrade.get(e.ownerClerkUserId);if(!last||new Date(e.executedAt)>new Date(last))latestTrade.set(e.ownerClerkUserId,e.executedAt);}
  rows=rows.map(u=>({...u,displayName:u.email||'邮箱未获取',lastActiveAt:latestTrade.get(u.id)||null,filled:unique((periodTrades.get(u.id)||[]).map(e=>e.orderId)).length}));
  columns=[column('displayName','用户'),column('registeredAt','注册时间','date'),column('lastActiveAt','最近活跃','date'),column('stage','阶段'),column('filled','本期成交订单','number'),column('volume','本期成交额 USDT','money')];
  notes.push('用户运营明细：最近活跃为截至期末已收录的最近真实成交时间，不代表登录或访问时间；本期成交订单按订单 ID 去重。');
  const cohort=registrationCohort(users.filter(u=>clerk.some(c=>c.id===u.id)),d.bindings,d.agents,d.executions,effective,effective.to),known=identity.status==='AVAILABLE';
  const amountChart=charts.find(c=>c.key==='volume'&&c.type==='line');
  const funnel={title:'新用户转化漏斗',type:'funnel',key:'value',label:'name',unit:'人',filter:null,observing:known?cohort.observing:null,rows:[{name:'注册用户',value:known?cohort.sample:null},{name:'已绑定账户',value:known?cohort.bound:null},{name:'已配置 Agent',value:known?cohort.configured:null},{name:'首次成交',value:known?cohort.traded:null}]};
  const markets={title:'市场成交贡献',type:'contribution',rows:group(current.es,'competition',e=>e.actualFilledValue).sort((a,b)=>new Decimal(b.value).cmp(a.value)),key:'value',label:'name',unit:'USDT',filter:'market'};
  charts.splice(0,charts.length,amountChart,funnel,{title:'每日成交订单数',type:'dailyOrders',rows:series,key:'filled',label:'date',unit:'笔',filter:'date'},markets);
  notes.push('新用户漏斗：本期注册且截至期末已满 7 天的当前可见用户，逐层取交集；各步骤在注册后 7 日内完成。历史实盘开启时间缺失，未纳入漏斗。每日成交订单按当天订单 ID 去重，同一订单跨日成交会出现在不同日期，日值不能直接相加作为周期去重订单数。');
 }
 // Page-specific analysis follows the reviewed prototype, using recorded events only.
 if(view==='users'){
  const registered=charts.find(c=>c.key==='registered'),funnel=charts.find(c=>c.title.startsWith('注册后 7 日'));
  const cohort=registrationCohort(users.filter(u=>clerk.some(c=>c.id===u.id)),d.bindings,d.agents,d.executions,effective,effective.to);
  const recent=new Map();for(const e of eligible){if(e.executionKind!=='TRADE'||new Date(e.executedAt)>=new Date(effective.to))continue;if(!recent.has(e.ownerClerkUserId)||new Date(e.executedAt)>new Date(recent.get(e.ownerClerkUserId)))recent.set(e.ownerClerkUserId,e.executedAt);}
  const trades=Map.groupBy(current.es,e=>e.ownerClerkUserId);
  rows=rows.map(u=>({...u,displayName:u.email||'邮箱未获取',lastActiveAt:recent.get(u.id)||null,filled:unique((trades.get(u.id)||[]).map(e=>e.orderId)).length}));
  columns=[column('displayName','用户'),column('registeredAt','注册时间','date'),column('lastActiveAt','最近活跃','date'),column('stage','阶段'),column('filled','本期成交订单','number'),column('volume','本期成交额 USDT','money')];
  charts.splice(0,charts.length,registered,{...funnel,title:'新用户转化漏斗',type:'funnel',observing:cohort.observing},
   {title:'用户阶段分布',type:'progress',rows:options.stage.map(name=>({name,value:users.filter(u=>u.stage===name).length})),key:'value',label:'name',unit:'人',filter:'stage',note:'当前状态 · 互斥阶段 · 人数'});
  notes.push('批次成交留存：按北京时间注册周分组，统计注册后第 1、7、30 个自然日发生真实成交的用户。仅观察日完整结束的用户进入该列分母；未成熟显示观察中。仅代表成交活跃，不代表访问留存。最近活跃按已收录的最近真实成交时间统计。');
 }
 if(view==='agents'){
  const daily=series.map(row=>{const os=current.os.filter(o=>day(o.createdAt)===row.date),es=current.es.filter(e=>day(e.executedAt)===row.date);let previousExecuted=null;
   if(previous){const from=Math.max(+new Date(effective.from),+new Date(row.date+'T00:00:00+08:00')),to=Math.min(+new Date(effective.to),+new Date(row.date+'T00:00:00+08:00')+86400000),offset=+new Date(previous.from)-new Date(effective.from);previousExecuted=flows({from:new Date(from+offset).toISOString(),to:new Date(to+offset).toISOString()}).executedAgents;}
   const ordering=new Set(unique(os.map(o=>o.agentId))),trading=unique(es.map(e=>e.agentId));const both=trading.filter(id=>ordering.has(id)).length;
   return {...row,executed:ordering.size,traded:trading.length,both,tradedWithoutNewOrder:trading.length-both,previousExecuted};});
  const modelIds=unique([...current.os.map(o=>o.modelId||'未记录'),...current.es.map(e=>e.modelId||'未记录')]);
  const modelRows=modelIds.map(modelId=>{const os=current.os.filter(o=>(o.modelId||'未记录')===modelId),es=current.es.filter(e=>(e.modelId||'未记录')===modelId);return {name:modelId,value:sum(es,e=>e.actualFilledValue),users:unique(es.map(e=>e.ownerClerkUserId)).length,filled:unique(es.map(e=>e.orderId)).length,orders:os.length,failed:os.filter(o=>o.state==='FAILED').length,rate:os.length?os.filter(o=>o.state==='FAILED').length/os.length*100:null};}).sort((a,b)=>new Decimal(b.value).cmp(a.value));
  charts.splice(0,charts.length,{title:'每日实际下单 Agent 趋势',type:'trend',rows:daily,key:'executed',label:'date',unit:'个',axis:'Agent 数',previousKey:previous?'previousExecuted':null,filter:'date',source:'PG 用户订单 · 按创建时间去重 Agent'},
   {title:'模型成交贡献',type:'progress',rows:modelRows,key:'value',label:'name',unit:'USDT',filter:'model',note:'已归属实际成交额 · 使用用户与样本量见悬浮'},
   {title:'每日下单与成交 Agent 活跃对比',type:'comparison',rows:daily,key:'executed',secondKey:'traded',label:'date',unit:'个',axis:'Agent 数',filter:'date',source:'PG 用户订单及已归属真实成交 · 北京时间 · 每日分别去重 Agent',note:'当日下单：当天创建订单的 Agent；当日成交：当天发生真实成交的 Agent，包含此前创建的订单。两组不是同一订单批次，成交 Agent 可能多于下单 Agent，不能相除作为转化率。各日人数不可直接相加作为周期去重人数。'});
  const executedUsers=p=>unique(p.os.map(o=>o.ownerClerkUserId)).length;
  metrics=[metric('configured','本期配置用户',current.configured,'人'),metric('executedUsers','本期下单用户',executedUsers(current),'人'),metric('executedAgents','本期下单 Agent',current.executedAgents,'个'),metric('tradeAgents','本期成交 Agent',current.tradeAgents,'个'),metric('filled','本期成交订单',current.filled,'笔'),metric('rate','订单当前失败率',current.rate,'%',{kind:'rate',badUp:true})].map(m=>{const before=m.key==='executedUsers'?(prior?executedUsers(prior):null):prior?.[m.key]??null;return {...m,previous:before,change:compare(m.value,before,m.kind)};});
  rows=rows.map(a=>{const es=current.es.filter(e=>e.agentId===a.id),history=eligible.filter(e=>e.agentId===a.id&&e.executionKind==='TRADE'&&new Date(e.executedAt)<new Date(effective.to));const failed=current.os.filter(o=>o.agentId===a.id&&o.state==='FAILED');return {...a,displayName:(a.name||a.id)+' / '+(userEmails.get(a.clerkUserId)||'邮箱未获取'),registeredAt:a.createdAt,lastActiveAt:history.reduce((last,e)=>!last||new Date(e.executedAt)>new Date(last)?e.executedAt:last,null),stage:history.length?'已成交':a.liveEnabled?'已开启未成交':'已配置未开启',filled:unique(es.map(e=>e.orderId)).length,failed:failed.length,latestFailure:failed.sort((x,y)=>new Date(y.createdAt)-new Date(x.createdAt))[0]||null};});
  columns=[column('displayName','Agent / 所属用户'),column('registeredAt','创建时间','date'),column('lastActiveAt','最近成交','date'),column('stage','阶段'),column('filled','本期成交订单','number'),column('volume','本期成交额 USDT','money')];
  notes.push('实际下单 Agent 仅统计已创建真实用户订单的去重 Agent，不代表全部策略执行或模型调用。异常按失败订单 ID 统计，不将当前资金同步标记当成历史异常次数；Agent 详情包含最新失败订单和原因。');
 }
 if(view==='orders'){
  charts.splice(0,charts.length,{title:'订单与成交趋势',type:'orderTrend',rows:series,key:'volume',label:'date',unit:'USDT',previousKey:previous?'previousVolume':null,filter:'date'},
   {title:'订单状态分布',type:'progress',rows:group(current.os,'state'),key:'value',label:'name',unit:'笔',filter:'status',note:'本期创建订单 · 当前状态'},
   {title:'策略成交贡献',type:'progress',rows:group(current.es,'positionMethod',e=>e.actualFilledValue).sort((a,b)=>new Decimal(b.value).cmp(a.value)),key:'value',label:'name',unit:'USDT',filter:'strategy',note:'本期实际成交金额 · USDT'},
   {title:'失败原因',type:'progress',rows:group(current.os.filter(o=>o.state==='FAILED'),'failureReason'),key:'value',label:'name',unit:'笔',filter:'reason',note:'本期创建的失败订单 · 点击原因筛选整页'});
  const eventKey=x=>x.canonicalEventId||'unrecorded';
  eventRows=unique([...current.os,...current.es].map(eventKey)).map(id=>{const os=current.os.filter(o=>eventKey(o)===id),es=current.es.filter(e=>eventKey(e)===id),meta=os[0]||es[0],failed=os.filter(o=>o.state==='FAILED').length;return {id:id==='unrecorded'?null:id,fixtureName:meta.fixtureName||'未记录赛事',competition:meta.competition||'未记录',users:unique(os.map(o=>o.ownerClerkUserId)).length,orders:os.length,filled:unique(es.map(e=>e.orderId)).length,failed,rate:os.length?failed/os.length*100:null,volume:sum(es,e=>e.actualFilledValue)};}).sort((a,b)=>new Decimal(b.volume).cmp(a.volume));
 }
 if(['orders','order-list'].includes(view)){
  rows=rows.map(o=>({...o,side:unique(eligible.filter(e=>e.orderId===o.id&&e.executionKind==='TRADE'&&new Date(e.executedAt)<new Date(effective.to)).map(e=>e.side)).join(' / ')||null}));
  columns=[column('id','订单'),column('createdAt','创建时间','date'),column('ownerClerkUserId','用户'),column('agentId','Agent'),column('fixtureName','赛事'),column('positionMethod','仓位策略'),column('side','已成交方向'),column('state','当前状态'),column('requestedStake','请求额 USDT','money'),column('amount','截至期末成交额 USDT','money'),column('failureReason','失败原因')];
 }
 if(view==='funds'){
  const amount=charts.find(c=>c.key==='volume'&&c.type==='line');
  const daily=charts.find(c=>c.key==='realizedPnl'&&c.label==='date');
  const cumulative=charts.find(c=>c.key==='cumulativePnl');
  const markets=charts.find(c=>c.type==='pie');
  charts.splice(0,charts.length,amount,{...daily,type:'timeBars',signed:true,axis:'已实现盈亏（USDT）'},{...cumulative,signed:true,axis:'累计已实现盈亏（USDT）'},{...markets,title:'各市场累计盈亏绝对值占比',note:'所选周期 · 按盈亏绝对值计算占比 · 悬浮查看带符号金额'});
 }
 if(view==='events'){
  const ranking=charts.find(c=>c.title==='比赛盈亏排名');
  const palette=['#397bf1','#8959e9','#18b1a2','#f78b26','#e44396','#08a75c','#11a6c2','#8495ac'];
  const allMarkets=unique(d.orders.map(o=>o.competition||'未记录')).sort();
  const activeMarkets=new Set(current.os.map(o=>o.competition||'未记录'));
  const markets=allMarkets.filter(name=>activeMarkets.has(name));
  const marketKeys=markets.map(name=>'market:'+allMarkets.indexOf(name));
  const seriesLabels=Object.fromEntries(markets.map((name,i)=>[marketKeys[i],name]));
  const seriesColors=Object.fromEntries(markets.map((name,i)=>{const n=allMarkets.indexOf(name);return [marketKeys[i],palette[n]||`hsl(${(n*137.508)%360} 60% 45%)`];}));
  const totals=new Map(markets.map(name=>[name,{orders:0,amount:new Decimal(0)}]));
  const seenOrders=new Set();let orderTotal=0,amountTotal=new Decimal(0);
  const dailyOrders=Map.groupBy(current.os,o=>day(o.createdAt));
  const cumulativeOrders=days.map(date=>{
   for(const order of dailyOrders.get(date)||[]){if(seenOrders.has(order.id))continue;seenOrders.add(order.id);orderTotal++;amountTotal=amountTotal.plus(order.requestedStake||0);const total=totals.get(order.competition||'未记录');total.orders++;total.amount=total.amount.plus(order.requestedStake||0);}
   const row={date,orders:orderTotal,amount:amountTotal.toString(),marketOrders:{},marketAmounts:{}};
   markets.forEach((name,i)=>{row.marketOrders[marketKeys[i]]=totals.get(name).orders;row.marketAmounts[marketKeys[i]]=totals.get(name).amount.toString();});
   return row;
  });
  const marketSeries={type:'line',seriesKeys:marketKeys,seriesLabels,seriesColors,seriesLabelType:'market',label:'date',filter:'date',cumulativeOrders:true};
  charts.splice(0,charts.length,
   {...marketSeries,title:'每日累计订单数',rows:cumulativeOrders.map(({marketOrders,marketAmounts,...row})=>({...row,...marketOrders})),key:'orders',unit:'笔',integerTicks:true,axis:'累计订单数（笔）',note:'各市场分别累计 · 所选周期内按创建日期累加 · 订单 ID 去重'},
   {...marketSeries,title:'每日累计下单金额',rows:cumulativeOrders.map(({marketOrders,marketAmounts,...row})=>({...row,...marketAmounts})),key:'amount',unit:'USDT',axis:'累计下单金额（USDT）',note:'各市场分别累计请求金额 · 包含未成交及失败订单'},
   ranking);
 }

 if(view==='platform-pnl-details'){
  const accountModels=new Map(d.platform.map(account=>[account.id,account.modelId]));
  const history=executions.filter(e=>accountModels.has(e.platformModelAccountId)&&new Date(e.executedAt)<new Date(effective.to));
  const pending=e=>e.attributionStatus!=='CONFLICT'&&e.attributionStatus!=='ATTRIBUTED';
  const coveragePnl=periodPnl(history,effective);
  rows=[...new Map(rows.map(row=>[row.modelId,row])).values()].map(row=>{
   const modelHistory=history.filter(e=>accountModels.get(e.platformModelAccountId)===row.modelId),unresolved=modelHistory.filter(pending);
   const accounts=new Set(modelHistory.map(e=>e.platformModelAccountId));
   const issues=new Set(coveragePnl.users.filter(user=>accounts.has(user.id)).flatMap(user=>user.issues));
   if(unresolved.length)issues.add('待归属成交流水');
   if(modelHistory.some(e=>e.attributionStatus==='CONFLICT'))issues.add('归属冲突');
   if(modelHistory.some(e=>e.attributionStatus==='ATTRIBUTED'&&e.executionKind==='TRADE'&&(e.feeAmount==null||!['SHARES','COLLATERAL'].includes(e.feeType))))issues.add('费用证据不完整');
   const hasKnownActivity=modelHistory.some(e=>e.attributionStatus==='ATTRIBUTED'&&within(e.executedAt,effective)),first=unresolved.reduce((time,e)=>!time||new Date(e.executedAt)<new Date(time)?e.executedAt:time,null);
   return {...row,realizedPnl:issues.size&&!hasKnownActivity?null:row.realizedPnl,status:issues.size?'PARTIAL':'RECORDED',issues:[...issues],pendingCount:new Set(unresolved.map(e=>e.sourceEventKey||e.id)).size,pendingDestination:first?{view:'platform-pnl-details',filters:{model:[row.modelId],attribution:['PENDING'],coverage:[]},window:{from:day(first),to:day(new Date(new Date(effective.to)-1))}}:null};
  }).filter(row=>pick('coverage',row.status));
  columns=columns.filter(col=>!['coverage','unrealizedPnl'].includes(col.key));
  columns.push(column('status','覆盖状态'),column('pendingCount','待归属流水（笔）','number'),column('issues','数据问题'));
  notes.push('完整性仅表示已收录流水在当前计算口径内的覆盖情况，不保证账户全部历史完整。待归属笔数按所选截止时间前的流水标识去重，含历史成交及结算；仅根据平台模型账户明确关联模型，不将未知模型流水强行分配。已归属可计算盈亏保留，没有可计算部分时显示 —。');
  if(input.get('attribution')==='PENDING'){
   rows=[...new Map(history.filter(e=>pending(e)&&within(e.executedAt,effective)).map(e=>[e.sourceEventKey||e.id,{...e,modelId:accountModels.get(e.platformModelAccountId)}])).values()];
   columns=[column('modelId','平台模型'),column('sourceEventKey','流水标识'),column('platformModelAccountId','模型账户'),column('executedAt','发生时间','date'),column('executionKind','流水类型'),column('side','方向'),column('actualFilledValue','流水金额 USDT','money'),column('attributionStatus','归属状态'),column('platformOrderId','关联平台订单'),column('transactionHash','交易哈希')];
   notes.push('当前为平台模型待归属流水明细，账户与模型明确不等于流水已归属订单或赛事。流水金额用于排查，未计入正式成交及盈亏；不包含用户账户流水和归属冲突。');
  }
 }
 const attributionNote='待归属成交流水：已获取交易流水，但尚未准确关联订单、Agent 或模型；不等于成交失败或资金丢失。待归属及归属冲突流水暂不计入正式成交额、成交 Agent 和模型盈亏，已归属且可计算部分仍正常统计。';
 const partialNote='盈亏数据不完整（PARTIAL）：存在待归属、归属冲突、历史成本或手续费信息不完整等问题；当前金额仅为已归属可计算部分，不代表账户完整净盈亏，也不是订单部分成交。';
 rows=rows.map(row=>{const issues=row.issues||[];const descriptions=[];
  if(row.attributionStatus==='UNATTRIBUTED'||issues.includes('待归属成交流水')||issues.includes('未归属成交')||row.coverage==='存在待归属流水')descriptions.push(attributionNote);
  if(row.attributionStatus==='CONFLICT'||issues.includes('归属冲突'))descriptions.push('归属冲突：流水的关联证据不一致，暂不能确定归属；排除在正式成交及盈亏汇总之外，不表示成交失败。');
  if(row.status==='PARTIAL')descriptions.push(partialNote);
  return descriptions.length?{...row,dataExplanation:descriptions.join(' ')}:row;
 });
 if(['funds','platform','platform-pnl','platform-pnl-details','events','quality'].includes(view))notes.push(attributionNote,partialNote);
 // Detail filters retain the time basis used by the originating chart.
 if(['order-list','platform-orders'].includes(view)&&input.get('orderBasis')==='traded'){
  const tradedIds=new Set(current.es.map(e=>e.orderId));
  rows=orderCandidates.filter(o=>tradedIds.has(o.id)).map(o=>({...o,amount:sum(current.es.filter(e=>e.orderId===o.id),e=>e.actualFilledValue),side:unique(current.es.filter(e=>e.orderId===o.id).map(e=>e.side)).join(' / ')}));
  columns=columns.map(c=>c.key==='amount'?{...c,label:'本期成交额 USDT'}:c);
 }
 if(view==='executions'){
  const buckets=new Map(),seen=new Set();
  rows.forEach((e,index)=>{
   const identity=[e.ownerClerkUserId,e.agentId,e.orderId];
   if(e.sourceEventKey){const source=JSON.stringify([...identity,e.executionKind,e.sourceEventKey]);if(seen.has(source))return;seen.add(source);}
   const key=JSON.stringify(e.orderId?[...identity]:[...identity,e.sourceEventKey||index]);
   if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e);
  });
  rows=[...buckets.values()].filter(events=>events.some(e=>pick('executionKind',e.executionKind))).map(events=>{
   const trades=events.filter(e=>e.executionKind==='TRADE'),settlements=events.filter(e=>e.executionKind==='SETTLEMENT');
   const latest=list=>list.reduce((value,e)=>!value||new Date(e.executedAt)>new Date(value)?e.executedAt:value,null);
   const fees=[...Map.groupBy(events,e=>e.feeType||'未记录')].map(([unit,list])=>`${sum(list,e=>e.feeAmount)} ${unit}`).join(' / ');
   return {...events[0],sourceEventKey:unique(events.map(e=>e.sourceEventKey)).join(' / '),executionKind:trades.length&&settlements.length?'成交及结算':trades.length?'仅成交':'仅结算',executedAt:latest(events),tradeAt:latest(trades),settlementAt:latest(settlements),tradeAmount:sum(trades,e=>e.actualFilledValue),settlementAmount:sum(settlements,e=>e.actualFilledValue),tradeCount:trades.length,settlementCount:settlements.length,side:unique(trades.map(e=>e.side)).join(' / '),fees,events};
  });
  columns=[column('orderId','订单'),column('ownerClerkUserId','用户'),column('fixtureName','赛事'),column('executionKind','本期记录类型'),column('tradeAt','最近成交时间','date'),column('settlementAt','最近结算时间','date'),column('side','成交方向'),column('tradeAmount','本期成交金额 USDT','money'),column('settlementAmount','本期结算回款 USDT','money'),column('tradeCount','成交流水数','number'),column('settlementCount','结算流水数','number'),column('fees','本期手续费（按单位）')];
  notes.push('成交与结算明细按用户、Agent 和订单合并为一行；成交金额与结算回款分别汇总所选期间的流水，不相加作为成交额。没有订单关联的流水单独保留。仅成交／仅结算表示本期记录类型，不代表订单最终结算状态；详情保留原始流水。');
 }
 if(view==='executions'&&input.get('attribution')==='PENDING'){
  const pending=executions.filter(e=>e.attributionStatus!=='CONFLICT'&&(e.attributionStatus!=='ATTRIBUTED'||!e.agentId)&&within(e.executedAt,effective));
  rows=[...new Map(pending.map(e=>[e.sourceEventKey||e.id,e])).values()];
  columns=[column('sourceEventKey','流水标识'),column('ownerClerkUserId','用户'),column('executedAt','发生时间','date'),column('executionKind','流水类型'),column('side','方向'),column('actualFilledValue','流水金额 USDT','money'),column('attributionStatus','归属状态'),column('orderId','关联订单'),column('agentId','关联 Agent'),column('transactionHash','交易哈希')];
  charts.length=0;metrics=[];
  notes.push('当前为待归属流水排查明细，按流水标识去重，包含归属未完成或缺少 Agent 的记录，不含归属冲突。金额仅供核查，未加入正式成交和盈亏统计。');
 }
 if(view==='quality')rows=rows.filter(e=>pick('attribution',e.attributionStatus));
 if(view==='analyses')rows=rows.filter(e=>pick('analysisState',e.stateLabel));
 if(view==='agents'){
  const activity=input.get('agentActivity');const active=new Set((activity==='traded'?current.es:current.os).map(x=>x.agentId));
  rows=rows.filter(a=>pick('liveState',a.liveEnabled)&&pick('agent',a.id)&&(!activity||(activity==='created'?within(a.createdAt,effective):active.has(a.id))));
 }
 if(['user-list','user-details'].includes(view)){
  const population=input.get('population');const cohort=registrationCohortMembers(users.filter(u=>clerk.some(c=>c.id===u.id)),d.bindings,d.agents,d.executions,effective,effective.to);
  const activityIds=new Set((population==='ordered'?current.os:current.es).map(x=>x.ownerClerkUserId));
  if(input.get('cohortStep')){const sets=sevenDayMembers(users,{range:effective,bindings:d.bindings,agents:d.agents,orders:orderCandidates,trades:eligible}),members=new Set((identity.status==='AVAILABLE'?sets[input.get('cohortStep')]||[]:[]).map(u=>u.id));rows=rows.filter(u=>members.has(u.id));}
  rows=rows.filter(u=>!population||population==='registered'&&within(u.registeredAt,effective)||population==='registeredEnd'&&clerk.some(c=>c.id===u.id)&&u.registeredAt&&new Date(u.registeredAt)<new Date(effective.to)||population==='boundEnd'&&clerk.some(c=>c.id===u.id)&&u.registeredAt&&new Date(u.registeredAt)<new Date(effective.to)&&d.bindings.some(b=>b.clerkUserId===u.id&&b.verifiedAt&&new Date(b.verifiedAt)<new Date(effective.to))||population==='configured'&&d.agents.some(a=>a.clerkUserId===u.id&&within(a.createdAt,effective))||population==='firstTraders'&&within(firstTrades.get(u.id),effective)||['traded','ordered'].includes(population)&&activityIds.has(u.id)||population.startsWith('cohort-')&&(cohort[population.slice(7)]||[]).some(x=>x.id===u.id));
  charts.splice(0,charts.length,{title:'用户与 Agent 数量分布',type:'progress',rows:agentBands.map(name=>{const members=rows.filter(u=>agentBand(u.agentCount)===name);return {name,value:members.length,percentage:rows.length?members.length/rows.length*100:null,agentTotal:members.reduce((total,u)=>total+u.agentCount,0)};}),key:'value',label:'name',unit:'人',filter:'agentBand'}, {title:'用户阶段分布',type:'progress',rows:options.stage.map(name=>({name,value:rows.filter(u=>u.stage===name).length})),key:'value',label:'name',unit:'人',filter:'stage'});
 }
 if(['order-list','platform-orders'].includes(view))charts.length=0;
 if(view==='agents'){const kept=charts.filter(c=>c.title!=='模型成交贡献');charts.splice(0,charts.length,...kept);}
 if(view==='funds'){const kept=charts.filter(c=>c.key!=='volume');charts.splice(0,charts.length,...kept);}
 if(view==='platform-pnl'){const kept=charts.filter(c=>!['平台模型成交额','平台模型盈亏分量'].includes(c.title));charts.splice(0,charts.length,...kept);}
 if(['platform-pnl-details','user-details'].includes(view))charts.length=0;
 if(view==='executions'){const kept=charts.filter(c=>c.title==='每日成交订单'||c.key==='volume');for(const c of kept)if(c.key==='volume'){c.title='每日成交金额';c.note='按实际成交日期统计 · 单位 USDT · 不含结算回款';}charts.splice(0,charts.length,...kept);}
 // Section summaries own the deduplicated KPI cards; child pages retain their analysis and details.
 if(['user-list','user-details','agents','funds','order-list','executions','failures','platform-orders','platform-pnl','platform-pnl-details'].includes(view))metrics=[];
 if(view==='events'){
  const perf=executionPerformance(eligible,effective,days);
  const orders=[...new Map(current.os.map(o=>[o.id,o])).values()];
  const ranks=(field)=>[...Map.groupBy(orders.filter(o=>o[field]),o=>o[field])].map(([id,items])=>({id,name:field==='modelId'?String(id).split('/').at(-1):items[0].fixtureName||id,orders:items.length,amount:sum(items,o=>o.requestedStake)}));
  const eventNames=new Map([...orders,...eligible].filter(e=>e.canonicalEventId).map(e=>[e.canonicalEventId,e.fixtureName||e.canonicalEventId]));
  metrics=[];
  for(const [dimension,label,field,pnlRows] of [['event','赛事','canonicalEventId',perf.events],['model','模型','modelId',perf.models]]){
   const orderRanks=ranks(field),profitRanks=pnlRows.filter(x=>x[dimension==='event'?'eventId':'modelId']).map(x=>({id:x[dimension==='event'?'eventId':'modelId'],name:dimension==='event'?eventNames.get(x.eventId)||x.fixtureName||x.eventId:String(x.modelId).split('/').at(-1),pnl:x.realizedPnl}));
   for(const [suffix,title,key,unit,list,ascending] of [['profit','最高盈利','pnl','USDT',profitRanks.filter(x=>new Decimal(x.pnl||0).gt(0)),false],['orders','下单笔数最多','orders','笔',orderRanks,false],['amount','下单金额最高','amount','USDT',orderRanks,false]]){
    const sorted=[...list].sort((a,b)=>(ascending?1:-1)*new Decimal(a[key]||0).cmp(b[key]||0)||String(a.id).localeCompare(String(b.id))),winner=sorted[0];
    const ties=winner?sorted.filter(x=>new Decimal(x[key]||0).eq(winner[key]||0)).length:0;
    const basis=key==='pnl'?'所选周期 · 已归属已实现盈亏分量':key==='orders'?'所选周期 · 创建订单去重':'所选周期 · 请求金额（含失败及未成交）';
    metrics.push(metric(`${dimension}-${suffix}`,`${label}${title}`,winner?.[key]??null,unit,{note:winner?`${winner.name}${ties>1?`（并列 ${ties} 项）`:''} · ${basis}`:`暂无${title.includes('盈利')?'盈利':title.includes('亏损')?'亏损':'下单'}记录`,destination:winner?{view:dimension==='event'&&key==='pnl'?'event-analysis':key==='pnl'?'funds':'order-list',filters:{[dimension]:[winner.id]}}:null}));
   }
  }
  notes.push('赛事和模型统计沿用本页普通用户订单范围；下单金额为所选期间创建订单的请求金额，包含失败及未成交。盈亏仅使用已归属可计算分量，缺少赛事或模型关联的记录不参与对应排名；并列时展示其中一项并标记并列数量。');
 }
 if(view==='platform-orders'){
  rows=rows.map(o=>{const outcome={HOME:`${o.homeTeamName||'主队'}胜`,AWAY:`${o.awayTeamName||'客队'}胜`,DRAW:'平局',home_win:`${o.homeTeamName||'主队'}胜`,away_win:`${o.awayTeamName||'客队'}胜`,draw:'平局'}[o.canonicalOutcome];return {...o,betDirection:outcome?(o.positionSide==='NO'?`否：${outcome}`:o.positionSide==='YES'?outcome:`${outcome}（买入方向未记录）`):'未记录'};});
  const index=columns.findIndex(c=>c.key==='fixtureName');columns.splice(index+1,0,column('betDirection','下注方向'));
 }
 if(view==='events'){
  const times=new Map((d.eventRevisions||[]).map(e=>[e.eventId,e.kickoffAt]));
  rows=rows.map(e=>({...e,kickoffAt:times.get(e.eventId)||[...current.os,...eligible].find(x=>x.canonicalEventId===e.eventId&&x.kickoffAt)?.kickoffAt||null,models:(e.models||[]).map(m=>({...m,direction:unique(eligible.filter(x=>x.canonicalEventId===e.eventId&&x.modelId===m.modelId&&new Date(x.executedAt)<new Date(effective.to)&&x.executionKind==='TRADE'&&x.side==='BUY').map(directionLabel)).join('、')||'未记录'}))}));
 }
 if(['users','orders','agents','platform','events','funds','platform-pnl'].includes(view)){
  const extra=linkedInsights({view,users,orders:current.os,trades:current.es,eligible,bindings:d.bindings,agents:d.agents,historyOrders:orderCandidates,days,range:effective,known:identity.status==='AVAILABLE',modelRows:view==='agents'?[true,false].map(live=>({live,agents:d.agents.filter(a=>ids.has(a.clerkUserId)&&pick('liveState',a.liveEnabled)&&pick('agent',a.id)&&Boolean(a.liveEnabled)===live)})):view==='platform'?rows:[],performance:linkedPerformance,marketPnl:view==='events'?linkedPerformance?.details||[]:[]});
  if(view==='users'){
   const registration=charts.find(c=>c.key==='registered'),trend=extra.find(c=>c.type==='linkedTrend'&&c.key==='registered');
   if(trend&&registration){
    const previousByDate=new Map(registration.rows.map(row=>[row.date,row]));
    if(previous){
     const pairs=[['previousRegistered','新增注册','#a5b4a2'],['previousOrderedUsers','下单用户','#d6bc9c'],['previousTradedUsers','成交用户','#9bcdb0']];
     trend.rows=trend.rows.map(row=>({...row,...Object.fromEntries(pairs.map(([key])=>[key,previousByDate.get(row.date)?.[key]??null]))}));
     for(const [key,label,color] of pairs){trend.seriesKeys.push(key);trend.seriesLabels[key]=label+'（上期按天对齐）';trend.seriesColors[key]=color;}
     trend.seriesDash=Object.fromEntries(pairs.map(([key])=>[key,'5 5']));
    }
    trend.note+=' 新增注册、下单用户和成交用户均按上一等长周期对齐；未结束日按已观察时长对齐。下单按订单创建时间，成交按实际成交时间；下单用户含失败及未成交订单，同一用户同日多笔订单、成交或多个 Agent 仅计 1 人。';
    trend.hideDrillSelect=true;
    const phase=extra.find(c=>c.title==='周期前后段参与对比');if(phase){phase.userComparison=true;const labels={registered:'新增注册',avgRegistered:'日均新增注册',ordered:'下单用户',avgOrdered:'日均下单用户',traded:'成交用户',avgTraded:'日均成交用户'};phase.columns=phase.columns.map(c=>({...c,label:labels[c.key]||c.label}));phase.note+=' 变化百分比 =（后段 − 前段）÷ 前段 × 100%；总量与日均分别计算。';}
    const participation=extra.find(c=>c.userParticipation);
    const retained=charts.filter(c=>c!==registration&&c.key!=='orderedUsers'),bottom=retained.filter(c=>c.type==='funnel'||c.title==='用户阶段分布');
    charts.splice(0,charts.length,trend,...[phase,participation].filter(Boolean),...extra.filter(c=>![trend,phase,participation].includes(c)),...retained.filter(c=>!bottom.includes(c)),...bottom);
   }else charts.unshift(...extra);
  }else if(view==='orders'){
   const trend=extra.find(c=>c.type==='linkedTrend'),byDate=new Map(series.map(row=>[row.date,row]));
   trend.rows=trend.rows.map(row=>{const source=byDate.get(row.date);let previousFailed=null;
    if(previous){const from=Math.max(+new Date(effective.from),+new Date(row.date+'T00:00:00+08:00')),to=Math.min(+new Date(effective.to),+new Date(row.date+'T00:00:00+08:00')+86400000),offset=+new Date(previous.from)-new Date(effective.from);previousFailed=flows({from:new Date(from+offset).toISOString(),to:new Date(to+offset).toISOString()}).failed;}
    return {...row,volume:source.volume,previousOrders:source.previousOrders??null,previousFilled:source.previousFilled??null,previousVolume:source.previousVolume??null,previousFailed};
   });
   Object.assign(trend.seriesLabels,{volume:'实际成交金额',previousOrders:'下单订单（上期对齐）',previousFilled:'成交订单（上期对齐）',previousFailed:'失败订单（上期对齐）',previousVolume:'成交金额（上期对齐）'});
   Object.assign(trend.seriesColors,{volume:'#f78b26',previousOrders:'#9bb8e5',previousFilled:'#9bcdb0',previousFailed:'#e6a7a3',previousVolume:'#d6bc9c'});
   trend.orderCombo=true;trend.title='下单、成交、失败订单数与成交金额每日对照';
   trend.seriesDash=Object.fromEntries(['previousOrders','previousFilled','previousFailed','previousVolume'].map(key=>[key,'5 5']));
   trend.unitGroups=[{title:'下单、成交与失败订单数',unit:'笔',axis:'订单数（笔）',integerTicks:true,key:'orders',seriesKeys:['orders','filled','failed',...(previous?['previousOrders','previousFilled','previousFailed']:[])],drillChoices:trend.drillChoices},{title:'实际成交金额',unit:'USDT',axis:'成交金额（USDT）',integerTicks:false,key:'volume',seriesKeys:['volume',...(previous?['previousVolume']:[])],drillChoices:[{key:'volume',label:'当天成交金额明细'}]}];
   trend.tooltipSeriesKeys=trend.unitGroups.flatMap(group=>group.seriesKeys);trend.tooltipUnits=Object.fromEntries(trend.tooltipSeriesKeys.map(key=>[key,/volume/i.test(key)?'USDT':'笔']));
   trend.note+=' 左轴柱状表示订单数（笔），右轴折线表示实际成交金额（USDT，含买入与卖出，不含结算回款）。悬浮日期查看本期、上期及变化百分比；上期按等长周期对齐，未结束日按已观察时长对齐。点击对应柱子或折线圆点查看明细。';
   charts.splice(0,charts.length,trend,...charts.filter(c=>c.type!=='orderTrend'),...extra.filter(c=>c!==trend));
  }else if(view==='agents'){
   const trend=extra.find(c=>c.type==='linkedTrend'),catalog=new Set(d.agents.filter(a=>ids.has(a.clerkUserId)&&pick('liveState',a.liveEnabled)&&pick('agent',a.id)).map(a=>a.id));
   trend.rows=trend.rows.map(row=>{
    const ordering=new Set(current.os.filter(o=>catalog.has(o.agentId)&&day(o.createdAt)===row.date).map(o=>o.agentId)),trading=unique(current.es.filter(e=>catalog.has(e.agentId)&&day(e.executedAt)===row.date).map(e=>e.agentId)),both=trading.filter(id=>ordering.has(id)).length;
    let previousCreatedAgents=null,previousOrderedAgents=null,previousTradedAgents=null;
    if(previous){
     const from=Math.max(+new Date(effective.from),+new Date(row.date+'T00:00:00+08:00')),to=Math.min(+new Date(effective.to),+new Date(row.date+'T00:00:00+08:00')+86400000),offset=+new Date(previous.from)-new Date(effective.from);
     const window={from:new Date(from+offset).toISOString(),to:new Date(to+offset).toISOString()};
     previousCreatedAgents=unique(d.agents.filter(a=>catalog.has(a.id)&&within(a.createdAt,window)).map(a=>a.id)).length;
     previousOrderedAgents=unique(orderCandidates.filter(o=>catalog.has(o.agentId)&&within(o.createdAt,window)).map(o=>o.agentId)).length;
     previousTradedAgents=unique(eligible.filter(e=>catalog.has(e.agentId)&&e.executionKind==='TRADE'&&within(e.executedAt,window)).map(e=>e.agentId)).length;
    }
    return {...row,both,tradedWithoutNewOrder:trading.length-both,previousCreatedAgents,previousOrderedAgents,previousTradedAgents};
   });
   trend.seriesLabels.orderedAgents='当日下单 Agent（订单创建日）';trend.seriesLabels.tradedAgents='当日成交 Agent（实际成交日）';
   if(previous){
    const pairs=[['previousCreatedAgents','新建 Agent','#bca5db'],['previousOrderedAgents','下单 Agent','#a5b4a2'],['previousTradedAgents','成交 Agent','#9bcdb0']];
    for(const [key,label,color] of pairs){trend.seriesKeys.push(key);trend.seriesLabels[key]=label+'（上期按天对齐）';trend.seriesColors[key]=color;}
    trend.seriesDash=Object.fromEntries(pairs.map(([key])=>[key,'5 5']));
   }
   trend.tooltipSeriesKeys=[...trend.seriesKeys,'both','tradedWithoutNewOrder'];trend.tooltipLabels={...trend.seriesLabels,both:'成交 Agent 中，当日也有新下单',tradedWithoutNewOrder:'成交 Agent 中，当日无新下单'};trend.seriesColors.both=trend.seriesColors.tradedAgents;trend.seriesColors.tradedWithoutNewOrder=trend.seriesColors.tradedAgents;
   trend.note+=' 当日成交可能来自此前创建的订单，成交 Agent 可以多于下单 Agent，不能相除作为转化率。悬浮拆分按 Agent 当天是否另有新下单，不代表成交订单的创建日期；各日人数不能直接相加作为周期去重人数。新建、下单和成交 Agent 均保留上一等长周期按天对齐对比；本期未结束日按实际已观察时长对齐。';
   charts.splice(0,charts.length,trend,...charts.filter(c=>!['每日实际下单 Agent 趋势','每日下单与成交 Agent 活跃对比'].includes(c.title)),...extra.filter(c=>c!==trend));
  }else if(['platform','events'].includes(view)){
   const daily=extra.filter(c=>c.type==='linkedTrend'),money=daily.find(c=>c.unit==='USDT');
   const merged={...money,title:platform?'平台模型下单、成交与盈亏每日对照':'市场下单、成交与盈亏每日对照',seriesLabels:money.tooltipLabels,seriesKeys:money.tooltipSeriesKeys,unitGroups:daily.map(c=>({title:c.unit==='笔'?'下单与成交订单数':'成交金额与已实现盈亏',unit:c.unit,axis:c.axis,integerTicks:c.integerTicks,key:c.key,seriesKeys:c.seriesKeys,drillChoices:c.drillChoices.filter(choice=>c.seriesKeys.includes(choice.key))})),note:money.note+' 订单数与金额分开刻度；同日悬浮联动。市场累计订单数和累计请求金额仍单独展示，不与每日成交金额混用。'};
   charts.splice(0,charts.length,...charts,merged,...extra.filter(c=>c.type!=='linkedTrend'));
  }else if(['funds','platform-pnl'].includes(view)){
   const trend=extra.find(c=>c.type==='linkedTrend');
   trend.mergedFinance=true;
   if(view==='funds'){trend.hideDrillSelect=true;trend.hideNote=true;}
   trend.note+=' 每日成交金额与每日已实现盈亏在本图统一对照，单位均为 USDT；累计盈亏在独立图表展示。黄色标记反映盈亏覆盖情况，历史待归属流水可能影响当日盈亏，不表示当日成交金额全部无效。';
   charts.splice(0,charts.length,trend,...charts.filter(c=>!(c.label==='date'&&(c.key==='volume'||view==='funds'&&c.key==='realizedPnl'))),...extra.filter(c=>c!==trend));
  }else charts.push(...extra);
 }
 if(['platform','events'].includes(view)){
  const history=[...new Map(executions.filter(e=>new Date(e.executedAt)<new Date(effective.to)).map(e=>[e.sourceEventKey||e.id,e])).values()];
  const pending=e=>e.attributionStatus!=='CONFLICT'&&(e.attributionStatus!=='ATTRIBUTED'||!e.agentId);
  const accountModels=new Map(d.platform.map(a=>[a.id,a.modelId]));
  const market=e=>e.competition&&e.competition!=='未记录'?e.competition:null;
  const quality=(events,filters)=>{
   const unresolved=events.filter(pending),issues=new Set(periodPnl(events,{from:new Date(0).toISOString(),to:effective.to}).users.flatMap(u=>u.issues));
   if(unresolved.length)issues.add('待归属成交流水');if(events.some(e=>e.attributionStatus==='CONFLICT'))issues.add('归属冲突');
   return {incomplete:issues.size>0,pendingCount:unresolved.length,issues:[...issues],summary:'按截止期末去重，含历史成交及结算；仅表示明确属于该对象的流水。',destination:unresolved.length?{view:platform?'platform-pnl-details':'executions',filters:{...filters,attribution:['PENDING'],coverage:[],executionKind:[],orderBasis:[]},window:{from:day(unresolved.reduce((a,e)=>new Date(e.executedAt)<new Date(a)?e.executedAt:a,unresolved[0].executedAt)),to:day(new Date(new Date(effective.to)-1))}}:null};
  };
  const byModel=id=>quality(history.filter(e=>accountModels.get(e.platformModelAccountId)===id),{model:[id]});
  if(view==='events'){
   const eventId=e=>e.canonicalEventId&&!['未记录','undefined','null'].includes(e.canonicalEventId)?e.canonicalEventId:null;
   const unknown=history.filter(e=>!eventId(e)&&pending(e));
   if(unknown.length)unassignedEventQuality=quality(unknown,{event:['未记录']});
   const pendingIds=unique(history.filter(pending).map(eventId));
   for(const id of pendingIds)if(!rows.some(row=>row.eventId===id)){
    const source=history.find(e=>eventId(e)===id),meta=orderCandidates.find(o=>o.canonicalEventId===id);
    rows.push({eventId:id,fixtureName:source.fixtureName||meta?.fixtureName||id,competition:source.competition||null,kickoffAt:(d.eventRevisions||[]).find(e=>e.eventId===id)?.kickoffAt||null,realizedPnl:null,buyValue:null,orderCount:0,models:[]});
   }
   rows=rows.map(row=>{
    const events=history.filter(e=>eventId(e)===row.eventId),filters={event:[row.eventId]},q=quality(events,filters),models=[...(row.models||[])];
    for(const id of unique(events.filter(pending).map(e=>e.modelId)))if(!models.some(m=>m.modelId===id))models.push({modelId:id,buyValue:null,returnValue:null,realizedPnl:null,direction:'未记录'});
    return {...row,dataQuality:q,models:models.map(m=>({...m,dataQuality:quality(events.filter(e=>e.modelId===m.modelId),{...filters,model:[m.modelId]})})),unassignedModelPendingCount:events.filter(e=>pending(e)&&!e.modelId).length};
   });
   const ranking=charts.find(c=>c.title==='比赛盈亏排名');if(ranking){ranking.rows=rows;ranking.note='仅已归属可计算盈亏；黄色 ! 表示数据不完整，悬浮查看待归属笔数，点击标记查看流水。仅待归属、无可计算盈亏的比赛显示 —。';}
   notes.push('赛事完整性按流水明确记录的赛事 ID 判断，不按比赛名称、球队或日期猜测。无法确认赛事的待归属流水单独提示，不分摊；单场中无法确认模型的笔数只计入赛事，不分摊给模型。');
  }

  for(const c of charts){
   if(c.type==='modelComparison'&&c.key==='realizedPnl')c.rows=c.rows.map(row=>({...row,dataQuality:byModel(row.modelId)}));
   if(!c.businessComparison)continue;
   if(platform)c.rows=c.rows.map(row=>({...row,dataQuality:byModel(row.values.modelId)}));
   else{
    const names=unique(history.filter(pending).map(market));
    for(const name of names)if(!c.rows.some(row=>row.name===name))c.rows.push({name,values:{users:0,traders:0,orders:0,filled:0,volume:'0',pnl:null},links:{}});
    c.rows=c.rows.map(row=>({...row,dataQuality:row.name==='未记录'?null:quality(history.filter(e=>market(e)===row.name),{market:[row.name]})}));
    const unknown=history.filter(e=>!market(e)&&pending(e));
    if(unknown.length)c.unassignedQuality=quality(unknown,{market:['未记录']});
   }
   c.note+=' 黄色标记表示盈亏数据不完整，保留已归属可计算金额；待归属笔数含截止期末的历史流水，按流水标识去重。未知市场单独列示，不分摊到任何市场。';
  }
 }
 if(['funds','platform-pnl','platform','events'].includes(view)){
  const uniqueEvents=xs=>[...new Map(xs.map(e=>[e.sourceEventKey||e.id,e])).values()];
  const history=uniqueEvents(executions.filter(e=>new Date(e.executedAt)<new Date(effective.to)));
  const pending=e=>e.attributionStatus!=='CONFLICT'&&(e.attributionStatus!=='ATTRIBUTED'||!e.agentId);
  const coverage=new Map(days.map(date=>{
   const to=new Date(Math.min(+new Date(date+'T00:00:00+08:00')+86400000,+new Date(effective.to))).toISOString();
   const before=history.filter(e=>new Date(e.executedAt)<new Date(to)),unresolved=before.filter(pending),today=unresolved.filter(e=>day(e.executedAt)===date);
   const issues=new Set(periodPnl(before,{from:new Date(0).toISOString(),to}).users.flatMap(u=>u.issues));
   if(unresolved.length)issues.add('待归属成交流水');if(before.some(e=>e.attributionStatus==='CONFLICT'))issues.add('归属冲突');
   const destination=events=>events.length?{view:platform?'platform-pnl-details':'executions',filters:{attribution:['PENDING'],coverage:[],executionKind:[],orderBasis:[]},window:{from:day(events.reduce((a,e)=>new Date(e.executedAt)<new Date(a)?e.executedAt:a,events[0].executedAt)),to:date}}:null;
   return [date,{pnl:{incomplete:issues.size>0,pendingCount:unresolved.length,dailyPendingCount:today.length,historicalPendingCount:unresolved.length-today.length,issues:[...issues],destination:destination(unresolved)},trade:{incomplete:today.length>0||before.some(e=>day(e.executedAt)===date&&e.attributionStatus==='CONFLICT'),pendingCount:today.length,dailyPendingCount:today.length,historicalPendingCount:0,issues:[],destination:destination(today)}}];
  }));
  for(const c of charts.filter(c=>c.phaseComparison)){
   c.rows=c.rows.map(row=>{
    const window=Object.values(row.links||{}).find(link=>link.window)?.window;if(!window)return row;
    const end=coverage.get(window.to)?.pnl;if(!end)return row;
    const inside=history.filter(e=>day(e.executedAt)>=window.from&&day(e.executedAt)<=window.to),pendingInside=inside.filter(pending);
    const target=events=>events.length?{view:platform?'platform-pnl-details':'executions',filters:{attribution:['PENDING'],coverage:[],executionKind:[],orderBasis:[]},window:{from:day(events.reduce((a,e)=>new Date(e.executedAt)<new Date(a)?e.executedAt:a,events[0].executedAt)),to:window.to}}:null;
    const trade={incomplete:pendingInside.length>0||inside.some(e=>e.attributionStatus==='CONFLICT'),pendingCount:pendingInside.length,periodPendingCount:pendingInside.length,historicalPendingCount:0,issues:inside.some(e=>e.attributionStatus==='CONFLICT')?['归属冲突']:[],destination:target(pendingInside)};
    const pnl={...end,periodPendingCount:pendingInside.length,historicalPendingCount:end.pendingCount-pendingInside.length};
    return {...row,dataQuality:pnl,qualityByKey:Object.fromEntries(c.columns.map(col=>[col.key,/pnl/i.test(col.key)?pnl:trade]))};
   });
   c.note+=' 黄色标记表示该段数据不完整；受影响指标暂停涨跌、转盈转亏判断。待归属笔数按流水去重，盈亏包含段前历史问题，非每日笔数相加；前后段可能包含同一历史流水。';
  }
  for(const c of charts){if(c.label!=='date'||!(c.type==='linkedTrend'||['volume','realizedPnl','cumulativePnl'].includes(c.key))||c.cumulativeOrders)continue;
   const basis=c.key==='volume'&&!c.seriesKeys?.includes('realizedPnl')?'trade':'pnl';
   c.rows=c.rows.map(row=>({...row,dataQuality:coverage.get(row.date)?.[basis]}));
   c.qualityNote=view==='funds'?'本页面已排除待归属流水；黄色 ! 表示仍有归属冲突、成本或费用等计算问题，保留已知金额。':'黄色 ! 表示数据不完整；悬浮查看当日及历史待归属笔数，点击标记查看流水。盈亏沿用历史成本，历史问题可能持续影响后续日期；已知金额仍保留。';
  }
 }
 // Compare adjacent equal-duration periods, never halves of the selected period.
 for(const chart of charts.filter(c=>c.phaseComparison||c.title==='周期前后段参与对比')){
  chart.phaseComparison=true;chart.periodComparison=true;
  chart.title=chart.title.replace('周期前后段参与对比','本期与上期参与对比').replace('周期前后段表现对比','本期与上期表现对比');
  const financial=['funds','platform-pnl','platform','events'].includes(view),agentView=view==='agents';
  const catalog=new Set(d.agents.filter(a=>ids.has(a.clerkUserId)&&pick('liveState',a.liveEnabled)&&pick('agent',a.id)).map(a=>a.id));
  const duration=(+new Date(effective.to)-new Date(effective.from))/86400000;
  const fmt=t=>new Date(+new Date(t)+28800000).toISOString().slice(0,16).replace('T',' ');
  chart.rows=previous?[previous,effective].map((period,i)=>{
   const f=flows(period),os=agentView?f.os.filter(o=>catalog.has(o.agentId)):f.os,es=agentView?f.es.filter(e=>catalog.has(e.agentId)):f.es;
   const distinct=(items,key)=>unique(items.map(x=>x[key])).length;
   const average=(items,time,key)=>[...Map.groupBy(items,x=>day(x[time])).values()].reduce((n,items)=>n+distinct(items,key),0)/duration;
   const values={registered:f.registered,ordered:distinct(os,'ownerClerkUserId'),traded:distinct(es,'ownerClerkUserId'),orders:distinct(os,'id'),filled:distinct(es,'orderId'),failed:os.filter(o=>o.state==='FAILED').length,volume:Number(f.volume)};
   values.failureRate=values.orders?values.failed/values.orders*100:null;
   values.avgRegistered=f.registered==null?null:f.registered/duration;
   values.avgOrdered=average(os,'createdAt',agentView?'agentId':'ownerClerkUserId');values.avgTraded=average(es,'executedAt',agentView?'agentId':'ownerClerkUserId');
   values.avgOrders=average(os,'createdAt','id');values.avgFilled=average(es,'executedAt','orderId');values.avgVolume=values.volume/duration;
   if(agentView){values.created=distinct(d.agents.filter(a=>catalog.has(a.id)&&within(a.createdAt,period)),'id');values.ordered=distinct(os,'agentId');values.traded=distinct(es,'agentId');}
   let dataQuality,qualityByKey;
   if(financial){
    const history=[...new Map(executions.filter(e=>new Date(e.executedAt)<new Date(period.to)).map(e=>[e.sourceEventKey||e.id,e])).values()];
    const pnl=periodPnl(history,period);values.realizedPnl=Number(pnl.value);values.avgPnl=values.realizedPnl/duration;
    const pending=history.filter(e=>e.attributionStatus!=='CONFLICT'&&(e.attributionStatus!=='ATTRIBUTED'||!e.agentId)),inside=history.filter(e=>within(e.executedAt,period)),pendingInside=pending.filter(e=>within(e.executedAt,period));
    const issues=[...new Set(pnl.users.flatMap(u=>u.issues))];if(pending.length&&!issues.includes('待归属成交流水'))issues.push('待归属成交流水');if(history.some(e=>e.attributionStatus==='CONFLICT'))issues.push('归属冲突');
    const target=items=>items.length?{view:platform?'platform-pnl-details':'executions',window:{from:day(items.reduce((a,e)=>new Date(e.executedAt)<new Date(a)?e.executedAt:a,items[0].executedAt)),to:day(+new Date(period.to)-1)},filters:{attribution:['PENDING'],coverage:[],executionKind:[],orderBasis:[],comparisonTo:[period.to]}}:null;
    dataQuality={incomplete:issues.length>0,pendingCount:pending.length,periodPendingCount:pendingInside.length,historicalPendingCount:pending.length-pendingInside.length,issues,destination:target(pending)};
    const trade={incomplete:pendingInside.length>0||inside.some(e=>e.attributionStatus==='CONFLICT'),pendingCount:pendingInside.length,periodPendingCount:pendingInside.length,historicalPendingCount:0,issues:inside.some(e=>e.attributionStatus==='CONFLICT')?['归属冲突']:[],destination:target(pendingInside)};
    qualityByKey=Object.fromEntries(chart.columns.map(c=>[c.key,/pnl/i.test(c.key)?dataQuality:trade]));
   }
   const window={from:day(period.from),to:day(+new Date(period.to)-1)};
   const links=Object.fromEntries(chart.columns.map(({key})=>{
    const metric=key==='avgPnl'?'realizedPnl':key.replace(/^avg([A-Z])/,(_,x)=>x.toLowerCase());let target;
    if(view==='users')target={view:'user-details',filters:{population:[metric]}};
    else if(agentView)target={view:'agents',filters:{agentActivity:[metric==='created'?'created':metric==='traded'?'traded':'ordered']}};
    else if(metric==='realizedPnl')target={view:platform?'platform-pnl-details':'funds',filters:{}};
    else if(metric==='volume'&&!platform)target={view:'executions',filters:{executionKind:['TRADE']}};
    else if(['failed','failureRate'].includes(metric))target={view:'failures',filters:{status:['FAILED'],orderBasis:['created']}};
    else target={view:platform?'platform-orders':'order-list',filters:{orderBasis:[metric==='filled'||metric==='volume'?'traded':'created']}};
    return [key,{...target,window,filters:{...target.filters,comparisonFrom:[period.from],comparisonTo:[period.to]}}];
   }));
   return {name:i?'本期':'上期',description:fmt(period.from)+' — '+fmt(period.to)+'（北京时间，结束不含）',values,links,...(financial?{dataQuality,qualityByKey}:{})};
  }):[];
  chart.highlights=[];
  chart.note='比较所选周期与紧邻的上一等长周期，不拆分所选周期；未结束日按实际已观察时长对齐。总量在各周期内独立去重；日均为每日去重值之和 ÷ 观察天数（不足一天按实际时长折算）。点击查看对应周期明细。'+(financial?'盈亏沿用完整历史成本，包含本期结算；不完整数据不作涨跌判断。':agentView?'仅含现存 Agent，创建不代表开启实盘。':'下单按订单创建时间、成交按实际成交时间，不能直接相除作为转化率。');
 }
 if(view==='user-details'){
  if(input.get('cohortStep'))notes.push('当前明细按注册日期与注册后 7 日行为筛选用户；成熟度截至所选期末判断。观察中用户未满 7 天，不参与成熟批次转化率。表内本期订单、成交额仍按顶部完整观察周期统计，不是注册后 7 日金额。');
  const earliest=values=>values.filter(Boolean).sort((a,b)=>new Date(a)-new Date(b))[0]||null;
  rows=rows.map(u=>({...u,liveState:u.live?'已开启':'未开启',firstConfiguredAt:earliest(d.agents.filter(a=>a.clerkUserId===u.id&&new Date(a.createdAt)<new Date(effective.to)).map(a=>a.createdAt)),firstOrderAt:earliest(orderCandidates.filter(o=>o.ownerClerkUserId===u.id&&new Date(o.createdAt)<new Date(effective.to)).map(o=>o.createdAt)),firstTradeAt:firstTrades.get(u.id)&&new Date(firstTrades.get(u.id))<new Date(effective.to)?firstTrades.get(u.id):null,filled:unique(current.es.filter(e=>e.ownerClerkUserId===u.id).map(e=>e.orderId)).length}));
  columns.push(column('liveState','当前实盘状态'),column('firstConfiguredAt','首次配置（已收录）','date'),column('firstOrderAt','首次下单（当前筛选）','date'),column('firstTradeAt','首次成交（已收录）','date'),column('filled','本期成交订单','number'));
  notes.push('注册日期筛选限定用户批次，交易指标仍使用顶部所选观察周期。绑定、实盘开关及阶段是当前状态，不代表所选日期当时状态。首次配置、下单和成交仅覆盖已收录历史；首次下单沿用当前业务筛选，缺少历史记录时显示 —。');
 }
 if(view==='agents'){
  const retained=charts.filter(c=>!['stage','agentBand'].includes(c.filter));charts.splice(0,charts.length,...retained);
  charts.push(
   {title:'用户与 Agent 数量分布',type:'progress',userSegmentation:true,note:'按用户当前拥有的 Agent 数量分组 · 包含 0 个 Agent 的用户',rows:agentBands.map(name=>{const members=users.filter(u=>agentBand(u.agentCount)===name);return {name,value:members.length,percentage:users.length?members.length/users.length*100:null,agentTotal:members.reduce((total,u)=>total+u.agentCount,0)};}),key:'value',label:'name',unit:'人',filter:'agentBand'},
   {title:'用户阶段分布',type:'progress',userSegmentation:true,note:'按用户当前阶段分组 · 点击查看对应用户明细',rows:options.stage.map(name=>({name,value:users.filter(u=>u.stage===name).length})),key:'value',label:'name',unit:'人',filter:'stage'}
  );
  notes.push('用户分层按当前筛选用户的现存 Agent 数及当前阶段统计，包含没有 Agent 的用户；实盘状态和 Agent 活动筛选仅作用于上方 Agent 分析。点击分层可进入用户列表明细。');
 }
 if(view==='events'&&input.get('excludeUnattributed')==='1')notes.push('市场概览排除所有待归属流水（包括历史流水及缺少 Agent 的记录），仅保留已归属可计算金额；不代表完整账户盈亏。归属冲突、成本或手续费缺失仍标记为不完整。');
 if(view==='events'){
  const ranking=charts.find(c=>c.title==='比赛盈亏排名');
  if(ranking){
   const catalog=new Map();
   for(const record of [...orderCandidates,...eligible]){
    const id=record.canonicalEventId;if(!id||['未记录','undefined','null'].includes(id))continue;
    if(!catalog.has(id))catalog.set(id,{eventId:id,fixtureName:record.fixtureName||id,competition:record.competition||null});
   }
   const values=new Map(ranking.rows.map(row=>[row.eventId,row]));
   for(const row of ranking.rows)if(row.eventId&&!catalog.has(row.eventId))catalog.set(row.eventId,row);
   ranking.rows=[...catalog.values()].sort((a,b)=>String(a.fixtureName).localeCompare(String(b.fixtureName))||String(a.eventId).localeCompare(String(b.eventId))).map(meta=>{
    if(values.has(meta.eventId))return values.get(meta.eventId);
    const activity=eligible.some(e=>e.canonicalEventId===meta.eventId&&within(e.executedAt,effective));
    return {...meta,realizedPnl:activity?null:'0',buyValue:'0',orderCount:0,models:[]};
   });
   ranking.showValues=true;
   ranking.note='固定展示当前筛选范围内已收录的全部赛事，按赛事名称排列；所选日期无成交或结算记录显示 0，无法计算的盈亏显示 —。';
  }
 }
 const sharedDefinitions={orders:'所选周期创建的订单，包含未成交和失败订单。',filled:'所选周期有真实成交的去重订单，按实际成交时间；可包含前期创建的订单。',volume:'所选周期已归属真实成交金额，包含买入与卖出，不含单独结算回款。',failed:'所选周期创建且当前状态为失败的订单；不是该周期发生失败的次数。',rate:'本期创建且当前失败订单 / 本期创建订单；状态取当前值。',pnl:'所选周期内已归属且成本可计算的已实现盈亏分量，不是账户总价值或全部历史盈亏。'};
 metrics=metrics.map(m=>({...m,definition:m.definition||sharedDefinitions[m.key]||m.note||'按当前页面的筛选范围统计。'}));
 const userIdRows=['overview','users','user-list','user-details','funds'].includes(view);
 rows=rows.map(row=>({...row,userEmail:userEmails.get(row.ownerClerkUserId||row.clerkUserId||(userIdRows?row.id:null))||'邮箱未获取'}));
 const userColumn=columns.some(c=>['ownerClerkUserId','clerkUserId'].includes(c.key)||(userIdRows&&c.key==='id'));
 columns=columns.filter(c=>!(userColumn&&c.key==='email')).map(c=>['ownerClerkUserId','clerkUserId'].includes(c.key)||(userIdRows&&c.key==='id')?{...c,key:'userEmail',label:'用户邮箱'}:c);
 columns=columns.map(c=>c.key==='competition'?{...c,type:'market'}:c);
 const sort=input.get('sort')||(view==='platform'?'realizedPnl':['user-list','user-details'].includes(view)?'agentCount':['overview','users','agents'].includes(view)?'volume':null)||columns.find(c=>['money','number','date'].includes(c.type))?.key||columns[0].key;
 rows=sortRows(rows,columns.some(c=>c.key===sort)?sort:columns[0].key,input.get('direction'));
 const page=Math.max(1,Number(input.get('page')||1)),pageSize=20;if(!Number.isSafeInteger(page))throw Error('无效分页');
 return {view,scope:view==='quality'?'跨业务数据质量':platform?'平台自有模型':'普通用户',asOf,clerkStatus:identity.status,clerkAsOf:identity.asOf,range:effective,previous,metrics,charts,notes,columns,options,eventRows,unassignedEventQuality,total:rows.length,items:input.get('export')==='1'?rows:rows.slice((page-1)*pageSize,page*pageSize),page,pageSize,sort,direction:input.get('direction')==='asc'?'asc':'desc'};
}

export function registrationCohortMembers(users,bindings,agents,executions,r,asOf){
 const period=users.filter(u=>within(u.registeredAt,r));
 const mature=period.filter(u=>+new Date(u.registeredAt)+7*86400000<=+new Date(asOf));
 const window=(u,date)=>date&&+new Date(date)>=+new Date(u.registeredAt)&&+new Date(date)<+new Date(u.registeredAt)+7*86400000;
 const bound=mature.filter(u=>bindings.some(b=>b.clerkUserId===u.id&&window(u,b.verifiedAt)));
 const configured=bound.filter(u=>agents.some(a=>a.clerkUserId===u.id&&window(u,a.createdAt)));
 const traded=configured.filter(u=>executions.some(e=>e.ownerClerkUserId===u.id&&e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId&&window(u,e.executedAt)));
 return {registered:mature,bound,configured,traded,observing:period.length-mature.length};
}

export function registrationCohort(users,bindings,agents,executions,r,asOf){
 const c=registrationCohortMembers(users,bindings,agents,executions,r,asOf);
 return {sample:c.registered.length,observing:c.observing,bound:c.bound.length,configured:c.configured.length,traded:c.traded.length,conversion:c.registered.length?c.traded.length/c.registered.length*100:null};
}

export function registrationRetention(users,executions,r){
 const ms=86400000,startOf=t=>+new Date(day(t)+'T00:00:00+08:00');
 const trades=new Map();for(const e of executions){if(e.executionKind!=='TRADE'||e.attributionStatus!=='ATTRIBUTED'||!e.agentId||new Date(e.executedAt)>=new Date(r.to))continue;if(!trades.has(e.ownerClerkUserId))trades.set(e.ownerClerkUserId,new Set());trades.get(e.ownerClerkUserId).add(day(e.executedAt));}
 const cohorts=Map.groupBy(users.filter(u=>u.registeredAt&&within(u.registeredAt,r)),u=>{const start=startOf(u.registeredAt),dow=new Date(start+28800000).getUTCDay();return day(start-((dow+6)%7)*ms);});
 return [...cohorts].sort(([a],[b])=>a.localeCompare(b)).map(([name,members])=>({name,sample:members.length,cells:[1,7,30].map(days=>{const mature=members.filter(u=>startOf(u.registeredAt)+(days+1)*ms<=+new Date(r.to)),returned=mature.filter(u=>trades.get(u.id)?.has(day(startOf(u.registeredAt)+days*ms))).length;return {days,eligible:mature.length,returned,observing:members.length-mature.length,rate:mature.length?returned/mature.length*100:null};})}));
}
