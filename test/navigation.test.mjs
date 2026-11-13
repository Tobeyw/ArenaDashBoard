import test from 'node:test';
import assert from 'node:assert/strict';
import {detailViews,chartDestination,metricDestination} from '../public/navigation.mjs';
test('overview pages never own repeated entity tables',()=>{for(const v of ['overview','users','user-list','orders','platform','platform-pnl','events'])assert.equal(detailViews.has(v),false,v);for(const v of ['user-details','order-list','platform-orders','platform-pnl-details','executions','failures'])assert.equal(detailViews.has(v),true,v);});
test('chart drills preserve category IDs and the correct time basis',()=>{
 assert.deepEqual(chartDestination('orders',{type:'progress',filter:'reason',label:'name'},{name:'TIMEOUT'}).filters,{status:['FAILED'],reason:['TIMEOUT']});
 const filled=chartDestination('overview',{key:'filled',filter:'date',label:'date'},{date:'2026-11-06'});assert.equal(filled.view,'order-list');assert.equal(filled.day,'2026-11-06');assert.deepEqual(filled.filters.orderBasis,['traded']);
 const market=chartDestination('events',{filter:'market',label:'name'},{name:'EPL'});assert.equal(market.view,'order-list');assert.deepEqual(market.filters.market,['EPL']);
 const event=chartDestination('events',{title:'比赛盈亏排名',filter:'event',label:'fixtureName'},{fixtureName:'A vs B',eventId:'event-1'});assert.equal(event.view,'event-analysis');assert.deepEqual(event.filters.event,['event-1']);
 const platform=chartDestination('platform',{type:'modelComparison',key:'realizedPnl',filter:'model',label:'modelId'},{modelId:'provider/model'});assert.equal(platform.view,'platform-pnl-details');assert.deepEqual(platform.filters.model,['provider/model']);
});
test('metric drills target canonical details and cohorts',()=>{assert.equal(metricDestination('users','registered').view,'user-details');assert.deepEqual(metricDestination('users','configConversion').filters.population,['cohort-configured']);assert.deepEqual(metricDestination('orders','filled'),{view:'order-list',filters:{orderBasis:['traded']}});assert.equal(metricDestination('platform','orders').view,'platform-orders');assert.equal(metricDestination('users','unknown'),null);});

test('daily ordering user chart opens users ordered on the selected day',()=>{
 const target=chartDestination('users',{key:'orderedUsers',filter:'date',label:'date'},{date:'2026-11-09'});
 assert.equal(target.view,'user-details');assert.equal(target.day,'2026-11-09');assert.deepEqual(target.filters.population,['ordered']);
});

test('linked registration drill selects registration day without shortening observation period',()=>{
 const c={type:'linkedTrend',drillChoices:[{key:'registered'}]};
 assert.deepEqual(chartDestination('users',c,{date:'2026-11-07'}),{view:'user-details',filters:{registeredFrom:['2026-11-07'],registeredTo:['2026-11-07']}});
 assert.deepEqual(chartDestination('users',{...c,drillKey:'tradedUsers'},{date:'2026-11-07'}),{view:'user-details',filters:{population:['traded']},day:'2026-11-07'});
 assert.deepEqual(chartDestination('orders',{...c,drillKey:'failed'},{date:'2026-11-07'}),{view:'failures',filters:{orderBasis:['created'],status:['FAILED']},day:'2026-11-07'});
});

test('linked Agent activity routes distinguish creation, order creation and actual execution',()=>{
 for(const [key,activity] of [['createdAgents','created'],['orderedAgents','ordered'],['tradedAgents','traded']])assert.deepEqual(chartDestination('agents',{type:'linkedTrend',drillKey:key,drillChoices:[{key}]},{date:'2026-11-05'}),{view:'agents',filters:{agentActivity:[activity]},day:'2026-11-05'});
});

test('platform and market daily links keep separate order, execution and PnL destinations',()=>{
 for(const view of ['platform','events'])for(const key of ['orders','filled','volume','realizedPnl']){
  const target=chartDestination(view,{type:'linkedTrend',drillKey:key,drillChoices:[{key}]},{date:'2026-11-05'});
  assert.equal(target.day,'2026-11-05');
  if(key==='realizedPnl')assert.equal(target.view,view==='platform'?'platform-pnl-details':'funds');
  else if(key==='volume'&&view==='events')assert.deepEqual(target.filters.executionKind,['TRADE']);
  else {assert.equal(target.view,view==='platform'?'platform-orders':'order-list');assert.deepEqual(target.filters.orderBasis,[key==='orders'?'created':'traded']);}
 }
});

test('finance linked charts drill actual volume, filled orders and PnL separately',()=>{
 for(const view of ['funds','platform-pnl'])for(const key of ['filled','volume','realizedPnl']){
  const target=chartDestination(view,{type:'linkedTrend',drillKey:key,drillChoices:[{key}]},{date:'2026-11-06'});
  assert.equal(target.day,'2026-11-06');
  assert.equal(target.view,key==='realizedPnl'?(view==='funds'?'funds':'platform-pnl-details'):view==='platform-pnl'?'platform-orders':key==='volume'?'executions':'order-list');
  if(key==='filled')assert.deepEqual(target.filters.orderBasis,['traded']);
  if(key==='volume'&&view==='funds')assert.deepEqual(target.filters.executionKind,['TRADE']);
 }
});


test('merged order amount trend drills to actual trades rather than order creation',()=>{
 const target=chartDestination('orders',{type:'linkedTrend',drillKey:'volume',drillChoices:[{key:'volume'}]},{date:'2026-11-09'});
 assert.deepEqual(target,{view:'executions',filters:{executionKind:['TRADE']},day:'2026-11-09'});
});
