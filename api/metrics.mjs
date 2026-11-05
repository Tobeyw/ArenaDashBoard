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
  if(eligible.some(x=>within(x.executedAt,r)))users.push({id,value,fees,status:issues.length?'PARTIAL':'RECORDED',issues:[...new Set(issues)]});
 }
 const safe=users.filter(x=>x.status==='RECORDED');
 return {value:sum(safe,x=>x.value),fees:sum(safe,x=>x.fees),winners:safe.filter(x=>new Decimal(x.value).gt(0)).length,losers:safe.filter(x=>new Decimal(x.value).lt(0)).length,flat:safe.filter(x=>new Decimal(x.value).eq(0)).length,covered:safe.length,total:users.length,users,status:'PARTIAL',note:'基于已收录流水；未证明全历史回填完整。缺少费用、归属或成本的账户不计入合计。'};
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
