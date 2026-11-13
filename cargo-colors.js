export const COLORS=['#3366CC','#DC3912','#FF9900','#109618','#990099','#0099C6','#DD4477','#66AA00','#B82E2E','#316395','#994499','#22AA99','#AAAA11','#6633CC','#E67300','#8B0707','#329262','#5574A6','#3B3EAC','#B77322','#16A653','#B91383','#F26F98','#7A8B37','#0C7187'];
export function cargoColor(item){return COLORS[item.number-1]||`hsl(${(item.number*137.508)%360},62%,43%)`;}
export function cargoInk(item){
 const color=cargoColor(item);if(!color.startsWith('#'))return '#ffffff';
 const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>.179?'#000000':'#ffffff';
}
