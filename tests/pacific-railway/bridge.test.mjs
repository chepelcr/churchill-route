import test from 'node:test';
import assert from 'node:assert/strict';
import {railwayResult} from '../../src/game/railway.js';
test('el puente acepta solo resultados de partida con métricas válidas',()=>{
  assert.deepEqual(railwayResult({elapsed:23.2,stars:3,topSpeed:460}),{elapsed:23.2,stars:3,topSpeed:460});
  for(const result of [null,{}, {elapsed:0,stars:3,topSpeed:400},{elapsed:20,stars:4,topSpeed:400},{elapsed:20,stars:3,topSpeed:Infinity},{elapsed:20,stars:2.5,topSpeed:400}])assert.equal(railwayResult(result),null);
});
