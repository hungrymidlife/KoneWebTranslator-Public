import {useCallback,useEffect,useRef,useState} from 'react'
import {motion,AnimatePresence} from 'motion/react'
import {api} from './api'
import {Play,Square,RefreshCw,CheckCircle2,AlertTriangle,Save,FolderOpen,Terminal,Server,ShieldCheck} from 'lucide-react'

// KWT_STUDIO_PREFERENCES_V1_6: persistent local view-only controls.
const mgrRead=(name:string, fallback:string)=>{try{return window.localStorage.getItem('kwt-studio-manager-'+name)||fallback}catch{return fallback}}
const mgrWrite=(name:string,value:string)=>{try{window.localStorage.setItem('kwt-studio-manager-'+name,value)}catch{}}

// KWT_STUDIO_FONTS_V1_7_0
// KWT_STUDIO_INSTALLER_V2_0_0
export type StudioSection='editor'|'servers'|'translation'|'ocr'|'logs'|'settings'|'extension'|'fonts'|'installer'
type EngineState={online:boolean;owned:boolean;pid:number|null;models?:string[];engine?:string}
type Status={gemma:EngineState;ocr:EngineState;log_seq:number}
type Settings={gemma_dir:string;prompt:string;temperature:number;max_tokens:number;ocr_mode:string;patches:number;confidence:number}
type LogLine={seq:number;time:string;message:string}
const INITIAL:Settings={gemma_dir:'C:\\AI\\Gemma4MTP',prompt:'',temperature:0.6,max_tokens:0,ocr_mode:'hayai',patches:384,confidence:0.3}

export function StatusDots({status}:{status:Status|null}){
  return <span className="status-pair">
    <span className={'status-dot-label '+(status?.gemma.online?'on':'')}><i/>Gemma {status?.gemma.online?'온라인':'오프라인'}</span>
    <span className={'status-dot-label '+(status?.ocr.online?'on':'')}><i/>OCR {status?.ocr.online?'온라인':'오프라인'}</span>
  </span>
}

export function useEngineStatus(){
  const [status,setStatus]=useState<Status|null>(null)
  const refresh=useCallback(async()=>{
    try{setStatus(await api<Status>('/api/manager/status'))}catch{setStatus(null)}
  },[])
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),3500);return()=>window.clearInterval(timer)},[refresh])
  return {status,refresh}
}

export default function ControlCenter({section,status,onStatusRefresh}:{section:StudioSection;status:Status|null;onStatusRefresh:()=>Promise<void>}){
  const [settings,setSettings]=useState<Settings>(INITIAL)
  const [loaded,setLoaded]=useState(false)
  const [mode,setMode]=useState<'MTP'|'Normal'>(()=>mgrRead('mode','MTP')==='Normal'?'Normal':'MTP')
  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>mgrWrite('mode',mode),[mode])
  const [lines,setLines]=useState<LogLine[]>([])
  const lastLog=useRef(0)
  const logEnd=useRef<HTMLDivElement>(null)
  const [autoScroll,setAutoScroll]=useState(()=>mgrRead('autoScroll','true')!=='false')
  // KWT_STUDIO_BLACK_SCREEN_FIX_V1_6_1
  useEffect(()=>mgrWrite('autoScroll',String(autoScroll)),[autoScroll])
  // KWT_STUDIO_LOG_POLICY_V1_4
  const [logPolicy,setLogPolicy]=useState({enabled:false,max_mb:100,days:7,size_bytes:0,file_count:0,folder:'',limitation:''})
  const reloadLogPolicy=useCallback(async()=>{try{setLogPolicy(await api<typeof logPolicy>('/api/manager/log-policy'))}catch(e){setError(String(e))}},[])
  useEffect(()=>{void reloadLogPolicy();const id=window.setInterval(()=>void reloadLogPolicy(),6000);return()=>window.clearInterval(id)},[reloadLogPolicy])
  const saveLogPolicy=()=>void run('로그 보관 정책 저장',async()=>{setLogPolicy(await api<typeof logPolicy>('/api/manager/log-policy',logPolicy))})
  const clearLogFiles=()=>{if(!window.confirm('기존 Gemma/OCR 로그 파일을 모두 비울까요? 실행 중인 서버는 종료하지 않습니다.'))return;void run('로그 파일 비우기',async()=>{setLogPolicy(await api<typeof logPolicy>('/api/manager/clear-logs',{}))})}

  const fetchSettings=useCallback(async()=>{
    const data=await api<Settings>('/api/manager/settings')
    setSettings(data);setLoaded(true)
  },[])
  useEffect(()=>{void fetchSettings().catch(e=>setError(String(e)))},[fetchSettings])
  useEffect(()=>{
    const poll=async()=>{
      try{
        const data=await api<{entries:LogLine[];last_seq:number}>(`/api/manager/logs?after=${lastLog.current}`)
        if(data.entries.length){setLines(prev=>[...prev,...data.entries].slice(-450));lastLog.current=data.last_seq}
      }catch{/* The bridge can restart while UI remains open. */}
    }
    void poll();const id=window.setInterval(()=>void poll(),1700)
    return()=>window.clearInterval(id)
  },[])
  useEffect(()=>{if(autoScroll&&section==='logs')logEnd.current?.scrollIntoView({block:'end',behavior:'smooth'})},[lines,autoScroll,section])

  const run=async(label:string,action:()=>Promise<unknown>)=>{
    if(busy)return
    setBusy(label);setMessage('');setError('')
    try{await action();setMessage(`${label} 완료`);await onStatusRefresh()}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy('')}
  }
  const save=(kind:'gemma'|'translation'|'ocr')=>run('설정 저장',async()=>{
    await api('/api/manager/save',{kind,...settings});await fetchSettings()
  })
  const start=(server:'gemma'|'ocr')=>run(`${server==='gemma'?'Gemma':'OCR'} 시작`,async()=>{
    await api('/api/manager/start',{server,mode});
  })
  const stop=(server:'gemma'|'ocr')=>{
    if(!window.confirm(`Studio가 시작한 ${server==='gemma'?'Gemma':'OCR'} 서버를 종료할까요? 진행 중인 작업이 중단될 수 있습니다.`))return
    void run('서버 종료',async()=>{await api('/api/manager/stop',{server})})
  }
  const browseGemma=async()=>{
    try{
      const {isTauri}=await import('@tauri-apps/api/core')
      if(!isTauri()){setMessage('웹 모드에서는 폴더 경로를 직접 입력해 줘.');return}
      const {open}=await import('@tauri-apps/plugin-dialog')
      const path=await open({directory:true,multiple:false,title:'Gemma 설치 폴더 선택'})
      if(typeof path==='string')setSettings(p=>({...p,gemma_dir:path}))
    }catch(e){setError(String(e))}
  }
  const patch=(delta:Partial<Settings>)=>setSettings(p=>({...p,...delta}))
  const ready=loaded&&!busy
  const names:Record<StudioSection,string>={editor:'번역 · 검수 · 편집',servers:'AI 서버 관리',translation:'번역 설정',ocr:'OCR 설정',logs:'로그 · 진단',settings:'환경 설정',extension:'웹 확장앱 관리',fonts:'폰트 관리',installer:'설치 · 환경 점검'}
  return <main className="control-center scroll">
    <div className="control-heading"><div><span className="eyebrow">통합 관리 콘솔</span><h1>{names[section]}</h1><p>현재 Studio에서 Gemma 번역과 OCR 엔진을 함께 관리해.</p></div><button className="subtle-btn" onClick={()=>void run('상태 새로고침',async()=>{await Promise.all([onStatusRefresh(),fetchSettings()])})}><RefreshCw size={16}/>새로고침</button></div>
    {error&&<div className="control-alert error"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError('')}>닫기</button></div>}
    {message&&<div className="control-alert success"><CheckCircle2 size={17}/>{message}</div>}
    <AnimatePresence mode="wait"><motion.div key={section} initial={{opacity:0,y:9}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:.17}} className="control-content">
      {section==='servers'&&<>
        <div className="engine-grid">
          <section className="control-card engine-card">
            <div className="card-heading"><div className="engine-icon"><Server size={22}/></div><div><h2>Gemma 4 12B</h2><span>llama.cpp · 127.0.0.1:18080</span></div><span className={'engine-badge '+(status?.gemma.online?'online':'')}>{status?.gemma.online?'온라인':'오프라인'}</span></div>
            <div className="engine-detail"><span>현재 모델</span><strong>{status?.gemma.models?.join(', ')||'연결되지 않음'}</strong></div>
            <div className="engine-detail"><span>실행 주체</span><strong>{status?.gemma.owned?`Studio PID ${status.gemma.pid}`:status?.gemma.online?'외부 서버':'대기'}</strong></div>
            <label className="ctl-label">실행 모드</label><div className="ctl-segments"><button className={mode==='MTP'?'active':''} onClick={()=>setMode('MTP')}>MTP 가속</button><button className={mode==='Normal'?'active':''} onClick={()=>setMode('Normal')}>일반 모드</button></div>
            <div className="control-buttons"><button className="primary" disabled={!!busy||!!status?.gemma.online} onClick={()=>void start('gemma')}><Play size={15}/>서버 시작</button><button className="secondary" disabled={!!busy||!status?.gemma.owned} onClick={()=>stop('gemma')}><Square size={14}/>Studio 서버 종료</button></div>
          </section>
          <section className="control-card engine-card">
            <div className="card-heading"><div className="engine-icon"><Server size={22}/></div><div><h2>Hayai OCR</h2><span>로컬 OCR · 127.0.0.1:8765</span></div><span className={'engine-badge '+(status?.ocr.online?'online':'')}>{status?.ocr.online?'온라인':'오프라인'}</span></div>
            <div className="engine-detail"><span>현재 OCR 엔진</span><strong>{status?.ocr.engine||'연결되지 않음'}</strong></div>
            <div className="engine-detail"><span>실행 주체</span><strong>{status?.ocr.owned?`Studio PID ${status.ocr.pid}`:status?.ocr.online?'외부 서버':'대기'}</strong></div>
            <p className="ctl-description">OCR 서버는 기존 local-server/server.py를 실행해. GPU 옵션도 기존 관리자의 기본 설정을 유지해.</p>
            <div className="control-buttons"><button className="primary" disabled={!!busy||!!status?.ocr.online} onClick={()=>void start('ocr')}><Play size={15}/>서버 시작</button><button className="secondary" disabled={!!busy||!status?.ocr.owned} onClick={()=>stop('ocr')}><Square size={14}/>Studio 서버 종료</button></div>
          </section>
        </div>
        <section className="control-card"><h2>Gemma 설치 폴더</h2><p className="ctl-description">이 경로의 Launch.ps1을 이용해 서버를 실행해. 서버 모드 변경은 재시작이 필요해.</p><div className="ctl-inline"><input value={settings.gemma_dir} onChange={e=>patch({gemma_dir:e.target.value})}/><button className="secondary" onClick={()=>void browseGemma()}><FolderOpen size={16}/>찾기</button><button className="primary" onClick={()=>void save('gemma')} disabled={!ready}><Save size={15}/>경로 저장</button></div></section>
        <section className="control-card"><div className="row-spread"><h2>서버 로그 미리보기</h2><span className="muted">최근 기록 {lines.length}개</span></div><div className="console-preview">{lines.slice(-9).map(l=><div key={l.seq}><time>{l.time}</time> {l.message}</div>)}{!lines.length&&'로그를 기다리는 중...'}</div></section>
      </>}
      {section==='translation'&&<section className="control-card settings-form"><div className="row-spread"><div><h2>Gemma 번역 프롬프트</h2><p className="ctl-description">번역 규칙은 저장 직후 다음 요청부터 반영돼. JSON 출력 규칙과 영역 ID 보존 규칙은 Python 처리 코드에서 추가돼.</p></div><span className="engine-badge">Gemma</span></div>
        <label className="ctl-label" htmlFor="translation-prompt">번역 프롬프트</label><textarea id="translation-prompt" className="prompt-editor" spellCheck={false} value={settings.prompt} onChange={e=>patch({prompt:e.target.value})}/>
        <div className="settings-pair"><label>Temperature<input type="number" min="0" max="2" step="0.05" value={settings.temperature} onChange={e=>patch({temperature:Number(e.target.value)})}/></label><label>최대 출력 토큰 (0 = 자동)<input type="number" min="0" max="2304" step="1" value={settings.max_tokens} onChange={e=>patch({max_tokens:Number(e.target.value)})}/></label></div>
        <div className="row-spread"><p className="ctl-description">기존 번역 캐시는 설정 해시가 변경된 경우에만 새로 계산될 수 있어.</p><button className="primary" disabled={!ready} onClick={()=>void save('translation')}><Save size={16}/>번역 설정 저장</button></div>
      </section>}
      {section==='ocr'&&<section className="control-card settings-form"><h2>Hayai OCR · 텍스트 검출</h2><p className="ctl-description">새 OCR 작업부터 적용돼. 이미 저장한 OCR 결과와 번역 메타데이터는 변경하지 않아.</p>
        <div className="settings-pair"><label>OCR 엔진<input readOnly value="Hayai OCR (Windows OCR 조건부 보조)" /></label><label>Hayai 패치 크기<select value={settings.patches} onChange={e=>patch({patches:Number(e.target.value)})}><option value={256}>256</option><option value={384}>384</option><option value={512}>512</option></select></label></div>
        <div className="ocr-slider"><div className="row-spread"><label className="ctl-label">텍스트 검출 신뢰도</label><strong>{settings.confidence.toFixed(2)}</strong></div><input type="range" min={0.05} max={0.9} step={0.01} value={settings.confidence} onChange={e=>patch({confidence:Number(e.target.value)})}/><p className="ctl-description">권장 실험 범위: 0.25 ~ 0.40 · 최소 0.05 · 0.00은 과도한 영역 검출 방지를 위해 제한</p></div>
        <div className="row-spread"><span className="muted">OCR 모델과 서버 코드는 그대로 유지</span><button className="primary" disabled={!ready} onClick={()=>void save('ocr')}><Save size={16}/>OCR 설정 저장</button></div>
      </section>}
      {section==='logs'&&<section className="control-card settings-form"><h2>로그 파일 관리</h2><p className="ctl-description">기본 파일 보관 OFF · 서버 재시작 없이 변경 가능 · 디스크 누적 자동 정리</p><label className="check-label"><input type="checkbox" checked={logPolicy.enabled} onChange={e=>setLogPolicy(p=>({...p,enabled:e.target.checked}))}/>로그 파일 보관 ON/OFF</label><div className="settings-pair"><label>보관 기간<select value={logPolicy.days} onChange={e=>setLogPolicy(p=>({...p,days:Number(e.target.value)}))}><option value={1}>1일</option><option value={7}>7일</option><option value={30}>30일</option></select></label><label>최대 용량<select value={logPolicy.max_mb} onChange={e=>setLogPolicy(p=>({...p,max_mb:Number(e.target.value)}))}><option value={50}>50 MB</option><option value={100}>100 MB</option><option value={500}>500 MB</option><option value={1024}>1 GB</option></select></label></div><p className="ctl-description">저장 파일 {logPolicy.file_count}개 · {(logPolicy.size_bytes/1048576).toFixed(2)} MB</p><p className="ctl-description" style={{overflowWrap:'anywhere'}}>경로: {logPolicy.folder}</p><p className="ctl-description">{logPolicy.limitation}</p><div className="control-buttons"><button className="primary" disabled={!!busy} onClick={saveLogPolicy}><Save size={15}/>정책 저장</button><button className="secondary" disabled={!!busy} onClick={clearLogFiles}>로그 파일 전체 비우기</button><button className="secondary" onClick={()=>void reloadLogPolicy()}>용량 새로고침</button></div></section>}
      {section==='logs'&&<section className="control-card log-card"><div className="row-spread"><div><h2><Terminal size={19}/>Gemma / OCR 실행 로그</h2><p className="ctl-description">Studio가 직접 시작한 서버의 콘솔 출력과 작업 관리 이벤트를 보여줘. 이미 외부에서 실행된 서버의 콘솔은 읽을 수 없어.</p></div><label className="check-label"><input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)}/>자동 스크롤</label></div><div className="console-full scroll">{lines.map(l=><div key={l.seq}><time>{l.time}</time> {l.message}</div>)}<div ref={logEnd}/></div><div className="row-spread"><span className="muted">최근 {lines.length}개 표시 · 서버당 로그 스트림 통합</span><button className="secondary" onClick={()=>{setLines([]);lastLog.current=0}}>로그 다시 불러오기</button></div></section>}
      {section==='settings'&&<><section className="control-card"><h2>프로젝트 구조</h2><p className="ctl-description">새 통합 Studio GUI와 기존 번역 엔진을 구분해 관리해.</p><div className="setting-path"><strong>studio/</strong><span>React · Tauri · 편집기</span></div><div className="setting-path"><strong>studio-bridge/</strong><span>로컬 API · 서버 프로세스 관리</span></div><div className="setting-path"><strong>local-server/</strong><span>Gemma 설정 · OCR 엔진</span></div><div className="setting-path"><strong>local-trans/</strong><span>자동 ZIP 번역 · LaMa · 식질</span></div></section><section className="control-card"><h2><ShieldCheck size={18}/>안전한 실행 원칙</h2><p className="ctl-description">서버는 127.0.0.1에서만 접근하고, Studio가 실행하지 않은 서버는 종료하지 않아. 기존 Tkinter 도구는 검증 기간 동안 삭제하지 않아.</p></section></>}
    </motion.div></AnimatePresence>
  </main>
}
