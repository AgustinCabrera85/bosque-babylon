/* Exact squared Euclidean distance transform (Felzenszwalb/Huttenlocher).
   Produces a signed field in RED: 0.5 = glyph boundary; >0.5 = ink,
   <0.5 = outside. The low-resolution field is recomputed only when text
   content or typewriter reveal changes, never on every rendered frame. */
const INF = 1e9;
function edt1d(input, length, output, sites, edges) {
  let count=0;
  sites[0]=0;edges[0]=-INF;edges[1]=INF;
  for(let i=1;i<length;i++){
    let s=0;
    while(true){
      const previous=sites[count];
      s=((input[i]+i*i)-(input[previous]+previous*previous))/(2*(i-previous));
      if(s>edges[count] || count===0)break;
      count--;
    }
    if(s<=edges[0] && count===0)s=-INF;
    count++;sites[count]=i;edges[count]=s;edges[count+1]=INF;
  }
  count=0;
  for(let i=0;i<length;i++){
    while(edges[count+1]<i)count++;
    const delta=i-sites[count];
    output[i]=delta*delta+input[sites[count]];
  }
}
function distanceMap(bits, width, height, featureValue){
  const tmp=new Float32Array(width*height), out=new Float32Array(width*height);
  const n=Math.max(width,height);
  const src=new Float32Array(n), dest=new Float32Array(n);
  const sites=new Int32Array(n), edges=new Float32Array(n+1);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++)src[x]=bits[y*width+x]===featureValue?0:INF;
    edt1d(src,width,dest,sites,edges);
    for(let x=0;x<width;x++)tmp[y*width+x]=dest[x];
  }
  for(let x=0;x<width;x++){
    for(let y=0;y<height;y++)src[y]=tmp[y*width+x];
    edt1d(src,height,dest,sites,edges);
    for(let y=0;y<height;y++)out[y*width+x]=dest[y];
  }
  return out;
}
export function createSignedInkField(rgba,width,height,range=22){
  if(!rgba || rgba.length<width*height*4 || width<1 || height<1) throw Error('Máscara inválida para campo de tinta');
  const bits=new Uint8Array(width*height);
  let inkCount=0;
  for(let i=0;i<bits.length;i++){bits[i]=rgba[i*4]>126?1:0;inkCount+=bits[i];}
  const result=new Uint8ClampedArray(width*height*4);
  if(!inkCount||inkCount===bits.length){
    const constant=inkCount?255:0;
    for(let i=0;i<bits.length;i++){const k=i*4;result[k]=result[k+1]=result[k+2]=constant;result[k+3]=255;}
    return result;
  }
  const insideDist=distanceMap(bits,width,height,0);
  const outsideDist=distanceMap(bits,width,height,1);
  const scale=127.5/Math.max(1,range);
  for(let i=0;i<bits.length;i++){
    // Half-pixel compensates for binary glyph boundary and preserves thin strokes.
    const signed=(bits[i]?Math.sqrt(insideDist[i])-.5:-(Math.sqrt(outsideDist[i])-.5));
    const n=Math.max(0,Math.min(255,Math.round(127.5+signed*scale)));
    const j=i*4;result[j]=result[j+1]=result[j+2]=n;result[j+3]=255;
  }
  return result;
}
