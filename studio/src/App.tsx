import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom' // KWT_FOCUS_DIALOG_PORTAL_V1
import {motion,AnimatePresence} from 'motion/react'
import {Undo2,Redo2,FolderOpen,Play,ChevronLeft,ChevronRight,Save,Layers3,Eye,EyeOff,RefreshCw,Check,AlertCircle,Maximize2,Archive,Minus,Square,X,PanelLeftClose,PanelLeftOpen,Search,Clock,Image as ImageIcon,Puzzle} from 'lucide-react'
import EditorCanvas from './EditorCanvas'
import EditorToolbar from './EditorToolbar' // KWT_EDITOR_TOOLBAR_V2
import ProofPreview from './ProofPreview'
import {usePillowProof} from './usePillowProof' // KWT_EXP_EDITOR_RENDER_V2
import MaskBrushEditor, {type MaskStroke} from './MaskBrushEditor' // EXP_MANGA_V2_MASK // EXP_MANGA_V2_EXACT_PREVIEW
import ControlCenter,{StatusDots,useEngineStatus,type StudioSection} from './ControlCenter'
import type {SettingsGroup} from './UnifiedSettingsTree' // KWT_UNIFIED_NAV_TREE_V1_1
import ExtensionCenter from './ExtensionCenter'
import FontManager from './FontManager'
import SetupCenter from './SetupCenter'
import ChatCenter from './ChatCenter' // KWT_LOCAL_CHAT_V2_2_0
// KWT_STUDIO_INSTALLER_V2_0_0
import {LayoutDashboard,Server,Terminal,Settings2,Menu,Type,Download,MessageCircle} from 'lucide-react' // KWT_UNIFIED_STABILITY_V1_6
import {BASE,api,imageUrl,fontFileUrl,type FontLibrary,type Project,type PageData,type PageList,type LayerData,type ZipItem} from './api'

// KWT_STUDIO_LAYER_CRUD_V1_6_1
type KwtLayerEdit = LayerData | {region_id:string;deleted:true}
// KWT_SHAPE_FONT_V1: font IDs reference the existing Studio font library.
type ShapeClass='round_bubble'|'rect_box'|'no_bubble'|'unknown'
type ShapeFontPolicy={
  shape_font_policy_enabled:boolean
  font_id_round_bubble:string;font_id_rect_box:string
  font_id_no_bubble:string;font_id_unknown:string
}
const SHAPE_NAMES:Record<ShapeClass,string>={
  round_bubble:'둥근 말풍선',rect_box:'사각형·내레이션',
  no_bubble:'말풍선 없음',unknown:'판정 불확실'
}
const SHAPE_TYPES:ShapeClass[]=['round_bubble','rect_box','no_bubble','unknown']
const SHAPE_DEFAULTS:ShapeFontPolicy={
  shape_font_policy_enabled:true,font_id_round_bubble:'default',
  font_id_rect_box:'default',font_id_no_bubble:'default',font_id_unknown:'default'
}

// KWT_STUDIO_PREFERENCES_V1_6 - local UI preferences, separate from project edits.
const PREF_KEY = 'kwt-studio-ui-v1.6'
const prefs = (() => {
  try {
    const parsed:unknown = JSON.parse(window.localStorage.getItem(PREF_KEY) || '{}')
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {}
  } catch { return {} as Record<string,unknown> }
})()
const strPref=(key:string, fallback:string)=>typeof prefs[key]==='string' ? prefs[key] as string : fallback
const boolPref=(key:string, fallback:boolean)=>typeof prefs[key]==='boolean' ? prefs[key] as boolean : fallback
const viewPref=(): 'split'|'edit'|'source' => {
  const v=prefs['view']; return v==='edit'||v==='source'||v==='split' ? v : 'split'
}
function persistPrefs(delta:Record<string,unknown>) {
  // Merge rather than overwrite: Editor, Manager and other Studio views share this key.
  try {
    const current=JSON.parse(window.localStorage.getItem(PREF_KEY)||'{}')
    const saved=current&&typeof current==='object'&&!Array.isArray(current)?current:{}
    window.localStorage.setItem(PREF_KEY,JSON.stringify({...saved,...delta}))
  } catch {/* Storage may be disabled; the app must remain usable. */}
}

export default function App(){
  // KWT_EDITOR_FOCUS_SHUTDOWN_V1_5_1
  // Use native Tauri close requests; pagehide alone is unreliable in WebView2.
  const workspaceRef=useRef<HTMLDivElement>(null)
  const wasWorkspaceFullscreen=useRef(false)

  // KWT_GUI_LIFECYCLE_V1_4_0: one lease per window; stable across React StrictMode effect remounts.
  const guiSessionId = useRef<string>(`${(window as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__?'desktop':'web'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)
  const guiClosing=useRef(false)
  useEffect(()=>{
    const id = guiSessionId.current
    const endpoint = 'http://127.0.0.1:18765/api/manager/gui-session'
    const send = (action:'touch'|'close',keepalive=false)=>{
      if(action==='touch'&&guiClosing.current)return
      void fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','X-KWT-Studio':'1'},
        body:JSON.stringify({action,session_id:id}),
        keepalive,
      }).catch(()=>{})
    }
    send('touch')
    const timer=window.setInterval(()=>send('touch'),6000)
    const onPageHide=()=>send('close',true)
    window.addEventListener('pagehide',onPageHide)
    return ()=>{
      window.clearInterval(timer)
      window.removeEventListener('pagehide',onPageHide)
      // Do not send close on React cleanup: StrictMode remounts effects in development.
    }
  },[])


  // Native close requested: notify Bridge before destroying the desktop window.
  // Explicit close is faster and more reliable than waiting for pagehide/timeout.
  useEffect(()=>{
    let disposed=false
    let unlisten:(()=>void)|undefined
    void import('@tauri-apps/api/core').then(async core=>{
      if(!core.isTauri())return
      const {getCurrentWindow}=await import('@tauri-apps/api/window')
      const win=getCurrentWindow()
      const dispose=await win.onCloseRequested(event=>{
        event.preventDefault()
        guiClosing.current=true
        void (async()=>{
          try{
            await fetch('http://127.0.0.1:18765/api/manager/gui-session',{
              method:'POST',
              headers:{'Content-Type':'application/json','X-KWT-Studio':'1'},
              body:JSON.stringify({action:'close',session_id:guiSessionId.current}),
              keepalive:true,
              signal:AbortSignal.timeout(2200),
            })
          }catch{/* BAT fallback will also notify Bridge on desktop exit. */}
          finally{void win.destroy().catch(()=>{})}
        })()
      })
      if(disposed)dispose()
      else unlisten=dispose
    }).catch(()=>{})
    return()=>{disposed=true;unlisten?.()}
  },[])

  const [connected,setConnected]=useState(false)
  const [section,setSection]=useState<StudioSection>(()=>{
    const last=strPref('section','editor')
    return (last==='ocr'||last==='translation'?'settings':last) as StudioSection
  })
  const [navExpanded,setNavExpanded]=useState(()=>boolPref('navExpanded',true))
  // KWT_UNIFIED_NAV_TREE_V1_1: left navigation tree state (UI-only preferences).
  const [settingsGroup,setSettingsGroup]=useState<SettingsGroup>(()=>{
    const previous=strPref('section','')
    const stored=strPref('settingsGroup',previous==='ocr'||previous==='translation'?previous:'overview')
    return (['overview','gemma','pipeline','ocr','translation','chat','typesetting'] as string[]).includes(stored)
      ? stored as SettingsGroup : 'overview'
  })
  const [settingsTreeOpen,setSettingsTreeOpen]=useState(()=>boolPref('settingsTreeOpen',true))
  useEffect(()=>persistPrefs({settingsGroup,settingsTreeOpen}),[settingsGroup,settingsTreeOpen])
  const {status:engineStatus,refresh:refreshEngineStatus}=useEngineStatus()
  const [root,setRoot]=useState(()=>strPref('root',''))
  const [output,setOutput]=useState(()=>strPref('output',''))
  const [recursive,setRecursive]=useState(()=>boolPref('recursive',false))
  const [zips,setZips]=useState<ZipItem[]>([])
  const [selectedZips,setSelectedZips]=useState<string[]>([])
  // KWT_REVIEW_CLEANUP_V1_9_2
  const [reviewKeepOriginal,setReviewKeepOriginal]=useState(true)
  const [reviewPreview,setReviewPreview]=useState<{items:{source:string;result:string;remove:string[]}[];errors:{source:string;error:string}[]}|null>(null)
  const [reviewBusy,setReviewBusy]=useState(false)
  const [projects,setProjects]=useState<Project[]>([])
  const [active,setActive]=useState<string|null>(null)
  const [pages,setPages]=useState<PageList>([])
  const [index,setIndex]=useState(0)
  const [page,setPage]=useState<PageData|null>(null)
  const [layers,setLayers]=useState<LayerData[]>([])
  const [selected,setSelected]=useState<string|null>(null)
  // KWT_STUDIO_FONTS_V1_7_0: library + registered browser font faces.
  const [fontLibrary,setFontLibrary]=useState<FontLibrary>({default_id:'system',fonts:[]})
  const [fontVersion,setFontVersion]=useState(0)
  const [shapeFontPolicy,setShapeFontPolicy]=useState<ShapeFontPolicy>(SHAPE_DEFAULTS)
  useEffect(()=>{
    if(section!=='editor')return
    let disposed=false
    void api<{values:{typesetting:ShapeFontPolicy}}>('/api/manager/runtime-settings')
      .then(r=>{if(!disposed)setShapeFontPolicy(r.values.typesetting)})
      .catch(e=>console.warn('[Shape Font Policy] settings fallback:',e))
    return()=>{disposed=true}
  },[section])
  const fontFacesLoaded=useRef(new Set<string>())
  const refreshFonts=useCallback(async()=>{
    const data=await api<FontLibrary>('/api/fonts')
    for(const font of data.fonts){
      if(font.built_in||fontFacesLoaded.current.has(font.id))continue
      const family=`KWTFont_${font.id}`
      try{
        const face=new FontFace(family,`url("${fontFileUrl(font.id)}")`)
        await face.load()
        document.fonts.add(face)
        fontFacesLoaded.current.add(font.id)
      }catch(e){console.warn('[Studio Fonts] preview fallback',font.name,e)}
    }
    setFontLibrary(data)
    setFontVersion(v=>v+1)
  },[])
  useEffect(()=>{void refreshFonts().catch(()=>{})},[refreshFonts])
  useEffect(()=>{if(section==='editor')void refreshFonts().catch(()=>{})},[section,refreshFonts])
  const [dirty,setDirty]=useState<Record<string,KwtLayerEdit>>({})
  // EXP_MANGA_V2_HISTORY: exact data snapshots; independent of native textbox Undo.
  type HistoryState={layers:LayerData[];dirty:Record<string,KwtLayerEdit>;selected:string|null}
  const historyRef=useRef<{undo:HistoryState[];redo:HistoryState[]}>({undo:[],redo:[]})
  const [historyVersion,setHistoryVersion]=useState(0)
  const snapshot=():HistoryState=>({layers:JSON.parse(JSON.stringify(layers)) as LayerData[],
    dirty:JSON.parse(JSON.stringify(dirty)) as Record<string,KwtLayerEdit>,selected})
  const restoreSnapshot=(v:HistoryState)=>{setLayers(v.layers);setDirty(v.dirty);setSelected(v.selected);setSavingMessage('편집 기록 복원됨 · 저장 필요')}
  const recordHistory=()=>{historyRef.current.undo.push(snapshot());if(historyRef.current.undo.length>80)historyRef.current.undo.shift();historyRef.current.redo=[];setHistoryVersion(v=>v+1)}
  const undo=()=>{const v=historyRef.current.undo.pop();if(!v)return;historyRef.current.redo.push(snapshot());restoreSnapshot(v);setHistoryVersion(n=>n+1)}
  const redo=()=>{const v=historyRef.current.redo.pop();if(!v)return;historyRef.current.undo.push(snapshot());restoreSnapshot(v);setHistoryVersion(n=>n+1)}

  const [saveBusy,setSaveBusy]=useState(false)
  const [savingMessage,setSavingMessage]=useState('')
  const [message,setMessage]=useState<string|null>(null)
  // KWT_BRIDGE_RESTART_V1_8_0
  const [bridgeRestartConfirm,setBridgeRestartConfirm]=useState(false)
  const [bridgeRestartBusy,setBridgeRestartBusy]=useState(false)
  // KWT_FONT_BULK_V1_9_0
  const [fontBulkConfirm,setFontBulkConfirm]=useState(false)
  const [fontBulkBusy,setFontBulkBusy]=useState(false)
  const [ocrVisible,setOCRVisible]=useState(()=>boolPref('ocrVisible',false))
  const [proofPreview,setProofPreview]=useState(false)
  const [maskEditing,setMaskEditing]=useState(false)
  const [psdBusy,setPsdBusy]=useState(false)
  // KWT_MANUAL_TYPESETTING_AUTOFIT_NAV_V1
  type PendingNavigation = {kind:'page';id:string;n:number}|{kind:'zip';path:string}
  const [pendingNavigation,setPendingNavigation]=useState<PendingNavigation|null>(null)
  const [navigationBusy,setNavigationBusy]=useState(false)
  const [autoFitMinimum,setAutoFitMinimum]=useState(18)
  const [leftOpen,setLeftOpen]=useState(()=>boolPref('leftOpen',true))
  const [view,setView]=useState<'split'|'edit'|'source'>(viewPref)
  const [editorFocus,setEditorFocus]=useState(false)
  // KWT_PAGE_SHELF_V1: mouse-hover reveal and optional pin for full screen.
  // The shelf is in normal flow under the toolbar, never at fixed top:64px.
  const [pageShelfHover,setPageShelfHover]=useState(false)
  const [pageShelfFocus,setPageShelfFocus]=useState(false)
  const [pageShelfPinned,setPageShelfPinned]=useState(false)
  const pageShelfExpanded=editorFocus&&(pageShelfHover||pageShelfFocus||pageShelfPinned)
  useEffect(()=>{
    if(!editorFocus){
      setPageShelfHover(false)
      setPageShelfFocus(false)
      setPageShelfPinned(false)
    }
  },[editorFocus])
  const [focusShowOriginal,setFocusShowOriginal]=useState(()=>boolPref('focusShowOriginal',false))
  const effectiveView=editorFocus?(focusShowOriginal?'split':'edit'):view
  const toggleEditorFocus=()=>{
    if(editorFocus){
      setEditorFocus(false)
      if(document.fullscreenElement===workspaceRef.current){void document.exitFullscreen().catch(()=>{})}
      return
    }
    setEditorFocus(true)
    // Browser/Tauri fullscreen when available, CSS viewport fallback otherwise.
    const host=workspaceRef.current
    if(host?.requestFullscreen)void host.requestFullscreen().catch(()=>{})
  }
  useEffect(()=>{
    const onChange=()=>{
      const active=document.fullscreenElement===workspaceRef.current
      if(active)wasWorkspaceFullscreen.current=true
      else if(wasWorkspaceFullscreen.current){wasWorkspaceFullscreen.current=false;setEditorFocus(false)}
    }
    document.addEventListener('fullscreenchange',onChange)
    return()=>document.removeEventListener('fullscreenchange',onChange)
  },[])
  useEffect(()=>{if(section!=='editor'&&editorFocus)setEditorFocus(false)},[section,editorFocus])
  const [version,setVersion]=useState(0)
  const [follow,setFollow]=useState(()=>boolPref('follow',false))
  const [filter,setFilter]=useState(()=>strPref('filter',''))
  const activeProject=projects.find(x=>x.id===active)||null
  const selectedLayer=layers.find(x=>x.region_id===selected)||null
  const loading=useRef(false)
  const projectRef=useRef(activeProject)
  projectRef.current=activeProject
  const activeRef=useRef(active);activeRef.current=active
  const indexRef=useRef(index);indexRef.current=index
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty
  const pushError=(e:unknown)=>setMessage(e instanceof Error?e.message:String(e))

  // KWT_STUDIO_PREFERENCES_V1_6: persist only UI preferences, never unsaved layer changes.
  useEffect(()=>{persistPrefs({section,navExpanded,root,output,recursive,ocrVisible,leftOpen,view,follow,filter,focusShowOriginal})},
    [section,navExpanded,root,output,recursive,ocrVisible,leftOpen,view,follow,filter,focusShowOriginal])

  // KWT_BRIDGE_RESTART_V1_8_0: self-restart the owned local Bridge only.
  // Never restart the OCR/Gemma processes or kill a port by name.
  const restartBridge=async()=>{
    if(bridgeRestartBusy)return
    setBridgeRestartBusy(true)
    setBridgeRestartConfirm(false)
    try{
      if(Object.keys(dirtyRef.current).length||saveBusy){
        throw new Error('저장되지 않은 식질 수정이 있습니다. 저장하거나 취소한 후 다시 시도하세요.')
      }
      const result=await api<{restarting:boolean;old_pid:number}>('/api/bridge/restart',{})
      if(!result.restarting)throw new Error('Bridge 재시작 요청이 처리되지 않았습니다.')
      setConnected(false)
      let fresh=false
      for(let attempt=0;attempt<50;attempt++){
        await new Promise<void>(resolve=>window.setTimeout(resolve,350))
        try{
          const response=await api<{ok:boolean;bridge_pid?:number}>('/api/health')
          if(response.ok && typeof response.bridge_pid==='number' && response.bridge_pid!==result.old_pid){
            fresh=true;break
          }
        }catch{/* Restart is temporarily taking the port offline. */}
      }
      if(!fresh)throw new Error('Bridge가 재시작 중이거나 응답하지 않습니다. 잠시 후 새로고침을 시도하세요.')
      setProjects([])
      setActive(null)
      setPages([])
      setPage(null)
      setLayers([])
      setDirty({})
      setSelected(null)
      await refreshBridgeProjects()
      setMessage('Studio Bridge를 재시작했습니다. OCR·Gemma 서버는 그대로 유지됩니다.')
    }catch(e){setMessage(e instanceof Error?e.message:String(e))}
    finally{setBridgeRestartBusy(false)}
  }
  // Named separately to avoid a closure on a not-yet-initialized callback.
  const refreshBridgeProjects=async()=>{
    const list=await api<Project[]>('/api/projects')
    setConnected(true);setProjects(list)
  }

  const refreshProjects=useCallback(async()=>{
    try{const list=await api<Project[]>('/api/projects');setConnected(true);setProjects(list)}
    catch{setConnected(false)}
  },[])
  useEffect(()=>{void refreshProjects();const timer=window.setInterval(()=>void refreshProjects(),1400);return()=>clearInterval(timer)},[refreshProjects])

  const loadPages=useCallback(async(id:string)=>{
    const all=await api<PageList>('/api/pages?id='+encodeURIComponent(id));setPages(all)
    return all
  },[])

  const loadPage=useCallback(async(id:string,n:number,flush=true)=>{
    if(loading.current)return
    // Native window.confirm() can fail or be suppressed in WebView2.
    // A deferred in-app dialog owns the navigation decision (never discard yet).
    if(flush&&Object.keys(dirtyRef.current).length>0){
      if(id===activeRef.current&&n===indexRef.current)return
      setPendingNavigation({kind:'page',id,n});return
    }
    loading.current=true
    try{
      const data=await api<PageData>(`/api/page?id=${encodeURIComponent(id)}&index=${n}`)
      setMaskEditing(false);setPage(data);setLayers(data.layers);setSelected(null);setDirty({});historyRef.current={undo:[],redo:[]};setHistoryVersion(v=>v+1);setIndex(n);setVersion(v=>v+1)
    }catch(e){pushError(e)}finally{loading.current=false}
  },[])

  useEffect(()=>{if(!active)return;void loadPages(active).then(all=>{setIndex(0);if(all.length)void loadPage(active,0,false)})},[active,loadPage,loadPages])

  const lastStatus=useRef('')
  useEffect(()=>{
    if(!active||!activeProject)return
    const p=activeProject
    const stamp=`${p.completed}-${p.state}`
    if(stamp===lastStatus.current)return
    lastStatus.current=stamp
    void loadPages(active).then(all=>{
      if(!all.length)return
      const n=follow?all.filter(x=>x.ready).at(-1)?.index:indexRef.current
      if(n!==undefined&&n!==indexRef.current&&Object.keys(dirtyRef.current).length===0){void loadPage(active,n,false)}
      else if(all[indexRef.current]?.ready&&!page?.ready&&Object.keys(dirtyRef.current).length===0){void loadPage(active,indexRef.current,false)}
    })
  },[active,activeProject?.completed,activeProject?.state,loadPage,loadPages,follow,page?.ready])

  const chooseFolder=useCallback(async()=>{
    try{
      const core=await import('@tauri-apps/api/core')
      if(core.isTauri()){
        const {open}=await import('@tauri-apps/plugin-dialog')
        const path=await open({directory:true,multiple:false,title:'원본 ZIP들이 있는 폴더 선택'})
        if(typeof path==='string')setRoot(path)
      }else setMessage('브라우저 실행에서는 폴더 경로를 직접 입력하세요. Tauri 앱에서는 폴더 선택 창을 사용할 수 있습니다.')
    }catch(e){pushError(e)}
  },[])
  useEffect(()=>{
    let stop:undefined|(()=>void)
    import('@tauri-apps/api/core').then(c=>{if(!c.isTauri())return;return import('@tauri-apps/api/webview').then(async v=>{
      stop=await v.getCurrentWebview().onDragDropEvent(e=>{
        if(section==='fonts')return
        if(e.payload.type==='drop'&&e.payload.paths.length){
          const p=e.payload.paths[0]
          if(p.toLowerCase().endsWith('.zip')){
            if(Object.keys(dirtyRef.current).length){setPendingNavigation({kind:'zip',path:p})}
            else void api<Project>('/api/open',{source:p}).then(project=>{setProjects(prev=>[...prev.filter(x=>x.id!==project.id),project]);setActive(project.id)}).catch(pushError)
          }else setRoot(p)
        }
      })
    })}).catch(()=>{})
    return()=>{stop?.()}
  },[section])

  const scan=async()=>{try{const found=await api<ZipItem[]>('/api/scan',{root,recursive});setZips(found);setSelectedZips([]);setMessage(null)}catch(e){pushError(e)}}
  // KWT_REVIEW_CLEANUP_V1_9_2: two-step confirmed, server-verified finalization.
  const previewReviewCleanup=async()=>{
    if(!selectedZips.length){setMessage('검수를 완료할 ZIP을 체크하세요.');return}
    if(Object.keys(dirtyRef.current).length||saveBusy){setMessage('저장되지 않은 식질 변경을 먼저 저장하세요.');return}
    setReviewBusy(true)
    try{
      const res=await api<{ok:boolean;items:{source:string;result:string;remove:string[]}[];errors:{source:string;error:string}[]}>('/api/review/cleanup-preview',{
        paths:selectedZips,output_dir:output.trim()||undefined,keep_original:reviewKeepOriginal
      })
      if(!res.ok){setMessage('정리 불가: '+res.errors.map(e=>e.source.split(/[\\/]/).pop()+': '+e.error).join(' | '));return}
      setReviewPreview(res)
    }catch(e){pushError(e)}finally{setReviewBusy(false)}
  }
  const executeReviewCleanup=async()=>{
    if(!reviewPreview||reviewBusy)return
    setReviewBusy(true)
    try{
      const res=await api<{ok:boolean;deleted:number;errors:{source:string;error:string}[]}>('/api/review/cleanup',{
        paths:reviewPreview.items.map(v=>v.source),output_dir:output.trim()||undefined,keep_original:reviewKeepOriginal
      })
      setReviewPreview(null)
      if(!res.ok){setMessage('일부 정리 실패: '+res.errors.map(e=>e.error).join(' | '));return}
      setMessage(`검수 완료: ${reviewPreview.items.length}개 ZIP · 부가 파일/폴더 ${res.deleted}개 정리됨. 번역본 ZIP 보존.`)
      setSelectedZips([]);setActive(null);setPages([]);setPage(null);setLayers([]);setDirty({})
      const found=await api<ZipItem[]>('/api/scan',{root,recursive});setZips(found)
      await refreshProjects()
    }catch(e){pushError(e)}finally{setReviewBusy(false)}
  }
  const openZip=async(path:string)=>{
    if(Object.keys(dirtyRef.current).length){setPendingNavigation({kind:'zip',path});return}
    try{const p=await api<Project>('/api/open',{source:path,output_dir:output.trim()||undefined});setProjects(prev=>[...prev.filter(x=>x.id!==p.id),p]);setActive(p.id);setMessage(null)}catch(e){pushError(e)}
  }
  const start=async()=>{
    const files=selectedZips.length?selectedZips:activeProject?[activeProject.source]:[]
    if(!files.length){setMessage('ZIP 목록에서 처리할 파일을 선택하세요.');return}
    try{await api('/api/process',{paths:files,output_dir:output.trim()||undefined});await refreshProjects();setMessage(null);if(!active)await openZip(files[0])}catch(e){pushError(e)}
  }
  const exportPsd=async()=>{
    if(!activeRef.current||!page?.editable||psdBusy)return
    setPsdBusy(true)
    try{
      if(Object.keys(dirtyRef.current).length){setMessage('PSD 출력 전 텍스트 변경을 먼저 저장하세요.');return}
      const saved=await api<{ok:boolean;path:string;size_bytes:number;photoshop_script?:string;layers:string[]}>('/api/experiment/export-psd',{
        id:activeRef.current,index:indexRef.current
      })
      if(!saved.ok||!saved.path)throw new Error('PSD 파일을 저장하지 못했습니다.')
      const sizeMb=(saved.size_bytes/1048576).toFixed(1)
      setMessage(`PSD 레이어 저장 완료 (${sizeMb} MB): ${saved.path}${saved.photoshop_script?' · Photoshop 텍스트 편집용 JSX: '+saved.photoshop_script:''}`)
      setSavingMessage('PSD 저장 완료 · 출력 경로는 알림을 확인하세요.')
    }catch(e){pushError(e)}
    finally{setPsdBusy(false)}
  }
  // KWT_FONT_BULK_V1_9_0: selected ZIP only; never overwrite unsaved canvas changes.
  const applyDefaultFont=async()=>{
    setFontBulkConfirm(false)
    if(!activeProject||fontBulkBusy)return
    if(Object.keys(dirtyRef.current).length||saveBusy){setMessage('현재 페이지의 미저장 변경을 먼저 저장하세요.');return}
    setFontBulkBusy(true)
    try{
      const result=await api<{ok:boolean;font_id:string;processed_pages:number;changed_boxes:number;skipped_pages:number;errors:string[]}>('/api/fonts/apply-default',{id:activeProject.id})
      setVersion(v=>v+1)
      await loadPages(activeProject.id)
      await loadPage(activeProject.id,indexRef.current,false)
      setMessage(`기본 폰트 일괄 적용: ${result.changed_boxes}개 박스 / ${result.processed_pages}페이지${result.skipped_pages?` · 건너뜀 ${result.skipped_pages}페이지`:''}${result.errors.length?' · 일부 오류: '+result.errors[0]:''}`)
    }catch(e){pushError(e)}finally{setFontBulkBusy(false)}
  }
  // KWT_STUDIO_LAYER_CRUD_V1_6_1: persist new/deleted layers as edits.
  const update=(rid:string,patch:Partial<LayerData>)=>{
    const found=layers.find(l=>l.region_id===rid)
    if(!found)return
    recordHistory()
    // Manual slider overrides automatic font fitting, not bubble shape/reflow.
    setLayers(prev=>prev.map(l=>l.region_id===rid?{...l,...patch}:l))
    setDirty(prev=>{
      const pending=prev[rid]
      const base=pending&&!('deleted' in pending)?pending:found
      return {...prev,[rid]:{...base,...patch}}
    })
  }
  // KWT_SHAPE_FONT_V1: explicit font choice wins over class mapping; an
  // independent "use type font" switch restores the automatic font.
  const fontForShapeClass=(shape:ShapeClass):string=>{
    const key=('font_id_'+shape) as keyof Omit<ShapeFontPolicy,'shape_font_policy_enabled'>
    const selected=shapeFontPolicy[key]
    return selected&&selected!=='default'?selected:fontLibrary.default_id
  }
  const chooseShapeClass=(layer:LayerData,value:string)=>{
    const override=(value==='auto'?null:value as ShapeClass)
    const auto=layer.shape_class_auto||'unknown'
    const effective=override||auto
    const patch:Partial<LayerData>={shape_class_override:override,shape_class_effective:effective}
    if(layer.font_policy_auto===true&&shapeFontPolicy.shape_font_policy_enabled)
      Object.assign(patch,{font_id:fontForShapeClass(effective),font_policy_auto:true})
    update(layer.region_id,patch)
  }
  const selectShapeFont=(layer:LayerData)=>{
    if(!shapeFontPolicy.shape_font_policy_enabled)return
    const effective=layer.shape_class_override||layer.shape_class_auto||'unknown'
    update(layer.region_id,{
      font_policy_auto:true,font_id:fontForShapeClass(effective),
      shape_class_effective:effective
    })
  }
  // KWT_PILLOW_BULK_V1: current-page edit only; preserves individual
  // auto_fit/shape_fit settings so switching all back ON restores preferences.
  // The change is pending until Ctrl+S, and Undo restores the full snapshot.
  const setPillowAll=(enabled:boolean)=>{
    if(!page?.editable||saveBusy||maskEditing)return
    const changed=layers.filter(layer=>(layer.pillow_sync!==false)!==enabled)
    if(!changed.length)return
    recordHistory()
    setLayers(prev=>prev.map(layer=>
      (layer.pillow_sync!==false)===enabled?layer:{...layer,pillow_sync:enabled}))
    setDirty(prev=>{
      const next={...prev}
      for(const layer of changed){
        const pending=prev[layer.region_id]
        const base=pending&&!('deleted' in pending)?pending:layer
        next[layer.region_id]={...base,pillow_sync:enabled}
      }
      return next
    })
    setSavingMessage('현재 페이지 Pillow 전체 '+(enabled?'ON':'OFF')+' · Ctrl+S로 저장')
  }
  const allPillowOn=layers.length>0&&layers.every(layer=>layer.pillow_sync!==false)
  const allPillowOff=layers.length>0&&layers.every(layer=>layer.pillow_sync===false)
  const fitSelected=async(layer:LayerData,silent=false)=>{
    if(!activeRef.current||!page?.editable)return
    try{
      const result=await api<{font_size:number;fits_minimum:boolean;minimum_requested:number;layout:string;fallback:boolean}>(
        '/api/experiment/manual-fit',{id:activeRef.current,index:indexRef.current,edit:layer,minimum:autoFitMinimum})
      // Ignore a result if the selection/page or editable inputs changed mid-request.
      const current=layers.find(l=>l.region_id===layer.region_id)
      if(!current||current.text!==layer.text||JSON.stringify(current.bbox)!==JSON.stringify(layer.bbox))return
      if(result.font_size!==current.font_size||!current.auto_fit)
        update(layer.region_id,{font_size:result.font_size,auto_fit:true})
      if(!result.fits_minimum&&!silent)
        setMessage(`선택한 영역은 ${autoFitMinimum}px 이상으로 모두 넣기 어렵습니다. 박스를 확대하거나 문장을 줄여 주세요.`)
      else if(!silent)setSavingMessage(`자동 맞춤: ${result.font_size}px · 저장 필요`)
    }catch(e){if(!silent)pushError(e)}
  }
  const fitWatchKey=selectedLayer?JSON.stringify([
    selectedLayer.region_id,selectedLayer.text,selectedLayer.bbox,
    selectedLayer.font_id,selectedLayer.stroke_width,selectedLayer.rich_enabled
  ]):''
  useEffect(()=>{
    if(!selectedLayer?.auto_fit||selectedLayer.pillow_sync===false||!active||!page?.editable)return
    const layer=selectedLayer
    let activeRequest=true
    const timer=window.setTimeout(async()=>{
      try{
        const result=await api<{font_size:number;fits_minimum:boolean}>(
          '/api/experiment/manual-fit',{id:active,index,edit:layer,minimum:autoFitMinimum})
        if(!activeRequest)return
        // Recheck current identity, page and inputs before mutating the selected layer.
        if(activeRef.current!==active||indexRef.current!==index)return
        const current=layers.find(l=>l.region_id===layer.region_id)
        if(current?.auto_fit&&current.pillow_sync!==false&&current.text===layer.text&&JSON.stringify(current.bbox)===JSON.stringify(layer.bbox)&&current.font_size!==result.font_size)
          update(layer.region_id,{font_size:result.font_size})
      }catch(e){if(activeRequest)console.warn('[Manual auto-fit]',e)}
    },550)
    return()=>{activeRequest=false;window.clearTimeout(timer)}
  },[fitWatchKey,selectedLayer?.auto_fit,selectedLayer?.pillow_sync,active,index,page?.editable,autoFitMinimum])
  const createLayer=()=>{
    if(!page?.editable)return
    recordHistory()
    const origin=layers.find(l=>l.region_id===selected) || layers[0]
    const base=origin?.bbox || [80,80,220,120]
    const bbox=[Math.max(0,Math.round(base[0]+24)),Math.max(0,Math.round(base[1]+24)),
                Math.max(80,Math.round(base[2])),Math.max(70,Math.round(base[3]))]
    const region_id=`manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`
    const created:LayerData={
      region_id,ocr_bbox:[...bbox],bbox,source_text:'',text:'새 번역',
      font_size:origin?.font_size||24,font_id:fontLibrary.default_id,font_policy_auto:false,
       shape_class_auto:'unknown',shape_class_override:null,shape_class_effective:'unknown',text_color:origin?.text_color||'#000000',
      stroke_color:origin?.stroke_color||'#ffffff',stroke_width:origin?.stroke_width??2,
      align:origin?.align||'center',visible:true,edited:true,auto_fit:false,shape_fit:false,pillow_sync:true,rotation:0
    }
    setLayers(prev=>[...prev,created])
    setDirty(prev=>({...prev,[region_id]:created}))
    setSelected(region_id)
    setFollow(false)
    setView(v=>v==='source'?'edit':v)
    setSavingMessage('새 박스 생성됨 · 저장 필요')
  }
  const deleteLayer=()=>{
    if(!page?.editable||!selected)return
    const target=layers.find(l=>l.region_id===selected)
    if(!target)return
    recordHistory()
    const rid=selected
    const persisted=page.layers.some(l=>l.region_id===rid)
    setLayers(prev=>prev.filter(l=>l.region_id!==rid))
    setDirty(prev=>{
      const next={...prev}
      if(rid.startsWith('manual-')&&!persisted)delete next[rid]
      else next[rid]={region_id:rid,deleted:true}
      return next
    })
    setSelected(null)
    setFollow(false)
    setSavingMessage('박스 삭제됨 · 저장 필요')
  }
  const save=useCallback(async(reload=true):Promise<boolean>=>{
    if(!activeRef.current||!page?.editable||saveBusy)return false
    if(Object.keys(dirtyRef.current).length===0)return true
    setSaveBusy(true)
    try{
      const edits=Object.values(dirtyRef.current)
      const res=await api<{message:string;zip_updated:boolean}>('/api/save',{id:activeRef.current,index:indexRef.current,edits})
      dirtyRef.current={};setDirty({});historyRef.current={undo:[],redo:[]};setHistoryVersion(v=>v+1)
      setSavingMessage(res.message);setVersion(v=>v+1);setMessage(null)
      void loadPages(activeRef.current)
      if(reload)void loadPage(activeRef.current,indexRef.current,false)
      return true
    }catch(e){pushError(e);return false}finally{setSaveBusy(false)}
  },[page?.editable,saveBusy,loadPages,loadPage])

  const resolveNavigation=async(choice:'save'|'discard'|'cancel')=>{
    const pending=pendingNavigation
    if(!pending||navigationBusy)return
    if(choice==='cancel'){setPendingNavigation(null);return}
    setNavigationBusy(true)
    try{
      if(choice==='save'){
        const saved=await save(false)
        if(!saved)return // Keep dialog and all edits when save fails.
      }else{
        dirtyRef.current={};setDirty({})
        historyRef.current={undo:[],redo:[]};setHistoryVersion(v=>v+1)
      }
      setPendingNavigation(null)
      if(pending.kind==='page'){
        setFollow(false)
        await loadPage(pending.id,pending.n,false)
      }else{
        const p=await api<Project>('/api/open',{source:pending.path,output_dir:output.trim()||undefined})
        setProjects(prev=>[...prev.filter(x=>x.id!==p.id),p]);setActive(p.id);setMessage(null)
      }
    }catch(e){pushError(e)}finally{setNavigationBusy(false)}
  }
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(section==='editor'&&e.key==='Escape'&&editorFocus){e.preventDefault();toggleEditorFocus();return}
      if(section==='editor'&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s') {e.preventDefault();void save();return}
      if(['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable)return
      if(section==='editor'&&page?.editable&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return}
      if(section==='editor'&&page?.editable&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return}
      if(section==='editor'&&page?.editable&&(e.key==='Delete'||e.key==='Backspace')&&selected&&!e.ctrlKey&&!e.metaKey){e.preventDefault();deleteLayer();return}
      if(section==='editor'&&page?.editable&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();createLayer();return}
      if(section==='editor'&&e.key==='ArrowRight'&&activeRef.current){setFollow(false);void loadPage(activeRef.current,indexRef.current+1)}
      if(section==='editor'&&e.key==='ArrowLeft'&&activeRef.current){setFollow(false);void loadPage(activeRef.current,Math.max(0,indexRef.current-1))}
      if(e.key==='F11') {void import('@tauri-apps/api/window').then(async m=>{const w=m.getCurrentWindow();await w.setFullscreen(!(await w.isFullscreen()))}).catch(()=>{})}
    }
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)
  },[save,loadPage,section,editorFocus,selected,layers,page?.editable,historyVersion])

  const nav=(n:number)=>{if(!active)return;setFollow(false);void loadPage(active,Math.min(Math.max(0,n),pages.length-1))}
  // Show the same final Pillow-rendered page beneath editable Konva hit boxes.
  // Recomputed on layer edits, not cached by the legacy static preview URL.
  const proof=usePillowProof(active,index,Object.values(dirty),version,
    section==='editor'&&Boolean(page?.editable)&&!maskEditing&&!proofPreview,
    layers.filter(layer=>layer.visible&&layer.pillow_sync===false).map(layer=>layer.region_id))
  const currentSource=active?imageUrl(active,index,'source',false,version):''
  const currentClean=active&&page?.editable?imageUrl(active,index,'clean',false,version):''
  const currentResult=active&&page?.ready?imageUrl(active,index,'result',false,version):''

  // KWT_STUDIO_TRAY_V1: hide the native window without ending the GUI lease or translation tasks.
  const traySupported = Boolean((window as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__)
  const minimizeToTray = async () => {
    try {
      const {invoke,isTauri} = await import('@tauri-apps/api/core')
      if(!isTauri()){setMessage('트레이 기능은 설치된 Windows Studio에서만 사용할 수 있습니다.');return}
      await invoke('kwt_hide_to_tray',{sessionId:guiSessionId.current})
    }catch(e){setMessage(`트레이 이동 실패: ${e instanceof Error?e.message:String(e)}`)}
  }

  // KWT_CUSTOM_TITLEBAR_V1: native window commands; the existing close listener preserves Bridge shutdown.
  const captionWindowAction = async (action:'minimize'|'maximize'|'close') => {
    try {
      const {getCurrentWindow}=await import('@tauri-apps/api/window')
      const current=getCurrentWindow()
      if(action==='minimize')await current.minimize()
      else if(action==='maximize')await current.toggleMaximize()
      else await current.close() // Existing onCloseRequested will close GUI lease and destroy window.
    }catch(e){setMessage(`창 제어 실패: ${e instanceof Error?e.message:String(e)}`)}
  }

  // KWT_FOCUS_DIALOG_PORTAL_V1: native Fullscreen API renders only descendants
  // of its fullscreenElement. App-level dialogs otherwise exist but disappear.
  const dialogInsideFullscreen=(element:ReactNode)=>{
    const host=workspaceRef.current
    return editorFocus && host && document.fullscreenElement===host
      ? createPortal(element,host)
      : element
  }

  return <div className="app">
    {traySupported&&<div className="kwt-custom-caption" role="toolbar" aria-label="Studio 창 관리">
      <div className="kwt-caption-drag" data-tauri-drag-region onDoubleClick={()=>void captionWindowAction('maximize')} title="끌어서 창 이동 · 두 번 클릭하여 최대화">
        <Layers3 size={15}/><span data-tauri-drag-region className="kwt-caption-title">KoneWebTranslator Studio</span><span data-tauri-drag-region className="kwt-caption-mark">DESKTOP</span>
      </div>
      <div className="kwt-caption-buttons">
        <button type="button" className="kwt-caption-button kwt-caption-tray" title="트레이로 숨기기 · 백그라운드 작업 계속" aria-label="트레이로 숨기기" onClick={()=>void minimizeToTray()}><Archive size={15}/></button>
        <button type="button" className="kwt-caption-button" title="작업 표시줄로 최소화" aria-label="최소화" onClick={()=>void captionWindowAction('minimize')}><Minus size={16}/></button>
        <button type="button" className="kwt-caption-button" title="최대화/복원" aria-label="최대화 또는 복원" onClick={()=>void captionWindowAction('maximize')}><Square size={13}/></button>
        <button type="button" className="kwt-caption-button kwt-caption-close" title="Studio 완전 종료" aria-label="완전 종료" onClick={()=>void captionWindowAction('close')}><X size={17}/></button>
      </div>
    </div>}
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Layers3 size={21}/></span><div><strong>KoneWebTranslator</strong><small>STUDIO <em>v0.2</em></small></div></div>
      <div className="menu-tabs"><span className="studio-page-title">{({editor:'번역 · 검수 · 편집',servers:'AI 서버 관리',chat:'로컬 채팅',translation:'번역 설정',ocr:'OCR 설정',logs:'로그 · 진단',settings:'환경 설정',extension:'웹 확장앱 관리',fonts:'폰트 관리'} as Record<StudioSection,string>)[section]}</span></div>
      <div className="top-actions"><StatusDots status={engineStatus}/><span className={'connection '+(connected?'online':'offline')}><i/>{connected?'로컬 브리지 연결됨':'브리지 연결 필요'}</span><button className="flat" disabled={bridgeRestartBusy} onClick={()=>setBridgeRestartConfirm(true)} title="Studio Bridge 재시작 (작업 상태 초기화)" aria-label="Studio Bridge 재시작"><RefreshCw size={17}/></button><button className="flat" title="전체 화면(F11)" onClick={()=>void import('@tauri-apps/api/window').then(async m=>{const w=m.getCurrentWindow();await w.setFullscreen(!(await w.isFullscreen()))}).catch(()=>{})}><Maximize2 size={16}/></button></div>
    </header>
    <div className="unified-body">
      <nav className={'studio-nav '+(navExpanded?'expanded':'compact')+(section==='settings'&&navExpanded&&settingsTreeOpen?' kwt-nav-settings-open':'')} aria-label="Studio 화면 선택">
        <button className="nav-toggle" onClick={()=>setNavExpanded(v=>!v)} title="메뉴 펼치기/접기"><Menu size={19}/>{navExpanded&&<span>메뉴</span>}</button>
        {([
          ['editor','번역 · 검수 · 편집',LayoutDashboard],
          ['servers','AI 서버 관리',Server],
          ['chat','로컬 채팅',MessageCircle],
          ['fonts','폰트 관리',Type],
          ['installer','설치 · 환경 점검',Download],
          ['extension','웹 확장앱 관리',Puzzle],
          ['logs','로그 · 진단',Terminal],
          ['settings','환경 설정',Settings2],
        ] as const).map(([key,label,Icon])=>key==='settings'
          ? <div key={key} className="kwt-settings-nav-node">
              <button type="button" title="환경 설정 트리 열기/닫기" aria-expanded={section==='settings'&&navExpanded&&settingsTreeOpen} className={'studio-nav-item '+(section==='settings'?'active':'')} onClick={()=>{
                const alreadyOpen=section==='settings'&&navExpanded&&settingsTreeOpen
                setSection('settings');setNavExpanded(true);setSettingsTreeOpen(!alreadyOpen)
              }}><Icon size={18}/>{navExpanded&&<span>{label}</span>}{navExpanded&&<ChevronRight size={14} className={'kwt-settings-parent-caret'+(section==='settings'&&settingsTreeOpen?' open':'')}/>}</button>
              {section==='settings'&&navExpanded&&settingsTreeOpen&&<div className="kwt-settings-subtree" role="group" aria-label="환경 설정 하위 메뉴">
                {([
                  ['overview','설정 개요'],
                  ['gemma','AI 서버 실행'],
                  ['pipeline','자동 ZIP 처리'],
                  ['ocr','OCR / 텍스트 검출'],
                  ['translation','번역 설정'],
                  ['chat','로컬 채팅 / 기억'],
                  ['typesetting','이미지 처리 / 식질'],
                ] as const).map(([group,title])=><button type="button" key={group} className={'kwt-settings-subitem'+(settingsGroup===group?' active':'')} aria-current={settingsGroup===group?'page':undefined} onClick={()=>setSettingsGroup(group)}>{title}</button>)}
              </div>}
            </div>
          : <button key={key} title={label} className={'studio-nav-item '+(section===key?'active':'')} onClick={()=>setSection(key)}><Icon size={18}/>{navExpanded&&<span>{label}</span>}</button>)}
        <div className="nav-spacer"/><div className="nav-version">{navExpanded?'STUDIO v0.2':'v0.2'}</div>
      </nav>
      <div className="unified-content">
    <div ref={workspaceRef} className={'workspace '+(leftOpen?'':'collapsed')+(editorFocus?' kwt-editor-focus':'')+(editorFocus&&focusShowOriginal?' kwt-focus-show-original':'')} style={{display:section==='editor'?'grid':'none'}}>
      {leftOpen&&<aside className="sidebar">
        <div className="sidebar-head"><b>작업 파일</b><button className="icon-btn" onClick={()=>setLeftOpen(false)}><PanelLeftClose size={18}/></button></div>
        <div className="field"><label>프로젝트 루트 폴더</label><div className="inline"><input value={root} onChange={e=>setRoot(e.target.value)} placeholder="C:\\...\\manga"/><button className="icon-btn" onClick={()=>void chooseFolder()} title="폴더 선택"><FolderOpen size={18}/></button></div></div>
        <div className="scan-options"><label><input type="checkbox" checked={recursive} onChange={e=>setRecursive(e.target.checked)}/>하위 폴더 포함</label><button className="subtle-btn" onClick={()=>void scan()}><Search size={15}/> ZIP 검색</button></div>
        <div className="field"><label>결과 저장 폴더 <span className="muted">(선택)</span></label><input value={output} onChange={e=>setOutput(e.target.value)} placeholder="기본: 원본 ZIP 폴더"/></div>
        <div className="file-list-head"><b>ZIP 파일 <span>{zips.length}</span></b><button className="minor" onClick={()=>setSelectedZips(prev=>zips.length>0&&zips.every(z=>prev.includes(z.path))?[]:zips.map(z=>z.path))}>{zips.length>0&&zips.every(z=>selectedZips.includes(z.path))?'전체 해제':'전체 선택'}</button></div>
        <div className="filter-input"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="파일명 필터..." /></div>
        <div className="zip-list scroll">
          {zips.length?zips.filter(x=>x.name.toLowerCase().includes(filter.toLowerCase())).map(zip=><div key={zip.path} className={'zip-item '+(activeProject?.source===zip.path?'selected':'')}>
            <input type="checkbox" checked={selectedZips.includes(zip.path)} onChange={e=>setSelectedZips(prev=>e.target.checked?[...prev,zip.path]:prev.filter(x=>x!==zip.path))}/>
            <button onClick={()=>void openZip(zip.path)} title={zip.path}><ImageIcon size={14}/><span>{zip.name}</span></button>{zip.processed&&<Check className="done" size={15}/>}</div>):<p className="hint">폴더를 선택한 다음 ZIP 검색을 눌러줘. 이 화면에 파일을 드롭해도 돼.</p>}
        </div>
        <div className="sidebar-footer">
          <label className="mini-check" style={{marginBottom:9}}><input type="checkbox" checked={reviewKeepOriginal} onChange={e=>setReviewKeepOriginal(e.target.checked)}/> 원본 ZIP 보존 (권장)</label>
          <button className="secondary full" type="button" disabled={!connected||!selectedZips.length||reviewBusy} onClick={()=>void previewReviewCleanup()} style={{marginBottom:9}}>{reviewBusy?'확인 중…':`검수 완료 · 선택 ${selectedZips.length}개 정리`}</button>
          <button className="primary full" disabled={!connected} onClick={()=>void start()}><Play size={17} fill="currentColor"/> {selectedZips.length?`${selectedZips.length}개 ZIP 자동 처리`:'현재 ZIP 자동 처리'}</button>
        </div>
      </aside>}
      <main className="main">
        <EditorToolbar
          filename={activeProject?.source_name||'ZIP을 선택하세요'}
          sourcePath={activeProject?.source}
          sidebarOpen={leftOpen} openSidebar={()=>setLeftOpen(true)}
          active={Boolean(active)} page={index} pageCount={pages.length} navigate={nav}
          editable={Boolean(page?.editable)} maskEditing={maskEditing}
          toggleMask={()=>{setMaskEditing(v=>!v);setProofPreview(false)}}
          proofPreview={proofPreview} toggleProof={()=>{setProofPreview(v=>!v);setMaskEditing(false)}}
          canUndo={historyRef.current.undo.length>0&&!saveBusy}
          canRedo={historyRef.current.redo.length>0&&!saveBusy}
          undo={undo} redo={redo}
          psdBusy={psdBusy} exportPsd={()=>void exportPsd()}
          ocrVisible={ocrVisible} setOcrVisible={setOCRVisible}
          follow={follow} setFollow={setFollow}
          pillowEnabled={allPillowOn} pillowMixed={!allPillowOn&&!allPillowOff&&layers.length>0}
          pillowAvailable={Boolean(page?.editable)&&layers.length>0&&!saveBusy&&!maskEditing}
          setPillowAll={setPillowAll}
          view={view} setView={setView} editorFocus={editorFocus} toggleFocus={toggleEditorFocus}
          focusShowOriginal={focusShowOriginal} toggleFocusOriginal={()=>setFocusShowOriginal(v=>!v)}
        />
        {activeProject&&<div className="progress-strip"><div className="progress-line"><span style={{width:`${activeProject.total?activeProject.completed/activeProject.total*100:0}%`}}/></div><span><Clock size={13}/> {activeProject.detail} ({activeProject.completed}/{activeProject.total})</span></div>}
        <div className={'kwt-page-strip-shelf'+(pageShelfExpanded?' is-open':'')+(pageShelfPinned?' is-pinned':'')}
          onMouseEnter={()=>{if(editorFocus)setPageShelfHover(true)}}
          onMouseLeave={()=>setPageShelfHover(false)}
          onFocusCapture={()=>{if(editorFocus)setPageShelfFocus(true)}}
          onBlurCapture={e=>{
            if(!e.currentTarget.contains(e.relatedTarget as Node|null))setPageShelfFocus(false)
          }}
          onKeyDown={e=>{
            if(editorFocus&&e.key==='Escape'&&pageShelfPinned){
              e.preventDefault();e.stopPropagation();setPageShelfPinned(false)
              setPageShelfFocus(false)
              ;(e.target as HTMLElement).blur()
            }
          }}>
          {editorFocus&&<button type="button" className="kwt-page-shelf-handle"
            aria-expanded={pageShelfExpanded} aria-label="페이지 목록 펼치기 또는 고정"
            title={pageShelfPinned?'페이지 목록 고정 해제':'페이지 목록을 고정하려면 클릭'}
            onClick={()=>setPageShelfPinned(value=>!value)}>
            <span>페이지 목록</span><span className="kwt-page-shelf-count">{pages.length}장</span>
            <span className="kwt-page-shelf-chevron">{pageShelfPinned?'고정됨':pageShelfExpanded?'▴':'▾'}</span>
          </button>}
          <div className="page-strip scroll" aria-label="페이지 썸네일 목록">
            {pages.map(p=><button key={p.index} className={'page-thumb '+(index===p.index?'active':'')}
              onClick={e=>{e.currentTarget.blur();setPageShelfFocus(false);setPageShelfPinned(false);nav(p.index)}} title={p.name}>
              {active&&p.ready?<img src={imageUrl(active,p.index,'result',true,0)} loading="lazy"/>:<span className="thumb-placeholder">{p.index+1}</span>}<span className="thumb-name">{p.index+1}{p.edited?' *':''}</span><i className={p.ready?'ready':''}/></button>)}
            {!pages.length&&<span className="strip-placeholder">파일을 선택하면 페이지가 표시돼</span>}
          </div>
        </div>
        <div className="image-area">
          {(!active||!page)&&<div className="empty-work"><ImageIcon size={47}/><h2>이미지를 선택하면 여기서 바로 검수할 수 있어</h2><p>왼쪽에서 ZIP 열기 · OCR 박스 선택 · 드래그 · 속성 수정 · Ctrl+S 저장</p></div>}
          {active&&page&&<div className={'compare '+effectiveView}>
            {effectiveView!=='edit'&&<div className="image-panel"><div className="panel-title"><span>일본어 원본</span><span className="label-muted">참조 레이어</span></div><div className="reference-image">{currentSource&&<img src={currentSource} alt="일본어 원본"/>}</div></div>}
            {effectiveView!=='source'&&<div className="image-panel editor-panel"><div className="panel-title"><span>한국어 식질 결과</span><span className={page.editable?'label-ok':'label-warn'}>{page.editable?'편집 가능':'자동 처리 대기/배경 없음'}</span></div>
              {page.editable&&maskEditing&&active?<MaskBrushEditor image={currentSource} mask={`${imageUrl(active,index,'clean',false,version).replace('kind=clean','kind=mask')}`} onCancel={()=>setMaskEditing(false)} onApply={async(strokes:MaskStroke[])=>{
                if(Object.keys(dirtyRef.current).length)throw new Error('먼저 텍스트 박스 변경을 저장해야 합니다.')
                await api('/api/experiment/mask',{id:active,index,strokes})
                setVersion(v=>v+1)
                await loadPage(active,index,false)
                setMaskEditing(false)
              }}/>:page.editable&&proofPreview&&active?<ProofPreview projectId={active} index={index} edits={Object.values(dirty)} version={version}/>:page.editable?<EditorCanvas image={currentClean} renderedImage={proof.url} proofBusy={proof.loading} layers={layers} ocr={page.ocr} selected={selected} onSelect={setSelected} onUpdate={update} showOCR={ocrVisible} editable={page.editable} maximize={editorFocus} fontVersion={fontVersion}/>
                :<div className="reference-image">{currentResult?<img src={currentResult} alt="한국어 식질 결과"/>:<div className="empty-layer">해당 페이지 자동 처리를 기다리는 중</div>}</div>}
            </div>}
          </div>}
        </div>
        <div className="bottom-bar"><span><span className={'state-dot '+(Object.keys(dirty).length?'changed':'')}/>{Object.keys(dirty).length?'저장되지 않은 변경 있음':savingMessage||'변경 사항 없음'}</span><span>글자 클릭 선택 · 드래그 이동 · 작은 모서리 크기 · 원형점 회전 · Ctrl+S 저장</span><button className="primary" onClick={()=>void save()} disabled={!page?.editable||!Object.keys(dirty).length||saveBusy}><Save size={16}/>{saveBusy?'저장 중...':'수정 저장 Ctrl+S'}</button></div>
      </main>
      <aside className="properties"><div className="property-head"><b>식질 속성</b><button className="secondary" type="button" disabled={!activeProject||activeProject.state!=='completed'||fontBulkBusy} onClick={()=>setFontBulkConfirm(true)} title="현재 ZIP의 모든 자동 식질 박스에 등록된 기본 폰트 적용">{fontBulkBusy?'적용 중…':'기본 폰트 일괄 적용'}</button><button className="secondary kwt-add-layer" onClick={createLayer} disabled={!page?.editable} title="새 식질 박스 추가 (Ctrl+N)">+ 박스 추가</button></div>
        {selectedLayer&&page?.editable?<AnimatePresence mode="wait"><motion.div key={selectedLayer.region_id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="properties-content scroll">
          <div className="region-title"><span title={selectedLayer.region_id}>{selectedLayer.region_id.startsWith('manual-')?'수동 생성 영역':`영역 #${selectedLayer.region_id}`}</span><span className="pill">{selectedLayer.edited?'수정됨':'자동 식질'}</span></div>
          <button className="secondary kwt-delete-layer" onClick={deleteLayer} title="선택한 식질 박스 삭제 (Delete)">선택 박스 삭제</button>
          <div className="property-field"><label>일본어 OCR</label><div className="original-text">{selectedLayer.source_text}</div></div>
          <div className="property-field"><label>한국어 텍스트</label><label className="mini-check" style={{marginBottom:8}}><input type="checkbox" checked={Boolean(selectedLayer.rich_enabled)} onChange={e=>update(selectedLayer.region_id,{rich_enabled:e.target.checked})}/> 리치 텍스트 (실험)</label>{selectedLayer.rich_enabled&&<p className="ctl-description">강조: **굵게** · [[color:#FF0000]]빨강[[/color]] · 정확한 미리보기에서 확인</p>}<textarea id="layer-text" rows={5} value={selectedLayer.text} onChange={e=>update(selectedLayer.region_id,{text:e.target.value})}/></div>
          <div className="property-field kwt-shape-font-property">
            <label>말풍선 형태 및 자동 폰트</label>
            <div className="ctl-description">자동 판정: <strong>{SHAPE_NAMES[selectedLayer.shape_class_auto||'unknown']}</strong>
              {selectedLayer.shape_confidence!==undefined&&selectedLayer.shape_confidence>0&&
                <span> · 신뢰도 {Math.round(selectedLayer.shape_confidence*100)}%</span>}
            </div>
            <label style={{display:'block',marginTop:9}}>영역 유형 강제 지정
              <select value={selectedLayer.shape_class_override||'auto'}
                onChange={e=>chooseShapeClass(selectedLayer,e.target.value)}>
                <option value="auto">자동 판정 사용</option>
                {SHAPE_TYPES.map(c=><option key={c} value={c}>{SHAPE_NAMES[c]}</option>)}
              </select>
            </label>
            <label className="mini-check" style={{display:'flex',alignItems:'center',gap:8,marginTop:10}}>
              <input type="checkbox" checked={Boolean(selectedLayer.font_policy_auto)}
                disabled={!shapeFontPolicy.shape_font_policy_enabled}
                onChange={e=>e.target.checked?selectShapeFont(selectedLayer):
                  update(selectedLayer.region_id,{font_policy_auto:false})}/>
              유형별 폰트 자동 적용 (이 박스)
            </label>
            <div className="ctl-description">적용 유형: {SHAPE_NAMES[selectedLayer.shape_class_override||selectedLayer.shape_class_auto||'unknown']}
              {!shapeFontPolicy.shape_font_policy_enabled?' · 전역 설정 OFF':''}.
              직접 폰트를 선택하면 이 박스만 수동 지정으로 전환됩니다.
            </div>
          </div>
          <div className="property-field kwt-font-property"><label>폰트</label><select value={selectedLayer.font_id||'system'} onChange={e=>update(selectedLayer.region_id,{font_id:e.target.value,font_policy_auto:false})}>
            {fontLibrary.fonts.map(font=><option value={font.id} key={font.id}>{font.name}{fontLibrary.default_id===font.id?' (기본)':''}</option>)}
            {selectedLayer.font_id&&!fontLibrary.fonts.some(f=>f.id===selectedLayer.font_id)&&<option value={selectedLayer.font_id}>등록되지 않은 폰트 (대체 표시)</option>}
          </select><button className="subtle-btn" onClick={()=>setSection('fonts')}>폰트 관리</button></div>
          <div className="property-field"><label>글자 크기 <strong>{selectedLayer.font_size}px</strong></label><input type="range" min={8} max={110} step={1} value={selectedLayer.font_size} onChange={e=>update(selectedLayer.region_id,{font_size:+e.target.value,auto_fit:false})}/><input type="number" min={8} max={180} value={selectedLayer.font_size} onChange={e=>update(selectedLayer.region_id,{font_size:+e.target.value||8,auto_fit:false})}/>
             <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:10}}>
               <button className="secondary" type="button" onClick={()=>void fitSelected(selectedLayer)} title="실제 Pillow 글꼴 폭으로 박스에 맞는 최대 크기 계산">자동 크기 맞춤</button>
               <label className="mini-check"><input type="checkbox" checked={Boolean(selectedLayer.auto_fit)} onChange={e=>update(selectedLayer.region_id,{auto_fit:e.target.checked})}/> 내용·박스 변경 시 자동 맞춤</label>
             </div>
             <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,marginTop:7}}>권장 최소 크기 <input type="number" min={8} max={110} style={{width:70}} value={autoFitMinimum} onChange={e=>setAutoFitMinimum(Math.max(8,Math.min(110,+e.target.value||18)))}/>px</label>
             {selectedLayer.shape_capable&&<label className="mini-check" style={{marginTop:9}}><input type="checkbox" checked={Boolean(selectedLayer.shape_fit)} onChange={e=>update(selectedLayer.region_id,{shape_fit:e.target.checked})}/> 말풍선 윤곽 줄맞춤 유지</label>}
           </div>
          <div className="property-field">
            <label>선택 영역 Pillow 자동 배치</label>
            <label className="mini-check" style={{display:'flex',gap:8,alignItems:'center',marginTop:8}}>
              <input type="checkbox" checked={selectedLayer.pillow_sync!==false}
                onChange={e=>update(selectedLayer.region_id,e.target.checked
                  ?{pillow_sync:true}
                  :{pillow_sync:false,shape_fit:false,auto_fit:false})}/>
              Pillow 동기화 (선택 박스만)
            </label>
            <p className="ctl-description">OFF: 이 박스의 자동 줄맞춤을 멈추고 직접 줄바꿈·위치·회전을 편집합니다. 다른 박스는 영향받지 않습니다.</p>
          </div>
          <div className="property-field">
            <label>글자 박스 회전 <strong>{Math.round(selectedLayer.rotation||0)}°</strong></label>
            <input type="range" min={-180} max={180} step={1} value={selectedLayer.rotation||0}
              onChange={e=>update(selectedLayer.region_id,{rotation:+e.target.value,pillow_sync:false,shape_fit:false,auto_fit:false})}/>
            <div style={{display:'flex',gap:8,alignItems:'center',marginTop:6}}>
              <input type="number" min={-180} max={180} step={1} style={{width:82}} value={selectedLayer.rotation||0}
                onChange={e=>update(selectedLayer.region_id,{rotation:Math.max(-180,Math.min(180,+e.target.value||0)),pillow_sync:false,shape_fit:false,auto_fit:false})}/>
              <button className="secondary" type="button" onClick={()=>update(selectedLayer.region_id,{rotation:0})}>회전 초기화</button>
            </div>
            <p className="ctl-description">박스 우측 상단 회전점을 드래그해서 기울일 수도 있습니다.</p>
          </div>
          <div className="coordinate-grid">{['X','Y','너비','높이'].map((lab,i)=><label key={i}>{lab}<input type="number" value={Math.round(selectedLayer.bbox[i])} onChange={e=>{const box=[...selectedLayer.bbox];box[i]=+e.target.value;update(selectedLayer.region_id,{bbox:box})}}/></label>)}</div>
          <div className="property-field"><label>정렬</label><div className="select-group">{(['left','center','right'] as const).map(a=><button key={a} className={a===selectedLayer.align?'active':''} onClick={()=>update(selectedLayer.region_id,{align:a})}>{a==='left'?'왼쪽':a==='center'?'가운데':'오른쪽'}</button>)}</div></div>
          <div className="color-grid"><label>글자색<input type="color" value={selectedLayer.text_color} onChange={e=>update(selectedLayer.region_id,{text_color:e.target.value})}/></label><label>외곽선<input type="color" value={selectedLayer.stroke_color} onChange={e=>update(selectedLayer.region_id,{stroke_color:e.target.value})}/></label></div>
          <div className="property-field"><label>외곽선 두께 <strong>{selectedLayer.stroke_width}px</strong></label><input type="range" min={0} max={10} step={1} value={selectedLayer.stroke_width} onChange={e=>update(selectedLayer.region_id,{stroke_width:+e.target.value})}/></div>
          <button className="secondary full" onClick={()=>update(selectedLayer.region_id,{visible:!selectedLayer.visible})}>{selectedLayer.visible?<Eye size={16}/>:<EyeOff size={16}/>} {selectedLayer.visible?'글자 숨기기':'글자 표시'}</button>
          <div className="help">+ 박스 추가(Ctrl+N) · 선택 삭제(Delete) · Ctrl+S 저장. OCR 원문 박스는 참조용으로 유지돼.</div>
        </motion.div></AnimatePresence>:<div className="no-selection"><Layers3 size={35}/><b>텍스트 영역을 선택해 줘</b><p>오른쪽 결과 이미지에서 글자를 클릭하면 글자 내용, 폰트, 좌표와 색상을 편집할 수 있어.</p>{page&&!page.editable&&<p className="warning">이 페이지는 복원 배경이 없거나 아직 처리 중이야.</p>}</div>}
      </aside>
    </div>
    {section==='chat'&&<ChatCenter gemmaOnline={Boolean(engineStatus?.gemma.online)}/>}
    {section==='extension'&&<ExtensionCenter/>}
    {section==='fonts'&&<FontManager onChanged={()=>void refreshFonts().catch(()=>{})}/>}
    {/* KWT_CHROME_EXTENSION_GUIDE_V2_0_2 */}{section==='installer'&&<SetupCenter onOpenExtension={()=>setSection('extension')}/>}
    {section!=='editor'&&section!=='extension'&&section!=='fonts'&&section!=='installer'&&section!=='chat'&&<ControlCenter section={section} settingsGroup={settingsGroup} status={engineStatus} onStatusRefresh={refreshEngineStatus}/>}
    </div></div>
    {pendingNavigation&&dialogInsideFullscreen(<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!navigationBusy)setPendingNavigation(null)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="kwt-unsaved-edit-title">
        <h3 id="kwt-unsaved-edit-title">저장되지 않은 식질 변경</h3>
        <p>현재 페이지의 편집 사항을 저장하고 이동할까요? 취소하면 지금 페이지와 편집 내용이 그대로 유지됩니다.</p>
        <div className="kwt-bridge-restart-actions">
          <button type="button" disabled={navigationBusy} onClick={()=>void resolveNavigation('cancel')}>취소 · 계속 편집</button>
          <button type="button" disabled={navigationBusy} onClick={()=>void resolveNavigation('discard')}>변경 버리고 이동</button>
          <button type="button" className="primary" disabled={navigationBusy} onClick={()=>void resolveNavigation('save')}>{navigationBusy?'처리 중…':'저장 후 이동'}</button>
        </div>
      </div>
    </div>)}
    {fontBulkConfirm&&dialogInsideFullscreen(<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setFontBulkConfirm(false)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="kwt-font-bulk-title">
        <h3 id="kwt-font-bulk-title">기본 폰트 일괄 적용</h3>
        <p>현재 ZIP의 전체 페이지에서 자동 식질 박스의 폰트만 '{fontLibrary.fonts.find(f=>f.id===fontLibrary.default_id)?.name||'Windows 기본'}'으로 변경합니다.</p>
        <p>텍스트·위치·크기·색상·수동 추가 박스는 유지합니다. 완료 ZIP과 편집 메타데이터에 저장됩니다. 페이지가 많으면 처리 시간이 걸릴 수 있습니다.</p>
        <div className="kwt-bridge-restart-actions"><button type="button" onClick={()=>setFontBulkConfirm(false)}>취소</button><button type="button" className="primary" disabled={fontBulkBusy} onClick={()=>void applyDefaultFont()}>전체 페이지 적용</button></div>
      </div>
    </div>)}
    {bridgeRestartConfirm&&dialogInsideFullscreen(<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setBridgeRestartConfirm(false)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="kwt-bridge-restart-title">
        <h3 id="kwt-bridge-restart-title">Studio Bridge 재시작</h3>
        <p>완료된 프로젝트 기록과 내부 작업 상태를 초기화하고 Bridge만 재시작합니다. OCR·Gemma 서버 및 디스크 파일은 유지됩니다.</p>
        <p>현재 작업 중인 번역이 있다면 재시작할 수 없습니다. 저장되지 않은 식질 변경도 먼저 저장해야 합니다.</p>
        <div className="kwt-bridge-restart-actions"><button type="button" onClick={()=>setBridgeRestartConfirm(false)}>취소</button><button type="button" className="primary" disabled={bridgeRestartBusy} onClick={()=>void restartBridge()}>Bridge 재시작</button></div>
      </div>
    </div>)}
    {reviewPreview&&dialogInsideFullscreen(<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!reviewBusy)setReviewPreview(null)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-label="검수 완료 및 파일 정리">
        <h3>검수 완료 · 파일 정리 확인</h3>
        <p>완료된 번역 ZIP {reviewPreview.items.length}개는 반드시 보존합니다. {reviewKeepOriginal?'원본 ZIP도 보존합니다.':'원본 ZIP도 삭제합니다. 이후 Studio에서 해당 작업을 다시 열 수 없습니다.'}</p>
        <p>메타데이터, 수동 편집 기록, LaMa 배경 캐시와 스튜디오 백업이 삭제됩니다. <strong>정리 후에는 이전 식질 박스를 재편집하거나 되돌릴 수 없습니다.</strong></p>
        <div style={{maxHeight:180,overflowY:'auto',fontSize:12,marginBottom:12}}>{reviewPreview.items.map(item=><div key={item.source} style={{marginBottom:7}}>{item.source.split(/[\\/]/).pop()} · 삭제 대상 {item.remove.length}개</div>)}</div>
        <div className="kwt-bridge-restart-actions"><button type="button" disabled={reviewBusy} onClick={()=>setReviewPreview(null)}>취소</button><button className="primary" type="button" disabled={reviewBusy} onClick={()=>void executeReviewCleanup()}>{reviewBusy?'정리 중…':'정리 확정'}</button></div>
      </div>
    </div>)}
    <AnimatePresence>{message&&dialogInsideFullscreen(<motion.div className="toast" initial={{opacity:0,y:15}} animate={{opacity:1,y:0}} exit={{opacity:0,y:15}}><AlertCircle size={19}/><span>{message}</span><button onClick={()=>setMessage(null)}>닫기</button></motion.div>)}</AnimatePresence>
  </div>
}
