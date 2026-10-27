// KWT_UNIFIED_NAV_TREE_V1_1: left-sidebar tree navigation, right-side single settings page.
// V1 runtime settings and original manager settings API remain unchanged.
import {useCallback,useEffect,useState} from 'react'
import {api} from './api'

export type SettingsGroup='overview'|'gemma'|'pipeline'|'ocr'|'translation'|'chat'|'typesetting'

type Runtime={
  schema_version:number
  gemma:{context_size:number;gpu_layers:number;flash_attention:'on'|'off'|'auto';parallel_slots:number;top_k:number;top_p:number;min_p:number;repeat_penalty:number}
  pipeline:{batch_pages:number;batch_raw_mb:number;ocr_workers:number;translation_workers:number;zip_workers:number} // KWT_UNIFIED_WORKERS_V1_2
}
type Existing={gemma_dir:string;prompt:string;temperature:number;max_tokens:number;ocr_mode:string;patches:number;confidence:number}
type Props={
  selectedGroup:SettingsGroup
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
  pipeline:{batch_pages:3,batch_raw_mb:22,ocr_workers:1,translation_workers:1,zip_workers:1},
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
const PAGE_META:Record<SettingsGroup,{label:string;hint:string}>={
  overview:{label:'통합 설정 개요',hint:'왼쪽 환경 설정에서 항목을 선택하면 해당 설정만 표시돼.'},
  gemma:{label:'AI 서버 실행',hint:'Gemma 시작 시 반영 · 실행 중이라면 재시작 필요'},
  pipeline:{label:'자동 ZIP 처리',hint:'다음 ZIP 자동 처리 작업부터 반영'},
  ocr:{label:'OCR / 텍스트 검출',hint:'기존 OCR 설정과 공유 · 새로운 검출 작업부터 반영'},
  translation:{label:'번역 설정',hint:'기존 번역 프로필과 공유 · 다음 번역 요청부터 반영'},
  chat:{label:'로컬 채팅 / 기억',hint:'기존 로컬 채팅 설정 유지'},
  typesetting:{label:'이미지 처리 / 식질',hint:'기존 검수·식질 설정 유지'},
}

export default function UnifiedSettingsTree({selectedGroup,legacy,updateLegacy,saveLegacy,ready,mode,setMode,browseGemma,gemmaOnline}:Props){
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
      setNotice('저장 완료. Gemma/OCR 서버 실행 옵션은 서버 재시작 후, ZIP 병렬 수는 다음 작업부터 적용돼.')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  }
  const reset=()=>{setRuntime(JSON.parse(JSON.stringify(defaults)) as Runtime);setDirty(true);setNotice('기본값을 입력했어. 저장 버튼을 눌러야 적용돼.')}
  const runtimePage=selectedGroup==='gemma'||selectedGroup==='pipeline'
  return <div className="kwt-settings-tree kwt-settings-page">
    <section className="control-card kwt-settings-page-intro">
      <p className="kwt-settings-breadcrumb">환경 설정 / {PAGE_META[selectedGroup].label}</p>
      <h2>{PAGE_META[selectedGroup].label}</h2>
      <p className="ctl-description">{PAGE_META[selectedGroup].hint}</p>
      {loading&&runtimePage&&<p className="ctl-description">설정값을 불러오는 중...</p>}
      {error&&<div className="control-alert error">{error}</div>}
      {notice&&<p className="kwt-tree-notice">{notice}</p>}
      {runtimePage&&<div className="kwt-tree-toolbar">
        <span>{dirty?'저장되지 않은 통합 설정 변경 사항 있음':'통합 설정 저장 상태 최신'}</span>
        <button className="secondary" disabled={loading||saving} onClick={reset}>기본값 입력</button>
        <button className="secondary" disabled={loading||saving} onClick={()=>{setLoading(true);setError('');void load().catch(e=>setError(String(e))).finally(()=>setLoading(false))}}>저장값 다시 불러오기</button>
        <button className="primary" disabled={!dirty||loading||saving} onClick={()=>void save()}>{saving?'저장 중...':'통합 설정 저장'}</button>
      </div>}
    </section>

    {selectedGroup==='overview'&&<section className="control-card">
      <h2>왼쪽 트리에서 설정을 선택해 줘</h2>
      <p className="ctl-description">환경 설정 아래의 각 하위 항목을 클릭하면 오른쪽에 해당 설정만 표시돼. 기존 AI 서버 관리·OCR·번역·채팅 탭은 그대로 유지해.</p>
      <p className="ctl-description">현재 1단계에서 실제로 연결된 값은 Gemma 실행 옵션과 ZIP 배치 크기야. OCR/번역은 기존 저장 API를 공유하고, 채팅/식질의 상세 통합과 작업자 병렬화는 후속 단계에서 진행해.</p>
    </section>}

    {selectedGroup==='gemma'&&<section className="control-card settings-form">
      {gemmaOnline&&<p className="kwt-tree-warning">Gemma 서버가 이미 실행 중이야. 저장한 실행 옵션은 서버 재시작 후 적용돼.</p>}
      <div className="kwt-tree-fields">
        {FIELDS.map(field=><label key={field.key}>{field.label}<input type="number" min={field.min} max={field.max} step={field.step} value={runtime.gemma[field.key]} disabled={loading} onChange={e=>gemmaChange(field.key,Number(e.target.value))}/></label>)}
        <label>Flash Attention<select value={runtime.gemma.flash_attention} disabled={loading} onChange={e=>gemmaChange('flash_attention',e.target.value)}><option value="on">ON</option><option value="off">OFF</option><option value="auto">AUTO</option></select></label>
        <label>서버 실행 모드<select value={mode} onChange={e=>setMode(e.target.value as 'MTP'|'Normal')}><option value="Normal">Normal</option><option value="MTP">MTP</option></select></label>
      </div>
      <p className="ctl-description">컨텍스트(-c), GPU(-ngl), Flash Attention(-fa), 슬롯(-np), 샘플링 기본값을 ai/Launch.ps1 실행에 연결해. 슬롯 증가만으로 번역 요청이 병렬화되지는 않아.</p>
      <div className="kwt-tree-inline"><label>Gemma 설치 경로<input value={legacy.gemma_dir} onChange={e=>updateLegacy({gemma_dir:e.target.value})}/></label><button className="secondary" onClick={()=>void browseGemma()}>폴더 찾기</button><button className="secondary" disabled={!ready} onClick={()=>saveLegacy('gemma')}>경로 저장</button></div>
      <p className="ctl-description">설치 경로는 기존 관리 설정으로 별도 저장돼. 위의 '통합 설정 저장' 버튼과 구분해 사용해 줘.</p>
    </section>}

    {selectedGroup==='pipeline'&&<section className="control-card settings-form">
      <div className="kwt-tree-fields">
        <label>배치 이미지 수<input type="number" min={1} max={20} step={1} value={runtime.pipeline.batch_pages} disabled={loading} onChange={e=>pipelineChange('batch_pages',Number(e.target.value))}/></label>
        <label>배치 최대 원본 데이터 (MB)<input type="number" min={4} max={22} step={1} value={runtime.pipeline.batch_raw_mb} disabled={loading} onChange={e=>pipelineChange('batch_raw_mb',Number(e.target.value))}/></label>
        {/* KWT_UNIFIED_WORKERS_V1_2: real bounded task pools */}
        <label>OCR 동시 배치 작업 수 (1~2)<input type="number" min={1} max={2} step={1} value={runtime.pipeline.ocr_workers} disabled={loading} onChange={e=>pipelineChange('ocr_workers',Number(e.target.value))}/></label>
        <label>번역 동시 페이지 작업 수 (1~4)<input type="number" min={1} max={4} step={1} value={runtime.pipeline.translation_workers} disabled={loading} onChange={e=>pipelineChange('translation_workers',Number(e.target.value))}/></label>
        <label>동시 ZIP 처리 수 (1~2)<input type="number" min={1} max={2} step={1} value={runtime.pipeline.zip_workers} disabled={loading} onChange={e=>pipelineChange('zip_workers',Number(e.target.value))}/></label>
      </div>
      <p className="ctl-description">OCR·번역 작업 수는 OCR 서버를 재시작해야 반영돼. ZIP 동시 작업 수는 다음 자동 ZIP 실행부터 적용돼. Hayai 인식 호출은 단일 자식 프로세스 내부에서 안전하게 직렬화돼.</p>
<p className="ctl-description">Gemma 번역 병렬 처리 성능을 높이려면 AI 서버의 병렬 요청 슬롯(-np)도 함께 늘리고 서버를 재시작해야 해. GPU 메모리 부족 시 작업 수를 1로 되돌려 줘.</p>
      <p className="ctl-description">서버 요청 크기 제한 35 MB를 고려해 배치 원본 크기는 최대 22 MB로 제한해. 설정은 작업 시작 시 고정돼.</p>
    </section>}

    {selectedGroup==='ocr'&&<section className="control-card settings-form">
      <div className="kwt-tree-fields">
        <label>Hayai 패치 크기<select value={legacy.patches} onChange={e=>updateLegacy({patches:Number(e.target.value)})}><option value={256}>256</option><option value={384}>384</option><option value={512}>512</option></select></label>
        <label>텍스트 검출 신뢰도<input type="number" min={0.05} max={0.9} step={0.01} value={legacy.confidence} onChange={e=>updateLegacy({confidence:Number(e.target.value)})}/></label>
      </div>
      <div className="kwt-tree-bottom"><span>기존 OCR 설정 파일과 동일한 값이야.</span><button className="primary" disabled={!ready} onClick={()=>saveLegacy('ocr')}>OCR 설정 저장</button></div>
    </section>}

    {selectedGroup==='translation'&&<section className="control-card settings-form">
      <label className="kwt-tree-prompt">번역 시스템 프롬프트<textarea value={legacy.prompt} rows={10} onChange={e=>updateLegacy({prompt:e.target.value})}/></label>
      <div className="kwt-tree-fields">
        <label>Temperature<input type="number" min={0} max={2} step={0.05} value={legacy.temperature} onChange={e=>updateLegacy({temperature:Number(e.target.value)})}/></label>
        <label>최대 출력 토큰 (0 = 자동)<input type="number" min={0} max={2304} step={1} value={legacy.max_tokens} onChange={e=>updateLegacy({max_tokens:Number(e.target.value)})}/></label>
      </div>
      <div className="kwt-tree-bottom"><span>요청별 샘플링 및 실패 재시도 정책은 후속 단계야.</span><button className="primary" disabled={!ready} onClick={()=>saveLegacy('translation')}>번역 설정 저장</button></div>
    </section>}

    {selectedGroup==='chat'&&<section className="control-card">
      <h2>기존 로컬 채팅 탭 유지</h2><p className="ctl-description">현재 채팅의 컨텍스트·답변 길이·기억 압축 설정과 대화 기록은 변경하지 않아. 상세 설정 통합 시 서버와 채팅 API를 함께 점검할 예정이야.</p>
    </section>}
    {selectedGroup==='typesetting'&&<section className="control-card">
      <h2>기존 식질 · 검수 설정 유지</h2><p className="ctl-description">현재 폰트 라이브러리와 검수 기본 설정을 그대로 사용해. LaMa 타일, 글자 배치, 출력 품질 및 ZIP 압축 옵션은 후속 단계에서 연결할 예정이야.</p>
    </section>}
  </div>
}
