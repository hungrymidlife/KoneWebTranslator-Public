(()=>{
if(window.__koneDomV2)return;window.__koneDomV2=true;
const ROOT='kone-wt-v2-',state={picking:false,highlight:null,panel:null,target:null,observer:null,timer:null,working:false};
function el(tag,styles={},parent=document.body){const x=document.createElement(tag);Object.assign(x.style,styles);parent.appendChild(x);return x;}
function note(text){if(typeof kwtTextState!=='undefined'&&kwtTextState.allUiHidden)return;let t=document.getElementById(ROOT+'toast');if(!t){t=el('div',{position:'fixed',bottom:'18px',right:'18px',zIndex:2147483647,background:'#111827',color:'#fff',padding:'12px',borderRadius:'8px',font:'13px sans-serif',maxWidth:'400px'});t.id=ROOT+'toast';t.dataset.koneUi='1';}t.textContent=text;clearTimeout(t._timer);t._timer=setTimeout(()=>t.remove(),5000);}
function deepQuery(selector, root=document){
 const parts=selector.split(/\s*>>>\s*/).filter(Boolean);
 let roots=[root],matches=[];
 for(let i=0;i<parts.length;i++){
  matches=[];
  for(const r of roots){try{matches.push(...r.querySelectorAll(parts[i]));}catch{}}
  if(i<parts.length-1)roots=matches.map(x=>x.shadowRoot).filter(Boolean);
 }
 return matches;
}
function deepImages(node){
 const found=[];const walk=(root)=>{
  if(root.matches?.('img'))found.push(root);
  root.querySelectorAll?.('img').forEach(x=>found.push(x));
  root.querySelectorAll?.('*').forEach(x=>{if(x.shadowRoot)walk(x.shadowRoot);});
 };
 walk(node);return found;
}
function cssSelector(node){
 if(node.getRootNode() instanceof ShadowRoot){
  const root=node.getRootNode();
  const inner=cssSelectorWithin(node,root);
  return cssSelector(root.host)+' >>> '+inner;
 }
 return cssSelectorWithin(node,document);
}
function cssSelectorWithin(node,root){
 if(node.id&&CSS.escape)return '#'+CSS.escape(node.id);
 const segments=[];let cur=node;
 while(cur&&cur.nodeType===1&&cur!==document.documentElement&&segments.length<7){
  let s=cur.tagName.toLowerCase();
  const classes=[...cur.classList].filter(c=>/^[\w-]{2,}$/.test(c)&&!/(active|hover|selected|loading)/i.test(c)).slice(0,2);
  if(classes.length)s+='.'+classes.map(c=>CSS.escape(c)).join('.');
  if(cur.parentElement){const same=[...cur.parentElement.children].filter(x=>x.tagName===cur.tagName);if(same.length>1)s+=`:nth-of-type(${same.indexOf(cur)+1})`;}
  segments.unshift(s);const selector=segments.join(' > ');
  try{if(root.querySelectorAll(selector).length===1)return selector;}catch{}
  cur=cur.parentElement;
 }
 return segments.join(' > ');
}
function urlScopes(raw=location.href){
 const u=new URL(raw), base=u.origin+u.pathname;
 const segments=u.pathname.split('/').filter(Boolean);
 let work=u.origin+'/';
 // Manga chapter paths: preserve the complete work slug, omit chapter segment.
 const chapterIndex=segments.findIndex(x=>/^chapter(?:[-_]|$)/i.test(x));
 if(chapterIndex>=0)work=u.origin+'/'+segments.slice(0,chapterIndex).join('/')+'/';
 else if(segments.length>1)work=u.origin+'/'+segments.slice(0,-1).join('/')+'/';
 return {chapter:base,work:work+'*',section:u.origin+'/'+(segments[0]||'')+'/*',site:u.origin+'/*'};
}
function validPattern(pattern){try{const u=new URL(pattern.replace(/\*/g,'x'));return /^https?:$/.test(u.protocol)&&!!u.hostname&&!/[\s]/.test(pattern);}catch{return false;}}
function imageList(node){const imgs=deepImages(node);const seen=new Set();return imgs.map((im,index)=>{
 const url=im.currentSrc||im.src||im.getAttribute('data-src')||im.getAttribute('data-original')||'';
 return {index,url,alt:im.alt||'',width:im.naturalWidth||0,height:im.naturalHeight||0};
}).filter(x=>{if(!/^https?:\/\//i.test(x.url)||seen.has(x.url))return false;seen.add(x.url);return true;});}
// The inspector lives in its own shadow root to avoid site CSS and viewer overlays.
let inspectorHost=null, inspectorRoot=null, outlineBox=null, outlineLabel=null, treeBox=null, currentNode=null, selectorBox=null, countBox=null, infoBox=null, selectedHistory=[];
function initInspector(){
 if(inspectorHost?.isConnected)return;
 inspectorHost=document.createElement('div');inspectorHost.dataset.koneUi='1';inspectorHost.id='kone-wt-inspector-host';
 Object.assign(inspectorHost.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'2147483647'});
 document.documentElement.appendChild(inspectorHost);
 inspectorRoot=inspectorHost.attachShadow({mode:'closed'});
 const css=document.createElement('style');css.textContent=`
 *{box-sizing:border-box} .mark{position:fixed;pointer-events:none;border:3px solid #06b6d4;background:rgba(6,182,212,.16);box-shadow:0 0 0 1px #111827;display:none;z-index:1}
 .tag{position:fixed;pointer-events:none;background:#0891b2;color:#fff;font:12px Arial;padding:5px 8px;border-radius:4px;max-width:350px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none;z-index:2}
 .panel{position:fixed;top:12px;right:12px;width:390px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;color:#111827;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 40px #0009;font:13px Arial;pointer-events:auto;padding:14px;z-index:3}
 h3{margin:0 0 10px;font-size:16px} .hint{font-size:12px;color:#475569;line-height:1.5;margin:8px 0} .tree{border:1px solid #e2e8f0;border-radius:7px;max-height:310px;overflow:auto;padding:5px;background:#f8fafc}
 .node{display:flex;align-items:center;gap:5px;width:100%;background:transparent;border:0;border-radius:4px;text-align:left;font:12px monospace;color:#334155;cursor:pointer;padding:6px 4px;min-height:27px}
 .node:hover{background:#dbeafe}.node.active{background:#bfdbfe;outline:1px solid #2563eb;color:#0f172a;font-weight:bold}.node .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node .num{color:#475569;font:11px Arial;white-space:nowrap}
 textarea{width:100%;height:62px;resize:vertical;font:12px monospace;border:1px solid #cbd5e1;border-radius:5px;padding:7px}
 .buttons{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0} button.action{background:#2563eb;color:white;border:0;border-radius:5px;padding:8px 10px;cursor:pointer;font:12px Arial}button.action.alt{background:#475569} .stats{margin:8px 0;font-size:12px;color:#334155} .msg{font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto}
 `;inspectorRoot.appendChild(css);
 outlineBox=document.createElement('div');outlineBox.className='mark';inspectorRoot.appendChild(outlineBox);
 outlineLabel=document.createElement('div');outlineLabel.className='tag';inspectorRoot.appendChild(outlineLabel);
}
function ui(x){return !!(x?.closest?.('#kone-wt-inspector-host,[data-kone-ui="1"]')||x?.getRootNode?.()===inspectorRoot);}
function labelNode(n){if(!n)return 'unknown';if(n instanceof ShadowRoot)return '#shadow-root (open)';if(!(n instanceof Element))return String(n.nodeName);return n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+[...n.classList].slice(0,2).map(c=>'.'+c).join('');}
function parentNode(n){if(n instanceof ShadowRoot)return n.host;return n?.parentElement||((n?.getRootNode?.() instanceof ShadowRoot)?n.getRootNode():null);}
function childNodes(n){const direct=[...(n.children||[])];if(n instanceof Element&&n.shadowRoot)direct.unshift(n.shadowRoot);return direct.filter(x=>x!==inspectorHost&&!ui(x));}
function mark(n){initInspector();currentNode=n;const rect=n instanceof ShadowRoot?n.host.getBoundingClientRect():n?.getBoundingClientRect?.();if(!rect||rect.width<=0||rect.height<=0){outlineBox.style.display='none';outlineLabel.style.display='none';return;}
 Object.assign(outlineBox.style,{display:'block',left:Math.max(0,rect.left)+'px',top:Math.max(0,rect.top)+'px',width:rect.width+'px',height:rect.height+'px'});
 outlineLabel.textContent=labelNode(n)+'  |  '+Math.round(rect.width)+'×'+Math.round(rect.height)+'  |  img '+imageList(n instanceof ShadowRoot?n.host:n).length;
 Object.assign(outlineLabel.style,{display:'block',left:Math.max(0,Math.min(innerWidth-300,rect.left))+'px',top:Math.max(0,rect.top>28?rect.top-26:rect.top+4)+'px'});
}
function pathTo(n){const path=[];const seen=new Set();while(n&&!seen.has(n)&&path.length<35){seen.add(n);path.unshift(n);n=parentNode(n);}return path;}
function renderTree(){if(!treeBox||!currentNode)return;treeBox.replaceChildren();const path=pathTo(currentNode);const currentIndex=path.length-1;
 function add(n,depth,active=false){const row=document.createElement('button');row.type='button';row.className='node'+(active?' active':'');row.style.paddingLeft=(6+depth*12)+'px';const nm=document.createElement('span');nm.className='name';nm.textContent=labelNode(n);const num=document.createElement('span');num.className='num';const count=n instanceof ShadowRoot?deepImages(n).length:imageList(n).length;num.textContent=count+' img';row.append(nm,num);row.onclick=()=>selectNode(n);treeBox.appendChild(row);if(active)row.scrollIntoView({block:'nearest'});}
 path.forEach((n,i)=>add(n,i,i===currentIndex));
 const children=childNodes(currentNode);if(children.length){const caption=document.createElement('div');caption.className='hint';caption.textContent='하위 요소 ('+children.length+'개, 최대 70개 표시)';treeBox.appendChild(caption);children.slice(0,70).forEach(n=>add(n,path.length));}
}
function selectNode(n,scroll=false){if(!n)return;mark(n);if(scroll)(n instanceof ShadowRoot?n.host:n).scrollIntoView?.({block:'nearest',inline:'nearest'});if(selectorBox){try{selectorBox.value=cssSelector(n instanceof ShadowRoot?n.host:n);}catch{selectorBox.value='';}}if(countBox){countBox.textContent='현재 요소 이미지 '+(n instanceof ShadowRoot?deepImages(n).length:imageList(n).length)+'개 / 크기 '+Math.round((n instanceof ShadowRoot?n.host:n).getBoundingClientRect().width)+'×'+Math.round((n instanceof ShadowRoot?n.host:n).getBoundingClientRect().height);}renderTree();}
function stop(){state.picking=false;document.removeEventListener('pointermove',move,true);document.removeEventListener('click',choose,true);document.removeEventListener('keydown',key,true);document.removeEventListener('scroll',refreshMark,true);window.removeEventListener('resize',refreshMark);}
function refreshMark(){if(currentNode)mark(currentNode);}
function move(e){if(ui(e.target))return;let n=e.composedPath?.().find(x=>x instanceof Element&&!ui(x))||document.elementFromPoint(e.clientX,e.clientY);while(n?.shadowRoot){const inner=n.shadowRoot.elementFromPoint(e.clientX,e.clientY);if(!inner||inner===n)break;n=inner;}if(n&&n!==document.body&&n!==document.documentElement){state.target=n;mark(n);}}
function key(e){if(e.key==='Escape'){e.preventDefault();stop();closeInspector();note('요소 선택 취소');return;}if(!state.picking)return;if(e.key==='ArrowUp'){e.preventDefault();state.target=parentNode(state.target)||state.target;mark(state.target);}if(e.key==='ArrowDown'&&state.target?.firstElementChild){e.preventDefault();state.target=state.target.firstElementChild;mark(state.target);}if(e.key==='Enter'){e.preventDefault();stop();showPanel(state.target);}}
function choose(e){if(ui(e.target))return;e.preventDefault();e.stopImmediatePropagation();const n=state.target||e.composedPath?.().find(x=>x instanceof Element&&!ui(x))||e.target;stop();showPanel(n);}
function closeInspector(){inspectorHost?.remove();inspectorHost=null;inspectorRoot=null;outlineBox=null;outlineLabel=null;treeBox=null;currentNode=null;selectorBox=null;countBox=null;infoBox=null;state.panel=null;}
function start(){stop();closeInspector();state.picking=true;state.target=null;initInspector();document.addEventListener('pointermove',move,true);document.addEventListener('click',choose,true);document.addEventListener('keydown',key,true);document.addEventListener('scroll',refreshMark,true);window.addEventListener('resize',refreshMark);note('요소 위로 이동 → 클릭. ↑ 상위 요소, Enter 확정, Esc 취소');}
function action(name,parent,fn,alt=false){const b=document.createElement('button');b.type='button';b.className='action'+(alt?' alt':'');b.textContent=name;b.onclick=fn;parent.appendChild(b);return b;}
function showPanel(node){initInspector();state.panel?.remove();const p=document.createElement('div');p.className='panel';state.panel=p;inspectorRoot.appendChild(p);
 const h=document.createElement('h3');h.textContent='DOM 요소 탐색기';p.appendChild(h);
 const hint=document.createElement('div');hint.className='hint';hint.textContent='요소를 클릭하면 실제 선택 영역이 청록색으로 강조됩니다. 상위 요소 또는 하위 요소를 선택해 이미지 그룹을 찾으세요.';p.appendChild(hint);
 treeBox=document.createElement('div');treeBox.className='tree';p.appendChild(treeBox);
 countBox=document.createElement('div');countBox.className='stats';p.appendChild(countBox);
 selectorBox=document.createElement('textarea');selectorBox.placeholder='CSS 선택자';p.appendChild(selectorBox);
 const row=document.createElement('div');row.className='buttons';p.appendChild(row);
 action('상위 요소',row,()=>selectNode(parentNode(currentNode)));action('선택 위치로 이동',row,()=>selectNode(currentNode,true),true);
 const scopeLabel=document.createElement('div');scopeLabel.className='hint';scopeLabel.textContent='URL 적용 범위 (챕터 이동에도 적용하려면 작품 전체 선택)';p.appendChild(scopeLabel);
 const scopeSelect=document.createElement('select');scopeSelect.style.cssText='width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:5px;background:white;color:#111827';
 [['chapter','현재 챕터만'],['work','현재 작품 전체 (추천)'],['section','같은 사이트의 작품/목록 경로'],['site','현재 사이트 전체'],['custom','직접 입력']].forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;scopeSelect.appendChild(o);});scopeSelect.value='work';p.appendChild(scopeSelect);
 const patternInput=document.createElement('input');patternInput.type='text';patternInput.style.cssText='width:100%;margin:7px 0 4px;padding:8px;border:1px solid #cbd5e1;border-radius:5px;font:12px monospace';p.appendChild(patternInput);
 const scopes=urlScopes();patternInput.value=scopes.work;
 scopeSelect.onchange=()=>{if(scopeSelect.value!=='custom')patternInput.value=urlScopes()[scopeSelect.value];else patternInput.focus();};
 patternInput.addEventListener('input',()=>{if(scopeSelect.value!=='custom'&&patternInput.value!==urlScopes()[scopeSelect.value])scopeSelect.value='custom';});
 const row2=document.createElement('div');row2.className='buttons';p.appendChild(row2);
 infoBox=document.createElement('div');infoBox.className='msg';p.appendChild(infoBox);
 const collect=()=>{const selector=selectorBox.value.trim();if(!selector)throw Error('선택자를 입력하세요.');const nodes=deepQuery(selector);if(!nodes.length)throw Error('선택자와 일치하는 요소 없음');const map=new Map();nodes.forEach(n=>imageList(n).forEach(x=>map.set(x.url,x)));return [...map.values()].map((x,i)=>({...x,index:i}));};
 action('이미지 확인',row2,()=>{try{const images=collect();infoBox.textContent='일치 요소 '+deepQuery(selectorBox.value.trim()).length+'개 / 이미지 '+images.length+'개\n'+images.slice(0,12).map(x=>x.url.slice(0,130)).join('\n');}catch(e){infoBox.textContent=e.message;}});
 action('규칙 저장',row2,async()=>{try{const selector=selectorBox.value.trim(),images=collect();if(!images.length)throw Error('이미지 없음');const pattern=patternInput.value.trim();if(!validPattern(pattern))throw Error('올바른 HTTP(S) URL 패턴을 입력하세요.');const {rules=[]}=await chrome.storage.local.get({rules:[]});rules.push({id:crypto.randomUUID(),name:prompt('규칙 이름',document.title.slice(0,35))||url.hostname,pattern,selector,enabled:true,autoSend:true});await chrome.storage.local.set({rules});infoBox.textContent='규칙 저장 완료';}catch(e){infoBox.textContent=e.message;}});
 action('지금 전송',row2,async()=>{try{await send(selectorBox.value.trim(),collect(),infoBox,{force:true});}catch(e){infoBox.textContent=e.message;}});
 action('다시 선택',row2,()=>start(),true);action('닫기',row2,()=>closeInspector(),true);
 selectNode(node);
}
// OCR overlay: viewport-positioned boxes; never alter the source image or page layout.
const ocrPaddingKey='kwt_ocr_padding_v1';
function ocrReadPadding(){try{const s=JSON.parse(localStorage.getItem(ocrPaddingKey)||'{}');return {x:Math.max(0,Math.min(40,Number(s.x??12)||0)),y:Math.max(0,Math.min(40,Number(s.y??8)||0)),show:s.show===true};}catch{return {x:12,y:8,show:false};}}
// KWT_UI_INPUT_VISIBILITY_V4: OCR hitboxes are hidden by default and the user's choice persists per website.
const kwtOcrVisibleKey='kwt-ocr-hitboxes-visible-v4';
function kwtReadOcrVisible(){
 try{return localStorage.getItem(kwtOcrVisibleKey)==='true';}catch{return false;}
}
function kwtSetOcrVisible(value){
 ocrOverlay.enabled=!!value;
 try{localStorage.setItem(kwtOcrVisibleKey,String(ocrOverlay.enabled));}catch{}
 ocrOverlay.updateLabel?.();
 ocrSchedule();
}
// Make form fields readable even when site styles override input colors.
function kwtReadableNumberInput(input,width){
 input.style.setProperty('width',width+'px','important');
 input.style.setProperty('min-width',width+'px','important');
 input.style.setProperty('height','30px','important');
 input.style.setProperty('box-sizing','border-box','important');
 input.style.setProperty('padding','4px 6px','important');
 input.style.setProperty('background-color','#ffffff','important');
 input.style.setProperty('color','#111827','important');
 input.style.setProperty('border','1px solid #94a3b8','important');
 input.style.setProperty('border-radius','5px','important');
 input.style.setProperty('opacity','1','important');
 input.style.setProperty('-webkit-text-fill-color','#111827','important');
 input.style.setProperty('font','600 13px/1.2 Arial, sans-serif','important');
 input.style.setProperty('text-align','center','important');
 input.style.setProperty('appearance','auto','important');
 input.style.setProperty('visibility','visible','important');
 input.style.setProperty('pointer-events','auto','important');
}
const ocrOverlay={enabled:kwtReadOcrVisible(),jobId:null,results:[],layers:[],toolbar:null,detail:null,raf:0,padding:ocrReadPadding(),progress:null,showTranslation:true};
function normImageUrl(raw){try{const u=new URL(raw,location.href);u.hash='';return u.href;}catch{return raw||'';}}
function pageImages(){const out=[];const seen=new Set();const walk=root=>{for(const img of root.querySelectorAll('img')){if(img.closest?.('[data-kone-ui="1"]'))continue;if(!seen.has(img)){seen.add(img);out.push(img);}}for(const e of root.querySelectorAll('*'))if(e.shadowRoot)walk(e.shadowRoot);};walk(document);return out;}
function ocrUi(){
 if(ocrOverlay.toolbar?.isConnected)return;
 const bar=el('div',{position:'fixed',left:'12px',bottom:'12px',zIndex:'2147483645',background:'#111827',color:'#fff',padding:'9px 11px',borderRadius:'9px',boxShadow:'0 3px 18px #0007',font:'12px sans-serif',maxWidth:'min(380px,calc(100vw - 24px))'});bar.dataset.koneUi='1';
 const toggle=document.createElement('button');toggle.type='button';Object.assign(toggle.style,{background:'#2563eb',border:'0',color:'#fff',padding:'6px 9px',borderRadius:'5px',cursor:'pointer'});
 const label=document.createElement('span');label.style.marginLeft='8px';
 const jobBadge=document.createElement('button');jobBadge.type='button';jobBadge.title='클릭하여 Job ID 복사';jobBadge.style.cssText='position:fixed;top:10px;left:10px;z-index:2147483646;background:#111827;color:#fff;border:1px solid #64748b;border-radius:6px;padding:6px 9px;font:12px monospace;max-width:calc(100vw - 20px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;box-shadow:0 2px 9px #0008';jobBadge.dataset.koneUi='1';jobBadge.onclick=()=>{if(ocrOverlay.jobId)navigator.clipboard?.writeText(String(ocrOverlay.jobId)).then(()=>{jobBadge.title='복사 완료';}).catch(()=>{});};document.documentElement.appendChild(jobBadge);ocrOverlay.jobBadge=jobBadge;
 const update=()=>{toggle.textContent=ocrOverlay.enabled?'OCR 박스 숨기기':'OCR 박스 표시';label.textContent=ocrOverlay.jobId?`${ocrOverlay.results.length}장 / ${ocrOverlay.results.reduce((n,r)=>n+(r.texts?.length||0),0)}영역`:'OCR 결과 대기';if(ocrOverlay.jobBadge){ocrOverlay.jobBadge.textContent=ocrOverlay.jobId?'Job ID: '+ocrOverlay.jobId:'Job ID: 대기 중';ocrOverlay.jobBadge.style.display=kwtTextState.allUiHidden?'none':(ocrOverlay.jobId?'block':'none');}};
 toggle.onclick=()=>kwtSetOcrVisible(!ocrOverlay.enabled);bar.append(toggle,label);
 const translateBtn=document.createElement('button');translateBtn.type='button';translateBtn.textContent='한국어 번역';
 translateBtn.style.cssText='display:block;margin-top:7px;padding:6px 9px;background:#7c3aed;color:white;border:0;border-radius:5px;cursor:pointer';
 translateBtn.onclick=async()=>{
  if(!ocrOverlay.jobId){note('OCR 작업이 완료된 후 번역할 수 있습니다.');return;}
  translateBtn.disabled=true;translateBtn.textContent='한국어 번역 중...';
  try{
   const response=await chrome.runtime.sendMessage({type:'TRANSLATE_JOB',jobId:ocrOverlay.jobId});
   if(!response?.ok)throw Error(response?.error||'번역 실패');
   const byIndex=new Map((response.result.results||[]).map(r=>[String(r.index),r]));
   for(const image of ocrOverlay.results){const updated=byIndex.get(String(image.index));if(!updated)continue;
    const byId=new Map((updated.texts||[]).map(t=>[String(t.id),t]));
    for(const region of image.texts){const fresh=byId.get(String(region.id));if(fresh){region.translated_text=fresh.translated_text||'';region.translation_source=fresh.translation_source||'';region.translation_model=fresh.translation_model||'';region.translation_provider=fresh.translation_provider||'';region.translation_local_url=fresh.translation_local_url||'';}}
   }
   ocrOverlay.showTranslation=true;ocrSchedule();
   note('한국어 번역 완료: '+response.result.translated+'개 영역'+(response.result.cached?' (캐시)':''));
  }catch(err){note('번역 오류: '+String(err.message||err));}
  finally{translateBtn.disabled=false;translateBtn.textContent='한국어 번역';}
 };
 bar.appendChild(translateBtn);ocrOverlay.kwtTranslateBtn=translateBtn;
 const liveIndicator=document.createElement('div');
 liveIndicator.style.cssText='margin-top:5px;font:11px sans-serif;color:#a7f3d0';
 liveIndicator.textContent='실시간 처리 대기';
 bar.appendChild(liveIndicator);
 ocrOverlay.liveIndicator=liveIndicator;
 const settingsBtn=document.createElement('button');settingsBtn.type='button';settingsBtn.textContent='번역 엔진 설정';settingsBtn.style.cssText='display:block;margin-top:5px;padding:5px 8px;background:#334155;color:#fff;border:1px solid #64748b;border-radius:5px;cursor:pointer';
 settingsBtn.onclick=async()=>{try{const reply=await chrome.runtime.sendMessage({type:'OPEN_TRANSLATION_SETTINGS'});if(!reply?.ok)throw Error(reply?.error||'설정 화면 열기 실패');}catch(err){note(String(err.message||err));}};
 bar.appendChild(settingsBtn);ocrOverlay.kwtSettingsBtn=settingsBtn;
 kwtAttachTextControls(bar);
 const transLabel=document.createElement('label');transLabel.style.cssText='display:flex;gap:4px;align-items:center;margin-top:5px';
 const transCheck=document.createElement('input');transCheck.type='checkbox';transCheck.checked=true;
 ocrOverlay.kwtTransCheck=transCheck;transCheck.onchange=()=>{ocrOverlay.showTranslation=transCheck.checked;ocrSchedule();};
 transLabel.append(transCheck,'번역문 표시');bar.appendChild(transLabel);
 const settings=document.createElement('div');settings.style.cssText='margin-top:8px;padding-top:7px;border-top:1px solid #475569;display:flex;gap:7px;align-items:center;flex-wrap:wrap';
 const makePaddingInput=(axis,caption)=>{const wrap=document.createElement('label');wrap.textContent=caption+' ';const input=document.createElement('input');input.type='number';input.min='0';input.max='40';input.step='2';input.value=String(ocrOverlay.padding[axis]);kwtReadableNumberInput(input,66);input.onchange=()=>{const n=Number(input.value);ocrOverlay.padding[axis]=Number.isFinite(n)?Math.max(0,Math.min(40,n)):0;input.value=String(ocrOverlay.padding[axis]);localStorage.setItem(ocrPaddingKey,JSON.stringify(ocrOverlay.padding));};wrap.append(input,'%');settings.appendChild(wrap);};
 makePaddingInput('x','가로');makePaddingInput('y','세로');
 const showLabel=document.createElement('label');showLabel.style.cssText='display:flex;align-items:center;gap:3px';const showInput=document.createElement('input');showInput.type='checkbox';showInput.checked=ocrOverlay.padding.show;showInput.onchange=()=>{ocrOverlay.padding.show=showInput.checked;localStorage.setItem(ocrPaddingKey,JSON.stringify(ocrOverlay.padding));ocrSchedule();};showLabel.append(showInput,'확대 영역');settings.append(showLabel);
 const textLabel=document.createElement('label');textLabel.style.cssText='display:flex;align-items:center;gap:3px';const textInput=document.createElement('input');textInput.type='checkbox';textInput.checked=ocrOverlay.showText!==false;ocrOverlay.kwtTextCheck=textInput;textInput.onchange=()=>{ocrOverlay.showText=textInput.checked;localStorage.setItem('kwt-ocr-show-text',String(textInput.checked));ocrSchedule();};textLabel.append(textInput,'인식 텍스트');settings.append(textLabel);
 const progressBox=document.createElement('div');progressBox.style.cssText='display:none;margin-top:8px;padding:8px;background:#1e293b;border:1px solid #475569;border-radius:6px;min-width:250px';bar.appendChild(progressBox);ocrOverlay.progressBox=progressBox;ocrUpdateProgress();
 const hint=document.createElement('div');hint.textContent='여백 변경 후 OCR 강제 실행 필요 (캐시는 설정별 분리)';hint.style.cssText='font:10px sans-serif;color:#cbd5e1;width:100%';settings.appendChild(hint);bar.appendChild(settings);
 ocrOverlay.toolbar=bar;ocrOverlay.updateLabel=update;update();
 kwtApplyUiVisibility();
 const detail=el('div',{position:'fixed',left:'12px',bottom:'65px',zIndex:'2147483646',background:'#fff',color:'#111827',padding:'13px',borderRadius:'9px',border:'1px solid #94a3b8',boxShadow:'0 3px 18px #0007',font:'13px sans-serif',width:'min(410px,calc(100vw - 24px))',maxHeight:'45vh',overflow:'auto',display:'none',whiteSpace:'pre-wrap',overflowWrap:'anywhere'});detail.dataset.koneUi='1';ocrOverlay.detail=detail;
 const close=document.createElement('button');close.textContent='닫기';close.style.cssText='float:right;cursor:pointer;margin-left:8px';close.onclick=()=>{detail.style.display='none';};detail.appendChild(close);
 const body=document.createElement('div');detail.appendChild(body);ocrOverlay.detailBody=body;
}
function ocrUpdateProgress(){
 const box=ocrOverlay.progressBox,p=ocrOverlay.progress;if(!box)return;
 if(!p){box.style.display='none';return;}box.style.display='block';
 const total=Number(p.total)||0,done=Math.max(0,Number(p.done)||0),pct=total?Math.min(100,Math.round(done/total*100)):0;
 const stage=String(p.stage||'OCR 준비 중');box.replaceChildren();
 const heading=document.createElement('div');heading.style.cssText='font-weight:bold;margin-bottom:5px';heading.textContent=stage;box.appendChild(heading);
 const track=document.createElement('div');track.style.cssText='height:7px;border-radius:5px;background:#475569;overflow:hidden';
 const fill=document.createElement('div');fill.style.cssText='height:100%;background:#10b981;width:'+pct+'%';track.appendChild(fill);box.appendChild(track);
 const line=document.createElement('div');line.style.cssText='display:flex;justify-content:space-between;gap:8px;margin-top:5px;font:11px sans-serif';
 const detail=document.createElement('span');detail.textContent=total?done+' / '+total+'장':'진행 상태 확인 중';
 const percent=document.createElement('span');percent.textContent=total?pct+'%':'';line.append(detail,percent);box.appendChild(line);
 if(p.jobId){const id=document.createElement('div');id.style.cssText='margin-top:5px;color:#cbd5e1;font:11px monospace;cursor:pointer';id.textContent='Job ID: '+p.jobId;id.title='클릭하여 복사';id.onclick=()=>navigator.clipboard?.writeText(p.jobId).catch(()=>{});box.appendChild(id);}
 if(p.failed){const failed=document.createElement('div');failed.style.cssText='color:#fca5a5;margin-top:4px';failed.textContent='전송 실패 '+p.failed+'장';box.appendChild(failed);}
}
function ocrProgress(stage,done=0,total=0,jobId=null,failed=0){ocrOverlay.progress={stage,done,total,jobId,failed};ocrUi();ocrUpdateProgress();}
function ocrFinishProgress(){ocrOverlay.progress=null;ocrUpdateProgress();}
function ocrClear(){for(const layer of ocrOverlay.layers)layer.remove();ocrOverlay.layers=[];if(ocrOverlay.detail)ocrOverlay.detail.style.display='none';}
// KWT_STREAM_DIAG_V2: preserve already translated regions when partial snapshots arrive.
function kwtStreamApply(job){
 if(!job?.job_id)return;
 if(ocrOverlay.jobId!==job.job_id){ocrOverlay.results=[];}
 const incoming=(job.results||[]).filter(r=>Array.isArray(r.texts)&&r.texts.length);
 const old=new Map(ocrOverlay.results.map(r=>[String(r.index),r]));
 for(const page of incoming){
  const previous=old.get(String(page.index));
  if(previous){
   const translated=new Map((previous.texts||[]).filter(t=>t.translated_text).map(t=>[String(t.id),t]));
   for(const t of page.texts){
    const prev=translated.get(String(t.id));
    if(prev&&!t.translated_text&&prev.text===t.text)t.translated_text=prev.translated_text;
   }
  }
  old.set(String(page.index),page);
 }
 ocrOverlay.results=[...old.values()].sort((a,b)=>Number(a.index)-Number(b.index));
 ocrOverlay.jobId=job.job_id;
 ocrUi();ocrOverlay.updateLabel();ocrSchedule();
 const rendered=ocrOverlay.results.filter(p=>p.texts.some(t=>t.translated_text)).length;
 const label=ocrOverlay.liveIndicator;
 if(label)label.textContent=`실시간: OCR ${job.completed||0}/${job.total||'?'} · 번역 ${job.translation_completed||0}/${job.total||'?'} · 표시 ${rendered}장`;
 console.info('[KWT_STREAM_DIAG_V2] snapshot', {job:job.job_id,ocr:job.completed,translated:job.translation_completed,displayed:rendered,revision:job.stream_revision,event:job.last_stream_event});
}
function ocrSetJob(job){
 ocrClear();ocrOverlay.jobId=job.job_id;ocrOverlay.results=(job.results||[]).filter(r=>Array.isArray(r.texts)&&r.texts.length);
 if(!ocrOverlay.results.length){note('OCR 결과에 표시할 영역이 없습니다.');return;}
 ocrUi();ocrOverlay.updateLabel();ocrSchedule();
}
function ocrImageGeometry(img,result){
 const rect=img.getBoundingClientRect();if(rect.width<2||rect.height<2)return null;
 const iw=img.naturalWidth||result.width,ih=img.naturalHeight||result.height;
 if(!iw||!ih)return null;
 const style=getComputedStyle(img),fit=style.objectFit||'fill';let dw=rect.width,dh=rect.height;
 if(fit==='contain'||fit==='scale-down'||fit==='cover'){
  const ratio=fit==='cover'?Math.max(rect.width/iw,rect.height/ih):Math.min(rect.width/iw,rect.height/ih);
  const scale=fit==='scale-down'?Math.min(1,ratio):ratio;dw=iw*scale;dh=ih*scale;
 }
 let px=.5,py=.5;const pos=(style.objectPosition||'50% 50%').split(/\s+/);const pct=v=>v==='left'||v==='top'?0:v==='right'||v==='bottom'?1:v==='center'?0.5:/^-?\d+(\.\d+)?%$/.test(v)?parseFloat(v)/100:.5;
 px=pct(pos[0]||'50%');py=pct(pos[1]||'50%');
 return {left:rect.left+(rect.width-dw)*px,top:rect.top+(rect.height-dh)*py,sx:dw/result.width,sy:dh/result.height,rect};
}
function ocrConfidence(value){
 const n=Number(value);
 if(value===null||value===undefined||value===''||!Number.isFinite(n))return 'N/A';
 return (n*100).toFixed(1)+'%';
}
// OCR text labels can be toggled without re-running OCR.
if(ocrOverlay.showText===undefined)ocrOverlay.showText=localStorage.getItem('kwt-ocr-show-text')!=='false';
function ocrComparisonDetail(body,t,result,b){
 const win=t.windows_ocr||{status:'unknown',text:''};
 const selected=t.selected_engine==='windows'?'windows':'manga';
 const selectedText=selected==='windows'&&win.status==='ok'?(win.text||''):(t.text||'');
 const selectedReason=selected==='windows'?'가로형+상태 기호 조건 충족, Windows OCR 결과 적용':'가로형+상태 기호 조건 미충족 또는 Windows OCR 실패로 MangaOCR 유지';
 body.replaceChildren();
 const add=(tag,text,css)=>{const n=document.createElement(tag);n.textContent=text;if(css)n.style.cssText=css;body.appendChild(n);return n;};
 add('div',`이미지 ${Number(result.index)+1} / 영역 #${t.id} · 검출 신뢰도 ${ocrConfidence(t.detection_confidence)}`,'font-weight:700;margin-bottom:7px');
 add('div',`원본 검출 좌표: ${b.join(', ')}\nOCR 입력 좌표: ${(t.ocr_crop_bbox||b).join(', ')}`,'font-size:11px;color:#64748b;white-space:pre-wrap;margin-bottom:9px');
 add('div',`실제 선택 엔진: ${selected==='manga'?'MangaOCR':'Windows OCR'}`,'font-weight:700;color:#065f46;margin-bottom:3px');
 add('div',`선택 이유: ${selectedReason}`,'font-size:12px;margin-bottom:8px');
 add('div','한국어 번역: '+(t.translated_text||'(미번역)'),'background:#eff6ff;border:1px solid #93c5fd;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:10px');
 add('div','실제 표시/사용 중인 원문','font-weight:700;margin-bottom:3px');
 add('div',selectedText||'(빈 텍스트)','background:#ecfdf5;border:1px solid #6ee7b7;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:10px');
 const columns=document.createElement('div');columns.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px';body.appendChild(columns);
 const panel=(heading,value)=>{const box=document.createElement('div');box.style.cssText='min-width:0;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:5px;padding:7px';const h=document.createElement('div');h.textContent=heading;h.style.cssText='font-weight:700;margin-bottom:6px';const txt=document.createElement('div');txt.textContent=value||'(결과 없음)';txt.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto';box.append(h,txt);columns.appendChild(box);};
 panel('MangaOCR 원문',t.manga_ocr_text??t.text??'');panel('Windows OCR 원문',win.text||'');
 add('div',`Windows OCR 상태: ${win.status||'unknown'}${t.windows_ocr_manual?' (수동 실행)':''}\n실행 조건: 가로형 박스 + 상태/표 특수문자\n실행 근거: ${(t.windows_ocr_reasons||[]).join(', ')||'없음'}${win.error?'\n오류: '+win.error:''}`,'font-size:12px;white-space:pre-wrap');
}
// KWT_TEXT_LAYER_V2_BEGIN
// Text layers own their coordinates and styling independently of OCR hitboxes.
const kwtTextLayerKey = 'kwt-text-layout-v1:' + location.origin + location.pathname;
const kwtGlobalKey = 'kwt-text-global-v2';
const kwtTextState = {edit:false,data:{},fontSize:18,active:null,dragging:false,menu:null,uiHidden:false,launcher:null};
try {kwtTextState.data=JSON.parse(localStorage.getItem(kwtTextLayerKey)||'{}')||{};}catch{kwtTextState.data={};}
try {const g=JSON.parse(localStorage.getItem(kwtGlobalKey)||'{}');kwtTextState.fontSize=Math.min(72,Math.max(8,Number(g.fontSize)||18));}catch{}
function kwtSave(){try{localStorage.setItem(kwtTextLayerKey,JSON.stringify(kwtTextState.data));}catch(e){console.warn('[KWT_TEXT] save',e);}}
function kwtSaveGlobal(){try{localStorage.setItem(kwtGlobalKey,JSON.stringify({fontSize:kwtTextState.fontSize}));}catch{}}
function kwtTextId(result,t){return JSON.stringify([normImageUrl(result.url),String(t.id),...(t.bbox||[])]);}
function kwtSettings(result,t){
 const key=kwtTextId(result,t),saved=kwtTextState.data[key]||{};
 const [x,y,w,h]=t.bbox.map(Number);
 const defaults={x,y,w:Math.max(w,90),h:Math.max(h,45)};
 return {key,box:{...defaults,...saved,x:Number.isFinite(saved.x)?saved.x:x,y:Number.isFinite(saved.y)?saved.y:y,w:Number.isFinite(saved.w)?saved.w:defaults.w,h:Number.isFinite(saved.h)?saved.h:defaults.h}};
}
function kwtChangeFont(value,key=null){
 const size=Math.max(8,Math.min(72,Math.round(Number(value)||18)));
 if(key){kwtTextState.data[key]={...kwtTextState.data[key],fontSize:size};kwtSave();}
 else{kwtTextState.fontSize=size;kwtSaveGlobal();if(ocrOverlay.kwtFontInput)ocrOverlay.kwtFontInput.value=String(size);}
 ocrSchedule();
}
function kwtRenderTextLayer(result,t,geo){
 if(ocrOverlay.showText===false)return;
 const translated=ocrOverlay.showTranslation&&String(t.translated_text||'').trim();
 const content=translated?String(t.translated_text):String(t.text||'');if(!content.trim())return;
 const {key,box}=kwtSettings(result,t);
 const left=geo.left+box.x*geo.sx,top=geo.top+box.y*geo.sy;
 const width=Math.max(35,box.w*geo.sx),height=Math.max(25,box.h*geo.sy);
 if(left+width<0||top+height<0||left>innerWidth||top>innerHeight)return;
 const editing=kwtTextState.edit,selected=kwtTextState.active===key;
 const layer=el('div',{
  position:'fixed',left:left+'px',top:top+'px',width:width+'px',height:height+'px',
  zIndex:'2147483642',boxSizing:'border-box',margin:'0',padding:'4px 5px',
  background:'rgba(17,24,39,.86)',color:'#fff',border:'1px solid '+(editing?(selected?'#fbbf24':'#60a5fa'):'transparent'),
  borderRadius:'4px',fontFamily:'Malgun Gothic, sans-serif',fontSize:(Number(box.fontSize)||kwtTextState.fontSize)*Math.max(.5,Math.min(3,geo.sy))+'px',lineHeight:'1.28',
  whiteSpace:'pre-wrap',overflowWrap:'anywhere',wordBreak:'break-word',overflow:'hidden',boxShadow:'0 2px 6px #0008',
  cursor:editing?'move':'default',pointerEvents:editing?'auto':'none',touchAction:'none',userSelect:'none'
 });
 layer.dataset.koneUi='1';layer.dataset.kwtTextLayer='1';layer.dataset.kwtLayerKey=key;
 layer.title=editing?'드래그 이동 · 파란 모서리 크기 조절 · 우클릭 메뉴':'한국어/OCR 텍스트';
 const txt=document.createElement('div');txt.textContent=content;txt.style.cssText='width:100%;height:100%;overflow:hidden;pointer-events:none';layer.appendChild(txt);
 if(editing){
  const handle=document.createElement('div');handle.title='크기 조절';handle.style.cssText='position:absolute;right:0;bottom:0;width:16px;height:16px;background:#60a5fa;border-radius:4px 0 0 0;cursor:nwse-resize;touch-action:none;z-index:2';layer.appendChild(handle);
  layer.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;
   e.preventDefault();e.stopImmediatePropagation();kwtCloseMenu();kwtTextState.active=key;
   const mode=(e.target===handle)?'resize':'move';const startX=e.clientX,startY=e.clientY;
   const initial={x:parseFloat(layer.style.left),y:parseFloat(layer.style.top),w:parseFloat(layer.style.width),h:parseFloat(layer.style.height)};
   kwtTextState.dragging=true;layer.style.borderColor='#fbbf24';
   const move=ev=>{
    const dx=ev.clientX-startX,dy=ev.clientY-startY;
    if(mode==='resize'){layer.style.width=Math.max(35,initial.w+dx)+'px';layer.style.height=Math.max(25,initial.h+dy)+'px';}
    else{layer.style.left=initial.x+dx+'px';layer.style.top=initial.y+dy+'px';}
   };
   const finish=()=>{
    window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);
    const x=(parseFloat(layer.style.left)-geo.left)/geo.sx,y=(parseFloat(layer.style.top)-geo.top)/geo.sy;
    const w=parseFloat(layer.style.width)/geo.sx,h=parseFloat(layer.style.height)/geo.sy;
    if([x,y,w,h].every(Number.isFinite)){
     const old=kwtTextState.data[key]||{};
     kwtTextState.data[key]={...old,x:+x.toFixed(2),y:+y.toFixed(2),w:+w.toFixed(2),h:+h.toFixed(2)};kwtSave();
    }
    kwtTextState.dragging=false;ocrSchedule();
   };
   window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);
  });
  layer.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();if(confirm('번역문 박스의 위치/크기를 초기화할까요?')){delete kwtTextState.data[key];kwtSave();ocrSchedule();}});
 }
 ocrOverlay.layers.push(layer);
}
function kwtCloseMenu(){kwtTextState.menu?.remove();kwtTextState.menu=null;}
function kwtContextMenu(e){
 const layer=e.target?.closest?.('[data-kwt-text-layer="1"]');
 const img=e.target?.closest?.('img');
 const matchingImage=img&&ocrOverlay.results.some(r=>normImageUrl(r.url)===normImageUrl(img.currentSrc||img.src||img.dataset.src||img.dataset.original));
 const matched=layer||matchingImage||e.target?.closest?.('[data-kwt-toolbar="1"]');
 if(!matched||e.shiftKey)return; // Shift+right-click retains browser's native context menu.
 e.preventDefault();e.stopPropagation();kwtCloseMenu();
 const key=layer?.dataset.kwtLayerKey||null;
 const menu=el('div',{position:'fixed',left:'0',top:'0',zIndex:'2147483647',background:'#111827',color:'#fff',border:'1px solid #64748b',borderRadius:'7px',padding:'5px',boxShadow:'0 6px 20px #0009',font:'12px sans-serif',minWidth:'210px'});
 menu.dataset.koneUi='1';kwtTextState.menu=menu;
 const item=(title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.style.cssText='display:block;width:100%;padding:8px 10px;text-align:left;border:0;background:transparent;color:white;cursor:pointer';b.onmouseenter=()=>b.style.background='#334155';b.onmouseleave=()=>b.style.background='transparent';b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();kwtCloseMenu();fn();};menu.appendChild(b);};
 item(ocrOverlay.enabled?'OCR 검출 박스 숨기기':'OCR 검출 박스 표시',()=>kwtSetOcrVisible(!ocrOverlay.enabled));
 item(ocrOverlay.showText===false?'텍스트 레이어 표시':'텍스트 레이어 숨기기',()=>{ocrOverlay.showText=ocrOverlay.showText===false;localStorage.setItem('kwt-ocr-show-text',String(ocrOverlay.showText));ocrOverlay.kwtTextCheck&&(ocrOverlay.kwtTextCheck.checked=ocrOverlay.showText);ocrSchedule();});
 item(kwtTextState.edit?'번역문 편집 종료':'번역문 드래그 편집',()=>{kwtTextState.edit=!kwtTextState.edit;if(ocrOverlay.kwtEditCheck)ocrOverlay.kwtEditCheck.checked=kwtTextState.edit;ocrSchedule();});
 item(key?'선택 박스 글자 크게 +2':'전체 글자 크게 +2',()=>kwtChangeFont(key?(kwtTextState.data[key]?.fontSize||kwtTextState.fontSize)+2:kwtTextState.fontSize+2,key));
 item(key?'선택 박스 글자 작게 -2':'전체 글자 작게 -2',()=>kwtChangeFont(key?(kwtTextState.data[key]?.fontSize||kwtTextState.fontSize)-2:kwtTextState.fontSize-2,key));
 item(ocrOverlay.showTranslation?'일본어 OCR 원문 표시':'한국어 번역문 표시',()=>{ocrOverlay.showTranslation=!ocrOverlay.showTranslation;if(ocrOverlay.kwtTransCheck)ocrOverlay.kwtTransCheck.checked=ocrOverlay.showTranslation;ocrSchedule();});
 item(kwtTextState.uiHidden?'설정 패널 표시':'설정 패널 숨기기',()=>kwtTogglePanel());
 item('한국어 번역 실행',()=>ocrOverlay.kwtTranslateBtn?.click());
 item('번역 엔진 설정 열기',()=>ocrOverlay.kwtSettingsBtn?.click());
 item('OCR 강제 실행',()=>chrome.runtime.sendMessage({type:'FORCE_OCR'}).catch?.(()=>{}));
 if(key)item('이 번역문 배치 초기화',()=>{if(confirm('이 번역문 박스 위치, 크기와 글꼴 설정을 초기화할까요?')){delete kwtTextState.data[key];kwtSave();ocrSchedule();}});
 const w=menu.offsetWidth,h=menu.offsetHeight;menu.style.left=Math.max(4,Math.min(e.clientX,innerWidth-w-4))+'px';menu.style.top=Math.max(4,Math.min(e.clientY,innerHeight-h-4))+'px';
}
// KWT_NATIVE_CONTEXT_MENU_V3: use native Chrome extension context menu instead.
// document.addEventListener('contextmenu',kwtContextMenu,true);
document.addEventListener('pointerdown',e=>{if(kwtTextState.menu&&!kwtTextState.menu.contains(e.target))kwtCloseMenu();},true);
window.addEventListener('scroll',kwtCloseMenu,true);
// KWT_NATIVE_CONTEXT_MENU_V3 - fully hide the tool UI, not translated text layers.
const kwtAllUiKey = 'kwt-all-ui-hidden-v3';
kwtTextState.allUiHidden = localStorage.getItem(kwtAllUiKey) === 'true';
function kwtApplyUiVisibility(){
 const hidden=kwtTextState.allUiHidden;
 if(ocrOverlay.toolbar)ocrOverlay.toolbar.style.display=(hidden||kwtTextState.uiHidden)?'none':'block';
 if(ocrOverlay.jobBadge)ocrOverlay.jobBadge.style.display=hidden?'none':(ocrOverlay.jobId?'block':'none');
 if(ocrOverlay.kwtPanelButton){
  ocrOverlay.kwtPanelButton.style.display=hidden?'none':'block';
  ocrOverlay.kwtPanelButton.textContent=kwtTextState.uiHidden?'KWT 열기':'KWT 접기';
 }
 if(ocrOverlay.detail){
  if(hidden)ocrOverlay.detail.style.display='none';
 }
 if(hidden){
  kwtCloseMenu();
  const toast=document.getElementById(ROOT+'toast');if(toast)toast.remove();
  if(state.panel)state.panel.style.display='none';
  if(inspectorHost)inspectorHost.style.display='none';
 }
}
function kwtSetAllUiHidden(hidden){
 kwtTextState.allUiHidden=!!hidden;
 try{localStorage.setItem(kwtAllUiKey,String(kwtTextState.allUiHidden));}catch{}
 if(!hidden){
  // Explicit show always brings back the main toolbar, not only the launcher.
  kwtTextState.uiHidden=false;
 }
 kwtApplyUiVisibility();
}
function kwtTogglePanel(force){
 kwtTextState.uiHidden=force===undefined?!kwtTextState.uiHidden:!!force;
 kwtApplyUiVisibility();
}
function kwtNativeContextAction(action){
 switch(action){
 case 'ui-show':kwtSetAllUiHidden(false);break;
 case 'ui-hide':kwtSetAllUiHidden(true);break;
 case 'ui-toggle':kwtSetAllUiHidden(!kwtTextState.allUiHidden);break;
 case 'ocr-toggle':kwtSetOcrVisible(!ocrOverlay.enabled);break;
 case 'text-toggle':ocrOverlay.showText=ocrOverlay.showText===false;
  try{localStorage.setItem('kwt-ocr-show-text',String(ocrOverlay.showText));}catch{}
  if(ocrOverlay.kwtTextCheck)ocrOverlay.kwtTextCheck.checked=ocrOverlay.showText;ocrSchedule();break;
 case 'edit-toggle':kwtTextState.edit=!kwtTextState.edit;
  if(ocrOverlay.kwtEditCheck)ocrOverlay.kwtEditCheck.checked=kwtTextState.edit;ocrSchedule();break;
 case 'translate':ocrUi();ocrOverlay.kwtTranslateBtn?.click();break;
 case 'force-ocr':manualRun().catch(e=>console.warn('[KWT] force OCR failed:',e));break;
 default:return false;
 }
 return true;
}
function kwtAttachTextControls(bar){
 bar.dataset.kwtToolbar='1';
 const hideAll=document.createElement('button');hideAll.type='button';hideAll.textContent='KWT 화면 UI 전체 숨기기';hideAll.title='좌하단 패널 / Job ID / 우하단 버튼을 숨깁니다. 복귀: 브라우저 우클릭 > KoneWebTranslator';hideAll.style.cssText='display:block;margin-top:7px;padding:5px 8px;background:#475569;color:white;border:1px solid #64748b;border-radius:5px;cursor:pointer';hideAll.onclick=()=>kwtSetAllUiHidden(true);bar.appendChild(hideAll);
 const checkWrap=document.createElement('label');checkWrap.style.cssText='display:flex;align-items:center;gap:5px;margin-top:7px';
 const check=document.createElement('input');check.type='checkbox';check.checked=kwtTextState.edit;ocrOverlay.kwtEditCheck=check;
 check.onchange=()=>{kwtTextState.edit=check.checked;ocrSchedule();};checkWrap.append(check,'번역문 편집 (드래그/크기)');bar.appendChild(checkWrap);
 const fonts=document.createElement('div');fonts.style.cssText='display:flex;align-items:center;gap:6px;margin-top:6px';
 const label=document.createElement('span');label.textContent='기본 글자 크기';const inp=document.createElement('input');inp.type='number';inp.min='8';inp.max='72';inp.step='1';inp.value=String(kwtTextState.fontSize);inp.title='전체 텍스트 박스의 기본 글자 크기';kwtReadableNumberInput(inp,72);ocrOverlay.kwtFontInput=inp;
 inp.onchange=()=>kwtChangeFont(inp.value);fonts.append(label,inp,'px');bar.appendChild(fonts);
 const hint=document.createElement('div');hint.textContent='편집 중 드래그 이동/우하단 크기 조절 · 우클릭: 영역별 글자 크기';hint.style.cssText='font:10px sans-serif;color:#cbd5e1;margin-top:3px';bar.appendChild(hint);
 // Keep this compact handle outside the large toolbar, so the toolbar can always be restored.
 const button=el('button',{position:'fixed',right:'10px',bottom:'10px',zIndex:'2147483646',background:'#2563eb',color:'white',padding:'6px 10px',border:'1px solid #93c5fd',borderRadius:'6px',font:'12px sans-serif',cursor:'pointer'});
 button.dataset.koneUi='1';button.dataset.kwtToolbar='1';button.type='button';button.textContent='KWT 접기';button.title='KoneWebTranslator 패널 열기/접기 · Ctrl+Shift+K';button.onclick=()=>kwtTogglePanel();kwtTextState.launcher=button;ocrOverlay.kwtPanelButton=button;kwtApplyUiVisibility();
}
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyK'){e.preventDefault();if(kwtTextState.allUiHidden)kwtSetAllUiHidden(false);else kwtTogglePanel();}},true);
// KWT_TEXT_LAYER_V2_END


function ocrDraw(){
 ocrOverlay.raf=0;if(kwtTextState.dragging)return;for(const layer of ocrOverlay.layers)layer.remove();ocrOverlay.layers=[];if(!ocrOverlay.results.length)return;
 const imgs=pageImages();const byUrl=new Map();for(const img of imgs){const url=normImageUrl(img.currentSrc||img.src||img.dataset.src||img.dataset.original);if(!byUrl.has(url))byUrl.set(url,[]);byUrl.get(url).push(img);}
 for(const result of ocrOverlay.results){const candidates=byUrl.get(normImageUrl(result.url))||[];
  for(const img of candidates){const geo=ocrImageGeometry(img,result);if(!geo)continue;
   if(geo.rect.bottom<0||geo.rect.top>innerHeight||geo.rect.right<0||geo.rect.left>innerWidth)continue;
   for(const t of result.texts){const b=t.bbox;if(!Array.isArray(b)||b.length!==4||b.some(v=>!Number.isFinite(Number(v))))continue;
    const [x,y,w,h]=b.map(Number);if(w<=0||h<=0)continue;
    const left=geo.left+x*geo.sx,top=geo.top+y*geo.sy,width=w*geo.sx,height=h*geo.sy;
    if(left+width<0||top+height<0||left>innerWidth||top>innerHeight)continue;
    kwtRenderTextLayer(result,t,geo);
    if(ocrOverlay.enabled){
    const layer=el('button',{position:'fixed',left:left+'px',top:top+'px',width:width+'px',height:height+'px',boxSizing:'border-box',background:'rgba(16,185,129,.12)',border:'2px solid #10b981',borderRadius:'2px',zIndex:'2147483640',cursor:'pointer',padding:'0',margin:'0',pointerEvents:'auto'});layer.type='button';layer.dataset.koneUi='1';layer.title=`#${t.id} | 검출 신뢰도 ${ocrConfidence(t.detection_confidence)} | ${t.text||''}`;
    const tag=document.createElement('span');tag.textContent=`${t.id} · ${ocrConfidence(t.detection_confidence)}${t.selected_engine==='windows'?' · W(적용)':t.windows_ocr?.status==='ok'?' · W(비교)':''}`;tag.style.cssText='position:absolute;top:0;left:0;background:#059669;color:white;font:600 11px Arial;padding:2px 4px;white-space:nowrap;pointer-events:none;box-shadow:0 1px 3px #0007';layer.appendChild(tag);

    layer.onclick=e=>{
      e.preventDefault();e.stopPropagation();ocrUi();
      const detail=ocrOverlay.detail,body=ocrOverlay.detailBody;
      ocrComparisonDetail(body,t,result,b);
      const run=document.createElement('button');run.type='button';run.textContent='이 영역 Windows OCR 강제 실행';run.style.cssText='display:block;margin:12px 0;padding:8px 10px;background:#2563eb;color:white;border:0;border-radius:5px;cursor:pointer';
      run.onclick=async()=>{
        run.disabled=true;run.textContent='Windows OCR 실행 중...';
        try{
          const response=await chrome.runtime.sendMessage({type:'WINDOWS_OCR_REGION',jobId:ocrOverlay.jobId,imageIndex:result.index,regionId:t.id,imageUrl:result.url});
          if(!response?.ok)throw Error(response?.error||'서버 응답 오류');
          t.windows_ocr=response.result.windows_ocr;if(t.windows_ocr?.status==='ok'&&t.windows_ocr.text?.trim()){t.manga_ocr_text??=t.text;t.text=t.windows_ocr.text.trim();t.selected_engine='windows';}t.windows_ocr_manual=true;
          ocrComparisonDetail(body,t,result,b);
          body.appendChild(run);ocrSchedule();
        }catch(err){const error=document.createElement('div');error.textContent='실행 실패: '+err.message;error.style.color='#b91c1c';body.appendChild(error);}
        finally{run.disabled=false;run.textContent='이 영역 Windows OCR 다시 실행';}
      };
      body.appendChild(run);detail.style.display='block';
    };
    ocrOverlay.layers.push(layer);
    if(ocrOverlay.padding.show&&Array.isArray(t.ocr_crop_bbox)&&t.ocr_crop_bbox.length===4){
      const [cx,cy,cw,ch]=t.ocr_crop_bbox.map(Number);
      const outline=el('div',{position:'fixed',left:(geo.left+cx*geo.sx)+'px',top:(geo.top+cy*geo.sy)+'px',width:(cw*geo.sx)+'px',height:(ch*geo.sy)+'px',boxSizing:'border-box',border:'2px dashed #f59e0b',background:'transparent',zIndex:'2147483639',pointerEvents:'none'});outline.dataset.koneUi='1';ocrOverlay.layers.push(outline);
    }
    } // OCR-only layer
   }
  }
 }
}
function ocrSchedule(){if(ocrOverlay.raf)return;ocrOverlay.raf=requestAnimationFrame(ocrDraw);}
function ocrReposition(){if(ocrOverlay.results.length)ocrSchedule();}
window.addEventListener('scroll',ocrReposition,true);window.addEventListener('resize',ocrReposition);
// Restore last successful job on the same chapter after a page reload.
async function ocrRestore(){try{const key='kwt-ocr-job:'+location.origin+location.pathname;const data=await chrome.storage.local.get(key);const id=data[key];if(!id)return;const res=await chrome.runtime.sendMessage({type:'JOB_STATUS',jobId:id});if(res?.ok&&res.result?.source_url===location.href&&res.result?.results?.length)ocrSetJob(res.result);}catch{}}

let kwtProgressTarget=null;
chrome.runtime.onMessage.addListener(msg=>{
 if(msg.type!=='KWT_PROGRESS')return;
 ocrProgress(msg.stage==='download'?'이미지 다운로드 중':msg.stage==='upload'?'이미지 서버 전송 중':'처리 중',msg.done,msg.total,msg.jobId||ocrOverlay.progress?.jobId||null,msg.failed||0);
 if(!kwtProgressTarget)return;
 const label=msg.stage==='download'?'CDN 이미지 다운로드':msg.stage==='upload'?'로컬 서버 업로드':'처리';
 kwtProgressTarget.textContent=`${label}: ${msg.done}/${msg.total}장 (${Math.round(100*msg.done/Math.max(1,msg.total))}%)${msg.failed?' / 실패 '+msg.failed+'장':''}`;
});
async function send(selector,images,info,{force=false}={}){
 if(state.working)return {ok:false,busy:true};if(!images.length)throw Error('전송할 이미지가 없습니다.');
 state.working=true;kwtProgressTarget=info;info.textContent='기존 OCR 결과 확인 중...';ocrProgress('기존 OCR 결과 확인 중');
 try{
  if(!force){const cache=await chrome.runtime.sendMessage({type:'CACHE_LOOKUP',pageUrl:location.href,images,padX:ocrOverlay.padding.x,padY:ocrOverlay.padding.y});
   if(!cache?.ok)throw Error('기존 OCR 조회 실패: '+(cache?.error||'서버 응답 없음'));
   if(cache.result?.found){ocrSetJob(cache.result.job);info.textContent='기존 OCR 결과 재사용 ('+cache.result.job.results.length+'장). 재연산하지 않았습니다.';return {ok:true,cached:true};}
  }
  // KWT_PRIVATE_EARLY_OCR_STREAM_V3_1 · streaming is opt-in; cached jobs and legacy batch stay unchanged.
  info.textContent='이미지 다운로드 준비 중...';ocrProgress('이미지 다운로드 준비 중',0,images.length);
  // KWT_VIRTUAL_BUBBLE_SAFE_V4_2: default ON; explicitly saved OFF still wins.
   const {kwtFastStreamV1=true}=await chrome.storage.local.get({kwtFastStreamV1:true});
  let data=null,uploadPromise=null;
  if(kwtFastStreamV1){
    // Before a job is accepted, falling back to the old batch is safe.
    const streamImages=images.map((image,index)=>({...image,index}));
    const start=await chrome.runtime.sendMessage({type:'STREAM_START',pageUrl:location.href,selector,images:streamImages,padX:ocrOverlay.padding.x,padY:ocrOverlay.padding.y});
    if(start?.ok && start.result?.job_id){
      const streamId=start.result.job_id;
      data={result:{job_id:streamId},uploaded:images.length,failures:[]};
      // Begin download/upload concurrently with existing 1.5s result polling.
      uploadPromise=chrome.runtime.sendMessage({type:'STREAM_UPLOAD',jobId:streamId,images:streamImages})
        .then(res=>{
          if(!res?.ok)throw Error(res?.error||'스트리밍 전송 실패');
          data.uploaded=res.result.uploaded;data.failures=res.result.failures;
          return res.result;
        });
      // Avoid an unhandled rejection while polling/receiving OCR results.
      uploadPromise.catch(()=>{});
    }else{
      console.warn('[KWT_STREAM_V3_1] Stream start unavailable; using unchanged legacy batch.',start?.error);
      note('빠른 OCR 서버 미지원: 기존 일괄 방식으로 자동 전환합니다.');
    }
  }
  if(!data){
    const response=await chrome.runtime.sendMessage({type:'SEND_BATCH',pageUrl:location.href,selector,images,padX:ocrOverlay.padding.x,padY:ocrOverlay.padding.y});
    if(!response?.ok)throw Error(response?.error||'전송 실패');
    data=response.result;
  }
  const jobId=data.result.job_id;
  info.textContent=`서버 접수: ${data.uploaded}장 / 실패 ${data.failures.length}장\n작업 ID: ${jobId}\nOCR 상태 확인 중...`;ocrProgress('OCR 처리 중',0,data.uploaded,jobId,data.failures.length);
  // KWT_PAGE_STREAM_V1: reveal pages as soon as OCR/translation updates arrive.
  let finished=false, lastRevision='';
  for(let i=0;i<720;i++){
   await new Promise(resolve=>setTimeout(resolve,1500));
   const status=await chrome.runtime.sendMessage({type:'JOB_STATUS',jobId});
   if(!status?.ok)throw Error(status?.error||'작업 상태 조회 실패');
   const j=status.result;
   const revision=[j.completed,j.translation_completed,j.translation_status,j.stream_revision||0].join(':');
   if(j.results?.length && revision!==lastRevision){
    lastRevision=revision;kwtStreamApply(j);
    const key='kwt-ocr-job:'+location.origin+location.pathname;
    await chrome.storage.local.set({[key]:jobId});
   }
   ocrProgress(j.status==='running'?'OCR 처리 중':j.status==='pending'?'OCR 대기 중':j.status==='completed'?'OCR 완료':j.status==='failed'?'OCR 실패':String(j.status),j.completed,j.total,jobId,data.failures.length);
   info.textContent=`서버 저장 경로: ${j.output_dir||'서버 data 폴더'}\n작업 ID: ${jobId}\nOCR ${j.completed}/${j.total}장 (${Math.round(100*j.completed/Math.max(j.total,1))}%) / ${j.status}\n번역 ${j.translation_completed||0}/${j.total}장 / ${j.translation_status||'수동'}\n전송 실패 ${data.failures.length}장`;
   const ocrDone=['completed','completed_with_errors','failed'].includes(j.status);
   const translationDone=!j.translation_status || ['completed','completed_with_errors','failed'].includes(j.translation_status);
   if(ocrDone && translationDone){
    if(j.results?.length){ocrSetJob(j);const key='kwt-ocr-job:'+location.origin+location.pathname;await chrome.storage.local.set({[key]:jobId});}
    if(uploadPromise)await uploadPromise; // Confirm upload; failed regions remain errors in the existing job.
    finished=true;
    return {ok:j.status!=='failed',jobId,status:j.status};
   }
  }
  if(!finished)throw Error('OCR 상태 확인 제한 시간 초과');
 }catch(e){info.textContent='전송/OCR 실패: '+e.message;return {ok:false,error:String(e.message||e)};}
 finally{kwtProgressTarget=null;state.working=false;ocrFinishProgress();}
}
function match(pattern,url){const esc=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');try{return new RegExp('^'+esc+'$').test(url);}catch{return false;}}
async function auto(){const {rules=[]}=await chrome.storage.local.get({rules:[]});for(const rule of rules){if(!rule.enabled||!rule.autoSend||!match(rule.pattern,location.href))continue;
 let nodes;try{nodes=deepQuery(rule.selector);}catch{continue;}if(!nodes.length)continue;
 const urls=new Map();nodes.forEach(n=>imageList(n).forEach(x=>urls.set(x.url,x)));
 const images=[...urls.values()].map((x,i)=>({...x,index:i}));if(!images.length)continue;
 const key=ROOT+'sent-'+rule.id;
 const signature=location.href+'|'+images.map(x=>x.url).join('|');
 // Prevent automatic retry storms after an OCR error or a successful result with 'failed 0'.
 if(state[key]===signature||state.working)continue;
 state[key]=signature;
 const temp={textContent:''};
 const outcome=await send(rule.selector,images,temp);
 if(outcome?.busy){delete state[key];continue;}
 note('자동 규칙 ['+rule.name+']: '+temp.textContent.slice(0,140));
 }}
let lastUrl=location.href;function routeChanged(){if(location.href===lastUrl)return;lastUrl=location.href;ocrClear();ocrOverlay.results=[];ocrOverlay.jobId=null;ocrFinishProgress();ocrOverlay.updateLabel?.();ocrRestore();scheduleAuto();}
window.addEventListener('popstate',routeChanged);window.addEventListener('hashchange',routeChanged);setInterval(routeChanged,900);
let scheduled=false;function scheduleAuto(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;auto().catch(()=>{});},1200);}
const observed=new WeakSet();
const observer=new MutationObserver(mutations=>{
 const external=mutations.some(m=>{
  const host=m.target instanceof Element?m.target:m.target?.parentElement;
  if(host?.closest?.('[data-kone-ui="1"]'))return false;
  if(m.type==='attributes')return true;
  return [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1&&!n.matches?.('[data-kone-ui="1"]'));
 });
 if(!external)return;
 watchShadows();ocrSchedule();scheduleAuto();
});
function watchShadows(){
 const walk=root=>{
  if(!observed.has(root)){observed.add(root);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset']});}
  root.querySelectorAll?.('*').forEach(el=>{if(el.shadowRoot)walk(el.shadowRoot);});
 };
 walk(document.documentElement);
 // Observe roots created after initialization as well.
 document.querySelectorAll('*').forEach(el=>{if(el.shadowRoot)walk(el.shadowRoot);});
}
watchShadows();
async function manualRun(){
 const {rules=[]}=await chrome.storage.local.get({rules:[]});
 const rule=rules.find(r=>r.enabled&&match(r.pattern,location.href));
 if(!rule)throw Error('현재 페이지에 적용되는 저장 규칙이 없습니다. 요소 선택으로 규칙을 먼저 저장하세요.');
 const nodes=deepQuery(rule.selector);const urls=new Map();nodes.forEach(n=>imageList(n).forEach(x=>urls.set(x.url,x)));
 const images=[...urls.values()].map((x,i)=>({...x,index:i}));if(!images.length)throw Error('수집할 이미지가 없습니다.');
 const info={textContent:''};await send(rule.selector,images,info,{force:true});note(info.textContent.slice(0,200));
}
chrome.runtime.onMessage.addListener((m,_s,respond)=>{
 if(m.type==='KWT_NATIVE_CONTEXT_ACTION'){respond({ok:kwtNativeContextAction(m.action)});return;}
  if(m.type==='START_PICKER'){start();respond({ok:true});}
 if(m.type==='RUN_AUTO'){scheduleAuto();respond({ok:true});}
 if(m.type==='FORCE_OCR'){manualRun().then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;}
});
ocrRestore();
scheduleAuto();
})();