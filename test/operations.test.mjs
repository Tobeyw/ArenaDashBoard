import test from 'node:test';
import assert from 'node:assert/strict';
import {compare,previousRange,sortRows,operations,views,registrationCohort,registrationRetention} from '../api/operations.mjs';
const d={asOf:'2026-11-09T10:00:00Z',official:new Set(['platform-owner']),users:[{clerkUserId:'u'}],agents:[{id:'a',clerkUserId:'u',createdAt:'2026-11-01T00:00:00Z'}],bindings:[],orders:[{id:'o',ownerClerkUserId:'u',agentId:'a',modelId:'same-model',state:'FAILED',createdAt:'2026-11-09T01:00:00Z',requestedStake:'10'}],executions:[],platform:[{id:'p',modelId:'same-model'}],platformOrders:[{id:'po',modelId:'same-model',state:'PENDING',createdAt:'2026-11-09T01:00:00Z',requestedStake:'20'}],platformExecutions:[],signals:[],analyses:[]};
const c={status:'AVAILABLE',users:[{id:'u',registeredAt:'2026-11-01T00:00:00Z'},{id:'platform-owner',registeredAt:'2026-11-01T00:00:00Z'}]};
const r={kind:'today',from:'2026-11-08T16:00:00Z',to:'2026-11-09T10:00:00Z'};
test('comparison handles missing, zero, percentages and profit sign changes',()=>{assert.equal(compare(null,0).text,'—');assert.match(compare(2,0).text,/新增/);assert.match(compare(15,12,'rate').text,/3.00 个百分点/);assert.match(compare(2,-3,'pnl').text,/转盈/);assert.equal(compare(0,0).text,'持平');});
test('equal elapsed duration and cumulative exclusion',()=>{const p=previousRange(r,d.asOf);assert.equal(+new Date(p.to)-new Date(p.from),+new Date(r.to)-new Date(r.from));assert.equal(previousRange({...r,kind:'all'},d.asOf),null);});
test('platform and user orders never mix despite shared model',()=>{const u=operations(d,c,new URLSearchParams({view:'orders'}),r),p=operations(d,c,new URLSearchParams({view:'platform-orders'}),r);assert.deepEqual(u.items.map(x=>x.id),['o']);assert.deepEqual(p.items.map(x=>x.id),['po']);assert.equal(p.metrics.find(m=>m.key==='orders').value,1);});
test('intersecting filters affect both metrics and all table rows',()=>{const p=operations(d,c,new URLSearchParams({view:'orders',status:'FILLED'}),r);assert.equal(p.total,0);assert.equal(p.metrics.find(m=>m.key==='orders').value,0);});
test('numeric sort and missing values',()=>{assert.deepEqual(sortRows([{volume:null},{volume:'9'},{volume:'100'}],'volume','desc').map(x=>x.volume),['100','9',null]);});
test('every navigation page has a valid result',()=>{for(const view of views){const result=operations(d,c,new URLSearchParams({view}),r);assert.ok(result.columns.length,view);assert.ok(Array.isArray(result.charts),view);}});

test('7-day cohort excludes immature users and out-of-window conversions',()=>{
 const users=[{id:'mature',registeredAt:'2026-11-01T00:00:00Z'},{id:'young',registeredAt:'2026-11-07T00:00:00Z'}];
 const bindings=users.map(u=>({clerkUserId:u.id,verifiedAt:u.registeredAt}));
 const agents=users.map(u=>({clerkUserId:u.id,createdAt:u.registeredAt}));
 const e={ownerClerkUserId:'mature',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-08T00:00:00Z'};
 const range={from:'2026-11-01T00:00:00Z',to:'2026-11-09T00:00:00Z'};
 const c=registrationCohort(users,bindings,agents,[e],range,range.to);
 assert.equal(c.sample,1);assert.equal(c.observing,1);assert.equal(c.traded,0);
 assert.equal(registrationCohort(users,bindings,agents,[{...e,executedAt:'2026-11-07T23:00:00Z'}],range,range.to).traded,1);
});

test('user overview shows six requested metrics with historical registration cutoff',()=>{
 const result=operations(d,c,new URLSearchParams({view:'users'}),r);
 assert.deepEqual(result.metrics.map(m=>m.label),['截至期末注册用户','本期新增注册','账户绑定率','7日配置转化率','7日首单转化率','本期活跃用户']);
 assert.equal(result.metrics[0].value,1);
 assert.equal(result.metrics[0].previous,1);
 assert.equal(result.metrics[2].value,0);
 assert.equal(result.metrics[3].value,null);
 const unknown=operations(d,{...c,status:'UNAVAILABLE',users:[]},new URLSearchParams({view:'users'}),r);
 assert.equal(unknown.metrics[0].value,null);
 assert.equal(unknown.metrics[2].value,null);
});

test('overview first traders excludes returning users and counts each new user once',()=>{
 const event={ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'1',orderId:'o'};
 const first={...event,executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,executions:[first,{...first,executedAt:'2026-11-09T02:00:00Z'}]};
 const get=s=>operations(s,c,new URLSearchParams({view:'overview'}),r).metrics;
 assert.equal(get(snapshot).find(m=>m.key==='firstTraders').value,1);
 assert.equal(get(snapshot).some(m=>m.key==='volume'),false);
 assert.equal(get({...snapshot,executions:[...snapshot.executions,{...event,executedAt:'2026-11-01T00:00:00Z'}]}).find(m=>m.key==='firstTraders').value,0);
});

test('overview exposes exactly four analysis panels with daily distinct orders',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'1',orderId:'o',executedAt:'2026-11-09T01:00:00Z',competition:'EPL'};
 const result=operations({...d,executions:[e,{...e}]},c,new URLSearchParams({view:'overview'}),r);
 assert.deepEqual(result.charts.map(x=>x.type),['line','funnel','dailyOrders','contribution']);
 assert.equal(result.charts[2].rows.find(x=>x.date==='2026-11-09').filled,1);
 assert.equal(result.charts[3].rows[0].value,'2');
 assert.equal(result.charts[1].rows.length,4);
});

test('overview user details count distinct traded orders and exclude settlement from activity',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'3',orderId:'old-order',executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,executions:[e,{...e,executedAt:'2026-11-09T02:00:00Z'},{...e,executionKind:'SETTLEMENT',executedAt:'2026-11-09T03:00:00Z'},{...e,executedAt:'2026-11-10T00:00:00Z'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'overview'}),r);
 assert.deepEqual(result.columns.map(x=>x.key),['displayName','registeredAt','lastActiveAt','stage','filled','volume']);
 assert.equal(result.sort,'volume');assert.equal(result.direction,'desc');
 assert.equal(result.items[0].filled,1);assert.equal(result.items[0].volume,'6');
 assert.equal(result.items[0].lastActiveAt,'2026-11-09T02:00:00Z');
 const empty=operations(d,c,new URLSearchParams({view:'overview'}),r).items[0];
 assert.equal(empty.lastActiveAt,null);assert.equal(empty.filled,0);
});

test('user page has reference panels and same seven-day cohort',()=>{
 const result=operations(d,c,new URLSearchParams({view:'users'}),r);
 assert.deepEqual(result.charts.map(x=>x.type),['line','funnel','retention','progress']);
 assert.equal(result.charts[1].rows.length,4);
 assert.equal(result.columns[4].key,'filled');
});
test('registration retention uses full Beijing observation days and excludes non-trades',()=>{
 const people=[{id:'mature',registeredAt:'2026-11-01T10:00:00Z'},{id:'young',registeredAt:'2026-11-03T01:00:00Z'}];
 const trade={ownerClerkUserId:'mature',agentId:'a',attributionStatus:'ATTRIBUTED',executionKind:'TRADE',executedAt:'2026-11-02T01:00:00Z'};
 const result=registrationRetention(people,[trade,{...trade},{...trade,ownerClerkUserId:'young',executionKind:'SETTLEMENT'}],{from:'2026-10-31T16:00:00Z',to:'2026-11-03T12:00:00Z'});
 assert.equal(result[0].cells[0].rate,100);assert.equal(result[0].cells[0].returned,1);
 assert.equal(result[0].cells[1].rate,null);assert.equal(result[1].cells[0].rate,null);
 assert.equal(result[1].cells[0].observing,1);
});
test('Agent charts deduplicate Agents and orders, and expose model sample sizes',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',modelId:'same-model',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'2',orderId:'o',executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,executions:[e,{...e}],orders:[...d.orders,{...d.orders[0],id:'o2'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'agents'}),r);
 assert.deepEqual(result.charts.map(x=>x.type),['trend','progress','comparison','progress']);
 assert.equal(result.charts[0].rows[0].executed,1);assert.equal(result.charts[2].rows[0].traded,1);
 const model=result.charts[1].rows[0];assert.equal(model.value,'4');assert.equal(model.filled,1);assert.equal(model.users,1);assert.equal(model.orders,2);
 assert.equal(result.items[0].filled,1);assert.ok(result.items[0].latestFailure);
 assert.equal(operations(snapshot,c,new URLSearchParams({view:'agents',q:'a'}),r).total,1);
});
test('order event and strategy totals preserve execution dates and isolate failures',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',modelId:'same-model',canonicalEventId:'event',fixtureName:'A vs B',positionMethod:'FIXED',competition:'EPL',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'2',orderId:'old',executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,orders:[{...d.orders[0],canonicalEventId:'event',fixtureName:'A vs B',failureReason:'timeout'},{...d.orders[0],id:'old',state:'FILLED',createdAt:'2026-11-01T00:00:00Z'}],executions:[e,{...e}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'orders'}),r);
 assert.deepEqual(result.charts.map(x=>x.type),['orderTrend','progress','progress','progress']);
 assert.equal(result.eventRows[0].orders,1);assert.equal(result.eventRows[0].filled,1);assert.equal(result.eventRows[0].volume,'4');assert.equal(result.eventRows[0].failed,1);
 assert.equal(result.charts[2].rows[0].value,'4');
 const filtered=operations(snapshot,c,new URLSearchParams({view:'orders',reason:'timeout'}),r);
 assert.equal(filtered.items.length,1);assert.equal(filtered.metrics.find(x=>x.key==='volume').value,'0');
});


test('failure page compares daily current statuses, fills gaps, and respects explicit filters',()=>{
 const snapshot={...d,orders:[{...d.orders[0],failureReason:'timeout'},{...d.orders[0],id:'filled',state:'FILLED'},{...d.orders[0],id:'pending',state:'PENDING',createdAt:'2026-11-07T17:00:00Z'}]};
 const range={...r,from:'2026-11-06T16:00:00Z'};
 const input=new URLSearchParams({view:'failures'});
 const result=operations(snapshot,c,input,range),chart=result.charts[0];
 assert.equal(input.has('status'),false);
 assert.deepEqual(result.charts.map(c=>c.title),['订单当前状态分布','失败原因']);
 assert.equal(chart.type,'timeBars');assert.equal(chart.label,'date');assert.equal(chart.integerTicks,true);
 assert.equal(chart.rows.length,3);assert.equal(chart.rows[0].FAILED,0);
 assert.equal(chart.rows[1].PENDING,1);assert.equal(chart.rows[2].FILLED,1);assert.equal(chart.rows[2].FAILED,1);assert.equal(chart.rows[2].AMBIGUOUS,0);
 assert.equal(new Set(chart.seriesKeys.map(k=>chart.seriesColors[k])).size,7);
 assert.equal(chart.seriesLabels.FAILED,'失败');assert.equal(result.total,3);
 assert.deepEqual(result.charts[1].rows,[{name:'timeout',value:1}]);
 const filtered=operations(snapshot,c,new URLSearchParams({view:'failures',status:'FILLED'}),range);
 assert.equal(filtered.total,1);assert.equal(filtered.charts[0].rows[2].FAILED,0);assert.equal(filtered.charts[0].rows[2].FILLED,1);assert.deepEqual(filtered.charts[1].rows,[]);
});


test('platform order strategy analysis isolates platform data and uses execution dates and snapshots',()=>{
 const order={...d.platformOrders[0],positionMethod:'FIXED',competition:'EPL'};
 const execution={platformModelAccountId:'p',platformOrderId:'po',modelId:'same-model',competition:'EPL',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-09T02:00:00Z',actualFilledValue:'3'};
 const snapshot={...d,platformOrders:[order,{...order,id:'failed',state:'FAILED',requestedStake:'5'},{...order,id:'old',positionMethod:'FRACTIONAL_KELLY',createdAt:'2026-11-01T00:00:00Z'},{...order,id:'missing',positionMethod:null}],platformExecutions:[execution,{...execution,actualFilledValue:'2'},{...execution,platformOrderId:'old',actualFilledValue:'7'},{...execution,executionKind:'SETTLEMENT',actualFilledValue:'100'}]};
 const get=params=>operations(snapshot,c,new URLSearchParams({view:'platform-orders',...params}),r).charts.find(x=>x.type==='strategyAnalysis');
 const chart=get({}),fixed=chart.rows.find(x=>x.name==='FIXED');
 assert.equal(fixed.orders,2);assert.equal(fixed.requested,'25');assert.equal(fixed.filled,1);assert.equal(fixed.volume,'5');assert.equal(fixed.failed,1);assert.equal(fixed.rate,50);
 const old=chart.rows.find(x=>x.name==='FRACTIONAL_KELLY');assert.equal(old.orders,0);assert.equal(old.filled,1);assert.equal(old.volume,'7');assert.equal(old.rate,null);
 assert.equal(chart.rows.find(x=>x.name==='未记录').orders,1);
 assert.equal(get({strategy:'FIXED'}).rows.length,1);assert.equal(get({market:'NBA'}).rows.length,0);assert.equal(get({model:'other'}).rows.length,0);
 assert.equal(get({status:'FAILED'}).rows[0].volume,'0');
});


test('market overview compares order counts and requested amounts before event ranking',()=>{
 const order={...d.orders[0],competition:'EPL',requestedStake:'10'};
 const snapshot={...d,orders:[order,{...order,id:'o2',state:'PENDING',requestedStake:'2.5'},{...order,id:'nba',competition:'NBA',requestedStake:'7'},{...order,id:'old',createdAt:'2026-11-01T00:00:00Z',requestedStake:'100'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'events'}),r);
 assert.deepEqual(result.charts.map(x=>x.title),['市场累计订单数','市场累计金额','比赛盈亏排名']);
 assert.deepEqual(result.charts[0].rows,[{name:'EPL',orders:2,amount:'12.5'},{name:'NBA',orders:1,amount:'7'}]);
 assert.equal(result.charts[0].key,'orders');assert.equal(result.charts[1].key,'amount');
 const selected=operations(snapshot,c,new URLSearchParams({view:'events',market:'NBA'}),r);
 assert.deepEqual(selected.charts[1].rows,[{name:'NBA',orders:1,amount:'7'}]);
});
