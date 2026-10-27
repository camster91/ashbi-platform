import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePilotCsv,minorUnits,clockSeconds,sourceDate,parseLegacyRow} from './pilot-source-formats.mjs';
const invalid=(fn,code='FORMAT_INVALID')=>assert.throws(fn,error=>error instanceof Error&&error.code===code);

test('CSV preserves physical record lines, BOM, CRLF, escaped quotes and multiline fields',()=>{
 assert.deepEqual(parsePilotCsv('\uFEFFName,Notes,Empty\r\n"Café","Line one\r\nLine ""two""",\r\nLast,plain,end'),[
  {line:1,values:['Name','Notes','Empty']},{line:2,values:['Café','Line one\r\nLine "two"','']},{line:4,values:['Last','plain','end']}
 ]);
});
test('CSV supports bare CR and empty fields without inventing an EOF row',()=>{
 assert.deepEqual(parsePilotCsv('a,,c\r,,\r'),[{line:1,values:['a','','c']},{line:2,values:['','','']}]);
 assert.deepEqual(parsePilotCsv(''),[]);assert.deepEqual(parsePilotCsv('\uFEFF'),[]);
 assert.deepEqual(parsePilotCsv('\n'),[{line:1,values:['']}]);
 assert.deepEqual(parsePilotCsv('a,'),[{line:1,values:['a','']}]);
});
test('CSV rejects stray quotes, unclosed quoted fields and text or spaces after a closing quote',()=>{
 for(const text of ['a,b"c','"unterminated','"x"tail','"x" ,z','"x""','"a"\r\n"b"x'])invalid(()=>parsePilotCsv(text));
 for(const value of [null,42,[],{}])invalid(()=>parsePilotCsv(value));
});
test('money converts only exact unsigned decimal lexemes and includes the maximum safe boundary',()=>{
 for(const [source,result]of[['0',0],['0.00',0],['01.2',120],['123.45',12345],['1.1',110],['90071992547409.91',Number.MAX_SAFE_INTEGER]])assert.equal(minorUnits(source),result,source);
});
test('money never rounds or accepts exponent, sign, whitespace, currency or unsafe values',()=>{
 for(const value of ['.005','0.005','1.234','0.10000000000000001','1e2','1E-2','-0','-1','+1','1,000','$1','NaN','Infinity',' 1','1 ','1.','1\n','90071992547409.92','90071992547410',1,null])invalid(()=>minorUnits(value),'MONEY_INVALID');
});
test('clock durations retain every second and reject invalid components or overflow',()=>{
 for(const [source,result]of[['00:00:00',0],['01:02:03',3723],['100:59:59',363599],['2501999792983:36:31',Number.MAX_SAFE_INTEGER]])assert.equal(clockSeconds(source),result,source);
 for(const value of ['01:60:00','01:00:60','-1:02:03','01:2:03','01:02:3','01:02','1.5:00:00',' 01:02:03','01:02:03Z','2501999792983:36:32',null])invalid(()=>clockSeconds(value));
});
test('day precision validates real Gregorian dates and never creates an instant',()=>{
 assert.deepEqual(sourceDate('2024-02-29'),{source:'2024-02-29',precision:'day'});
 for(const value of ['2023-02-29','1900-02-29','2024-04-31','2024-00-01','2024-01-00','2024-13-01','2024-1-01','2024-01-01 ',null])invalid(()=>sourceDate(value));
 assert.deepEqual(sourceDate('2000-02-29'),{source:'2000-02-29',precision:'day'});
});
test('explicit timestamp offsets remain distinguishable across DST and normalize exact instants',()=>{
 assert.deepEqual(sourceDate('2026-11-01T01:30:05-04:00'),{source:'2026-11-01T01:30:05-04:00',precision:'instant',utc:'2026-11-01T05:30:05.000Z'});
 assert.equal(sourceDate('2026-11-01T01:30:05-05:00').utc,'2026-11-01T06:30:05.000Z');
 assert.equal(sourceDate('2024-02-29T23:59:59.12+05:30').utc,'2024-02-29T18:29:59.120Z');
 assert.equal(sourceDate('2000-01-01T00:00:00.001Z').utc,'2000-01-01T00:00:00.001Z');
});
test('timestamps reject inferred zones, rollover dates, invalid time and malformed offsets',()=>{
 for(const value of ['2024-02-30T00:00:00Z','2024-02-29T24:00:00Z','2024-02-29T23:59:60Z','2024-02-29T23:60:00Z','2024-02-29T12:30Z','2024-02-29T12:30:00','2024-02-29 12:30:00Z','2024-02-29T12:30:00.1234Z','2024-02-29T12:30:00+24:00','2024-02-29T12:30:00+01:60','2024-02-29T12:30:00+0130','2024-02-29T12:30:00z'])invalid(()=>sourceDate(value));
});
test('legacy JSON preserves native data and exact root numeric source tokens without nested collisions',()=>{
 const {row,numberLexemes}=parseLegacyRow('{"amount":0.10000000000000001,"count":9007199254740991,"text":"  literal ; café  ","nested":{"amount":1.20},"rows":[{"count":2}],"exp":1e2,"negativeZero":-0}');
 assert.equal(row.amount,0.1);assert.equal(row.text,'  literal ; café  ');assert.equal(row.nested.amount,1.2);assert.ok(Object.is(row.negativeZero,-0));
 assert.deepEqual({...numberLexemes},{amount:'0.10000000000000001',count:'9007199254740991',exp:'1e2',negativeZero:'-0'});
 invalid(()=>minorUnits(numberLexemes.amount),'MONEY_INVALID');invalid(()=>minorUnits(numberLexemes.exp),'MONEY_INVALID');
});
test('legacy JSON rejects duplicate decoded keys at every object depth and unsafe numeric cells',()=>{
 for(const source of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"nested":{"x":1,"x":2}}','{"rows":[{"a":1,"a":2}]}','{"n":9007199254740993}','{"nested":{"n":9007199254740992}}','{"n":1e309}','[]','null','1','"text"','{"a":1,}'])invalid(()=>parseLegacyRow(source));
});
test('legacy JSON treats prototype-named keys as inert own data and does not confuse quoted content with keys',()=>{
 const {row,numberLexemes}=parseLegacyRow('{"__proto__":{"polluted":true},"constructor":"literal","text":"\\\"a\\\":1,\\\"a\\\":2","a":1}');
 assert.equal(Object.hasOwn(row,'__proto__'),true);assert.equal(row.__proto__.polluted,true);assert.equal({}.polluted,undefined);assert.equal(row.constructor,'literal');assert.equal(numberLexemes.a,'1');
});
test('legacy JSON refuses a runtime that cannot expose numeric source lexemes',()=>{
 const nativeParse=JSON.parse;
 JSON.parse=function(text,reviver){return nativeParse(text,typeof reviver==='function'?function(key,value){return reviver.call(this,key,value);}:reviver);};
 try{invalid(()=>parseLegacyRow('{"amount":0.1}'));}finally{JSON.parse=nativeParse;}
});
