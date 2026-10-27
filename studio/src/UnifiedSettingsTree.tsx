// KWT_UNIFIED_RUNTIME_V1: expandable unified settings, with live bridge persistence.
import {useCallback,useEffect,useState} from 'react'
import {api} from './api'

type Runtime = {
  schema_version: number
  gemma: {
    context_size:number; gpu_layers:number; flash_attention:'on'|'off'|'auto'
    parallel_slots:number; top_k:number; top_p:number; min_p:number; repeat_penalty:number
  }
  pipeline: {batch_pages:number; batch_raw_mb:number}
}
type Existing = {gemma_dir:string;prompt:string;temperature:number;max_tokens:number;ocr_mode:string;patches:number;confidence:number}
type Props = {
  legacy:Existing
  updateLegacy:(delta:Partial<Existing>)=>void
  saveLegacy:(kind:'gemma'|'translation'|'ocr')=>void
  ready:boolean
  mode:'MTP'|'Normal'
  setMode:(mode:'MTP'|'Normal')=>void
  browseGemma:()=>Promise<void>
  gemmaOnline:boolean
}

const DEFAULTS:Runtime={
  schema_version:1,
  gemma:{context_size:8192,gpu_layers:99,flash_attention:'on',parallel_slots:1,top_k:64,top_p:0.9,min_p:0.05,repeat_penalty:1.1},
  pipeline:{batch_pages:3,batch_raw_mb:22},
}
const FIELDS=[
  {key:'context_size',label:'모델 컨텍스트 길이',min:2048,max:131072,step:1024},
  {key:'gpu_layers',label:'GPU 오프로딩 레이어',min:0,max:999,step:1},
  {key:'parallel_slots',label:'병렬 요청 슬롯',min:1,max:16,step:1},
  {key:'top_k',label:'서버 기본 Top-K',min:0,max:200,step:1},
  {key:'top_p',label:'서버 기본 Top-P',min:0.01,max:1,step:0.01},
  {key:'min_p',label:'서버 기본 Min-P',min:0,max:1,step:0.01},
  {key:'repeat_penalty',label:'서버 기본 반복 페널티',min:1,max:2,step:0.01},
] as const

export default function UnifiedSettingsTree({legacy,updateLegacy,saveLegacy,ready,mode,setMode,browseGemma,gemmaOnline}:Props){
  const [runtime,setRuntime]=useState<Runtime>(DEFAULTS)
  const [defaults,setDefaults]=useState<Runtime>(DEFAULTS)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [dirty,setDirty]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const load=useCallback(async()=>{
    const result=await api<{values:Runtime;defaults:Runtime;stored:boolean}>('/api/manager/runtime-settings')
    setRuntime(result.values);setDefaults(result.defaults);setDirty(false)
  },[])
  useEffect(()=>{void load().catch(e=>setError(String(e))).finally(()=>setLoading(false))},[load])
  const gemmaChange=(key:keyof Runtime['gemma'],value:number|string)=>{
    setRuntime(prev=>({...prev,gemma:{...prev.gemma,[key]:value}}));setDirty(true);setNotice('')
  }
  const pipelineChange=(key:keyof Runtime['pipeline'],value:number)=>{
    setRuntime(prev=>({...prev,pipeline:{...prev.pipeline,[key]:value}}));setDirty(true);setNotice('')
  }
  const save=async()=>{
    if(saving||loading)return
    setSaving(true);setError('');setNotice('')
    try{
      const result=await api<{values:Runtime}>('/api/manager/runtime-settings',runtime)
      setRuntime(result.values);setDirty(false)
      setNotice('저장되었습니다. Gemma 옵션은 서버를 다음에 시작할 때, ZIP 옵션은 다음 ZIP 작업부터 적용됩니다.')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  }
  const reset=()=>{setRuntime(JSON.parse(JSON.stringify(defaults)) as Runtime);setDirty(true);setNotice('기본값이 입력되었습니다. 저장해야 반영됩니다.')}
  return <div className="kwt-settings-tree">
    <div className="control-card">
      <h2>통합 설정 트리</h2>
      <p className="ctl-description">그룹을 클릭하면 세부 설정이 열려. 모든 값은 디스크에 저장되며 Studio를 종료해도 유지돼. 기존 설정 탭도 계속 사용할 수 있어.</p>
      {loading&&<p className="ctl-description">통합 설정 불러오는 중...</p>}
      {error&&<div className="control-alert error">{error}</div>}
      {notice&&<p className="kwt-tree-notice">{notice}</p>}
      <div className="kwt-tree-toolbar">
        <span>{dirty?'저장되지 않은 통합 설정 변경 사항 있음':'통합 설정 저장 상태 최신'}</span>
        <button className="secondary" disabled={loading||saving} onClick={reset}>기본값 입력</button>
        <button className="secondary" disabled={loading||saving} onClick={()=>{setLoading(true);void load().catch(e=>setError(String(e))).finally(()=>setLoading(false))}}>저장값 다시 불러오기</button>
        <button className="primary" disabled={!dirty||loading||saving} onClick={()=>void save()}>{saving?'저장 중...':'통합 설정 저장'}</button>
      </div>
    </div>
    <details className="kwt-tree-group" open>
      <summary><span>01 · AI 서버 실행</span><small>Gemma 실행 옵션 · 서버 재시작 필요</small></summary>
      <div className="kwt-tree-body">
        {gemmaOnline&&<p className="kwt-tree-warning">현재 Gemma 서버가 실행 중이야. 여기서 저장해도 실행 중인 서버의 옵션은 변경되지 않아.</p>}
        <div className="kwt-tree-fields">
          {FIELDS.map(field=><label key={field.key}>{field.label}<input type="number" min={field.min} max={field.max} step={field.step} value={runtime.gemma[field.key]} disabled={loading} onChange={(e:{target:{value:string}})=>gemmaChange(field.key,Number(e.target.value))}/></label>)}
          <label>Flash Attention<select value={runtime.gemma.flash_attention} disabled={loading} onChange={(e:{target:{value:string}})=>gemmaChange('flash_attention',e.target.value)}><option value="on">ON</option><option value="off">OFF</option><option value="auto">AUTO</option></select></label>
          <label>서버 실행 모드<select value={mode} onChange={(e:{target:{value:string}})=>setMode(e.target.value as 'MTP'|'Normal')}><option value="Normal">Normal</option><option value="MTP">MTP</option></select></label>
        </div>
        <p className="ctl-description">모델 컨텍스트(-c), GPU(-ngl), Flash Attention(-fa), 슬롯(-np) 및 샘플링 기본값이 ai/Launch.ps1 실행에 연결돼. 슬롯 수는 요청 동시 처리 수와 별개야.</p>
        <div className="kwt-tree-inline"><label>Gemma 설치 경로<input value={legacy.gemma_dir} onChange={(e:{target:{value:string}})=>updateLegacy({gemma_dir:e.target.value})}/></label><button className="secondary" onClick={()=>void browseGemma()}>폴더 찾기</button><button className="secondary" disabled={!ready} onClick={()=>saveLegacy('gemma')}>경로 저장</button></div>
      </div>
    </details>
    <details className="kwt-tree-group" open>
      <summary><span>02 · 자동 ZIP 처리</span><small>다음 ZIP 작업부터 적용</small></summary>
      <div className="kwt-tree-body">
        <div className="kwt-tree-fields">
          <label>배치 이미지 수<input type="number" min={1} max={20} step={1} value={runtime.pipeline.batch_pages} disabled={loading} onChange={(e:{target:{value:string}})=>pipelineChange('batch_pages',Number(e.target.value))}/></label>
          <label>배치 최대 원본 데이터 (MB)<input type="number" min={4} max={22} step={1} value={runtime.pipeline.batch_raw_mb} disabled={loading} onChange={(e:{target:{value:string}})=>pipelineChange('batch_raw_mb',Number(e.target.value))}/></label>
        </div>
        <p className="ctl-description">동시 ZIP: 1개 / OCR 작업자: 1개 / 번역 작업자: 1개 (현재 구현에서는 고정). 이를 늘리는 기능은 GPU·작업 큐·저장 순서 검증 후 2단계에서 제공할 예정이야.</p>
        <p className="ctl-description">35 MB 서버 요청 상한을 고려해 배치 원본은 최대 22 MB로 제한해. 한 이미지가 이 제한보다 큰 경우에도 이미지 자체의 기존 18 MB 상한은 유지돼.</p>
      </div>
    </details>
    <details className="kwt-tree-group">
      <summary><span>03 · OCR / 텍스트 검출</span><small>기존 OCR 설정과 동일한 저장소 사용</small></summary>
      <div className="kwt-tree-body">
        <div className="kwt-tree-fields"><label>Hayai 패치 크기<select value={legacy.patches} onChange={(e:{target:{value:string}})=>updateLegacy({patches:Number(e.target.value)})}><option value={256}>256</option><option value={384}>384</option><option value={512}>512</option></select></label><label>검출 신뢰도 (0.05~0.90)<input type="number" min={0.05} max={0.9} step={0.01} value={legacy.confidence} onChange={(e:{target:{value:string}})=>updateLegacy({confidence:Number(e.target.value)})}/></label></div>
        <div className="kwt-tree-bottom"><span>추가 OCR 여백·검출 해상도 설정은 후속 단계</span><button className="secondary" disabled={!ready} onClick={()=>saveLegacy('ocr')}>OCR 설정 저장</button></div>
      </div>
    </details>
    <details className="kwt-tree-group">
      <summary><span>04 · 번역 설정</span><small>기존 번역 프로필과 공유 · 다음 요청부터</small></summary>
      <div className="kwt-tree-body">
        <label className="kwt-tree-prompt">번역 시스템 프롬프트<textarea value={legacy.prompt} rows={8} onChange={(e:{target:{value:string}})=>updateLegacy({prompt:e.target.value})}/></label>
        <div className="kwt-tree-fields"><label>Temperature<input type="number" min={0} max={2} step={0.05} value={legacy.temperature} onChange={(e:{target:{value:string}})=>updateLegacy({temperature:Number(e.target.value)})}/></label><label>최대 출력 토큰 (0 = 자동)<input type="number" min={0} max={2304} step={1} value={legacy.max_tokens} onChange={(e:{target:{value:string}})=>updateLegacy({max_tokens:Number(e.target.value)})}/></label></div>
        <div className="kwt-tree-bottom"><span>요청별 샘플링 및 재시도 정책은 후속 단계</span><button className="secondary" disabled={!ready} onClick={()=>saveLegacy('translation')}>번역 설정 저장</button></div>
      </div>
    </details>
    <details className="kwt-tree-group"><summary><span>05 · 로컬 채팅 / 기억</span><small>현재 채팅 탭에서 관리</small></summary><div className="kwt-tree-body"><p className="ctl-description">기존 채팅 설정·대화 기록은 건드리지 않아. 채팅 컨텍스트, 답변 토큰 및 기억 압축 상세 설정 통합은 별도 검증 후 진행할 예정이야.</p></div></details>
    <details className="kwt-tree-group"><summary><span>06 · 이미지 처리 / 식질</span><small>현재 설정 유지 · 후속 단계</small></summary><div className="kwt-tree-body"><p className="ctl-description">현재 폰트 관리와 검수 설정을 유지해. LaMa·폰트 자동 배치·ZIP 출력 고급값의 통합은 후속 단계에서 연결할 예정이야.</p></div></details>
  </div>
}
