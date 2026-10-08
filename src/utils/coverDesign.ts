import { Prisma } from '@prisma/client';

// Only supported drawing primitives and embedded raster images enter a snapshot.
const COLORS=/^#[0-9a-f]{6}$/i;
const FONTS=['serif','sans','classic','hindi-serif','hindi-sans'];
const ICONS=['star','heart','leaf','book','sun'];
function fail(message:string):never{throw new Error(message);}
function number(v:unknown,min:number,max:number,label:string):number{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(`Invalid ${label}`);return v;}
function color(v:unknown):string{if(typeof v!=='string'||!COLORS.test(v))fail('Use a six-digit hex colour');return v;}
export function validateCoverDesign(input:any):Prisma.InputJsonObject{
  if(!input||input.version!==1)fail('Unsupported cover design');
  if(JSON.stringify(input).length>4_500_000)fail('The cover design is too large. Use smaller images.');
  const width=number(input.width,100,2000,'canvas width'),height=number(input.height,100,3000,'canvas height');
  const output:any={version:1,width,height};
  for(const side of ['front','back']){
    const panel=input[side];if(!panel||!Array.isArray(panel.elements)||panel.elements.length>40)fail('Use up to 40 layers per cover');
    const ids=new Set<string>();
    const elements=panel.elements.map((e:any)=>{
      if(!e||typeof e.id!=='string'||!e.id.length||e.id.length>80||ids.has(e.id))fail('Invalid layer identifier');ids.add(e.id);
      if(!['text','image','shape','icon'].includes(e.type))fail('Unsupported cover layer');
      const layer:any={id:e.id,type:e.type,x:number(e.x,0,width,'layer position'),y:number(e.y,0,height,'layer position'),w:number(e.w,1,width,'layer width'),h:number(e.h,1,height,'layer height'),rotation:number(e.rotation,-180,180,'rotation'),opacity:number(e.opacity,0,1,'opacity')};
      if(layer.x+layer.w>width+.1||layer.y+layer.h>height+.1)fail('Keep layer boxes inside the cover');
      if(e.type==='text'){
        if(typeof e.text!=='string'||e.text.length>3000)fail('Cover text must be at most 3,000 characters per layer');
        if(!FONTS.includes(e.font)||!['left','center','right'].includes(e.align)||typeof e.bold!=='boolean'||typeof e.italic!=='boolean')fail('Invalid text style');
        Object.assign(layer,{text:e.text,font:e.font,fontSize:number(e.fontSize,8,160,'font size'),bold:e.bold,italic:e.italic,align:e.align,color:color(e.color)});
      }else if(e.type==='image'){
        if(typeof e.src!=='string'||e.src.length>2_200_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(e.src))fail('Use a PNG, JPG or WebP image under 1.6 MB after resizing');
        const bytes=Buffer.from(e.src.split(',')[1],'base64');
        const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
        const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
        if(!(e.src.startsWith('data:image/png;')&&png||e.src.startsWith('data:image/jpeg;')&&jpeg||e.src.startsWith('data:image/webp;')&&webp))fail('Invalid image data');
        layer.src=e.src;
      }else if(e.type==='icon'){if(!ICONS.includes(e.icon))fail('Unsupported icon');Object.assign(layer,{icon:e.icon,color:color(e.color)});}
      else{if(!['rectangle','ellipse'].includes(e.shape))fail('Unsupported shape');Object.assign(layer,{shape:e.shape,color:color(e.color)});}
      return layer;
    });
    output[side]={background:color(panel.background),elements};
  }
  if(!output.front.elements.some((e:any)=>e.type==='image'||e.type==='text'&&e.text.trim()))fail('Add a title or image to the front cover before saving');
  return output;
}

export function coverMatchesTrim(cover:any, print:any):boolean {
  const sizes:Record<string,number[]>={FIVE_X_EIGHT:[5,8],FIVE_HALF_X_EIGHT_HALF:[5.5,8.5],SIX_X_NINE:[6,9],EIGHT_HALF_X_EIGHT_HALF:[8.5,8.5],EIGHT_HALF_X_ELEVEN:[8.5,11]};
  const [w,h]=print?.size==='CUSTOM'?[Number(print.customWidthIn),Number(print.customHeightIn)]:(sizes[print?.size]||[5,8]);
  return Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0&&Math.abs(cover.height/cover.width-h/w)<1/cover.width+.00001;
}
