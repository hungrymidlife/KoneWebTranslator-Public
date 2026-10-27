import {useCallback,useEffect,useRef,useState} from 'react'
import {motion,AnimatePresence} from 'motion/react'
import {FolderOpen,Play,ChevronLeft,ChevronRight,Save,Layers3,Eye,EyeOff,RefreshCw,Check,AlertCircle,Maximize2,PanelLeftClose,PanelLeftOpen,Search,Clock,Image as ImageIcon,Puzzle} from 'lucide-react'
import EditorCanvas from './EditorCanvas'
import ControlCenter,{StatusDots,useEngineStatus,type StudioSection} from './ControlCenter'
import type {SettingsGroup} from './UnifiedSettingsTree' // KWT_UNIFIED_NAV_TREE_V1_1
import ExtensionCenter from './ExtensionCenter'
import FontManager from './FontManager'
import SetupCenter from './SetupCenter'
import ChatCenter from './ChatCenter' // KWT_LOCAL_CHAT_V2_2_0
// KWT_STUDIO_INSTALLER_V2_0_0
import {LayoutDashboard,Server,Languages,ScanText,Terminal,Settings2,Menu,Type,Download,MessageCircle} from 'lucide-react'
import {api,imageUrl,fontFileUrl,type FontLibrary,type Project,type PageData,type PageList,type LayerData,type ZipItem} from './api'

// KWT_STUDIO_LAYER_CRUD_V1_6_1
type KwtLayerEdit = LayerData | {region_id:string;deleted:true}

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
  const [section,setSection]=useState<StudioSection>(()=>strPref('section','editor') as StudioSection)
  const [navExpanded,setNavExpanded]=useState(()=>boolPref('navExpanded',true))
  // KWT_UNIFIED_NAV_TREE_V1_1: left navigation tree state (UI-only preferences).
  const [settingsGroup,setSettingsGroup]=useState<SettingsGroup>(()=>{
    const stored=strPref('settingsGroup','overview')
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
  const [leftOpen,setLeftOpen]=useState(()=>boolPref('leftOpen',true))
  const [view,setView]=useState<'split'|'edit'|'source'>(viewPref)
  const [editorFocus,setEditorFocus]=useState(false)
  const effectiveView=editorFocus?'edit':view
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
  const [follow,setFollow]=useState(()=>boolPref('follow',true))
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
  useEffect(()=>{persistPrefs({section,navExpanded,root,output,recursive,ocrVisible,leftOpen,view,follow,filter})},
    [section,navExpanded,root,output,recursive,ocrVisible,leftOpen,view,follow,filter])

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
    if(Object.keys(dirtyRef.current).length>0&&flush&&!window.confirm('저장되지 않은 편집이 있습니다. 변경을 버리고 이동할까요?'))return
    loading.current=true
    try{
      const data=await api<PageData>(`/api/page?id=${encodeURIComponent(id)}&index=${n}`)
      setPage(data);setLayers(data.layers);setSelected(null);setDirty({});setIndex(n);setVersion(v=>v+1)
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
            void api<Project>('/api/open',{source:p}).then(project=>{setProjects(prev=>[...prev.filter(x=>x.id!==project.id),project]);setActive(project.id)}).catch(pushError)
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
    try{const p=await api<Project>('/api/open',{source:path,output_dir:output.trim()||undefined});setProjects(prev=>[...prev.filter(x=>x.id!==p.id),p]);setFollow(true);setActive(p.id);setMessage(null)}catch(e){pushError(e)}
  }
  const start=async()=>{
    const files=selectedZips.length?selectedZips:activeProject?[activeProject.source]:[]
    if(!files.length){setMessage('ZIP 목록에서 처리할 파일을 선택하세요.');return}
    try{await api('/api/process',{paths:files,output_dir:output.trim()||undefined});await refreshProjects();setMessage(null);if(!active)await openZip(files[0])}catch(e){pushError(e)}
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
    setLayers(prev=>prev.map(l=>l.region_id===rid?{...l,...patch}:l))
    setDirty(prev=>{
      const pending=prev[rid]
      const base=pending&&!('deleted' in pending)?pending:found
      return {...prev,[rid]:{...base,...patch}}
    })
  }
  const createLayer=()=>{
    if(!page?.editable)return
    const origin=layers.find(l=>l.region_id===selected) || layers[0]
    const base=origin?.bbox || [80,80,220,120]
    const bbox=[Math.max(0,Math.round(base[0]+24)),Math.max(0,Math.round(base[1]+24)),
                Math.max(80,Math.round(base[2])),Math.max(70,Math.round(base[3]))]
    const region_id=`manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`
    const created:LayerData={
      region_id,ocr_bbox:[...bbox],bbox,source_text:'',text:'새 번역',
      font_size:origin?.font_size||24,font_id:fontLibrary.default_id,text_color:origin?.text_color||'#000000',
      stroke_color:origin?.stroke_color||'#ffffff',stroke_width:origin?.stroke_width??2,
      align:origin?.align||'center',visible:true,edited:true
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
  const save=useCallback(async()=>{
    if(!activeRef.current||!page?.editable||Object.keys(dirtyRef.current).length===0||saveBusy)return
    setSaveBusy(true)
    try{
      const edits=Object.values(dirtyRef.current)
      const res=await api<{message:string;zip_updated:boolean}>('/api/save',{id:activeRef.current,index:indexRef.current,edits})
      setDirty({});setSavingMessage(res.message);setVersion(v=>v+1);setMessage(null);void loadPages(activeRef.current);void loadPage(activeRef.current,indexRef.current,false)
    }catch(e){pushError(e)}finally{setSaveBusy(false)}
  },[page?.editable,saveBusy,loadPages,loadPage])
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(section==='editor'&&e.key==='Escape'&&editorFocus){e.preventDefault();toggleEditorFocus();return}
      if(section==='editor'&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s') {e.preventDefault();void save();return}
      if(['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable)return
      if(section==='editor'&&page?.editable&&(e.key==='Delete'||e.key==='Backspace')&&selected&&!e.ctrlKey&&!e.metaKey){e.preventDefault();deleteLayer();return}
      if(section==='editor'&&page?.editable&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();createLayer();return}
      if(section==='editor'&&e.key==='ArrowRight'&&activeRef.current){setFollow(false);void loadPage(activeRef.current,indexRef.current+1)}
      if(section==='editor'&&e.key==='ArrowLeft'&&activeRef.current){setFollow(false);void loadPage(activeRef.current,Math.max(0,indexRef.current-1))}
      if(e.key==='F11') {void import('@tauri-apps/api/window').then(async m=>{const w=m.getCurrentWindow();await w.setFullscreen(!(await w.isFullscreen()))}).catch(()=>{})}
    }
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)
  },[save,loadPage,section,editorFocus,selected,layers,page?.editable])

  const nav=(n:number)=>{if(!active)return;setFollow(false);void loadPage(active,Math.min(Math.max(0,n),pages.length-1))}
  const currentSource=active?imageUrl(active,index,'source',false,version):''
  const currentClean=active&&page?.editable?imageUrl(active,index,'clean',false,version):''
  const currentResult=active&&page?.ready?imageUrl(active,index,'result',false,version):''

  return <div className="app">
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
          ['translation','번역 설정',Languages],
          ['ocr','OCR 설정',ScanText],
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
    <div ref={workspaceRef} className={'workspace '+(leftOpen?'':'collapsed')+(editorFocus?' kwt-editor-focus':'')} style={{display:section==='editor'?'grid':'none'}}>
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
        <div className="document-toolbar">
          <div className="doc-label">{!leftOpen&&<button className="icon-btn" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={20}/></button>}
            <div><div className="eyebrow">편집 작업영역</div><b title={activeProject?.source}>{activeProject?.source_name||'ZIP을 선택하세요'}</b></div></div>
          <div className="page-nav"><button className="icon-btn" onClick={()=>nav(index-1)} disabled={!active||index<=0}><ChevronLeft size={20}/></button><span><strong>{active?index+1:0}</strong><small> / {pages.length}</small></span><button className="icon-btn" onClick={()=>nav(index+1)} disabled={!active||index>=pages.length-1}><ChevronRight size={20}/></button></div>
          <div className="toolbar-actions"><label className="mini-check"><input type="checkbox" checked={ocrVisible} onChange={e=>setOCRVisible(e.target.checked)}/> OCR 박스</label><label className="mini-check"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/> 자동 따라가기</label><div className="view-switch"><button className={view==='split'?'selected':''} onClick={()=>setView('split')}>비교</button><button className={view==='edit'?'selected':''} onClick={()=>setView('edit')}>편집 집중</button><button className={view==='source'?'selected':''} onClick={()=>setView('source')}>원본</button><button className={"kwt-focus-toggle"+(editorFocus?" selected":"")} onClick={toggleEditorFocus} aria-pressed={editorFocus} title={editorFocus?'식질 전체화면 닫기 (Esc)':'한국어 식질 전체화면'}><Maximize2 size={15}/>{editorFocus?'전체화면 종료':'식질 전체화면'}</button></div></div>
        </div>
        {activeProject&&<div className="progress-strip"><div className="progress-line"><span style={{width:`${activeProject.total?activeProject.completed/activeProject.total*100:0}%`}}/></div><span><Clock size={13}/> {activeProject.detail} ({activeProject.completed}/{activeProject.total})</span></div>}
        <div className="page-strip scroll">{pages.map(p=><button key={p.index} className={'page-thumb '+(index===p.index?'active':'')} onClick={()=>nav(p.index)} title={p.name}>
          {active&&p.ready?<img src={imageUrl(active,p.index,'result',true,0)} loading="lazy"/>:<span className="thumb-placeholder">{p.index+1}</span>}<span className="thumb-name">{p.index+1}{p.edited?' *':''}</span><i className={p.ready?'ready':''}/></button>)}
          {!pages.length&&<span className="strip-placeholder">파일을 선택하면 페이지가 표시돼</span>}
        </div>
        <div className="image-area">
          {(!active||!page)&&<div className="empty-work"><ImageIcon size={47}/><h2>이미지를 선택하면 여기서 바로 검수할 수 있어</h2><p>왼쪽에서 ZIP 열기 · OCR 박스 선택 · 드래그 · 속성 수정 · Ctrl+S 저장</p></div>}
          {active&&page&&<div className={'compare '+effectiveView}>
            {view!=='edit'&&<div className="image-panel"><div className="panel-title"><span>일본어 원본</span><span className="label-muted">참조 레이어</span></div><div className="reference-image">{currentSource&&<img src={currentSource} alt="일본어 원본"/>}</div></div>}
            {view!=='source'&&<div className="image-panel editor-panel"><div className="panel-title"><span>한국어 식질 결과</span><span className={page.editable?'label-ok':'label-warn'}>{page.editable?'편집 가능':'자동 처리 대기/배경 없음'}</span></div>
              {page.editable?<EditorCanvas image={currentClean} layers={layers} ocr={page.ocr} selected={selected} onSelect={setSelected} onUpdate={update} showOCR={ocrVisible} editable={page.editable} maximize={editorFocus} fontVersion={fontVersion}/>
                :<div className="reference-image">{currentResult?<img src={currentResult} alt="한국어 식질 결과"/>:<div className="empty-layer">해당 페이지 자동 처리를 기다리는 중</div>}</div>}
            </div>}
          </div>}
        </div>
        <div className="bottom-bar"><span><span className={'state-dot '+(Object.keys(dirty).length?'changed':'')}/>{Object.keys(dirty).length?'저장되지 않은 변경 있음':savingMessage||'변경 사항 없음'}</span><span>글자 클릭 선택 · 드래그 위치 · 모서리 크기 · Ctrl+S 저장</span><button className="primary" onClick={()=>void save()} disabled={!page?.editable||!Object.keys(dirty).length||saveBusy}><Save size={16}/>{saveBusy?'저장 중...':'수정 저장 Ctrl+S'}</button></div>
      </main>
      <aside className="properties"><div className="property-head"><b>식질 속성</b><button className="secondary" type="button" disabled={!activeProject||activeProject.state!=='completed'||fontBulkBusy} onClick={()=>setFontBulkConfirm(true)} title="현재 ZIP의 모든 자동 식질 박스에 등록된 기본 폰트 적용">{fontBulkBusy?'적용 중…':'기본 폰트 일괄 적용'}</button><button className="secondary kwt-add-layer" onClick={createLayer} disabled={!page?.editable} title="새 식질 박스 추가 (Ctrl+N)">+ 박스 추가</button></div>
        {selectedLayer&&page?.editable?<AnimatePresence mode="wait"><motion.div key={selectedLayer.region_id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="properties-content scroll">
          <div className="region-title"><span title={selectedLayer.region_id}>{selectedLayer.region_id.startsWith('manual-')?'수동 생성 영역':`영역 #${selectedLayer.region_id}`}</span><span className="pill">{selectedLayer.edited?'수정됨':'자동 식질'}</span></div>
          <button className="secondary kwt-delete-layer" onClick={deleteLayer} title="선택한 식질 박스 삭제 (Delete)">선택 박스 삭제</button>
          <div className="property-field"><label>일본어 OCR</label><div className="original-text">{selectedLayer.source_text}</div></div>
          <div className="property-field"><label>한국어 텍스트</label><textarea id="layer-text" rows={5} value={selectedLayer.text} onChange={e=>update(selectedLayer.region_id,{text:e.target.value})}/></div>
          <div className="property-field kwt-font-property"><label>폰트</label><select value={selectedLayer.font_id||'system'} onChange={e=>update(selectedLayer.region_id,{font_id:e.target.value})}>
            {fontLibrary.fonts.map(font=><option value={font.id} key={font.id}>{font.name}{fontLibrary.default_id===font.id?' (기본)':''}</option>)}
            {selectedLayer.font_id&&!fontLibrary.fonts.some(f=>f.id===selectedLayer.font_id)&&<option value={selectedLayer.font_id}>등록되지 않은 폰트 (대체 표시)</option>}
          </select><button className="subtle-btn" onClick={()=>setSection('fonts')}>폰트 관리</button></div>
          <div className="property-field"><label>글자 크기 <strong>{selectedLayer.font_size}px</strong></label><input type="range" min={8} max={110} step={1} value={selectedLayer.font_size} onChange={e=>update(selectedLayer.region_id,{font_size:+e.target.value})}/><input type="number" min={8} max={180} value={selectedLayer.font_size} onChange={e=>update(selectedLayer.region_id,{font_size:+e.target.value||8})}/></div>
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
    {fontBulkConfirm&&<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setFontBulkConfirm(false)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="kwt-font-bulk-title">
        <h3 id="kwt-font-bulk-title">기본 폰트 일괄 적용</h3>
        <p>현재 ZIP의 전체 페이지에서 자동 식질 박스의 폰트만 '{fontLibrary.fonts.find(f=>f.id===fontLibrary.default_id)?.name||'Windows 기본'}'으로 변경합니다.</p>
        <p>텍스트·위치·크기·색상·수동 추가 박스는 유지합니다. 완료 ZIP과 편집 메타데이터에 저장됩니다. 페이지가 많으면 처리 시간이 걸릴 수 있습니다.</p>
        <div className="kwt-bridge-restart-actions"><button type="button" onClick={()=>setFontBulkConfirm(false)}>취소</button><button type="button" className="primary" disabled={fontBulkBusy} onClick={()=>void applyDefaultFont()}>전체 페이지 적용</button></div>
      </div>
    </div>}
    {bridgeRestartConfirm&&<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setBridgeRestartConfirm(false)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="kwt-bridge-restart-title">
        <h3 id="kwt-bridge-restart-title">Studio Bridge 재시작</h3>
        <p>완료된 프로젝트 기록과 내부 작업 상태를 초기화하고 Bridge만 재시작합니다. OCR·Gemma 서버 및 디스크 파일은 유지됩니다.</p>
        <p>현재 작업 중인 번역이 있다면 재시작할 수 없습니다. 저장되지 않은 식질 변경도 먼저 저장해야 합니다.</p>
        <div className="kwt-bridge-restart-actions"><button type="button" onClick={()=>setBridgeRestartConfirm(false)}>취소</button><button type="button" className="primary" disabled={bridgeRestartBusy} onClick={()=>void restartBridge()}>Bridge 재시작</button></div>
      </div>
    </div>}
    {reviewPreview&&<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!reviewBusy)setReviewPreview(null)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-label="검수 완료 및 파일 정리">
        <h3>검수 완료 · 파일 정리 확인</h3>
        <p>완료된 번역 ZIP {reviewPreview.items.length}개는 반드시 보존합니다. {reviewKeepOriginal?'원본 ZIP도 보존합니다.':'원본 ZIP도 삭제합니다. 이후 Studio에서 해당 작업을 다시 열 수 없습니다.'}</p>
        <p>메타데이터, 수동 편집 기록, LaMa 배경 캐시와 스튜디오 백업이 삭제됩니다. <strong>정리 후에는 이전 식질 박스를 재편집하거나 되돌릴 수 없습니다.</strong></p>
        <div style={{maxHeight:180,overflowY:'auto',fontSize:12,marginBottom:12}}>{reviewPreview.items.map(item=><div key={item.source} style={{marginBottom:7}}>{item.source.split(/[\\/]/).pop()} · 삭제 대상 {item.remove.length}개</div>)}</div>
        <div className="kwt-bridge-restart-actions"><button type="button" disabled={reviewBusy} onClick={()=>setReviewPreview(null)}>취소</button><button className="primary" type="button" disabled={reviewBusy} onClick={()=>void executeReviewCleanup()}>{reviewBusy?'정리 중…':'정리 확정'}</button></div>
      </div>
    </div>}
    <AnimatePresence>{message&&<motion.div className="toast" initial={{opacity:0,y:15}} animate={{opacity:1,y:0}} exit={{opacity:0,y:15}}><AlertCircle size={19}/><span>{message}</span><button onClick={()=>setMessage(null)}>닫기</button></motion.div>}</AnimatePresence>
  </div>
}
