(()=>{'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db=null,auth=null;if(window.FIREBASE_READY&&window.firebase){try{if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);db=firebase.database();auth=firebase.auth();}catch(e){console.error(e);}}
const norm=d=>({id:d.id,title:d.title,topic:d.topic,text:d.text,vocab:d.vocab.map(v=>({word:v[0],meaning:v[1]})),questions:d.questions.map(q=>({q:q[0],o:q[1],a:q[2],skill:q[3],why:q[4]}))});
let me=null,P={},H=[],cur=null,qi=0,ans=[],t0=0,tm=null,tok=0,sents=[],last='',voice=null;
let subTimer=null,attached=false,curView='loginView',srvOff=0,offs=[],subOffs=[],attachPassages=()=>{},detachPassages=()=>{};
const VIEWS=['loginView','dashView','readView','quizView','resultView'];
const show=v=>{curView=v;VIEWS.forEach(x=>$(x).classList.toggle('hidden',x!==v));$('logoutBtn').classList.toggle('hidden',v==='loginView');scrollTo(0,0);};
const TTS='speechSynthesis' in window;
/* ---------- voice ---------- */
const sc=v=>(/female|samantha|zira|aria|jenny/i.test(v.name)?3:0)+(/natural|online|neural/i.test(v.name)?2:0)+(/en-(GB|NG|US)/i.test(v.lang)?1:0);
const pick=()=>{if(!voice&&TTS)voice=speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)).sort((a,b)=>sc(b)-sc(a))[0]||null;return voice;};
if(TTS)speechSynthesis.onvoiceschanged=()=>{voice=null;};
const coach=t=>{last=t;$('dockSays').textContent=t;};
function utter(t,end){const u=new SpeechSynthesisUtterance(t),v=pick();if(v){u.voice=v;u.lang=v.lang;}else u.lang='en-GB';u.rate=+$('speed').value||.9;const d=$('dock'),off=()=>{d.classList.remove('speaking');end&&end();};u.onstart=()=>d.classList.add('speaking');u.onend=off;u.onerror=off;speechSynthesis.speak(u);}
function stop(){tok++;if(TTS)speechSynthesis.cancel();$('dock').classList.remove('speaking');}
function say(t){coach(t);if(!TTS)return;stop();utter(t);}
function seq(items,onItem,done){if(!TTS)return coach('Read-aloud is not supported in this browser.');const my=++tok;let i=0;speechSynthesis.cancel();const next=()=>{if(my!==tok)return;if(i>=items.length){done&&done();return;}const k=i++;onItem&&onItem(k);utter(items[k],()=>setTimeout(next,160));};next();}
const hl=i=>document.querySelectorAll('.cp-s').forEach(e=>e.classList.toggle('on',+e.dataset.i===i));
const playPassage=()=>{coach('Listen carefully. I am reading the passage.');seq(sents,hl,()=>{hl(-1);coach('That is the end. Press the button when you are ready for the questions.');});};
/* ---------- email/password login + one-device lock ---------- */
const INTRO='Welcome to MathCloud Reading Comprehension. I am Coach Reed. I will read a passage to you. Listen carefully, and tap any highlighted word to hear its meaning. Then answer the multiple choice questions. At the end I will show you every answer with an explanation.';
$('introBtn').onclick=()=>say(INTRO);$('dockReplay').onclick=()=>say(last);
const DEMO_DEVICE='reading-comprehension-device-v1';
const getDeviceId=()=>{let id=localStorage.getItem(DEMO_DEVICE);if(!id){id=Array.from({length:4},()=>Math.random().toString(36).slice(2)).join('');localStorage.setItem(DEMO_DEVICE,id);}return id;};
async function studentLogin(email,password){
 if(!auth||!db)throw Error('Firebase Authentication is not configured.');
 const cred=await auth.signInWithEmailAndPassword(email,password),user=cred.user;
 const ps=await db.ref('comprehension/students/'+user.uid).once('value'),profile=ps.val();
 if(!profile||profile.active===false){await auth.signOut();throw Error('Your student account is inactive or not assigned. Contact your teacher.');}
 const deviceId=getDeviceId(),lockRef=db.ref('comprehension/deviceLocks/'+user.uid);
 let lockError='';
 const result=await lockRef.transaction(cur=>{
   if(!cur||cur.unlocked===true||!cur.deviceId||cur.deviceId===deviceId)return {deviceId,unlocked:false,updatedAt:Date.now()};
   return;
 }).catch(async()=>{await auth.signOut().catch(()=>{});throw Error('Unable to verify device lock.');});
 if(!result.committed){await auth.signOut();throw Error('This account is active or locked to another device. Contact the administrator on WhatsApp to request a device change.');}
 me={id:user.uid,uid:user.uid,name:profile.name||user.displayName||user.email,email:user.email,classId:profile.classId||'',className:profile.className||'',demo:false,deviceId,activatedAt:profile.activatedAt||0,expiresAt:profile.expiresAt||0};
 sessionStorage.setItem('comprehensionSignedIn','1');await enter();
}
$('loginForm').onsubmit=async e=>{e.preventDefault();const err=$('loginError');err.textContent='';try{await studentLogin($('studentEmail').value.trim(),$('studentPassword').value);}catch(x){console.error(x);err.textContent=x.code==='auth/invalid-credential'||x.code==='auth/wrong-password'||x.code==='auth/user-not-found'?'Email or password is incorrect.':(x.message||'Unable to sign in. Check your connection.');}};
$('demoLoginBtn').onclick=()=>{stop();me={id:'demo',name:'Demo Student',demo:true};enter();};
$('logoutBtn').onclick=async()=>{stop();clearInterval(tm);cleanupSession();/* Keep the device lock after sign-out; only an administrator may release it. */if(auth)await auth.signOut().catch(()=>{});me=null;P={};H=[];$('studentEmail').value='';$('studentPassword').value='';show('loginView');coach('Welcome! Press the demo button or sign in with your student email and password.');};
async function enter(){$('studentName').textContent=(me.name||'Learner').split(' ')[0];if($('subCard'))$('subCard').classList.add('hidden');show('dashView');
 if(me.demo){P={};window.CP_DEMO.forEach(d=>P[d.id]=norm(d));$('bankInfo').textContent='Demo passages. Scores are not saved.';drawDash();}
 else{const A={},B={},C={},m=()=>{P={};Object.entries({...A,...B,...C}).forEach(([k,v])=>{if(v.status!=='draft')P[k]={...v,id:k,vocab:v.vocab||[],questions:v.questions||[]};});$('bankInfo').textContent=Object.keys(P).length+' passages ready for you';drawDash();};
  const w=(q,o)=>{const cb=s=>{Object.keys(o).forEach(k=>delete o[k]);Object.assign(o,s.val()||{});m();};q.on('value',cb,e=>console.error('Passages unavailable:',e.message));offs.push(()=>q.off('value',cb));};
  attachPassages=()=>{if(attached)return;attached=true;if(me.classId)w(db.ref('comprehension/passages').orderByChild('classId').equalTo(me.classId),A);w(db.ref('comprehension/passages').orderByChild('studentId').equalTo(me.id),B);w(db.ref('comprehension/passages').orderByChild('classId').equalTo('all'),C);};
  detachPassages=()=>{offs.splice(0).forEach(f=>f());attached=false;[A,B,C].forEach(o=>Object.keys(o).forEach(k=>delete o[k]));m();};
  startSession();
  try{H=Object.values((await db.ref('comprehension/sessions').orderByChild('studentId').equalTo(me.id).once('value')).val()||{});}catch(x){console.error(x);}drawDash();}
 coach('Hello '+(me.name||'')+'. Choose a passage to begin.');}
/* ---------- subscription countdown + live access control ---------- */
const DAY=864e5,p2=n=>String(n).padStart(2,'0'),srvNow=()=>Date.now()+srvOff,subValid=()=>!!(me&&!me.demo&&+me.expiresAt>srvNow());
function renderSub(){const c=$('subCard');if(!c)return;if(!me||me.demo){c.classList.add('hidden');return;}
 c.classList.remove('hidden','ok','warn','bad');
 const exp=+me.expiresAt||0,act=+me.activatedAt||0,rem=exp-srvNow(),live=!!exp&&rem>0,dt=t=>new Date(t).toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'}),
 set=(cls,badge,title,note)=>{c.classList.add(cls);$('subBadge').textContent=badge;$('subTitle').textContent=title;$('subNote').textContent=note;};
 $('subClock').classList.toggle('hidden',!live);$('subBarWrap').classList.toggle('hidden',!live);$('subWa').classList.toggle('hidden',live&&rem>30*DAY);
 if(!exp){set('bad','Not activated','Subscription not active','Your account has not been activated yet. Your passages unlock as soon as the administrator activates your one-year access.');$('subDates').textContent='';return;}
 if(!live){set('bad','Expired','Subscription expired','Your one-year access ended on '+dt(exp)+'. Contact the administrator to renew.');$('subDates').textContent='';return;}
 const d=Math.floor(rem/DAY),h=Math.floor(rem%DAY/36e5),m=Math.floor(rem%36e5/6e4),s=Math.floor(rem%6e4/1e3),soon=rem<=30*DAY;
 $('cdD').textContent=d;$('cdH').textContent=p2(h);$('cdM').textContent=p2(m);$('cdS').textContent=p2(s);
 set(soon?'warn':'ok',soon?'Expiring soon':'Active',soon?'Your subscription ends soon':'Subscription active','Time left on your one-year access.');
 const total=act&&exp>act?exp-act:365*DAY;$('subBar').style.width=Math.max(0,Math.min(100,100*rem/total))+'%';
 $('subDates').textContent=(act?'Activated '+dt(act)+' · ':'')+'Expires '+dt(exp);}
function syncAccess(){if(!me||me.demo)return;if(subValid()){attachPassages();}else{if(attached)detachPassages();if(curView==='readView'||curView==='quizView'){stop();clearInterval(tm);show('dashView');coach('Your subscription is not active, so the passages are locked.');}}drawDash();}
function cleanupSession(){clearInterval(subTimer);subTimer=null;subOffs.splice(0).forEach(f=>f());offs.splice(0).forEach(f=>f());attached=false;attachPassages=()=>{};detachPassages=()=>{};const c=$('subCard');if(c)c.classList.add('hidden');}
function endSession(msg){stop();clearInterval(tm);cleanupSession();if(auth)auth.signOut().catch(()=>{});me=null;P={};H=[];$('studentEmail').value='';$('studentPassword').value='';show('loginView');$('loginError').textContent=msg||'';coach(msg||'You have been signed out.');}
async function checkDevice(){if(!me||me.demo||!db)return true;try{const l=(await db.ref('comprehension/deviceLocks/'+me.uid).once('value')).val();if(l&&l.deviceId&&l.unlocked!==true&&l.deviceId!==me.deviceId){endSession('This account is locked to another device. Contact the administrator on WhatsApp to request a device change.');return false;}}catch(x){console.error(x);}return true;}
function startSession(){if(!me||me.demo||!db)return;subOffs.splice(0).forEach(f=>f());clearInterval(subTimer);
 const on=(ref,cb)=>{ref.on('value',cb,e=>console.error('Live listener:',e.message));subOffs.push(()=>ref.off('value',cb));};
 on(db.ref('.info/serverTimeOffset'),s=>{srvOff=+s.val()||0;renderSub();});
 /* live profile: activation dates, enable/disable, class changes */
 on(db.ref('comprehension/students/'+me.uid),s=>{if(!me)return;const pr=s.val();if(!pr||pr.active===false){endSession('Your student account is inactive or not assigned. Contact your teacher.');return;}
  me.name=pr.name||me.name;me.activatedAt=pr.activatedAt||0;me.expiresAt=pr.expiresAt||0;const cid=pr.classId||'';
  if(cid!==me.classId){me.classId=cid;me.className=pr.className||'';if(attached)detachPassages();}
  renderSub();syncAccess();});
 /* live device lock: if the account is now bound to a different device, this one is signed out */
 on(db.ref('comprehension/deviceLocks/'+me.uid),s=>{if(!me)return;const l=s.val();if(l&&l.deviceId&&l.unlocked!==true&&l.deviceId!==me.deviceId){endSession('This account is locked to another device. Contact the administrator on WhatsApp to request a device change.');return;}
  const n=$('devNote');if(n)n.textContent=l&&l.unlocked===true?'🔓 Device unlocked by the administrator: the next device you sign in on becomes your locked device.':l&&l.deviceId?'🔒 This account is locked to this device. Ask the administrator to unlock it if you change device.':'';});
 subTimer=setInterval(()=>{if(!me)return;renderSub();if(subValid()!==attached)syncAccess();},1000);renderSub();}
/* ---------- dashboard ---------- */
const mmss=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
function skillAgg(list){const a={};list.forEach(s=>Object.entries(s.skills||{}).forEach(([k,[c,t]])=>{a[k]=a[k]||[0,0];a[k][0]+=c;a[k][1]+=t;}));return Object.entries(a).map(([k,[c,t]])=>[k,Math.round(100*c/t),t]).sort((x,y)=>x[1]-y[1]);}
const skHtml=r=>r.map(([k,p])=>`<div class="cp-sk"><span>${esc(k)}</span><div><i style="width:${p}%;background:${p<50?'#b42318':p<75?'#f79009':'#12b76a'}"></i></div><b>${p}%</b></div>`).join('');
function drawDash(){const n=H.length;$('mTaken').textContent=n;$('mAvg').textContent=n?Math.round(H.reduce((a,s)=>a+s.score,0)/n)+'%':'—';$('mBest').textContent=n?Math.round(Math.max(...H.map(s=>s.score)))+'%':'—';$('mAns').textContent=H.reduce((a,s)=>a+s.total,0);
 const ps=Object.values(P).sort((a,b)=>String(a.topic).localeCompare(b.topic)||String(a.title).localeCompare(b.title));
 $('plist').innerHTML=ps.length?ps.map(p=>{const b=H.filter(s=>s.passageId===p.id).map(s=>s.score);return `<div class="cp-pass"><div><b>${esc(p.title)}</b><div class="mq-muted">${esc(p.topic||'General')} · ${p.questions.length} questions${b.length?' · best '+Math.round(Math.max(...b))+'%':''}</div></div><button class="btn primary" data-p="${esc(p.id)}">${b.length?'Read again':'Start'}</button></div>`;}).join(''):(me&&!me.demo&&!subValid()?'<p class="mq-muted">Passages are locked until your subscription is active.</p>':'<p class="mq-muted">No passages yet. Ask your teacher to upload some.</p>');
 const sk=skillAgg(H);$('skLead').textContent=sk.length?'Weakest skill first. Practise the red bars.':'Take a test to see your skills.';$('skills').innerHTML=skHtml(sk);
 $('history').innerHTML=n?[...H].sort((a,b)=>b.completedAt-a.completedAt).slice(0,8).map(s=>`<div class="cp-pass"><div><b>${esc(s.title)}</b><div class="mq-muted">${new Date(s.completedAt).toLocaleString([],{dateStyle:'medium',timeStyle:'short'})} · ${s.correct}/${s.total}</div></div><b>${Math.round(s.score)}%</b></div>`).join(''):'<p class="mq-muted">Finished tests appear here.</p>';}
$('plist').onclick=async e=>{const b=e.target.closest('[data-p]');if(b&&await checkDevice())openPassage(b.dataset.p);};
/* ---------- reading ---------- */
function openPassage(id){stop();cur=P[id];if(!cur)return;$('pTitle').textContent=cur.title;
 sents=[];const vr=cur.vocab.length?new RegExp('\\b('+cur.vocab.map(v=>v.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')\\b','gi'):null;
 $('ptext').innerHTML=cur.text.split(/\n+/).filter(p=>p.trim()).map(p=>'<p>'+(p.match(/[^.!?]+[.!?]+["”')]*\s*|[^.!?]+$/g)||[p]).map(s=>{const i=sents.push(s.trim())-1;let h=esc(s.trim());if(vr)h=h.replace(vr,m=>`<span class="vw" data-w="${esc(m.toLowerCase())}">${m}</span>`);return `<span class="cp-s" data-i="${i}">${h}</span>`;}).join(' ')+'</p>').join('');
 $('gloss').innerHTML=cur.vocab.map(v=>`<div><button class="btn" data-w="${esc(v.word.toLowerCase())}" style="padding:4px 10px">🔊</button><b>${esc(v.word)}</b> — ${esc(v.meaning)}</div>`).join('')||'<p class="mq-muted">No special words in this passage.</p>';
 $('ptext').classList.remove('hidden');show('readView');coach('Press Listen to hear the passage. Tap any blue word to hear what it means.');}
const word=w=>{const v=cur.vocab.find(x=>x.word.toLowerCase()===w);if(v)say(v.word+'. '+v.meaning);};
$('readView').addEventListener('click',e=>{const b=e.target.closest('[data-w]');if(b)word(b.dataset.w);});
$('playBtn').onclick=playPassage;$('stopBtn').onclick=()=>{stop();hl(-1);coach('Stopped.');};
$('wordsBtn').onclick=()=>seq(cur.vocab.map(v=>v.word+'. '+v.meaning),k=>coach(cur.vocab[k].word+': '+cur.vocab[k].meaning),()=>coach('Those are the words to know.'));
$('txtBtn').onclick=()=>$('ptext').classList.toggle('hidden');
$('leaveBtn').onclick=()=>{stop();clearInterval(tm);show('dashView');drawDash();};
/* ---------- quiz ---------- */
$('startQ').onclick=()=>{stop();qi=0;ans=cur.questions.map(()=>-1);t0=Date.now();clearInterval(tm);tm=setInterval(()=>$('timer').textContent=mmss(Math.round((Date.now()-t0)/1000)),1000);$('qTitle').textContent=cur.title;show('quizView');drawQ();};
$('backRead').onclick=()=>{stop();show('readView');};
function drawQ(){const q=cur.questions[qi],n=cur.questions.length;$('counter').textContent='Question '+(qi+1)+' of '+n;$('skTag').textContent=q.skill||'';$('bar').style.width=(100*qi/n)+'%';$('qText').textContent=q.q;$('qMsg').textContent='';
 $('opts').innerHTML=q.o.map((o,i)=>`<button class="cp-opt${ans[qi]===i?' sel':''}" role="radio" aria-checked="${ans[qi]===i}" data-o="${i}"><b>${'ABCD'[i]}.</b> ${esc(o)}</button>`).join('');$('prevBtn').style.visibility=qi?'visible':'hidden';$('nextBtn').textContent=qi===n-1?'Finish test ✓':'Next →';}
$('opts').onclick=e=>{const b=e.target.closest('[data-o]');if(!b)return;ans[qi]=+b.dataset.o;drawQ();};
$('prevBtn').onclick=()=>{qi--;drawQ();};
$('nextBtn').onclick=()=>{if(ans[qi]<0){$('qMsg').textContent='Choose an answer first.';return;}if(qi<cur.questions.length-1){qi++;drawQ();return;}const miss=ans.filter(a=>a<0).length;if(miss&&!confirm(miss+' question(s) unanswered. Finish anyway?'))return;finish();};
$('qHear').onclick=()=>{const q=cur.questions[qi];say(q.q+' '+q.o.map((o,i)=>'ABCD'[i]+'. '+o).join('. '));};
$('qReplay').onclick=playPassage;
/* ---------- results ---------- */
async function finish(){stop();clearInterval(tm);const n=cur.questions.length,secs=Math.round((Date.now()-t0)/1000),skills={};let c=0;
 cur.questions.forEach((q,i)=>{const ok=ans[i]===q.a,k=(q.skill||'General').replace(/[.#$\/\[\]]/g,'');skills[k]=skills[k]||[0,0];skills[k][1]++;if(ok){c++;skills[k][0]++;}});
 const score=Math.round(100*c/n),s={studentId:me.id,studentName:me.name||'',className:me.className||'',passageId:cur.id,title:cur.title,topic:cur.topic||'',score,total:n,correct:c,seconds:secs,skills,answers:ans,completedAt:Date.now()};
 $('ring').style.background=`conic-gradient(#155eef ${score}%,#e4e7ec 0)`;$('ringTxt').textContent=score+'%';
 $('resTitle').textContent=score>=80?'Excellent listening!':score>=50?'Good effort!':'Keep practising!';$('resSub').textContent=`${c} of ${n} correct in ${mmss(secs)}.`;
 const sk=skillAgg([s]);$('resSk').innerHTML=skHtml(sk);const weak=sk.filter(x=>x[1]<70).map(x=>x[0]);
 $('review').innerHTML=cur.questions.map((q,i)=>{const ok=ans[i]===q.a;return `<div class="cp-rv ${ok?'good':'bad'}"><b>${i+1}. ${esc(q.q)}</b><p>Your answer: <span class="${ok?'cp-ok':'cp-no'}">${ans[i]<0?'No answer':'ABCD'[ans[i]]+'. '+esc(q.o[ans[i]])}</span></p>${ok?'':`<p>Correct answer: <span class="cp-ok">${'ABCD'[q.a]}. ${esc(q.o[q.a])}</span></p>`}${q.why?`<p class="mq-muted">💡 ${esc(q.why)}</p>`:''}<button class="btn" data-say="${i}" style="padding:5px 12px">🔊 Explain</button></div>`;}).join('');
 const msg=`You scored ${c} out of ${n}. `+(weak.length?'Practise these skills: '+weak.join(', ')+'.':'Your skills look strong. Well done.');
 $('sayBtn').onclick=()=>say(msg);show('resultView');coach(msg);
 $('saveMsg').textContent=me.demo?'Demo mode: this score is not saved.':'Saving…';
 if(me.demo){$('saveMsg').textContent='Demo mode: this score is not saved.';return;}
 if(!me||!me.uid||!auth||!db){$('saveMsg').textContent='Could not save: student sign-in is not active. Please sign in again.';return;}
 if(auth.currentUser?.uid!==me.uid){$('saveMsg').textContent='Could not save: signed-in account does not match this student. Please sign in again.';return;}
 if(!await checkDevice())return;
 try{const recordRef=db.ref('comprehension/sessions').push();await recordRef.set(s);H.push(s);$('saveMsg').textContent='Result saved ✓';drawDash();}
 catch(x){console.error('Comprehension score save failed:',x);const code=x&&x.code;const detail=code==='PERMISSION_DENIED'?'Firebase permission denied. Check the deployed Realtime Database rules for comprehension/sessions.':(x&&x.message?x.message:'Network or database error.');$('saveMsg').textContent='Could not save this result: '+detail;}
}
$('review').onclick=e=>{const b=e.target.closest('[data-say]');if(!b)return;const q=cur.questions[+b.dataset.say];say('The correct answer is '+q.o[q.a]+'. '+(q.why||''));};
$('againBtn').onclick=()=>openPassage(cur.id);$('homeBtn').onclick=()=>{stop();show('dashView');drawDash();};
})();

/* Coach Reed starts speaking on load where browser autoplay policy permits.
   If speech is blocked, the visible Replay/Introduction controls remain available. */
window.addEventListener('load',()=>{setTimeout(()=>{try{if(TTS){say(INTRO);}}catch(e){console.warn('Autoplay speech was blocked by the browser.',e);}},700);});
