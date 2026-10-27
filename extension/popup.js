const status=document.getElementById('status'),msg=document.getElementById('message');
chrome.runtime.sendMessage({type:'HEALTH'},r=>{status.textContent=r?.ok?'로컬 서버 연결됨':'로컬 서버 미연결 (규칙 설정 가능)';status.classList.add(r?.ok?'connected':'offline')});
document.getElementById('settings').onclick=()=>chrome.runtime.openOptionsPage();
document.getElementById('rules').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('rules.html')});
document.getElementById('pick').onclick=async()=>{
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('활성 탭 없음');
  const origins=[new URL(tab.url).origin+'/*'];
  const granted=await chrome.permissions.request({origins});
  if(!granted)throw Error('해당 사이트 실행 권한이 필요합니다.');
  const siteOrigin=new URL(tab.url).origin;
  const record=await chrome.storage.local.get({kwtSiteOriginsV3:[]});
  await chrome.storage.local.set({kwtSiteOriginsV3:[...new Set([...(record.kwtSiteOriginsV3||[]),siteOrigin])]});
  const registration=await chrome.runtime.sendMessage({type:'KWT_SITE_ENABLE',origin:siteOrigin});
  if(!registration?.ok)throw Error('사이트 주입 등록 실패: '+(registration?.error||''));
  // Dynamic registration applies to future navigation; inject into the currently open tab too.
  try{await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']});}
  catch(_){await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});}

  const frames=await chrome.webNavigation.getAllFrames({tabId:tab.id}).catch(()=>[]);
  let success=false;
  for(const frame of [{frameId:0},...frames.filter(f=>f.frameId!==0)]){
   try{const r=await chrome.tabs.sendMessage(tab.id,{type:'START_PICKER'},{frameId:frame.frameId});if(r?.ok)success=true;}catch{}
  }
  if(!success)throw Error('요소 선택 스크립트가 실행 가능한 페이지가 아닙니다.');
  window.close();
 }catch(e){msg.textContent='요소 선택 시작 실패: '+e.message+' (일반 HTTP(S) 페이지에서 실행하세요.)';}
};
document.getElementById('force').onclick=async()=>{
 try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('활성 탭 없음');
 const r=await chrome.tabs.sendMessage(tab.id,{type:'FORCE_OCR'});if(!r?.ok)throw Error(r?.error||'실행 실패');msg.textContent='OCR 강제 실행 완료';
 }catch(e){msg.textContent='강제 실행 실패: '+e.message;}
};
