/* KWT_STUDIO_EXTENSION_SYNC_V1_3
 * Only syncs allowlisted extension preferences. Browser permissions are read-only.
 * Does not sync per-site manga text edits or large image/job caches.
 */
'use strict';
(() => {
  const API='http://127.0.0.1:18765';
  const KEYS=['rules','serverUrl','kwtLocalUrl','kwtLocalModel',
              'kwtSiteOriginsV3','kwtImageHostOriginsV3','kwtMissingImageHostsV1'];
  const DEFAULTS={rules:[],serverUrl:'http://127.0.0.1:8765',
    kwtLocalUrl:'http://127.0.0.1:18080/v1',kwtLocalModel:'gemma4-12b-local',
    kwtSiteOriginsV3:[],kwtImageHostOriginsV3:[],kwtMissingImageHostsV1:[]};
  const TOKEN='kwtStudioPairTokenV1',REV='kwtStudioSyncRevV1';
  let busy=false, again=false, scheduled=null;

  async function call(path,data,token=''){
    const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),7000);
    try{
      const r=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json',
            ...(token?{'X-KWT-Extension-Key':token}:{})},
          body:JSON.stringify(data),signal:abort.signal});
      const out=await r.json();
      if(!r.ok)throw Error(out.error||`Studio HTTP ${r.status}`);
      return out;
    }finally{clearTimeout(timeout)}
  }
  // KWT_EXTENSION_PRESENCE_V2_0_3: authenticated activity marker from successful OCR requests.
  // The Chrome worker may sleep; no extra Chrome permissions or background polling.
  let lastActivityAttempt=0;
  async function notifyActivity(){
    const now=Date.now();
    if(now-lastActivityAttempt<30000)return;
    lastActivityAttempt=now;
    try{
      const stored=await chrome.storage.local.get({[TOKEN]:''});
      if(!stored[TOKEN])return;
      await call('/api/extension/client/activity',{extension_id:chrome.runtime.id},stored[TOKEN]);
    }catch(err){
      // OCR success is independent of Studio presence tracking.
      console.debug('[KWT Studio] Presence update skipped:',String(err));
    }
  }
  globalThis.kwtStudioActivityV2=()=>{void notifyActivity()};

  async function sendSnapshot(){
    const stored=await chrome.storage.local.get({...DEFAULTS,[TOKEN]:'',[REV]:0});
    if(!stored[TOKEN])return {paired:false};
    const settings=Object.fromEntries(KEYS.map(k=>[k,stored[k]]));
    let granted=[];
    try{granted=(await chrome.permissions.getAll()).origins||[]}catch{}
    const result=await call('/api/extension/client/sync',{
      extension_id:chrome.runtime.id,revision:stored[REV],settings,granted_origins:granted
    },stored[TOKEN]);
    // Set revision first, then apply changes so storage.onChanged can't echo stale values.
    await chrome.storage.local.set({[REV]:result.revision});
    const delta={};
    for(const key of KEYS){
      if(JSON.stringify(stored[key])!==JSON.stringify(result.settings[key]))delta[key]=result.settings[key];
    }
    if(Object.keys(delta).length)await chrome.storage.local.set(delta);
    return {paired:true,revision:result.revision,updated:Object.keys(delta)};
  }
  async function sync(){
    if(busy){again=true;return {busy:true}}
    busy=true;
    try{return await sendSnapshot()}
    finally{
      busy=false;
      if(again){again=false;setTimeout(()=>sync().catch(e=>console.warn('[KWT Studio Sync]',e.message)),500)}
    }
  }
  function schedule(){
    if(scheduled)clearTimeout(scheduled);
    scheduled=setTimeout(()=>{scheduled=null;sync().catch(e=>console.warn('[KWT Studio Sync]',e.message))},850);
  }
  async function pair(code){
    const c=String(code||'').trim();
    if(!/^\d{8}$/.test(c))throw Error('Studio에 표시된 8자리 연결 코드를 입력하세요.');
    const data=await call('/api/extension/client/pair',{extension_id:chrome.runtime.id,code:c});
    await chrome.storage.local.set({[TOKEN]:data.token,[REV]:0});
    return await sync();
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(!['KWT_STUDIO_PAIR','KWT_STUDIO_SYNC_NOW','KWT_STUDIO_LINK_STATUS','KWT_STUDIO_UNLINK'].includes(message?.type))return false;
    (async()=>{
      if(message.type==='KWT_STUDIO_PAIR')return await pair(message.code);
      if(message.type==='KWT_STUDIO_SYNC_NOW')return await sync();
      if(message.type==='KWT_STUDIO_UNLINK'){
        await chrome.storage.local.remove([TOKEN,REV]);return {paired:false};
      }
      const state=await chrome.storage.local.get({[TOKEN]:'',[REV]:0});
      return {paired:!!state[TOKEN],revision:state[REV]};
    })().then(data=>reply({ok:true,result:data})).catch(e=>reply({ok:false,error:String(e.message||e)}));
    return true;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&KEYS.some(k=>Object.prototype.hasOwnProperty.call(changes,k)))schedule();
  });
  chrome.permissions.onAdded.addListener(schedule);
  chrome.permissions.onRemoved.addListener(schedule);
  chrome.alarms.onAlarm.addListener(a=>{if(a.name==='kwt-studio-sync')schedule()});
  chrome.alarms.create('kwt-studio-sync',{periodInMinutes:1}).catch(()=>{});
  chrome.runtime.onStartup.addListener(schedule);
  chrome.runtime.onInstalled.addListener(schedule);
  schedule();
})();
