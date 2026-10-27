/* MathCloud Reading Fluency: activation countdown, device-lock + unlock request flow, avatar greeting. Load BEFORE app.js */
(()=>{'use strict';
const $=id=>document.getElementById(id),DAY=864e5,p2=n=>String(n).padStart(2,'0');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P=p=>firebase.database().ref('readingFluency/'+p);
let tick=null,off=0,greeted=false,w=[],armed=null;
const now=()=>Date.now()+off;
function modal(html){let m=$('rfModal');if(!m){m=document.createElement('div');m.id='rfModal';m.className='rf-modal';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');document.body.appendChild(m);}m.innerHTML='<div class="rf-card">'+html+'</div>';m.classList.remove('hidden');document.body.classList.add('gate-open');return m;}
function closeModal(){const m=$('rfModal');if(m)m.classList.add('hidden');document.body.classList.remove('gate-open');}
function unwatch(){w.forEach(([r,f])=>r.off('value',f));w=[];}
function watch(ref,fn){ref.on('value',fn);w.push([ref,fn]);}
function say(t){try{window.RF&&RF.speak(t,{src:'notice'});}catch(e){}}
const device=()=>{const u=navigator.userAgent;const b=/Edg/.test(u)?'Edge':/Chrome/.test(u)?'Chrome':/Safari/.test(u)?'Safari':/Firefox/.test(u)?'Firefox':'Browser';const o=/Android/.test(u)?'Android':/iPhone|iPad/.test(u)?'iOS':/Windows/.test(u)?'Windows':/Mac/.test(u)?'macOS':'device';return b+' on '+o;};

/* ---- Device lock: notify, request unlock, auto-continue when the administrator approves ---- */
function deviceLocked(user,p,retry){
 unwatch();
 modal(`<div class="rf-ico">🔒</div><h2>This account is locked to another device</h2><p>Hi ${esc((p.name||'').split(' ')[0]||'there')}, for your safety each account works on one device at a time. Ask your administrator to unlock it and you will be let in automatically.</p><p id="rfLockMsg" class="rf-msg" role="status"></p><button id="rfReq" class="btn primary full" type="button">Request unlock from administrator</button><button id="rfOut" class="linklike" type="button">Sign out</button>`);
 const msg=$('rfLockMsg'),btn=$('rfReq');
 const sent=()=>{btn.disabled=true;btn.textContent='Request sent ✓';msg.className='rf-msg good';msg.textContent='Your administrator has been notified. Keep this page open; it continues automatically once approved.';};
 say('This account is locked to another device. You can ask your administrator to unlock it.');
 btn.onclick=async()=>{btn.disabled=true;msg.className='rf-msg wait';msg.textContent='Sending request…';
  try{await P('unlockRequests/'+user.uid).set({uid:user.uid,name:p.name||'',email:p.email||user.email||'',className:p.className||'',device:device(),requestedAt:firebase.database.ServerValue.TIMESTAMP,status:'pending'});sent();}
  catch(e){console.error(e);btn.disabled=false;msg.className='rf-msg bad';msg.textContent='Could not send the request. Check your connection and try again.';}};
 $('rfOut').onclick=()=>{unwatch();firebase.auth().signOut().finally(closeModal);};
 watch(P('deviceLocks/'+user.uid),s=>{const l=s.val();if(!l||l.unlocked===true){unwatch();closeModal();retry();}});
 watch(P('unlockRequests/'+user.uid),s=>{const v=s.val();if(!v)return;if(v.status==='pending')sent();else if(v.status==='denied'){btn.disabled=false;btn.textContent='Request again';msg.className='rf-msg bad';msg.textContent='The administrator did not approve this request. Contact your school.';}});
}

/* ---- One-year activation ---- */
function expired(p,out){stopTick();modal(`<div class="rf-ico">⏳</div><h2>Your annual activation has ended</h2><p>Renew your subscription to continue practising with Coach Reed. Your past results are safe.</p><a class="btn primary full" href="subscribe.html">Renew subscription</a><button id="rfExOut" class="linklike" type="button">${out?'Close':'Sign out'}</button>`);
 say('Your annual activation has ended. Please renew your subscription to continue.');
 $('rfExOut').onclick=()=>{closeModal();if(!out){const b=$('logoutBtn');b&&b.click();}};}
function stopTick(){if(tick){clearInterval(tick);tick=null;}}
function badge(){let el=$('rfAct');if(el)return el;const head=document.querySelector('#dashboardView .mq-head');if(!head)return null;el=document.createElement('div');el.id='rfAct';el.className='rf-act';head.insertBefore(el,$('logoutBtn'));return el;}
function countdown(s){const el=badge();if(!el)return;stopTick();
 if(s.demo){el.className='rf-act demo';el.innerHTML='<small>Free demo</small><b>Progress is not saved</b>';return;}
 const paint=()=>{if(!s.expiresAt){el.className='rf-act';el.innerHTML='<small>Activation</small><b>No expiry date set</b>';return;}
  const left=s.expiresAt-now();if(left<=0){expired(s,false);return;}
  const d=Math.floor(left/DAY),h=Math.floor(left%DAY/36e5),m=Math.floor(left%36e5/6e4),sec=Math.floor(left%6e4/1e3);
  el.className='rf-act '+(left<14*DAY?'bad':left<60*DAY?'warn':'ok');
  el.innerHTML=`<small>Activation remaining</small><b>${d}d ${p2(h)}h ${p2(m)}m ${p2(sec)}s</b><i><u style="width:${Math.max(2,Math.min(100,left/(365*DAY)*100))}%"></u></i>`;};
 paint();tick=setInterval(paint,1000);
 watch(P('students/'+s.id+'/expiresAt'),x=>{s.expiresAt=x.val();paint();});}

/* ---- Coach Reed greets as soon as the dashboard opens ---- */
function greet(s){const R=window.RF;if(!R)return;const h=new Date().getHours(),part=h<12?'Good morning':h<17?'Good afternoon':'Good evening',first=String(s.name||'reader').split(' ')[0];
 let t=`${part}, ${first}! I am Coach Reed, your reading coach. `;
 if(s.demo)t+='This is the free demo, so your progress will not be saved. ';
 else if(s.expiresAt){const d=Math.max(0,Math.ceil((s.expiresAt-now())/DAY));t+=`Your activation has ${d} day${d===1?'':'s'} remaining. `;}
 t+='Choose a passage, press Listen first to hear it, then press Start reading when you are ready.';
 let started=false;R.speak([{text:t,onstart:()=>{started=true;}}],{src:'greet'});
 setTimeout(()=>{if(started||!greeted)return;R.stopVoice();const dock=$('coachDock');dock&&dock.classList.add('attention');
  const go=()=>{document.removeEventListener('pointerdown',go,true);document.removeEventListener('keydown',go,true);armed=null;dock&&dock.classList.remove('attention');R.speak(t,{src:'greet'});};
  armed=go;document.addEventListener('pointerdown',go,true);document.addEventListener('keydown',go,true);},2500);}

function onDashboard(s){
 if(!s)return;
 if(!$('rfAct')||s.demo!==undefined)countdown(s);
 if(!(window.SpeechRecognition||window.webkitSpeechRecognition)&&!$('rfBrowser')){const n=document.createElement('div');n.id='rfBrowser';n.className='rf-note';n.textContent='Voice reading needs Google Chrome or Microsoft Edge. Please open this page in one of them.';const v=$('dashboardView');v&&v.insertBefore(n,v.firstChild);}
 try{firebase.database().ref('.info/serverTimeOffset').once('value').then(x=>{off=x.val()||0;});}catch(e){}
 if(!greeted){greeted=true;setTimeout(()=>greet(s),700);}
}
function stop(){stopTick();unwatch();greeted=false;if(armed){document.removeEventListener('pointerdown',armed,true);document.removeEventListener('keydown',armed,true);armed=null;}const a=$('rfAct');a&&a.remove();closeModal();}
window.RFAccess={onDashboard,deviceLocked,expired,stop};
})();
