export const DEFAULT_TRAILER={length:13600,width:2450,height:2700,doorHeight:2670,payload:24000};
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const num=v=>typeof v==='number'?v:Number(String(v??'').trim().replace(/\s/g,'').replace(/,(?=\d{3}(?:\D|$))/g,''));
const aliases={quantity:['quantity','qty'],length:['lengthmm','length'],width:['widthmm','width'],height:['heightmm','hieghtmm','height'],weight:['weightperunitkg','weightperpalletkg','weightperboxkg','weightkg','weight','grossweightkg'],id:['unitid','id','palletid'],name:['productassembly','product','description','name'],pallets:['eurpalletsperunit','palletsperunit'],maxAbove:['maxloadabovekg','maxloadabove','maxupperkg'],upper:['approvedupperid','upperid'],base:['approvedbaseid','baseid'],note:['handlingconstraint','notes']};
const clean=s=>String(s??'').trim();
const EPS=.01;
function fail(message){throw new Error(message);}
export function findHeaders(rows,keys){
 for(let r=0;r<Math.min(rows.length,80);r++){
  const row=rows[r].map(norm),map={};
  for(const k of keys)map[k]=row.findIndex(x=>(aliases[k]||[norm(k)]).includes(x));
  if(keys.every(k=>map[k]>=0))return {row:r,map};
 }
 return null;
}
export function parseItems(rows){
 const header=findHeaders(rows,['quantity','length','width','height','weight']);
 if(!header)fail('No cargo table found. Use Quantity, Length(mm), Width(mm), Height(mm), and Weight per unit(kg).');
 const columns=rows[header.row].map(norm),map={...header.map};
 for(const [key,names] of Object.entries(aliases))if(!(key in map))map[key]=columns.findIndex(x=>names.includes(x));
 const at=(row,key)=>map[key]>=0?row[map[key]]:undefined;
 const items=[];const ids=new Set();
 for(let i=header.row+1;i<rows.length;i++){
  const row=rows[i];
  if(['quantity','length','width','height','weight'].every(k=>at(row,k)==null||clean(at(row,k))===''))continue;
  const quantity=num(at(row,'quantity'));
  if(!Number.isInteger(quantity)||quantity<1||quantity>200)fail(`Row ${i+1}: quantity must be a whole number from 1 to 200.`);
  const item={};
  for(const key of ['length','width','height','weight']){
   const value=at(row,key);item[key]=num(value);
   if(value==null||clean(value)===''||!Number.isFinite(item[key])||item[key]<=0)fail(`Row ${i+1}: ${key} must be a positive number.`);
  }
  const product=items.length+1,id=clean(at(row,'id'))||`item-${i-header.row}`;
  const maxAboveRaw=at(row,'maxAbove');
  item.maxAbove=maxAboveRaw==null||clean(maxAboveRaw)===''?0:num(maxAboveRaw);
  if(!Number.isFinite(item.maxAbove)||item.maxAbove<0)fail(`Row ${i+1}: maximum load above must be zero or a positive number.`);
  item.upper=clean(at(row,'upper'));item.base=clean(at(row,'base'));
  if(quantity>1&&(item.upper||item.base))fail(`Row ${i+1}: use a separate row and unique ID for each matched stack item.`);
  const suppliedPallets=at(row,'pallets');
  item.pallets=suppliedPallets==null||clean(suppliedPallets)===''?Math.max(1,Math.round(item.length*item.width/960000)):num(suppliedPallets);
  if(!Number.isInteger(item.pallets)||item.pallets<1)fail(`Row ${i+1}: EUR pallets per unit must be a positive whole number.`);
  item.name=clean(at(row,'name'))||`Cargo item ${product}`;item.note=clean(at(row,'note'));
  for(let n=0;n<quantity;n++){
   const expandedId=quantity===1?id:`${id}-${n+1}`;
   if(ids.has(expandedId))fail(`Duplicate Unit ID: ${expandedId}. Each assembly needs a unique ID.`);
   ids.add(expandedId);
   items.push({...item,id:expandedId,number:items.length+1,label:quantity===1?`Pallet-${items.length+1}`:`Pallet-${items.length+1}`,sourceRow:i+1});
   if(items.length>200)fail('This guide supports up to 200 individual assemblies in one shipment.');
  }
 }
 if(!items.length)fail('The cargo table is empty. Add at least one item.');
 for(const item of items){
  if(item.base&&!ids.has(item.base))fail(`${item.label}: approved base ${item.base} does not exist.`);
  if(item.upper&&!ids.has(item.upper))fail(`${item.label}: approved upper ${item.upper} does not exist.`);
  if(item.base===item.id||item.upper===item.id)fail(`${item.label}: an item cannot stack on itself.`);
 }
 return items;
}
export function readTrailer(rows){
 const t={...DEFAULT_TRAILER};
 const names={'maximumcargopayloadkg':'payload','internallengthmm':'length','internalwidthmm':'width','internalheightmm':'height','reardoorheightmm':'doorHeight'};
 for(const row of rows)for(let i=0;i<row.length-1;i++){
  const key=names[norm(row[i])];if(key){const n=num(row[i+1]);if(!Number.isFinite(n)||n<=0)fail(`Trailer ${key} must be positive.`);t[key]=n;}
 }
 return t;
}
export function parsePlacement(rows,items){
 let header=-1,map;
 const fields=['Load order','Floor unit ID','Upper unit ID','Trailer row(s)','Lane(s)'];
 for(let r=0;r<rows.length;r++){
  const n=rows[r].map(norm),m=fields.map(f=>n.indexOf(norm(f)));
  if(m.every(i=>i>=0)){header=r;map=m;break;}
 }
 if(header<0)return null;
 const byId=new Map(items.map(i=>[i.id,i]));const placements=[];const seen=new Set();
 for(let r=header+1;r<rows.length;r++){
  const row=rows[r],sequence=num(row[map[0]]);
  if(!Number.isFinite(sequence)||sequence<=0)break;
  const base=byId.get(clean(row[map[1]])),topId=clean(row[map[2]]);
  if(!base)fail(`Loading plan row ${r+1}: floor unit ${clean(row[map[1]])} is missing.`);
  const rowText=clean(row[map[3]]),rowMatch=rowText.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if(!rowMatch||Number(rowMatch[1])<1)fail(`Loading plan row ${r+1}: use row numbers such as 1 or 1-2.`);
  const lanes=clean(row[map[4]]).toUpperCase().split(/[+,/\s]+/).filter(Boolean),laneMap={L:0,C:1,R:2};
  const indices=lanes.map(l=>laneMap[l]);
  if(!indices.length||indices.some(i=>i===undefined)||new Set(indices).size!==indices.length||indices.some((x,i)=>i&&x!==indices[i-1]+1))fail(`Loading plan row ${r+1}: lanes must be L, C, R, or adjacent lanes such as L+C.`);
  const first=Number(rowMatch[1]),last=Number(rowMatch[2]||first);
  if(last<first||base.length>(last-first+1)*1200+EPS||base.width>indices.length*800+EPS)fail(`${base.label}: dimensions exceed its assigned rows or lanes.`);
  const x=(first-1)*1200,y=indices[0]*800;
  if(seen.has(base.id))fail(`Loading plan repeats ${base.label}.`);seen.add(base.id);
  placements.push({id:base.id,x,y,z:0,sequence,base:null});
  if(topId){
   const top=byId.get(topId);if(!top)fail(`Loading plan refers to unknown upper unit ${topId}.`);
   if(seen.has(topId))fail(`Loading plan repeats ${top.label}.`);seen.add(topId);
   placements.push({id:top.id,x,y,z:base.height,sequence:sequence+.1,base:base.id});
  }
 }
 if(seen.size!==items.length)fail(`Loading plan is incomplete: ${items.filter(i=>!seen.has(i.id)).map(i=>i.label).join(', ')} have no position.`);
 return placements;
}
function intersects(a,b){return a.x<b.x+b.length-EPS&&a.x+a.length>b.x+EPS&&a.y<b.y+b.width-EPS&&a.y+a.width>b.y+EPS;}
export function proposePlacement(items,trailer){
 const byId=new Map(items.map(i=>[i.id,i])),topIds=new Set(),pairs=new Map();
 for(const item of items){
  if(item.base){
   const b=byId.get(item.base);
   if(!b)fail(`${item.label}: approved base ${item.base} does not exist.`);
   if(b.base)fail('Only two-tier stacks are supported.');
   if(b.upper&&b.upper!==item.id)fail(`${item.label}: the base lists a different approved upper item.`);
   if(pairs.has(b.id))fail(`${b.label}: multiple upper units are not supported.`);
   pairs.set(b.id,item);topIds.add(item.id);
  }
 }
 for(const item of items)if(item.upper){
  const top=byId.get(item.upper);
  if(!top)fail(`${item.label}: approved upper ${item.upper} does not exist.`);
  if(top.base&&top.base!==item.id)fail(`${top.label}: approved base does not match ${item.label}.`);
  if(topIds.has(top.id)&&pairs.get(item.id)?.id!==top.id)fail(`${top.label}: more than one base was assigned.`);
  pairs.set(item.id,top);topIds.add(top.id);
 }
 const floors=items.filter(i=>!topIds.has(i.id)).map(i=>({...i,top:pairs.get(i.id)}));
 for(const base of floors)if(base.top){const t=base.top;if(t.length>base.length||t.width>base.width||t.weight>base.maxAbove||t.height+base.height>Math.min(trailer.height,trailer.doorHeight))fail(`${base.label} + ${t.label}: stack exceeds footprint, support weight, or height limits.`);}
 if(floors.some(i=>i.length>trailer.length||i.width>trailer.width||i.height>Math.min(trailer.height,trailer.doorHeight)))fail('An item is too large for the trailer in its upright, unrotated orientation.');
 const orders=[
  [...floors].sort((a,b)=>b.width-a.width||b.length-a.length),
  [...floors].sort((a,b)=>b.length*b.width-a.length*a.width),
  [...floors].sort((a,b)=>b.length-a.length||b.width-a.width),
  [...floors]
 ];
 let best;
 for(const order of orders){
  const placed=[];const missed=[];
  for(const item of order){
   const xs=[0,...placed.map(p=>p.x+p.length)],ys=[0,...placed.map(p=>p.y+p.width)];
   let candidate;
   for(const x of [...new Set(xs)].sort((a,b)=>a-b))for(const y of [...new Set(ys)].sort((a,b)=>a-b)){
    const c={...item,x,y};if(x+item.length>trailer.length+EPS||y+item.width>trailer.width+EPS||placed.some(p=>intersects(c,p)))continue;
    if(!candidate||x<candidate.x||(x===candidate.x&&y<candidate.y))candidate=c;
   }
   if(candidate)placed.push(candidate);else missed.push(item);
  }
  if(!missed.length){best=placed;break;}
 }
 if(!best)fail('A complete layout could not be generated without rotation or extra stacking. Include a Loading plan sheet, reduce the load, or use another trailer. This is a packing limitation, not proof that the shipment cannot fit.');
 const result=[];
 best.sort((a,b)=>a.x-b.x||a.y-b.y).forEach((item,i)=>{
  result.push({id:item.id,x:item.x,y:item.y,z:0,sequence:i+1,base:null});
  if(item.top)result.push({id:item.top.id,x:item.x,y:item.y,z:item.height,sequence:i+1.1,base:item.id});
 });
 return result;
}
export function validatePlan(items,placements,trailer){
 const byId=new Map(items.map(i=>[i.id,i])),seen=new Set();
 if(items.reduce((s,i)=>s+i.weight,0)>trailer.payload+EPS)fail('Total gross cargo weight exceeds the trailer payload.');
 for(const p of placements){
  const item=byId.get(p.id);if(!item)fail(`Unknown placed unit ${p.id}.`);
  if(seen.has(p.id))fail(`Duplicate placement for ${item.label}.`);seen.add(p.id);
  if(![p.x,p.y,p.z].every(Number.isFinite)||Math.min(p.x,p.y,p.z)<-EPS||p.x+item.length>trailer.length+EPS||p.y+item.width>trailer.width+EPS||p.z+item.height>Math.min(trailer.height,trailer.doorHeight)+EPS)fail(`${item.label}: position exceeds the trailer or door envelope.`);
  if(item.base&&p.base!==item.base)fail(`${item.label}: must be on approved base ${item.base}.`);
  if(p.base){
   const b=byId.get(p.base),bp=placements.find(q=>q.id===p.base);
   if(!b||!bp||bp.z!==0)fail(`${item.label}: missing floor support.`);
   if(item.weight>b.maxAbove+EPS)fail(`${item.label}: base support weight exceeded.`);
   if(b.upper&&b.upper!==item.id)fail(`${item.label}: this base permits a different upper unit.`);
   if(Math.abs(p.z-b.height)>EPS||p.x<bp.x-EPS||p.y<bp.y-EPS||p.x+item.length>bp.x+b.length+EPS||p.y+item.width>bp.y+b.width+EPS)fail(`${item.label}: upper unit is not fully supported by its base.`);
   if(placements.filter(q=>q.base===p.base).length>1)fail(`${b.label}: only one matched upper assembly is supported.`);
  }else if(p.z!==0)fail(`${item.label}: elevated cargo has no base.`);
 }
 if(seen.size!==items.length)fail('The layout does not include every item.');
 for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
  const a={...placements[i],...byId.get(placements[i].id)},b={...placements[j],...byId.get(placements[j].id)};
  if(intersects(a,b)&&a.z<b.z+b.height-EPS&&a.z+a.height>b.z+EPS)fail(`${a.label} overlaps ${b.label}.`);
 }
 return true;
}
export function makeStages(items,placements){
 const byId=new Map(items.map(i=>[i.id,i]));
 const floors=placements.filter(p=>!p.base).sort((a,b)=>a.x-b.x||a.y-b.y);
 const groups=[];
 for(const p of floors){
  let g=groups.find(g=>Math.abs(g.x-p.x)<EPS);
  if(!g){g={x:p.x,placements:[]};groups.push(g);}
  g.placements.push(p,...placements.filter(q=>q.base===p.id));
 }
 return groups.map((g,index)=>{
  const first=Math.floor(g.x/1200)+1,next=groups[index+1]?.x;
  const end=next===undefined?Math.ceil(Math.max(...g.placements.map(p=>p.x+byId.get(p.id).length))/1200):Math.max(first,Math.ceil(next/1200));
  return {...g,index,first,last:end,title:first===end?`Row ${first}`:`Rows ${first}–${end}`,items:g.placements.map(p=>({...byId.get(p.id),placement:p}))};
 });
}
export function shipmentFromSheets(sheets,name='Uploaded shipment'){
 let cargo;
 const ordered=[...sheets].sort((a,b)=>(norm(a.name)==='pallets'?-1:0)-(norm(b.name)==='pallets'?-1:0));
 for(const sheet of ordered)if(findHeaders(sheet.rows,['quantity','length','width','height','weight'])&&sheet.rows.slice(1).some(r=>r.slice(0,5).some(x=>x!=null&&clean(x)!==''))){cargo=sheet;break;}
 if(!cargo)fail('No populated cargo sheet found. Use the pallets sheet in the example workbook.');
 const items=parseItems(cargo.rows),planSheet=sheets.find(s=>norm(s.name)==='loadingplan');
 const trailer=planSheet?readTrailer(planSheet.rows):{...DEFAULT_TRAILER};
 const supplied=planSheet?parsePlacement(planSheet.rows,items):null;
 const placements=supplied||proposePlacement(items,trailer);
 validatePlan(items,placements,trailer);
 return {name:name.replace(/\.(xlsx|xls|csv)$/i,''),items,placements,trailer,source:supplied?'Workbook loading plan':'Suggested layout',generated:!supplied};
}
export function planKey(shipment){
 const text=JSON.stringify([shipment.items,shipment.placements,shipment.trailer]);let h=2166136261;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
 return `load-guide-${(h>>>0).toString(16)}`;
}
export function locationText(item,trailer=DEFAULT_TRAILER){
 const p=item.placement;
 if(!p)return '';
 const lanes=['Left','Centre','Right'].filter((_,i)=>p.y<((i+1)*800)-EPS&&p.y+item.width>i*800+EPS);
 const first=Math.floor(p.x/1200)+1,last=Math.ceil((p.x+item.length)/1200);
 return `${lanes.join(' + ')} · ${first===last?`row ${first}`:`rows ${first}–${last}`}`;
}
