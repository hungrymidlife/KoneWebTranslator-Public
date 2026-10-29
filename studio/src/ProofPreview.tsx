import {useEffect,useMemo,useState} from 'react'
import {BASE} from './api'
type Props={projectId:string;index:number;edits:unknown[];version:number}
/** Uses Project.render_image, the exact same Pillow renderer as ZIP save. */
export default function ProofPreview({projectId,index,edits,version}:Props){
  const [url,setUrl]=useState('')
  const [error,setError]=useState('')
  const [working,setWorking]=useState(false)
  const serialized=JSON.stringify(edits)
  const request=useMemo(()=>serialized,[serialized])
  useEffect(()=>{
    let disposed=false
    setWorking(true);setError('')
    const timer=window.setTimeout(async()=>{
      try{
        const r=await fetch(BASE+'/api/experiment/preview',{
          method:'POST',headers:{'Content-Type':'application/json','X-KWT-Studio':'1'},
          body:JSON.stringify({id:projectId,index,edits:JSON.parse(request)})
        })
        if(!r.ok){const err=await r.json().catch(()=>({error:'HTTP '+r.status}));throw new Error(err.error||err.detail||'HTTP '+r.status)}
        const imageUrl=URL.createObjectURL(await r.blob())
        if(disposed){URL.revokeObjectURL(imageUrl);return}
        setUrl(old=>{if(old)URL.revokeObjectURL(old);return imageUrl})
      }catch(e){if(!disposed)setError(e instanceof Error?e.message:String(e))}
      finally{if(!disposed)setWorking(false)}
    },250)
    return()=>{disposed=true;window.clearTimeout(timer)}
  },[projectId,index,request,version])
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url])
  return <div className="reference-image" style={{position:'relative',flex:1,minHeight:0}}>
    {url?<img src={url} alt="Pillow 렌더러 최종 저장 미리보기" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>:<div className="empty-layer">정확한 저장 미리보기 준비 중</div>}
    {working&&<span className="label-muted" style={{position:'absolute',top:8,left:8,background:'#10131adc',padding:7}}>Pillow 렌더링 중…</span>}
    {error&&<div className="control-alert error" role="alert">{error}</div>}
  </div>
}
