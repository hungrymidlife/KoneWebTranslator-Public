const input=document.getElementById('url');const msg=document.getElementById('msg');
chrome.storage.local.get({serverUrl:'http://127.0.0.1:8765'},v=>input.value=v.serverUrl);
document.getElementById('save').onclick=async()=>{
  const url=input.value.trim().replace(/\/$/,'');
  if(!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)){msg.textContent='localhost 또는 127.0.0.1의 HTTP 주소만 입력하세요.';return;}
  await chrome.storage.local.set({serverUrl:url});msg.textContent='저장되었습니다.';
};

// KWT_PRIVATE_EARLY_OCR_STREAM_V3_1 · opt-in, persisted independently of the server URL.
(async()=>{
  const box=document.getElementById('kwt-fast-stream');
  const state=document.getElementById('kwt-fast-stream-state');
  // KWT_VIRTUAL_BUBBLE_SAFE_V4_2: default ON only when no user choice is saved.
  const saved=await chrome.storage.local.get({kwtFastStreamV1:true});
  box.checked=saved.kwtFastStreamV1===true;
  box.addEventListener('change',async()=>{
    box.disabled=true;
    try{await chrome.storage.local.set({kwtFastStreamV1:box.checked});
        state.textContent='이미지별 즉시 OCR '+(box.checked?'ON':'OFF')+' 저장됨';}
    catch(e){state.textContent='저장 실패: '+String(e);box.checked=!box.checked;}
    finally{box.disabled=false;}
  });
})().catch(e=>console.warn('[KWT_STREAM_V3_1]',e));
