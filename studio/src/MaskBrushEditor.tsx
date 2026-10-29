import {useEffect,useRef,useState} from 'react'
export type MaskStroke={mode:'add'|'erase';radius:number;points:number[][]}
type Props={image:string;mask:string;onCancel:()=>void;onApply:(strokes:MaskStroke[])=>Promise<void>}
/** Original-image brush editor. Coordinates are always full-resolution pixels. */
export default function MaskBrushEditor({image,mask,onCancel,onApply}:Props){
  const canvas=useRef<HTMLCanvasElement>(null)
  const original=useRef<HTMLImageElement|null>(null)
  const buffer=useRef<HTMLCanvasElement|null>(null)
  const basePixels=useRef<ImageData|null>(null)
  const active=useRef<MaskStroke|null>(null)
  const [ready,setReady]=useState(false)
  const [mode,setMode]=useState<'add'|'erase'>('add')
  const [radius,setRadius]=useState(12)
  const [strokes,setStrokes]=useState<MaskStroke[]>([])
  const [redoStrokes,setRedoStrokes]=useState<MaskStroke[]>([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const redraw=()=>{
    const out=canvas.current,base=original.current,layer=buffer.current
    if(!out||!base||!layer)return
    const ctx=out.getContext('2d')
    if(!ctx)return
    ctx.clearRect(0,0,out.width,out.height)
    ctx.drawImage(base,0,0)
    const tinted=document.createElement('canvas')
    tinted.width=layer.width;tinted.height=layer.height
    const paint=tinted.getContext('2d')
    if(!paint)return
    paint.drawImage(layer,0,0)
    paint.globalCompositeOperation='source-in'
    paint.fillStyle='rgba(238,75,60,.60)'
    paint.fillRect(0,0,tinted.width,tinted.height)
    ctx.drawImage(tinted,0,0)
  }
  useEffect(()=>{
    let disposed=false
    setReady(false);setStrokes([]);setRedoStrokes([]);setError('')
    // KWT_EXP_MASK_CORS_BLOB_V1: server images live on :18765 while the Studio
    // WebView typically lives on :1420. Drawing a raw cross-origin <img> taints
    // the canvas, so getImageData() fails even though the image looks normal.
    // Fetch with Studio's allowed header, then decode a same-origin Blob URL.
    const blobUrls:string[]=[]
    const load=async(url:string):Promise<HTMLImageElement>=>{
      const response=await fetch(url,{
        method:'GET',mode:'cors',credentials:'omit',cache:'no-store',
        headers:{'X-KWT-Studio':'1'},
      })
      if(!response.ok)throw new Error(`이미지 요청 실패 (HTTP ${response.status})`)
      const type=response.headers.get('Content-Type')||''
      if(!type.startsWith('image/'))throw new Error('서버가 이미지가 아닌 데이터를 반환했습니다.')
      const blob=await response.blob()
      if(disposed)throw new Error('마스크 편집 화면이 종료되었습니다.')
      const blobUrl=URL.createObjectURL(blob)
      blobUrls.push(blobUrl)
      return new Promise<HTMLImageElement>((resolve,reject)=>{
        const im=new Image()
        im.onload=()=>resolve(im)
        im.onerror=()=>reject(new Error('원본 또는 마스크 이미지 디코딩 실패'))
        im.src=blobUrl
      })
    }
    void Promise.all([load(image),load(mask)]).then(([src,m])=>{
      if(disposed)return
      if(src.naturalWidth!==m.naturalWidth||src.naturalHeight!==m.naturalHeight)throw new Error('마스크와 원본 해상도가 다릅니다.')
      const out=canvas.current
      if(!out)return
      out.width=src.naturalWidth;out.height=src.naturalHeight
      const buf=document.createElement('canvas');buf.width=src.naturalWidth;buf.height=src.naturalHeight
      const ctx=buf.getContext('2d');if(!ctx)return
      ctx.drawImage(m,0,0)
      // Gray mask PNGs have opaque alpha even where pixel value is black.
      // Convert luminance -> alpha before tinting; otherwise the whole page is red.
      const pixels=ctx.getImageData(0,0,buf.width,buf.height)
      for(let i=0;i<pixels.data.length;i+=4){
        const alpha=pixels.data[i]
        pixels.data[i]=255;pixels.data[i+1]=255;pixels.data[i+2]=255;pixels.data[i+3]=alpha
      }
      ctx.putImageData(pixels,0,0)
      basePixels.current=new ImageData(new Uint8ClampedArray(pixels.data),buf.width,buf.height)
      original.current=src;buffer.current=buf
      setReady(true)
    }).catch(e=>{if(!disposed)setError(String(e))})
    return()=>{
      disposed=true
      original.current=null
      buffer.current=null
      basePixels.current=null
      for(const url of blobUrls)URL.revokeObjectURL(url)
    }
  },[image,mask])
  useEffect(()=>{if(ready)redraw()},[ready])
  // EXP_MASK_HISTORY: rebuild from a pristine alpha mask rather than attempting
  // inverse stroke painting. Erasing may reveal old ink; replay is deterministic.
  const replay=(history:MaskStroke[])=>{
    const ctx=buffer.current?.getContext('2d')
    const originalPixels=basePixels.current
    if(!ctx||!originalPixels)return
    ctx.globalCompositeOperation='source-over'
    ctx.putImageData(originalPixels,0,0)
    for(const stroke of history){
      ctx.save()
      ctx.globalCompositeOperation=stroke.mode==='add'?'source-over':'destination-out'
      ctx.strokeStyle='#ffffff';ctx.fillStyle='#ffffff'
      ctx.lineWidth=stroke.radius*2;ctx.lineCap='round';ctx.lineJoin='round'
      const points=stroke.points
      if(points.length>1){
        ctx.beginPath();ctx.moveTo(points[0][0],points[0][1])
        for(const p of points.slice(1))ctx.lineTo(p[0],p[1])
        ctx.stroke()
      }else if(points.length===1){
        ctx.beginPath();ctx.arc(points[0][0],points[0][1],stroke.radius,0,Math.PI*2);ctx.fill()
      }
      ctx.restore()
    }
    redraw()
  }
  const undoMask=()=>{
    if(busy||!strokes.length)return
    const removed=strokes[strokes.length-1],next=strokes.slice(0,-1)
    setStrokes(next);setRedoStrokes(v=>[...v,removed]);replay(next)
  }
  const redoMask=()=>{
    if(busy||!redoStrokes.length)return
    const restored=redoStrokes[redoStrokes.length-1],next=[...strokes,restored]
    setStrokes(next);setRedoStrokes(v=>v.slice(0,-1));replay(next)
  }
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(!(e.ctrlKey||e.metaKey)||busy||!ready)return
      const code=e.key.toLowerCase()
      if(code!=='z'&&code!=='y')return
      e.preventDefault();e.stopImmediatePropagation()
      if(code==='y'||e.shiftKey)redoMask()
      else undoMask()
    }
    window.addEventListener('keydown',key,true)
    return()=>window.removeEventListener('keydown',key,true)
  },[strokes,redoStrokes,busy,ready])
  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    const rect=e.currentTarget.getBoundingClientRect()
    const x=Math.max(0,Math.min(e.currentTarget.width-1,Math.round((e.clientX-rect.left)*e.currentTarget.width/rect.width)))
    const y=Math.max(0,Math.min(e.currentTarget.height-1,Math.round((e.clientY-rect.top)*e.currentTarget.height/rect.height)))
    return [x,y]
  }
  const dot=(p:number[],previous?:number[])=>{
    const ctx=buffer.current?.getContext('2d')
    if(!ctx||!active.current)return
    const size=active.current.radius
    ctx.globalCompositeOperation=active.current.mode==='add'?'source-over':'destination-out'
    ctx.strokeStyle='#ffffff'
    ctx.fillStyle='#ffffff'
    if(previous){ctx.lineWidth=2*size;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(previous[0],previous[1]);ctx.lineTo(p[0],p[1]);ctx.stroke()}
    else{ctx.beginPath();ctx.arc(p[0],p[1],size,0,2*Math.PI);ctx.fill()}
    ctx.globalCompositeOperation='source-over'
    redraw()
  }
  const start=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(!ready||busy||strokes.length>=80)return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p=point(e)
    active.current={mode,radius,points:[p]}
    dot(p)
  }
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(!active.current||busy)return
    const p=point(e),path=active.current.points,prev=path[path.length-1]
    if(p[0]===prev[0]&&p[1]===prev[1])return
    if(path.length>=4000)return
    path.push(p);dot(p,prev)
  }
  const finish=()=>{const completed=active.current;if(completed){active.current=null;setStrokes(v=>[...v,completed]);setRedoStrokes([])}}
  const apply=async()=>{
    if(!strokes.length||busy)return
    setBusy(true);setError('')
    try{await onApply(strokes)}catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  return <div className="canvas-host" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:10,overflow:'auto'}}>
    <div style={{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap'}}>
      <b>원문 제거 마스크</b>
      <button type="button" className={mode==='add'?'primary':'secondary'} onClick={()=>setMode('add')}>추가</button>
      <button type="button" className={mode==='erase'?'primary':'secondary'} onClick={()=>setMode('erase')}>지우개</button>
      <label>브러시 {radius}px <input type="range" min={1} max={80} value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label>
      <button type="button" className="secondary" onClick={undoMask} disabled={!ready||!strokes.length||busy} title="Ctrl+Z">되돌리기</button>
      <button type="button" className="secondary" onClick={redoMask} disabled={!ready||!redoStrokes.length||busy} title="Ctrl+Y">다시 실행</button>
      <button type="button" className="secondary" onClick={onCancel} disabled={busy}>취소</button>
      <button type="button" className="primary" onClick={()=>void apply()} disabled={!ready||!strokes.length||busy}>{busy?'LaMa 부분 복원 중…':`마스크 적용 (${strokes.length}획)`}</button>
    </div>
    <p className="ctl-description">붉은 부분이 지워지는 원문 영역입니다. 추가 부분만 LaMa 재추론, 지운 부분은 원본 픽셀로 복구합니다.</p>
    {error&&<p className="control-alert error" role="alert">{error}</p>}
    <canvas ref={canvas} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} style={{maxWidth:'100%',maxHeight:'calc(100% - 82px)',width:'auto',height:'auto',touchAction:'none',cursor:'crosshair',border:'1px solid #48627d'}}/>
  </div>
}
