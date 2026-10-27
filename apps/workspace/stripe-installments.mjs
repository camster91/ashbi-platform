const maximum=BigInt(Number.MAX_SAFE_INTEGER);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const half=(n,d)=>(n*2n+d)/(d*2n);
function safe(value){if(value<0n||value>maximum)throw 409;return Number(value);}
function day(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [y,m,d]=value.split('-').map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return y>=1&&m>=1&&m<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}

// Pure allocation only. Current authority, source claims and provider limits belong
// to the caller. Frozen source amounts and schedule are validated, never repaired.
export function allocateInstallments(snapshot){
 if(!object(snapshot)||snapshot.version!==1||!day(snapshot.dueOn)||!object(snapshot.tax)||!['NONE','HST','GST','PST','TAX'].includes(snapshot.tax.type)||!integer(snapshot.tax.rateBps,0,5000)||snapshot.tax.type==='NONE'&&snapshot.tax.rateBps!==0||!Array.isArray(snapshot.lines)||!snapshot.lines.length||snapshot.lines.length>100)throw 409;
 for(const key of ['subtotalMinor','taxMinor','totalMinor'])if(!integer(snapshot[key]))throw 409;
 if(!snapshot.totalMinor)throw 409;
 let cumulative=0n,previousTax=0n;
 const source=snapshot.lines.map((line,index)=>{
  if(!object(line)||!['FIXED','TIME'].includes(line.kind)||typeof line.description!=='string'||!line.description.trim()||line.description.length>500||line.description.includes('\0')||!integer(line.totalMinor))throw 409;
  let expected;
  if(line.kind==='FIXED'){
   if(!integer(line.quantity,1,1000000)||!integer(line.unitMinor))throw 409;
   expected=BigInt(line.quantity)*BigInt(line.unitMinor);
  }else{
   if(!object(line.source)||!integer(line.source.seconds,1)||!integer(line.source.rateMinor))throw 409;
   expected=half(BigInt(line.source.seconds)*BigInt(line.source.rateMinor),3600n);
  }
  if(expected!==BigInt(line.totalMinor))throw 409;
  cumulative+=expected;safe(cumulative);
  const tax=half(cumulative*BigInt(snapshot.tax.rateBps),10000n),taxMinor=tax-previousTax;previousTax=tax;
  return {index,sourceIndex:index,description:line.kind==='FIXED'?line.description+' (quantity '+line.quantity+')':line.description,base:expected,tax:taxMinor,gross:expected+taxMinor};
 });
 if(cumulative!==BigInt(snapshot.subtotalMinor)||previousTax!==BigInt(snapshot.taxMinor)||cumulative+previousTax!==BigInt(snapshot.totalMinor))throw 409;
 const schedule=snapshot.installments;
 if(!Array.isArray(schedule)||!([1,2].includes(schedule.length)))throw 409;
 for(const row of schedule)if(!object(row)||!integer(row.amountMinor,1)||!day(row.dueOn))throw 409;
 if(schedule.length===1){if(schedule[0].kind!=='FULL'||schedule[0].amountMinor!==snapshot.totalMinor||schedule[0].dueOn!==snapshot.dueOn)throw 409;}
 else if(schedule[0].kind!=='DEPOSIT'||schedule[1].kind!=='BALANCE'||BigInt(schedule[0].amountMinor)+BigInt(schedule[1].amountMinor)!==BigInt(snapshot.totalMinor)||schedule[0].dueOn>=schedule[1].dueOn||schedule[1].dueOn!==snapshot.dueOn)throw 409;
 const holds=[];
 let cumulativeGross=0n,previousDeposit=0n;
 const deposit=source.map(line=>{
  cumulativeGross+=line.gross;
  const sum=half(BigInt(schedule[0].amountMinor)*cumulativeGross,BigInt(snapshot.totalMinor)),gross=sum-previousDeposit;previousDeposit=sum;
  const tax=line.gross===0n?0n:half(gross*line.tax,line.gross);
  return {base:gross-tax,tax};
 });
 const installments=schedule.map((row,childIndex)=>{
  const lines=source.map((line,i)=>{
   const allocation=schedule.length===1?line:childIndex===0?deposit[i]:{base:line.base-deposit[i].base,tax:line.tax-deposit[i].tax};
   const amountMinor=safe(allocation.base),taxMinor=safe(allocation.tax);
   if(amountMinor===0&&taxMinor>0)holds.push({code:'TAX_ONLY_LINE_REVIEW_REQUIRED',kind:row.kind,sourceIndex:i});
   return {index:line.index,description:line.description,amountMinor,taxMinor,sourceIndex:i};
  });
  const subtotalMinor=safe(lines.reduce((n,l)=>n+BigInt(l.amountMinor),0n)),taxMinor=safe(lines.reduce((n,l)=>n+BigInt(l.taxMinor),0n)),totalMinor=safe(BigInt(subtotalMinor)+BigInt(taxMinor));
  if(totalMinor!==row.amountMinor)throw 409;
  return {kind:row.kind,dueOn:row.dueOn,subtotalMinor,taxMinor,totalMinor,lines};
 });
 return {installments,holds};
}
