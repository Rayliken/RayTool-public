import * as THREE from 'three';
export const PORT_COLORS={IN:0x55aaff,THRU:0x65dd9b,COUPLED:0xffaa4a,OUT:0xd29cff};
export function portLayout(n){const out={};let serial=0;for(const [edge,role]of Object.entries(n.ports||{})){let p;if(role==='IN')p=[-1.7,0,0];else if(role==='THRU')p=[1.7,0,0];else if(role==='COUPLED')p=[0,0,1.7];else{const count=n.dev==='SPL3'?3:2,index=Number((n.port_slots?.[edge]||'').replace('OUT',''))||++serial;p=[1.7,0,(index-(count+1)/2)*1.1];}out[edge]={position:p,role,slot:n.port_slots?.[edge]||role};}return out;}
export function equipmentModel(n,data,physical=false){const g=new THREE.Group();g.userData=data;function part(geo,color,pos=[0,0,0]){const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color}));m.position.set(...pos);m.userData=data;g.add(m);return m;}
 if(physical){part(new THREE.BoxGeometry(3,4.5,1.8),0xd6ab52,[0,2,0]);part(new THREE.BoxGeometry(2.65,3.9,.1),0x344955,[0,2,1]);for(let i=0;i<4;i++)part(new THREE.BoxGeometry(2.2,.12,.15),0x9bb5bf,[0,1+i*.6,1.1]);part(new THREE.SphereGeometry(.13,6,4),0x67ec8e,[.9,3.5,1.15]);}
 else if(n.kind==='device'){const coupler=/^DC/.test(n.dev||'');part(new THREE.BoxGeometry(2.3,.65,coupler?.9:2.2),coupler?0xd6aa67:0x9d94d3);for(const port of Object.values(portLayout(n))){const stem=part(new THREE.CylinderGeometry(.2,.2,.65,8),PORT_COLORS[port.role]||PORT_COLORS.OUT,port.position);stem.rotation.z=Math.PI/2;if(port.role==='COUPLED')stem.rotation.y=Math.PI/2;}}
 else if(n.kind==='antenna'&&/panel/i.test(n.dev||'')){part(new THREE.BoxGeometry(1.2,2.7,.35),0xf1f6fa,[0,1.2,0]);part(new THREE.BoxGeometry(.3,1.9,.4),0x8096a7,[0,1,-.35]);}
 else if(n.kind==='antenna'){part(new THREE.SphereGeometry(.95,12,6,0,Math.PI*2,0,Math.PI/2),0xf1f6fa,[0,.15,0]);part(new THREE.CylinderGeometry(1,1,.15,12),0x8199ad);}
 else if(n.kind==='termination'){part(new THREE.CylinderGeometry(.35,.35,1.3,8),0x424e5b,[0,.5,0]);part(new THREE.CylinderGeometry(.2,.2,.25,8),0xe2bb71,[0,-.2,0]);}
 else if(n.kind==='source'){part(new THREE.ConeGeometry(.7,1.7,8),0x65c3f4,[0,.7,0]);part(new THREE.TorusGeometry(.8,.1,4,12),0x85bada).rotation.x=Math.PI/2;}
 else{const p=part(new THREE.CylinderGeometry(.28,.28,1.1,8),0xb3c0c6);p.rotation.z=Math.PI/2;}
 return g;
}
