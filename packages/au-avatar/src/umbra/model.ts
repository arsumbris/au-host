import { ORB, FEATHER } from '../../../au-host-launcher/src/design/Launcher/orb';
// The procedural model approximates the brand raster; the residual texture preserves
// the logo's neutral appearance.
const vec = (v: number[]) => `vec${v.length}(${v.map(x => Number.isInteger(x) ? `${x}.0` : x).join(',')})`;
const color = (v: number[]) => `${vec(v)} / 255.0`;
export const modelSource = `float coverage(vec2 p,vec2 c,float r,float f){return 1.-smoothstep(r-f,r+f,length(p-c));}
vec3 model(vec2 p,float f,float glow){
 float s=dot(p,vec2(.70710678));
 vec3 c=${color(ORB.base)};
 ${ORB.bands.map(b => `c=mix(c,mix(${color(b.from)},${color(b.to)},clamp((s-${b.s0})/${b.s1 - b.s0},0.,1.)),coverage(p,${vec(b.c)},${b.r},f));`).join('\n')}
 c=mix(c,mix(${color(ORB.cap.from)},${color(ORB.cap.to)},clamp(length(p-${vec(ORB.cap.hot)})/${ORB.cap.gr},0.,1.)),coverage(p,${vec(ORB.cap.c)},${ORB.cap.r},f));
 float d=length(p);vec3 background=vec3(exp(-pow(max(d-.8,0.)*2.3,2.))*.36*glow);
 return mix(background,c,1.-smoothstep(.998,1.003,d));
}
`;
export { FEATHER };
