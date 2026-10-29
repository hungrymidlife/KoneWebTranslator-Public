import {useCallback,useEffect,useRef,useState} from 'react'
import {Github,Bot,Brain,Download,FileText,FolderOpen,FolderPlus,Image as ImageIcon,LoaderCircle,MessageSquare,Paperclip,Plus,Save,Send,Settings2,Trash2,User,Video,X} from 'lucide-react' // KWT_CHAT_ATTACH_V2_3
import {api,BASE} from './api'
import './ChatCenter.css'

type ChatAttachment={id:string;name:string;kind:'image'|'document'|'video';size:number}
type ChatMessage={role:'user'|'assistant';content:string;attachments?:ChatAttachment[];generation?:{
  finish_reason:string;completion_tokens:number;segments:number;continuation_segments?:number;truncated:boolean;thinking_enabled?:boolean;tool_events?:{tool:string;status:'ok'|'error'}[];
  review_verification?:{status:'blocked'|'partial'|'evidence_checked';verified_findings:number;rejected_findings:number;truncated:boolean;reviewed_commits?:number;changed_files_returned?:number} // KWT_PRIVATE_REVIEW_GUARD_V2_7
}}
type ChatRecord={
  id:string;title:string;created:number;updated:number;system_prompt:string;
  context_tokens:number;reply_tokens:number;temperature:number;thinking_enabled?:boolean;github_tools_enabled?:boolean; // KWT_PRIVATE_TOOLS_V2_5
  local_tools_enabled?:boolean;local_project_id?:string; // KWT_PRIVATE_LOCAL_TOOLS_V2_9
  summary:string;summary_through:number;messages:ChatMessage[]
}
type ChatItem={id:string;title:string;updated:number;message_count:number}
type LocalProject={id:string;name:string;path:string;available:boolean;sensitive_filter_enabled?:boolean;exclude_generated_dirs?:boolean} // KWT_PRIVATE_LOCAL_TOOLS_V2_9

export default function ChatCenter({gemmaOnline}:{gemmaOnline:boolean}){
  const [items,setItems]=useState<ChatItem[]>([])
  const [selected,setSelected]=useState('')
  const [chat,setChat]=useState<ChatRecord|null>(null)
  const [input,setInput]=useState('')
  const [githubState,setGithubState]=useState('GitHub CLI 상태 확인 중…')
  const [localProjects,setLocalProjects]=useState<LocalProject[]>([])
  const [localManagerOpen,setLocalManagerOpen]=useState(false)
  const [localRemoveTarget,setLocalRemoveTarget]=useState<LocalProject|null>(null)
  const [manualLocalPath,setManualLocalPath]=useState('')
  const [attachments,setAttachments]=useState<ChatAttachment[]>([])
  const fileInput=useRef<HTMLInputElement>(null)
  const [saveFormat,setSaveFormat]=useState('md')
  const [saveNotice,setSaveNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [deleteTarget,setDeleteTarget]=useState<{id:string;title:string}|null>(null) // KWT_CHAT_DELETE_CONFIRM_V2_4_1
  const [error,setError]=useState('')
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [draft,setDraft]=useState<ChatRecord|null>(null)
  const end=useRef<HTMLDivElement>(null)

  const refreshList=useCallback(async()=>{
    const data=await api<{conversations:ChatItem[]}>('/api/chat/list')
    setItems(data.conversations)
    return data.conversations
  },[])
  const load=useCallback(async(id:string)=>{
    const data=await api<ChatRecord>(`/api/chat/conversation?id=${encodeURIComponent(id)}`)
    setChat(data)
    setDraft(data)
  },[])
  useEffect(()=>{
    let cancelled=false
    void refreshList().then(list=>{
      if(cancelled)return
      const previous=(()=>{try{return localStorage.getItem('kwt-chat-last')||''}catch{return ''}})()
      setSelected(list.some(c=>c.id===previous)?previous:list[0]?.id||'')
    }).catch(e=>{if(!cancelled)setError(String(e))})
    return()=>{cancelled=true}
  },[refreshList])
  useEffect(()=>{
    if(!selected){setChat(null);return}
    try{localStorage.setItem('kwt-chat-last',selected)}catch{/* optional */}
    void load(selected).catch(e=>setError(String(e)))
  },[selected,load])
  useEffect(()=>{end.current?.scrollIntoView({block:'end'})},[chat?.messages.length,selected])
  const refreshLocalProjects=useCallback(async()=>{
    const res=await api<{projects:LocalProject[]}>('/api/chat/local-projects')
    setLocalProjects(res.projects)
    return res.projects
  },[])
  useEffect(()=>{void refreshLocalProjects().catch(e=>setError(String(e)))},[refreshLocalProjects])
  useEffect(()=>{void api<{github:{available:boolean;message:string}}>('/api/chat/tools')
    .then(result=>setGithubState(result.github.message))
    .catch(()=>setGithubState('GitHub 도구 상태 확인 실패'))},[])

  const uploadFiles=async(files:FileList|null)=>{
    if(!files||!chat||busy)return
    setBusy(true);setError('')
    try{
      let queued=attachments.length
      for(const file of Array.from(files)){
        if(queued>=4)throw Error('한 메시지에 첨부할 파일은 최대 4개입니다.')
        if(file.size>64*1024*1024)throw Error('파일 크기는 최대 64MB입니다.')
        const res=await fetch(BASE+'/api/chat/attachment',{method:'POST',headers:{
          'X-KWT-Studio':'1','X-KWT-Chat-Id':chat.id,
          'X-KWT-Chat-Filename':encodeURIComponent(file.name),
          'Content-Type':'application/octet-stream',
        },body:file})
        if(!res.ok){let reason='파일 첨부 실패';try{const e=await res.json();reason=e.error||reason}catch{}throw Error(reason)}
        const info=await res.json() as ChatAttachment
        setAttachments(prev=>prev.length<4?[...prev,info]:prev)
        queued++
      }
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false);if(fileInput.current)fileInput.current.value=''}
  }
  // KWT_PRIVATE_CHAT_SAVE_V2_6_1: native save dialog in desktop Studio; browser fallback on web.
  const downloadAnswer=async(answer:string)=>{
    const extension=['md','txt','json','csv','html','py','js','ts','css','sql'].includes(saveFormat)?saveFormat:'md'
    let data=answer
    const fenced=answer.match(/```[a-zA-Z0-9_+.#-]*\s*\n([\s\S]*?)```/)
    if(extension!=='md'&&extension!=='txt'&&fenced)data=fenced[1].replace(/\s+$/,'')+'\n'
    const filename=`KWT_chat_${Date.now()}.${extension}`
    setSaveNotice('');setError('')
    try{
      const {isTauri,invoke}=await import('@tauri-apps/api/core')
      if(isTauri()){
        const {save}=await import('@tauri-apps/plugin-dialog')
        const path=await save({title:'AI 답변 저장',defaultPath:filename,
          filters:[{name:`${extension.toUpperCase()} 파일`,extensions:[extension]}]})
        if(path===null)return // Cancel never writes a file.
        await invoke('kwt_save_chat_answer',{path,content:data})
        setSaveNotice(`답변 저장 완료: ${path}`)
        return
      }
      const blob=new Blob([data],{type:'text/plain;charset=utf-8'})
      const link=document.createElement('a');const url=URL.createObjectURL(blob)
      link.href=url;link.download=filename
      document.body.appendChild(link);link.click();link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),60000)
      setSaveNotice(`브라우저에 다운로드 요청: ${filename}`)
    }catch(e){
      setError(`답변 저장 실패: ${e instanceof Error?e.message:String(e)}`)
    }
  }
  const create=async()=>{
    if(busy)return
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/create',{})
      await refreshList();setSelected(next.id);setChat(next);setInput('');setAttachments([]);setSettingsOpen(false)
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const remove=()=>{
    // Clicking the trash icon ONLY opens our confirmation dialog.
    if(!chat||busy||deleteTarget)return
    setError('')
    setDeleteTarget({id:chat.id,title:chat.title})
  }
  const confirmDelete=async()=>{
    // There is exactly one deletion path: the modal's explicit confirm button.
    if(!deleteTarget||busy)return
    const target=deleteTarget
    setBusy(true);setError('')
    try{
      await api('/api/chat/delete',{id:target.id})
      const list=await refreshList()
      setSelected(current=>current===target.id?(list.find(c=>c.id!==target.id)?.id||''):current)
      setAttachments([])
      if(list.length===0)setChat(null)
      setDeleteTarget(null)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const send=async()=>{
    if(busy||!chat||(!input.trim()&&!attachments.length))return
    const text=input.trim()
    const files=attachments
    setBusy(true);setError('');setInput('')
    try{
      const next=await api<ChatRecord>('/api/chat/send',{id:chat.id,text,attachments:files})
      setChat(next);setAttachments([]);await refreshList()
    }catch(e){setInput(text);setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const toggleGithub=async()=>{
    if(!chat||busy)return
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/settings',{id:chat.id,github_tools_enabled:chat.github_tools_enabled!==true})
      setChat(next);setDraft(next)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const toggleLocal=async()=>{
    if(!chat||busy)return
    if(!chat.local_tools_enabled&&!chat.local_project_id){setLocalManagerOpen(true);setError('로컬 파일 도구를 사용하려면 프로젝트 폴더를 먼저 선택하세요.');return}
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/settings',{id:chat.id,local_tools_enabled:!chat.local_tools_enabled})
      setChat(next);setDraft(next)
    }catch(e){setError(e instanceof Error?e.message:String(e));setLocalManagerOpen(true)}finally{setBusy(false)}
  }
  const selectLocalProject=async(projectId:string)=>{
    if(!chat||busy)return
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/settings',{id:chat.id,local_project_id:projectId,local_tools_enabled:projectId?chat.local_tools_enabled:false})
      setChat(next);setDraft(next)
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  const registerLocalProject=async(path:string)=>{
    setBusy(true);setError('')
    try{
      const data=await api<{project:LocalProject;projects:LocalProject[]}>('/api/chat/local-projects/register',{path})
      setLocalProjects(data.projects);setManualLocalPath('')
      if(chat&&!chat.local_project_id){
        const next=await api<ChatRecord>('/api/chat/settings',{id:chat.id,local_project_id:data.project.id})
        setChat(next);setDraft(next)
      }
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  // KWT_PRIVATE_LOCAL_FILTER_TOGGLES_V2_9_3: per-project persistent GUI switches.
  const setLocalFilter=async(key:'sensitive_filter_enabled'|'exclude_generated_dirs',value:boolean)=>{
    const id=chat?.local_project_id
    if(!id||busy)return
    setBusy(true);setError('')
    try{
      const res=await api<{projects:LocalProject[]}>('/api/chat/local-projects/filters',{
        project_id:id,[key]:value
      })
      setLocalProjects(res.projects)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const chooseLocalFolder=async()=>{
    if(busy)return
    try{
      const core=await import('@tauri-apps/api/core')
      if(!core.isTauri()){setError('웹 미리보기에서는 경로를 직접 입력해 등록하세요.');return}
      const {open}=await import('@tauri-apps/plugin-dialog')
      const path=await open({directory:true,multiple:false,title:'AI가 읽을 로컬 프로젝트 폴더 선택'})
      if(typeof path==='string')await registerLocalProject(path)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  const confirmRemoveLocalProject=async()=>{
    const target=localRemoveTarget
    if(!target||busy)return
    setBusy(true);setError('')
    try{
      const res=await api<{projects:LocalProject[]}>('/api/chat/local-projects/unregister',{project_id:target.id})
      setLocalProjects(res.projects)
      if(chat?.local_project_id===target.id){
        const next=await api<ChatRecord>('/api/chat/settings',{id:chat.id,local_project_id:'',local_tools_enabled:false})
        setChat(next);setDraft(next)
      }
      setLocalRemoveTarget(null)
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  const toggleThinking=async()=>{
    if(!chat||busy)return
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/settings',{id:chat.id,thinking_enabled:chat.thinking_enabled!==true})
      setChat(next);setDraft(next)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const saveSettings=async()=>{
    if(!chat||!draft||busy)return
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/settings',{
        id:chat.id,system_prompt:draft.system_prompt,
        context_tokens:draft.context_tokens,reply_tokens:draft.reply_tokens,
        temperature:draft.temperature,
      })
      setChat(next);setDraft(next);setSettingsOpen(false)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  return <div className="kwt-chat-root">
    <aside className="kwt-chat-sidebar">
      <div className="kwt-chat-side-title"><b>대화 목록</b><button type="button" onClick={()=>void create()} disabled={busy} title="새 대화"><Plus size={18}/></button></div>
      <div className="kwt-chat-history">
        {items.map(item=><button type="button" key={item.id} onClick={()=>{if(!busy){setSelected(item.id);setSettingsOpen(false)}}} className={'kwt-chat-history-item '+(selected===item.id?'active':'')}>
          <MessageSquare size={15}/><span title={item.title}>{item.title}</span><small>{item.message_count}</small>
        </button>)}
        {!items.length&&<p className="kwt-chat-hint">새 대화 버튼을 눌러 시작하세요.</p>}
      </div>
      <div className="kwt-chat-side-note">대화 원본과 압축 기억은 이 PC에 저장됩니다. 외부 AI 서비스로 전송하지 않습니다.</div>
    </aside>
    <section className="kwt-chat-main">
      <div className="kwt-chat-header">
        <div><b>{chat?.title||'로컬 채팅'}</b><small>{gemmaOnline?'Gemma 서버 연결됨':'Gemma 서버 오프라인 · AI 서버 관리에서 실행'}</small></div>
        <div className="kwt-chat-actions">
          <button type="button" className={'kwt-chat-local-toggle'+(chat?.local_tools_enabled?' active':'')}
            disabled={!chat||busy} aria-pressed={chat?.local_tools_enabled===true}
            onClick={()=>void toggleLocal()} title="선택한 로컬 프로젝트 코드의 읽기·검색만 허용"><FolderOpen size={15}/> 로컬 파일 {chat?.local_tools_enabled?'ON':'OFF'}</button>
          <button type="button" disabled={!chat||busy} title="로컬 프로젝트 폴더 관리" onClick={()=>setLocalManagerOpen(v=>!v)}><FolderPlus size={16}/></button>
          <button type="button" className={'kwt-chat-github-toggle'+(chat?.github_tools_enabled?' active':'')}
            disabled={!chat||busy} aria-pressed={chat?.github_tools_enabled===true}
            title={githubState+' · PR·커밋·이력 구간 분석 (읽기 전용)'}
            onClick={()=>void toggleGithub()}><Github size={15}/> GitHub {chat?.github_tools_enabled?'ON':'OFF'}</button>
          <button type="button" className={'kwt-chat-thinking-toggle'+(chat?.thinking_enabled?' active':'')}
            disabled={!chat||busy} aria-pressed={chat?.thinking_enabled===true}
            title="이 대화의 다음 Gemma 응답에만 추론 모드를 적용합니다. 이전 메시지는 바뀌지 않습니다."
            onClick={()=>void toggleThinking()}><Brain size={15}/> 추론 {chat?.thinking_enabled?'ON':'OFF'}</button>
          <button type="button" disabled={!chat||busy} onClick={()=>{setDraft(chat);setSettingsOpen(v=>!v)}} title="대화 설정"><Settings2 size={17}/></button>
          <button type="button" disabled={!chat||busy} onClick={()=>void remove()} title="대화 삭제"><Trash2 size={17}/></button>
        </div>
      </div>
      {localManagerOpen&&<div className="kwt-chat-local-manager">
        <div className="kwt-chat-local-title"><b>로컬 프로젝트 관리 · 읽기 전용</b><button type="button" onClick={()=>setLocalManagerOpen(false)}>닫기</button></div>
        <div className="kwt-chat-local-row">
          <select aria-label="로컬 프로젝트 선택" disabled={!chat||busy} value={chat?.local_project_id||''} onChange={e=>void selectLocalProject(e.target.value)}>
            <option value="">프로젝트 선택</option>
            {localProjects.map(p=><option key={p.id} value={p.id} disabled={!p.available}>{p.name} — {p.path}{!p.available?' (경로 없음)':''}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={()=>void chooseLocalFolder()}><FolderPlus size={15}/> 폴더 등록</button>
          <button type="button" disabled={busy||!chat?.local_project_id} onClick={()=>{const p=localProjects.find(x=>x.id===chat?.local_project_id);if(p)setLocalRemoveTarget(p)}}>등록 해제</button>
        </div>
        <div className="kwt-chat-local-row"><input aria-label="프로젝트 절대 경로 직접 입력" value={manualLocalPath} onChange={e=>setManualLocalPath(e.target.value)} placeholder="웹 미리보기용 직접 경로 입력 (예: C:\\dev\\Project)"/><button type="button" disabled={busy||!manualLocalPath.trim()} onClick={()=>void registerLocalProject(manualLocalPath.trim())}>경로 등록</button></div>
        {chat?.local_project_id&&(()=>{
          const current=localProjects.find(p=>p.id===chat?.local_project_id)
          if(!current)return null
          return <div className="kwt-chat-local-filters">
            <label className="kwt-chat-local-filter"><input type="checkbox" disabled={busy}
              checked={current.sensitive_filter_enabled===true}
              onChange={e=>void setLocalFilter('sensitive_filter_enabled',e.target.checked)}/>
              <span>민감 파일명 필터 <b>{current.sensitive_filter_enabled?'ON':'OFF'}</b></span>
            </label>
            <label className="kwt-chat-local-filter"><input type="checkbox" disabled={busy}
              checked={current.exclude_generated_dirs!==false}
              onChange={e=>void setLocalFilter('exclude_generated_dirs',e.target.checked)}/>
              <span>대량·생성 폴더 제외 <b>{current.exclude_generated_dirs!==false?'ON':'OFF'}</b></span>
            </label>
          </div>
        })()}
        <small>KWT_PRIVATE_LOCAL_FILTER_TOGGLES_V2_9_3 · 프로젝트별 설정 저장 · 민감 파일명 필터 OFF 시 .env·auth·token 등도 읽을 수 있음 · 생성 폴더 제외 OFF 시 .git·node_modules 등도 탐색 · 프로젝트 외부 접근 금지 · 수정/삭제/명령 실행 없음</small>
      </div>}
      {settingsOpen&&draft&&<div className="kwt-chat-settings">
        <label>시스템 지침<textarea rows={3} value={draft.system_prompt} onChange={e=>setDraft({...draft,system_prompt:e.target.value})}/></label>
        <div className="kwt-chat-settings-grid">
          <label>실제 서버 컨텍스트 (-c)<select value={draft.context_tokens} onChange={e=>setDraft({...draft,context_tokens:Number(e.target.value)})}>{[4096,8192,16384,32768].map(n=><option key={n} value={n}>{n.toLocaleString()} tokens</option>)}</select></label>
          <label>최대 답변 토큰 (0 = 자동)<input type="number" min={0} max={draft.context_tokens-1024} step={128} value={draft.reply_tokens} onChange={e=>setDraft({...draft,reply_tokens:Number(e.target.value)})}/></label>
          <label>Temperature<input type="number" min={0} max={2} step={0.05} value={draft.temperature} onChange={e=>setDraft({...draft,temperature:Number(e.target.value)})}/></label>
        </div>
        <p className="kwt-chat-hint">답변 토큰 0은 자동 모드입니다. 모델이 스스로 마칠 때까지 생성하되 남은 컨텍스트가 안전 한도입니다. 컨텍스트 설정은 서버의 <code>-c</code> 값과 일치시켜야 하며, 여기서 변경해도 서버 메모리는 늘어나지 않습니다.</p>
        <button type="button" className="kwt-chat-primary" disabled={busy} onClick={()=>void saveSettings()}><Save size={15}/> 설정 저장</button>
        <div className="kwt-chat-memory"><Brain size={16}/><b>자동 압축 기억</b><span>원본 {chat?.messages.length||0}개 메시지 중 {chat?.summary_through||0}개 압축</span></div>
        <div className="kwt-chat-summary">{chat?.summary||'아직 압축된 이전 대화가 없습니다.'}</div>
      </div>}
      <div className="kwt-chat-messages">
        {!chat&&<div className="kwt-chat-empty"><MessageSquare size={42}/><h3>Gemma 로컬 채팅</h3><p>왼쪽에서 새 대화를 만들면 시작할 수 있습니다.</p></div>}
        {chat&&chat.messages.length===0&&<div className="kwt-chat-empty"><Bot size={42}/><h3>무엇을 도와드릴까요?</h3><p>대화는 로컬에 저장되며 오래된 내용은 자동으로 요약됩니다.</p></div>}
        {chat?.messages.map((m,i)=><div key={`${chat.id}-${i}`} className={'kwt-chat-turn '+m.role}>
          <div className="kwt-chat-avatar">{m.role==='assistant'?<Bot size={17}/>:<User size={17}/>}</div>
          <div className="kwt-chat-message-body">
            <div className="kwt-chat-bubble">{m.content}</div>
            {m.attachments?.length? <div className="kwt-chat-file-list">{m.attachments.map(a=><span className="kwt-chat-file" key={a.id} title={a.name}>{a.kind==='image'?<ImageIcon size={13}/>:a.kind==='video'?<Video size={13}/>:<FileText size={13}/>} {a.name}</span>)}</div>:null}
            {m.role==='assistant'&&<div className="kwt-chat-download"><button type="button" onClick={()=>downloadAnswer(m.content)} title="답변 내용을 파일로 저장"><Download size={13}/> 답변 저장</button></div>}
            {m.role==='assistant'&&m.generation?.tool_events?.length?<div className="kwt-chat-tool-events">{m.generation.tool_events.map((ev,j)=><span key={j} title={ev.tool}>{ev.status==='ok'?'✓':'⚠'} {ev.tool}</span>)}</div>:null}
            {m.role==='assistant'&&m.generation?.review_verification?<div className={'kwt-chat-review-status '+m.generation.review_verification.status}>
              Git 리뷰 근거 검증: {m.generation.review_verification.status==='blocked'?'차단':m.generation.review_verification.status==='partial'?'부분 검토':'근거 위치 확인'}
              {' · 위험 후보 '+m.generation.review_verification.verified_findings+'건 · 차단 '+m.generation.review_verification.rejected_findings+'건'}
              {m.generation.review_verification.truncated?' · Diff 일부만 확인':''}
            </div>:null}
            {m.role==='assistant'&&m.generation&&<div className={'kwt-chat-generation'+(m.generation.truncated?' warn':'')}>
              {m.generation.truncated?'⚠ 답변이 아직 완성되지 않았습니다. ':''}
              생성 {m.generation.completion_tokens}토큰 · 종료 {m.generation.finish_reason}
              {m.generation.continuation_segments!==undefined?(m.generation.continuation_segments>0?` · 자동 이어쓰기 ${m.generation.continuation_segments}회`:''):(m.generation.segments>1?` · 자동 이어쓰기 ${m.generation.segments-1}회`:'')}
              {` · 추론 ${m.generation.thinking_enabled?'ON':'OFF'}`}
            </div>}
          </div>
        </div>)}
        {busy&&chat&&<div className="kwt-chat-wait"><LoaderCircle size={17} className="kwt-chat-spin"/> Gemma 응답 또는 이전 대화 요약 처리 중…</div>}
        <div ref={end}/>
      </div>
      <div className="kwt-chat-compose">
        {saveNotice&&<div className="kwt-chat-save-notice" role="status">{saveNotice}</div>}
        {error&&<div className="kwt-chat-error" role="alert">{error}</div>}
        {!gemmaOnline&&<div className="kwt-chat-hint">AI 서버 관리에서 Gemma를 실행해야 답변을 받을 수 있습니다.</div>}
        <input ref={fileInput} type="file" multiple className="kwt-chat-file-input" accept="image/*,video/mp4,video/webm,video/x-matroska,video/quicktime,.txt,.md,.csv,.json,.jsonl,.log,.srt,.vtt,.html,.xml,.yaml,.yml,.ini,.cfg,.py,.js,.ts,.tsx,.jsx,.css,.sh,.ps1,.bat,.sql,.toml,.pdf" onChange={e=>void uploadFiles(e.target.files)}/>
        {attachments.length>0&&<div className="kwt-chat-file-list">{attachments.map(a=><span className="kwt-chat-file" key={a.id}>{a.kind==='image'?<ImageIcon size={13}/>:a.kind==='video'?<Video size={13}/>:<FileText size={13}/>} {a.name}<button type="button" onClick={()=>setAttachments(v=>v.filter(x=>x.id!==a.id))} title="첨부 취소"><X size={13}/></button></span>)}</div>}
        <div className="kwt-chat-file-toolbar"><button type="button" disabled={!chat||busy||attachments.length>=4} onClick={()=>fileInput.current?.click()}><Paperclip size={15}/> 파일 첨부</button><span>사진·영상·PDF·텍스트/코드 · 최대 4개</span><label>답변 저장 형식 <select value={saveFormat} onChange={e=>setSaveFormat(e.target.value)}>{['md','txt','json','csv','html','py','js','ts','css','sql'].map(ext=><option key={ext} value={ext}>{ext}</option>)}</select></label></div>
        {chat?.github_tools_enabled&&<div className="kwt-chat-history-shortcut"><button type="button" disabled={busy} onClick={()=>setInput("hungrymidlife/KoneWebTranslator-Public 저장소 main 브랜치의 최근 커밋 5개(자동 백업 포함)를 실제 diff로 비교해서 변경점·회귀 위험·누락 테스트를 근거와 함께 리뷰해 줘. 변경되지 않은 파일을 리뷰했다고 주장하지 마.")}>최근 5개 Git 커밋 리뷰 요청</button></div>} {/* KWT_PRIVATE_HISTORY_V2_6 */}
        <div className="kwt-chat-compose-row">
          <textarea value={input} disabled={!chat||busy} rows={3} maxLength={6000} placeholder="메시지 입력 (Enter 전송 · Shift+Enter 줄바꿈)" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
          <button type="button" className="kwt-chat-primary" disabled={!chat||busy||(!input.trim()&&!attachments.length)||!gemmaOnline} onClick={()=>void send()}><Send size={18}/></button>
        </div>
        <small>최근 대화 + 자동 압축 기억 · 첨부 원본은 PC에만 보관 · 영상은 대표 프레임만 분석 · GitHub ON 시 PR·최근 커밋·변경 구간 조회 (읽기 전용, 파일 수정·댓글 게시 없음) · 이미지/영상은 mmproj 필요</small>
      </div>
    </section>
    {localRemoveTarget&&<div className="kwt-chat-delete-backdrop">
      <div className="kwt-chat-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="kwt-local-remove-title">
        <h3 id="kwt-local-remove-title">프로젝트 등록을 해제할까요?</h3>
        <p><strong>{localRemoveTarget.name}</strong> 프로젝트의 등록 정보만 삭제합니다. 실제 파일은 삭제하지 않습니다.</p>
        <div className="kwt-chat-delete-buttons">
          <button type="button" disabled={busy} onClick={()=>setLocalRemoveTarget(null)}>취소</button>
          <button type="button" className="danger" disabled={busy} onClick={()=>void confirmRemoveLocalProject()}>등록 해제</button>
        </div>
      </div>
    </div>}
    {deleteTarget&&<div className="kwt-chat-delete-backdrop">
      <div className="kwt-chat-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="kwt-chat-delete-title" aria-describedby="kwt-chat-delete-description" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();setDeleteTarget(null)}}}>
        <h3 id="kwt-chat-delete-title">대화를 삭제할까요?</h3>
        <p id="kwt-chat-delete-description"><strong>{deleteTarget.title}</strong> 대화 및 첨부 파일이 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
        {error&&<p className="kwt-chat-delete-error" role="alert">{error}</p>}
        <div className="kwt-chat-delete-buttons">
          <button type="button" autoFocus disabled={busy} onClick={()=>setDeleteTarget(null)}>취소</button>
          <button type="button" className="danger" disabled={busy} onClick={()=>void confirmDelete()}>{busy?'삭제 중…':'삭제 확인'}</button>
        </div>
      </div>
    </div>}
  </div>
}
