import test from 'node:test';
import assert from 'node:assert/strict';
import {compare,previousRange,sortRows,operations,views,registrationCohort,registrationRetention} from '../api/operations.mjs';
const d={asOf:'2026-11-09T10:00:00Z',official:new Set(['platform-owner']),users:[{clerkUserId:'u'}],agents:[{id:'a',clerkUserId:'u',createdAt:'2026-11-01T00:00:00Z'}],bindings:[],orders:[{id:'o',ownerClerkUserId:'u',agentId:'a',modelId:'same-model',state:'FAILED',createdAt:'2026-11-09T01:00:00Z',requestedStake:'10'}],executions:[],platform:[{id:'p',modelId:'same-model'}],platformOrders:[{id:'po',modelId:'same-model',state:'PENDING',createdAt:'2026-11-09T01:00:00Z',requestedStake:'20'}],platformExecutions:[],signals:[],analyses:[]};
const c={status:'AVAILABLE',users:[{id:'u',registeredAt:'2026-11-01T00:00:00Z'},{id:'platform-owner',registeredAt:'2026-11-01T00:00:00Z'}]};
const r={kind:'today',from:'2026-11-08T16:00:00Z',to:'2026-11-09T10:00:00Z'};
test('comparison handles missing, zero, percentages and profit sign changes',()=>{assert.equal(compare(null,0).text,'—');assert.match(compare(2,0).text,/新增/);assert.match(compare(15,12,'rate').text,/3.00 个百分点/);assert.match(compare(2,-3,'pnl').text,/转盈/);assert.equal(compare(0,0).text,'持平');});
test('equal elapsed duration and cumulative exclusion',()=>{const p=previousRange(r,d.asOf);assert.equal(+new Date(p.to)-new Date(p.from),+new Date(r.to)-new Date(r.from));assert.equal(previousRange({...r,kind:'all'},d.asOf),null);});
test('platform and user orders never mix despite shared model',()=>{const u=operations(d,c,new URLSearchParams({view:'orders'}),r),p=operations(d,c,new URLSearchParams({view:'platform-orders'}),r);assert.deepEqual(u.items.map(x=>x.id),['o']);assert.deepEqual(p.items.map(x=>x.id),['po']);assert.equal(p.metrics.length,0);});
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
 assert.deepEqual(result.metrics.slice(0,6).map(m=>m.label),['截至期末注册用户','本期新增注册','账户绑定率','7日配置转化率','7日首单转化率','本期活跃用户']);
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
 assert.deepEqual(result.charts.map(x=>x.type),['line','funnel','progress']);
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
test('Agent charts deduplicate Agents and orders without repeating model contribution',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',modelId:'same-model',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'2',orderId:'o',executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,executions:[e,{...e}],orders:[...d.orders,{...d.orders[0],id:'o2'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'agents'}),r);
 assert.deepEqual(result.charts.map(x=>x.type),['trend','comparison']);
 assert.equal(result.charts[0].rows[0].executed,1);assert.equal(result.charts[1].rows[0].traded,1);
 assert.equal(result.charts.some(c=>c.title==='模型成交贡献'),false);
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
 assert.equal(chart.seriesLabels.FAILED,'失败');assert.equal(result.total,1);assert.equal(result.items[0].state,'FAILED');
 assert.deepEqual(result.charts[1].rows,[{name:'timeout',value:1}]);
 const filtered=operations(snapshot,c,new URLSearchParams({view:'failures',status:'FILLED'}),range);
 assert.equal(filtered.total,0);assert.equal(filtered.charts[0].rows[2].FAILED,0);assert.equal(filtered.charts[0].rows[2].FILLED,1);assert.deepEqual(filtered.charts[1].rows,[]);
});


test('platform overview strategy analysis isolates platform data and uses execution dates and snapshots',()=>{
 const order={...d.platformOrders[0],positionMethod:'FIXED',competition:'EPL'};
 const execution={actualFilledShares:'1',feeAmount:'0',feeType:'COLLATERAL',platformModelAccountId:'p',platformOrderId:'po',modelId:'same-model',competition:'EPL',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-09T02:00:00Z',actualFilledValue:'3'};
 const snapshot={...d,platformOrders:[order,{...order,id:'failed',state:'FAILED',requestedStake:'5'},{...order,id:'old',positionMethod:'FRACTIONAL_KELLY',createdAt:'2026-11-01T00:00:00Z'},{...order,id:'missing',positionMethod:null}],platformExecutions:[execution,{...execution,actualFilledValue:'2'},{...execution,platformOrderId:'old',actualFilledValue:'7'},{...execution,executionKind:'SETTLEMENT',actualFilledValue:'100'}]};
 const get=params=>operations(snapshot,c,new URLSearchParams({view:'platform',...params}),r).charts.find(x=>x.type==='strategyAnalysis');
 const chart=get({}),fixed=chart.rows.find(x=>x.name==='FIXED');
 assert.equal(fixed.orders,2);assert.equal(fixed.requested,'25');assert.equal(fixed.filled,1);assert.equal(fixed.volume,'5');assert.equal(fixed.failed,1);assert.equal(fixed.rate,50);
 const old=chart.rows.find(x=>x.name==='FRACTIONAL_KELLY');assert.equal(old.orders,0);assert.equal(old.filled,1);assert.equal(old.volume,'7');assert.equal(old.rate,null);
 assert.equal(chart.rows.find(x=>x.name==='未记录').orders,1);
 assert.equal(get({strategy:'FIXED'}).rows.length,1);assert.equal(get({market:'NBA'}).rows.length,0);assert.equal(get({model:'other'}).rows.length,0);
 assert.equal(get({status:'FAILED'}).rows[0].volume,'0');
});


test('market overview accumulates daily orders and requested amounts before event ranking',()=>{
 const order={...d.orders[0],competition:'EPL',requestedStake:'10'};
 const snapshot={...d,orders:[order,{...order,id:'o2',state:'PENDING',requestedStake:'2.5'},{...order,id:'nba',competition:'NBA',requestedStake:'7'},{...order,id:'old',createdAt:'2026-11-01T00:00:00Z',requestedStake:'100'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'events'}),r);
 assert.deepEqual(result.charts.map(x=>x.title),['每日累计订单数','每日累计下单金额','比赛盈亏排名']);
 assert.deepEqual(result.charts[0].rows.map(({date,orders,amount})=>({date,orders,amount})),[{date:'2026-11-09',orders:3,amount:'19.5'}]);
 assert.equal(result.charts[0].key,'orders');assert.equal(result.charts[1].key,'amount');
 const selected=operations(snapshot,c,new URLSearchParams({view:'events',market:'NBA'}),r);
 assert.deepEqual(selected.charts[1].rows.map(({date,orders,amount})=>({date,orders,amount})),[{date:'2026-11-09',orders:1,amount:'7'}]);
 const extended=operations({...snapshot,orders:[...snapshot.orders,{...order,id:'earlier',createdAt:'2026-11-07T01:00:00Z',requestedStake:'0.1'},{...order,id:'earlier',createdAt:'2026-11-07T01:00:00Z',requestedStake:'0.1'}]},c,new URLSearchParams({view:'events'}),{...r,kind:'custom',from:'2026-11-05T16:00:00Z'});
 assert.deepEqual(extended.charts[0].rows.map(({date,orders,amount})=>({date,orders,amount})),[{date:'2026-11-06',orders:0,amount:'0'},{date:'2026-11-07',orders:1,amount:'0.1'},{date:'2026-11-08',orders:1,amount:'0.1'},{date:'2026-11-09',orders:4,amount:'19.6'}]);
 assert.equal(extended.charts[1].cumulativeOrders,true);
 const count=result.charts[0],amount=result.charts[1];
 const key=market=>count.seriesKeys.find(k=>count.seriesLabels[k]===market);
 assert.equal(count.rows[0][key('EPL')],2);assert.equal(count.rows[0][key('NBA')],1);
 assert.equal(amount.rows[0][key('EPL')],'12.5');assert.equal(amount.rows[0][key('NBA')],'7');
 assert.notEqual(count.seriesColors[key('EPL')],count.seriesColors[key('NBA')]);
 assert.deepEqual(count.seriesColors,amount.seriesColors);
 assert.equal(selected.charts[1].seriesKeys.length,1);
 assert.equal(selected.charts[1].seriesColors[key('NBA')],count.seriesColors[key('NBA')]);
 assert.deepEqual(extended.charts[0].rows.map(row=>row[key('EPL')]),[0,1,1,3]);
 assert.deepEqual(extended.charts[1].rows.map(row=>row[key('NBA')]),['0','0','0','7']);


});


test('Agent daily comparison explains independent activity sets without inferring conversion',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'1',orderId:'o',executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,executions:[e,{...e},{...e,agentId:'old-agent',orderId:'old'},{...e,agentId:'settled-only',executionKind:'SETTLEMENT'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'agents'}),r);
 const chart=result.charts.find(x=>x.type==='comparison'),row=chart.rows[0];
 assert.equal(row.executed,1);assert.equal(row.traded,2);assert.equal(row.both,1);assert.equal(row.tradedWithoutNewOrder,1);
 assert.equal(row.both+row.tradedWithoutNewOrder,row.traded);assert.match(chart.note,/不能相除作为转化率/);
 const empty=operations({...d,orders:[],executions:[]},c,new URLSearchParams({view:'agents'}),r).charts.find(x=>x.type==='comparison').rows[0];
 assert.equal(empty.both,0);assert.equal(empty.tradedWithoutNewOrder,0);
});


test('user information displays email while keeping identity keys for links and filtering',()=>{
 const identity={...c,users:c.users.map(u=>({...u,email:u.id==='u'?'member@example.test':'platform@example.test'}))};
 for(const view of ['overview','users','user-list','agents','orders','order-list','failures']){
  const result=operations(d,identity,new URLSearchParams({view}),r),row=result.items[0];
  assert.equal(row.userEmail,'member@example.test',view);
  assert.equal(result.columns.some(c=>['ownerClerkUserId','clerkUserId'].includes(c.key)),false,view);
  if(['overview','users','agents'].includes(view))assert.ok(row.displayName.includes('member@example.test'),view);
 }
 const orders=operations(d,identity,new URLSearchParams({view:'order-list',q:'member@example.test'}),r);
 assert.equal(orders.total,1);assert.equal(orders.items[0].ownerClerkUserId,'u');
 const missing=operations(d,c,new URLSearchParams({view:'users'}),r);
 assert.equal(missing.items[0].displayName,'邮箱未获取');assert.equal(missing.items[0].id,'u');
 assert.deepEqual(missing.charts.map(c=>c.type),['line','funnel','progress']);
});


test('unattributed and conflicting execution details include meaning and reporting impact',()=>{
 const base={ownerClerkUserId:'u',executionKind:'TRADE',executedAt:'2026-11-09T01:00:00Z',actualFilledValue:'2'};
 const snapshot={...d,executions:[{...base,attributionStatus:'UNATTRIBUTED',sourceEventKey:'unmatched'},{...base,attributionStatus:'CONFLICT',sourceEventKey:'conflicting'}]};
 const out=operations(snapshot,c,new URLSearchParams({view:'quality'}),r);
 assert.equal(out.columns.some(c=>c.key==='dataExplanation'),false);
 assert.match(out.items.find(x=>x.sourceEventKey==='unmatched').dataExplanation,/不等于成交失败/);
 assert.match(out.items.find(x=>x.sourceEventKey==='conflicting').dataExplanation,/排除在正式成交/);
 assert.ok(out.notes.some(n=>n.includes('PARTIAL')));
 assert.equal(operations(snapshot,c,new URLSearchParams({view:'orders'}),r).metrics.find(m=>m.key==='volume').value,'0');
});


test('trade-date order drill includes older orders and sums only selected-period trades',()=>{
 const order={...d.orders[0],id:'old',createdAt:'2026-11-01T00:00:00Z',state:'FILLED'};
 const e={ownerClerkUserId:'u',agentId:'a',orderId:'old',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-09T01:00:00Z',actualFilledValue:'2'};
 const snap={...d,orders:[order,...d.orders],executions:[e,{...e,actualFilledValue:'3'},{...e,executedAt:'2026-11-01T01:00:00Z',actualFilledValue:'100'},{...e,executionKind:'SETTLEMENT',actualFilledValue:'20'}]};
 const get=filters=>operations(snap,c,new URLSearchParams({view:'order-list',...filters}),r);
 assert.deepEqual(get({}).items.map(x=>x.id),['o']);
 const traded=get({orderBasis:'traded'});assert.equal(traded.total,1);assert.equal(traded.items[0].id,'old');assert.equal(traded.items[0].amount,'5');assert.equal(traded.charts.length,0);
 assert.equal(get({orderBasis:'traded',status:'FAILED'}).total,0);
 const trades=operations(snap,c,new URLSearchParams({view:'executions',executionKind:'TRADE'}),r);
 const settlements=operations(snap,c,new URLSearchParams({view:'executions',executionKind:'SETTLEMENT'}),r);
 assert.equal(trades.total,1);assert.equal(settlements.total,1);assert.equal(trades.items[0].tradeAmount,'5');assert.equal(trades.items[0].settlementAmount,'20');assert.equal(trades.items[0].events.length,3);
});
test('cohort detail uses same mature batch and sequential intersections as overview funnel',()=>{
 const identity={status:'AVAILABLE',users:[{id:'u',email:'a@test',registeredAt:'2026-11-01T00:00:00Z'},{id:'young',registeredAt:'2026-11-08T00:00:00Z'}]};
 const snap={...d,bindings:[{clerkUserId:'u',verifiedAt:'2026-11-02T00:00:00Z'}],agents:[{id:'a',clerkUserId:'u',createdAt:'2026-11-03T00:00:00Z'}],executions:[{ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-04T00:00:00Z',actualFilledValue:'1',orderId:'o'}]};
 const period={...r,from:'2026-10-31T16:00:00Z'};
 const overview=operations(snap,identity,new URLSearchParams({view:'users'}),period);
 const funnel=overview.charts.find(c=>c.type==='funnel');
 for(const [index,population] of ['registered','bound','configured','traded'].entries()){
  const out=operations(snap,identity,new URLSearchParams({view:'user-list',population:'cohort-'+population}),period);
  assert.equal(out.total,funnel.rows[index].value);assert.equal(out.items[0].id,'u');
 }
 assert.equal(operations(snap,identity,new URLSearchParams({view:'user-list',population:'registered'}),r).total,0);
});
test('detail pages honor Agent activity and user search transferred to orders',()=>{
 const snap={...d,agents:[...d.agents,{id:'inactive',clerkUserId:'u'}]};
 const out=operations(snap,c,new URLSearchParams({view:'agents',agentActivity:'ordered'}),r);
 assert.equal(out.total,1);assert.equal(out.items[0].id,'a');
 assert.equal(operations(snap,c,new URLSearchParams({view:'agents',agentActivity:'traded'}),r).total,0);
 const identity={...c,users:c.users.map(u=>({...u,email:'member@example.test'}))};
 assert.equal(operations(snap,identity,new URLSearchParams({view:'order-list',q:'member@example.test',searchScope:'users'}),r).total,1);
});

test('execution table merges by owner Agent and order, retaining unlinked and unmatched rows',()=>{
 const base={ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-09T01:00:00Z',actualFilledValue:'2'};
 const buy={...base,orderId:'o',sourceEventKey:'buy'};
 const result=operations({...d,executions:[buy,{...buy},{...buy,sourceEventKey:'settle',executionKind:'SETTLEMENT',actualFilledValue:'7'},{...base,orderId:'other'},{...base,sourceEventKey:'unlinked1'},{...base,sourceEventKey:'unlinked2'},{...base,orderId:'o',agentId:'different'}]},c,new URLSearchParams({view:'executions'}),r);
 assert.equal(result.total,5);
 const merged=result.items.find(e=>e.orderId==='o'&&e.agentId==='a');
 assert.equal(merged.tradeAmount,'2');assert.equal(merged.settlementAmount,'7');assert.equal(merged.tradeCount,1);assert.equal(merged.settlementCount,1);
 assert.ok(result.charts.some(c=>c.key==='volume'));
});

test('section KPIs appear once on user and order overview pages',()=>{
 const get=view=>operations(d,c,new URLSearchParams({view}),r);
 for(const view of ['user-list','activity','agents','funds','order-list','executions','failures','platform-orders','platform-pnl'])assert.equal(get(view).metrics.length,0,view);
 const users=get('users').metrics;assert.equal(new Set(users.map(x=>x.key)).size,users.length);
 assert.deepEqual(users.map(x=>x.key),['registeredEnd','registered','bindingRate','configConversion','cohortConversion','traders']);
 assert.equal(get('orders').metrics.find(x=>x.key==='orders').value,1);
});
test('market leaders use requested order totals and handle missing profit samples',()=>{
 const orders=[{...d.orders[0],canonicalEventId:'e1',fixtureName:'A vs B',modelId:'provider/a',requestedStake:'12'},{...d.orders[0],id:'second',canonicalEventId:'e1',fixtureName:'A vs B',modelId:'provider/b',requestedStake:'20'},{...d.orders[0],id:'third',canonicalEventId:'e2',fixtureName:'C vs D',modelId:'provider/a',requestedStake:'2'}];
 const result=operations({...d,orders},c,new URLSearchParams({view:'events'}),r);
 assert.equal(result.metrics.length,6);
 const metric=key=>result.metrics.find(x=>x.key===key);
 assert.equal(metric('event-orders').value,2);assert.equal(metric('event-amount').value,'32');assert.deepEqual(metric('event-orders').destination.filters,{event:['e1']});
 assert.equal(metric('model-orders').value,2);assert.deepEqual(metric('model-amount').destination.filters,{model:['provider/b']});
 assert.equal(metric('event-profit').value,null);assert.equal(metric('model-loss'),undefined);assert.equal(metric('event-loss'),undefined);
 const scoped=operations({...d,orders},c,new URLSearchParams({view:'events',model:'provider/a'}),r);
 assert.equal(scoped.metrics.find(x=>x.key==='event-amount').value,'12');
});

test('platform order direction uses canonical outcome and YES NO side',()=>{
 const orders=['HOME','DRAW','AWAY'].map((canonicalOutcome,i)=>({...d.platformOrders[0],id:'direction'+i,canonicalOutcome,positionSide:'YES',homeTeamName:'A',awayTeamName:'B'}));
 orders.push({...orders[0],id:'no',positionSide:'NO'});
 const result=operations({...d,platformOrders:orders},c,new URLSearchParams({view:'platform-orders'}),r);
 assert.ok(result.columns.some(x=>x.key==='betDirection'));
 const labels=result.items.map(x=>x.betDirection);for(const label of ['A胜','平局','B胜','否：A胜'])assert.ok(labels.includes(label));
});
test('single event metadata uses latest recorded fixture kickoff',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',orderId:'o',modelId:'same-model',canonicalEventId:'event',executionKind:'TRADE',side:'BUY',attributionStatus:'ATTRIBUTED',executedAt:'2026-11-09T01:00:00Z',actualFilledShares:'1',actualFilledValue:'0.5',actualExecutionPrice:'0.5',feeAmount:'0',feeType:'COLLATERAL',marketId:'m',tokenId:'t'};
 const result=operations({...d,executions:[e],eventRevisions:[{eventId:'event',kickoffAt:'2026-11-10T20:00:00Z'}]},c,new URLSearchParams({view:'events'}),r);
 assert.equal(result.items[0].kickoffAt,'2026-11-10T20:00:00Z');
});

test('shared analysis shows predictions and precisely linked user and platform decisions',()=>{
 const analysis={id:'analysis',modelId:'same-model',state:'COMPLETED',createdAt:'2026-11-09T00:00:00Z',outcomeProbabilities:{home_win:0.6,draw:0.25,away_win:0.15}};
 const base={id:'s',sharedModelAnalysisId:'analysis',ownerClerkUserId:'u',decidedAt:'2026-11-09T01:00:00Z',decision:'BUY',canonicalOutcome:'home_win',positionSide:'YES',homeTeamName:'A'};
 const snapshot={...d,analyses:[analysis],signals:[base,{...base,id:'skip',decision:'NO_TRADE'},{...base,id:'other',sharedModelAnalysisId:'different'}],platformDecisions:[{...base,canonicalOutcome:'DRAW',positionSide:'NO'}]};
 const row=operations(snapshot,c,new URLSearchParams({view:'analyses'}),r).items[0];
 assert.equal(row.predictedProbabilities,'主胜 60.0% / 平局 25.0% / 客胜 15.0%');assert.equal(row.agentSignals,'买入 · A胜：1 条；不交易：1 条');assert.equal(row.platformDecisionSummary,'买入 · 否：平局：1 条');
 const missing=operations({...d,analyses:[{...analysis,state:'FAILED'}]},c,new URLSearchParams({view:'analyses'}),r).items[0];assert.equal(missing.predictedProbabilities,'暂无有效预测');assert.equal(missing.agentSignals,'暂无关联记录');
});

test('platform PnL details have a separate entry with the same filtered rows and no charts or cards',()=>{
 const get=view=>operations(d,c,new URLSearchParams({view,model:'same-model'}),r);
 const analysis=get('platform-pnl'),details=get('platform-pnl-details');
 assert.deepEqual(details.items,analysis.items);
 assert.deepEqual(details.columns,analysis.columns);
 assert.equal(details.charts.length,0);
 assert.equal(details.metrics.length,0);
 assert.ok(analysis.charts.length>0);
});

test('user detail menu preserves cohort filters and rows without duplicate charts',()=>{
 const get=(view,population)=>operations(d,c,new URLSearchParams({view,...(population?{population}:{})}),r);
 for(const population of [undefined,'registered','registeredEnd','cohort-registered','traded']){
  const analysis=get('user-list',population),details=get('user-details',population);
  assert.deepEqual(details.items,analysis.items);
  assert.deepEqual(details.columns,analysis.columns);
  assert.equal(details.metrics.length,0);
  assert.equal(details.charts.length,0);
  assert.ok(analysis.charts.length>0);
 }
});

test('daily model cash balance uses last snapshot per Beijing day and leaves missing dates empty',()=>{
 const snapshot={...d,platformSnapshots:[
  {modelId:'same-model',asOf:'2026-11-06T15:00:00Z',cashBalance:'100',accountValue:'900'},
  {modelId:'same-model',asOf:'2026-11-06T16:05:00Z',cashBalance:'80'},
  {modelId:'same-model',asOf:'2026-11-07T15:59:00Z',cashBalance:'70'},
  {modelId:'same-model',asOf:'2026-11-09T01:00:00Z',cashBalance:'60'},
  {modelId:'same-model',asOf:r.to,cashBalance:'999'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'platform-pnl'}),{...r,kind:'custom',from:'2026-11-05T16:00:00Z'});
 const chart=result.charts.find(x=>x.title==='平台各模型每日现金余额');
 assert.deepEqual(chart.rows.map(x=>x['same-model']),['100','70',null,'60']);
 assert.deepEqual(chart.rows.map(x=>x.date),['2026-11-06','2026-11-07','2026-11-08','2026-11-09']);
 assert.equal(chart.timeScale,undefined);
});
