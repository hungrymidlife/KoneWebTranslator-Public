import {useEffect,useRef,useState} from 'react'
import {ChevronLeft,ChevronRight,PanelLeftOpen,Paintbrush,Undo2,Redo2,Eye,Layers3,Maximize2,MoreHorizontal,ChevronDown} from 'lucide-react'
import './EditorToolbar.css'

type ViewMode='split'|'edit'|'source'
type Props={
  filename:string;sourcePath?:string;sidebarOpen:boolean;openSidebar:()=>void;
  active:boolean;page:number;pageCount:number;navigate:(n:number)=>void;
  editable:boolean;maskEditing:boolean;toggleMask:()=>void;
  proofPreview:boolean;toggleProof:()=>void;
  canUndo:boolean;canRedo:boolean;undo:()=>void;redo:()=>void;
  psdBusy:boolean;exportPsd:()=>void;
  ocrVisible:boolean;setOcrVisible:(value:boolean)=>void;
  follow:boolean;setFollow:(value:boolean)=>void;
  pillowEnabled:boolean;pillowMixed:boolean;pillowAvailable:boolean;
  setPillowAll:(enabled:boolean)=>void;
  view:ViewMode;setView:(value:ViewMode)=>void;
  editorFocus:boolean;toggleFocus:()=>void;
  focusShowOriginal:boolean;toggleFocusOriginal:()=>void;
}

export default function EditorToolbar(props:Props){
  const [open,setOpen]=useState(false)
  const menuRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(!open)return
    const away=(event:PointerEvent)=>{
      if(!menuRef.current?.contains(event.target as Node))setOpen(false)
    }
    const esc=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return
      event.preventDefault();event.stopPropagation();setOpen(false)
    }
    document.addEventListener('pointerdown',away)
    document.addEventListener('keydown',esc,true)
    return()=>{
      document.removeEventListener('pointerdown',away)
      document.removeEventListener('keydown',esc,true)
    }
  },[open])
  useEffect(()=>setOpen(false),[props.page,props.filename])
  const selectView=(next:ViewMode)=>{
    props.setView(next)
    setOpen(false)
  }
  return <div className="document-toolbar kwt-editor-toolbar-v2">
    <div className="kwt-toolbar-meta-v2">
      <div className="doc-label">
        {!props.sidebarOpen&&<button className="icon-btn" onClick={props.openSidebar} title="작업 파일 패널 열기" aria-label="작업 파일 패널 열기"><PanelLeftOpen size={19}/></button>}
        <div className="kwt-toolbar-title-v2">
          <div className="eyebrow">편집 작업영역</div>
          <b title={props.sourcePath||props.filename}>{props.filename}</b>
        </div>
      </div>
      <div className="page-nav" aria-label="페이지 이동">
        <button className="icon-btn" onClick={()=>props.navigate(props.page-1)} disabled={!props.active||props.page<=0} title="이전 페이지" aria-label="이전 페이지"><ChevronLeft size={19}/></button>
        <span><strong>{props.active?props.page+1:0}</strong><small> / {props.pageCount}</small></span>
        <button className="icon-btn" onClick={()=>props.navigate(props.page+1)} disabled={!props.active||props.page>=props.pageCount-1} title="다음 페이지" aria-label="다음 페이지"><ChevronRight size={19}/></button>
      </div>
    </div>
    <div className="toolbar-actions kwt-toolbar-actions-v2" role="toolbar" aria-label="편집 도구">
      <div className="kwt-toolbar-main-v2">
        <button className={props.maskEditing?'primary':'secondary'} type="button" disabled={!props.editable}
          title={props.maskEditing?'원문 제거 마스크 편집 종료':'원문 제거 마스크 편집'}
          aria-label={props.maskEditing?'마스크 편집 종료':'마스크 편집'} aria-pressed={props.maskEditing}
          onClick={props.toggleMask}>
          <Paintbrush size={16}/><span className="kwt-toolbar-text-v2">{props.maskEditing?'마스크 종료':'마스크 편집'}</span>
        </button>
        <div className="kwt-toolbar-undo-v2">
          <button className="secondary" type="button" disabled={!props.canUndo} onClick={props.undo}
            title="되돌리기 (Ctrl+Z)" aria-label="되돌리기"><Undo2 size={16}/></button>
          <button className="secondary" type="button" disabled={!props.canRedo} onClick={props.redo}
            title="다시 실행 (Ctrl+Y)" aria-label="다시 실행"><Redo2 size={16}/></button>
        </div>
        <button className={props.proofPreview?'primary':'secondary'} type="button"
          aria-pressed={props.proofPreview} title="Pillow 저장 결과 미리보기"
          onClick={props.toggleProof}>
          <Eye size={16}/><span className="kwt-toolbar-text-v2">{props.proofPreview?'편집으로 돌아가기':'저장 미리보기'}</span>
        </button>
      </div>
      <div className="kwt-toolbar-views-v2">
        <div className="view-switch" role="group" aria-label="보기 모드">
          <button className={props.view==='split'?'selected':''} onClick={()=>selectView('split')} aria-pressed={props.view==='split'}>비교</button>
          <button className={props.view==='edit'?'selected':''} onClick={()=>selectView('edit')} aria-pressed={props.view==='edit'}>편집 집중</button>
          <button className={props.view==='source'?'selected':''} onClick={()=>selectView('source')} aria-pressed={props.view==='source'}>원본</button>
        </div>
        {props.editorFocus&&<button type="button" className={props.focusShowOriginal?'primary':'secondary'}
          aria-pressed={props.focusShowOriginal} title="전체화면에서 일본어 원본 표시/숨기기"
          onClick={props.toggleFocusOriginal}>
          <PanelLeftOpen size={15}/><span>{props.focusShowOriginal?'원본 숨기기':'원본 보기'}</span>
        </button>}
        <button type="button" className="secondary kwt-toolbar-focus-v2" onClick={props.toggleFocus}
          aria-pressed={props.editorFocus} title={props.editorFocus?'식질 전체화면 종료':'식질 전체화면'}>
          <Maximize2 size={15}/><span>{props.editorFocus?'전체화면 종료':'전체화면'}</span>
        </button>
      </div>
      <div className="kwt-toolbar-overflow-v2" ref={menuRef}>
        <button type="button" className={'secondary kwt-toolbar-more-v2'+(open?' selected':'')}
          aria-haspopup="menu" aria-expanded={open} aria-controls="kwt-toolbar-more-items"
          title="PSD, OCR 박스, 자동 따라가기, 페이지 전체 Pillow 및 보기 옵션"
          onClick={()=>setOpen(v=>!v)}>
          <MoreHorizontal size={18}/><span>도구</span><ChevronDown size={13}/>
        </button>
        {open&&<div id="kwt-toolbar-more-items" className="kwt-toolbar-menu-v2" role="menu" aria-label="추가 도구">
          <button type="button" role="menuitem" disabled={!props.editable||props.psdBusy}
            onClick={()=>{setOpen(false);props.exportPsd()}}>
            <Layers3 size={16}/><span>{props.psdBusy?'PSD 생성 중…':'PSD 레이어 저장'}</span>
          </button>
          <label className="kwt-toolbar-toggle-v2" role="menuitemcheckbox" aria-checked={props.ocrVisible}>
            <input type="checkbox" checked={props.ocrVisible}
              onChange={e=>props.setOcrVisible(e.target.checked)}/> OCR 박스 표시
          </label>
          <label className="kwt-toolbar-toggle-v2" role="menuitemcheckbox" aria-checked={props.follow}>
            <input type="checkbox" checked={props.follow}
              onChange={e=>props.setFollow(e.target.checked)}/> 자동 따라가기
          </label>
          <div className="kwt-toolbar-menu-divider-v2" role="separator"/>
          <label className="kwt-toolbar-toggle-v2" role="menuitemcheckbox"
            aria-checked={props.pillowMixed?'mixed':props.pillowEnabled}
            title="현재 페이지에 있는 모든 식질 박스를 한 번에 전환합니다. 변경 후 Ctrl+S로 저장하세요.">
            <input type="checkbox" checked={props.pillowEnabled}
              disabled={!props.pillowAvailable}
              onChange={e=>props.setPillowAll(e.target.checked)}/>
            <span>Pillow 전체 자동 배치
              <small className="kwt-toolbar-menu-state-v2">
                {props.pillowMixed?'일부 ON':props.pillowEnabled?'전체 ON':'전체 OFF'}
              </small>
            </span>
          </label>
          <div className="kwt-toolbar-menu-note-v2">현재 페이지의 모든 식질 박스 · Ctrl+S 저장</div>
          {props.editorFocus&&<button type="button" role="menuitemcheckbox" aria-checked={props.focusShowOriginal}
            onClick={()=>{props.toggleFocusOriginal();setOpen(false)}}><PanelLeftOpen size={16}/>
            {props.focusShowOriginal?'원본 왼쪽 표시 끄기':'원본 왼쪽 표시 켜기'}</button>}
          <div className="kwt-toolbar-compact-v2">
            <span className="kwt-toolbar-menu-caption-v2">보기 모드</span>
            <button role="menuitemradio" aria-checked={props.view==='split'} className={props.view==='split'?'selected':''} onClick={()=>selectView('split')}>비교{props.view==='split'?' ✓':''}</button>
            <button role="menuitemradio" aria-checked={props.view==='edit'} className={props.view==='edit'?'selected':''} onClick={()=>selectView('edit')}>편집 집중{props.view==='edit'?' ✓':''}</button>
            <button role="menuitemradio" aria-checked={props.view==='source'} className={props.view==='source'?'selected':''} onClick={()=>selectView('source')}>원본{props.view==='source'?' ✓':''}</button>
            <button type="button" role="menuitem" onClick={()=>{props.toggleFocus();setOpen(false)}}><Maximize2 size={15}/>{props.editorFocus?'전체화면 종료':'식질 전체화면'}</button>
          </div>
        </div>}
      </div>
    </div>
  </div>
}
