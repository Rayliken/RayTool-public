// A view-only projection: never changes RF connectivity, metres or budget ownership.
export const FLOOR_ORDER=['B4','B3','B2','B1','LG','L1','L1M','L2','L3','L3M','L4','L4M1','L4M2','L5','L5M1','L5M2'];
export function floorName(value){const f=String(value||'').trim().toUpperCase();return ['G','GF'].includes(f)?'LG':FLOOR_ORDER.includes(f)?f:null;}
export function stairPlan(catalog){
 const groups=new Map(),unmapped=[];
 for(const [floor,m]of Object.entries(catalog))for(const e of Object.values(m.edges)){
  if(!e.stair)continue;
  const from=floorName(e.stair.cross_floor_from||e.stair.from),to=floorName(e.stair.cross_floor_to||e.stair.to);
  if(!from||!to||from===to){unmapped.push({floor,edge:e.id});continue;}
  const reference=e.budget_include===false||!!e.cross_floor?.reference_only||e.route_status==='INHERITED_STAIR_REFERENCE';
  const key=e.physical_run_id||`${floor}/${e.id}`;
  const item={floor,edge:e.id,from,to,reference,key};
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
 }
 const routes=[];
 for(const [key,copies]of groups){
  // Conflicting From/To must remain separate until the evidence is resolved.
  const spans=new Map();for(const c of copies){const k=[c.from,c.to].sort().join('/');if(!spans.has(k))spans.set(k,[]);spans.get(k).push(c);}
  for(const matches of spans.values()){
   matches.sort((a,b)=>Number(a.reference)-Number(b.reference)||Number(b.floor===b.from)-Number(a.floor===a.from));
   const owner=matches[0],lo=Math.min(FLOOR_ORDER.indexOf(owner.from),FLOOR_ORDER.indexOf(owner.to)),hi=Math.max(FLOOR_ORDER.indexOf(owner.from),FLOOR_ORDER.indexOf(owner.to));
   routes.push({...owner,copies:matches,levels:FLOOR_ORDER.slice(lo,hi+1),identityConflict:spans.size>1});
  }
 }
 return {routes,unmapped};
}
export function stairPoints(route,anchor,height){
 const levels=route.from===route.levels[0]?route.levels:[...route.levels].reverse();
 return levels.map(f=>[anchor[0],height(f),anchor[2]]);
}

// Four flights around a rectangular well; landings return to the same XY each level.
// The exaggerated view height and well width are display parameters, never RF lengths.
export function windingStairPoints(route,anchor,height,width=3){
 const levels=route.from===route.levels[0]?route.levels:[...route.levels].reverse();
 const out=[[anchor[0],height(levels[0]),anchor[2]]];
 const loop=[[0,0],[width,0],[width,width],[0,width],[0,0]];
 for(let l=1;l<levels.length;l++){
  const a=height(levels[l-1]),b=height(levels[l]);
  for(let side=0;side<4;side++)for(let step=1;step<=6;step++){
   const t=step/6,x=anchor[0]+loop[side][0]*(1-t)+loop[side+1][0]*t,z=anchor[2]+loop[side][1]*(1-t)+loop[side+1][1]*t;
   out.push([x,a+(b-a)*(side+(step-1)/6)/4,z]);
   out.push([x,a+(b-a)*(side+t)/4,z]);
  }
 }
 return out;
}
