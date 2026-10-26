/* KWT_HOST_SITE_PERMISSIONS_V3: user-managed site injection and independent CDN grants. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const siteInput=$('kwt-site-input'),cdnInput=$('kwt-host-input');
const siteList=$('kwt-site-list'),cdnList=$('kwt-host-granted'),pendingList=$('kwt-host-pending'),legacyList=$('kwt-host-legacy');
const message=$('kwt-host-msg');
const SITE_KEY='kwtSiteOriginsV3', CDN_KEY='kwtImageHostOriginsV3', PENDING_KEY='kwtMissingImageHostsV1';
function originOf(value){
 const raw=String(value||'').trim();if(!raw)throw Error('호스트 주소를 입력하세요.');
 if(raw.includes('*'))throw Error('와일드카드 대신 정확한 호스트를 입력하세요.');
 const u=new URL(raw.includes('://')?raw:'https://'+raw);
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('HTTP(S) 호스트만 허용합니다.');
 if(/^(localhost|0\.0\.0\.0|127(?:\.\d+){3}|\[?::1\]?)$/i.test(u.hostname)||u.hostname.endsWith('.local'))throw Error('로컬 주소는 기본 서버 권한으로 관리됩니다.');
 return u.origin;
}
function normStored(xs){return [...new Set((Array.isArray(xs)?xs:[]).map(s=>{try{return originOf(s);}catch{return null;}}).filter(Boolean))].sort();}
function setMsg(value,error=false){message.textContent=value;message.style.color=error?'#b91c1c':'#047857';}
function row(title,sub,buttons){
 const d=document.createElement('div');d.style.cssText='display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;border:1px solid #cbd5e1;border-radius:6px;padding:10px;background:#fff';
 const t=document.createElement('div');t.style.cssText='flex:1;min-width:180px';
 const name=document.createElement('code');name.textContent=title;name.style.cssText='display:block;overflow-wrap:anywhere;font-size:12px';t.appendChild(name);
 if(sub){const hint=document.createElement('small');hint.textContent=sub;hint.style.cssText='display:block;color:#64748b;margin-top:4px';t.appendChild(hint);}d.appendChild(t);
 const actions=document.createElement('div');actions.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
 for(const [label,fn,disabled] of buttons){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=!!disabled;b.style.cssText='padding:6px 10px;white-space:nowrap;cursor:pointer';if(fn)b.addEventListener('click',fn);actions.appendChild(b);}d.appendChild(actions);return d;
}
const note=(parent,msg)=>{const s=document.createElement('p');s.textContent=msg;s.style.cssText='color:#64748b;font-size:13px';parent.appendChild(s);};
async function stores(){const d=await chrome.storage.local.get({[SITE_KEY]:[],[CDN_KEY]:[],[PENDING_KEY]:[],rules:[]});return {sites:normStored(d[SITE_KEY]),cdns:normStored(d[CDN_KEY]),pending:normStored(d[PENDING_KEY]),rules:d.rules||[]};}
async function granted(origin){return chrome.permissions.contains({origins:[origin+'/*']});}
async function requestHost(origin,kind){
 try{
  // Called from a direct button click. No await before the permission request.
  const ok=await chrome.permissions.request({origins:[origin+'/*']});
  if(!ok){setMsg('권한 요청이 취소되었습니다: '+origin,true);return;}
  const d=await stores(),key=kind==='site'?SITE_KEY:CDN_KEY;
  await chrome.storage.local.set({[key]:[...new Set([...(kind==='site'?d.sites:d.cdns),origin])],
   [PENDING_KEY]:d.pending.filter(x=>x!==origin)});
  if(kind==='site'){
   const r=await chrome.runtime.sendMessage({type:'KWT_SITE_ENABLE',origin});
   if(!r?.ok)throw Error(r?.error||'사이트 스크립트 등록 실패');
  }
  setMsg((kind==='site'?'사이트 실행 허용: ':'이미지 호스트 허용: ')+origin+'\n열려 있는 페이지는 새로고침하면 적용됩니다.');
  await refresh();
 }catch(e){setMsg('권한 요청 실패: '+(e.message||e),true);await refresh();}
}
async function removeManaged(origin,kind){
 try{
  const d=await stores();const site=d.sites.includes(origin),cdn=d.cdns.includes(origin);
  if(kind==='site'){
   const response=await chrome.runtime.sendMessage({type:'KWT_SITE_DISABLE',origin});
   if(!response?.ok)throw Error(response?.error||'사이트 주입 해제 실패');
  }
  // One host can be needed for both site injection and CDN fetching.
  let revokeBlocked=false;
  if(!((kind==='site'&&cdn)||(kind==='cdn'&&site))){
   const removed=await chrome.permissions.remove({origins:[origin+'/*']});
   revokeBlocked=!removed && await granted(origin);
  }
  const key=kind==='site'?SITE_KEY:CDN_KEY;
  await chrome.storage.local.set({[key]:(kind==='site'?d.sites:d.cdns).filter(x=>x!==origin)});
  setMsg(revokeBlocked
   ? '관리 목록에서는 삭제했지만 Chrome 전체 사이트 권한 등이 남아 실제 접근 권한은 유지됩니다: '+origin+'\n하단의 이전 권한 목록에서 넓은 권한을 해제하세요.'
   : '권한/관리 목록에서 삭제했습니다: '+origin+'\n기존에 열려 있는 탭은 새로고침해 주세요.',revokeBlocked);
  await refresh();
 }catch(e){setMsg('권한 해제 실패: '+(e.message||e),true);await refresh();}
}
async function removeLegacy(pattern){
 try{
  if(!confirm('이 권한을 Chrome에서 해제할까요?\n'+pattern))return;
  const ok=await chrome.permissions.remove({origins:[pattern]});
  if(!ok)throw Error('Chrome이 권한 해제를 거부했습니다. 필수 권한인지 확인하세요.');
  setMsg('기존 권한 해제 완료: '+pattern);await refresh();
 }catch(e){setMsg('해제 실패: '+(e.message||e),true);await refresh();}
}
async function refresh(){
 const d=await stores(),perm=await chrome.permissions.getAll(),manifest=chrome.runtime.getManifest();
 const fixed=new Set(manifest.host_permissions||[]);
 siteList.replaceChildren();cdnList.replaceChildren();pendingList.replaceChildren();legacyList.replaceChildren();
 const rules=new Set();
 for(const rule of d.rules){try{if(rule.pattern){const raw=String(rule.pattern).replace(/\*/g,'x');rules.add(originOf(raw));}}catch{}}
 const candidates=[...new Set([...d.sites,...rules])].sort();
 if(!candidates.length)note(siteList,'저장된 사이트 규칙이 없습니다. 위에 사이트 주소를 직접 입력할 수도 있습니다.');
 for(const origin of candidates){
  const isManaged=d.sites.includes(origin),isGranted=await granted(origin);
  siteList.appendChild(row(origin,isManaged?(isGranted?'자동 실행 등록됨':'권한 재승인 필요'):'기존 수집 규칙에서 발견됨 (승인 필요)',
   isManaged?[[isGranted?'실행 권한 삭제':'목록 삭제',()=>removeManaged(origin,'site')]]
    :[['사이트 실행 허용',()=>requestHost(origin,'site')]]));
 }
 for(const origin of d.pending){if(!await granted(origin))pendingList.appendChild(row(origin,'이미지 다운로드 실패로 감지됨', [['CDN 허용',()=>requestHost(origin,'cdn')],['목록에서 지우기',async()=>{await chrome.storage.local.set({[PENDING_KEY]:d.pending.filter(x=>x!==origin)});await refresh();}]]));}
 if(!pendingList.children.length)note(pendingList,'현재 승인 대기 중인 이미지 호스트가 없습니다.');
 for(const origin of d.cdns){cdnList.appendChild(row(origin,await granted(origin)?'승인된 CDN':'Chrome 권한 없음', [['CDN 권한 삭제',()=>removeManaged(origin,'cdn')]]));}
 if(!d.cdns.length)note(cdnList,'아직 관리 중인 CDN 호스트가 없습니다.');
 const already=new Set([...d.sites,...d.cdns].map(x=>x+'/*'));
 const legacy=(perm.origins||[]).filter(x=>!fixed.has(x)&&!already.has(x)).sort();
 for(const pattern of legacy){legacyList.appendChild(row(pattern,'이전 버전 또는 다른 경로에서 부여된 권한', [['Chrome 권한 해제',()=>removeLegacy(pattern)]]));}
 if(!legacy.length)note(legacyList,'추가로 정리할 기존 권한이 없습니다.');
}
$('kwt-site-add').addEventListener('click',()=>{try{requestHost(originOf(siteInput.value),'site');}catch(e){setMsg(String(e.message||e),true);}});
$('kwt-host-add').addEventListener('click',()=>{try{requestHost(originOf(cdnInput.value),'cdn');}catch(e){setMsg(String(e.message||e),true);}});
$('kwt-host-refresh').addEventListener('click',()=>refresh().catch(e=>setMsg(String(e),true)));
refresh().catch(e=>setMsg('권한 목록 읽기 실패: '+e,true));
})();
