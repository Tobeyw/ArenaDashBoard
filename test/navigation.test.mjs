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
