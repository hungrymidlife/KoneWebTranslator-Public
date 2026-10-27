// KWT_UNIFIED_CHAT_V1_4: per-conversation settings use existing /api/chat/settings.
// Transcript and memory are never re-created, migrated, or overwritten.
import {useCallback,useEffect,useState} from 'react'
import {api} from './api'

type Summary={id:string;title:string;updated:number;message_count:number}
type Conversation={id:string;title:string;system_prompt:string;context_tokens:number;reply_tokens:number;temperature:number;summary:string;summary_through:number;messages:unknown[]}
type Draft=Pick<Conversation,'system_prompt'|'context_tokens'|'reply_tokens'|'temperature'>

export default function ChatConversationSettings({serverContext}:{serverContext:number}){
  const [list,setList]=useState<Summary[]>([])
  const [selected,setSelected]=useState('')
  const [draft,setDraft]=useState<Draft|null>(null)
  const [original,setOriginal]=useState<Draft|null>(null)
  const [info,setInfo]=useState<{messages:number;compressed:number}|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const refresh=useCallback(async()=>{
    const result=await api<{conversations:Summary[]}>('/api/chat/list')
    setList(result.conversations)
    setSelected(old=>result.conversations.some(v=>v.id===old)?old:(result.conversations[0]?.id||''))
  },[])
  useEffect(()=>{void refresh().catch(e=>setError(String(e)))},[refresh])
  useEffect(()=>{
    if(!selected){setDraft(null);setOriginal(null);setInfo(null);return}
    let alive=true
    setDraft(null);setOriginal(null);setNotice('')
    void api<Conversation>('/api/chat/conversation?id='+encodeURIComponent(selected)).then(c=>{
      if(!alive)return
      const value={system_prompt:c.system_prompt,context_tokens:c.context_tokens,reply_tokens:c.reply_tokens,temperature:c.temperature}
      setDraft(value);setOriginal(value)
      setInfo({messages:c.messages.length,compressed:c.summary_through})
      setError('')
    }).catch(e=>{if(alive)setError(String(e))})
    return()=>{alive=false}
  },[selected])
  const dirty=!!draft&&!!original&&JSON.stringify(draft)!==JSON.stringify(original)
  const save=async()=>{
    if(!draft||!selected||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      // Fetch the latest record first to avoid saving settings for a deleted chat.
      const latest=await api<Conversation>('/api/chat/conversation?id='+encodeURIComponent(selected))
      const result=await api<Conversation>('/api/chat/settings',{id:latest.id,...draft})
      const value={system_prompt:result.system_prompt,context_tokens:result.context_tokens,reply_tokens:result.reply_tokens,temperature:result.temperature}
      setOriginal(value);setDraft(value)
      setNotice('선택한 대화의 설정을 저장했어. 대화 기록과 기존 기억은 그대로야.')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  return <section className="control-card settings-form">
    <div className="row-spread"><h2>대화별 모델 설정</h2><button className="secondary" disabled={busy} onClick={()=>void refresh().catch(e=>setError(String(e)))}>대화 목록 새로고침</button></div>
    <p className="ctl-description">기존 채팅의 설정을 여기에서도 변경할 수 있어. 변경은 선택한 대화에만 저장되고, 메시지·압축 기억은 보존돼.</p>
    {error&&<div className="control-alert error">{error}</div>}{notice&&<p className="kwt-tree-notice">{notice}</p>}
    <label className="ctl-label">설정할 대화 선택<select className="kwt-chat-config-select" style={{display:'block',width:'100%',maxWidth:650,padding:'9px',background:'#171c27',color:'#e8ecf6',border:'1px solid #303745',borderRadius:8}} value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">대화를 선택해 줘</option>{list.map(x=><option key={x.id} value={x.id}>{x.title} ({x.message_count}개 메시지)</option>)}</select></label>
    {draft&&<>
      <div className="kwt-tree-fields">
        <label>대화 컨텍스트 토큰<select value={draft.context_tokens} onChange={e=>setDraft({...draft,context_tokens:Number(e.target.value)})}>{[4096,8192,16384,32768].map(v=><option key={v} value={v}>{v.toLocaleString()} 토큰</option>)}</select></label>
        <label>답변 출력 토큰 (0 = 자동)<input type="number" min={0} max={draft.context_tokens-1024} step={128} value={draft.reply_tokens} onChange={e=>setDraft({...draft,reply_tokens:Number(e.target.value)})}/></label>
        <label>Temperature<input type="number" min={0} max={2} step={0.05} value={draft.temperature} onChange={e=>setDraft({...draft,temperature:Number(e.target.value)})}/></label>
      </div>
      <label className="kwt-tree-prompt">시스템 프롬프트<textarea rows={5} maxLength={3000} value={draft.system_prompt} onChange={e=>setDraft({...draft,system_prompt:e.target.value})}/></label>
      {draft.context_tokens>serverContext&&<p className="kwt-tree-warning">현재 Gemma 실행 설정의 컨텍스트는 {serverContext.toLocaleString()}토큰이야. 대화에 {draft.context_tokens.toLocaleString()}토큰을 설정해도 서버의 실제 컨텍스트가 늘어나지는 않아. AI 서버 실행 설정도 맞춰 줘.</p>}
      <p className="ctl-description">저장된 대화 메시지 {info?.messages??0}개 · 이미 요약한 메시지 {info?.compressed??0}개</p>
      <div className="kwt-tree-bottom"><span>{dirty?'대화 설정이 변경되었어.':'대화 설정 저장 상태 최신'}</span><button className="primary" disabled={busy||!dirty||!draft.system_prompt.trim()} onClick={()=>void save()}>{busy?'저장 중...':'선택한 대화 설정 저장'}</button></div>
    </>}
    {!list.length&&<p className="ctl-description">저장된 채팅이 없어. 로컬 채팅 탭에서 대화를 만들면 이곳에서 선택할 수 있어.</p>}
  </section>
}
