import {useCallback,useEffect,useState} from 'react'
import {motion} from 'motion/react'
import {api} from './api'
import {Puzzle,RefreshCw,Copy,Link2,Link2Off,Save,Plus,Trash2,ShieldCheck,AlertTriangle} from 'lucide-react'
import './extension.css'

type Rule={id:string;name:string;pattern:string;selector:string;enabled:boolean;autoSend:boolean;[key:string]:unknown}
type Settings={rules:Rule[];serverUrl:string;kwtLocalUrl:string;kwtLocalModel:string;
  kwtSiteOriginsV3:string[];kwtImageHostOriginsV3:string[];kwtMissingImageHostsV1:string[]}
type SyncState={paired:boolean;extension_id:string;revision:number;settings:Settings;connected:boolean;
  last_seen:number;last_sync?:number;last_activity?:number;granted_origins:string[];pair_code_active:boolean}
const blank:Settings={rules:[],serverUrl:'http://127.0.0.1:8765',kwtLocalUrl:'http://127.0.0.1:18080/v1',
  kwtLocalModel:'gemma4-12b-local',kwtSiteOriginsV3:[],kwtImageHostOriginsV3:[],kwtMissingImageHostsV1:[]}
type Tab='rules'|'connection'|'permissions'

export default function ExtensionCenter(){
  const [tab,setTab]=useState<Tab>('rules')
  const [remote,setRemote]=useState<SyncState|null>(null)
  const [form,setForm]=useState<Settings>(blank)
  const [changed,setChanged]=useState(false)
  const [busy,setBusy]=useState(false)
  const [code,setCode]=useState('')
  const [error,setError]=useState('')
  const [note,setNote]=useState('')
  const errorText=(error:unknown)=>{
    const raw=error instanceof Error?error.message:String(error)
    if(/Unknown endpoint|\bHTTP 404\b/i.test(raw))
      return 'Studio 화면은 V1.3이지만 실행 중인 Python Bridge는 확장앱 관리 API를 지원하지 않아. Studio와 기존 Bridge를 종료하고 RUN_STUDIO.bat을 다시 실행해 줘. (V1.3.1은 구버전 Bridge를 자동 감지해.)'
    return raw
  }

  const refresh=useCallback(async(force=false)=>{
    const state=await api<SyncState>('/api/extension/studio/state')
    setRemote(state)
    if(!changed||force){setForm(state.settings);setChanged(false)}
  },[changed])
  useEffect(()=>{void refresh().catch(e=>setError(errorText(e)))},[])
  useEffect(()=>{const timer=window.setInterval(()=>void refresh().catch(()=>{}),4500);return()=>clearInterval(timer)},[refresh])
  const patch=(next:Partial<Settings>)=>{setForm(prev=>({...prev,...next}));setChanged(true);setNote('')}
  const run=async(task:()=>Promise<void>)=>{
    if(busy)return
    setBusy(true);setError('');setNote('')
    try{await task()}
    catch(e){setError(errorText(e))}
    finally{setBusy(false)}
  }
  const save=()=>run(async()=>{
    if(!remote)throw Error('Bridge 연결이 필요합니다.')
    const result=await api<{revision:number;settings:Settings}>('/api/extension/studio/save',{
      base_revision:remote.revision,settings:form
    })
    setRemote(r=>r?{...r,revision:result.revision,settings:result.settings}:r)
    setForm(result.settings);setChanged(false)
    setNote(remote.paired?'저장 완료. Chrome 확장앱에서 동기화되면 적용됩니다.':'Studio에 저장했어요. Chrome 연결 후 적용됩니다.')
  })
  const generate=()=>run(async()=>{
    const result=await api<{code:string;expires_seconds:number}>('/api/extension/studio/pair-code',{})
    setCode(result.code);setNote('Chrome 확장앱의 설정 페이지에서 이 8자리 코드를 입력하세요. 유효 기간 10분.')
    await refresh()
  })
  const unpair=()=>{
    if(!window.confirm('Studio와 Chrome 확장앱의 연결만 해제할까요? Chrome 규칙과 권한은 삭제되지 않습니다.'))return
    void run(async()=>{await api('/api/extension/studio/unpair',{});setCode('');await refresh(true);setNote('Studio 연결 해제됨. Chrome 확장앱에서도 연결 해제를 눌러 주세요.')})
  }
  const editRule=(id:string,changes:Partial<Rule>)=>patch({rules:form.rules.map(r=>r.id===id?{...r,...changes}:r)})
  const addRule=()=>patch({rules:[...form.rules,{id:'studio-'+(crypto.randomUUID?.()||Date.now().toString()),name:'새 규칙',pattern:'https://example.com/*',selector:'img',enabled:false,autoSend:false}]})
  const deleteRule=(id:string)=>{if(window.confirm('이 수집 규칙을 삭제할까요?'))patch({rules:form.rules.filter(r=>r.id!==id)})}
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setNote('클립보드에 복사했습니다.')}catch{setNote('복사 실패. 값을 직접 복사해 주세요.')}}
  const canSave=!!remote&&changed&&!busy
  const isGranted=(origin:string)=>remote?.granted_origins.some(p=>p===origin+'/*'||p===origin||p==='https://*/*'||p==='http://*/*')||false
  return <main className="control-center scroll extension-console">
    <div className="control-heading"><div><span className="eyebrow">Chrome 확장 프로그램 · 통합 관리</span><h1>웹 확장앱 관리</h1>
      <p>사이트 수집 규칙과 로컬 서버 연결 설정을 Studio와 Chrome에서 같이 관리해.</p></div>
      <button className="subtle-btn" onClick={()=>void run(()=>refresh(true))}><RefreshCw size={15}/>새로고침</button>
    </div>
    {error&&<div className="control-alert error"><AlertTriangle size={17}/>{error}<button onClick={()=>setError('')}>닫기</button></div>}
    {note&&<div className="control-alert success">{note}</div>}
    <div className="ext-summary"><div><Puzzle size={21}/><span>{remote?.paired?'확장앱 연결됨':'확장앱 연결 전'}</span></div>
      <span className={remote?.connected?'ext-connected':'ext-disconnected'}>{/* KWT_EXTENSION_PRESENCE_V2_0_3 */}{!remote?.paired?'Chrome 연결 전':remote.connected?'Chrome 최근 활동 확인됨':remote.last_seen?'페어링 유지 · 최근 활동 대기':'페어링 완료 · 첫 동기화 대기'}</span>
      <span>동기화 버전 {remote?.revision??'-'}</span>
      <span className="ext-muted">{remote?.last_seen?`마지막 활동 ${new Date(remote.last_seen*1000).toLocaleString('ko-KR')}`:'활동 기록 없음'}</span>
      <span className="ext-muted">{remote?.last_sync?`마지막 설정 동기화 ${new Date(remote.last_sync*1000).toLocaleString('ko-KR')}`:'설정 동기화 기록 없음'}</span>
    </div>
    <div className="ext-tabs">
      {([['rules','사이트 수집 규칙'],['connection','서버 · 동기화'],['permissions','사이트 · CDN 권한']] as const).map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}
    </div>
    <motion.div key={tab} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.18}} className="control-content">
      {tab==='rules'&&<section className="control-card">
        <div className="row-spread"><div><h2>자동 이미지 수집 규칙</h2><p className="ctl-description">Chrome에서 저장한 URL 패턴 / CSS 선택자와 동일한 규칙을 수정해. 설정 변경은 연결된 확장앱에 동기화돼.</p></div>
          <button className="secondary" onClick={addRule}><Plus size={15}/>규칙 추가</button></div>
        <div className="ext-rule-table"><div className="ext-rule-head"><span>이름</span><span>URL 패턴</span><span>CSS 선택자</span><span>사용/자동</span><span>삭제</span></div>
          {form.rules.map(rule=><div className="ext-rule-row" key={rule.id}>
            <input aria-label="규칙 이름" value={rule.name} onChange={e=>editRule(rule.id,{name:e.target.value})}/>
            <input aria-label="URL 패턴" spellCheck={false} value={rule.pattern} onChange={e=>editRule(rule.id,{pattern:e.target.value})}/>
            <input aria-label="CSS 선택자" spellCheck={false} value={rule.selector} onChange={e=>editRule(rule.id,{selector:e.target.value})}/>
            <div className="ext-flags"><label title="수집 규칙 활성화"><input type="checkbox" checked={rule.enabled} onChange={e=>editRule(rule.id,{enabled:e.target.checked})}/> 활성</label>
              <label title="웹페이지에서 자동 수집"><input type="checkbox" checked={rule.autoSend} onChange={e=>editRule(rule.id,{autoSend:e.target.checked})}/> 자동</label></div>
            <button title="규칙 삭제" className="ext-trash" onClick={()=>deleteRule(rule.id)}><Trash2 size={17}/></button>
          </div>)}
          {!form.rules.length&&<div className="ext-empty">아직 수집 규칙이 없어. 확장앱을 연결하면 기존 Chrome 규칙을 가져올 수 있어.</div>}
        </div>
        <p className="ctl-description">주의: 새 사이트에서 자동 실행하려면 확장앱에서 해당 사이트 권한을 먼저 승인해야 해. URL 규칙 저장만으로 Chrome 권한이 추가되지는 않아.</p>
      </section>}
      {tab==='connection'&&<>
        <section className="control-card"><h2><Link2 size={17}/>Chrome 확장앱 연결</h2>
          <p className="ctl-description">첫 연결에 한해 Studio에서 코드를 발급한 뒤 Chrome 확장앱의 옵션 페이지에 입력해. Chrome의 기존 저장 규칙을 덮어쓰지 않고 먼저 동기화해.</p>
          {remote?.paired?<div className="ext-paired"><ShieldCheck size={19}/><span>연결된 확장 ID: <code>{remote.extension_id}</code></span><button className="secondary" disabled={busy} onClick={unpair}><Link2Off size={15}/>연결 해제</button></div>:
          <div className="ext-pair"><button className="primary" onClick={()=>void generate()} disabled={busy}>8자리 연결 코드 발급</button>
            {code&&<div className="ext-code"><strong>{code}</strong><button onClick={()=>void copy(code)} title="코드 복사"><Copy size={17}/></button><span>10분간 유효</span></div>}</div>}
          <p className="ctl-description">Chrome 주소창에서 <code>chrome://extensions</code> → KoneWebTranslator → 확장 프로그램 옵션 → Studio 연결 항목을 열어.</p>
        </section>
        <section className="control-card settings-form"><h2>Chrome 확장앱의 로컬 서버 연결 설정</h2>
          <div className="settings-pair"><label>OCR API 주소<input value={form.serverUrl} spellCheck={false} onChange={e=>patch({serverUrl:e.target.value})}/></label>
            <label>Gemma API 주소<input value={form.kwtLocalUrl} spellCheck={false} onChange={e=>patch({kwtLocalUrl:e.target.value})}/></label></div>
          <label className="ctl-label">Gemma 모델 ID</label><input style={{width:'100%',maxWidth:520}} value={form.kwtLocalModel} onChange={e=>patch({kwtLocalModel:e.target.value})}/>
          <p className="ctl-description" style={{marginTop:14}}>모두 동일 PC의 localhost/127.0.0.1 주소만 허용해. Gemma 번역 프롬프트와 Temperature는 별도 '번역 설정' 메뉴에서 관리해.</p>
        </section>
      </>}
      {tab==='permissions'&&<>
        <section className="control-card"><h2>사이트 실행 권한</h2>
          <p className="ctl-description">Chrome에 저장된 사이트 목록과 실제 승인 여부를 비교한 결과야. 권한 승인/취소는 Chrome 확장앱의 옵션 페이지에서 진행해야 해.</p>
          <div className="ext-hosts">{form.kwtSiteOriginsV3.map(x=><div key={x}><span>{x}</span><b className={isGranted(x)?'ext-connected':'ext-disconnected'}>{isGranted(x)?'승인됨':'승인 필요'}</b></div>)}
            {!form.kwtSiteOriginsV3.length&&<div>등록된 사이트가 없어.</div>}</div>
        </section>
        <section className="control-card"><h2>이미지 CDN 접근 권한</h2><div className="ext-hosts">{form.kwtImageHostOriginsV3.map(x=><div key={x}><span>{x}</span><b className={isGranted(x)?'ext-connected':'ext-disconnected'}>{isGranted(x)?'승인됨':'승인 필요'}</b></div>)}
          {!form.kwtImageHostOriginsV3.length&&<div>등록된 CDN이 없어.</div>}</div></section>
        <section className="control-card"><h2>권한 요청 대기</h2><div className="ext-hosts">{form.kwtMissingImageHostsV1.map(x=><div key={x}><span>{x}</span><b className="ext-disconnected">Chrome 승인 필요</b></div>)}
          {!form.kwtMissingImageHostsV1.length&&<div>대기 중인 이미지 CDN 권한이 없어.</div>}</div></section>
      </>}
      <div className="ext-actions"><span>{changed?'저장되지 않은 변경이 있어.':'설정은 로컬 PC에만 저장돼.'}</span>
        <button className="primary" disabled={!canSave} onClick={()=>void save()}><Save size={16}/>설정 저장</button></div>
    </motion.div>
  </main>
}
