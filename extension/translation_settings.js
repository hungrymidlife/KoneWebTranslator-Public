'use strict';
const $=id=>document.getElementById(id);
const defaults={kwtLocalUrl:'http://127.0.0.1:18080/v1',kwtLocalModel:'gemma4-12b-local'};
const status=(text,error=false)=>{$('status').textContent=text;$('status').style.color=error?'#fca5a5':'#86efac';};
(async()=>{
 try{
  const c=await chrome.storage.local.get(defaults);
  $('localUrl').value=c.kwtLocalUrl;
  $('localModel').value=c.kwtLocalModel;
  // Remove legacy paid API credentials from Chrome local storage.
  await chrome.storage.local.remove(['kwtTranslationProvider','kwtOpenaiApiKey','kwtOpenaiModel']);
 }catch(e){status(String(e),true);}
})();
function dataFromForm(){return {kwtLocalUrl:$('localUrl').value.trim(),kwtLocalModel:$('localModel').value.trim()};}
function checkConfig(c){
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+(?:\/v1)?\/?$/.test(c.kwtLocalUrl))throw Error('로컬 주소는 http://127.0.0.1:18080/v1 형식만 사용할 수 있어.');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(c.kwtLocalModel))throw Error('모델 ID를 확인해 줘.');
}
$('save').onclick=async()=>{
 try{const c=dataFromForm();checkConfig(c);await chrome.storage.local.set(c);status('로컬 Gemma 번역 설정 저장 완료.');}
 catch(e){status(String(e.message||e),true);}
};
$('test').onclick=async()=>{
 const btn=$('test');btn.disabled=true;
 try{
  const c=dataFromForm();checkConfig(c);
  status('연결 및 실제 번역 확인 중...');
  const reply=await chrome.runtime.sendMessage({type:'TEST_LOCAL_TRANSLATOR',model:c.kwtLocalModel,localUrl:c.kwtLocalUrl});
  if(!reply?.ok)throw Error(reply?.error||'테스트 실패');
  status('연결 성공: '+reply.result.model+'\n테스트 일본어: こんにちは！\n번역 결과: '+reply.result.translation+'\n[설정 저장]을 눌러 적용해 줘.');
 }catch(e){status('연결 실패: '+String(e.message||e),true);}
 finally{btn.disabled=false;}
};
