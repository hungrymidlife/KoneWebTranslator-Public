export const BASE = 'http://127.0.0.1:18765'
export type Project = {id:string;source:string;source_name:string;result:string;state:string;detail:string;completed:number;total:number;error:string|null}
export type LayerData = {region_id:string;ocr_bbox:number[];bbox:number[];source_text:string;text:string;font_size:number;font_id?:string;text_color:string;stroke_color:string;stroke_width:number;align:'left'|'center'|'right';visible:boolean;edited:boolean}
// KWT_STUDIO_FONTS_V1_7_0
export type FontRecord = {id:string;name:string;family:string;style:string;source_name:string;built_in:boolean;extension:string}
export type FontLibrary = {default_id:string;fonts:FontRecord[]}
export const fontPreviewUrl=(id:string)=>`${BASE}/api/fonts/preview?id=${encodeURIComponent(id)}`
export const fontFileUrl=(id:string)=>`${BASE}/api/fonts/file?id=${encodeURIComponent(id)}`
export type PageData = {name:string;index:number;total:number;record:Record<string,unknown>;layers:LayerData[];ocr:number[][];editable:boolean;ready:boolean;state:string}
export type PageList = {index:number;name:string;ready:boolean;edited:boolean}[]
export type ZipItem = {path:string;name:string;processed:boolean}

export async function api<T>(path:string, body?:unknown):Promise<T>{
  const res=await fetch(BASE+path,body===undefined?((path.startsWith('/api/manager/')||path.startsWith('/api/extension/')||path.startsWith('/api/fonts'))?{headers:{'X-KWT-Studio':'1'}}:{}):{method:'POST',headers:{'Content-Type':'application/json','X-KWT-Studio':'1'},body:JSON.stringify(body)})
  const type=res.headers.get('Content-Type')||''
  const data=type.includes('application/json')?await res.json():await res.text()
  if(!res.ok)throw new Error((data&&data.error)||`HTTP ${res.status}`)
  return data as T
}
export function imageUrl(id:string,index:number,kind:'source'|'result'|'clean',thumb=false,version=0){
  return `${BASE}/api/image?id=${encodeURIComponent(id)}&index=${index}&kind=${kind}&thumb=${thumb?'1':'0'}&v=${version}`
}
