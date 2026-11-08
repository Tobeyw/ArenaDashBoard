import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyPerformance} from '../api/metrics.mjs';

test('strategy performance separates order and execution dates, markets and attribution',()=>{
 const r={from:'2026-11-01T00:00:00Z',to:'2026-11-08T00:00:00Z'};
 const orders=[{positionMethod:'FIXED',createdAt:'2026-11-02T00:00:00Z',competition:'EPL',state:'FILLED',requestedStake:'0.1'},{positionMethod:'FIXED',createdAt:'2026-11-03T00:00:00Z',competition:'EPL',state:'FAILED',requestedStake:'0.2'},{positionMethod:null,createdAt:'2026-11-04T00:00:00Z',competition:'EPL',state:'PENDING',requestedStake:'2'},{positionMethod:'FIXED',createdAt:'2026-10-30T00:00:00Z',competition:'EPL',state:'FILLED',requestedStake:'10'},{positionMethod:'VOL_TARGET',createdAt:'2026-11-02T00:00:00Z',competition:'NBA',state:'FILLED',requestedStake:'5'}];
 const base={executedAt:'2026-11-05T00:00:00Z',competition:'EPL',executionKind:'TRADE',side:'BUY',attributionStatus:'ATTRIBUTED',agentId:'a'};
 const executions=[{...base,positionMethod:'FIXED',actualFilledValue:'0.1'},{...base,positionMethod:'FIXED',actualFilledValue:'0.2'},{...base,positionMethod:'FRACTIONAL_KELLY',actualFilledValue:'4'},{...base,positionMethod:'FIXED',actualFilledValue:'50',side:'SELL'},{...base,positionMethod:'FIXED',actualFilledValue:'50',attributionStatus:'CONFLICT'},{...base,positionMethod:'FIXED',actualFilledValue:'50',agentId:null},{...base,positionMethod:'FIXED',actualFilledValue:'50',executedAt:r.to}];
 const rows=strategyPerformance(orders,executions,r,'EPL');
 assert.deepEqual(rows.find(x=>x.positionMethod==='FIXED'),{positionMethod:'FIXED',orderAttempts:2,filledOrders:1,failedOrders:1,otherOrders:0,requestedStake:'0.3',buyValue:'0.3'});
 assert.equal(rows.find(x=>x.positionMethod==='FRACTIONAL_KELLY').buyValue,'4');
 assert.equal(rows.find(x=>x.positionMethod===null).otherOrders,1);
 assert.equal(rows.some(x=>x.positionMethod==='VOL_TARGET'),false);
 assert.equal(strategyPerformance(orders,executions,r).find(x=>x.positionMethod==='VOL_TARGET').filledOrders,1);
});
