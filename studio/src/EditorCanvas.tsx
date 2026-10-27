import {useState,useRef,useEffect,useCallback} from 'react'
import {Stage,Layer,Image as KImage,Text as KText,Rect,Transformer} from 'react-konva'
import Konva from 'konva'
import type {LayerData} from './api'

type Props={image:string;layers:LayerData[];ocr:number[][];selected:string|null;onSelect:(id:string|null)=>void;onUpdate:(id:string,patch:Partial<LayerData>)=>void;showOCR:boolean;editable:boolean;maximize?:boolean} // KWT_CANVAS_MAXFIT_V1_5_1
function useHTMLImage(url:string){
  const [img,setImg]=useState<HTMLImageElement|null>(null)
  useEffect(()=>{if(!url){setImg(null);return}const im=new window.Image();let active=true;im.onload=()=>{if(active)setImg(im)};im.onerror=()=>{if(active)setImg(null)};im.src=url;return()=>{active=false}},[url])
  return img
}
export default function EditorCanvas({image,layers,ocr,selected,onSelect,onUpdate,showOCR,editable,maximize=false}:Props){
  const host=useRef<HTMLDivElement>(null)
  const transformer=useRef<Konva.Transformer>(null)
  const nodeRefs=useRef<Record<string,Konva.Text|null>>({})
  const [bounds,setBounds]=useState({width:700,height:800})
  const [zoom,setZoom]=useState(1)
  const [pan,setPan]=useState({x:0,y:0})
  const [space,setSpace]=useState(false)
  const [mousePan,setMousePan]=useState(false)
  const [dims,setDims]=useState({width:1000,height:1500})
  const pic=useHTMLImage(image)
  useEffect(()=>{if(pic){setDims({width:pic.naturalWidth,height:pic.naturalHeight});setZoom(1);setPan({x:0,y:0})}},[pic])
  useEffect(()=>{if(!host.current)return;const obs=new ResizeObserver(entries=>{const box=entries[0].contentRect;setBounds({width:Math.max(150,box.width),height:Math.max(150,box.height)})});obs.observe(host.current);return()=>obs.disconnect()},[])
  useEffect(()=>{const keydown=(e:KeyboardEvent)=>{if(e.code==='Space'&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName)){e.preventDefault();setSpace(true)}};const keyup=(e:KeyboardEvent)=>{if(e.code==='Space')setSpace(false)};window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup)}},[])
  useEffect(()=>{const node=selected?nodeRefs.current[selected]:null;if(node&&transformer.current&&editable){transformer.current.nodes([node]);transformer.current.getLayer()?.batchDraw()}else{transformer.current?.nodes([])}},[selected,layers,editable])
  const fit=Math.min(bounds.width/dims.width,bounds.height/dims.height)*(maximize?.995:.91)
  const stageScale=fit*zoom
  const origin={x:(bounds.width-dims.width*fit)/2,y:(bounds.height-dims.height*fit)/2}
  const onWheel=useCallback((e:Konva.KonvaEventObject<WheelEvent>)=>{
    e.evt.preventDefault();const stage=e.target.getStage();if(!stage)return
    const pointer=stage.getPointerPosition();if(!pointer)return
    const before={x:(pointer.x-origin.x-pan.x)/stageScale,y:(pointer.y-origin.y-pan.y)/stageScale}
    const next=Math.max(.2,Math.min(8,zoom*(e.evt.deltaY>0?.89:1.12)))
    const newScale=fit*next
    setPan({x:pointer.x-origin.x-before.x*newScale,y:pointer.y-origin.y-before.y*newScale})
    setZoom(next)
  },[zoom,pan,origin.x,origin.y,stageScale,fit])
  return <div className="canvas-host" ref={host} onContextMenu={e=>e.preventDefault()}>
    {!pic&&<div className="empty-overlay">이미지 로딩 중 또는 복원 배경 없음</div>}
    <Stage width={bounds.width} height={bounds.height} x={origin.x+pan.x} y={origin.y+pan.y} scaleX={stageScale} scaleY={stageScale} draggable={space||mousePan}
      onDragEnd={e=>{if(e.target===e.target.getStage())setPan({x:e.target.x()-origin.x,y:e.target.y()-origin.y})}}
      onMouseDown={e=>{if(e.evt.button===1)setMousePan(true);if(e.target===e.target.getStage()||e.target.name()==='background')onSelect(null)}}
      onMouseUp={()=>setMousePan(false)} onWheel={onWheel}>
      <Layer>
        {pic&&<KImage image={pic} width={dims.width} height={dims.height} name="background" listening/>}
        {showOCR&&ocr.map((box,i)=>Array.isArray(box)&&box.length===4?<Rect key={i} x={box[0]} y={box[1]} width={box[2]} height={box[3]} stroke="#ffb86d" strokeWidth={1.3/stageScale} dash={[6/stageScale,4/stageScale]} listening={false}/>:null)}
        {layers.filter(t=>t.visible).map(layer=><KText key={layer.region_id} ref={node=>{nodeRefs.current[layer.region_id]=node}}
          text={layer.text} x={layer.bbox[0]} y={layer.bbox[1]} width={layer.bbox[2]} height={layer.bbox[3]}
          fontFamily="Malgun Gothic, 맑은 고딕, sans-serif" fontSize={layer.font_size} fill={layer.text_color}
          stroke={layer.stroke_width>0?layer.stroke_color:undefined} strokeWidth={layer.stroke_width*2}
          fillAfterStrokeEnabled={true} wrap="char" lineHeight={1.24} align={layer.align} verticalAlign="top"
          padding={Math.min(4,Math.max(1,layer.bbox[2]/20))}
          draggable={editable} onClick={()=>onSelect(layer.region_id)} onTap={()=>onSelect(layer.region_id)}
          onDblClick={()=>{const input=document.getElementById('layer-text') as HTMLTextAreaElement|null;input?.focus();input?.select()}}
          onDragEnd={e=>onUpdate(layer.region_id,{bbox:[Math.round(e.target.x()),Math.round(e.target.y()),...layer.bbox.slice(2)]})}
          onTransformEnd={e=>{const n=e.target;const w=Math.max(12,n.width()*n.scaleX());const h=Math.max(12,n.height()*n.scaleY());n.scaleX(1);n.scaleY(1);onUpdate(layer.region_id,{bbox:[Math.round(n.x()),Math.round(n.y()),Math.round(w),Math.round(h)]})}}
        />)}
        <Transformer ref={transformer} rotateEnabled={false} anchorSize={11/stageScale} borderStroke="#6fceff" anchorStroke="#49bde9" anchorFill="#fff" borderStrokeWidth={1.5/stageScale} keepRatio={false}
           boundBoxFunc={(_old,next)=>next.width<15||next.height<15?_old:next}/>
      </Layer>
    </Stage>
    <div className="canvas-hud"><span>{Math.round(stageScale*100)}%</span><button onClick={()=>{setZoom(1);setPan({x:0,y:0})}}>화면 맞춤</button><span>Space+드래그 이동 · 휠 확대</span></div>
  </div>
}
