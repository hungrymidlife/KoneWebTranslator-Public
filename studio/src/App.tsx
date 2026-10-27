import {useCallback,useEffect,useRef,useState} from 'react'
import {motion,AnimatePresence} from 'motion/react'
import {FolderOpen,Play,ChevronLeft,ChevronRight,Save,Layers3,Eye,EyeOff,RefreshCw,Check,AlertCircle,Maximize2,PanelLeftClose,PanelLeftOpen,Search,Clock,Image as ImageIcon,Puzzle} from 'lucide-react'
import EditorCanvas from './EditorCanvas'
import ControlCenter,{StatusDots,useEngineStatus,type StudioSection} from './ControlCenter'
import ExtensionCenter from './ExtensionCenter'
import {LayoutDashboard,Server,Languages,ScanText,Terminal,Settings2,Menu} from 'lucide-react'
import {api,imageUrl,type Project,type PageData,type PageList,type LayerData,type ZipItem} from './api'

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
  const {status:engineStatus,refresh:refreshEngineStatus}=useEngineStatus()
  const [root,setRoot]=useState(()=>strPref('root',''))
  const [output,setOutput]=useState(()=>strPref('output',''))
  const [recursive,setRecursive]=useState(()=>boolPref('recursive',false))
  const [zips,setZips]=useState<ZipItem[]>([])
  const [selectedZips,setSelectedZips]=useState<string[]>([])
  const [projects,setProjects]=useState<Project[]>([])
  const [active,setActive]=useState<string|null>(null)
  const [pages,setPages]=useState<PageList>([])
  const [index,setIndex]=useState(0)
  const [page,setPage]=useState<PageData|null>(null)
  const [layers,setLayers]=useState<LayerData[]>([])
  const [selected,setSelected]=useState<string|null>(null)
  const [dirty,setDirty]=useState<Record<string,KwtLayerEdit>>({})
  const [saveBusy,setSaveBusy]=useState(false)
  const [savingMessage,setSavingMessage]=useState('')
  const [message,setMessage]=useState<string|null>(null)
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
        if(e.payload.type==='drop'&&e.payload.paths.length){
          const p=e.payload.paths[0]
          if(p.toLowerCase().endsWith('.zip')){
            void api<Project>('/api/open',{source:p}).then(project=>{setProjects(prev=>[...prev.filter(x=>x.id!==project.id),project]);setActive(project.id)}).catch(pushError)
          }else setRoot(p)
        }
      })
    })}).catch(()=>{})
    return()=>{stop?.()}
  },[])

  const scan=async()=>{try{const found=await api<ZipItem[]>('/api/scan',{root,recursive});setZips(found);setSelectedZips([]);setMessage(null)}catch(e){pushError(e)}}
  const openZip=async(path:string)=>{
    try{const p=await api<Project>('/api/open',{source:path,output_dir:output.trim()||undefined});setProjects(prev=>[...prev.filter(x=>x.id!==p.id),p]);setFollow(true);setActive(p.id);setMessage(null)}catch(e){pushError(e)}
  }
  const start=async()=>{
    const files=selectedZips.length?selectedZips:activeProject?[activeProject.source]:[]
    if(!files.length){setMessage('ZIP 목록에서 처리할 파일을 선택하세요.');return}
    try{await api('/api/process',{paths:files,output_dir:output.trim()||undefined});await refreshProjects();setMessage(null);if(!active)await openZip(files[0])}catch(e){pushError(e)}
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
      font_size:origin?.font_size||24,text_color:origin?.text_color||'#000000',
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
      <div className="menu-tabs"><span className="studio-page-title">{({editor:'번역 · 검수 · 편집',servers:'AI 서버 관리',translation:'번역 설정',ocr:'OCR 설정',logs:'로그 · 진단',settings:'환경 설정',extension:'웹 확장앱 관리'} as Record<StudioSection,string>)[section]}</span></div>
      <div className="top-actions"><StatusDots status={engineStatus}/><span className={'connection '+(connected?'online':'offline')}><i/>{connected?'로컬 브리지 연결됨':'브리지 연결 필요'}</span><button className="flat" onClick={()=>void refreshProjects()} title="연결 새로고침"><RefreshCw size={17}/></button><button className="flat" title="전체 화면(F11)" onClick={()=>void import('@tauri-apps/api/window').then(async m=>{const w=m.getCurrentWindow();await w.setFullscreen(!(await w.isFullscreen()))}).catch(()=>{})}><Maximize2 size={16}/></button></div>
    </header>
    <div className="unified-body">
      <nav className={'studio-nav '+(navExpanded?'expanded':'compact')} aria-label="Studio 화면 선택">
        <button className="nav-toggle" onClick={()=>setNavExpanded(v=>!v)} title="메뉴 펼치기/접기"><Menu size={19}/>{navExpanded&&<span>메뉴</span>}</button>
        {([
          ['editor','번역 · 검수 · 편집',LayoutDashboard],
          ['servers','AI 서버 관리',Server],
          ['translation','번역 설정',Languages],
          ['ocr','OCR 설정',ScanText],
          ['extension','웹 확장앱 관리',Puzzle],
          ['logs','로그 · 진단',Terminal],
          ['settings','환경 설정',Settings2],
        ] as const).map(([key,label,Icon])=><button key={key} title={label} className={'studio-nav-item '+(section===key?'active':'')} onClick={()=>setSection(key)}><Icon size={18}/>{navExpanded&&<span>{label}</span>}</button>)}
        <div className="nav-spacer"/><div className="nav-version">{navExpanded?'STUDIO v0.2':'v0.2'}</div>
      </nav>
      <div className="unified-content">
    <div ref={workspaceRef} className={'workspace '+(leftOpen?'':'collapsed')+(editorFocus?' kwt-editor-focus':'')} style={{display:section==='editor'?'grid':'none'}}>
      {leftOpen&&<aside className="sidebar">
        <div className="sidebar-head"><b>작업 파일</b><button className="icon-btn" onClick={()=>setLeftOpen(false)}><PanelLeftClose size={18}/></button></div>
        <div className="field"><label>프로젝트 루트 폴더</label><div className="inline"><input value={root} onChange={e=>setRoot(e.target.value)} placeholder="C:\\...\\manga"/><button className="icon-btn" onClick={()=>void chooseFolder()} title="폴더 선택"><FolderOpen size={18}/></button></div></div>
        <div className="scan-options"><label><input type="checkbox" checked={recursive} onChange={e=>setRecursive(e.target.checked)}/>하위 폴더 포함</label><button className="subtle-btn" onClick={()=>void scan()}><Search size={15}/> ZIP 검색</button></div>
        <div className="field"><label>결과 저장 폴더 <span className="muted">(선택)</span></label><input value={output} onChange={e=>setOutput(e.target.value)} placeholder="기본: 원본 ZIP 폴더"/></div>
        <div className="file-list-head"><b>ZIP 파일 <span>{zips.length}</span></b><button className="minor" onClick={()=>setSelectedZips(zips.map(z=>z.path))}>전체 선택</button></div>
        <div className="filter-input"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="파일명 필터..." /></div>
        <div className="zip-list scroll">
          {zips.length?zips.filter(x=>x.name.toLowerCase().includes(filter.toLowerCase())).map(zip=><div key={zip.path} className={'zip-item '+(activeProject?.source===zip.path?'selected':'')}>
            <input type="checkbox" checked={selectedZips.includes(zip.path)} onChange={e=>setSelectedZips(prev=>e.target.checked?[...prev,zip.path]:prev.filter(x=>x!==zip.path))}/>
            <button onClick={()=>void openZip(zip.path)} title={zip.path}><ImageIcon size={14}/><span>{zip.name}</span></button>{zip.processed&&<Check className="done" size={15}/>}</div>):<p className="hint">폴더를 선택한 다음 ZIP 검색을 눌러줘. 이 화면에 파일을 드롭해도 돼.</p>}
        </div>
        <div className="sidebar-footer"><button className="primary full" disabled={!connected} onClick={()=>void start()}><Play size={17} fill="currentColor"/> {selectedZips.length?`${selectedZips.length}개 ZIP 자동 처리`:'현재 ZIP 자동 처리'}</button></div>
      </aside>}
      <main className="main">
        <div className="document-toolbar">
          <div className="doc-label">{!leftOpen&&<button className="icon-btn" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={20}/></button>}
            <div><div className="eyebrow">편집 작업영역</div><b title={activeProject?.source}>{activeProject?.source_name||'ZIP을 선택하세요'}</b></div></div>
          <div className="page-nav"><button className="icon-btn" onClick={()=>nav(index-1)} disabled={!active||index<=0}><ChevronLeft size={20}/></button><span><strong>{active?index+1:0}</strong><small> / {pages.length}</small></span><button className="icon-btn" onClick={()=>nav(index+1)} disabled={!active||index>=pages.length-1}><ChevronRight size={20}/></button></div>
          <div className="toolbar-actions"><button className="subtle-btn kwt-focus-toggle" onClick={toggleEditorFocus} aria-pressed={editorFocus} title={editorFocus?'식질 전체화면 닫기 (Esc)':'한국어 식질 전체화면'}><Maximize2 size={15}/>{editorFocus?'전체화면 종료':'식질 전체화면'}</button><label className="mini-check"><input type="checkbox" checked={ocrVisible} onChange={e=>setOCRVisible(e.target.checked)}/> OCR 박스</label><label className="mini-check"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/> 자동 따라가기</label><div className="view-switch"><button className={view==='split'?'selected':''} onClick={()=>setView('split')}>비교</button><button className={view==='edit'?'selected':''} onClick={()=>setView('edit')}>편집 집중</button><button className={view==='source'?'selected':''} onClick={()=>setView('source')}>원본</button></div></div>
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
              {page.editable?<EditorCanvas image={currentClean} layers={layers} ocr={page.ocr} selected={selected} onSelect={setSelected} onUpdate={update} showOCR={ocrVisible} editable={page.editable} maximize={editorFocus}/>
                :<div className="reference-image">{currentResult?<img src={currentResult} alt="한국어 식질 결과"/>:<div className="empty-layer">해당 페이지 자동 처리를 기다리는 중</div>}</div>}
            </div>}
          </div>}
        </div>
        <div className="bottom-bar"><span><span className={'state-dot '+(Object.keys(dirty).length?'changed':'')}/>{Object.keys(dirty).length?'저장되지 않은 변경 있음':savingMessage||'변경 사항 없음'}</span><span>글자 클릭 선택 · 드래그 위치 · 모서리 크기 · Ctrl+S 저장</span><button className="primary" onClick={()=>void save()} disabled={!page?.editable||!Object.keys(dirty).length||saveBusy}><Save size={16}/>{saveBusy?'저장 중...':'수정 저장 Ctrl+S'}</button></div>
      </main>
      <aside className="properties"><div className="property-head"><b>식질 속성</b><button className="secondary kwt-add-layer" onClick={createLayer} disabled={!page?.editable} title="새 식질 박스 추가 (Ctrl+N)">+ 박스 추가</button></div>
        {selectedLayer&&page?.editable?<AnimatePresence mode="wait"><motion.div key={selectedLayer.region_id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="properties-content scroll">
          <div className="region-title"><span title={selectedLayer.region_id}>{selectedLayer.region_id.startsWith('manual-')?'수동 생성 영역':`영역 #${selectedLayer.region_id}`}</span><span className="pill">{selectedLayer.edited?'수정됨':'자동 식질'}</span></div>
          <button className="secondary kwt-delete-layer" onClick={deleteLayer} title="선택한 식질 박스 삭제 (Delete)">선택 박스 삭제</button>
          <div className="property-field"><label>일본어 OCR</label><div className="original-text">{selectedLayer.source_text}</div></div>
          <div className="property-field"><label>한국어 텍스트</label><textarea id="layer-text" rows={5} value={selectedLayer.text} onChange={e=>update(selectedLayer.region_id,{text:e.target.value})}/></div>
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
    {section==='extension'&&<ExtensionCenter/>}
    {section!=='editor'&&section!=='extension'&&<ControlCenter section={section} status={engineStatus} onStatusRefresh={refreshEngineStatus}/>}
    </div></div>
    <AnimatePresence>{message&&<motion.div className="toast" initial={{opacity:0,y:15}} animate={{opacity:1,y:0}} exit={{opacity:0,y:15}}><AlertCircle size={19}/><span>{message}</span><button onClick={()=>setMessage(null)}>닫기</button></motion.div>}</AnimatePresence>
  </div>
}
