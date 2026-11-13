import test from 'node:test';
import assert from 'node:assert/strict';
import {compare,previousRange,sortRows,operations,views,registrationCohort,registrationRetention} from '../api/operations.mjs';
const d={asOf:'2026-11-09T10:00:00Z',official:new Set(['platform-owner']),users:[{clerkUserId:'u'}],agents:[{id:'a',clerkUserId:'u',createdAt:'2026-11-01T00:00:00Z'}],bindings:[],orders:[{id:'o',ownerClerkUserId:'u',agentId:'a',modelId:'same-model',state:'FAILED',createdAt:'2026-11-09T01:00:00Z',requestedStake:'10'}],executions:[],platform:[{id:'p',modelId:'same-model'}],platformOrders:[{id:'po',modelId:'same-model',state:'PENDING',createdAt:'2026-11-09T01:00:00Z',requestedStake:'20'}],platformExecutions:[],signals:[],analyses:[]};
const c={status:'AVAILABLE',users:[{id:'u',registeredAt:'2026-11-01T00:00:00Z'},{id:'platform-owner',registeredAt:'2026-11-01T00:00:00Z'}]};
const r={kind:'today',from:'2026-11-08T16:00:00Z',to:'2026-11-09T10:00:00Z'};
test('comparison handles missing, zero, percentages and profit sign changes',()=>{assert.equal(compare(null,0).text,'—');assert.equal(compare(2,0).text,'+2.00');assert.equal(compare(-2,0).text,'-2.00');assert.match(compare(15,12,'rate').text,/3.00 个百分点/);assert.match(compare(2,-3,'pnl').text,/转盈/);assert.equal(compare(0,0).text,'持平');});
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
 assert.deepEqual(result.metrics.slice(0,6).map(m=>m.label),['累计注册用户','本期新增注册','账户绑定率','7日配置转化率','7日首次成交转化率','本期成交用户']);
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
 assert.deepEqual(result.charts.map(x=>x.type),['linkedTrend','comparisonSummary','comparisonSummary','funnel','progress']);
 assert.equal(result.charts.find(c=>c.type==='funnel').rows.length,4);
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
 assert.deepEqual(result.charts.map(x=>x.type),['linkedTrend','comparisonSummary','comparisonSummary','progress','progress']);
 assert.equal(result.charts[0].rows[0].orderedAgents,1);assert.equal(result.charts[0].rows[0].tradedAgents,1);
 assert.equal(result.charts.some(c=>c.title==='模型成交贡献'),false);
 assert.equal(result.items[0].filled,1);assert.ok(result.items[0].latestFailure);
 assert.equal(operations(snapshot,c,new URLSearchParams({view:'agents',q:'a'}),r).total,1);
});
test('order event and strategy totals preserve execution dates and isolate failures',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',modelId:'same-model',canonicalEventId:'event',fixtureName:'A vs B',positionMethod:'FIXED',competition:'EPL',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'2',orderId:'old',executedAt:'2026-11-09T01:00:00Z'};
 const snapshot={...d,orders:[{...d.orders[0],canonicalEventId:'event',fixtureName:'A vs B',failureReason:'timeout'},{...d.orders[0],id:'old',state:'FILLED',createdAt:'2026-11-01T00:00:00Z'}],executions:[e,{...e}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'orders'}),r);
 assert.deepEqual(result.charts.map(x=>x.type),['linkedTrend','progress','progress','progress','comparisonSummary']);
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
 assert.deepEqual(result.charts.map(x=>x.title),['每日累计订单数','每日累计下单金额','比赛盈亏排名','市场下单、成交与盈亏每日对照','市场本期与上期表现对比','市场参与、成交与盈亏联查']);
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
 const snapshot={...d,agents:[...d.agents,{id:'old-agent',clerkUserId:'u',createdAt:'2026-11-01T00:00:00Z'}],executions:[e,{...e},{...e,agentId:'old-agent',orderId:'old'},{...e,agentId:'settled-only',executionKind:'SETTLEMENT'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'agents'}),r);
 const chart=result.charts.find(x=>x.type==='linkedTrend'),row=chart.rows[0];
 assert.equal(row.orderedAgents,1);assert.equal(row.tradedAgents,2);assert.equal(row.both,1);assert.equal(row.tradedWithoutNewOrder,1);
 assert.equal(row.both+row.tradedWithoutNewOrder,row.tradedAgents);assert.match(chart.note,/不能相除作为转化率/);
 const empty=operations({...d,orders:[],executions:[]},c,new URLSearchParams({view:'agents'}),r).charts.find(x=>x.type==='linkedTrend').rows[0];
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
 assert.deepEqual(missing.charts.map(c=>c.type),['linkedTrend','comparisonSummary','comparisonSummary','funnel','progress']);
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
 for(const view of ['user-list','agents','funds','order-list','executions','failures','platform-orders','platform-pnl'])assert.equal(get(view).metrics.length,0,view);
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
 assert.deepEqual(details.items.map(({modelId,realizedPnl,volume})=>({modelId,realizedPnl,volume})),analysis.items.map(({modelId,realizedPnl,volume})=>({modelId,realizedPnl,volume})));
 assert.ok(details.columns.some(col=>col.key==='pendingCount'));
 assert.equal(details.items[0].status,'RECORDED');
 assert.equal(details.charts.length,0);
 assert.equal(details.metrics.length,0);
 assert.ok(analysis.charts.length>0);
});

test('user detail menu preserves cohort filters and rows without duplicate charts',()=>{
 const get=(view,population)=>operations(d,c,new URLSearchParams({view,...(population?{population}:{})}),r);
 for(const population of [undefined,'registered','registeredEnd','cohort-registered','traded']){
  const analysis=get('user-list',population),details=get('user-details',population);
  assert.deepEqual(details.items.map(x=>x.id),analysis.items.map(x=>x.id));
  for(const row of details.items)for(const [key,value] of Object.entries(analysis.items.find(x=>x.id===row.id)))assert.deepEqual(row[key],value);
  assert.deepEqual(details.columns.slice(0,analysis.columns.length),analysis.columns);
  assert.ok(details.columns.some(x=>x.key==='liveState'));
  assert.ok(details.columns.some(x=>x.key==='firstTradeAt'));
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

test('daily ordering users deduplicate across orders and Agents and preserve zero days',()=>{
 const orders=[d.orders[0],{...d.orders[0],id:'o2',agentId:'another'},{...d.orders[0],id:'o3',createdAt:'2026-11-08T01:00:00Z'}];
 const result=operations({...d,orders},c,new URLSearchParams({view:'users'}),{...r,kind:'custom',from:'2026-11-06T16:00:00Z'});
 const chart=result.charts.find(x=>x.type==='linkedTrend'&&x.key==='registered');
 assert.equal(result.charts.filter(x=>x.key==='registered').length,1);
 assert.equal(result.charts.some(x=>x.key==='orderedUsers'),false);
 assert.ok(chart.seriesKeys.includes('previousRegistered'));
 assert.ok(chart.rows.every(row=>Object.hasOwn(row,'previousRegistered')));
 assert.deepEqual(chart.rows.map(({date,orderedUsers})=>({date,orderedUsers})),[{date:'2026-11-07',orderedUsers:0},{date:'2026-11-08',orderedUsers:1},{date:'2026-11-09',orderedUsers:1}]);
 assert.equal(result.charts.find(x=>x.key==='liveEnabledUsers'),undefined);
});

test('registration-day drill retains observation period and downstream users orders',()=>{
 const identity={...c,users:[{id:'u',email:'u@example.com',registeredAt:'2026-11-07T01:00:00Z'}]};
 const period={...r,kind:'custom',from:'2026-11-06T16:00:00Z'};
 const result=operations(d,identity,new URLSearchParams({view:'user-details',registeredFrom:'2026-11-07',registeredTo:'2026-11-07'}),period);
 assert.equal(result.total,1);assert.equal(result.items[0].orders,1);assert.equal(result.items[0].firstOrderAt,'2026-11-09T01:00:00Z');
 assert.equal(operations(d,identity,new URLSearchParams({view:'user-details',registeredFrom:'2026-11-08'}),period).total,0);
 assert.equal(operations(d,identity,new URLSearchParams({view:'user-details',registrationGroup:'new',population:'ordered'}),period).total,1);
 assert.equal(operations(d,identity,new URLSearchParams({view:'user-details',registrationGroup:'existing'}),period).total,0);
});
test('Agent state comparison and detail share current-state filters',()=>{
 const snapshot={...d,agents:[{...d.agents[0],liveEnabled:true},{...d.agents[0],id:'off',liveEnabled:false}],orders:[d.orders[0],{...d.orders[0],id:'off-order',agentId:'off'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'agents'}),r),panel=result.charts.find(x=>x.title==='Agent 使用与交易参与');
 assert.deepEqual(panel.rows.map(x=>x.values.ordered),[1,1]);
 assert.equal(panel.agentParticipation,true);
 for(const row of panel.rows){
  assert.equal(row.values.orderRate,row.values.ordered/row.values.agents*100);
  assert.equal(row.values.tradeRate,row.values.traded/row.values.agents*100);
  for(const key of ['orders','volume','orderRate','tradeRate']){
   const link=row.links[key],params=new URLSearchParams({view:link.view});
   for(const [name,values] of Object.entries(link.filters))for(const value of values)params.append(name,value);
   const result=operations(snapshot,c,params,r);
   if(key==='orders')assert.equal(result.total,row.values.orders);
   if(key==='orderRate')assert.equal(result.total,row.values.ordered);
   if(key==='tradeRate')assert.equal(result.total,row.values.traded);
  }
 }
 const empty=operations({...snapshot,agents:[]},c,new URLSearchParams({view:'agents'}),r).charts.find(x=>x.agentParticipation);
 assert.ok(empty.rows.every(row=>row.values.orderRate===null&&row.values.tradeRate===null));

 const detail=operations(snapshot,c,new URLSearchParams({view:'agents',liveState:'false',agentActivity:'ordered'}),r);
 assert.deepEqual(detail.items.map(x=>x.id),['off']);
});

test('user overview removes weekly cohort comparison while retaining funnel and seven-day metrics',()=>{
 const overview=operations(d,c,new URLSearchParams({view:'users'}),r);
 assert.equal(overview.charts.some(x=>x.title==='注册批次的 7 日参与比较'),false);
 assert.ok(overview.charts.some(x=>x.type==='funnel'));
 assert.ok(overview.metrics.some(x=>x.key==='configConversion'));
 assert.ok(overview.metrics.some(x=>x.key==='cohortConversion'));
});

test('Agent and order phase links match detail counts with cross-day fills and independent creation dates',()=>{
 const period={kind:'custom',from:'2026-11-01T16:00:00Z',to:'2026-11-07T04:00:00Z'};
 const agents=[{...d.agents[0],createdAt:'2026-11-02T00:00:00Z',liveEnabled:true},{...d.agents[0],id:'b',createdAt:'2026-11-05T00:00:00Z',liveEnabled:false}];
 const orders=[{...d.orders[0],id:'old',state:'FILLED',competition:'EPL',createdAt:'2026-10-30T00:00:00Z'},{...d.orders[0],id:'first',state:'FAILED',competition:'EPL',createdAt:'2026-11-02T00:00:00Z'},{...d.orders[0],id:'second',agentId:'b',state:'FAILED',competition:'EPL',createdAt:'2026-11-05T00:00:00Z'}];
 const executions=['2026-11-02','2026-11-03','2026-11-05'].map((date,i)=>({id:'e'+i,sourceEventKey:'e'+i,orderId:'old',ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',competition:'EPL',executedAt:date+'T01:00:00Z',side:'BUY',actualFilledShares:'1',actualFilledValue:'2',feeAmount:'0',feeType:'COLLATERAL',marketId:'m',tokenId:'t'}));
 const snapshot={...d,asOf:period.to,agents,orders,executions};
 for(const view of ['agents','orders']){
  const result=operations(snapshot,c,new URLSearchParams({view,market:'EPL'}),period),phase=result.charts.find(x=>x.phaseComparison);
  assert.equal(phase.rows.length,2);
  for(const row of phase.rows)for(const key of view==='agents'?['created','ordered','traded']:['orders','filled','failed']){
   const link=row.links[key],input=new URLSearchParams({view:link.view,market:'EPL'});for(const [k,vs] of Object.entries(link.filters))for(const v of vs)input.append(k,v);
   const window={kind:'custom',from:new Date(link.window.from+'T00:00:00+08:00').toISOString(),to:new Date(+new Date(link.window.to+'T00:00:00+08:00')+86400000).toISOString()};
   assert.equal(operations(snapshot,c,input,window).total,row.values[key],view+' '+key+' '+row.name);
  }
  if(view==='orders'){assert.equal(phase.rows[0].values.filled,0);assert.equal(phase.rows[1].values.filled,1);assert.equal(phase.rows[1].values.avgFilled,3/5.5);assert.equal(phase.rows[1].values.volume,6);assert.equal(phase.rows[1].values.failureRate,100);}
  const empty=operations(snapshot,c,new URLSearchParams({view,market:'NBA'}),period).charts.find(x=>x.phaseComparison);assert.ok(empty.rows.every(x=>(view==='agents'?x.values.ordered:x.values.orders)===0));
 }
});

test('model and market comparisons preserve prior cost, settlement-only profit and matching detail scopes',()=>{
 const period={kind:'custom',from:'2026-11-01T16:00:00Z',to:'2026-11-07T04:00:00Z'};
 const order=(id,date)=>({...d.orders[0],id,createdAt:date+'T01:00:00Z',competition:'EPL',canonicalEventId:'event',fixtureName:'A vs B'});
 const orders=[order('before','2026-10-30'),order('first','2026-11-02'),order('second','2026-11-05')];
 const execution=(key,date,kind,side,shares,value)=>({sourceEventKey:key,orderId:'before',agentId:'a',ownerClerkUserId:'u',canonicalEventId:'event',modelId:'same-model',marketId:'m',tokenId:'t',competition:'EPL',fixtureName:'A vs B',executionKind:kind,side,attributionStatus:'ATTRIBUTED',executedAt:date+'T02:00:00Z',actualFilledShares:String(shares),actualFilledValue:String(value),actualExecutionPrice:'1',feeAmount:'0',feeType:'COLLATERAL'});
 const executions=[execution('buy','2026-10-30','TRADE','BUY',10,10),execution('sell','2026-11-02','TRADE','SELL',5,3),execution('settle','2026-11-05','SETTLEMENT','SELL',5,8)];
 const snapshot={...d,asOf:period.to,orders,executions,platformOrders:orders.map(o=>({...o,id:'p-'+o.id})),platformExecutions:executions.map(e=>({...e,sourceEventKey:'p-'+e.sourceEventKey,platformOrderId:'p-before',platformModelAccountId:'p'}))};
 for(const view of ['platform','events','funds','platform-pnl']){
  const input=new URLSearchParams({view,market:'EPL',model:'same-model'}),result=operations(snapshot,c,input,period),phase=result.charts.find(x=>x.phaseComparison);
  assert.deepEqual(phase.rows.map(x=>x.values.realizedPnl),[0,1]);assert.equal(phase.rows[1].values.filled,1);assert.equal(phase.rows[1].values.volume,3);
  assert.deepEqual(phase.rows.map(x=>x.name),['上期','本期']);
  const charts=result.charts.filter(x=>x.type==='linkedTrend');assert.equal(charts.length,1);const money=charts.find(x=>x.unit==='USDT');assert.equal(money.rows.find(x=>x.date==='2026-11-05').realizedPnl,3);if(['platform','events'].includes(view)){assert.deepEqual(money.unitGroups.map(x=>x.unit),['笔','USDT']);assert.deepEqual(money.tooltipSeriesKeys,['orders','filled','volume','realizedPnl']);}else {assert.deepEqual(money.tooltipSeriesKeys,['filled','volume','realizedPnl']);assert.equal(phase.rows[0].values.avgVolume,10/5.5);assert.equal(phase.rows[0].values.avgPnl,0);assert.equal(phase.rows[1].values.avgPnl,1/5.5);assert.equal(phase.rows[0].links.avgPnl.view,view==='funds'?'funds':'platform-pnl-details');assert.equal(phase.rows[0].links.avgVolume.view,view==='funds'?'executions':'platform-orders');}
  for(const row of phase.rows)for(const key of (['funds','platform-pnl'].includes(view)?['filled','volume','realizedPnl']:['orders','filled','volume','realizedPnl'])){
   const link=row.links[key],query=new URLSearchParams({view:link.view,market:'EPL',model:'same-model'});for(const [k,vs] of Object.entries(link.filters))for(const v of vs)query.append(k,v);
   const window={kind:'custom',from:new Date(link.window.from+'T00:00:00+08:00').toISOString(),to:new Date(+new Date(link.window.to+'T00:00:00+08:00')+86400000).toISOString()},detail=operations(snapshot,c,query,window);
   if(['orders','filled'].includes(key))assert.equal(detail.total,row.values[key],view+' '+key);
   if(key==='realizedPnl')assert.equal(detail.items.reduce((n,x)=>n+Number(view.startsWith('platform')?x.realizedPnl:x.value),0),row.values[key],view+' pnl');
  }
  const empty=operations(snapshot,c,new URLSearchParams({view,market:'NBA'}),period).charts.find(x=>x.phaseComparison);assert.ok(empty.rows.every(x=>x.values.orders===0&&x.values.filled===0&&x.values.realizedPnl===0));
 }
 const markets=operations({...snapshot,orders:[],executions:[executions[0],executions[2]]},c,new URLSearchParams({view:'events'}),period).charts.find(x=>x.title==='市场参与、成交与盈亏联查');
 assert.equal(markets.rows[0].name,'EPL');assert.equal(markets.rows[0].values.filled,0);assert.ok(markets.rows[0].links.filled);
});

test('funds and model PnL merge daily panels while retaining cumulative and other panels',()=>{
 for(const view of ['funds','platform-pnl']){
  const result=operations(d,c,new URLSearchParams({view}),r);
  assert.equal(result.metrics.length,0);
  assert.equal(result.charts.some(x=>x.label==='date'&&['volume','realizedPnl'].includes(x.key)&&x.type!=='linkedTrend'),view==='platform-pnl');
  if(view==='platform-pnl'){
   const visible=result.charts.filter(x=>x.type!=='linkedTrend'&&!x.periodComparison&&!x.phaseComparison);
   assert.deepEqual(visible.map(x=>x.title),['每日已实现盈亏分量','本期累计已实现盈亏分量','平台各模型每日现金余额']);
   assert.equal(visible[0].type,'timeBars');assert.equal(visible[0].signed,true);assert.equal(visible[0].filter,'date');
   assert.equal(visible[1].type,'line');assert.equal(visible[1].signed,true);
  }
  const daily=result.charts.filter(x=>x.type==='linkedTrend');assert.equal(daily.length,1);assert.deepEqual(daily[0].seriesKeys,['volume','realizedPnl']);assert.equal(daily[0].mergedFinance,true);assert.ok(daily[0].signedSeries.includes('realizedPnl'));assert.deepEqual(daily[0].drillChoices.map(x=>x.key),['filled','volume','realizedPnl']);
  assert.ok(result.charts.some(x=>x.key==='cumulativePnl'));
  assert.equal(result.charts.find(x=>x.phaseComparison).rows.length,2);
  assert.ok(result.charts.some(x=>view==='funds'?x.type==='pie':x.title==='平台各模型每日现金余额'));
 }
});


test('funds exclude pending streams but retain attributed values and other quality issues',()=>{
 const trade={sourceEventKey:'known',id:'known',ownerClerkUserId:'u',agentId:'a',orderId:'o',modelId:'m',marketId:'m',tokenId:'t',canonicalEventId:'event',executionKind:'TRADE',side:'BUY',attributionStatus:'ATTRIBUTED',actualFilledShares:'1',actualFilledValue:'1',actualExecutionPrice:'1',feeAmount:'0',feeType:'COLLATERAL',executedAt:'2026-11-09T01:00:00Z'};
 const unknown={...trade,sourceEventKey:'old-pending',id:'old-pending',agentId:null,orderId:null,attributionStatus:'UNATTRIBUTED',executedAt:'2026-11-01T01:00:00Z'};
 const only={...unknown,sourceEventKey:'only',id:'only',ownerClerkUserId:'pending-only',executedAt:trade.executedAt};
 const snapshot={...d,users:[...d.users,{clerkUserId:'pending-only'},{clerkUserId:'complete'}],executions:[trade,unknown,{...unknown},{...trade,sourceEventKey:'no-agent',id:'no-agent',agentId:null},only,{...trade,sourceEventKey:'complete',id:'complete',ownerClerkUserId:'complete'},{...unknown,sourceEventKey:'conflict',id:'conflict',attributionStatus:'CONFLICT'},{...unknown,sourceEventKey:'future',id:'future',executedAt:'2026-11-10T01:00:00Z'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'funds'}),r),partial=result.items.find(row=>row.id==='u'),unavailable=result.items.find(row=>row.id==='pending-only');
 assert.equal(partial.status,'PARTIAL');assert.equal(partial.pendingCount,0);assert.notEqual(partial.value,null);
 assert.equal(unavailable,undefined);assert.equal(partial.pendingDestination,null);assert.ok(!partial.issues.includes('待归属成交流水'));assert.ok(!result.columns.some(x=>x.key==='pendingCount'));
 const complete=operations(snapshot,c,new URLSearchParams({view:'funds',coverage:'RECORDED'}),r);assert.deepEqual(complete.items.map(row=>row.id),['complete']);
 const incomplete=operations(snapshot,c,new URLSearchParams({view:'funds',coverage:'PARTIAL'}),r);assert.equal(incomplete.total,1);
 assert.equal(snapshot.executions.length,8);
 const clean=operations({...snapshot,executions:snapshot.executions.filter(e=>e.attributionStatus==='CONFLICT'||(e.attributionStatus==='ATTRIBUTED'&&e.agentId))},c,new URLSearchParams({view:'funds'}),r);assert.deepEqual(result.items,clean.items);assert.deepEqual(result.charts,clean.charts);
 const pendingDetail=operations(snapshot,c,new URLSearchParams({view:'executions',attribution:'PENDING'}),r);assert.ok(pendingDetail.total>0);
 assert.equal(JSON.stringify(result.charts),JSON.stringify(incomplete.charts));
});


test('model PnL completeness uses account ownership and preserves partial values with precise pending drill',()=>{
 const trade={id:'buy',sourceEventKey:'buy',platformModelAccountId:'p',platformOrderId:'po',modelId:'same-model',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',side:'BUY',marketId:'m',tokenId:'t',actualFilledShares:'2',actualFilledValue:'1',actualExecutionPrice:'.5',feeAmount:'0',feeType:'COLLATERAL',executedAt:'2026-11-09T01:00:00Z'};
 const pending={...trade,id:'pending',sourceEventKey:'pending',platformOrderId:null,attributionStatus:'UNATTRIBUTED',executedAt:'2026-11-01T01:00:00Z'};
 const snapshot={...d,platform:[...d.platform,{id:'p2',modelId:'only-pending'},{id:'p3',modelId:'clean'}],platformExecutions:[trade,pending,{...pending},{...pending,id:'conflict',sourceEventKey:'conflict',attributionStatus:'CONFLICT'},{...pending,id:'future',sourceEventKey:'future',executedAt:'2026-11-10T01:00:00Z'},{...pending,id:'other',sourceEventKey:'other',platformModelAccountId:'p2',modelId:'only-pending',executedAt:trade.executedAt}],executions:[{...pending,ownerClerkUserId:'u'}]};
 const all=operations(snapshot,c,new URLSearchParams({view:'platform-pnl-details'}),r),row=all.items.find(row=>row.modelId==='same-model');
 assert.equal(row.pendingCount,1);assert.equal(row.status,'PARTIAL');assert.notEqual(row.realizedPnl,null);assert.ok(row.issues.includes('归属冲突'));
 assert.equal(all.items.find(row=>row.modelId==='only-pending').realizedPnl,null);
 assert.equal(operations(snapshot,c,new URLSearchParams({view:'platform-pnl-details',coverage:'PARTIAL'}),r).total,2);
 assert.deepEqual(operations(snapshot,c,new URLSearchParams({view:'platform-pnl-details',coverage:'RECORDED'}),r).items.map(row=>row.modelId),['clean']);
 const target=row.pendingDestination,params=new URLSearchParams({view:target.view});for(const [key,values] of Object.entries(target.filters))for(const value of values)params.append(key,value);
 const detail=operations(snapshot,c,params,{from:target.window.from+'T00:00:00+08:00',to:'2026-11-10T00:00:00+08:00'});
 assert.equal(detail.total,row.pendingCount);assert.deepEqual(detail.items.map(row=>row.sourceEventKey),['pending']);assert.equal(detail.items[0].platformModelAccountId,'p');assert.equal(detail.charts.length,0);
});

test('finance date quality marks pending history, deduplicates and drills to exact scoped streams',()=>{
 for(const view of ['funds','platform-pnl']){
  const base={id:'old',sourceEventKey:'old',ownerClerkUserId:'u',agentId:null,platformModelAccountId:'p',platformOrderId:null,modelId:'same-model',executionKind:'TRADE',attributionStatus:'UNATTRIBUTED',side:'BUY',marketId:'m',tokenId:'t',actualFilledShares:'2',actualFilledValue:'1',actualExecutionPrice:'.5',feeAmount:'0',feeType:'COLLATERAL',executedAt:'2026-11-07T01:00:00Z'};
  const events=[base,{...base},{...base,id:'today',sourceEventKey:'today',executedAt:'2026-11-09T01:00:00Z'},{...base,id:'future',sourceEventKey:'future',executedAt:'2026-11-10T01:00:00Z'},{...base,id:'conflict',sourceEventKey:'conflict',attributionStatus:'CONFLICT',executedAt:'2026-11-08T01:00:00Z'}];
  const snapshot={...d,executions:view==='funds'?events:[],platformExecutions:view==='platform-pnl'?events:[]};
  const result=operations(snapshot,c,new URLSearchParams({view}),{kind:'custom',from:'2026-11-06T00:00:00+08:00',to:'2026-11-10T00:00:00+08:00'});
  const chart=result.charts.find(x=>x.key==='cumulativePnl');
  assert.equal(chart.rows[0].dataQuality.incomplete,false);
  const quality=chart.rows.find(x=>x.date==='2026-11-09').dataQuality;
  assert.deepEqual(result.charts.find(x=>x.type==='linkedTrend').rows.find(x=>x.date==='2026-11-09').dataQuality,quality);
  if(view==='funds'){assert.equal(quality.pendingCount,0);assert.equal(quality.destination,null);assert.ok(quality.issues.includes('归属冲突'));continue;}
  assert.equal(quality.pendingCount,2);assert.equal(quality.dailyPendingCount,1);assert.equal(quality.historicalPendingCount,1);assert.ok(quality.issues.includes('归属冲突'));
  const target=quality.destination,params=new URLSearchParams({view:target.view});for(const [key,values] of Object.entries(target.filters))for(const value of values)params.append(key,value);
  const detail=operations(snapshot,c,params,{from:target.window.from+'T00:00:00+08:00',to:'2026-11-10T00:00:00+08:00'});
  assert.equal(detail.total,quality.pendingCount);assert.deepEqual(new Set(detail.items.map(x=>x.sourceEventKey)),new Set(['old','today']));
  const oneDay=operations(snapshot,c,params,{from:'2026-11-09T00:00:00+08:00',to:'2026-11-10T00:00:00+08:00'});
  assert.deepEqual(oneDay.items.map(x=>x.sourceEventKey),['today']);
  assert.ok(result.charts.filter(x=>x.title==='平台各模型每日现金余额').every(x=>x.rows.every(row=>!row.dataQuality)));
 }
});

test('finance phase quality counts distinct streams per segment with historical PnL carryover',()=>{
 for(const view of ['funds','platform-pnl']){
  const event={ownerClerkUserId:'u',agentId:null,platformModelAccountId:'p',modelId:'same-model',executionKind:'TRADE',attributionStatus:'UNATTRIBUTED',side:'BUY',actualFilledShares:'2',actualFilledValue:'1',actualExecutionPrice:'.5',feeAmount:'0',feeType:'COLLATERAL',marketId:'m',tokenId:'t'};
  const history=[{...event,sourceEventKey:'history',executedAt:'2026-11-01T01:00:00Z'},{...event,sourceEventKey:'later',executedAt:'2026-11-07T01:00:00Z'},{...event,sourceEventKey:'later',executedAt:'2026-11-07T01:00:00Z'}];
  const snapshot={...d,executions:view==='funds'?history:[],platformExecutions:view==='platform-pnl'?history:[]};
  const result=operations(snapshot,c,new URLSearchParams({view}),{kind:'custom',from:'2026-11-05T00:00:00+08:00',to:'2026-11-10T00:00:00+08:00'});
  const phase=result.charts.find(chart=>chart.phaseComparison),[first,last]=phase.rows;
  if(view==='funds'){for(const row of phase.rows){assert.equal(row.dataQuality.pendingCount,0);assert.equal(row.dataQuality.incomplete,false);assert.equal(row.dataQuality.destination,null);}continue;}
  assert.equal(first.qualityByKey.volume.incomplete,true);assert.equal(first.qualityByKey.realizedPnl.incomplete,true);
  assert.equal(first.dataQuality.pendingCount,1);assert.equal(first.dataQuality.periodPendingCount,1);assert.equal(first.dataQuality.historicalPendingCount,0);
  assert.equal(last.dataQuality.pendingCount,2);assert.equal(last.dataQuality.periodPendingCount,1);assert.equal(last.dataQuality.historicalPendingCount,1);
  assert.equal(last.qualityByKey.volume.pendingCount,1);assert.deepEqual(last.qualityByKey.avgPnl,last.qualityByKey.realizedPnl);
  for(const row of phase.rows){const target=row.dataQuality.destination,params=new URLSearchParams({view:target.view});for(const [key,values] of Object.entries(target.filters))for(const value of values)params.append(key,value);
   const detail=operations(snapshot,c,params,{from:target.window.from+'T00:00:00+08:00',to:new Date(+new Date(target.window.to+'T00:00:00+08:00')+86400000).toISOString()});assert.equal(detail.total,row.dataQuality.pendingCount);
   assert.ok(row.links.volume);assert.ok(row.links.realizedPnl);
  }
 }
});

test('business PnL quality maps model accounts and keeps unknown markets separate',()=>{
 const event={sourceEventKey:'epl',ownerClerkUserId:'u',agentId:null,platformModelAccountId:'p',modelId:'wrong-model',executionKind:'TRADE',attributionStatus:'UNATTRIBUTED',side:'BUY',actualFilledShares:'2',actualFilledValue:'1',actualExecutionPrice:'.5',feeAmount:'0',feeType:'COLLATERAL',marketId:'m',tokenId:'t',competition:'EPL',executedAt:'2026-11-01T01:00:00Z'};
 const unknown={...event,sourceEventKey:'unknown',competition:null};
 const snapshot={...d,executions:[event,{...event},unknown,{...event,sourceEventKey:'nba',competition:'NBA'},{...event,sourceEventKey:'future',executedAt:'2026-11-10T01:00:00Z'}],platformExecutions:[event,{...event}]};
 const platformResult=operations(snapshot,c,new URLSearchParams({view:'platform'}),r);
 const daily=platformResult.charts.find(x=>x.type==='linkedTrend');assert.equal(daily.rows[0].dataQuality.pendingCount,1);assert.deepEqual(daily.unitGroups.map(x=>x.unit),['笔','USDT']);
 const model=platformResult.charts.find(x=>x.businessComparison);
 assert.equal(model.rows[0].dataQuality.pendingCount,1);assert.equal(model.rows[0].dataQuality.destination.filters.model[0],'same-model');
 const markets=operations(snapshot,c,new URLSearchParams({view:'events'}),r).charts.find(x=>x.businessComparison);
 assert.equal(markets.rows.find(x=>x.name==='EPL').dataQuality.pendingCount,1);assert.equal(markets.rows.find(x=>x.name==='NBA').dataQuality.pendingCount,1);assert.equal(markets.unassignedQuality.pendingCount,1);
 for(const q of [model.rows[0].dataQuality,markets.rows.find(x=>x.name==='EPL').dataQuality,markets.unassignedQuality]){
  const target=q.destination,p=new URLSearchParams({view:target.view});for(const [key,values] of Object.entries(target.filters))for(const value of values)p.append(key,value);
  const detail=operations(snapshot,c,p,{from:target.window.from+'T00:00:00+08:00',to:r.to});assert.equal(detail.total,q.pendingCount);
  assert.deepEqual(detail.items.map(x=>x.sourceEventKey),[target.filters.market?.[0]==='未记录'?'unknown':'epl']);
 }
});

test('event completeness never guesses event or model and pending-only events remain unknown PnL',()=>{
 const event={sourceEventKey:'known',ownerClerkUserId:'u',agentId:null,modelId:'same-model',canonicalEventId:'game-a',fixtureName:'Same teams',executionKind:'TRADE',attributionStatus:'UNATTRIBUTED',side:'BUY',actualFilledShares:'2',actualFilledValue:'1',actualExecutionPrice:'.5',feeAmount:'0',feeType:'COLLATERAL',marketId:'m',tokenId:'t',competition:'EPL',executedAt:'2026-11-01T01:00:00Z'};
 const snapshot={...d,executions:[event,{...event},{...event,sourceEventKey:'unknown-event',canonicalEventId:null},{...event,sourceEventKey:'unknown-model',modelId:null},{...event,sourceEventKey:'other',canonicalEventId:'game-b'},{...event,sourceEventKey:'conflict',attributionStatus:'CONFLICT'},{...event,sourceEventKey:'future',executedAt:'2026-11-10T01:00:00Z'}]};
 const result=operations(snapshot,c,new URLSearchParams({view:'events'}),r),row=result.items.find(x=>x.eventId==='game-a');
 assert.equal(row.realizedPnl,null);assert.equal(row.dataQuality.pendingCount,2);assert.equal(row.unassignedModelPendingCount,1);assert.equal(row.models.length,1);assert.equal(row.models[0].dataQuality.pendingCount,1);assert.equal(result.unassignedEventQuality.pendingCount,1);
 assert.equal(result.charts.find(x=>x.title==='比赛盈亏排名').rows.find(x=>x.eventId==='game-a').dataQuality.pendingCount,2);
 for(const q of [row.dataQuality,row.models[0].dataQuality,result.unassignedEventQuality]){
  const t=q.destination,p=new URLSearchParams({view:t.view});for(const [key,values] of Object.entries(t.filters))for(const value of values)p.append(key,value);
  const detail=operations(snapshot,c,p,{from:t.window.from+'T00:00:00+08:00',to:r.to});assert.equal(detail.total,q.pendingCount);
  if(t.filters.event[0]==='未记录')assert.deepEqual(detail.items.map(x=>x.sourceEventKey),['unknown-event']);
 }
});


test('merged order trend separates units and retains aligned previous volumes and zero dates',()=>{
 const e={ownerClerkUserId:'u',agentId:'a',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',actualFilledValue:'2.35',orderId:'old',executedAt:'2026-11-09T01:00:00Z'};
 const result=operations({...d,executions:[e]},c,new URLSearchParams({view:'orders'}),r),trend=result.charts.find(x=>x.type==='linkedTrend');
 assert.equal(result.charts.some(x=>x.type==='orderTrend'),false);
 assert.deepEqual(trend.unitGroups.map(x=>x.unit),['笔','USDT']);
 assert.equal(trend.rows[0].volume,'2.35');assert.equal(trend.rows[0].filled,1);
 assert.equal(trend.tooltipUnits.volume,'USDT');assert.equal(trend.tooltipUnits.orders,'笔');
 assert.ok(trend.unitGroups[0].seriesKeys.includes('previousOrders'));assert.ok(trend.unitGroups[1].seriesKeys.includes('previousVolume'));
 assert.equal(trend.rows[0].previousVolume,'0');assert.equal(trend.rows[0].previousFailed,0);
});

test('user merged trend compares daily distinct ordering and trading users in the same filtered scope',()=>{
 const period={kind:'custom',from:'2026-11-06T16:00:00Z',to:'2026-11-08T16:00:00Z'};
 const order=(id,owner,at,market='EPL')=>({...d.orders[0],id,ownerClerkUserId:owner,createdAt:at,competition:market});
 const trade=(id,owner,at,extra={})=>({sourceEventKey:id,orderId:id,ownerClerkUserId:owner,agentId:'a',competition:'EPL',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:at,actualFilledValue:'1',side:'BUY',...extra});
 const snapshot={...d,users:[...d.users,{clerkUserId:'v'}],orders:[order('p1','u','2026-11-05T01:00:00Z'),order('p2','u','2026-11-05T02:00:00Z'),order('p3','v','2026-11-05T03:00:00Z'),order('other','v','2026-11-06T01:00:00Z','NBA'),order('c1','u','2026-11-07T01:00:00Z')],executions:[trade('t1','u','2026-11-05T01:00:00Z'),trade('t2','u','2026-11-05T02:00:00Z'),trade('pending','v','2026-11-05T03:00:00Z',{attributionStatus:'UNATTRIBUTED'}),trade('settle','v','2026-11-05T04:00:00Z',{executionKind:'SETTLEMENT'}),trade('end','v',period.from),trade('current','u','2026-11-07T01:00:00Z')]};
 const get=params=>operations(snapshot,c,new URLSearchParams({view:'users',market:'EPL',...params}),period).charts.find(x=>x.type==='linkedTrend');
 const chart=get({});
 assert.deepEqual(chart.rows.map(x=>[x.previousOrderedUsers,x.previousTradedUsers]),[[2,1],[0,0]]);
 assert.deepEqual(chart.rows.map(x=>[x.orderedUsers,x.tradedUsers]),[[1,2],[0,0]]);
 assert.deepEqual(get({owner:'u'}).rows.map(x=>[x.previousOrderedUsers,x.previousTradedUsers]),[[1,1],[0,0]]);
 for(const key of ['previousRegistered','previousOrderedUsers','previousTradedUsers']){assert.ok(chart.seriesKeys.includes(key));assert.equal(chart.seriesDash[key],'5 5');assert.ok(chart.seriesColors[key]);}
 assert.deepEqual(chart.drillChoices.map(x=>x.key),['registered','orderedUsers','tradedUsers']);
});

test('Agent merged trend aligns prior creation and distinct trade counts with catalog and market filters',()=>{
 const period={kind:'custom',from:'2026-11-06T16:00:00Z',to:'2026-11-08T16:00:00Z'};
 const agents=[{...d.agents[0],createdAt:'2026-11-05T01:00:00Z',liveEnabled:true},{...d.agents[0],id:'b',createdAt:'2026-11-06T01:00:00Z',liveEnabled:false}];
 const trade=(id,agentId,at,extra={})=>({sourceEventKey:id,orderId:'old',ownerClerkUserId:'u',agentId,competition:'EPL',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',executedAt:at,actualFilledValue:'1',side:'BUY',...extra});
 const snapshot={...d,agents,orders:[{...d.orders[0],id:'old',competition:'EPL',createdAt:'2026-11-01T01:00:00Z'}],executions:[trade('a1','a','2026-11-05T01:00:00Z'),trade('a2','a','2026-11-05T02:00:00Z'),trade('b','b','2026-11-05T03:00:00Z'),trade('deleted','deleted','2026-11-05T04:00:00Z'),trade('pending','b','2026-11-06T01:00:00Z',{attributionStatus:'UNATTRIBUTED'}),trade('settled','b','2026-11-06T02:00:00Z',{executionKind:'SETTLEMENT'}),trade('other-market','b','2026-11-06T03:00:00Z',{competition:'NBA'}),trade('boundary','a',period.from)]};
 const get=(params={},window=period)=>operations(snapshot,c,new URLSearchParams({view:'agents',market:'EPL',...params}),window).charts.find(x=>x.type==='linkedTrend');
 const chart=get();
 assert.deepEqual(chart.rows.map(x=>[x.previousCreatedAgents,x.previousOrderedAgents,x.previousTradedAgents]),[[1,0,2],[1,0,0]]);
 assert.deepEqual(get({liveState:'true'}).rows.map(x=>[x.previousCreatedAgents,x.previousTradedAgents]),[[1,1],[0,0]]);
 assert.deepEqual(get({agent:'b'}).rows.map(x=>[x.previousCreatedAgents,x.previousTradedAgents]),[[0,1],[1,0]]);
 for(const key of ['previousCreatedAgents','previousOrderedAgents','previousTradedAgents']){assert.ok(chart.seriesKeys.includes(key));assert.ok(chart.tooltipSeriesKeys.includes(key));assert.equal(chart.seriesDash[key],'5 5');assert.ok(chart.seriesColors[key]);}
 assert.deepEqual(chart.drillChoices.map(x=>x.key),['createdAgents','orderedAgents','tradedAgents']);
 assert.ok(!get({}, {...period,kind:'all'}).seriesKeys.some(key=>key.startsWith('previous')));
 // The elapsed-period offset also applies to a partial current day.
 const partial={kind:'custom',from:period.from,to:'2026-11-07T04:00:00Z'};
 assert.deepEqual(get({},partial).rows.map(x=>[x.previousCreatedAgents,x.previousTradedAgents]),[[0,0]]);
});

test('user overview restores phase comparison beside cohorts and keeps funnel below',()=>{
 const result=operations(d,c,new URLSearchParams({view:'users'}),{...r,kind:'custom',from:'2026-11-01T16:00:00Z'});
 assert.equal(result.charts.some(c=>c.periodComparison),true);
 const phase=result.charts[1];assert.equal(phase.title,'本期与上期参与对比');assert.equal(phase.userComparison,true);assert.equal(phase.collapsedComparison,undefined);
 assert.deepEqual(phase.rows.map(r=>r.name),['上期','本期']);
 assert.deepEqual(phase.columns.map(c=>c.key),['registered','avgRegistered','ordered','avgOrdered','traded','avgTraded']);
 assert.equal(result.charts[2].userParticipation,true);
 assert.deepEqual(result.charts.slice(-2).map(c=>c.title),['新用户转化漏斗','用户阶段分布']);
});

test('all period comparisons use adjacent equal-duration windows and exact detail filters',()=>{
 const range={kind:'custom',from:'2026-11-08T16:00:00Z',to:'2026-11-09T10:00:00Z'};
 const old={...d.orders[0],id:'prior',createdAt:'2026-11-08T02:00:00Z'};
 const outside={...old,id:'outside',createdAt:'2026-11-07T20:00:00Z'};
 const snapshot={...d,orders:[...d.orders,old,outside],platformOrders:[...d.platformOrders,{...old,id:'pp'},{...outside,id:'px'}]};
 for(const view of ['users','agents','orders','platform','events','funds','platform-pnl']){
  const result=operations(snapshot,c,new URLSearchParams({view}),range),panel=result.charts.find(c=>c.periodComparison);
  assert.deepEqual(panel.rows.map(r=>r.name),['上期','本期'],view);
  for(const [i,row] of panel.rows.entries()){
   const expected=i?range:previousRange(range,snapshot.asOf);
   for(const link of Object.values(row.links)){
    assert.equal(+new Date(link.filters.comparisonFrom[0]),+new Date(expected.from),view);assert.equal(+new Date(link.filters.comparisonTo[0]),+new Date(expected.to),view);
   }
   const key=view==='users'?'ordered':view==='agents'?'ordered':view==='funds'||view==='platform-pnl'?'filled':'orders';
   const link=row.links[key],params=new URLSearchParams({view:link.view});for(const [k,vs] of Object.entries(link.filters))for(const v of vs)params.append(k,v);
   const detail=operations(snapshot,c,params,{kind:'custom',from:link.window.from+'T00:00:00+08:00',to:new Date(+new Date(link.window.to+'T00:00:00+08:00')+86400000).toISOString()});
   assert.equal(detail.total,row.values[key],view+' '+row.name);
  }
  assert.equal(operations(snapshot,c,new URLSearchParams({view}),{...range,kind:'all'}).charts.find(c=>c.periodComparison).rows.length,0);
 }
});


test('Agent page includes user segmentation at the bottom with identical scoped user counts',()=>{
 const snapshot={...d,users:[...d.users,{clerkUserId:'zero'}]};
 for(const filters of [{},{agentBand:'0 个 Agent'},{stage:'未配置'}]){
  const merged=operations(snapshot,c,new URLSearchParams({view:'agents',...filters}),r);
  const original=operations(snapshot,c,new URLSearchParams({view:'user-list',...filters}),r);
  const segments=merged.charts.filter(x=>x.userSegmentation);
  assert.equal(segments.length,2);
  assert.deepEqual(merged.charts.slice(-2),segments);
  for(const chart of segments){assert.deepEqual(chart.rows,original.charts.find(x=>x.filter===chart.filter).rows);assert.equal(merged.charts.filter(x=>x.filter===chart.filter).length,1);}
  assert.ok(merged.charts.some(x=>x.type==='linkedTrend'));
  assert.ok(merged.charts.some(x=>x.agentParticipation));
 }
});


test('market overview excludes unresolved history without changing event analysis or known totals',()=>{
 const known={sourceEventKey:'buy',ownerClerkUserId:'u',agentId:'a',orderId:'o',modelId:'same-model',canonicalEventId:'game-a',fixtureName:'A vs B',executionKind:'TRADE',attributionStatus:'ATTRIBUTED',side:'BUY',actualFilledShares:'2',actualFilledValue:'1',actualExecutionPrice:'.5',feeAmount:'0',feeType:'COLLATERAL',marketId:'m',tokenId:'t',competition:'EPL',executedAt:'2026-11-09T01:00:00Z'};
 const pending={...known,sourceEventKey:'pending',agentId:null,attributionStatus:'UNATTRIBUTED',executedAt:'2026-11-01T01:00:00Z'};
 const snapshot={...d,executions:[known,pending,{...pending,sourceEventKey:'no-event',canonicalEventId:null,competition:null},{...known,sourceEventKey:'missing-agent',agentId:null}]};
 const params=new URLSearchParams({view:'events',excludeUnattributed:'1'});
 const result=operations(snapshot,c,params,r),clean=operations({...snapshot,executions:[known]},c,params,r);
 assert.deepEqual(result.charts,clean.charts);assert.deepEqual(result.metrics,clean.metrics);assert.deepEqual(result.items,clean.items);assert.equal(result.unassignedEventQuality,null);
 const analysis=operations(snapshot,c,new URLSearchParams({view:'events'}),r);assert.equal(analysis.unassignedEventQuality.pendingCount,1);assert.ok(analysis.items.find(x=>x.eventId==='game-a').dataQuality.pendingCount>0);
 assert.equal(snapshot.executions.length,4);
});


test('market ranking retains fixed event coordinates with zero for inactive dates',()=>{
 const orders=[{...d.orders[0],id:'a-order',canonicalEventId:'a-event',fixtureName:'A vs B',competition:'EPL',createdAt:'2026-10-01T01:00:00Z'},{...d.orders[0],id:'z-order',canonicalEventId:'z-event',fixtureName:'Z vs Y',competition:'NBA'}];
 const snapshot={...d,orders};
 const get=period=>operations(snapshot,c,new URLSearchParams({view:'events',excludeUnattributed:'1'}),period).charts.find(x=>x.title==='比赛盈亏排名');
 const first=get(r),second=get({...r,from:'2026-11-01T00:00:00Z',to:'2026-11-03T00:00:00Z'});
 assert.deepEqual(first.rows.map(x=>x.eventId),['a-event','z-event']);assert.deepEqual(first.rows.map(x=>x.eventId),second.rows.map(x=>x.eventId));assert.ok(first.rows.every(x=>x.realizedPnl==='0'));assert.equal(first.showValues,true);
 const filtered=operations(snapshot,c,new URLSearchParams({view:'events',excludeUnattributed:'1',market:'EPL'}),r).charts.find(x=>x.title==='比赛盈亏排名');assert.deepEqual(filtered.rows.map(x=>x.eventId),['a-event']);
});
