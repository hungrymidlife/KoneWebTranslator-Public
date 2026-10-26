const input=document.getElementById('url');const msg=document.getElementById('msg');
chrome.storage.local.get({serverUrl:'http://127.0.0.1:8765'},v=>input.value=v.serverUrl);
document.getElementById('save').onclick=async()=>{
  const url=input.value.trim().replace(/\/$/,'');
  if(!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)){msg.textContent='localhost 또는 127.0.0.1의 HTTP 주소만 입력하세요.';return;}
  await chrome.storage.local.set({serverUrl:url});msg.textContent='저장되었습니다.';
};
