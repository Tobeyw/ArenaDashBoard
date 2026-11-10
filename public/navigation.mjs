// One canonical detail destination for each business entity.
export const detailViews=new Set(['user-details','agents','funds','order-list','executions','platform-orders','platform-pnl-details','analyses','quality','activity','failures']);
export function chartDestination(view,c,row,trendMetric='volume'){
 const platform=view.startsWith('platform');const filters={};let target;
 if(c.type==='funnel'){target='user-details';filters.population=['cohort-'+(['registered','bound','configured','traded'][c.rows.indexOf(row)]||'registered')];}
 else if(c.filter==='stage'||c.filter==='agentBand'||c.key==='registered'){target='user-details';if(c.key==='registered')filters.population=['registered'];}
 else if(c.type==='strategyAnalysis'){target='platform-orders';if(c.key==='volume')filters.orderBasis=['traded'];}
 else if(c.type==='modelComparison'){target=c.key==='realizedPnl'?'platform-pnl-details':'platform-orders';if(c.key==='volume')filters.orderBasis=['traded'];}
 else if(c.title==='比赛盈亏排名'){target='event-analysis';filters.event=[row.eventId];}
 else if(c.filter==='reason'){target=view==='failures'?'failures':platform?'platform-orders':'order-list';filters.status=['FAILED'];}
 else if(c.type==='trend'||c.type==='comparison'){target='agents';filters.agentActivity=['ordered'];}
 else if(c.key==='realizedPnl'||c.key==='cumulativePnl'||c.type==='pie'||c.type==='multi'){target=platform?'platform-pnl-details':'funds';}
 else if(view==='quality'){target='quality';filters.attribution=[row[c.label]];}
 else if(view==='analyses'){target='analyses';}
 else if((c.filter==='market'||c.cumulativeOrders)&&view==='events'){target='order-list';}
 else if(c.filter==='status'||c.key==='orders'||c.type==='orderTrend'&&trendMetric==='orders'){target=platform?'platform-orders':'order-list';}
 else if(c.key==='filled'){target=platform?'platform-orders':'order-list';filters.orderBasis=['traded'];}
 else if(c.key==='volume'||c.unit==='USDT'){target=platform?'platform-orders':'executions';if(platform)filters.orderBasis=['traded'];else filters.executionKind=['TRADE'];}
 else if(['user-list','user-details'].includes(view)){target='user-details';}
 else target=platform?'platform-orders':'order-list';
 if(c.filter&&c.filter!=='date'&&c.filter!=='cohort'&&c.title!=='比赛盈亏排名')filters[c.filter]=[row[c.label]];
 return {view:target,filters,day:c.filter==='date'?row[c.label]:null};
}
export function metricDestination(view,key){
 const platform=view.startsWith('platform');const orderView=platform?'platform-orders':'order-list';
 if(['registered','registeredEnd','configured','firstTraders','traders','executedUsers','bindingRate','configConversion','cohortConversion'].includes(key))return {view:'user-details',filters:{population:[({registered:'registered',registeredEnd:'registeredEnd',configured:'configured',firstTraders:'firstTraders',traders:'traded',executedUsers:'ordered',bindingRate:'boundEnd',configConversion:'cohort-configured',cohortConversion:'cohort-traded'})[key]]}};
 if(['executedAgents','tradeAgents'].includes(key))return {view:'agents',filters:{agentActivity:[key==='tradeAgents'?'traded':'ordered']}};
 if(key==='orders')return {view:orderView,filters:{orderBasis:['created']}};
 if(key==='filled')return {view:orderView,filters:{orderBasis:['traded']}};
 if(key==='volume')return {view:platform?'platform-orders':'executions',filters:platform?{orderBasis:['traded']}:{executionKind:['TRADE']}};
 if(key==='failed'||key==='rate')return {view:orderView,filters:{status:['FAILED'],orderBasis:['created']}};
 if(key==='pnl')return {view:platform?'platform-pnl-details':'funds',filters:{}};
 if(key==='count'&&['analyses','quality'].includes(view))return {view,filters:{}};
 return null;
}
