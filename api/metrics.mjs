import Decimal from 'decimal.js';
import {projectExecutionPnl} from './execution-pnl.ts';
export const sum=(xs,fn=x=>x)=>xs.reduce((a,x)=>a.plus(fn(x)||0),new Decimal(0)).toFixed();
export function range(search,now=new Date()){
 const kind=search.get('range')||'30d'; const end=new Date(now); let start;
 if(kind==='all') start=new Date(0);
 else if(kind==='custom'){
  const f=search.get('from'),t=search.get('to');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(f||'')||!/^\d{4}-\d{2}-\d{2}$/.test(t||''))throw Error('请选择有效起止日期');
  start=new Date(f+'T00:00:00+08:00'); end.setTime(new Date(t+'T00:00:00+08:00').getTime()+86400000);
 }else{
  if(!['today','7d','30d'].includes(kind))throw Error('无效时间范围');
  const day=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  start=new Date(day+'T00:00:00+08:00'); start.setTime(start.getTime()-(kind==='7d'?6:kind==='30d'?29:0)*86400000);
 }
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>=end)throw Error('开始日期必须早于结束日期');
 return {kind,from:start.toISOString(),to:end.toISOString()};
}
export const within=(date,r)=>date && new Date(date)>=new Date(r.from)&&new Date(date)<new Date(r.to);
export const day=date=>new Date(new Date(date).getTime()+28800000).toISOString().slice(0,10);
export function periodPnl(rows,r){
 const owners=Map.groupBy(rows,x=>x.ownerClerkUserId||x.predictAccountAddress);
 const users=[];
 for(const [id,events] of owners){
  const eligible=events.filter(x=>new Date(x.executedAt)<new Date(r.to));
  const issues=[]; const executions=[];
  for(const e of eligible){
   if(e.attributionStatus==='CONFLICT'){issues.push('归属冲突');continue;}
   if(e.attributionStatus!=='ATTRIBUTED'||!e.agentId){issues.push('未归属成交');continue;}
   if(e.executionKind==='TRADE'&&(e.feeAmount===null||!['SHARES','COLLATERAL'].includes(e.feeType)))issues.push('费用证据不完整');
   const kind=e.executionKind==='SETTLEMENT'?'SETTLEMENT':e.side;
   if(!['BUY','SELL','SETTLEMENT'].includes(kind)){issues.push('未知成交方向');continue;}
   let quantity=new Decimal(e.actualFilledShares);
   if(quantity.lte(0)){issues.push('成交数量无效');continue;}
   const fee=new Decimal(e.feeAmount||0);
   executions.push({executionId:e.sourceEventKey,orderId:e.orderId,marketId:e.marketId,tokenId:e.tokenId,kind,quantity:quantity.toFixed(),value:e.actualFilledValue,fee:e.feeType==='SHARES'?fee.times(e.actualExecutionPrice).toFixed():fee.toFixed(),executedAt:new Date(e.executedAt).toISOString(),status:'ATTRIBUTED',agentId:e.agentId,eventId:e.canonicalEventId,modelId:e.modelId,...(kind==='BUY'&&e.feeType==='SHARES'?{positionQuantity:Decimal.max(0,quantity.minus(fee)).toFixed(),feeTreatment:'INCLUDED_IN_VALUE'}:{})});
  }
  const project=xs=>projectExecutionPnl({asOf:r.to,executions:xs,walletPositions:[]});
  const end=project(executions),start=project(executions.filter(x=>new Date(x.executedAt)<new Date(r.from)));
  if(end.issues.length)issues.push('历史成本不足');
  const value=new Decimal(sum(end.agents,x=>x.metrics.realizedPnl)).minus(sum(start.agents,x=>x.metrics.realizedPnl)).toFixed();
  const fees=new Decimal(sum(end.agents,x=>x.metrics.fees)).minus(sum(start.agents,x=>x.metrics.fees)).toFixed();
  const hasAttributedActivity=eligible.some(x=>within(x.executedAt,r)&&x.attributionStatus==='ATTRIBUTED'&&x.agentId&&['TRADE','SETTLEMENT'].includes(x.executionKind));
  if(hasAttributedActivity)users.push({id,value,fees,status:issues.length?'PARTIAL':'RECORDED',issues:[...new Set(issues)]});
 }
 const complete=users.filter(x=>x.status==='RECORDED');
 const partial=users.filter(x=>x.status==='PARTIAL');
 return {value:sum(users,x=>x.value),fees:sum(users,x=>x.fees),completeValue:sum(complete,x=>x.value),completeFees:sum(complete,x=>x.fees),winners:users.filter(x=>new Decimal(x.value).gt(0)).length,losers:users.filter(x=>new Decimal(x.value).lt(0)).length,flat:users.filter(x=>new Decimal(x.value).eq(0)).length,covered:complete.length,partial:partial.length,total:users.length,users,status:partial.length?'PARTIAL':'RECORDED',note:'展示精确归属流水中可计算的盈亏分量；PARTIAL 账户仍计入已归属分量，但不代表账户完整净盈亏。仅有未归属流水的账户不进入盈亏人数。'};
}
function normalizedExecution(e){
 if(e.attributionStatus!=='ATTRIBUTED'||!e.agentId)return null;
 const kind=e.executionKind==='SETTLEMENT'?'SETTLEMENT':e.side;
 if(!['BUY','SELL','SETTLEMENT'].includes(kind))return null;
 const quantity=new Decimal(e.actualFilledShares);
 if(quantity.lte(0))return null;
 const fee=new Decimal(e.feeAmount||0);
 return {executionId:e.sourceEventKey,orderId:e.orderId,marketId:e.marketId,tokenId:e.tokenId,kind,quantity:quantity.toFixed(),value:e.actualFilledValue,fee:e.feeType==='SHARES'?fee.times(e.actualExecutionPrice).toFixed():fee.toFixed(),executedAt:new Date(e.executedAt).toISOString(),status:'ATTRIBUTED',agentId:e.agentId,eventId:e.canonicalEventId,modelId:e.modelId,...(kind==='BUY'&&e.feeType==='SHARES'?{positionQuantity:Decimal.max(0,quantity.minus(fee)).toFixed(),feeTreatment:'INCLUDED_IN_VALUE'}:{})};
}
function projectionMetrics(executions,asOf){
 const projection=projectExecutionPnl({asOf,executions,walletPositions:[]});const values=new Map();
 for(const agent of projection.agents)for(const event of agent.events)for(const model of event.models)values.set([agent.agentId,event.eventId,model.modelId].join('\0'),model.metrics);
 return values;
}
const metric=(values,key,name)=>new Decimal(values.get(key)?.[name]||0);
export function executionPerformance(rows,r,days){
 const normalized=rows.filter(e=>new Date(e.executedAt)<new Date(r.to)).map(normalizedExecution).filter(Boolean);
 const active=normalized.filter(e=>within(e.executedAt,r));const activeByKey=Map.groupBy(active,e=>[e.agentId,e.eventId,e.modelId].join('\0'));
 const end=projectionMetrics(normalized,r.to),start=projectionMetrics(normalized.filter(e=>new Date(e.executedAt)<new Date(r.from)),r.from);
 const metadata=new Map();for(const source of rows)if(source.canonicalEventId&&!metadata.has(source.canonicalEventId))metadata.set(source.canonicalEventId,{competition:source.competition||null,fixtureName:source.fixtureName||null});
 const sourceByKey=new Map();for(const source of rows){const key=[source.agentId,source.canonicalEventId,source.modelId].join('\0');if(!sourceByKey.has(key))sourceByKey.set(key,[]);sourceByKey.get(key).push(source);}
 const details=[...activeByKey].map(([key,events])=>{const [agentId,eventId,modelId]=key.split('\0'),meta=metadata.get(eventId)||{},source=sourceByKey.get(key)||[];return {agentId,eventId,modelId,competition:meta.competition||null,fixtureName:meta.fixtureName||null,realizedPnl:metric(end,key,'realizedPnl').minus(metric(start,key,'realizedPnl')).toFixed(),fees:metric(end,key,'fees').minus(metric(start,key,'fees')).toFixed(),buyValue:sum(events.filter(e=>e.kind==='BUY'),e=>e.value),orderIds:[...new Set(events.map(e=>e.orderId).filter(Boolean))],executionCount:events.length,userIds:[...new Set(source.map(e=>e.ownerClerkUserId).filter(Boolean))]};}).sort((a,b)=>new Decimal(b.realizedPnl).minus(a.realizedPnl).toNumber());
 const aggregate=(key,entries)=>{const map=new Map();for(const row of entries){const id=row[key];if(!map.has(id))map.set(id,{[key]:id,realizedPnl:new Decimal(0),fees:new Decimal(0),buyValue:new Decimal(0),orderIds:new Set(),events:new Set(),agents:new Set(),users:new Set()});const item=map.get(id);item.realizedPnl=item.realizedPnl.plus(row.realizedPnl);item.fees=item.fees.plus(row.fees);item.buyValue=item.buyValue.plus(row.buyValue);row.orderIds.forEach(x=>item.orderIds.add(x));item.events.add(row.eventId);item.agents.add(row.agentId);row.userIds.forEach(x=>item.users.add(x));}
  return [...map.values()].map(item=>({...item,realizedPnl:item.realizedPnl.toFixed(),fees:item.fees.toFixed(),buyValue:item.buyValue.toFixed(),orderCount:item.orderIds.size,eventCount:item.events.size,agentCount:item.agents.size,userCount:item.users.size}));};
 const models=aggregate('modelId',details);const events=aggregate('eventId',details).map(item=>({...item,competition:metadata.get(item.eventId)?.competition||null,fixtureName:metadata.get(item.eventId)?.fixtureName||null,modelCount:details.filter(x=>x.eventId===item.eventId).map(x=>x.modelId).filter((x,i,a)=>a.indexOf(x)===i).length}));
 let previous=projectionMetrics(normalized.filter(e=>new Date(e.executedAt)<new Date(r.from)),r.from),cumulative=new Decimal(0);const daily=[],dailyModels=[];
 for(const dateKey of days){const endAt=new Date(`${dateKey}T00:00:00+08:00`);endAt.setTime(endAt.getTime()+86400000);const current=projectionMetrics(normalized.filter(e=>new Date(e.executedAt)<endAt),endAt.toISOString());const keys=new Set([...current.keys(),...previous.keys()]);let pnl=new Decimal(0),fees=new Decimal(0);for(const key of keys){const value=metric(current,key,'realizedPnl').minus(metric(previous,key,'realizedPnl')),fee=metric(current,key,'fees').minus(metric(previous,key,'fees'));pnl=pnl.plus(value);fees=fees.plus(fee);if(!value.eq(0)||!fee.eq(0)){const [,eventId,modelId]=key.split('\0');dailyModels.push({date:dateKey,modelId,eventId,realizedPnl:value.toFixed(),fees:fee.toFixed(),competition:metadata.get(eventId)?.competition||null,fixtureName:metadata.get(eventId)?.fixtureName||null});}}
  cumulative=cumulative.plus(pnl);daily.push({date:dateKey,realizedPnl:pnl.toFixed(),fees:fees.toFixed(),cumulativePnl:cumulative.toFixed()});previous=current;
 }
 return {models,events,details,daily,dailyModels};
}
export function strategyPerformance(orders,executions,r,market=''){
 const groups=new Map();
 const group=value=>{const key=typeof value==='string'&&value.trim()?value.trim():null;if(!groups.has(key))groups.set(key,{positionMethod:key,orderAttempts:0,filledOrders:0,failedOrders:0,otherOrders:0,requestedStake:new Decimal(0),buyValue:new Decimal(0)});return groups.get(key);};
 for(const order of orders){if(!within(order.createdAt,r)||(market&&order.competition!==market))continue;const item=group(order.positionMethod);item.orderAttempts++;item.requestedStake=item.requestedStake.plus(order.requestedStake||0);if(order.state==='FILLED')item.filledOrders++;else if(order.state==='FAILED')item.failedOrders++;else item.otherOrders++;}
 for(const execution of executions){if(!within(execution.executedAt,r)||(market&&execution.competition!==market)||execution.executionKind!=='TRADE'||execution.side!=='BUY'||execution.attributionStatus!=='ATTRIBUTED'||!execution.agentId)continue;const item=group(execution.positionMethod);item.buyValue=item.buyValue.plus(execution.actualFilledValue||0);}
 return [...groups.values()].map(item=>({...item,requestedStake:item.requestedStake.toFixed(),buyValue:item.buyValue.toFixed()})).sort((a,b)=>new Decimal(b.buyValue).cmp(a.buyValue)||b.orderAttempts-a.orderAttempts||String(a.positionMethod||'').localeCompare(String(b.positionMethod||'')));
}
export function activityMetrics(executions,users,r,asOf){
 const rows=executions.filter(e=>e.executionKind==='TRADE'&&e.attributionStatus==='ATTRIBUTED'&&e.agentId);
 const grouped=Map.groupBy(rows,e=>e.ownerClerkUserId);const registered=new Map(users.map(u=>[u.id,u.registeredAt]));
 const quiet=[],durations=[];
 const cohorts={7:{eligible:0,returned:0},30:{eligible:0,returned:0}};
 for(const [id,es] of grouped){
  const sorted=es.toSorted((a,b)=>new Date(a.executedAt)-new Date(b.executedAt));const first=new Date(sorted[0].executedAt),last=new Date(sorted.at(-1).executedAt);
  if(last.getTime()<new Date(asOf).getTime()-7*86400000)quiet.push({id,lastTrade:last.toISOString()});
  if(within(first,r)){
   const registration=registered.get(id);if(registration&&new Date(registration)<=first)durations.push((first-new Date(registration))/3600000);
   const firstDay=new Date(day(first)+'T00:00:00+08:00').getTime();
   for(const n of [7,30]){const end=firstDay+(n+1)*86400000;if(end>new Date(asOf).getTime())continue;cohorts[n].eligible++;if(sorted.some(e=>new Date(e.executedAt).getTime()>=firstDay+86400000&&new Date(e.executedAt).getTime()<end))cohorts[n].returned++;}
  }
 }
 durations.sort((a,b)=>a-b);const quant=p=>durations.length?durations[Math.ceil(durations.length*p)-1]:null;
 return {cohorts,quiet,medianHours:quant(.5),p90Hours:quant(.9),durationSamples:durations.length,asOf};
}
