import {day,within,sum} from './metrics.mjs';
const distinct=(xs,key)=>new Set(xs.map(x=>x[key]).filter(Boolean)).size;
const countOrders=xs=>distinct(xs,'id');
const pct=(a,b)=>b?a/b*100:null;
const start=date=>new Date(date+'T00:00:00+08:00').toISOString();
export function registrationGroup(user,r){return !user.registeredAt?'unknown':within(user.registeredAt,r)?'new':new Date(user.registeredAt)<new Date(r.from)?'existing':'later';}
const col=(key,label,unit='人')=>({key,label,unit});
const userLink=(population,extra={})=>({view:'user-details',filters:{...extra,...(population?{population:[population]}:{})}});
const userStats=(users,orders,trades,r,known)=>({registered:known?users.filter(u=>within(u.registeredAt,r)).length:null,ordered:distinct(orders,'ownerClerkUserId'),traded:distinct(trades,'ownerClerkUserId')});
// Cohort membership and detail drill-down share exactly the same seven-day predicates.
export function sevenDayMembers(users,{range,bindings=[],agents=[],orders=[],trades=[]}){
 const registered=users.filter(u=>within(u.registeredAt,range));
 const mature=registered.filter(u=>+new Date(u.registeredAt)+7*86400000<=+new Date(range.to));
 const inWindow=(u,date)=>date&&+new Date(date)>=+new Date(u.registeredAt)&&+new Date(date)<+new Date(u.registeredAt)+7*86400000;
 const bound=mature.filter(u=>bindings.some(b=>b.clerkUserId===u.id&&inWindow(u,b.verifiedAt)));
 const configured=bound.filter(u=>agents.some(a=>a.clerkUserId===u.id&&inWindow(u,a.createdAt)));
 return {sample:mature,observing:registered.filter(u=>!mature.includes(u)),bound,configured,
  ordered:mature.filter(u=>orders.some(o=>o.ownerClerkUserId===u.id&&inWindow(u,o.createdAt))),
  traded:mature.filter(u=>trades.some(e=>e.ownerClerkUserId===u.id&&e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId&&inWindow(u,e.executedAt)))};
}
function activityPhases(view,days,range,orders,trades,agents){
 const complete=days.filter(date=>+new Date(start(date))>=+new Date(range.from)&&+new Date(start(date))+86400000<=+new Date(range.to)),n=Math.floor(complete.length/2);
 const periods=n?[complete.slice(0,n),complete.slice(-n)]:[],isAgent=view==='agents';
 const avg=(key,label,unit)=>({...col(key,label,unit),digits:2});
 const columns=isAgent?[col('created','新建 Agent','个'),col('ordered','阶段下单 Agent','个'),avg('avgOrdered','日均下单 Agent','个/日'),col('traded','阶段成交 Agent','个'),avg('avgTraded','日均成交 Agent','个/日')]:[col('orders','创建订单','笔'),avg('avgOrders','日均创建订单','笔/日'),col('filled','有成交订单','笔'),avg('avgFilled','日均成交订单','笔/日'),col('failed','创建且当前失败','笔'),col('failureRate','当前失败率','%'),col('volume','实际成交金额','USDT')];
 return {type:'comparisonSummary',phaseComparison:true,title:isAgent?'Agent 周期前后段参与对比':'订单周期前后段表现对比',columns,
 note:(n?`前后段各 ${n} 个完整自然日；不完整日期${complete.length%2?'及中间 1 天':''}不参与比较。`:'至少需要 2 个完整自然日才能比较。')+(isAgent?'各段 Agent 独立去重，日均按每天去重后求平均；点击日均查看该段去重 Agent。仅含现存 Agent，缺失已删除 Agent 历史；创建不代表开启实盘。':'下单、失败按创建日，失败取当前状态；成交按实际成交日，同一订单跨日成交时阶段只计 1 笔，日均按各日去重后求平均。失败率 = 该段创建且当前失败订单 / 该段创建订单；不是当天失败发生率。成交可来自前期订单，不能直接计算下单转化率。'),
 rows:periods.map((dates,i)=>{
  const r={from:start(dates[0]),to:new Date(+new Date(start(dates.at(-1)))+86400000).toISOString()},window={from:dates[0],to:dates.at(-1)},os=orders.filter(o=>within(o.createdAt,r)),es=trades.filter(e=>within(e.executedAt,r));
  const average=(items,time,key)=>dates.reduce((v,date)=>v+distinct(items.filter(x=>day(x[time])===date),key),0)/n;
  const values=isAgent?{created:agents.filter(a=>within(a.createdAt,r)).length,ordered:distinct(os,'agentId'),traded:distinct(es,'agentId'),avgOrdered:average(os,'createdAt','agentId'),avgTraded:average(es,'executedAt','agentId')}:{orders:countOrders(os),filled:distinct(es,'orderId'),failed:countOrders(os.filter(o=>o.state==='FAILED')),failureRate:pct(countOrders(os.filter(o=>o.state==='FAILED')),countOrders(os)),avgOrders:average(os,'createdAt','id'),avgFilled:average(es,'executedAt','orderId'),volume:Number(sum(es,e=>e.actualFilledValue))};
  const links=Object.fromEntries(columns.map(({key})=>{
   let target;if(isAgent)target={view:'agents',filters:{agentActivity:[key==='created'?'created':key.toLowerCase().includes('traded')?'traded':'ordered']}};
   else if(key==='volume')target={view:'executions',filters:{executionKind:['TRADE']}};
   else if(['failed','failureRate'].includes(key))target={view:'failures',filters:{status:['FAILED'],orderBasis:['created']}};
   else target={view:'order-list',filters:{orderBasis:[key.toLowerCase().includes('filled')?'traded':'created']}};
   return [key,{...target,window}];
  }));return {name:i?'后段':'前段',description:window.from+' — '+window.to,values,links};
 })};
}
function businessComparisons(view,orders,trades,days,range,performance){
 const platform=view.startsWith('platform'),financeOnly=['funds','platform-pnl'].includes(view),prefix=platform?'平台模型':financeOnly?'用户资金':'市场';
 const labels={orders:'创建订单',filled:'实际成交订单',volume:'实际成交金额',realizedPnl:'已实现盈亏分量'},units={orders:'笔',filled:'笔',volume:'USDT',realizedPnl:'USDT'},palette={orders:'#397bf1',filled:'#08a75c',volume:'#f78b26',realizedPnl:'#8959e9'};
 if(financeOnly)delete labels.orders;
 const daily=new Map((performance?.daily||[]).map(row=>[row.date,row]));
 const rows=days.map(date=>({date,orders:countOrders(orders.filter(o=>day(o.createdAt)===date)),filled:distinct(trades.filter(e=>day(e.executedAt)===date),'orderId'),volume:Number(sum(trades.filter(e=>day(e.executedAt)===date),e=>e.actualFilledValue)),realizedPnl:daily.has(date)?Number(daily.get(date).realizedPnl):null}));
 const note=financeOnly?(platform?'平台模型账户范围；':'普通用户 Agent 交易范围；')+'成交金额按实际成交日统计，包含买入与卖出，不含结算回款。盈亏为同日已归属、可计算的已实现分量，包含结算及可识别费用，沿用历史持仓成本。当天没有成交也可能有结算盈亏；成交金额不是收入，不能用本图两项直接计算收益率。不含未实现浮盈，不代表完整账户净盈亏。悬浮查看当天成交订单数、成交金额与盈亏。':(platform?'平台自有模型订单及已归属成交；':'用户交易范围，与本页比赛盈亏排名一致；')+'下单按创建日、成交按实际成交日，订单 ID 去重，成交金额含买入与卖出。已实现盈亏含已归属可计算手续费及结算分量，可来自前期持仓；不含浮盈，不代表账户完整净盈亏。两图日期一致，悬浮查看同日四项指标；成交与下单不能直接相除作为转化率。';
 const choices=Object.keys(labels).map(key=>({key,label:labels[key]+'明细'}));
 const chart=(title,keys,unit)=>({...linked(title,rows,Object.fromEntries(keys.map(key=>[key,labels[key]])),choices,note),unit,axis:unit==='笔'?'订单数（笔）':'金额（USDT）',integerTicks:unit==='笔',drillKey:keys[0],note:note+(unit==='USDT'?' 柱状模式：盈亏分量绿色为盈利、红色为亏损。':''),seriesColors:palette,tooltipSeriesKeys:Object.keys(labels),tooltipLabels:labels,tooltipUnits:units,signedSeries:['realizedPnl']});
 const panels=[...(financeOnly?[]:[chart(prefix+'每日下单与成交对照',['orders','filled'],'笔')]),chart(prefix+'每日成交金额与盈亏对照',['volume','realizedPnl'],'USDT')];
 const complete=days.filter(date=>+new Date(start(date))>=+new Date(range.from)&&+new Date(start(date))+86400000<=+new Date(range.to)),n=Math.floor(complete.length/2),periods=n?[complete.slice(0,n),complete.slice(-n)]:[];
 const columns=financeOnly?[col('filled','有成交订单','笔'),{...col('avgFilled','日均成交订单','笔/日'),digits:2},col('volume','实际成交金额','USDT'),{...col('avgVolume','日均成交金额','USDT/日'),digits:2},{...col('realizedPnl','已实现盈亏分量','USDT'),signed:true},{...col('avgPnl','日均已实现盈亏分量','USDT/日'),digits:2,signed:true}]:[col('orders','创建订单','笔'),{...col('avgOrders','日均创建订单','笔/日'),digits:2},col('filled','有成交订单','笔'),{...col('avgFilled','日均成交订单','笔/日'),digits:2},col('volume','实际成交金额','USDT'),{...col('realizedPnl','已实现盈亏分量','USDT'),signed:true}];
 panels.push({type:'comparisonSummary',phaseComparison:true,title:prefix+'周期前后段表现对比',columns,note:(n?`前后段各 ${n} 个完整自然日；不完整日期${complete.length%2?'及中间 1 天':''}不参与。`:'至少需要 2 个完整自然日才能比较。')+'阶段订单按 ID 去重；日均按各日值求平均，点击日均查看整段明细，明细合计并非日均值。盈亏沿用所选业务范围的完整已收录历史成本，不从每段重置；只计该段已实现分量。下单、成交、盈亏不是同一订单批次。',rows:periods.map((dates,i)=>{
 const r={from:start(dates[0]),to:new Date(+new Date(start(dates.at(-1)))+86400000).toISOString()},window={from:dates[0],to:dates.at(-1)},dailyRows=rows.filter(row=>dates.includes(row.date));
 const values={orders:countOrders(orders.filter(o=>within(o.createdAt,r))),filled:distinct(trades.filter(e=>within(e.executedAt,r)),'orderId'),avgOrders:dailyRows.reduce((v,row)=>v+row.orders,0)/n,avgFilled:dailyRows.reduce((v,row)=>v+row.filled,0)/n,volume:Number(sum(trades.filter(e=>within(e.executedAt,r)),e=>e.actualFilledValue)),realizedPnl:dailyRows.every(row=>row.realizedPnl!=null)?Number(sum(dailyRows,row=>row.realizedPnl)):null};
 values.avgVolume=values.volume/n;values.avgPnl=values.realizedPnl==null?null:values.realizedPnl/n;
 const links=Object.fromEntries(columns.map(({key})=>{
 const metric=key==='avgOrders'?'orders':key==='avgFilled'?'filled':key==='avgVolume'?'volume':key==='avgPnl'?'realizedPnl':key;
 let target;if(metric==='realizedPnl')target={view:platform?'platform-pnl-details':'funds',filters:{}};
 else if(metric==='volume'&&!platform)target={view:'executions',filters:{executionKind:['TRADE']}};
 else target={view:platform?'platform-orders':'order-list',filters:{orderBasis:[metric==='orders'?'created':'traded']}};
 return [key,{...target,window}];}));return {name:i?'后段':'前段',description:window.from+' — '+window.to,values,links};
 })});return panels;
}
function linked(title,rows,seriesLabels,drillChoices,note){const keys=Object.keys(seriesLabels);return {type:'linkedTrend',title,rows,key:keys[0],label:'date',unit:'人',axis:'用户数（人）',integerTicks:true,seriesKeys:keys,seriesLabels,seriesColors:{registered:'#397bf1',orderedUsers:'#f78b26',tradedUsers:'#08a75c',createdAgents:'#8959e9',orderedAgents:'#f78b26',tradedAgents:'#08a75c',orders:'#397bf1',filled:'#08a75c',failed:'#db4b45'},drillChoices,filter:'date',note};}
export function linkedInsights({view,users,orders,trades,eligible,days,range,known,bindings=[],agents=[],historyOrders=orders,modelRows=[],marketPnl=[],performance=null}){
 const panels=[];
 if(view==='users'){
  const os=Map.groupBy(orders,o=>day(o.createdAt)),es=Map.groupBy(trades,e=>day(e.executedAt)),rs=Map.groupBy(users.filter(u=>u.registeredAt),u=>day(u.registeredAt));
  panels.push(linked('注册与交易参与趋势',days.map(date=>({date,registered:known?(rs.get(date)||[]).length:null,orderedUsers:distinct(os.get(date)||[],'ownerClerkUserId'),tradedUsers:distinct(es.get(date)||[],'ownerClerkUserId')})),{registered:'新增注册',orderedUsers:'下单用户',tradedUsers:'成交用户'},[{key:'registered',label:'当天新增用户及后续行为'},{key:'orderedUsers',label:'当天下单用户'},{key:'tradedUsers',label:'当天成交用户'}],'同一日期轴、同一筛选范围；下单按创建日，成交按实际成交日，各自按用户去重。各线不是同一注册批次，不可相除作为转化率；同步变化不代表因果关系。'));
  const complete=days.filter(date=>+new Date(start(date))>=+new Date(range.from)&&+new Date(start(date))+86400000<=+new Date(range.to)),n=Math.floor(complete.length/2);
  const periods=n?[complete.slice(0,n),complete.slice(-n)]:[];
  panels.push({type:'comparisonSummary',title:'周期前后段参与对比',note:n?`仅比较等长的 ${n} 个完整自然日；未结束的当天${complete.length%2?'及中间 1 天':''}不纳入。阶段人数按各段独立去重；日均为每天去重人数之和 ÷ 完整天数。点击日均值查看该阶段相关去重用户，明细人数不等于日均值。`:'至少需要 2 个完整自然日才能比较前后段。',columns:[col('registered','阶段新增注册'),{...col('avgRegistered','日均新增注册','人/日'),digits:2},col('ordered','阶段去重下单用户'),{...col('avgOrdered','日均下单用户','人/日'),digits:2},col('traded','阶段去重成交用户'),{...col('avgTraded','日均成交用户','人/日'),digits:2}],rows:periods.map((dates,i)=>{const r={from:start(dates[0]),to:new Date(+new Date(start(dates.at(-1)))+86400000).toISOString()},s=userStats(users,orders.filter(o=>within(o.createdAt,r)),trades.filter(e=>within(e.executedAt,r)),r,known),window={from:dates[0],to:dates.at(-1)};s.avgRegistered=s.registered==null?null:s.registered/n;s.avgOrdered=dates.reduce((v,date)=>v+distinct(os.get(date)||[],'ownerClerkUserId'),0)/n;s.avgTraded=dates.reduce((v,date)=>v+distinct(es.get(date)||[],'ownerClerkUserId'),0)/n;return {name:i?'后段':'前段',description:`${window.from} — ${window.to}`,values:s,links:Object.fromEntries(['registered','ordered','traded','avgRegistered','avgOrdered','avgTraded'].map(key=>[key,{...userLink(({avgRegistered:'registered',avgOrdered:'ordered',avgTraded:'traded'})[key]||key),window}]))};})});
  panels.push({type:'comparisonSummary',title:'新老用户交易参与对比',userParticipation:true,note:'本期新用户：本期内注册；之前注册的用户：本期开始前注册。两组只统计本期下单和成交，参与率 = 参与用户数 ÷ 本组用户数。新用户加入时间不同，可参与交易的时间较短。',columns:[col('users','用户数'),col('ordered','下单用户'),col('traded','成交用户'),col('orderRate','下单参与率','%'),col('tradeRate','成交参与率','%')],rows:[['new','本期新用户'],['existing','之前注册的用户']].map(([group,name])=>{const members=users.filter(u=>registrationGroup(u,range)===group),ids=new Set(members.map(u=>u.id)),ordered=distinct(orders.filter(o=>ids.has(o.ownerClerkUserId)),'ownerClerkUserId'),traded=distinct(trades.filter(e=>ids.has(e.ownerClerkUserId)),'ownerClerkUserId'),available=known;return {name,values:{users:available?members.length:null,ordered:available?ordered:null,traded:available?traded:null,orderRate:available?pct(ordered,members.length):null,tradeRate:available?pct(traded,members.length):null},links:{users:userLink(null,{registrationGroup:[group]}),ordered:userLink('ordered',{registrationGroup:[group]}),traded:userLink('traded',{registrationGroup:[group]}),orderRate:userLink('ordered',{registrationGroup:[group]}),tradeRate:userLink('traded',{registrationGroup:[group]})}}})});
 }
 if(view==='orders'){
  panels.push({...linked('下单、成交与失败每日对照',days.map(date=>({date,orders:countOrders(orders.filter(o=>day(o.createdAt)===date)),filled:distinct(trades.filter(e=>day(e.executedAt)===date),'orderId'),failed:countOrders(orders.filter(o=>day(o.createdAt)===date&&o.state==='FAILED'))})),{orders:'当日创建订单',filled:'当日成交订单',failed:'当日创建且当前失败'},[{key:'orders',label:'当天创建订单'},{key:'filled',label:'当天有成交订单'},{key:'failed',label:'当天创建的失败订单'}],'订单 ID 去重；成交按实际成交日，可能来自早前创建的订单。失败按创建日归类、状态取当前值；不代表当天发生失败，三条线不能相除作为成功率。'),unit:'笔',axis:'订单数（笔）'});
  panels.push(activityPhases(view,days,range,orders,trades,[]));
 }
 if(view==='agents'){
  const catalog=modelRows.flatMap(group=>group.agents),ids=new Set(catalog.map(a=>a.id)),os=orders.filter(o=>ids.has(o.agentId)),es=trades.filter(e=>ids.has(e.agentId));
  panels.push({...linked('Agent 创建、下单与成交每日对照',days.map(date=>({date,createdAgents:catalog.filter(a=>a.createdAt&&day(a.createdAt)===date).length,orderedAgents:distinct(os.filter(o=>day(o.createdAt)===date),'agentId'),tradedAgents:distinct(es.filter(e=>day(e.executedAt)===date),'agentId')})),{createdAgents:'新建 Agent',orderedAgents:'下单 Agent',tradedAgents:'成交 Agent'},[{key:'createdAgents',label:'当天新建 Agent'},{key:'orderedAgents',label:'当天下单 Agent'},{key:'tradedAgents',label:'当天成交 Agent'}],'仅统计当前仍存在且符合用户、Agent 和实盘状态筛选的 Agent；已删除的 Agent 不在此图中。下单按订单创建日，成交按实际成交日，每日分别去重；新建不代表实盘开启，三条线不是同一批 Agent，不可相除作为转化率。市场、模型等交易筛选仅影响下单和成交。'),unit:'个',axis:'Agent 数（个）',hideDrillSelect:true});
  panels.push(activityPhases(view,days,range,os,es,catalog));
  panels.push({type:'comparisonSummary',title:'Agent 使用与交易参与',agentParticipation:true,note:'按当前实盘开关分组，比较所选周期内的下单及成交；当前已关闭的 Agent 仍可能在本期有历史成交。不还原每日开关状态。下单／成交参与率 = 本组周期内去重下单／成交 Agent ÷ 本组现存 Agent；不代表历史实盘转化率，空组不计算比例。',columns:[col('agents','现存 Agent','个'),col('ordered','下单 Agent','个'),col('traded','成交 Agent','个'),col('orders','创建订单','笔'),col('volume','成交金额','USDT'),col('orderRate','下单参与率','%'),col('tradeRate','成交参与率','%')],rows:modelRows.map(group=>{const ids=new Set(group.agents.map(a=>a.id)),os=orders.filter(o=>ids.has(o.agentId)),es=trades.filter(e=>ids.has(e.agentId));const filters={liveState:[String(group.live)]};return {name:group.live?'当前实盘已开启':'当前实盘已关闭',values:{agents:ids.size,ordered:distinct(os,'agentId'),traded:distinct(es,'agentId'),orders:countOrders(os),volume:sum(es,e=>e.actualFilledValue),orderRate:pct(distinct(os,'agentId'),ids.size),tradeRate:pct(distinct(es,'agentId'),ids.size)},links:{orders:{view:'order-list',filters:{...filters,agent:[...ids],orderBasis:['created']}},volume:{view:'executions',filters:{...filters,agent:[...ids],executionKind:['TRADE']}},orderRate:{view:'agents',filters:{...filters,agentActivity:['ordered']}},tradeRate:{view:'agents',filters:{...filters,agentActivity:['traded']}},agents:{view:'agents',filters},ordered:{view:'agents',filters:{...filters,agentActivity:['ordered']}},traded:{view:'agents',filters:{...filters,agentActivity:['traded']}}}}})});
 }
 if(['platform','events','funds','platform-pnl'].includes(view))panels.push(...businessComparisons(view,orders,trades,days,range,performance));
 if(view==='platform')panels.push({type:'comparisonSummary',title:'模型规模、成交与盈亏联查',businessComparison:true,note:'按模型对照下单、成交与盈亏。下单按创建日、成交按实际成交日、盈亏为本期已归属可计算分量；成交订单可来自前期，不能用两列直接计算成交率。点击柱子查看对应明细。',columns:[col('orders','下单订单','笔'),col('filled','成交订单','笔'),col('volume','成交金额','USDT'),col('realizedPnl','已实现盈亏','USDT')],rows:modelRows.map(row=>({name:String(row.modelId).split('/').at(-1),values:row,links:{orders:{view:'platform-orders',filters:{model:[row.modelId],orderBasis:['created']}},filled:{view:'platform-orders',filters:{model:[row.modelId],orderBasis:['traded']}},volume:{view:'platform-orders',filters:{model:[row.modelId],orderBasis:['traded']}},realizedPnl:{view:'platform-pnl-details',filters:{model:[row.modelId]}}}}))});
 if(view==='events'){
  const names=[...new Set([...orders,...trades,...marketPnl].map(o=>o.competition||'未记录'))].sort();
  panels.push({type:'comparisonSummary',title:'市场参与、成交与盈亏联查',businessComparison:true,note:'用户业务范围；下单按创建日，成交按实际成交日，盈亏仅已归属可计算分量。不把请求金额当作实际成交额，缺少归属或成本的盈亏显示覆盖限制。',labelType:'market',columns:[col('users','下单用户'),col('traders','成交用户'),col('orders','下单订单','笔'),col('filled','成交订单','笔'),col('volume','成交金额','USDT'),col('pnl','已实现盈亏分量','USDT')],rows:names.map(name=>{const os=orders.filter(o=>(o.competition||'未记录')===name),es=trades.filter(e=>(e.competition||'未记录')===name),pnl=marketPnl.filter(x=>(x.competition||'未记录')===name),filter={market:[name]};return {name,description:!pnl.length?'暂无可计算盈亏样本':'仅已归属可计算分量',values:{users:distinct(os,'ownerClerkUserId'),traders:distinct(es,'ownerClerkUserId'),orders:countOrders(os),filled:distinct(es,'orderId'),volume:sum(es,e=>e.actualFilledValue),pnl:pnl.length?sum(pnl,x=>x.realizedPnl):null},links:{users:userLink('ordered',filter),traders:userLink('traded',filter),orders:{view:'order-list',filters:{...filter,orderBasis:['created']}},filled:{view:'order-list',filters:{...filter,orderBasis:['traded']}},volume:{view:'executions',filters:{...filter,executionKind:['TRADE']}},pnl:{view:'funds',filters:filter}}}})});
 }
 for(const panel of panels){
  if(panel.type==='linkedTrend')panel.highlights=panel.seriesKeys.map(key=>{
   const observed=panel.rows.filter(row=>row[key]!=null);if(!observed.length)return `${panel.seriesLabels[key]}：暂无数据`;
   if(key==='realizedPnl'){const best=observed.reduce((a,b)=>a[key]>=b[key]?a:b),worst=observed.reduce((a,b)=>a[key]<=b[key]?a:b);return `每日盈亏分量：最高 ${best[key].toFixed(2)} ${panel.unit}（${best.date}），最低 ${worst[key].toFixed(2)} ${panel.unit}（${worst.date}）`;}
   const max=Math.max(...observed.map(row=>row[key]));if(max===0)return `${panel.seriesLabels[key]}：本期无记录`;
   const peak=observed.filter(row=>row[key]===max);return `${panel.seriesLabels[key]}峰值：${max} ${panel.unit} · ${peak.slice(0,3).map(row=>row.date).join('、')}${peak.length>3?` 等 ${peak.length} 天`:''}`;
  });
  if((panel.phaseComparison||panel.title==='周期前后段参与对比')&&panel.rows.length===2)panel.highlights=panel.columns.map(({key,label,unit,digits=0,signed=false})=>{
   const a=panel.rows[0].values[key],b=panel.rows[1].values[key];if(a==null||b==null)return label+'：暂无数据';if(unit==='USDT'||unit==='%')digits=2;
   const delta=b-a;if(signed)return `${label}：${a.toFixed(2)} → ${b.toFixed(2)} ${unit}（${a<0&&b>=0?'转盈 · ':a>=0&&b<0?'转亏 · ':''}${delta>0?'+':''}${delta.toFixed(2)} ${unit}）`;if(unit==='%')return `${label}：${a.toFixed(2)}% → ${b.toFixed(2)}%（${delta>0?'+':''}${delta.toFixed(2)} 个百分点）`;const change=a===0?(b===0?'持平':'前段为 0，不计算涨幅'):`${delta>0?'+':''}${(delta/a*100).toFixed(1)}%`;
   return `${label}：${a.toFixed(digits)} → ${b.toFixed(digits)} ${unit}（${delta>0?'+':''}${delta.toFixed(digits)}；${change}）`;
  });
 }
 return panels;
}
