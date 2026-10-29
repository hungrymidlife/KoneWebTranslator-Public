import {useEffect,useMemo,useRef,useState} from 'react'
import {BASE} from './api'
type ProofState={pageKey:string;url:string}
export function usePillowProof(projectId:string|null,index:number,edits:unknown[],version:number,enabled:boolean,excludedIds:string[]=[]){
  const [state,setState]=useState<ProofState>({pageKey:'',url:''})
  const [loading,setLoading]=useState(false)
  const currentUrl=useRef('')
  const changes=JSON.stringify(edits)
  const stable=useMemo(()=>changes,[changes])
  const pageKey=projectId?`${projectId}:${index}`:''
  const excludedKey=JSON.stringify(excludedIds)
  const requestKey=JSON.stringify([pageKey,version,stable,excludedKey])
  useEffect(()=>{
    return()=>{if(currentUrl.current)URL.revokeObjectURL(currentUrl.current)}
  },[])
  useEffect(()=>{
    if(!enabled||!projectId){setLoading(false);return}
    let stopped=false
    const controller=new AbortController()
    setLoading(true)
    const timer=window.setTimeout(async()=>{
      try{
        const response=await fetch(BASE+'/api/experiment/preview',{
          method:'POST',signal:controller.signal,cache:'no-store',
          headers:{'Content-Type':'application/json','X-KWT-Studio':'1'},
          body:JSON.stringify({id:projectId,index,edits:JSON.parse(stable),exclude_region_ids:JSON.parse(excludedKey)})
        })
        if(!response.ok){
          const error=await response.json().catch(()=>({error:`HTTP ${response.status}`}))
          throw new Error(error.error||'Pillow preview error')
        }
        const objectUrl=URL.createObjectURL(await response.blob())
        if(stopped){URL.revokeObjectURL(objectUrl);return}
        if(currentUrl.current)URL.revokeObjectURL(currentUrl.current)
        currentUrl.current=objectUrl
        setState({pageKey:requestKey,url:objectUrl})
      }catch(error){
        if(!stopped&&!(error instanceof DOMException&&error.name==='AbortError'))
          console.warn('[Pillow live preview] Konva fallback:',error)
      }finally{if(!stopped)setLoading(false)}
    },420)
    return()=>{stopped=true;window.clearTimeout(timer);controller.abort()}
  },[projectId,index,stable,version,enabled,pageKey,excludedKey,requestKey])
  return {url:enabled&&state.pageKey===requestKey?state.url:'',loading}
}
