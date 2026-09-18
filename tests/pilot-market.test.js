import test from 'node:test';
import assert from 'node:assert/strict';
import {parseObservation,verifyMarket} from '../src/pilot/market.js';
const raw=JSON.stringify({error:[],result:{XBTUSD:[[60,'1','1','1','100','100','2',3],[120,'1','1','1','110','110','2',3]],last:60}});
test('market evidence uses required closed candle and refuses current candle, missing, stale, bad data',()=>{
  assert.equal(parseObservation(raw,'BTC',120,125).price,'100');
  assert.throws(()=>parseObservation(raw,'BTC',180,185),/missing/);
  assert.throws(()=>parseObservation(raw,'BTC',120,400),/stale/);
  assert.throws(()=>parseObservation(raw,'BTC',120,100),/future/);
  assert.throws(()=>parseObservation('{"error":["rate limit"]}','BTC',120,125),/source/);
  assert.throws(()=>verifyMarket({source:'USER_ASSERTED',observations:[]}),/Unsupported/);
});
