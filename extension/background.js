const DEFAULT_URL='http://127.0.0.1:8765';
async function requestServer(path,options={}) {
  const {serverUrl}=await chrome.storage.local.get({serverUrl:DEFAULT_URL});
  const base=serverUrl.replace(/\/$/,'');
  if(!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))throw Error('로컬 주소만 허용됩니다.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),300000);
  try {const r=await fetch(base+path,{...options,signal:controller.signal});if(!r.ok){let detail='';try{const e=await r.json();detail=e.detail||'';}catch{}throw Error('서버 HTTP '+r.status+(detail?' / '+detail:''));}const payload=await r.json();
    // KWT_EXTENSION_PRESENCE_V2_0_3: translation is independent from this best-effort activity signal.
    if(typeof globalThis.kwtStudioActivityV2==='function')globalThis.kwtStudioActivityV2();
    return payload;}
  finally{clearTimeout(timer);}
}
async function notifyProgress(tabId, frameId, payload) {
  if(tabId == null)return;
  try { await chrome.tabs.sendMessage(tabId,{type:'KWT_PROGRESS',...payload},{frameId:frameId ?? 0}); }catch(_){}
}

// KWT_HOST_PERMISSIONS_V1: record missing CDN origins for user review in Options.
async function kwtRecordMissingImageHost(origin){
  const key='kwtMissingImageHostsV1';
  const current=await chrome.storage.local.get({[key]:[]});
  const list=Array.isArray(current[key])?current[key]:[];
  await chrome.storage.local.set({[key]:[origin,...list.filter(v=>v!==origin)].slice(0,60)});
}
async function fetchImage(url) {
  if(!/^https?:\/\//i.test(url))throw Error('HTTP(S) 이미지 URL만 지원');
  const u=new URL(url);
  if(['localhost','127.0.0.1','0.0.0.0','::1'].includes(u.hostname)||u.hostname.endsWith('.local'))throw Error('내부 주소 이미지 차단');
  const allowed=await chrome.permissions.contains({origins:[u.origin+'/*']});
  if(!allowed){
    try{await kwtRecordMissingImageHost(u.origin);}catch(e){console.warn('[KWT] Failed to record missing host',e);}
    throw Error('이미지 호스트 권한 없음: '+u.origin+' (확장 프로그램 > 설정 > 이미지 호스트 접근 권한에서 허용)');
  }
  const r=await fetch(url,{credentials:'include',redirect:'follow'});
  if(!r.ok)throw Error('이미지 HTTP '+r.status);
  const blob=await r.blob();if(!blob.type.startsWith('image/'))throw Error('이미지 형식 아님');
  if(blob.size>18*1024*1024)throw Error('18MB 초과 이미지');
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {image_base64:btoa(binary),mime_type:blob.type};
}
// KWT_PRIVATE_EARLY_OCR_STREAM_V3_1: opt-in, ordered, 3-way download prefetch.
// Send raw binary to localhost. Legacy SEND_BATCH is never modified.
async function kwtStreamBlob(url) {
  if(!/^https?:\/\//i.test(url))throw Error('HTTP(S) 이미지 URL만 지원');
  const u=new URL(url);
  if(['localhost','127.0.0.1','0.0.0.0','::1'].includes(u.hostname)||u.hostname.endsWith('.local'))throw Error('내부 주소 이미지 차단');
  if(!await chrome.permissions.contains({origins:[u.origin+'/*']})){
    await kwtRecordMissingImageHost(u.origin);
    throw Error('이미지 호스트 권한 없음: '+u.origin);
  }
  const r=await fetch(url,{credentials:'include',redirect:'follow'});
  if(!r.ok)throw Error('이미지 HTTP '+r.status);
  const blob=await r.blob();
  if(!blob.type.startsWith('image/'))throw Error('이미지 형식 아님');
  if(blob.size>18*1024*1024)throw Error('18MB 초과 이미지');
  return blob;
}
async function kwtStreamUpload(msg,tabId,frameId){
  const images=msg.images.slice(0,100),failures=[];let uploaded=0;
  const abort=()=>requestServer('/api/v1/images/stream/abort',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:msg.jobId})}).catch(()=>{});
  try{
    // Sliding 3-way prefetch: submit #1 immediately when ready, do not wait
    // for #3. Uploads remain strictly in original page order.
    const pending=new Map();
    const prefetch=pos=>{
      if(pos>=images.length||pending.has(pos))return;
      const item=images[pos];
      pending.set(pos,(async()=>{
        try{return {item,blob:await kwtStreamBlob(item.url)};}
        catch(e){return {item,error:String(e.message||e)};}
      })());
    };
    for(let pos=0;pos<images.length;pos++){
      prefetch(pos);prefetch(pos+1);prefetch(pos+2);
      const row=await pending.get(pos);
      pending.delete(pos);
        const item=row.item;
        if(row.error){
          failures.push({index:item.index,url:item.url,error:row.error});
          await requestServer('/api/v1/images/stream/fail',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({job_id:msg.jobId,index:item.index,error:row.error})});
        }else{
          try{
            await requestServer('/api/v1/images/stream/item?job_id='+encodeURIComponent(msg.jobId)+'&index='+item.index,{
              method:'POST',headers:{'Content-Type':row.blob.type||'application/octet-stream'},body:row.blob});
            uploaded++;
          }catch(e){
            const error=String(e.message||e);
            failures.push({index:item.index,url:item.url,error});
            // The server might have accepted an upload whose response was lost;
            // on conflict abort rather than double-advance and corrupt ordering.
            await requestServer('/api/v1/images/stream/fail',{
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({job_id:msg.jobId,index:item.index,error})});
          }
        }
        await notifyProgress(tabId,frameId,{stage:'upload',done:uploaded+failures.length,
          total:images.length,failed:failures.length,jobId:msg.jobId});
    }
    return {uploaded,failures};
  }catch(e){
    await abort();
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
 // KWT_STUDIO_EXTENSION_SYNC_V1_3 - handled by studio_sync_v1.js instead
 if(['KWT_STUDIO_PAIR','KWT_STUDIO_SYNC_NOW','KWT_STUDIO_LINK_STATUS','KWT_STUDIO_UNLINK'].includes(msg?.type))return false;
 (async()=>{
   if(msg.type==='KWT_SITE_ENABLE'){
     const origin=kwtSiteOrigin(msg.origin);
     const stored=await chrome.storage.local.get({kwtSiteOriginsV3:[]});
     if(!(stored.kwtSiteOriginsV3||[]).includes(origin))throw Error('Site not present in approved site list');
     await kwtRegisterSite(origin);
     return {site:origin,registered:true};
   }
   if(msg.type==='KWT_SITE_DISABLE'){
     const origin=kwtSiteOrigin(msg.origin);
     await kwtUnregisterSite(origin);
     return {site:origin,registered:false};
   }
   if(msg.type==='OPEN_TRANSLATION_SETTINGS'){await chrome.tabs.create({url:chrome.runtime.getURL('translation_settings.html')});return {opened:true};}
   if(msg.type==='TEST_LOCAL_TRANSLATOR'){
     return await requestServer('/api/v1/translate/local/check',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({model:msg.model,local_url:msg.localUrl})
     });
   }
   if(msg.type==='TRANSLATE_JOB'){
     const config=await chrome.storage.local.get({
       kwtLocalUrl:'http://127.0.0.1:18080/v1',
       kwtLocalModel:'gemma4-12b-local'
     });
     const request={
       job_id:msg.jobId,force:!!msg.force,
       model:config.kwtLocalModel,local_url:config.kwtLocalUrl
     };
     return await requestServer('/api/v1/translate/job',{
       method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)
     });
   }
   if(msg.type==='JOB_STATUS')return await requestServer('/api/v1/jobs/'+encodeURIComponent(msg.jobId));
   if(msg.type==='HEALTH')return await requestServer('/health');
   if(msg.type==='CACHE_LOOKUP')return await requestServer('/api/v1/cache/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_url:msg.pageUrl,image_urls:msg.images.map(i=>i.url),pad_x_percent:msg.padX,pad_y_percent:msg.padY})});
   // KWT_PRIVATE_EARLY_OCR_STREAM_V3_1 · create one job for the complete chapter before uploading.
   if(msg.type==='STREAM_START')return await requestServer('/api/v1/images/stream/start',{
     method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
       source_url:msg.pageUrl,selector:msg.selector,image_urls:msg.images.map(x=>x.url),
       pad_x_percent:msg.padX,pad_y_percent:msg.padY})});
   if(msg.type==='STREAM_UPLOAD')return await kwtStreamUpload(msg,sender.tab?.id,sender.frameId);
   if(msg.type==='SEND_BATCH'){
     const images=[];const failures=[];const tabId=sender.tab?.id;const frameId=sender.frameId;const total=Math.min(msg.images.length,100);
     await notifyProgress(tabId,frameId,{stage:'download',done:0,total});
     for(const item of msg.images.slice(0,100)){
       try{images.push({index:item.index,url:item.url,alt:item.alt||'',...await fetchImage(item.url)});}
       catch(e){failures.push({index:item.index,url:item.url,error:String(e.message||e)});}
       await notifyProgress(tabId,frameId,{stage:'download',done:images.length+failures.length,total,failed:failures.length});
     }
     if(!images.length)throw Error('전송 가능한 이미지가 없습니다. '+(failures[0]?.error||''));
     await notifyProgress(tabId,frameId,{stage:'upload',done:0,total:images.length});
     const result=await requestServer('/api/v1/images/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_url:msg.pageUrl,selector:msg.selector,images,pad_x_percent:msg.padX,pad_y_percent:msg.padY})});
     await notifyProgress(tabId,frameId,{stage:'upload',done:images.length,total:images.length,jobId:result.job_id});
     return {result,uploaded:images.length,failures};
   }
   throw Error('알 수 없는 요청');
 })().then(result=>sendResponse({ok:true,result})).catch(e=>sendResponse({ok:false,error:String(e.message||e)}));return true;
});

// KWT_NATIVE_CONTEXT_MENU_V3 - Chrome native page context menu.
// Do not replace the browser's context menu; attach a submenu to it.
const KWT_MENU_ROOT = 'kwt-native-root';
const KWT_MENU_ACTIONS = [
  ['kwt-open-popup','확장 프로그램 창 열기'],
  ['kwt-ui-show','KWT 화면 UI 모두 표시'],
  ['kwt-ui-hide','KWT 화면 UI 모두 숨기기 (번역문 유지)'],
  ['kwt-ui-toggle','KWT 화면 UI 표시/숨김'],
  ['kwt-ocr-toggle','OCR 검출 박스 표시/숨김'],
  ['kwt-text-toggle','번역문 레이어 표시/숨김'],
  ['kwt-edit-toggle','번역문 드래그 편집 켜기/끄기'],
  ['kwt-translate','한국어 번역 실행'],
  ['kwt-force-ocr','OCR 강제 실행'],
  ['kwt-rules','저장 규칙 관리'],
  ['kwt-settings','서버 설정']
];
function kwtRegisterContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if(chrome.runtime.lastError)console.warn('[KWT] menu cleanup:',chrome.runtime.lastError.message);
    chrome.contextMenus.create({id:KWT_MENU_ROOT,title:'KoneWebTranslator',contexts:['all']});
    for(const [id,title] of KWT_MENU_ACTIONS){
      chrome.contextMenus.create({id,title,parentId:KWT_MENU_ROOT,contexts:['all']});
    }
  });
}
chrome.runtime.onInstalled.addListener(kwtRegisterContextMenus);
// Context menu items persist across service-worker restarts; onInstalled handles extension reload/update.
chrome.contextMenus.onClicked.addListener((info,tab) => {
  const id=String(info.menuItemId||'');
  if(!id.startsWith('kwt-')||id===KWT_MENU_ROOT)return;
  (async()=>{
    if(id==='kwt-open-popup'){
      try { await chrome.action.openPopup({windowId:tab?.windowId}); }
      catch(e) { await chrome.tabs.create({url:chrome.runtime.getURL('popup.html')}); }
      return;
    }
    if(id==='kwt-rules'){await chrome.tabs.create({url:chrome.runtime.getURL('rules.html')});return;}
    if(id==='kwt-settings'){await chrome.runtime.openOptionsPage();return;}
    if(tab?.id==null)return;
    const actions={
      'kwt-ui-show':'ui-show','kwt-ui-hide':'ui-hide','kwt-ui-toggle':'ui-toggle',
      'kwt-ocr-toggle':'ocr-toggle','kwt-text-toggle':'text-toggle',
      'kwt-edit-toggle':'edit-toggle','kwt-translate':'translate',
      'kwt-force-ocr':'force-ocr'
    };
    const action=actions[id];if(!action)return;
    const response=await chrome.tabs.sendMessage(tab.id,{type:'KWT_NATIVE_CONTEXT_ACTION',action},{frameId:info.frameId??0});
    if(!response?.ok)console.warn('[KWT] context action failed:',response?.error);
  })().catch(e=>console.warn('[KWT] context menu action:',e));
});

/* KWT_SITE_PERMISSION_V3: persistent, site-specific content script registration. */
const KWT_SITE_KEY='kwtSiteOriginsV3';
const KWT_SCRIPT_PREFIX='kwt-site-v3-';
function kwtSiteOrigin(input){
 const u=new URL(input);if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw Error('Invalid site origin');
 return u.origin;
}
function kwtSiteId(origin){return KWT_SCRIPT_PREFIX+Array.from(new TextEncoder().encode(origin)).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function kwtRegisterSite(origin){
 origin=kwtSiteOrigin(origin);
 if(!await chrome.permissions.contains({origins:[origin+'/*']}))throw Error('Site permission not granted: '+origin);
 const id=kwtSiteId(origin),registered=await chrome.scripting.getRegisteredContentScripts({ids:[id]});
 if(registered.length)return;
 await chrome.scripting.registerContentScripts([{id,matches:[origin+'/*'],js:['content.js'],runAt:'document_idle',allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:true}]);
}
async function kwtUnregisterSite(origin){
 const id=kwtSiteId(kwtSiteOrigin(origin));const registered=await chrome.scripting.getRegisteredContentScripts({ids:[id]});
 if(registered.length)await chrome.scripting.unregisterContentScripts({ids:[id]});
}
async function kwtSyncSites(){
 const saved=await chrome.storage.local.get({[KWT_SITE_KEY]:[]});
 const sites=[...new Set((saved[KWT_SITE_KEY]||[]).map(v=>{try{return kwtSiteOrigin(v);}catch{return null;}}).filter(Boolean))];
 const expected=new Set();
 for(const origin of sites){if(await chrome.permissions.contains({origins:[origin+'/*']})){expected.add(kwtSiteId(origin));}}
 const all=await chrome.scripting.getRegisteredContentScripts();
 const stale=all.filter(x=>x.id.startsWith(KWT_SCRIPT_PREFIX)&&!expected.has(x.id)).map(x=>x.id);
 if(stale.length)await chrome.scripting.unregisterContentScripts({ids:stale});
 for(const origin of sites){if(expected.has(kwtSiteId(origin)))await kwtRegisterSite(origin);}
}
chrome.runtime.onStartup.addListener(()=>kwtSyncSites().catch(e=>console.warn('[KWT] site sync',e)));
chrome.permissions.onRemoved.addListener(()=>kwtSyncSites().catch(e=>console.warn('[KWT] site revoke sync',e)));
chrome.runtime.onInstalled.addListener(()=>kwtSyncSites().catch(e=>console.warn('[KWT] site install sync',e)));

// KWT_STUDIO_EXTENSION_SYNC_V1_3
importScripts('studio_sync_v1.js');
