// KWT_UNIFIED_NAV_TREE_V1_1: left-sidebar tree navigation, right-side single settings page.
// V1 runtime settings and original manager settings API remain unchanged.
import {useCallback,useEffect,useState} from 'react'
import {api} from './api'
import ChatConversationSettings from './ChatConversationSettings' // KWT_UNIFIED_CHAT_V1_4

export type SettingsGroup='overview'|'gemma'|'pipeline'|'ocr'|'translation'|'chat'|'typesetting'

type Runtime={
  schema_version:number
  gemma:{context_size:number;gpu_layers:number;flash_attention:'on'|'off'|'auto';parallel_slots:number;top_k:number;top_p:number;min_p:number;repeat_penalty:number;mmproj_enabled:boolean} // KWT_PRIVATE_MMPROJ_TOGGLE_V3_0
  pipeline:{batch_pages:number;batch_raw_mb:number;ocr_workers:number;translation_workers:number;zip_workers:number} // KWT_UNIFIED_WORKERS_V1_2
  // KWT_UNIFIED_ADVANCED_V1_3
  ocr:{pad_x_percent:number;pad_y_percent:number}
  translation:{max_region_count:number;max_source_chars:number;timeout_sec:number;top_k:number;top_p:number;min_p:number}
  chat:{context_reserve:number;auto_reply_margin:number;summary_batch_messages:number;summary_chunk_budget:number;summary_output_tokens:number;summary_max_chars:number;summary_previous_chars:number;timeout_sec:number;continue_limit:number}
  // KWT_UNIFIED_IMAGE_V1_5
  typesetting:{lama_tile_size:number;lama_tile_context:number;typeset_min_font_size:number;typeset_max_font_size:number;typeset_padding_percent:number;typeset_line_height_ratio:number;output_image_quality:number;zip_compression_level:number;virtual_box_width_percent:number;virtual_box_height_percent:number}
}
// KWT_ZIP_V4_GUI_V4_1: settings persisted in the *existing* V4 JSON, not runtime_settings.json.
type ZipV4={schema_version:number;enabled:boolean;overlap_lama_with_ai:boolean;encode_workers:number;max_inflight_pages:number;poll_interval_seconds:number}
const V4_DEFAULTS:ZipV4={schema_version:1,enabled:true,overlap_lama_with_ai:true,encode_workers:2,max_inflight_pages:4,poll_interval_seconds:0.35}
type V4Response={values:ZipV4;defaults:ZipV4;revision:string}
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
  gemma:{context_size:8192,gpu_layers:99,flash_attention:'on',parallel_slots:1,top_k:64,top_p:0.9,min_p:0.05,repeat_penalty:1.1,mmproj_enabled:false},
  pipeline:{batch_pages:3,batch_raw_mb:22,ocr_workers:1,translation_workers:1,zip_workers:1},
  ocr:{pad_x_percent:12,pad_y_percent:8},
  translation:{max_region_count:20,max_source_chars:1200,timeout_sec:120,top_k:64,top_p:0.9,min_p:0.05},
  chat:{context_reserve:400,auto_reply_margin:512,summary_batch_messages:4,summary_chunk_budget:1150,summary_output_tokens:700,summary_max_chars:2200,summary_previous_chars:2000,timeout_sec:300,continue_limit:3},
  typesetting:{lama_tile_size:768,lama_tile_context:72,typeset_min_font_size:8,typeset_max_font_size:72,typeset_padding_percent:4.5,typeset_line_height_ratio:1.24,output_image_quality:92,zip_compression_level:6,virtual_box_width_percent:130,virtual_box_height_percent:100},
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
  ocr:{label:'OCR / 텍스트 검출',hint:'기존 OCR 설정 및 공통 여백 · 새로운 검출 작업부터 반영'},
  translation:{label:'번역 설정',hint:'기존 번역 프로필 및 요청별 고급 옵션 · 다음 번역 요청부터 반영'},
  chat:{label:'로컬 채팅 / 기억',hint:'대화별 설정 · 공통 기억 압축 및 자동 이어쓰기'},
  typesetting:{label:'이미지 처리 / 식질',hint:'자동 ZIP·검수 공통 프로필 · 다음 작업부터 적용'},
}

export default function UnifiedSettingsTree({selectedGroup,legacy,updateLegacy,saveLegacy,ready,mode,setMode,browseGemma,gemmaOnline}:Props){
  // KWT_UNIFIED_STABILITY_V1_6: group-specific drafts and conflict-safe saves.
  const GROUPS=['gemma','pipeline','ocr','translation','chat','typesetting'] as const
  type GroupKey=typeof GROUPS[number]
  const DRAFT_KEY='kwt-studio-unified-settings-v1.6-draft'
  const [runtime,setRuntime]=useState<Runtime>(DEFAULTS)
  const [saved,setSaved]=useState<Runtime>(DEFAULTS)
  const [defaults,setDefaults]=useState<Runtime>(DEFAULTS)
  const [revision,setRevision]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const load=useCallback(async(restoreDraft=false)=>{
    const result=await api<{values:Runtime;defaults:Runtime;stored:boolean;revision:string}>('/api/manager/runtime-settings')
    let next=result.values
    let expectedRevision=result.revision
    if(restoreDraft){
      try{
        const stored=JSON.parse(window.sessionStorage.getItem(DRAFT_KEY)||'null') as {revision?:string;draft?:Runtime}|null
        if(stored?.revision && stored.draft?.schema_version===1 && GROUPS.every(g=>stored.draft?.[g]!==undefined)){
          next=stored.draft
          if(stored.revision!==result.revision){
            // Preserve the draft, but require explicit reload instead of overwriting newer data.
            expectedRevision=stored.revision
            setError('다른 창에서 저장값이 변경됐어. 이전 미저장 입력은 보존했지만 충돌 상태라 저장할 수 없어. 내용을 확인하고 저장값 다시 불러오기를 선택해 줘.')
          }
        }else if(stored){window.sessionStorage.removeItem(DRAFT_KEY)}
      }catch{ /* ignore invalid drafts, never stop settings from loading */ }
    }else{
      try{window.sessionStorage.removeItem(DRAFT_KEY)}catch{}
    }
    setRuntime(next);setSaved(result.values);setDefaults(result.defaults);setRevision(expectedRevision)
  },[])
  useEffect(()=>{void load(true).catch(e=>setError(String(e))).finally(()=>setLoading(false))},[load])
  const dirtyGroups=GROUPS.filter(g=>JSON.stringify(runtime[g])!==JSON.stringify(saved[g]))
  const currentGroup=selectedGroup==='overview'?null:selectedGroup as GroupKey
  const currentDirty=currentGroup!==null&&dirtyGroups.includes(currentGroup)
  useEffect(()=>{
    if(loading)return
    try{
      if(dirtyGroups.length)window.sessionStorage.setItem(DRAFT_KEY,JSON.stringify({revision,draft:runtime}))
      else window.sessionStorage.removeItem(DRAFT_KEY)
    }catch{/* session storage may be unavailable */}
  },[runtime,revision,loading,saved])
  // KWT_ZIP_V4_GUI_V4_1: independent draft and save, compatible with OPTIONS.bat.
  const [zipV4,setZipV4]=useState<ZipV4>(V4_DEFAULTS)
  const [zipV4Saved,setZipV4Saved]=useState<ZipV4>(V4_DEFAULTS)
  const [zipV4Defaults,setZipV4Defaults]=useState<ZipV4>(V4_DEFAULTS)
  const [zipV4Revision,setZipV4Revision]=useState('')
  const [zipV4Loading,setZipV4Loading]=useState(true)
  const [zipV4Saving,setZipV4Saving]=useState(false)
  const [zipV4Error,setZipV4Error]=useState('')
  const [zipV4Notice,setZipV4Notice]=useState('')
  const zipV4Dirty=JSON.stringify(zipV4)!==JSON.stringify(zipV4Saved)
  const zipV4Mode=!zipV4.enabled?'legacy':zipV4.overlap_lama_with_ai?'overlap':'ai-first'
  const loadZipV4=useCallback(async()=>{
    setZipV4Loading(true);setZipV4Error('');setZipV4Notice('')
    try{
      const r=await api<V4Response>('/api/manager/zip-v4-settings')
      setZipV4(r.values);setZipV4Saved(r.values);setZipV4Defaults(r.defaults);setZipV4Revision(r.revision)
    }catch(e){setZipV4Error(e instanceof Error?e.message:String(e))}
    finally{setZipV4Loading(false)}
  },[])
  useEffect(()=>{if(selectedGroup==='pipeline')void loadZipV4()},[selectedGroup,loadZipV4])
  const zipV4SetMode=(value:string)=>{
    setZipV4(prev=>({...prev,enabled:value!=='legacy',overlap_lama_with_ai:value==='legacy'?prev.overlap_lama_with_ai:value==='overlap'}))
    setZipV4Notice('')
  }
  const zipV4Change=(key:'encode_workers'|'max_inflight_pages'|'poll_interval_seconds',value:number)=>{
    setZipV4(prev=>({...prev,[key]:value}));setZipV4Notice('')
  }
  const saveZipV4=async()=>{
    if(zipV4Loading||zipV4Saving||!zipV4Dirty||!zipV4Revision)return
    setZipV4Saving(true);setZipV4Error('');setZipV4Notice('')
    try{
      const result=await api<{values:ZipV4;revision:string}>('/api/manager/zip-v4-settings',{values:zipV4,__expected_revision:zipV4Revision})
      setZipV4(result.values);setZipV4Saved(result.values);setZipV4Revision(result.revision)
      setZipV4Notice('V4 설정 저장 완료. 다음 ZIP 작업부터 반영돼. 기존 배치/작업자 설정은 상단 공통값 저장을 이용해 줘.')
    }catch(e){setZipV4Error(e instanceof Error?e.message:String(e))}
    finally{setZipV4Saving(false)}
  }
  const gemmaChange=(key:keyof Runtime['gemma'],value:number|string|boolean)=>{
    setRuntime(prev=>({...prev,gemma:{...prev.gemma,[key]:value}}));setNotice('');setError('')
  }
  const pipelineChange=(key:keyof Runtime['pipeline'],value:number)=>{
    setRuntime(prev=>({...prev,pipeline:{...prev.pipeline,[key]:value}}));setNotice('');setError('')
  }
  const advancedChange=(section:'ocr'|'translation'|'chat'|'typesetting',key:string,value:number)=>{
    setRuntime(prev=>({...prev,[section]:{...prev[section],[key]:value}}));setNotice('');setError('')
  }
  const save=async()=>{
    if(saving||loading||!currentGroup||!currentDirty)return
    setSaving(true);setError('');setNotice('')
    try{
      // Post only the selected group's draft; preserve other unsaved groups locally.
      const request={...saved,[currentGroup]:runtime[currentGroup],__expected_revision:revision}
      await api<{values:Runtime}>('/api/manager/runtime-settings',request)
      const fresh=await api<{values:Runtime;revision:string}>('/api/manager/runtime-settings')
      setSaved(fresh.values);setRevision(fresh.revision)
      setRuntime(prev=>({...prev,[currentGroup]:fresh.values[currentGroup]}))
      setNotice('이 그룹을 저장했어. 다른 그룹의 미저장 변경은 그대로 유지돼. 실행 옵션은 해당 서버 재시작 후 적용돼.')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  }
  const reset=()=>{
    if(!currentGroup)return
    setRuntime(prev=>({...prev,[currentGroup]:{...defaults[currentGroup]}}))
    setNotice('이 그룹에 기본값을 입력했어. 저장 버튼을 눌러야 반영돼.');setError('')
  }
  const revert=()=>{
    if(!currentGroup)return
    setRuntime(prev=>({...prev,[currentGroup]:{...saved[currentGroup]}}))
    setNotice('이 그룹의 미저장 변경을 취소했어.');setError('')
  }
  const reload=async()=>{
    if(dirtyGroups.length&&!window.confirm('미저장된 통합 설정 변경이 모두 사라져. 저장된 설정을 다시 불러올까?'))return
    setLoading(true);setError('');setNotice('')
    try{await load(false);setNotice('디스크의 최신 설정을 불러왔어.')}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setLoading(false)}
  }
  const runtimePage=selectedGroup!=='overview'
  return <div className="kwt-settings-tree kwt-settings-page">
    <section className="control-card kwt-settings-page-intro">
      <p className="kwt-settings-breadcrumb">환경 설정 / {PAGE_META[selectedGroup].label}</p>
      <h2>{PAGE_META[selectedGroup].label}</h2>
      <p className="ctl-description">{PAGE_META[selectedGroup].hint}</p>
      {loading&&runtimePage&&<p className="ctl-description">설정값을 불러오는 중...</p>}
      {error&&<div className="control-alert error">{error}</div>}
      {notice&&<p className="kwt-tree-notice">{notice}</p>}
      {runtimePage&&<div className="kwt-tree-toolbar">
        <span aria-live="polite">{currentDirty?'이 그룹에 미저장 변경이 있어.':'이 그룹은 저장된 최신값이야.'}{dirtyGroups.length>Number(currentDirty)?` · 다른 그룹 ${dirtyGroups.length-Number(currentDirty)}개 미저장`:''}</span>
        <button className="secondary" disabled={loading||saving} onClick={reset}>이 그룹 기본값</button>
        <button className="secondary" disabled={!currentDirty||loading||saving} onClick={revert}>이 그룹 변경 취소</button>
        <button className="secondary" disabled={loading||saving} onClick={()=>void reload()}>저장값 다시 불러오기</button>
        <button className="primary" disabled={!currentDirty||loading||saving} onClick={()=>void save()}>{saving?'저장 중...':'현재 그룹 공통값 저장'}</button>
      </div>}
    </section>

    {selectedGroup==='overview'&&<section className="control-card">
      <h2>왼쪽 트리에서 설정을 선택해 줘</h2>
      <p className="ctl-description">환경 설정 아래의 각 하위 항목을 클릭하면 오른쪽에 해당 설정만 표시돼. 기존 AI 서버 관리·OCR·번역·채팅 탭은 그대로 유지해.</p>
      <p className="ctl-description">현재 AI 서버·자동 ZIP·OCR·번역·채팅 기억·식질의 공통 옵션이 연결되어 있어. 각 그룹은 개별 저장되고, 다른 그룹에서 입력한 미저장 변경은 유지돼. 기존 OCR/번역의 프롬프트와 검출 신뢰도는 별도 설정 저장소를 계속 사용해.</p>
    </section>}

    {selectedGroup==='gemma'&&<section className="control-card settings-form">
      {gemmaOnline&&<p className="kwt-tree-warning">Gemma 서버가 이미 실행 중이야. 저장한 실행 옵션은 서버 재시작 후 적용돼.</p>}
      <div className="kwt-tree-fields">
        {FIELDS.map(field=><label key={field.key}>{field.label}<input type="number" min={field.min} max={field.max} step={field.step} value={runtime.gemma[field.key]} disabled={loading||saving} onChange={e=>gemmaChange(field.key,Number(e.target.value))}/></label>)}
        <label>Flash Attention<select value={runtime.gemma.flash_attention} disabled={loading||saving} onChange={e=>gemmaChange('flash_attention',e.target.value)}><option value="on">ON</option><option value="off">OFF</option><option value="auto">AUTO</option></select></label>
        {/* KWT_PRIVATE_MMPROJ_TOGGLE_V3_0 · mmproj is loaded only on Gemma restart, never a separate server. */}
        <label>이미지 분석 mmproj<select value={runtime.gemma.mmproj_enabled?'on':'off'} disabled={loading||saving} onChange={e=>gemmaChange('mmproj_enabled',e.target.value==='on')}><option value="off">OFF (기본 · 텍스트 전용)</option><option value="on">ON (서버 시작 시 멀티모달 로드)</option></select></label>
        <label>서버 실행 모드<select value={mode} onChange={e=>setMode(e.target.value as 'MTP'|'Normal')}><option value="Normal">Normal</option><option value="MTP">MTP</option></select></label>
      </div>
      <p className="ctl-description">mmproj ON은 전용 projector 파일이 설치돼 있어야 하며, Gemma 서버를 완전히 재시작해야 적용돼. 파일은 동봉된 INSTALL_MMPROJ.bat으로 다운로드할 수 있어. OFF에서는 --mmproj를 전달하지 않아. MTP/--jinja는 변경하지 않아.</p>
      <p className="ctl-description">컨텍스트(-c), GPU(-ngl), Flash Attention(-fa), 슬롯(-np), 샘플링 기본값을 ai/Launch.ps1 실행에 연결해. 슬롯 증가만으로 번역 요청이 병렬화되지는 않아.</p>
      <div className="kwt-tree-inline"><label>Gemma 설치 경로<input value={legacy.gemma_dir} onChange={e=>updateLegacy({gemma_dir:e.target.value})}/></label><button className="secondary" onClick={()=>void browseGemma()}>폴더 찾기</button><button className="secondary" disabled={!ready} onClick={()=>saveLegacy('gemma')}>경로 저장</button></div>
      <p className="ctl-description">설치 경로는 기존 관리 설정으로 별도 저장돼. 위의 '통합 설정 저장' 버튼과 구분해 사용해 줘.</p>
    </section>}

    {selectedGroup==='pipeline'&&<section className="control-card settings-form">
      <div className="kwt-tree-fields">
        <label>배치 이미지 수<input type="number" min={1} max={20} step={1} value={runtime.pipeline.batch_pages} disabled={loading||saving||zipV4Loading||(!!zipV4Revision&&zipV4.enabled)} onChange={e=>pipelineChange('batch_pages',Number(e.target.value))}/></label>
        <label>배치 최대 원본 데이터 (MB)<input type="number" min={4} max={22} step={1} value={runtime.pipeline.batch_raw_mb} disabled={loading||saving||zipV4Loading||(!!zipV4Revision&&zipV4.enabled)} onChange={e=>pipelineChange('batch_raw_mb',Number(e.target.value))}/></label>
        {/* KWT_UNIFIED_WORKERS_V1_2: real bounded task pools */}
        <label>OCR 동시 배치 작업 수 (1~2)<input type="number" min={1} max={2} step={1} value={runtime.pipeline.ocr_workers} disabled={loading||saving} onChange={e=>pipelineChange('ocr_workers',Number(e.target.value))}/></label>
        <label>번역 동시 페이지 작업 수 (1~4)<input type="number" min={1} max={4} step={1} value={runtime.pipeline.translation_workers} disabled={loading||saving} onChange={e=>pipelineChange('translation_workers',Number(e.target.value))}/></label>
        <label>동시 ZIP 처리 수 (1~2)<input type="number" min={1} max={2} step={1} value={runtime.pipeline.zip_workers} disabled={loading||saving} onChange={e=>pipelineChange('zip_workers',Number(e.target.value))}/></label>
      </div>
      <p className="ctl-description">OCR·번역 작업 수는 OCR 서버를 재시작해야 반영돼. ZIP 동시 작업 수는 다음 자동 ZIP 실행부터 적용돼. Hayai 인식 호출은 단일 자식 프로세스 내부에서 안전하게 직렬화돼.</p>
<p className="ctl-description">Gemma 번역 병렬 처리 성능을 높이려면 AI 서버의 병렬 요청 슬롯(-np)도 함께 늘리고 서버를 재시작해야 해. GPU 메모리 부족 시 작업 수를 1로 되돌려 줘.</p>
      <p className="ctl-description">서버 요청 크기 제한 35 MB를 고려해 배치 원본 크기는 최대 22 MB로 제한해. 설정은 작업 시작 시 고정돼.</p>
    </section>}

    {/* KWT_ZIP_V4_GUI_V4_1: V4 mode and tuning have their own file and save action. */}
    {selectedGroup==='pipeline'&&<section className="control-card settings-form">
      <h2>V4.0 연속 바이너리 번역 파이프라인</h2>
      <p className="ctl-description">V4.0 엔진의 실제 설정 파일을 사용해. 아래 저장 버튼으로 변경하면 다음 자동 ZIP 작업부터 적용돼. 별도의 OPTIONS.bat도 같은 설정 파일을 사용해.</p>
      {zipV4Error&&<div className="control-alert error">{zipV4Error}</div>}
      {zipV4Notice&&<p className="kwt-tree-notice">{zipV4Notice}</p>}
      <div className="kwt-tree-fields">
        <label>ZIP 번역 처리 방식
          <select value={zipV4Mode} disabled={zipV4Loading||zipV4Saving||!zipV4Revision} onChange={e=>zipV4SetMode(e.target.value)}>
            <option value="overlap">V4 전체 병렬 (OCR·번역 / LaMa·인코딩 동시)</option>
            <option value="ai-first">V4 AI 우선 (OCR·번역 완료 후 LaMa 시작)</option>
            <option value="legacy">기존 ZIP 배치 처리 (V4 OFF)</option>
          </select>
        </label>
        <label>CPU 이미지 인코딩 작업자 (1~4)
          <input type="number" min={1} max={4} step={1} value={zipV4.encode_workers} disabled={zipV4Loading||zipV4Saving||!zipV4Revision||!zipV4.enabled} onChange={e=>zipV4Change('encode_workers',Number(e.target.value))}/>
        </label>
        <label>동시 후처리 대기 이미지 (2~8)
          <input type="number" min={2} max={8} step={1} value={zipV4.max_inflight_pages} disabled={zipV4Loading||zipV4Saving||!zipV4Revision||!zipV4.enabled} onChange={e=>zipV4Change('max_inflight_pages',Number(e.target.value))}/>
        </label>
        <label>서버 상태 조회 간격 (초, 0.15~2)
          <input type="number" min={0.15} max={2} step={0.05} value={zipV4.poll_interval_seconds} disabled={zipV4Loading||zipV4Saving||!zipV4Revision||!zipV4.enabled} onChange={e=>zipV4Change('poll_interval_seconds',Number(e.target.value))}/>
        </label>
      </div>
      <p className="ctl-description">CPU 인코딩은 OCR·번역과 별도로 진행돼. 다만 LaMa는 CUDA 사용 시 GPU를 공유하므로 전체 병렬이 더 느리면 AI 우선으로 비교해 봐. 기존 배치 이미지 수·배치 MB는 V4 OFF일 때만 적용돼.</p>
      <div className="kwt-tree-bottom">
        <span aria-live="polite">{zipV4Loading?'V4 설정 확인 중...':zipV4Dirty?'V4 설정에 미저장 변경이 있어.':'V4 설정이 저장된 최신값이야.'}</span>
        <button className="secondary" disabled={zipV4Loading||zipV4Saving||!zipV4Revision} onClick={()=>{setZipV4({...zipV4Defaults});setZipV4Notice('기본값 입력 완료. 저장을 눌러야 적용돼.')}}>V4 기본값</button>
        <button className="secondary" disabled={!zipV4Dirty||zipV4Loading||zipV4Saving} onClick={()=>{setZipV4({...zipV4Saved});setZipV4Notice('V4 미저장 변경을 취소했어.')}}>V4 변경 취소</button>
        <button className="secondary" disabled={zipV4Loading||zipV4Saving} onClick={()=>{if(zipV4Dirty&&!window.confirm('V4 미저장 변경을 취소하고 디스크 값을 불러올까?'))return;void loadZipV4()}}>V4 저장값 다시 불러오기</button>
        <button className="primary" disabled={!zipV4Dirty||zipV4Loading||zipV4Saving||!zipV4Revision} onClick={()=>void saveZipV4()}>{zipV4Saving?'저장 중...':'V4 설정 저장'}</button>
      </div>
    </section>}

    {selectedGroup==='ocr'&&<section className="control-card settings-form">
      <div className="kwt-tree-fields">
        <label>Hayai 패치 크기<select value={legacy.patches} onChange={e=>updateLegacy({patches:Number(e.target.value)})}><option value={256}>256</option><option value={384}>384</option><option value={512}>512</option></select></label>
        <label>텍스트 검출 신뢰도<input type="number" min={0.05} max={0.9} step={0.01} value={legacy.confidence} onChange={e=>updateLegacy({confidence:Number(e.target.value)})}/></label>
      </div>
      <p className="ctl-description">OCR 인식 영역 여백은 아래 통합 설정 저장으로 적용되고, 패치 크기·검출 신뢰도는 기존 OCR 설정 저장을 사용해.</p>
      {/* KWT_UNIFIED_ADVANCED_V1_3: effective on NEW jobs, no OCR restart */}
      <div className="kwt-tree-fields">
        <label>OCR 좌우 여백 (각 방향 %)<input type="number" min={0} max={40} step={1} value={runtime.ocr.pad_x_percent} disabled={loading||saving} onChange={e=>advancedChange('ocr','pad_x_percent',Number(e.target.value))}/></label>
        <label>OCR 상하 여백 (각 방향 %)<input type="number" min={0} max={40} step={1} value={runtime.ocr.pad_y_percent} disabled={loading||saving} onChange={e=>advancedChange('ocr','pad_y_percent',Number(e.target.value))}/></label>
      </div>
      <div className="kwt-tree-bottom"><span>값이 지정되지 않은 새 OCR 요청에 공통 여백이 적용돼. 개별 요청이 지정한 여백은 우선돼.</span><button className="primary" disabled={!ready} onClick={()=>saveLegacy('ocr')}>기존 OCR 설정 저장</button></div>
    </section>}

    {selectedGroup==='translation'&&<section className="control-card settings-form">
      <label className="kwt-tree-prompt">번역 시스템 프롬프트<textarea value={legacy.prompt} rows={10} onChange={e=>updateLegacy({prompt:e.target.value})}/></label>
      <div className="kwt-tree-fields">
        <label>Temperature<input type="number" min={0} max={2} step={0.05} value={legacy.temperature} onChange={e=>updateLegacy({temperature:Number(e.target.value)})}/></label>
        <label>최대 출력 토큰 (0 = 자동)<input type="number" min={0} max={2304} step={1} value={legacy.max_tokens} onChange={e=>updateLegacy({max_tokens:Number(e.target.value)})}/></label>
      </div>
      {/* KWT_UNIFIED_ADVANCED_V1_3: translation batch/request settings */}
      <div className="kwt-tree-fields">
        <label>번역 영역 묶음 최대 개수<input type="number" min={1} max={20} step={1} value={runtime.translation.max_region_count} disabled={loading||saving} onChange={e=>advancedChange('translation','max_region_count',Number(e.target.value))}/></label>
        <label>번역 묶음 최대 원문 글자<input type="number" min={100} max={1200} step={50} value={runtime.translation.max_source_chars} disabled={loading||saving} onChange={e=>advancedChange('translation','max_source_chars',Number(e.target.value))}/></label>
        <label>번역 요청 타임아웃 (초)<input type="number" min={30} max={600} step={10} value={runtime.translation.timeout_sec} disabled={loading||saving} onChange={e=>advancedChange('translation','timeout_sec',Number(e.target.value))}/></label>
        <label>번역 요청별 Top-K<input type="number" min={0} max={200} step={1} value={runtime.translation.top_k} disabled={loading||saving} onChange={e=>advancedChange('translation','top_k',Number(e.target.value))}/></label>
        <label>번역 요청별 Top-P<input type="number" min={0.01} max={1} step={0.01} value={runtime.translation.top_p} disabled={loading||saving} onChange={e=>advancedChange('translation','top_p',Number(e.target.value))}/></label>
        <label>번역 요청별 Min-P<input type="number" min={0} max={1} step={0.01} value={runtime.translation.min_p} disabled={loading||saving} onChange={e=>advancedChange('translation','min_p',Number(e.target.value))}/></label>
      </div>
      <p className="ctl-description">통합 설정은 상단 '통합 설정 저장'으로 저장해. 기존 프롬프트와 Temperature/출력 토큰은 아래 '기존 번역 설정 저장' 버튼으로 별도 저장해.</p>
      <div className="kwt-tree-bottom"><span>모든 설정은 다음 새 번역 요청부터 적용돼. 실패 후 재번역 복구는 기존과 동일하게 유지해.</span><button className="primary" disabled={!ready} onClick={()=>saveLegacy('translation')}>기존 번역 설정 저장</button></div>
    </section>}

    {selectedGroup==='chat'&&<>
      {/* KWT_UNIFIED_CHAT_V1_4: global memory controls shared by all chats */}
      <section className="control-card settings-form">
        <h2>공통 채팅 · 기억 압축 정책</h2>
        <p className="ctl-description">이 항목들은 전체 로컬 대화에 공통 적용돼. 현재 요청 중인 메시지는 실행 시작 시 설정으로 고정돼. 상단 '통합 설정 저장'으로 저장해 줘.</p>
        <div className="kwt-tree-fields">
          {([
            ['context_reserve','입력 컨텍스트 안전 여유 (토큰)',200,1500,50],
            ['auto_reply_margin','자동 답변 템플릿 여유 (토큰)',256,2048,64],
            ['summary_batch_messages','한 번에 요약할 과거 메시지 수',1,10,1],
            ['summary_chunk_budget','기억 요약 입력 예산 (추정 토큰)',500,2500,50],
            ['summary_output_tokens','기억 요약 출력 상한 (토큰)',256,1600,64],
            ['summary_max_chars','압축 기억 최대 보관 길이 (글자)',500,8000,100],
            ['summary_previous_chars','재요약에 사용할 기존 기억 길이 (글자)',500,6000,100],
            ['timeout_sec','채팅 API 응답 타임아웃 (초)',30,900,30],
            ['continue_limit','자동 이어쓰기 최대 호출 횟수 (최초 응답 포함)',1,6,1],
          ] as const).map(([key,label,min,max,step])=><label key={key}>{label}<input type="number" min={min} max={max} step={step} value={runtime.chat[key]} disabled={loading||saving} onChange={e=>advancedChange('chat',key,Number(e.target.value))}/></label>)}
        </div>
        <p className="ctl-description">기억 요약은 이전 대화 원문을 삭제하지 않아. 단, 예산이나 최대 글자 수를 너무 작게 설정하면 과거 맥락이 줄어들 수 있어.</p>
      </section>
      <ChatConversationSettings serverContext={runtime.gemma.context_size}/>
    </>}
    {selectedGroup==='typesetting'&&<section className="control-card settings-form">
      {/* KWT_UNIFIED_IMAGE_V1_5: settings shared by automatic ZIP and review */}
      <h2>LaMa 배경 복원</h2>
      <div className="kwt-tree-fields">
        <label>LaMa 타일 최대 길이 (px)<input type="number" min={512} max={1024} step={64} value={runtime.typesetting.lama_tile_size} disabled={loading||saving} onChange={e=>advancedChange('typesetting','lama_tile_size',Number(e.target.value))}/></label>
        <label>LaMa 타일 주변 문맥 (px)<input type="number" min={0} max={256} step={8} value={runtime.typesetting.lama_tile_context} disabled={loading||saving} onChange={e=>advancedChange('typesetting','lama_tile_context',Number(e.target.value))}/></label>
      </div>
      {/* KWT_VIRTUAL_OCR_BOX_V1_8: editable Korean rectangle independent of OCR. */}
      <h2>가상 한글 식질 영역 확대</h2>
      <p className="ctl-description">일본어 OCR 원본 좌표와 LaMa 원문 제거 범위는 그대로 유지해. 한글이 들어갈 가상 박스만 OCR 중심 기준으로 확장해. 100%는 기존 OCR 크기, 140%는 OCR 너비의 1.4배야. 이미지 바깥으로는 확장되지 않아.</p>
      <div className="kwt-tree-fields">
        <label>가상 영역 가로 비율 ({runtime.typesetting.virtual_box_width_percent}%)
          <input type="range" min={100} max={200} step={5} value={runtime.typesetting.virtual_box_width_percent} disabled={loading||saving} onChange={e=>advancedChange('typesetting','virtual_box_width_percent',Number(e.target.value))}/>
          <input type="number" min={100} max={200} step={5} value={runtime.typesetting.virtual_box_width_percent} disabled={loading||saving} onChange={e=>advancedChange('typesetting','virtual_box_width_percent',Number(e.target.value))}/>
        </label>
        <label>가상 영역 세로 비율 ({runtime.typesetting.virtual_box_height_percent}%)
          <input type="range" min={100} max={200} step={5} value={runtime.typesetting.virtual_box_height_percent} disabled={loading||saving} onChange={e=>advancedChange('typesetting','virtual_box_height_percent',Number(e.target.value))}/>
          <input type="number" min={100} max={200} step={5} value={runtime.typesetting.virtual_box_height_percent} disabled={loading||saving} onChange={e=>advancedChange('typesetting','virtual_box_height_percent',Number(e.target.value))}/>
        </label>
      </div>
      <p className="ctl-description">기본값: 가로 130% · 세로 100%. KWT_VIRTUAL_BUBBLE_SAFE_V4_2 · 말풍선 판정은 원본 OCR 위치를 기준으로 가상 영역 내부의 안전 공간을 찾고, 성공하면 그 안에 한글을 배치해. 번역문이 맞지 않으면 기존 가상 영역으로 재시도하므로 작은 ZIP에서 결과를 검수해 줘. 이미 저장된 사용자 설정값은 자동으로 바꾸지 않아.</p>
      <h2>자동 식질 및 검수 렌더링</h2>
      <div className="kwt-tree-fields">
        <label>자동 최소 글꼴 크기 (px)<input type="number" min={8} max={48} step={1} value={runtime.typesetting.typeset_min_font_size} disabled={loading||saving} onChange={e=>advancedChange('typesetting','typeset_min_font_size',Number(e.target.value))}/></label>
        <label>자동 최대 글꼴 크기 (px)<input type="number" min={8} max={96} step={1} value={runtime.typesetting.typeset_max_font_size} disabled={loading||saving} onChange={e=>advancedChange('typesetting','typeset_max_font_size',Number(e.target.value))}/></label>
        <label>자동 내부 여백 (%)<input type="number" min={0} max={15} step={0.5} value={runtime.typesetting.typeset_padding_percent} disabled={loading||saving} onChange={e=>advancedChange('typesetting','typeset_padding_percent',Number(e.target.value))}/></label>
        <label>글자 행간 배율<input type="number" min={1} max={1.8} step={0.01} value={runtime.typesetting.typeset_line_height_ratio} disabled={loading||saving} onChange={e=>advancedChange('typesetting','typeset_line_height_ratio',Number(e.target.value))}/></label>
      </div>
      <p className="ctl-description">수동 레이어에 직접 지정한 글꼴 크기·좌표는 변경되지 않아. 행간 배율은 수동 레이어의 줄 간격에도 반영돼.</p>
      <h2>결과 이미지와 ZIP 저장</h2>
      <div className="kwt-tree-fields">
        <label>JPEG·WebP 저장 품질<input type="number" min={60} max={100} step={1} value={runtime.typesetting.output_image_quality} disabled={loading||saving} onChange={e=>advancedChange('typesetting','output_image_quality',Number(e.target.value))}/></label>
        <label>ZIP 압축 수준<input type="number" min={0} max={9} step={1} value={runtime.typesetting.zip_compression_level} disabled={loading||saving} onChange={e=>advancedChange('typesetting','zip_compression_level',Number(e.target.value))}/></label>
      </div>
      <p className="ctl-description">새 작업의 메타데이터에는 원본 OCR 박스, 가상 한글 박스, 실제 식질 박스 및 글자 범위를 별도로 보존해. 수동으로 고친 영역은 자동 조정하지 않아.</p>
      <p className="ctl-description">자동 처리 시작 시 프로필을 고정해 각 페이지 메타데이터에 기록해. 검수 화면에서 다시 그릴 때는 해당 기록을 재사용하므로, 저장 후 설정을 바꿔도 기존 페이지의 자동 레이아웃은 변하지 않아. 기존 페이지 메타데이터에 설정 기록이 없으면 현재 공통 설정을 사용해.</p>
      <p className="ctl-description">PNG는 무손실로 저장되고, 품질 수치는 JPEG·WebP에만 적용돼. 이미 완성된 ZIP은 설정 저장만으로 다시 압축되지 않아.</p>
    </section>}
  </div>
}
