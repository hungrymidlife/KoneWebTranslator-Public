import {useCallback,useEffect,useRef,useState} from 'react'
import {Bot,Brain,Download,FileText,Image as ImageIcon,LoaderCircle,MessageSquare,Paperclip,Plus,Save,Send,Settings2,Trash2,User,Video,X} from 'lucide-react' // KWT_CHAT_ATTACH_V2_3
import {api,BASE} from './api'
import './ChatCenter.css'

type ChatAttachment={id:string;name:string;kind:'image'|'document'|'video';size:number}
type ChatMessage={role:'user'|'assistant';content:string;attachments?:ChatAttachment[];generation?:{
  finish_reason:string;completion_tokens:number;segments:number;truncated:boolean
}}
type ChatRecord={
  id:string;title:string;created:number;updated:number;system_prompt:string;
  context_tokens:number;reply_tokens:number;temperature:number;
  summary:string;summary_through:number;messages:ChatMessage[]
}
type ChatItem={id:string;title:string;updated:number;message_count:number}

export default function ChatCenter({gemmaOnline}:{gemmaOnline:boolean}){
  const [items,setItems]=useState<ChatItem[]>([])
  const [selected,setSelected]=useState('')
  const [chat,setChat]=useState<ChatRecord|null>(null)
  const [input,setInput]=useState('')
  const [attachments,setAttachments]=useState<ChatAttachment[]>([])
  const fileInput=useRef<HTMLInputElement>(null)
  const [saveFormat,setSaveFormat]=useState('md')
  const [busy,setBusy]=useState(false)
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
  const downloadAnswer=(answer:string)=>{
    const extension=['md','txt','json','csv','html','py','js','ts','css','sql'].includes(saveFormat)?saveFormat:'md'
    let data=answer
    const fenced=answer.match(/```[a-zA-Z0-9_+.#-]*\s*\n([\s\S]*?)```/)
    if(extension!=='md'&&extension!=='txt'&&fenced)data=fenced[1].replace(/\s+$/,'')+'\n'
    const blob=new Blob([data],{type:'text/plain;charset=utf-8'})
    const link=document.createElement('a');const url=URL.createObjectURL(blob)
    link.href=url;link.download=`KWT_chat_${Date.now()}.${extension}`
    document.body.appendChild(link);link.click();link.remove()
    window.setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const create=async()=>{
    if(busy)return
    setBusy(true);setError('')
    try{
      const next=await api<ChatRecord>('/api/chat/create',{})
      await refreshList();setSelected(next.id);setChat(next);setInput('');setAttachments([]);setSettingsOpen(false)
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const remove=async()=>{
    if(!chat||busy||!window.confirm(`"${chat.title}" 대화를 영구 삭제할까요?`))return
    setBusy(true);setError('')
    try{
      await api('/api/chat/delete',{id:chat.id})
      const list=await refreshList();setSelected(list.find(c=>c.id!==chat.id)?.id||'')
      setAttachments([]);if(list.length===0)setChat(null)
    }catch(e){setError(String(e))}finally{setBusy(false)}
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
          <button type="button" disabled={!chat||busy} onClick={()=>{setDraft(chat);setSettingsOpen(v=>!v)}} title="대화 설정"><Settings2 size={17}/></button>
          <button type="button" disabled={!chat||busy} onClick={()=>void remove()} title="대화 삭제"><Trash2 size={17}/></button>
        </div>
      </div>
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
            {m.role==='assistant'&&m.generation&&<div className={'kwt-chat-generation'+(m.generation.truncated?' warn':'')}>
              {m.generation.truncated?'⚠ 답변이 아직 완성되지 않았습니다. ':''}
              생성 {m.generation.completion_tokens}토큰 · 종료 {m.generation.finish_reason}
              {m.generation.segments>1?` · 자동 이어쓰기 ${m.generation.segments}회`:''}
            </div>}
          </div>
        </div>)}
        {busy&&chat&&<div className="kwt-chat-wait"><LoaderCircle size={17} className="kwt-chat-spin"/> Gemma 응답 또는 이전 대화 요약 처리 중…</div>}
        <div ref={end}/>
      </div>
      <div className="kwt-chat-compose">
        {error&&<div className="kwt-chat-error" role="alert">{error}</div>}
        {!gemmaOnline&&<div className="kwt-chat-hint">AI 서버 관리에서 Gemma를 실행해야 답변을 받을 수 있습니다.</div>}
        <input ref={fileInput} type="file" multiple className="kwt-chat-file-input" accept="image/*,video/mp4,video/webm,video/x-matroska,video/quicktime,.txt,.md,.csv,.json,.jsonl,.log,.srt,.vtt,.html,.xml,.yaml,.yml,.ini,.cfg,.py,.js,.ts,.tsx,.jsx,.css,.sh,.ps1,.bat,.sql,.toml,.pdf" onChange={e=>void uploadFiles(e.target.files)}/>
        {attachments.length>0&&<div className="kwt-chat-file-list">{attachments.map(a=><span className="kwt-chat-file" key={a.id}>{a.kind==='image'?<ImageIcon size={13}/>:a.kind==='video'?<Video size={13}/>:<FileText size={13}/>} {a.name}<button type="button" onClick={()=>setAttachments(v=>v.filter(x=>x.id!==a.id))} title="첨부 취소"><X size={13}/></button></span>)}</div>}
        <div className="kwt-chat-file-toolbar"><button type="button" disabled={!chat||busy||attachments.length>=4} onClick={()=>fileInput.current?.click()}><Paperclip size={15}/> 파일 첨부</button><span>사진·영상·PDF·텍스트/코드 · 최대 4개</span><label>답변 저장 형식 <select value={saveFormat} onChange={e=>setSaveFormat(e.target.value)}>{['md','txt','json','csv','html','py','js','ts','css','sql'].map(ext=><option key={ext} value={ext}>{ext}</option>)}</select></label></div>
        <div className="kwt-chat-compose-row">
          <textarea value={input} disabled={!chat||busy} rows={3} maxLength={6000} placeholder="메시지 입력 (Enter 전송 · Shift+Enter 줄바꿈)" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
          <button type="button" className="kwt-chat-primary" disabled={!chat||busy||(!input.trim()&&!attachments.length)||!gemmaOnline} onClick={()=>void send()}><Send size={18}/></button>
        </div>
        <small>최근 대화 + 자동 압축 기억 · 첨부 원본은 PC에만 보관 · 영상은 대표 프레임만 분석 · 이미지/영상은 mmproj 필요</small>
      </div>
    </section>
  </div>
}
