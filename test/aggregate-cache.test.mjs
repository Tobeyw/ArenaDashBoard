import test from 'node:test';
import assert from 'node:assert/strict';
import {createAggregateCache} from '../api/aggregate-cache.mjs';

test('aggregate cache respects snapshot, identity, range, market and expiry',()=>{
 let time=0,calls=0;const cache=createAggregateCache({ttlMs:10000,now:()=>time}),data={},identity={status:'AVAILABLE',asOf:'a'},range={kind:'today',from:'start',to:'end'};
 const get=(d=data,i=identity,r=range,m='')=>cache.get(d,i,r,m,()=>++calls);
 assert.equal(get(),1);assert.equal(get(),1);assert.equal(get(data,identity,{...range,to:'later'}),1);
 assert.equal(get(data,identity,range,'EPL'),2);assert.equal(get(data,{...identity,asOf:'b'}),3);
 assert.equal(get(data,identity,{...range,from:'next'}),4);
 time=10000;assert.equal(get(),5);assert.equal(get({}),6);
 const custom={kind:'custom',from:'start',to:'end'};assert.equal(get(data,identity,custom),7);assert.equal(get(data,identity,{...custom,to:'later'}),8);
});
