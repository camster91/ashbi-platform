// Pure source-format readers. They never normalize financial or temporal evidence implicitly.
const maximum=BigInt(Number.MAX_SAFE_INTEGER);
function failure(message,code='FORMAT_INVALID'){const error=new Error(message);error.code=code;return error;}

export function parsePilotCsv(text){
 if(typeof text!=='string')throw failure('CSV input must be text');
 if(text.startsWith('\uFEFF'))text=text.slice(1);
 const records=[];let values=[],field='',state='start',line=1,recordLine=1,started=false;
 for(let i=0;i<text.length;){
  const char=text[i];
  if(state==='quoted'){
   if(char==='"'){if(text[i+1]==='"'){field+='"';i+=2;}else{state='closed';i++;}}
   else if(char==='\r'||char==='\n'){const newline=char==='\r'&&text[i+1]==='\n'?'\r\n':char;field+=newline;i+=newline.length;line++;}
   else{field+=char;i++;}
   continue;
  }
  if(char==='\r'||char==='\n'){
   values.push(field);records.push({line:recordLine,values});values=[];field='';state='start';started=false;
   i+=char==='\r'&&text[i+1]==='\n'?2:1;line++;recordLine=line;continue;
  }
  if(char===','){values.push(field);field='';state='start';started=true;i++;continue;}
  if(char==='"'){if(state!=='start')throw failure('Unexpected CSV quote at line '+line);state='quoted';started=true;i++;continue;}
  if(state==='closed')throw failure('Unexpected text after CSV quote at line '+line);
  field+=char;state='plain';started=true;i++;
 }
 if(state==='quoted')throw failure('Unclosed CSV quote at line '+recordLine);
 if(started||values.length){values.push(field);records.push({line:recordLine,values});}
 return records;
}

export function minorUnits(decimalLexeme){
 if(typeof decimalLexeme!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(decimalLexeme))throw failure('Money requires an exact unsigned decimal lexeme','MONEY_INVALID');
 const [whole,fraction='']=decimalLexeme.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(minor>maximum)throw failure('Money exceeds the safe integer range','MONEY_INVALID');
 return Number(minor);
}

export function clockSeconds(value){
 const parts=typeof value==='string'&&/^(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
 if(!parts)throw failure('Duration requires hours:minutes:seconds');
 const seconds=BigInt(parts[1])*3600n+BigInt(parts[2])*60n+BigInt(parts[3]);
 if(seconds>maximum)throw failure('Duration exceeds the safe integer range');
 return Number(seconds);
}

function validDay(year,month,day){
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return month>=1&&month<=12&&day>=1&&day<=days[month-1];
}
export function sourceDate(value){
 if(typeof value!=='string')throw failure('Date input must be text');
 const day=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(day){if(!validDay(Number(day[1]),Number(day[2]),Number(day[3])))throw failure('Invalid calendar date');return {source:value,precision:'day'};}
 const instant=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
 if(!instant||!validDay(Number(instant[1]),Number(instant[2]),Number(instant[3]))||Number(instant[4])>23||Number(instant[5])>59||Number(instant[6])>59||instant[8]!=='Z'&&(Number(instant[9])>23||Number(instant[10])>59))throw failure('Invalid explicit ISO timestamp');
 const milliseconds=Date.parse(value);if(!Number.isFinite(milliseconds))throw failure('Invalid explicit ISO timestamp');
 return {source:value,precision:'instant',utc:new Date(milliseconds).toISOString()};
}

// Native JSON parsing validates grammar first. This second pass only identifies
// decoded object keys; quoted text values and array elements cannot become keys.
function assertUniqueKeys(text){
 let offset=0;
 const whitespace=()=>{while(/\s/.test(text[offset]??'')&&offset<text.length)offset++;};
 function string(){const start=offset++;while(offset<text.length){if(text[offset]==='\\'){offset+=2;continue;}if(text[offset++]==='"')return JSON.parse(text.slice(start,offset));}throw failure('Invalid JSON string');}
 function value(){
  whitespace();const char=text[offset];
  if(char==='"'){string();return;}
  if(char==='{'){
   offset++;whitespace();const keys=new Set();if(text[offset]==='}'){offset++;return;}
   for(;;){const key=string();if(keys.has(key))throw failure('Duplicate JSON object key');keys.add(key);whitespace();offset++;value();whitespace();if(text[offset++]==='}')return;whitespace();}
  }
  if(char==='['){offset++;whitespace();if(text[offset]===']'){offset++;return;}for(;;){value();whitespace();if(text[offset++]===']')return;}}
  while(offset<text.length&&!/[\s,}\]]/.test(text[offset]))offset++;
 }
 value();
}
export function parseLegacyRow(rawJSONline){
 if(typeof rawJSONline!=='string')throw failure('Legacy JSON input must be text');
 try{
  let lexical=false;JSON.parse('0',function(key,value,context){if(key==='')lexical=context?.source==='0';return value;});
  if(!lexical)throw failure('Runtime cannot preserve JSON number source lexemes');
  const lexemes=new WeakMap();
  const row=JSON.parse(rawJSONline,function(key,value,context){
   if(typeof value==='number'){
    if(typeof context?.source!=='string'||!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw failure('Invalid or unsafe JSON numeric cell');
    let cells=lexemes.get(this);if(!cells){cells=Object.create(null);lexemes.set(this,cells);}cells[key]=context.source;
   }
   return value;
  });
  if(!row||typeof row!=='object'||Array.isArray(row))throw failure('Legacy JSON row must be an object');
  assertUniqueKeys(rawJSONline);
  return {row,numberLexemes:lexemes.get(row)??Object.create(null)};
 }catch(error){if(error?.code==='FORMAT_INVALID')throw error;throw failure('Invalid legacy JSON row');}
}
