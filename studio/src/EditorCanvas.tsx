import {Fragment,useState,useRef,useEffect,useCallback} from 'react'
import {Stage,Layer,Image as KImage,Text as KText,Rect,Circle,Transformer} from 'react-konva'
import Konva from 'konva'
import type {LayerData} from './api'
const normalizedAngle=(value:number)=>((value+180)%360+360)%360-180
const snappedAngle=(value:number)=>{
  const a=normalizedAngle(value)
  const stops=[-180,-135,-90,-45,0,45,90,135,180]
  const target=stops.find(s=>Math.abs(a-s)<=4)
  return target===undefined?Math.round(a*10)/10:target
}
const stripRich=(s:string)=>s.replace(/\*\*/g,'').replace(/\[\[color:#[0-9a-fA-F]{6}\]\]|\[\[\/color\]\]/g,'')
type Props={
 image:string;renderedImage?:string;proofBusy?:boolean;layers:LayerData[];ocr:number[][];
 selected:string|null;onSelect:(id:string|null)=>void;
 onUpdate:(id:string,patch:Partial<LayerData>)=>void;
 showOCR:boolean;editable:boolean;maximize?:boolean;fontVersion?:number
}
function useHTMLImage(url:string){
  const [img,setImg]=useState<HTMLImageElement|null>(null)
  useEffect(()=>{
    if(!url){setImg(null);return}
    const im=new window.Image();let active=true
    im.onload=()=>{if(active)setImg(im)}
    im.onerror=()=>{if(active)setImg(null)}
    im.src=url
    return()=>{active=false}
  },[url])
  return img
}
export default function EditorCanvas({image,renderedImage='',proofBusy=false,layers,ocr,selected,onSelect,onUpdate,showOCR,editable,maximize=false,fontVersion=0}:Props){
  const host=useRef<HTMLDivElement>(null)
  const transformer=useRef<Konva.Transformer>(null)
  const nodeRefs=useRef<Record<string,Konva.Rect|null>>({})
  const [bounds,setBounds]=useState({width:700,height:800})
  const [zoom,setZoom]=useState(1)
  const [pan,setPan]=useState({x:0,y:0})
  const [space,setSpace]=useState(false)
  const [mousePan,setMousePan]=useState(false)
  const [dims,setDims]=useState({width:1000,height:1500})
  const [dragged,setDragged]=useState<{id:string;x:number;y:number}|null>(null)
  const [rotating,setRotating]=useState<{id:string;angle:number}|null>(null)
  const pic=useHTMLImage(image)
  const proofPic=useHTMLImage(renderedImage)
  useEffect(()=>{if(pic){setDims({width:pic.naturalWidth,height:pic.naturalHeight});setZoom(1);setPan({x:0,y:0})}},[pic])
  useEffect(()=>{if(!host.current)return;const obs=new ResizeObserver(entries=>{const box=entries[0].contentRect;setBounds({width:Math.max(150,box.width),height:Math.max(150,box.height)})});obs.observe(host.current);return()=>obs.disconnect()},[])
  useEffect(()=>{
    const keydown=(e:KeyboardEvent)=>{if(e.code==='Space'&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName)){e.preventDefault();setSpace(true)}}
    const keyup=(e:KeyboardEvent)=>{if(e.code==='Space')setSpace(false)}
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup)
    return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup)}
  },[])
  useEffect(()=>{
    const node=selected?nodeRefs.current[selected]:null
    if(node&&transformer.current&&editable){
      transformer.current.nodes([node]);transformer.current.getLayer()?.batchDraw()
    }else transformer.current?.nodes([])
  },[selected,layers,editable])
  const fit=Math.min(bounds.width/dims.width,bounds.height/dims.height)*(maximize?.995:.91)
  const stageScale=fit*zoom
  const origin={x:(bounds.width-dims.width*fit)/2,y:(bounds.height-dims.height*fit)/2}
  const onWheel=useCallback((e:Konva.KonvaEventObject<WheelEvent>)=>{
    e.evt.preventDefault()
    const stage=e.target.getStage(),pointer=stage?.getPointerPosition()
    if(!pointer)return
    const before={x:(pointer.x-origin.x-pan.x)/stageScale,y:(pointer.y-origin.y-pan.y)/stageScale}
    const next=Math.max(.2,Math.min(8,zoom*(e.evt.deltaY>0?.89:1.12)))
    const nextScale=fit*next
    setPan({x:pointer.x-origin.x-before.x*nextScale,y:pointer.y-origin.y-before.y*nextScale})
    setZoom(next)
  },[zoom,pan,origin.x,origin.y,stageScale,fit])
  const background=proofPic||pic
  return <div className="canvas-host" ref={host} onContextMenu={e=>e.preventDefault()}>
    {!background&&<div className="empty-overlay">이미지 로딩 중 또는 복원 배경 없음</div>}
    <Stage width={bounds.width} height={bounds.height} x={origin.x+pan.x} y={origin.y+pan.y}
      scaleX={stageScale} scaleY={stageScale} draggable={space||mousePan}
      onDragEnd={e=>{if(e.target===e.target.getStage())setPan({x:e.target.x()-origin.x,y:e.target.y()-origin.y})}}
      onMouseDown={e=>{if(e.evt.button===1)setMousePan(true);if(e.target===e.target.getStage()||e.target.name()==='background')onSelect(null)}}
      onMouseUp={()=>setMousePan(false)} onWheel={onWheel}>
      <Layer>
        {background&&<KImage image={background} width={dims.width} height={dims.height} name="background" listening/>}
        {showOCR&&ocr.map((box,i)=>Array.isArray(box)&&box.length===4?
          <Rect key={i} x={box[0]} y={box[1]} width={box[2]} height={box[3]}
            stroke="#ffb86d" strokeWidth={1.3/stageScale} dash={[6/stageScale,4/stageScale]} listening={false}/>:null)}
        {layers.filter(l=>l.visible).map(layer=>{
          const rid=layer.region_id
          const moving=dragged?.id===rid
          const rotatingThis=rotating?.id===rid
          const bx=moving?dragged.x:layer.bbox[0]
          const by=moving?dragged.y:layer.bbox[1]
          const w=layer.bbox[2],h=layer.bbox[3]
          const centerX=bx+w/2,centerY=by+h/2
          const angle=rotatingThis?rotating.angle:Number(layer.rotation||0)
          const visibleText=!proofPic||moving||rotatingThis||layer.pillow_sync===false
          // The grip sits just beyond the top-right corner, not over the text.
          const gap=12/stageScale
          const dx=w/2+gap,dy=-h/2-gap
          const radians=angle*Math.PI/180
          const gripX=centerX+dx*Math.cos(radians)-dy*Math.sin(radians)
          const gripY=centerY+dx*Math.sin(radians)+dy*Math.cos(radians)
          const angleFromPoint=(px:number,py:number)=>
            snappedAngle((Math.atan2(py-centerY,px-centerX)-Math.atan2(dy,dx))*180/Math.PI)
          return <Fragment key={rid}>
            {visibleText&&<KText key={fontVersion} text={layer.rich_enabled?stripRich(layer.text):layer.text}
              x={centerX} y={centerY} offsetX={w/2} offsetY={h/2} rotation={angle}
              width={w} height={h}
              fontFamily={layer.font_id&&layer.font_id!=='system'?`KWTFont_${layer.font_id}`:'Malgun Gothic, 맑은 고딕, sans-serif'}
              fontSize={layer.font_size} fill={layer.text_color}
              stroke={layer.stroke_width>0?layer.stroke_color:undefined}
              strokeWidth={layer.stroke_width*2} fillAfterStrokeEnabled
              wrap={layer.pillow_sync===false?'none':'char'} lineHeight={1.24}
              align={layer.align} verticalAlign="top"
              padding={Math.min(4,Math.max(1,w/20))}
              opacity={proofPic&&layer.pillow_sync!==false?0.75:1} listening={false}/>}
            <Rect ref={node=>{nodeRefs.current[rid]=node}}
              x={layer.bbox[0]+w/2} y={layer.bbox[1]+h/2}
              offsetX={w/2} offsetY={h/2} width={w} height={h}
              rotation={angle}
              fill="rgba(64,190,236,0.005)" stroke={selected===rid?'#45caff':undefined}
              strokeWidth={selected===rid?1/stageScale:0}
              draggable={editable&&!space}
              onClick={()=>onSelect(rid)} onTap={()=>onSelect(rid)}
              onDblClick={()=>{const input=document.getElementById('layer-text') as HTMLTextAreaElement|null;input?.focus();input?.select()}}
              onDragStart={e=>setDragged({id:rid,x:e.target.x()-w/2,y:e.target.y()-h/2})}
              onDragMove={e=>setDragged({id:rid,x:e.target.x()-w/2,y:e.target.y()-h/2})}
              onDragEnd={e=>{
                const bbox=[Math.round(e.target.x()-w/2),Math.round(e.target.y()-h/2),w,h]
                setDragged(null)
                onUpdate(rid,{bbox,pillow_sync:false,shape_fit:false,auto_fit:false})
              }}
              onTransformEnd={e=>{
                const n=e.target
                const nextW=Math.max(12,n.width()*n.scaleX())
                const nextH=Math.max(12,n.height()*n.scaleY())
                const nextAngle=snappedAngle(n.rotation())
                n.scaleX(1);n.scaleY(1)
                n.width(nextW);n.height(nextH)
                n.offsetX(nextW/2);n.offsetY(nextH/2)
                onUpdate(rid,{bbox:[Math.round(n.x()-nextW/2),Math.round(n.y()-nextH/2),
                  Math.round(nextW),Math.round(nextH)],
                  rotation:nextAngle,pillow_sync:false,shape_fit:false,auto_fit:false})
              }}/>
            {selected===rid&&editable&&!space&&<Circle
              x={gripX} y={gripY} radius={5.5/stageScale}
              fill="#d7f5ff" stroke="#238cc9" strokeWidth={1.2/stageScale}
              draggable hitStrokeWidth={13/stageScale}
              onDragStart={()=>onSelect(rid)}
              onDragMove={e=>{
                const next=angleFromPoint(e.target.x(),e.target.y())
                setRotating({id:rid,angle:next})
                const rad=next*Math.PI/180
                e.target.position({x:centerX+dx*Math.cos(rad)-dy*Math.sin(rad),
                  y:centerY+dx*Math.sin(rad)+dy*Math.cos(rad)})
              }}
              onDragEnd={e=>{
                const next=angleFromPoint(e.target.x(),e.target.y())
                setRotating(null)
                onUpdate(rid,{rotation:next,pillow_sync:false,shape_fit:false,auto_fit:false})
              }}/>}
          </Fragment>
        })}
        <Transformer ref={transformer} rotateEnabled={true} anchorSize={6/stageScale}
          rotateAnchorOffset={23/stageScale} rotationSnaps={[0,45,90,135,180,-45,-90,-135,-180]}
          rotationSnapTolerance={5}
          borderStroke="#6fceff" anchorStroke="#49bde9" anchorFill="#fff" borderStrokeWidth={1.5/stageScale}
          keepRatio={false} boundBoxFunc={(_old,next)=>next.width<15||next.height<15?_old:next}/>
      </Layer>
    </Stage>
    <div className="canvas-hud"><span>{Math.round(stageScale*100)}%</span>
      <button onClick={()=>{setZoom(1);setPan({x:0,y:0})}}>화면 맞춤</button>
      <span>{proofPic?(proofBusy?'Pillow 갱신 중…':'Pillow 자동 배치 영역 표시'):'수동 편집 표시'}</span>
      <span>Space+드래그 이동 · 휠 확대 · 우측 상단 원형점 회전</span>
    </div>
  </div>
}
