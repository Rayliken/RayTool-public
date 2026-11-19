/* View-only navigation. Exports continue to use the complete diagram geometry. */
(()=>{
 const w=document.querySelector('#topowrap');let drag=null,space=false,moved=false;const views=new Map();let floor=null;
 function remember(){if(floor&&CURRENT_TOPO)views.set(floor,{zoom:topoZoom,x:w.scrollLeft,y:w.scrollTop});}
 function zoomAt(value,x=w.clientWidth/2,y=w.clientHeight/2){if(!CURRENT_TOPO)return;const old=topoZoom,px=(w.scrollLeft+x-20)/old,py=(w.scrollTop+y-20)/old;setTopoZoom(value);w.scrollLeft=px*topoZoom-x+20;w.scrollTop=py*topoZoom-y+20;remember();}
 function fit(widthOnly=false){if(!CURRENT_TOPO)return;setTopoZoom(Math.min((w.clientWidth-40)/CURRENT_TOPO.width,widthOnly?Infinity:(w.clientHeight-40)/CURRENT_TOPO.height));w.scrollLeft=0;w.scrollTop=0;remember();}
 const original=showTopology;showTopology=function(){remember();const next=M.meta.floor,saved=views.get(next);original();floor=next;if(saved){setTopoZoom(saved.zoom);w.scrollLeft=saved.x;w.scrollTop=saved.y;}else fit();};
 w.addEventListener('scroll',remember,{passive:true});
 w.addEventListener('wheel',e=>{if(workspace!=='line')return;e.preventDefault();const r=w.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?w.clientHeight:1);zoomAt(topoZoom*Math.exp(-Math.max(-250,Math.min(250,delta))*.002),e.clientX-r.left,e.clientY-r.top);},{passive:false});
 w.addEventListener('mousedown',e=>{
  const label=e.target.closest('.rf-label,[data-e],[data-n],[data-node-id],[data-edge-id]');
  if(e.button!==1&&!(e.button===0&&(space||e.altKey||!label)))return;
  e.preventDefault();e.stopImmediatePropagation();w.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,left:w.scrollLeft,top:w.scrollTop};moved=false;w.classList.add('drag');
 },true);
 window.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved ||= Math.hypot(dx,dy)>3;w.scrollLeft=drag.left-dx;w.scrollTop=drag.top-dy;});
 function end(){drag=null;w.classList.remove('drag');remember();}
 window.addEventListener('mouseup',end);window.addEventListener('blur',()=>{space=false;end();});
 w.addEventListener('click',e=>{if(moved){e.preventDefault();e.stopImmediatePropagation();moved=false;}},true);
 w.addEventListener('dblclick',e=>{if(!e.target.closest('.rf-label,[data-e],[data-n],[data-node-id],[data-edge-id]')){e.preventDefault();fit();}});
 window.addEventListener('keydown',e=>{if(workspace!=='line'||e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(e.code==='Space'){space=true;e.preventDefault();}else if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(topoZoom*1.25);}else if(e.key==='-'){e.preventDefault();zoomAt(topoZoom/1.25);}else if(e.key==='0'){e.preventDefault();fit();}
 });window.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});
 document.querySelector('#topoPlus').onclick=()=>zoomAt(topoZoom*1.25);document.querySelector('#topoMinus').onclick=()=>zoomAt(topoZoom/1.25);document.querySelector('#topo100').onclick=()=>zoomAt(1);document.querySelector('#topoSheet').onclick=()=>fit();document.querySelector('#topoFit').onclick=()=>fit(true);
 window.LineNavigation={zoomAt,fit,getView:()=>({zoom:topoZoom,x:w.scrollLeft,y:w.scrollTop})};
})();
