const rows=document.getElementById('rows'),status=document.getElementById('status');let rules=[];
async function save(){await chrome.storage.local.set({rules});status.textContent='저장됨';render();}
function field(value,change){const i=document.createElement('input');i.value=value;i.onchange=()=>change(i.value);return i;}
function check(value,change){const i=document.createElement('input');i.type='checkbox';i.style.width='auto';i.checked=value;i.onchange=()=>change(i.checked);return i;}
function render(){rows.replaceChildren();rules.forEach((r,index)=>{const tr=document.createElement('tr');const cell=()=>{const td=document.createElement('td');tr.appendChild(td);return td;};
 cell().append(field(r.name,v=>{r.name=v;save()}));const patternCell=cell();patternCell.append(field(r.pattern,v=>{r.pattern=v.trim();save()}));const hint=document.createElement('small');hint.textContent='* 는 임의의 경로와 일치';hint.style.color='#64748b';patternCell.append(hint);cell().append(field(r.selector,v=>{r.selector=v;save()}));
 const flags=cell();flags.append('활성 ');flags.append(check(r.enabled,v=>{r.enabled=v;save()}));flags.append(' 자동 ');flags.append(check(r.autoSend,v=>{r.autoSend=v;save()}));
 const actions=cell();const del=document.createElement('button');del.textContent='삭제';del.onclick=()=>{if(confirm('규칙을 삭제할까요?')){rules.splice(index,1);save();}};actions.append(del);rows.appendChild(tr);});}
chrome.storage.local.get({rules:[]},v=>{rules=v.rules;render();});