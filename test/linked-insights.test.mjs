import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedInsights,sevenDayMembers} from '../api/linked-insights.mjs';
const range={from:'2026-11-01T16:00:00Z',to:'2026-11-07T04:00:00Z'};
const days=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07'];
const users=[{id:'new',registeredAt:'2026-11-02T00:00:00Z'},{id:'old',registeredAt:'2026-10-01T00:00:00Z'},{id:'missing'}];
const order=(id,user,date)=>({id,ownerClerkUserId:user,createdAt:date+'T01:00:00Z'});
const trade=(orderId,user,date)=>({orderId,ownerClerkUserId:user,executedAt:date+'T02:00:00Z'});
const base={view:'users',users,days,range,known:true,eligible:[],orders:[order('a','new','2026-11-02'),order('b','new','2026-11-03'),order('c','old','2026-11-06')],trades:[trade('a','new','2026-11-03'),trade('a','new','2026-11-03')]};
test('comparison windows exclude unfinished and middle days, deduplicate within each half',()=>{
 const panels=linkedInsights(base),p=panels.find(x=>x.title==='周期前后段参与对比');
 assert.deepEqual(p.rows.map(x=>x.values),[{registered:1,ordered:1,traded:1,avgRegistered:0.5,avgOrdered:1,avgTraded:0.5},{registered:0,ordered:1,traded:0,avgRegistered:0,avgOrdered:0.5,avgTraded:0}]);
 assert.deepEqual(p.rows.map(x=>x.links.ordered.window),[{from:'2026-11-02',to:'2026-11-03'},{from:'2026-11-05',to:'2026-11-06'}]);
 assert.match(p.note,/中间 1 天/);
});
test('related daily series separate registration from activity and omit unavailable Live history',()=>{
 const p=linkedInsights(base)[0];assert.equal(p.rows[0].registered,1);assert.equal(p.rows[1].tradedUsers,1);
 assert.equal(p.rows[2].orderedUsers,0);assert.ok(p.rows.every(x=>!('liveUsers' in x)));assert.deepEqual(p.seriesKeys,['registered','orderedUsers','tradedUsers']);
 assert.ok(linkedInsights({...base,known:false})[0].rows.every(x=>x.registered===null));
});
test('registration groups use distinct users and member denominators',()=>{
 const p=linkedInsights(base).find(x=>x.title==='新老用户交易参与对比');
 assert.deepEqual(p.rows.map(x=>x.values),[{users:1,ordered:1,traded:1,orderRate:100,tradeRate:100},{users:1,ordered:1,traded:0,orderRate:100,tradeRate:0}]);
 const empty=linkedInsights({...base,users:[],orders:[],trades:[]}).find(x=>x.title===p.title);assert.equal(empty.rows[0].values.tradeRate,null);
});
test('order series compares creation date and execution date without claiming conversion',()=>{
 const p=linkedInsights({...base,view:'orders',orders:[{...base.orders[0],state:'FAILED'},base.orders[1]]})[0];
 assert.equal(p.rows[0].orders,1);assert.equal(p.rows[0].failed,1);assert.equal(p.rows[0].filled,0);assert.equal(p.rows[1].filled,1);
});

test('weekly cohorts use seven full days, exclude late actions, and retain immature members separately',()=>{
 const range={from:'2026-10-31T16:00:00Z',to:'2026-11-15T00:00:00Z'};
 const users=[{id:'m',registeredAt:'2026-11-01T00:00:00Z'},{id:'n',registeredAt:'2026-11-14T00:00:00Z'}];
 const args={...base,range,users,bindings:[{clerkUserId:'m',verifiedAt:'2026-11-02T00:00:00Z'}],agents:[{clerkUserId:'m',createdAt:'2026-11-03T00:00:00Z'}],historyOrders:[order('a','m','2026-11-02'),order('b','m','2026-11-03')],eligible:[{ownerClerkUserId:'m',agentId:'a',attributionStatus:'ATTRIBUTED',executionKind:'TRADE',executedAt:'2026-11-08T00:00:00Z'}]};
 const members=sevenDayMembers(users,{range,bindings:args.bindings,agents:args.agents,orders:args.historyOrders,trades:args.eligible});
 assert.deepEqual(Object.fromEntries(Object.entries(members).map(([key,rows])=>[key,rows.length])),{sample:1,observing:1,bound:1,configured:1,ordered:1,traded:0});
 assert.equal(linkedInsights(args).some(p=>p.title==='注册批次的 7 日参与比较'),false);
});
test('phase averages divide daily distinct activity, exclude partial days, and handle zero baselines',()=>{
 const p=linkedInsights({...base,range:{...range,from:'2026-11-02T04:00:00Z'}}).find(p=>p.title==='周期前后段参与对比');
 assert.equal(p.rows[0].description,'2026-11-03 — 2026-11-04');
 assert.equal(p.rows[0].values.avgOrdered,0.5);
 const empty=linkedInsights({...base,orders:[],trades:[]}).find(p=>p.title==='周期前后段参与对比');
 assert.ok(empty.highlights.some(x=>x.includes('持平')));assert.ok(empty.highlights.every(x=>!x.includes('NaN')&&!x.includes('Infinity')));
});
