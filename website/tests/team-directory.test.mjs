import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryLocations, searchDirectory } from '../lib/team-directory.mjs';
const teams=[
  {id:1,number:'2011A',name:'Alpha',organization:'Robotics Club',country:'USA',region:'Ohio',grade:'High School',registered:true},
  {id:2,number:'2011B',name:'Beta',organization:'Robotics Club',country:'United States',region:'Ohio',grade:'Middle School',registered:false},
  {id:3,number:'2011C',name:'Gamma',organization:'Robotics Club',country:'Canada',region:'Ontario',grade:'High School',registered:false},
  {id:4,number:'42A',name:'Historical',organization:'Old Club',country:'Iceland',region:'Capital',grade:'Middle School',registered:false},
];
test('numeric family search includes every suffix, including unregistered teams',()=>{
  assert.deepEqual(searchDirectory(teams,'2011').map(t=>t.number),['2011A','2011B','2011C']);
  assert.deepEqual(searchDirectory(teams,' 2011b ').map(t=>t.number),['2011B']);
});
test('names and organizations support partial case-insensitive search',()=>{
  assert.equal(searchDirectory(teams,'roBOtics club').length,3);
  assert.equal(searchDirectory(teams,'gam')[0].number,'2011C');
});
test('all three filters combine and countries normalize',()=>{
  assert.deepEqual(searchDirectory(teams,'2011',{country:'United States',region:'Ohio',grade:'Middle School'}).map(t=>t.number),['2011B']);
  assert.equal(searchDirectory(teams,'2011',{country:'Canada',region:'Ohio'}).length,0);
});
test('locations include inactive-only countries and dependent regions',()=>{
  assert.deepEqual(directoryLocations(teams).countries,['Canada','Iceland','United States']);
  assert.deepEqual(directoryLocations(teams,'Canada').regions,['Ontario']);
  assert.deepEqual(directoryLocations(teams,'Iceland').regions,['Capital']);
});


test('an IQ request answered with the V5 file is refused', async () => {
  const { directoryMatchesProgram } = await import('../lib/team-directory.mjs');
  // What the pre-IQ server sends for ?program=VIQRC: the V5 file, no program field.
  const v5File = { asOf: '2026-10-01T00:00:00.000Z', total: 1, teams: [{ number: '2A' }] };
  assert.equal(directoryMatchesProgram(v5File, 'VIQRC'), false);
  assert.equal(directoryMatchesProgram(v5File, 'V5RC'), true, 'V5 files predate the field and stay valid');
  assert.equal(directoryMatchesProgram(undefined, 'VIQRC'), false);
});

test('a list marked VIQRC is accepted for IQ and refused for V5', async () => {
  const { directoryMatchesProgram } = await import('../lib/team-directory.mjs');
  const iqFile = { program: 'VIQRC', total: 1, teams: [{ number: '86995D' }] };
  assert.equal(directoryMatchesProgram(iqFile, 'VIQRC'), true);
  assert.equal(directoryMatchesProgram(iqFile, 'V5RC'), false);
  assert.equal(directoryMatchesProgram({ program: 'V5RC', teams: [] }, 'V5RC'), true);
});
