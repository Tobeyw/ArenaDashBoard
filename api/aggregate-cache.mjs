// Statistics use the same PG snapshot for up to a minute; reuse recent calculations
// while keeping date-range boundaries and Clerk snapshot changes independent.
export function createAggregateCache({ttlMs=10000,now=Date.now,maxEntries=20}={}){
 let snapshot=null;const entries=new Map();
 return {get(data,identity,range,market,compute){
  if(snapshot!==data){entries.clear();snapshot=data;}
  const key=JSON.stringify([identity.status,identity.asOf,identity.reason,range.kind,range.from,range.kind==='custom'?range.to:null,market]);
  const entry=entries.get(key),time=now();
  if(entry&&time-entry.time<ttlMs)return entry.value;
  const value=compute();entries.delete(key);entries.set(key,{time:now(),value});
  while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
  return value;
 }};
}
