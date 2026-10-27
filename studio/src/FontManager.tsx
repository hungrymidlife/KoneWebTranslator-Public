import {useCallback,useEffect,useRef,useState} from 'react'
import {FolderOpen,RefreshCw,Trash2,Type,Upload} from 'lucide-react'
import {api,BASE,fontPreviewUrl,type FontLibrary,type FontRecord} from './api'

const ACCEPTED=/\.(ttf|otf|ttc)$/i
const LIMIT=24*1024*1024

export default function FontManager({onChanged}:{onChanged:()=>void}){
  const [library,setLibrary]=useState<FontLibrary>({default_id:'system',fonts:[]})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [dragging,setDragging]=useState(false)
  const input=useRef<HTMLInputElement>(null)

  const reload=useCallback(async()=>{
    const data=await api<FontLibrary>('/api/fonts')
    setLibrary(data)
  },[])
  useEffect(()=>{void reload().catch(e=>setError(String(e)))},[reload])

  const completed=async()=>{await reload();onChanged()}
  const run=async(task:()=>Promise<void>)=>{
    if(busy)return
    setBusy(true);setError('');setMessage('')
    try{await task();await completed()}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const upload=async(files:File[])=>{
    const chosen=files.filter(f=>ACCEPTED.test(f.name))
    if(!chosen.length){setError('TTF, OTF, TTC 글꼴 파일을 선택하세요.');return}
    void run(async()=>{
      let count=0
      for(const file of chosen){
        if(file.size>LIMIT)throw new Error(`${file.name}: 24MB를 초과했습니다.`)
        const res=await fetch(`${BASE}/api/fonts/upload`,{
          method:'POST',headers:{'Content-Type':'application/octet-stream',
          'X-KWT-Studio':'1','X-KWT-Font-Name':encodeURIComponent(file.name)},body:file
        })
        const reply=await res.json()
        if(!res.ok)throw new Error(reply?.error||`글꼴 등록 실패: ${file.name}`)
        count++
        setMessage(`${count}/${chosen.length}개 폰트 등록 중...`)
      }
      setMessage(`${count}개 폰트 등록 완료`)
    })
  }
  const importPaths=async(paths:string[])=>{
    const selected=paths.filter(p=>ACCEPTED.test(p))
    if(!selected.length)return
    void run(async()=>{
      await api('/api/fonts/import-paths',{paths:selected})
      setMessage(`${selected.length}개 폰트 등록 완료`)
    })
  }
  const choose=async()=>{
    try{
      const {isTauri}=await import('@tauri-apps/api/core')
      if(isTauri()){
        const {open}=await import('@tauri-apps/plugin-dialog')
        const chosen=await open({multiple:true,filters:[{name:'Font files',extensions:['ttf','otf','ttc']}]})
        if(chosen)void importPaths(typeof chosen==='string'?[chosen]:chosen)
        return
      }
    }catch(e){setError(String(e));return}
    input.current?.click()
  }
  // Native Tauri drops carry paths rather than browser File objects.
  useEffect(()=>{
    let cancelled=false
    let unlisten:(()=>void)|undefined
    void import('@tauri-apps/api/core').then(async core=>{
      if(!core.isTauri())return
      const {getCurrentWebview}=await import('@tauri-apps/api/webview')
      const off=await getCurrentWebview().onDragDropEvent(event=>{
        if(event.payload.type==='enter'||event.payload.type==='over'){setDragging(true);return}
        if(event.payload.type==='leave'){setDragging(false);return}
        if(event.payload.type==='drop'){
          setDragging(false)
          const paths=event.payload.paths.filter(p=>ACCEPTED.test(p))
          if(paths.length)void importPaths(paths)
        }
      })
      if(cancelled)off();else unlisten=off
    }).catch(()=>{})
    return()=>{cancelled=true;unlisten?.()}
  // Register only while the font menu is mounted.
  },[])

  const makeDefault=(font:FontRecord)=>void run(async()=>{
    await api('/api/fonts/default',{id:font.id})
    setMessage(`기본 글꼴 설정: ${font.name}`)
  })
  // KWT_FONT_DELETE_CONFIRM_V1_7_2
  // Requesting deletion only opens the in-app dialog. The API is called solely
  // from the explicit "삭제" confirmation button, never from the card button.
  const [pendingDelete,setPendingDelete]=useState<FontRecord|null>(null)
  const cancelDeleteRef=useRef<HTMLButtonElement>(null)
  const deletionInFlight=useRef(false)
  useEffect(()=>{
    if(pendingDelete&&!busy)cancelDeleteRef.current?.focus()
  },[pendingDelete])
  const remove=(font:FontRecord)=>{
    if(busy||deletionInFlight.current)return
    setPendingDelete(font)
  }
  const confirmRemove=()=>{
    if(!pendingDelete||busy||deletionInFlight.current)return
    const target=pendingDelete
    deletionInFlight.current=true
    void run(async()=>{
      await api('/api/fonts/remove',{id:target.id})
      setPendingDelete(null)
      setMessage(`${target.name} 폰트 삭제 완료`)
    }).finally(()=>{deletionInFlight.current=false})
  }
  return <main className="control-center kwt-font-manager scroll">
    <div className="control-heading"><div><span className="eyebrow">글꼴 라이브러리</span><h1>폰트 관리</h1>
      <p>개인 폰트를 여러 개 등록하고, 미리보기와 기본 폰트를 설정해.</p></div>
      <button className="subtle-btn" onClick={()=>void reload().catch(e=>setError(String(e)))} disabled={busy}><RefreshCw size={16}/>새로고침</button>
    </div>
    {error&&<div className="control-alert error">{error}<button onClick={()=>setError('')}>닫기</button></div>}
    {message&&<div className="control-alert success">{message}</div>}
    <section className="control-card kwt-font-import" onDragOver={e=>{e.preventDefault();setDragging(true)}}
      onDragLeave={e=>{e.preventDefault();setDragging(false)}}
      onDrop={e=>{e.preventDefault();setDragging(false);void upload(Array.from(e.dataTransfer.files))}}>
      <div className={'kwt-font-drop'+(dragging?' dragging':'')}>
        <Upload size={30}/><h2>폰트 파일을 여기에 놓아줘</h2>
        <p>TTF · OTF · TTC 지원 · 여러 개 선택 가능 · 파일당 최대 24MB</p>
        <button className="primary" disabled={busy} onClick={()=>void choose()}><FolderOpen size={16}/>폰트 가져오기</button>
        <input ref={input} type="file" hidden multiple accept=".ttf,.otf,.ttc" onChange={e=>{
          const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value='';void upload(files)
        }}/>
      </div>
    </section>
    <div className="kwt-font-library-heading"><h2>등록된 폰트 ({library.fonts.length})</h2><span>기본 폰트는 새 박스와 이후 자동 식질에 적용돼.</span></div>
    <div className="kwt-font-grid">{library.fonts.map(font=><article key={font.id} className={'kwt-font-card'+(library.default_id===font.id?' default':'')}>
      <div className="kwt-font-preview"><img src={fontPreviewUrl(font.id)} alt={`${font.name} 미리보기`} loading="lazy"/></div>
      <div className="kwt-font-card-body">
        <div className="kwt-font-title"><Type size={16}/><strong title={font.name}>{font.name}</strong></div>
        <div className="kwt-font-subtitle">{font.built_in?'운영체제 기본 글꼴':font.source_name}</div>
        <div className="kwt-font-actions">
          <label><input type="radio" name="kwt-default-font" checked={library.default_id===font.id} disabled={busy}
            onChange={()=>makeDefault(font)}/>기본 폰트{library.default_id===font.id?' (적용됨)':''}</label>
          {!font.built_in&&<button className="subtle-btn" disabled={busy} onClick={()=>remove(font)} title="등록 목록에서 삭제"><Trash2 size={14}/>삭제</button>}
        </div>
      </div>
    </article>)}</div>
    <p className="ctl-description kwt-font-notice">폰트 파일은 프로젝트의 Studio 로컬 런타임에만 저장돼. 배포·공유할 때는 각 글꼴의 라이선스를 확인해. 기존에 저장한 박스의 폰트는 기본값을 바꿔도 자동 변경되지 않아.</p>
    {pendingDelete&&<div className="kwt-font-confirm-backdrop"
      onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setPendingDelete(null)}}>
      <section className="kwt-font-confirm-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="kwt-font-delete-title" aria-describedby="kwt-font-delete-description"
        onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();setPendingDelete(null)}}}>
        <h2 id="kwt-font-delete-title">폰트 삭제 확인</h2>
        <p id="kwt-font-delete-description">
          <strong>{pendingDelete.name}</strong> 폰트를 등록 목록에서 삭제할까요?
          이미 저장된 식질 박스에서 사용 중이라면 기본 글꼴로 대체될 수 있습니다.
        </p>
        <div className="kwt-font-confirm-actions">
          <button type="button" className="secondary" ref={cancelDeleteRef}
            disabled={busy} onClick={()=>setPendingDelete(null)}>취소</button>
          <button type="button" className="kwt-font-delete-danger"
            disabled={busy} onClick={confirmRemove}>{busy?'삭제 중...':'삭제'}</button>
        </div>
      </section>
    </div>}
  </main>
}
