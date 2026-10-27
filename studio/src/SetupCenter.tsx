import {useCallback,useEffect,useState} from 'react'
import {api} from './api'
import {CheckCircle2,AlertTriangle,Download,RefreshCw,FlaskConical,LoaderCircle,HardDrive,FolderOpen,ExternalLink,Copy,Puzzle} from 'lucide-react'

// KWT_STUDIO_INSTALLER_V2_0_0: status is from the connected local Bridge.
type Item={id:string;name:string;description:string;detected:boolean;detail:string;optional?:boolean;installable?:boolean;unknown?:boolean}
type Job={id:string;task:string;action:'install'|'test';step:string;state:'running'|'completed'|'failed';message:string;started:number;ended:number|null;lines:string[]}
type Snapshot={project_root:string;studio_ready:boolean;items:Item[];job:Job|null;notes:string[]}

export default function SetupCenter({onOpenExtension}:{onOpenExtension:()=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [error,setError]=useState('')
  const [confirmed,setConfirmed]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  // KWT_EXTENSION_PRESENCE_V2_0_3: pairing and authenticated activity are separate from installation.
  const [chromePair,setChromePair]=useState<{paired:boolean;connected:boolean;last_seen:number}|null>(null)
  const [chromeNotice,setChromeNotice]=useState('')
  const checkChromePair=useCallback(async()=>{
    try{setChromePair(await api<{paired:boolean;connected:boolean;last_seen:number}>('/api/extension/studio/state'))}
    catch{setChromePair(null)}
  },[])
  useEffect(()=>{
    void checkChromePair()
    const timer=window.setInterval(()=>void checkChromePair(),12000)
    return()=>window.clearInterval(timer)
  },[checkChromePair])
  const openChromeGuide=async(action:'folder'|'chrome')=>{
    setError('');setChromeNotice('')
    try{
      await api('/api/installer/chrome-action',{action})
      setChromeNotice(action==='folder'?'확장앱 폴더를 Windows 탐색기에서 열었어.':'Chrome 확장 프로그램 관리 화면을 열었어.')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  const extensionPath=snapshot?.project_root?snapshot.project_root+'\\extension':''
  const copyExtensionPath=async()=>{
    if(!extensionPath)return
    try{await navigator.clipboard.writeText(extensionPath);setChromeNotice('확장앱 폴더 경로를 복사했어.');setError('')}
    catch{setError('경로 복사가 차단됐어. 아래에 표시된 경로를 직접 복사해 줘.')}
  }
  const reload=useCallback(async()=>{
    const data=await api<Snapshot>('/api/installer/status')
    setSnapshot(data)
  },[])
  useEffect(()=>{
    let alive=true
    const poll=async()=>{
      try{const s=await api<Snapshot>('/api/installer/status');if(alive){setSnapshot(s);setError('')}}
      catch(e){if(alive)setError(e instanceof Error?e.message:String(e))}
    }
    void poll()
    const timer=window.setInterval(()=>void poll(),1800)
    return()=>{alive=false;window.clearInterval(timer)}
  },[])
  const run=async(task:string,action:'install'|'test')=>{
    if(busy||snapshot?.job?.state==='running')return
    setBusy(true);setError('');setConfirmed(null)
    try{await api('/api/installer/run',{task,action});await reload()}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const running=busy||snapshot?.job?.state==='running'
  const chosen=snapshot?.items.find(i=>i.id===confirmed)
  return <main className="control-center scroll kwt-installer">
    <div className="control-heading"><div><span className="eyebrow">처음 사용자 설정 · 설치 안내</span><h1>설치 · 환경 점검</h1>
      <p>Studio를 먼저 실행하고, OCR·번역·이미지 복원 모델을 필요한 순서로 설치한 뒤 실제 동작을 검사해.</p></div>
      <button className="subtle-btn" type="button" onClick={()=>void reload().catch(e=>setError(String(e)))}><RefreshCw size={16}/>상태 갱신</button>
    </div>
    {error&&<div className="control-alert error"><AlertTriangle size={17}/><span>{error.includes('Unknown endpoint')?'이 Studio Bridge는 설치 관리 API를 지원하지 않아. 새 패치를 적용한 뒤 Bridge를 완전히 종료하고 Studio를 다시 실행해 줘.':error}</span></div>}
    <section className="control-card kwt-install-intro">
      <div><strong>현재 설치 대상</strong><code>{snapshot?.project_root||'Bridge 연결 확인 중'}</code></div>
      <div><strong>Studio 기본 환경</strong><span className={snapshot?.studio_ready?'kwt-install-ok':'kwt-install-warning'}>{snapshot?.studio_ready?'기본 설치 완료':'기본 설치 필요 · START_STUDIO_SETUP.bat'}</span></div>
      <p>이 화면의 설치는 위 프로젝트 경로에 적용돼. 모델 다운로드 시 인터넷과 디스크 공간이 필요하며, 설치 중인 서버를 강제 종료하지 않아.</p>
    </section>
    {/* KWT_CHROME_EXTENSION_GUIDE_V2_0_2: unpacked extension setup, never silent browser installation. */}
    <section className="control-card kwt-chrome-install" aria-labelledby="kwt-chrome-install-title">
      <div className="kwt-chrome-install-header"><div><h2 id="kwt-chrome-install-title">Chrome 확장앱 설치 (무료)</h2>
        <p>Chrome 웹 스토어 등록 없이 프로젝트의 extension 폴더를 직접 불러오는 방법이야.</p></div>
        <span className={chromePair?.paired?'kwt-install-ok':'kwt-install-warning'}>{chromePair?.paired?'Studio 페어링 완료':'Studio 연결 필요'}</span></div>
      <ol className="kwt-chrome-install-steps">
        <li><strong>확장앱 폴더 열기</strong>를 눌러 현재 프로젝트의 <code>extension</code> 폴더를 확인해.</li>
        <li><strong>Chrome 확장 프로그램 관리</strong>를 연 다음 오른쪽 위 <strong>개발자 모드</strong>를 켜.</li>
        <li><strong>압축해제된 확장 프로그램을 로드합니다</strong>를 누르고, 1단계의 <code>extension</code> 폴더를 선택해.</li>
        <li><strong>Studio 연결 설정</strong>에서 연결 코드를 발급해 Chrome KoneWebTranslator 확장 프로그램의 옵션 화면에 입력해.</li>
        <li>사용할 사이트의 권한을 승인하고 실제 웹 번역이 동작하는지 확인해.</li>
      </ol>
      <div className="kwt-chrome-install-path"><span>선택할 확장앱 폴더</span><code>{extensionPath||'Bridge 연결을 확인하고 있어...'}</code></div>
      <div className="kwt-chrome-install-buttons">
        <button type="button" className="primary" onClick={()=>void openChromeGuide('folder')}><FolderOpen size={15}/>확장앱 폴더 열기</button>
        <button type="button" className="secondary" onClick={()=>void openChromeGuide('chrome')}><ExternalLink size={15}/>Chrome 확장 프로그램 관리</button>
        <button type="button" className="secondary" onClick={()=>void copyExtensionPath()} disabled={!extensionPath}><Copy size={15}/>폴더 경로 복사</button>
        <button type="button" className="secondary" onClick={onOpenExtension}><Puzzle size={15}/>Studio 연결 설정</button>
      </div>
      {chromeNotice&&<p className="kwt-chrome-notice" role="status">{chromeNotice}</p>}
      <p className="kwt-chrome-pair-status">연결 상태: {chromePair?.paired?(chromePair.connected?'페어링됨 · 최근 활동 확인':'페어링됨 · 최근 활동 확인 대기'):'페어링 정보 없음 또는 Bridge 확인 대기'}
        {chromePair?.last_seen?' · 마지막 활동 '+new Date(chromePair.last_seen*1000).toLocaleString('ko-KR'):''}</p>
      <p className="kwt-installer-small">페어링은 Chrome 설치 여부를 직접 증명하지 않아. 확장앱을 로드한 후에도 폴더를 이동·삭제하지 마. 업데이트 후에는 Chrome 확장 프로그램 관리 화면에서 새로고침해.</p>
    </section>
    {([false,true] as const).map(optional=><section key={String(optional)} className="kwt-installer-group">
      <div className="kwt-installer-heading"><h2>{optional?'선택 · 보조 기능':'필수 구성요소'}</h2>
        {!optional&&<button className="secondary" type="button" disabled={!!running} onClick={()=>void run('all','test')}><FlaskConical size={16}/>필수 항목 전체 검사</button>}</div>
      {optional&&<p className="kwt-installer-small kwt-installer-optional-note">Windows OCR는 숫자·기호가 많은 영역에 쓰는 보조 기능이야. GPU 가속과 MTP도 별도로 점검할 수 있어.</p>}
      <div className="kwt-installer-list">
        {(snapshot?.items||[]).filter(item=>!!item.optional===optional).map(item=><section className="control-card kwt-installer-item" key={item.id}>
          <div className="kwt-installer-item-heading"><div className="kwt-installer-icon"><HardDrive size={19}/></div><div className="kwt-installer-item-name"><strong>{item.name}</strong><p>{item.description}</p></div>
            <span className={item.detected?'kwt-install-ok':'kwt-install-warning'}>{item.unknown?'검사 필요':item.detected?'파일 발견':'설치 필요'}</span>
          </div>
          <div className="kwt-installer-item-foot"><span>{item.detail} · 테스트 버튼으로 실행 검증</span>
            <div className="kwt-installer-buttons"><button className="secondary" disabled={!!running} onClick={()=>void run(item.id,'test')}><FlaskConical size={14}/>테스트</button>
              {item.installable!==false&&<button className="primary" disabled={!!running} onClick={()=>setConfirmed(item.id)}><Download size={14}/>{item.detected?'재설치 / 복구':'설치'}</button>}</div>
          </div>
        </section>)}
      </div>
    </section>)}
    {snapshot?.job&&<section className="control-card kwt-installer-job" aria-live="polite">
      <div className="kwt-installer-job-head"><h2>{snapshot.job.state==='running'?<LoaderCircle className="kwt-spinner" size={18}/>:snapshot.job.state==='completed'?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}
        {snapshot.job.action==='install'?'설치':'검사'} · {snapshot.job.step}</h2><span>{snapshot.job.state==='running'?'진행 중':snapshot.job.state==='completed'?'완료':'실패'}</span></div>
      <p>{snapshot.job.message}</p><pre className="kwt-installer-log">{snapshot.job.lines.slice(-120).join('\n')||'작업을 준비하고 있어...'}</pre>
      <p className="kwt-installer-small">이 기록은 Bridge에도 보존돼. 설치 화면을 벗어나더라도 진행 중인 명령은 완료까지 실행돼.</p>
    </section>}
    <section className="control-card kwt-installer-info"><h2>설치 참고 사항</h2>
      {(snapshot?.notes||[]).map((note,i)=><p key={i}>{note}</p>)}
      <p><b>Gemma:</b> 모델 다운로드 용량이 크고, 기본 경로는 C:\AI\Gemma4MTP야. 설치 후 좌측 AI 서버 관리에서 서버를 시작해.</p>
      <p><b>LaMa:</b> 복원 모델과 기본 Python의 PyTorch를 각각 설치해야 해. Hayai 전용 PyTorch만으로는 LaMa가 작동하지 않아.</p>
      <p><b>Windows OCR:</b> 언어팩은 UAC 관리자 승인이 필요하며 Windows Update를 사용해. Python WinRT 패키지와 언어팩을 각각 설치한 뒤 둘 다 테스트하고 OCR 서버를 재시작해.</p>
      <p><b>GPU 검사:</b> 드라이버를 자동 설치하지 않아. CUDA 테스트가 실패하면 NVIDIA 드라이버·GPU·설치된 PyTorch 버전을 직접 확인해.</p>
    </section>
    {chosen&&<div className="kwt-bridge-restart-backdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)setConfirmed(null)}}>
      <div className="kwt-bridge-restart-dialog" role="dialog" aria-modal="true" aria-labelledby="kwt-installer-confirm-heading">
        <h3 id="kwt-installer-confirm-heading">{chosen.name} 설치 확인</h3>
        <p>{chosen.description}</p>
        <p>{chosen.id==='winocr_lang'?'Windows 일본어 OCR 기능을 추가합니다. 관리자 권한(UAC) 승인과 Windows Update 연결이 필요할 수 있어.':'기존 프로젝트의 Python 환경 또는 모델 폴더를 변경할 수 있어. 설치 전에 OCR·Gemma 서버를 종료하고, 진행 중인 ZIP 작업을 끝내야 해.'}</p>
        <p>추가 데이터가 다운로드될 수 있어. 현재 설치 대상: {snapshot?.project_root}</p>
        <div className="kwt-bridge-restart-actions"><button type="button" onClick={()=>setConfirmed(null)}>취소</button><button className="primary" type="button" onClick={()=>void run(chosen.id,'install')}>설치 시작</button></div>
      </div>
    </div>}
  </main>
}
