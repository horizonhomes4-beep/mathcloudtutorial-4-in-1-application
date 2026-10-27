// Shared day-grouped history with search (used by index.html and admin.html)
window.RFHistory=(()=>{
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p2=n=>String(n).padStart(2,'0');
const key=ms=>{const d=new Date(ms);return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());};
const label=k=>new Date(k+'T12:00:00').toLocaleDateString([],{weekday:'long',day:'numeric',month:'long',year:'numeric'});
function match(s,q,day){const k=key(s.completedAt||0);if(day&&k!==day)return false;
 const hay=(label(k)+' '+k+' '+(s.passageTitle||'')+' '+(s.studentName||'')).toLowerCase();
 return String(q||'').toLowerCase().split(/\s+/).filter(Boolean).every(t=>hay.includes(t));}
function render(box,list,row,after,refocus){
 const h=box._h=box._h||{all:false,q:'',day:''};
 if(!list.length){box.innerHTML='<div class="history-row"><p class="muted">No completed sessions yet.</p></div>';return;}
 let html=`<div class="history-bar"><b>${h.all?'Full history by day':'Latest sessions'}</b><button class="btn ghost" id="hT">${h.all?'Show latest 4':'View full history ('+list.length+')'}</button></div>`;
 if(!h.all)html+=`<div class="hist-body">${list.slice(0,4).map(row).join('')}</div>`;
 else{const g={};list.forEach(s=>{if(match(s,h.q,h.day))(g[key(s.completedAt||0)]=g[key(s.completedAt||0)]||[]).push(s);});
  const ks=Object.keys(g).sort().reverse();
  html+=`<div class="history-search"><input id="hQ" placeholder="Search a day, month or passage (e.g. Monday, Oct)" value="${esc(h.q)}"><input type="date" id="hD" value="${h.day}" aria-label="Pick a day"><button class="btn ghost" id="hC">Clear</button></div><p class="tiny muted hist-count">${ks.length} reading day${ks.length===1?'':'s'} found</p>`+
  (ks.map(k=>`<details class="day-group" ${ks.length<=3||h.day?'open':''}><summary><b>${label(k)}</b><span>${g[k].length} session${g[k].length>1?'s':''}</span></summary>${g[k].map(row).join('')}</details>`).join('')||'<div class="history-row"><p class="muted">No reading found for that day. Try another day or clear the search.</p></div>');}
 box.innerHTML=html;
 const re=f=>render(box,list,row,after,f);
 box.querySelector('#hT').onclick=()=>{h.all=!h.all;re();};
 if(h.all){const q=box.querySelector('#hQ');q.oninput=()=>{h.q=q.value;re(true);};box.querySelector('#hD').onchange=e=>{h.day=e.target.value;re();};box.querySelector('#hC').onclick=()=>{h.q='';h.day='';re();};
  if(refocus){q.focus();q.setSelectionRange(q.value.length,q.value.length);}}
 after&&after(box);}
return {render,match,key,label};})();
