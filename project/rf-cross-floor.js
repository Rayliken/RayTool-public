(function(host){
 'use strict';
 function refresh(cat,C){
  const done=new Set(),changes=[];
  function visit(f,id,seen){
   const m=cat[f],n=m?.nodes[id],up=n?.upstream_connection,key=f+'/'+id;
   if(!up?.node||done.has(key))return;
   if(seen.has(key))throw Error('Cross-floor source cycle: '+[...seen,key].join(' -> '));
   seen=new Set([...seen,key]);const parent=cat[up.floor],a=parent&&C.analyze(parent),path=a&&C.pathTo(a,up.node),root=a&&parent.nodes[a.owner[up.node]];
   let values={},plane='INHERITED_AFTER_POI';
   if(root){
    visit(up.floor,root.id,seen);
    if(!path?.length&&root.kind==='source'){values={...root.power_dbm};plane=root.power_reference_plane||'UNSPECIFIED';}
    else if(path?.length){
     const len={COX12:0,COX114:0,LCK:0},parts=[],ids=new Set([root.id]);
     for(let i=0;i<path.length;i++){
      const s=path[i],v=C.lengthInfo(parent,s.edge).value;len[s.edge.cable]+=v??0;ids.add(s.node.id);ids.add(s.edge.id);
      if(i<path.length-1&&s.node.kind==='device')parts.push({dev:s.node.dev,role:s.node.ports[path[i+1].edge.id],loss_db:s.node.loss_db});
     }
     if(up.exit_edge){const end=parent.nodes[up.node],edge=parent.edges[up.exit_edge];if(!end||!edge||end.kind!=='device'||![edge.a,edge.b].includes(end.id))throw Error('Invalid upstream output: '+key);parts.push({dev:end.dev,role:end.ports[up.exit_edge],loss_db:end.loss_db});}
     const row={status:'PATH_READY',kind:'Interface',type:'NA',len,components:parts,jumper:0,connector_count:2*parts.length,source_id:root.id,source_power_dbm:root.power_dbm,path_edge_ids:path.map(s=>s.edge.id),issues:C.issues(parent).filter(x=>ids.has(x.item))};
     if(path.some(s=>C.lengthInfo(parent,s.edge).value==null))row.issues.push({code:'LENGTH'});
     for(const fr of C.FREQ){const v=C.calculate(parent,row,fr).terminal_dbm;if(Number.isFinite(v))values[fr]=v;}
    }
   }
   const before=n.power_dbm;n.power_dbm=values;n.power_reference_plane=plane;n.inherited_power_state=Object.keys(values).length===C.FREQ.length?'CALCULATED':'UNRESOLVED';
   if(JSON.stringify(before)!==JSON.stringify(values))changes.push({floor:f,id,before,after:values,upstream:up});done.add(key);
  }
  for(const[f,m]of Object.entries(cat))for(const n of Object.values(m.nodes))if(n.kind==='source')visit(f,n.id,new Set());
  return changes;
 }
 const api={refresh};if(typeof module==='object'&&module.exports)module.exports=api;else host.RFCrossFloor=api;
})(typeof window==='object'?window:globalThis);
