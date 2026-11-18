import { useEffect,useRef,useState } from 'preact/hooks';
import type { Drum } from '../store/schema';

// Turntable view: the drum turns continuously like a globe on its stand. Drag to turn it by hand; it stays still
// when the reader asks for reduced motion and pauses while it is off screen.
type P=[number,number];
const PERIOD=28,PITCH=.3;
function hull(points:P[]):P[] {
  const p=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(o:P,a:P,b:P)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),half=(list:P[])=>{const out:P[]=[];for(const q of list){while(out.length>=2&&cross(out[out.length-2]!,out[out.length-1]!,q)<=0)out.pop();out.push(q);}return out;};
  const lower=half(p),upper=half(p.reverse());return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
export function DrumVisual({drum,fillPct=65,compact=false}:{drum:Drum;fillPct?:number;compact?:boolean}) {
  const [angle,setAngle]=useState(33),svg=useRef<SVGSVGElement>(null),drag=useRef<{x:number;a:number}|null>(null),onScreen=useRef(true);
  useEffect(()=>{
    if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    let raf=0,last=performance.now();const io=new IntersectionObserver(([e])=>{onScreen.current=!!e?.isIntersecting;});if(svg.current)io.observe(svg.current);
    const tick=(t:number)=>{const dt=Math.min(64,t-last);last=t;if(onScreen.current&&!drag.current)setAngle(a=>(a+dt/1000*360/PERIOD)%360);raf=requestAnimationFrame(tick);};
    raf=requestAnimationFrame(tick);return ()=>{cancelAnimationFrame(raf);io.disconnect();};
  },[]);
  const yaw=angle*Math.PI/180,scale=290/Math.hypot(drum.flangeMm,drum.widthMm);
  const radius=drum.flangeMm/2,barrel=drum.barrelMm/2,width=drum.widthMm;
  const fill=Math.sqrt(barrel*barrel+(Math.max(barrel,radius-drum.clearanceMm)**2-barrel*barrel)*Math.min(100,Math.max(0,fillPct))/100);
  const point=(x:number,y:number,z:number):P=>[330+(x*Math.cos(yaw)+z*Math.sin(yaw))*scale,196+(y*Math.cos(PITCH)-(z*Math.cos(yaw)-x*Math.sin(yaw))*Math.sin(PITCH))*scale];
  const path=(pts:P[],close=false)=>pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')+(close?' Z':'');
  const circle=(x:number,r:number,n=72)=>Array.from({length:n+1},(_,i)=>{const t=i/n*Math.PI*2;return point(x,r*Math.cos(t),r*Math.sin(t));});
  // A cylinder's outline is the convex hull of its two end circles, which stays right from every angle.
  const body=(r:number)=>path(hull([...circle(-width/2,r,48),...circle(width/2,r,48)]),true);
  // The flange nearer the viewer is drawn last, so the painter's order flips as the drum turns.
  const near=Math.sin(yaw)>=0?width/2:-width/2,far=-near;
  const spokes=(x:number,cls:string)=>Array.from({length:8},(_,i)=>{const t=i/8*Math.PI*2;return <path key={`${cls}${i}`} d={path([point(x,barrel*.28*Math.cos(t),barrel*.28*Math.sin(t)),point(x,radius*.9*Math.cos(t),radius*.9*Math.sin(t))])} class={cls}/>;});
  const shadowY=196+radius*scale*Math.cos(PITCH)+18;
  return <div class={`drum-visual ${compact?'compact':''}`}>
    <svg ref={svg} class="drum-svg" viewBox="0 0 660 400" role="img" aria-label={`Cable drum turning slowly, flange ${drum.flangeMm} mm, barrel ${drum.barrelMm} mm, width ${drum.widthMm} mm. Drag to turn it.`}
      onPointerDown={e=>{drag.current={x:e.clientX,a:angle};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(d)setAngle(((d.a+(e.clientX-d.x)*.6)%360+360)%360);}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <defs><radialGradient id={`floor-${compact}`}><stop class="floor-stop" offset="0"/><stop class="floor-stop end" offset="1"/></radialGradient></defs>
      <ellipse cx="330" cy={shadowY} rx={Math.max(width,radius*2)*scale*.62} ry="20" fill={`url(#floor-${compact})`}/>
      <path d={path([point(-width/2-120,0,0),point(width/2+120,0,0)])} class="axis-line"/>
      <path d={path(circle(far,radius),true)} class="flange back"/>
      <path d={path(circle(far,radius*.9),true)} class="ring-line"/>
      {spokes(far,'spoke back')}
      <path d={body(barrel)} class="barrel-surface"/>
      <path d={body(fill)} class="cable-surface"/>
      {Array.from({length:22},(_,i)=><path key={i} d={path(circle(-width/2+width*(i+.5)/22,fill,48))} class="winding-line"/>)}
      <path d={path(circle(near,radius),true)} class="flange front"/>
      <path d={path(circle(near,radius*.9),true)} class="ring-line"/>
      <path d={path(circle(near,barrel*.28),true)} class="hub"/>
      {spokes(near,'spoke')}
    </svg>
    <div class="visual-bottom"><span><i class="legend-dot"/>Flange <i class="legend-dot cable"/>Cable winding</span><span class="drum-dims">Ø {drum.flangeMm} · barrel Ø {drum.barrelMm} · width {drum.widthMm} mm</span><span class="drag-hint">Drag to turn</span></div>
  </div>;
}
