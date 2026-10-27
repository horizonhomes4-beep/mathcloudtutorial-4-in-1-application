(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// x^2 -> superscript, sqrt( -> √(
const fmt=s=>esc(s).replace(/\^(-?\d+)/g,'<sup>$1</sup>').replace(/sqrt\(/g,'√(');
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const clock=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const LET='ABCD';
let db=null,root=null,auth=null;
if(window.FIREBASE_READY&&window.firebase){try{if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);db=firebase.database();root=db.ref();auth=firebase.auth();}catch(e){console.error(e);}}
const S={student:null,questions:[],sessions:[],quiz:null,timer:null,feedOff:[],last:null};
const R=p=>root.child('mathQuiz/'+p);
const TOPIC_N=20,ALL_N=20,WEAK=60; // every quiz = 20 questions (one topic or all topics), below 60% = weak
/* Remembers which questions this student has already been given (per device) so a retry draws a different set. */
const seenKey=()=>'mqSeen_'+(S.student?S.student.id:'x');
function seenLoad(){try{return JSON.parse(localStorage.getItem(seenKey())||'{}')||{};}catch(e){return {};}}
function seenSave(m){try{const k=Object.keys(m);if(k.length>3000){k.sort((a,b)=>m[a]-m[b]).slice(0,k.length-2000).forEach(x=>delete m[x]);}localStorage.setItem(seenKey(),JSON.stringify(m));}catch(e){}}

const wrongKey=()=>'mqWrong_'+(S.student?S.student.id:'x');
function wrongLoad(){try{return JSON.parse(localStorage.getItem(wrongKey())||'{}')||{};}catch(e){return {};}}
function wrongSave(m){try{const seen=S.seen||{};Object.keys(m).forEach(k=>{if(!seen[k])delete m[k];});localStorage.setItem(wrongKey(),JSON.stringify(m));}catch(e){}}
const asArr=v=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[]);
/* What this student has already met: rebuilt from saved results in the database (so it survives a new device or cleared
   browser data) and merged with the on-device record. For every question: when it was last answered and whether that last answer was wrong. */
function history(){
 const h={};
 [...(S.sessions||[])].sort((a,b)=>(a.completedAt||0)-(b.completedAt||0)).forEach(x=>{const ids=asArr(x.qids);if(!ids.length)return;const wr=new Set(asArr(x.qwrong));ids.forEach(id=>{h[id]={t:x.completedAt||0,w:wr.has(id)};});});
 Object.entries(S.seen||{}).forEach(([id,t])=>{const o=h[id];if(!o||t>o.t)h[id]={t,w:!!(S.wrong||{})[id]};});
 return h;
}

function show(v){['loginView','blockView','dashView','quizView','resultView'].forEach(id=>$(id).classList.toggle('hidden',id!==v));$('logoutBtn').classList.toggle('hidden',v==='loginView');window.scrollTo({top:0,behavior:'smooth'});}
function coach(t){$('dockSays').textContent=t;}

/* ---------- Voice (question read-aloud). Prefers a natural English female voice, never stays silent if one exists. ---------- */
let voice=null;
if('speechSynthesis' in window)speechSynthesis.onvoiceschanged=()=>{voice=null;};
function pickVoice(){if(voice||!('speechSynthesis' in window))return voice;const sc=v=>{const n=(v.name||'').toLowerCase(),l=(v.lang||'').toLowerCase();let s=0;if(/natural|neural|online/.test(n))s+=100;if(/aria|jenny|sonia|zira|samantha|victoria|serena|hazel|libby|natasha|ava|allison|karen|moira|tessa|female|woman/.test(n))s+=120;if(/en-ng/.test(l))s+=25;else if(/en-gb/.test(l))s+=20;else if(/en-us/.test(l))s+=15;return s;};return voice=speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)).sort((a,b)=>sc(b)-sc(a))[0]||null;}
function spoken(t){return String(t).replace(/(\d+)\/(\d+)/g,'$1 over $2').replace(/\^2|²/g,' squared ').replace(/\^3|³/g,' cubed ').replace(/\^(\d+)/g,' to the power $1 ').replace(/√/g,' square root of ').replace(/sqrt\(/g,' square root of (').replace(/×/g,' times ').replace(/÷/g,' divided by ').replace(/−/g,' minus ').replace(/\+/g,' plus ').replace(/=/g,' equals ').replace(/%/g,' percent').replace(/₦/g,' naira ').replace(/°/g,' degrees ');}
let lastSaid='';
function say(t,blocked){if(!('speechSynthesis' in window)){coach('Read-aloud is not supported in this browser.');return;}lastSaid=t;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(spoken(t)),v=pickVoice();if(v){u.voice=v;u.lang=v.lang;}u.rate=.95;u.onstart=()=>$('dock').classList.add('speaking');u.onend=()=>$('dock').classList.remove('speaking');u.onerror=e=>{$('dock').classList.remove('speaking');if(blocked&&e&&e.error==='not-allowed')blocked();};speechSynthesis.speak(u);if(blocked)setTimeout(()=>{if(!speechSynthesis.speaking)blocked();},1500);}
function stopSay(){if('speechSynthesis' in window)speechSynthesis.cancel();$('dock').classList.remove('speaking');}

/* ---------- Login: email + password (Firebase Authentication), one device per account ---------- */
const err=t=>{$('loginError').textContent=t;};
let PENDING='';
const GUARD={offs:[],state:'',gen:0,lock:null,req:null};
let _dev=null;
function devId(){if(_dev)return _dev;try{_dev=localStorage.getItem('mqDeviceId');}catch(e){}if(!_dev){_dev='dv_'+(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2,12));try{localStorage.setItem('mqDeviceId',_dev);}catch(e){}}return _dev;}
function devLabel(){const u=navigator.userAgent||'';const os=/Windows/.test(u)?'Windows':/Android/.test(u)?'Android':/iPhone|iPad|iPod/.test(u)?'iOS':/Mac OS X|Macintosh/.test(u)?'macOS':/CrOS/.test(u)?'ChromeOS':/Linux/.test(u)?'Linux':'Unknown OS';const br=/Edg\//.test(u)?'Edge':/OPR\/|Opera/.test(u)?'Opera':/SamsungBrowser/.test(u)?'Samsung Browser':/Firefox\//.test(u)?'Firefox':/Chrome\/|CriOS/.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'Browser';return br+' on '+os;}
const authMsg=e=>{const c=(e&&e.code)||'';if(/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c))return 'The email or password is not correct. Check it and try again, or ask your administrator.';if(c==='auth/invalid-email')return 'Enter a valid email address.';if(c==='auth/too-many-requests')return 'Too many attempts. Wait a few minutes and try again.';if(c==='auth/user-disabled')return 'This account has been disabled. Contact your administrator.';if(c==='auth/network-request-failed')return 'Network error. Check your internet connection.';return 'Could not sign in. '+((e&&e.message)||'');};
function stopGuard(){GUARD.offs.splice(0).forEach(f=>{try{f();}catch(e){}});}
function cleanup(){stopFeed();stopTimer();stopSay();stopGuard();GUARD.gen++;GUARD.state='';GUARD.lock=null;GUARD.req=null;S.student=null;S.sessions=[];S.questions=[];S.quiz=null;S.seen=null;S.wrong=null;}
function toLogin(msg){cleanup();$('walkModal').classList.add('hidden');$('coachChat').classList.add('hidden');show('loginView');err(msg||'');coach('Pick a quiz when you are ready. I will cheer you on.');}
async function fail(m){PENDING=m;if(auth)await auth.signOut();}
function kick(m){PENDING=m;if(auth)auth.signOut();}

/* Binds this browser to the account on first sign-in. Later devices are refused until the administrator unlocks. */
async function checkDevice(uid){
 const id=devId(),r=R('deviceLocks/'+uid);
 let L=(await r.once('value')).val();
 if(!L||L.state==='unlocked'){
  try{await r.set({deviceId:id,label:devLabel(),state:'locked',boundAt:Date.now()});return 'ok';}
  catch(e){
   console.error(e);
   L=(await r.once('value')).val();
   // Someone else locked it first (two devices signing in at once): decide from the real lock.
   if(L&&L.state==='locked')return L.deviceId===id?'ok':'blocked';
   // The write failed and nobody holds the lock: this is a rules/connection problem, NOT "another device".
   // (Reporting "blocked" here used to make the page loop and show a false "locked to another device" screen.)
   throw e;
  }
 }
 return L.deviceId===id?'ok':'blocked';
}
async function admit(user){
 const gen=++GUARD.gen;stopGuard();err('Checking your account…');
 let rec;
 try{rec=(await R('students/'+user.uid).once('value')).val();}catch(e){console.error(e);await fail('Could not verify your account. Check your internet connection and the database rules.');return;}
 if(gen!==GUARD.gen)return;
 if(!rec||rec.active===false){await fail(rec?'This account is inactive. Please contact your teacher or school.':'This login has not been set up for Math Quiz. Please ask your administrator to create your student account.');return;}
 S.student={id:user.uid,...rec};
 let st;try{st=await checkDevice(user.uid);}catch(e){console.error(e);await fail(e&&e.code==='PERMISSION_DENIED'?'Could not lock this device to your account. The administrator must publish the latest database.rules.json in Firebase.':'Could not check your device. Check your internet connection and try again.');return;}
 if(gen!==GUARD.gen)return;
 GUARD.state=st;watchGuard(user.uid);
 if(st==='ok'){err('');enter();}else showBlock();
}
function watchGuard(uid){
 const lr=R('deviceLocks/'+uid),sr=R('students/'+uid+'/active'),rr=R('deviceRequests/'+uid),mine=devId();
 const lf=snap=>{const L=snap.val();GUARD.lock=L;
  if(GUARD.state==='ok'){if(!L||L.state!=='locked'||L.deviceId!==mine)kick('The administrator has unlocked or changed the device for this account. Please sign in again.');}
  else if(GUARD.state==='blocked'){if(!L||L.state==='unlocked'||L.deviceId===mine){const u=auth&&auth.currentUser;if(u)admit(u).catch(console.error);}else renderBlock();}};
 const sf=snap=>{if(snap.val()===false)kick('This account has been deactivated. Please contact your teacher or school.');};
 const rf=snap=>{GUARD.req=snap.val();if(GUARD.state==='blocked')renderBlock();};
 const oe=e=>console.error(e);
 lr.on('value',lf,oe);sr.on('value',sf,oe);rr.on('value',rf,oe);
 GUARD.offs.push(()=>lr.off('value',lf),()=>sr.off('value',sf),()=>rr.off('value',rf));
}
function showBlock(){show('blockView');renderBlock();coach('This account is tied to another device. You can ask your administrator to approve this one.');}
function renderBlock(){
 const L=GUARD.lock,Rq=GUARD.req,pending=!!(Rq&&Rq.status==='pending'),m=$('blockMsg');
 $('blockInfo').textContent='Your account is registered to another device'+(L&&L.label?' ('+L.label+')':'')+'. For security, a student can use one device only. If you changed your phone, tablet or computer, send a request and your administrator will review it.';
 $('blockReq').disabled=pending;$('blockNote').disabled=pending;
 if(pending){m.className='mq-msg good';m.textContent='Request sent'+(Rq.requestedAt?' on '+new Date(Rq.requestedAt).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'')+'. Waiting for the administrator. This page opens automatically once it is approved.';}
 else if(Rq&&Rq.status==='rejected'){m.className='mq-msg';m.textContent='Your last request was declined. Speak to your teacher or send another request.';}
 else if(Rq&&Rq.status==='approved'){m.className='mq-msg';m.textContent='Your last request was approved but the account was locked to a device again. Send a new request if you still need this device.';}
 else{m.className='mq-msg';m.textContent='';}
}
$('blockReq').onclick=async()=>{
 const s=S.student,u=auth&&auth.currentUser;if(!s||!u)return;$('blockReq').disabled=true;
 try{await R('deviceRequests/'+s.id).set({studentId:s.id,studentName:s.name||'',email:s.email||u.email||'',className:s.className||'',newDeviceLabel:devLabel(),note:$('blockNote').value.trim().slice(0,300),status:'pending',requestedAt:Date.now()});$('blockNote').value='';}
 catch(e){console.error(e);$('blockMsg').className='mq-msg';$('blockMsg').textContent='Could not send the request. Check your connection and try again.';$('blockReq').disabled=false;}
};
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();err('');
 if(!auth){err('Firebase is not configured. Check firebase-config.js.');return;}
 const b=$('loginBtn');b.disabled=true;err('Signing in…');
 try{await auth.signInWithEmailAndPassword($('email').value.trim(),$('password').value);$('password').value='';}
 catch(x){console.error(x);err(authMsg(x));}
 b.disabled=false;
});
$('demoBtn').onclick=()=>{cleanup();S.student={id:'demo',name:'Demo Student',className:'Demo Class',demo:true};enter();};
$('logoutBtn').onclick=async()=>{const demo=S.student&&S.student.demo;PENDING='';if(demo||!auth){toLogin('');return;}try{await auth.signOut();}catch(e){console.error(e);toLogin('');}};

/* ---------- Data (questions come only from Firebase and stay live) ---------- */
function clean(id,q){if(!q||typeof q!=='object')return null;const opts=(Array.isArray(q.options)?q.options:Object.values(q.options||{})).map(x=>String(x??'').trim()).filter(Boolean);const a=q.answer==null?-1:Number(q.answer);const text=String(q.text||'').trim();if(!text||opts.length<2||!Number.isInteger(a)||a<0||a>=opts.length||q.status==='draft')return null;return {id,topic:String(q.topic||'General').trim(),level:String(q.level||'').trim(),classId:String(q.classId||''),demo:q.demo===true,text,options:opts,answer:a,explanation:String(q.explanation||'').trim()};}
/* A student sees a question only if (a) it is assigned to their class, or (b) it is assigned to them personally.
   The demo user sees only questions flagged as demo. Every question is re-checked here before it is shown. */
const allowedFrom=(q,src)=>{const s=S.student;if(!s||!q)return false;if(s.demo)return q.demo===true;if(src==='class')return !!s.classId&&q.classId===s.classId;return q.studentIds&&q.studentIds[s.id]===true;};
function demoBank(){const o={};(window.MQ_DEMO||[]).forEach((r,i)=>{o['demo_'+String(i+1).padStart(3,'0')]={topic:r[0],level:'Demo',demo:true,text:r[2],options:r[3],answer:r[4],explanation:r[5],status:'published',createdAt:Date.now(),updatedAt:Date.now()};});return o;}
function startFeed(){
 stopFeed();const s=S.student,F={cls:{},asg:{}},per={};
 const rebuild=()=>{const m={};
  Object.entries(F.cls).forEach(([id,q])=>{if(allowedFrom(q,'class')){const c=clean(id,q);if(c)m[id]=c;}});
  Object.entries(F.asg).forEach(([id,q])=>{if(allowedFrom(q,'student')){const c=clean(id,q);if(c)m[id]=c;}});
  S.questions=Object.values(m);if(!$('dashView').classList.contains('hidden'))renderDash();};
 const onErr=e=>{console.error(e);if(s.demo&&!Object.keys(F.cls).length){F.cls=demoBank();rebuild();return;}$('bankInfo').textContent='Could not load questions. Check your connection and database rules.';};
 const watch=(q,fn)=>{q.on('value',fn,onErr);S.feedOff.push(()=>q.off('value',fn));};
 if(s.demo){F.cls=demoBank();rebuild();}
 else{
  if(s.classId)watch(R('questions').orderByChild('classId').equalTo(s.classId),snap=>{F.cls=snap.val()||{};rebuild();});
  // Questions assigned to this student personally: index at assignments/{studentId}
  watch(R('assignments/'+s.id),snap=>{const ids=Object.keys(snap.val()||{});
   Object.keys(per).forEach(id=>{if(!ids.includes(id)){per[id]();delete per[id];delete F.asg[id];}});
   ids.forEach(id=>{if(per[id])return;const r=R('questions/'+id),fn=sn=>{if(sn.exists())F.asg[id]=sn.val();else delete F.asg[id];rebuild();};r.on('value',fn,onErr);per[id]=()=>r.off('value',fn);});
   rebuild();});
  S.feedOff.push(()=>Object.values(per).forEach(f=>f()));
 }
}
function stopFeed(){S.feedOff.splice(0).forEach(f=>{try{f();}catch(e){}});}
async function enter(){
 S.seen=seenLoad();S.wrong=wrongLoad();$('studentName').textContent=S.student.name||'Learner';show('dashView');startFeed();
 const me=S.student;
 try{S.sessions=me.demo?[]:Object.entries((await R('sessions').orderByChild('studentId').equalTo(me.id).once('value')).val()||{}).map(([id,v])=>({id,...v})).sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));}catch(e){console.error(e);S.sessions=[];}
 if(S.student!==me)return; // signed out while loading
 renderDash();
 say('Welcome '+(me.demo?'to the free demo':(me.name||'Learner'))+'. Step 1, choose a quiz: every quiz has 20 questions, from one topic or from all topics mixed. Step 2, answer each question and I will explain it. Step 3, review your results, and I will walk you through any mistakes. Press Ask on my card if you need help.');
}

/* ---------- Dashboard ---------- */
function fillSelect(sel,items,all){const cur=sel.value;sel.innerHTML=`<option value="all">${all}</option>`+items.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');if([...sel.options].some(o=>o.value===cur))sel.value=cur;}
function renderDash(){
 const qs=S.questions,ss=S.sessions;
 const topics={};qs.forEach(q=>{topics[q.topic]=(topics[q.topic]||0)+1;});
 const weakSet=new Set(analyse(S.sessions).bank.filter(x=>x.p<WEAK&&x.total>=3).map(x=>x.topic));
 fillSelect($('qzTopic'),Object.entries(topics).sort().map(([t,n])=>[t,`${t} · ${TOPIC_N} questions${n<TOPIC_N?` (only ${n} set so far)`:''}${weakSet.has(t)?' · needs work':''}`]),`All topics · ${ALL_N} questions`);
 $('bankInfo').textContent=(S.student.className?S.student.className+' · ':'')+(qs.length?`${qs.length} questions across ${Object.keys(topics).length} topic${Object.keys(topics).length===1?'':'s'} are ready for you.`:'No quiz has been assigned to your class yet. You can still practise with the mental maths drill.');
 const avg=ss.length?Math.round(ss.reduce((a,s)=>a+(s.score||0),0)/ss.length):null;
 $('mTaken').textContent=ss.length;$('mAvg').textContent=avg===null?'—':avg+'%';$('mBest').textContent=ss.length?Math.max(...ss.map(s=>s.score||0))+'%':'—';$('mAnswered').textContent=ss.reduce((a,s)=>a+(s.total||0),0);
 $('history').innerHTML=ss.length?ss.slice(0,8).map(s=>`<div class="mq-row"><div><b>${esc(s.title||'Quiz')}</b><small>${new Date(s.completedAt||Date.now()).toLocaleString([],{dateStyle:'medium',timeStyle:'short'})} · ${s.correct||0}/${s.total||0} correct · ${clock(s.durationSeconds||0)}</small></div>${s.correct<s.total?`<button class="btn" type="button" data-walk="${esc(s.id)}" style="padding:6px 12px;font-size:12px">Review mistakes</button>`:''}<span class="mq-chip ${s.score>=70?'high':s.score<40?'low':''}">${Math.round(s.score||0)}%</span></div>`).join(''):'<p class="mq-muted">Your finished quizzes will appear here.</p>';
 renderAnalysis();updateRule();
}

/* ---------- Performance analysis ---------- */
const pct=(c,t)=>t?Math.round(c/t*100):0;
const verdict=p=>p>=80?{t:'Strong',c:'good'}:p>=WEAK?{t:'Getting there',c:'mid'}:{t:'Needs work',c:'low'};
const isDrill=t=>/^mental maths/i.test(String(t));
function topicRows(list){return list.length?list.map(x=>{const p=x.p!==undefined?x.p:pct(x.correct,x.total),v=verdict(p);return `<div class="mq-trow"><div class="mq-tname"><b>${esc(x.topic)}</b><small>${x.correct}/${x.total} correct</small></div><div class="mq-tbar" role="img" aria-label="${p} percent"><i class="${v.c}" style="width:${p}%"></i></div><span class="mq-tchip ${v.c}">${p}% · ${v.t}</span></div>`;}).join(''):'<p class="mq-muted">No data yet.</p>';}
function analyse(ss){
 const m={};
 ss.forEach(s=>{const raw=s.topics?(Array.isArray(s.topics)?s.topics:Object.values(s.topics)):(s.topic&&s.topic!=='Mixed'&&s.total?[{topic:s.topic,correct:s.correct||0,total:s.total}]:[]);
  raw.forEach(x=>{if(!x||!x.topic||!x.total)return;const o=m[x.topic]||(m[x.topic]={topic:x.topic,correct:0,total:0,quizzes:0});o.correct+=x.correct||0;o.total+=x.total;o.quizzes++;});});
 const all=Object.values(m).map(o=>({...o,p:pct(o.correct,o.total)})).sort((a,b)=>a.p-b.p||b.total-a.total);
 return {bank:all.filter(x=>!isDrill(x.topic)),drill:all.filter(x=>isDrill(x.topic))};
}
function renderAnalysis(){
 const ss=S.sessions,A=analyse(ss),weak=A.bank.filter(x=>x.p<WEAK&&x.total>=3),answered=ss.reduce((a,s)=>a+(s.total||0),0);
 $('anaLead').textContent=S.student.demo?'The demo does not save results, so there is nothing to analyse yet.':ss.length?`Based on ${ss.length} quiz${ss.length===1?'':'zes'} and ${answered} answered questions. Strong is 80% or more, getting there is ${WEAK}–79%, needs work is below ${WEAK}%.`:'Finish a quiz and your strengths and weak topics will appear here.';
 $('anaTopics').innerHTML=topicRows(A.bank);
 $('anaDrillWrap').classList.toggle('hidden',!A.drill.length);$('anaDrill').innerHTML=topicRows(A.drill);
 const w=$('anaWeak');
 if(weak.length){w.className='mq-weak';w.innerHTML=`<b>Topics you did not do well in</b><p>${weak.map(x=>`${esc(x.topic)} (${x.p}%)`).join('; ')}. Choose one of these in Step 1 to practise ${TOPIC_N} fresh questions on it.</p>${weak.slice(0,3).map(x=>`<button class="btn primary" type="button" data-weak="${esc(x.topic)}">Practise ${esc(x.topic)}</button>`).join('')}`;}
 else if(A.bank.length){w.className='mq-weak ok';w.innerHTML=`<b>No weak topics right now</b><p>Every topic is at ${WEAK}% or higher. Keep practising to stay sharp.</p>`;}
 else{w.className='hidden';w.innerHTML='';}
 const recent=ss.slice(0,10).reverse();
 $('anaTrend').innerHTML=recent.length?recent.map(s=>`<i class="${verdict(s.score||0).c}" style="height:${Math.max(6,Math.round(s.score||0))}%" title="${esc(s.title||'Quiz')}: ${Math.round(s.score||0)}%"></i>`).join(''):'<p class="mq-muted">No quizzes yet.</p>';
 const ins=[];
 if(ss.length>=4){const av=x=>x.reduce((t,s)=>t+(s.score||0),0)/x.length,d=Math.round(av(ss.slice(0,3))-av(ss.slice(3,6)));ins.push(d>=5?`Your latest quizzes are ${d} points better than the ones before. Keep it up.`:d<=-5?`Your latest quizzes are ${-d} points lower than the ones before. Read each explanation and slow down.`:'Your recent scores are steady.');}
 if(A.bank.length){ins.push(`Weakest topic: ${esc(A.bank[0].topic)} (${A.bank[0].p}%).`);if(A.bank.length>1){const b=A.bank[A.bank.length-1];ins.push(`Strongest topic: ${esc(b.topic)} (${b.p}%).`);}}
 const secs=ss.reduce((a,s)=>a+(s.durationSeconds||0),0);if(answered)ins.push(`Average pace: ${Math.round(secs/answered)} seconds per question.`);
 if(S.questions.length){const cov=S.questions.filter(q=>(S.seen||{})[q.id]).length;ins.push(`You have met ${cov} of the ${S.questions.length} questions set for you. Unseen questions come first and recent ones rest, so a retry gives you a different set.`);}
 $('anaInsights').innerHTML=ins.map(x=>`<li>${x}</li>`).join('');
}
function renderTopicReport(res){
 const tl=res.topics.map(x=>({...x,p:pct(x.correct,x.total)})).sort((a,b)=>a.p-b.p),weak=tl.filter(x=>x.p<WEAK),wb=weak.filter(x=>!isDrill(x.topic)),wn=$('weakNote');
 $('topicRep').innerHTML=topicRows(tl);
 if(weak.length){wn.className='mq-weak';wn.innerHTML=`<b>Topics you did not do well in</b><p>${weak.map(x=>`${esc(x.topic)} (${x.p}%, ${x.correct}/${x.total})`).join('; ')}. Read the explanations below, then practise again. Every quiz has ${TOPIC_N} questions, and you will get fresh ones each time.</p>${wb.map(x=>`<button class="btn" type="button" data-weak="${esc(x.topic)}">Practise ${esc(x.topic)}</button>`).join('')}`;}
 else{wn.className='mq-weak ok';wn.innerHTML=`<b>Well done</b><p>You scored ${WEAK}% or more in every topic in this quiz.</p>`;}
}
function updateRule(){const all=$('qzTopic').value==='all';$('qzRule').innerHTML=all?`<b>All topics</b> gives you <b>${ALL_N} questions</b> picked at random across your topics, with extra from topics you find hard.`:`<b>One topic</b> gives you <b>${TOPIC_N} questions</b> picked at random from that topic only.`;}
$('qzTopic').addEventListener('change',updateRule);
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-weak]');if(b)startBank(b.dataset.weak);});

/* ---------- Mental maths generator ---------- */
function genDrill(op,lvl){
 if(op==='mix')op=['+','−','×','÷'][rnd(0,3)];
 const R={easy:[2,12],medium:[11,99],hard:[101,999]}[lvl];let a,b,ans;
 if(op==='+'){a=rnd(R[0],R[1]);b=rnd(R[0],R[1]);ans=a+b;}
 else if(op==='−'){a=rnd(R[0],R[1]);b=rnd(R[0],R[1]);if(b>a)[a,b]=[b,a];ans=a-b;}
 else if(op==='×'){[a,b]=lvl==='easy'?[rnd(2,12),rnd(2,12)]:lvl==='medium'?[rnd(11,30),rnd(3,12)]:[rnd(21,99),rnd(6,19)];ans=a*b;}
 else{b=rnd(2,lvl==='easy'?12:lvl==='medium'?15:25);ans=rnd(2,lvl==='easy'?12:lvl==='medium'?25:60);a=b*ans;}
 const set=new Set(),pool=shuffle([ans+1,ans-1,ans+2,ans-2,ans+10,ans-10,ans+(op==='×'?b:5),ans-(op==='×'?a:5),Number(String(ans).split('').reverse().join(''))]);
 for(const c of pool){if(set.size>=3)break;if(c!==ans&&c>=0)set.add(c);}
 let k=3;while(set.size<3){const c=ans+k++;if(c!==ans)set.add(c);}
 const sym={'+':'+','−':'−','×':'×','÷':'÷'}[op];
 return {text:`${a} ${sym} ${b} = ?`,exp:`${a} ${sym} ${b} = ${ans}.`,topic:'Mental maths: '+({'+':'Addition','−':'Subtraction','×':'Multiplication','÷':'Division'}[op]),opts:shuffle([{t:String(ans),ok:true},...[...set].map(n=>({t:String(n),ok:false}))])};
}

/* ---------- Quiz engine ---------- */
/* Logical, random selection of 20.
   Tier 0 = never answered (random order). Tier 1 = answered wrong before and now rested (oldest first).
   Tier 2 = answered right before and rested (oldest first). Tier 3 = in the cool-down: among the last 2 quizzes' worth of questions.
   Up to 20% of a quiz revisits missed questions; the rest is unseen first, then the longest-rested.
   All topics: slots are shared across topics by weight (hard topics count double), so no topic is missing and none dominates. */
function alloc(left,topics,w,cap){
 const a={};topics.forEach(t=>{a[t]=0;});let rem=left,act=topics.filter(t=>cap[t]>0);
 while(rem>0&&act.length){
  const sw=act.reduce((x,t)=>x+w[t],0),sh=act.map(t=>({t,x:rem*w[t]/sw}));let given=0;
  sh.forEach(o=>{const g=Math.min(Math.floor(o.x),cap[o.t]-a[o.t]);a[o.t]+=g;given+=g;o.f=o.x-Math.floor(o.x)+Math.random()*1e-6;});
  let r2=rem-given;sh.sort((p,q)=>q.f-p.f);
  for(const o of sh){if(r2<=0)break;if(a[o.t]<cap[o.t]){a[o.t]++;r2--;given++;}}
  if(!given)break;rem-=given;act=act.filter(t=>a[t]<cap[t]);
 }
 return a;
}
function pickSet(pool,n,balanced){
 const H=history();
 if(pool.length<=n)return {set:[...pool],repeats:0};
 const seen=pool.filter(q=>H[q.id]).sort((a,b)=>H[b.id].t-H[a.id].t),rank={};seen.forEach((q,i)=>{rank[q.id]=i;});
 const COOL=n*2,tier=q=>!H[q.id]?0:rank[q.id]<COOL?3:H[q.id].w?1:2;
 const jit=a=>a.map(q=>[-(rank[q.id]+Math.random()*Math.max(4,n/2)),q]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
 const T=[[],[],[],[]];pool.forEach(q=>T[tier(q)].push(q));
 T[0]=shuffle(T[0]);T[1]=jit(T[1]);T[2]=jit(T[2]);T[3]=jit(T[3]);
 const out=[],used=new Set(),add=q=>{if(!used.has(q.id)){used.add(q.id);out.push(q);}};
 T[1].slice(0,Math.floor(n*.2)).forEach(add);
 const rest=[...T[0],...T[1],...T[2],...T[3]].filter(q=>!used.has(q.id)),left=n-out.length;
 if(!balanced)rest.slice(0,left).forEach(add);
 else{
  const by={};rest.forEach(q=>{(by[q.topic]=by[q.topic]||[]).push(q);});
  const weak=new Set(analyse(S.sessions).bank.filter(x=>x.p<WEAK&&x.total>=3).map(x=>x.topic)),topics=Object.keys(by),w={},cap={};
  topics.forEach(t=>{w[t]=1+(weak.has(t)?1:0)+(by[t].some(q=>!H[q.id])?.5:0);cap[t]=by[t].length;});
  const a=alloc(left,topics,w,cap);
  topics.forEach(t=>by[t].slice(0,a[t]).forEach(add));
  if(out.length<n)rest.forEach(q=>{if(out.length<n)add(q);});
 }
 return {set:out,repeats:out.filter(q=>tier(q)===3).length};
}
function startBank(topic){
 const all=topic==='all',want=all?ALL_N:TOPIC_N,pool=S.questions.filter(q=>all||q.topic===topic);
 if(!pool.length){$('bankMsg').textContent='No questions have been set for you on that topic yet. Try another topic or the mental maths drill.';show('dashView');return;}
 $('bankMsg').textContent='';
 const pk=pickSet(pool,want,all),set=shuffle(pk.set),n=set.length;
 const items=set.map(q=>({id:q.id,text:q.text,exp:q.explanation,topic:q.topic,opts:shuffle(q.options.map((t,i)=>({t,ok:i===q.answer})))}));
 const note=n<want?`Only ${n} question${n===1?' is':'s are'} available ${all?'across your topics':'on this topic'} so far, so this quiz has ${n}.`:pk.repeats?`Only ${pool.length} questions are set${all?'':' on this topic'}, so ${pk.repeats} of these ${n} were in your recent quizzes.`:pool.length>n?`These ${n} questions were drawn at random from ${pool.length}. Ones from your recent quizzes were left out, and some you missed before are back for another try.`:'';
 begin({title:`${all?'All topics':topic} · ${n} questions`,kind:'bank',topic:all?'Mixed':topic,level:'',items,note,again:()=>startBank(topic)});
}
$('bankForm').addEventListener('submit',e=>{e.preventDefault();startBank($('qzTopic').value);});
$('drillForm').addEventListener('submit',e=>{e.preventDefault();
 const op=$('drOp').value,lvl=$('drLvl').value,n=+$('drCount').value,names={mix:'Mixed','+':'Addition','−':'Subtraction','×':'Multiplication','÷':'Division'};
 const items=Array.from({length:n},()=>genDrill(op,lvl));
 begin({title:`Mental maths · ${names[op]} · ${lvl}`,kind:'drill',topic:'Mental maths',level:lvl,items,again:()=>$('drillForm').requestSubmit()});});

function begin(q){S.quiz={...q,i:0,answers:[],startedAt:Date.now(),done:false};$('quizTitle').textContent=q.title;{const nn=$('quizNote');nn.textContent=q.note||'';nn.classList.toggle('hidden',!q.note);}show('quizView');stopTimer();$('timer').textContent='00:00';S.timer=setInterval(()=>{$('timer').textContent=clock(Math.floor((Date.now()-S.quiz.startedAt)/1000));},500);coach('Take your time. Read the question carefully, then choose.');renderQ();}
function stopTimer(){clearInterval(S.timer);S.timer=null;}
function renderQ(){
 const Q=S.quiz,it=Q.items[Q.i],n=Q.items.length;
 $('counter').textContent=`Question ${Q.i+1} of ${n}`;$('bar').style.width=(Q.i/n*100)+'%';$('qText').innerHTML=fmt(it.text);
 $('opts').innerHTML=it.opts.map((o,k)=>`<button type="button" class="mq-opt" data-k="${k}"><b>${LET[k]}</b><span>${fmt(o.t)}</span></button>`).join('');
 $('opts').querySelectorAll('.mq-opt').forEach(b=>b.onclick=()=>choose(+b.dataset.k));
 $('fb').classList.add('hidden');$('nextBtn').classList.add('hidden');stopSay();
 const first=$('opts').querySelector('.mq-opt');if(first)first.focus({preventScroll:true});
}
const PRAISE=['Excellent!','Spot on!','Great thinking!','Correct, well done!','Yes! Keep going!'];
function choose(k){
 const Q=S.quiz;if(!Q||Q.answers[Q.i]!==undefined)return;const it=Q.items[Q.i],ok=!!it.opts[k].ok,right=it.opts.findIndex(o=>o.ok);
 Q.answers[Q.i]=k;
 if(Q.kind==='bank'&&it.id){S.seen=S.seen||{};S.wrong=S.wrong||{};S.seen[it.id]=Date.now();if(ok)delete S.wrong[it.id];else S.wrong[it.id]=1;seenSave(S.seen);wrongSave(S.wrong);}
 $('opts').querySelectorAll('.mq-opt').forEach((b,i)=>{b.disabled=true;if(i===right)b.classList.add('ok');else if(i===k)b.classList.add('no');else b.classList.add('dim');});
 const fb=$('fb');fb.className='mq-fb '+(ok?'good':'bad');
 fb.innerHTML=(ok?`<b>${PRAISE[rnd(0,PRAISE.length-1)]}</b> `:`<b>Not quite.</b> The correct answer is <b>${LET[right]}. ${fmt(it.opts[right].t)}</b>. `)+(it.exp?fmt(it.exp):'');
 fb.insertAdjacentHTML('beforeend','<div style="margin-top:10px"><button class="btn" type="button" data-explain style="padding:7px 13px;font-size:13px">🔊 Explain this to me</button></div>');
 coach(ok?'That is right! Keep it up.':'Good try. Read the explanation, then move on.');
 const last=Q.i===Q.items.length-1;$('nextBtn').textContent=last?'See my results':'Next question';$('nextBtn').classList.remove('hidden');$('nextBtn').focus({preventScroll:true});
}
function next(){const Q=S.quiz;if(!Q||Q.answers[Q.i]===undefined)return;if(Q.i>=Q.items.length-1)return finish();Q.i++;renderQ();}
$('nextBtn').onclick=next;
$('readBtn').onclick=()=>{const it=S.quiz&&S.quiz.items[S.quiz.i];if(it)say(it.text+'. '+it.opts.map((o,k)=>`${LET[k]}. ${o.t}`).join('. '));};
$('quitBtn').onclick=()=>{if(S.quiz&&S.quiz.answers.length&&!confirm('Leave this quiz? Your answers will not be saved.'))return;stopTimer();stopSay();S.quiz=null;show('dashView');};
document.addEventListener('keydown',e=>{if($('quizView').classList.contains('hidden')||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase(),idx='1234'.indexOf(k)>=0?'1234'.indexOf(k):'abcd'.indexOf(k);
 if(k.length===1&&idx>=0){const Q=S.quiz;if(Q&&idx<Q.items[Q.i].opts.length){e.preventDefault();choose(idx);}}
 else if(k==='enter'&&!$('nextBtn').classList.contains('hidden')&&e.target.id!=='nextBtn'){e.preventDefault();next();}});

/* ---------- Results ---------- */
async function finish(){
 const Q=S.quiz;if(!Q||Q.done)return;stopTimer();stopSay();Q.done=true;
 const total=Q.items.length,correct=Q.items.reduce((a,it,i)=>a+(it.opts[Q.answers[i]]&&it.opts[Q.answers[i]].ok?1:0),0),score=Math.round(correct/total*100),secs=Math.max(1,Math.round((Date.now()-Q.startedAt)/1000));
 const res={id:'s_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),studentId:S.student.id,deviceId:devId(),studentName:S.student.name||'Learner',title:Q.title,kind:Q.kind,topic:Q.topic||'',level:Q.level||'',total,correct,score,durationSeconds:secs,completedAt:Date.now(),
  answers:Q.items.map((it,i)=>({q:it.text,chosen:it.opts[Q.answers[i]]?it.opts[Q.answers[i]].t:'',correct:(it.opts.find(o=>o.ok)||{}).t||'',ok:!!(it.opts[Q.answers[i]]&&it.opts[Q.answers[i]].ok),exp:it.exp||'',topic:it.topic||''}))};
 if(Q.kind==='bank'){res.qids=Q.items.map(it=>it.id);const wr=Q.items.filter((it,i)=>!(it.opts[Q.answers[i]]&&it.opts[Q.answers[i]].ok)).map(it=>it.id);if(wr.length)res.qwrong=wr;}
 const tmap={};Q.items.forEach((it,i)=>{const t=it.topic||'General',ok=!!(it.opts[Q.answers[i]]&&it.opts[Q.answers[i]].ok),o=tmap[t]||(tmap[t]={topic:t,correct:0,total:0});o.total++;if(ok)o.correct++;});res.topics=Object.values(tmap);
 S.last=res;show('resultView');
 $('ring').style.setProperty('--p',score);$('ringTxt').textContent=score+'%';
 const msg=score>=90?'Outstanding work!':score>=70?'Great job!':score>=50?'Good effort. Keep practising!':'Every expert starts here. Try again!';
 $('resTitle').textContent=msg;$('resSub').textContent=`${correct} of ${total} correct in ${clock(secs)} · ${Q.title}`;
 coach(score>=70?'Brilliant result! Ready for another one?':'Review the answers below, then try again. You can do it.');
 renderTopicReport(res);$('walkBtn').classList.toggle('hidden',!res.answers.some(a=>!a.ok));
 $('review').innerHTML=res.answers.map((a,i)=>`<details class="${a.ok?'ok':'no'}" ${a.ok?'':'open'}><summary><span>${a.ok?'✓':'✗'}</span>${i+1}. ${fmt(a.q)}</summary><div class="body"><div>Your answer: <b>${fmt(a.chosen||'—')}</b></div>${a.ok?'':`<div>Correct answer: <b>${fmt(a.correct)}</b></div>`}${a.exp?`<div style="margin-top:6px">${fmt(a.exp)}</div>`:''}</div></details>`).join('');
 const sm=$('saveMsg');sm.className='mq-msg';
 if(S.student.demo){sm.textContent='Demo result: not saved.';}
 else{try{const {answers,...summary}=res,up={};up['mathQuiz/sessions/'+res.id]=summary;up['mathQuiz/sessionAnswers/'+res.id]={studentId:res.studentId,answers};await root.update(up);S.sessions.unshift(summary);sm.textContent='Result saved to your history.';sm.classList.add('good');}catch(e){console.error(e);sm.textContent='Could not save this result. Check your connection and database rules.';}}
}
$('againBtn').onclick=()=>{if(S.quiz&&S.quiz.again)S.quiz.again();};
$('homeBtn').onclick=()=>{stopSay();S.quiz=null;renderDash();show('dashView');};
$('sayBtn').onclick=()=>{const r=S.last;if(!r)return;const wrong=r.answers.filter(a=>!a.ok).length;say(`You answered ${r.correct} out of ${r.total} questions correctly, which is ${r.score} percent. ${wrong?`There ${wrong===1?'is one question':'are '+wrong+' questions'} to review. Read each explanation, then try again.`:'You got every question right. Fantastic!'}`);};
window.addEventListener('pagehide',stopSay);

if($('introBtn'))$('introBtn').onclick=()=>{say($('introText').textContent);coach('Nice to meet you! Enter your passcode when you are ready.');};
/* ---------- Coach Reed: guide, Q&A, auto introduction, mistake walkthrough ---------- */
const KB=[[/passcode|log ?in|sign ?in|password|email|device/,'Your administrator gives you an email address and a password. Type them on the sign in page and press Sign in. Your account works on one device only. If you change device, press Request device change and your administrator will approve it.'],[/demo|free|trial/,'Press Try the free demo on the sign in page. It shows sample questions only and does not save your scores.'],[/20|how many|all topics|one topic|topic quiz/,'Every quiz has 20 questions, whether you pick one topic or all topics. The questions are picked at random, skipping ones you answered recently and bringing back some you missed. If fewer than 20 are set, the quiz uses what is there.'],[/drill|mental|speed/,'The mental maths drill makes fresh questions every time. Pick the operation, the difficulty and 10, 15 or 20 questions.'],[/result|score|analy|weak|performance|progress|improve/,'After every quiz you see your score, your result by topic, and your weak topics. The dashboard keeps your averages and your last 10 quizzes. Use Walk me through my mistakes to go over every question you missed.'],[/mistake|wrong|fail|review/,'Press Walk me through my mistakes on your results, or Review mistakes beside any recent quiz on the dashboard. I will go through each missed question with its explanation.'],[/read aloud|listen|voice|hear|speak|sound|audio/,'Press Read aloud to hear a question, Explain this to me to hear an explanation, or Replay on my card to hear me again. If you hear nothing, check your volume.'],[/key|shortcut/,'Press 1 to 4 or A to D to answer, and Enter for the next question.'],[/save|history|record/,'Every finished quiz is saved to your history, except in the demo.'],[/time|timer/,'The timer counts up so you can see your pace. There is no time limit.'],[/retry|again|repeat|different/,'Try again gives a new random set. Questions you have not seen come first, and ones from your last quizzes are kept out.'],[/leave|quit|exit/,'Press Leave quiz at the top. Your answers for that quiz will not be saved.'],[/subscri|price|cost|pay|fee/,'Each programme costs 10,000 naira per student per year. Open Subscription from the top menu to send your request on WhatsApp.'],[/who are you|your name|hello|hi\b|hey/,'I am Coach Reed, your MathCloud guide. Ask me how the app works or about a maths idea.'],[/what next|where|start|begin|guide|how do i|how does/,'Step 1: choose a quiz on your dashboard. Step 2: answer each question and read the explanation. Step 3: review your results and practise weak topics.']];
const CONCEPTS=[[/lcm|lowest common multiple/,'The LCM is the smallest number both numbers divide into. List multiples of each and take the first shared one. The LCM of 4 and 6 is 12.'],[/hcf|gcf|highest common factor/,'The HCF is the biggest number that divides both exactly. The HCF of 18 and 24 is 6.'],[/fraction/,'To add fractions, make the bottoms equal, then add the tops: 1/2 + 1/4 = 2/4 + 1/4 = 3/4. To multiply, multiply tops and bottoms.'],[/percent|%/,'Percent means out of 100. For 25% of 80, divide 80 by 100 then multiply by 25 to get 20.'],[/ratio|proportion/,'Add the ratio parts, divide the amount by the total parts to get one part, then multiply. Share 900 in 2 : 3 gives one part 180, so 360 and 540.'],[/mean of|average|\bmean\b/,'Mean: add all the values and divide by how many there are.'],[/median/,'Median: order the values and take the middle one.'],[/\bmode\b/,'Mode is the value that appears most often.'],[/\brange\b/,'Range is the largest value minus the smallest.'],[/pythag|hypotenuse/,'a squared plus b squared equals c squared, where c is the longest side. For 6 and 8: 36 + 64 = 100, so c is 10.'],[/area|perimeter/,'Perimeter is the distance around. Area is the space inside: rectangle length times width, triangle half base times height, circle pi r squared.'],[/probab/,'Probability is wanted outcomes divided by all equally likely outcomes. A fair coin gives a head with probability 1/2.'],[/algebra|equation|solve/,'Do the same thing to both sides. For 3x + 5 = 20, subtract 5 to get 3x = 15, then divide by 3 to get x = 5.'],[/indices|power|index|standard form/,'Multiply powers of one base by adding indices. A power of a power multiplies them. Any non-zero number to the power 0 is 1.'],[/angle|triangle/,'Angles in a triangle add to 180 degrees, on a straight line to 180, around a point to 360.']];
function coachReply(q){
 const t=q.toLowerCase().trim(),Q=S.quiz;if(!t)return 'Ask me about this app or a maths idea.';
 if(Q&&!Q.done&&Q.answers[Q.i]===undefined&&/answer|which one|tell me|hint|help|stuck|solve this/.test(t))return 'I will not give the answer before you try, but here is a hint. Read the question twice, write what is given, work it out on paper, then rule out options that cannot be right. This one is about '+(Q.items[Q.i].topic||'maths')+'.';
 if(Q&&!Q.done&&Q.answers[Q.i]!==undefined&&/explain|why|how|understand/.test(t)){const it=Q.items[Q.i];return 'The correct answer is '+it.opts.find(o=>o.ok).t+'. '+(it.exp||'Work through it step by step to check.');}
 const p=t.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/);if(p)return p[1]+'% of '+p[2]+' is '+(+(p[1]*p[2]/100).toFixed(4))+'. Divide '+p[2]+' by 100, then multiply by '+p[1]+'.';
 const ex=t.replace(/(\d)\s*x\s*(\d)/g,'$1*$2').replace(/divided by|over/g,'/').replace(/plus/g,'+').replace(/minus/g,'-').replace(/times/g,'*').replace(/what is|calculate|work out|equals|[=?,]/g,'').replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/\^/g,'**').trim();
 if(/\d/.test(ex)&&/^[\d\s+\-*/().]+$/.test(ex)&&/[+\-*/]/.test(ex)){try{const v=Function('"use strict";return ('+ex+')')();if(Number.isFinite(v))return ex.replace(/\*\*/g,'^')+' = '+(+v.toFixed(6));}catch(e){}}
 for(const [re,a] of KB)if(re.test(t))return a;
 for(const [re,a] of CONCEPTS)if(re.test(t))return a;
 return 'I can explain how this app works (passcodes, quizzes, drills, results) and maths ideas like fractions, percentages, ratio and algebra. You can also type a sum such as 24 × 15.';
}
function chatAdd(who,t){const l=$('chatLog'),d=document.createElement('div');d.className='mq-msgb '+who;d.textContent=t;l.appendChild(d);l.scrollTop=l.scrollHeight;}
$('chatToggle').onclick=()=>{const c=$('coachChat');c.classList.toggle('hidden');if(!c.classList.contains('hidden')){if(!$('chatLog').children.length)chatAdd('bot','Hi, I am Coach Reed. Ask me how anything works, or a maths question.');$('chatInput').focus();}};
$('chatClose').onclick=()=>$('coachChat').classList.add('hidden');
$('chatForm').addEventListener('submit',e=>{e.preventDefault();const q=$('chatInput').value.trim();if(!q)return;$('chatInput').value='';chatAdd('me',q);const a=coachReply(q);chatAdd('bot',a);say(a);});
$('dockReplay').onclick=()=>{if(lastSaid)say(lastSaid);};
const W={list:[],i:0};
function walkOpen(answers){W.list=(answers||[]).filter(a=>a&&!a.ok);W.i=0;if(!W.list.length){coach('You got everything right. Nothing to review!');return;}stopSay();$('walkModal').classList.remove('hidden');walkStep();}
function walkClose(){$('walkModal').classList.add('hidden');stopSay();}
function walkStep(){
 const n=W.list.length,i=W.i,box=$('walkBody');$('walkPrev').disabled=i===0||i>=n;
 if(i>=n){const by={};W.list.forEach(a=>{const k=a.topic||'General';by[k]=(by[k]||0)+1;});const ls=Object.entries(by).sort((a,b)=>b[1]-a[1]),txt='That is all '+n+' missed question'+(n===1?'':'s')+' reviewed. Topics to practise: '+ls.map(([k,c])=>k+', '+c).join('; ')+'.';
  $('walkCount').textContent='Done';$('walkNext').classList.add('hidden');box.innerHTML='<h3>Review complete 🎉</h3><p>'+esc(txt)+'</p>'+ls.map(([k])=>'<button class="btn primary" type="button" data-weak="'+esc(k)+'" style="margin:4px 6px 4px 0">Practise '+esc(k)+'</button>').join('');say(txt);return;}
 const a=W.list[i];$('walkNext').classList.remove('hidden');$('walkNext').textContent=i===n-1?'Finish':'Next mistake';$('walkCount').textContent='Mistake '+(i+1)+' of '+n;
 box.innerHTML='<span class="mq-tchip low">'+esc(a.topic||'General')+'</span><div class="mq-q">'+fmt(a.q)+'</div><div class="mq-wk"><div class="no"><small>Your answer</small><b>'+fmt(a.chosen||'No answer')+'</b></div><div class="ok"><small>Correct answer</small><b>'+fmt(a.correct)+'</b></div></div><div class="mq-fb good"><b>Why?</b> '+fmt(a.exp||'Work the question again slowly and check each step.')+'</div>';
 say('Question '+(i+1)+' of '+n+' to review. '+a.q+'. You chose '+(a.chosen||'nothing')+'. The correct answer is '+a.correct+'. '+(a.exp||''));
}
$('walkNext').onclick=()=>{W.i++;walkStep();};$('walkPrev').onclick=()=>{if(W.i>0){W.i--;$('walkNext').classList.remove('hidden');walkStep();}};
$('walkClose').onclick=walkClose;$('walkAgain').onclick=()=>{if(W.i<W.list.length)walkStep();else say(lastSaid);};
$('walkModal').addEventListener('click',e=>{if(e.target.closest('[data-weak]'))walkClose();});
$('walkBtn').onclick=()=>{if(S.last)walkOpen(S.last.answers);};
document.addEventListener('click',async e=>{
 const x=e.target.closest&&e.target.closest('[data-explain]');
 if(x&&S.quiz){const it=S.quiz.items[S.quiz.i];say('The correct answer is '+it.opts.find(o=>o.ok).t+'. '+(it.exp||''));return;}
 const w=e.target.closest&&e.target.closest('[data-walk]');
 if(w){w.disabled=true;try{const v=(await R('sessionAnswers/'+w.dataset.walk).once('value')).val();if(v&&v.answers)walkOpen(Array.isArray(v.answers)?v.answers:Object.values(v.answers));else coach('The saved answers for that quiz are not available.');}catch(er){console.error(er);coach('I could not load that quiz. Check your connection.');}w.disabled=false;}
});
/* Introduction speaks as soon as the page loads. Browsers may block sound until the first touch, so we retry on the first tap. */
let introArmed=false;
function armIntro(){if(introArmed)return;introArmed=true;coach('Tap anywhere and I will introduce myself.');const evs=['pointerdown','keydown','touchstart'],once=e=>{evs.forEach(v=>document.removeEventListener(v,once,true));if(e.target.closest&&e.target.closest('#introBtn,#dockReplay'))return;if(!$('loginView').classList.contains('hidden'))say($('introText').textContent);};evs.forEach(v=>document.addEventListener(v,once,true));}
let introDone=false;
function maybeIntro(){if(introDone)return;introDone=true;setTimeout(()=>{if($('introText')&&!S.student&&!$('loginView').classList.contains('hidden')){coach('Hello! Listen to my introduction, then sign in.');say($('introText').textContent,armIntro);}},500);}
if(!auth){toLogin('Firebase is not configured. Check firebase-config.js.');maybeIntro();}
else auth.onAuthStateChanged(user=>{
 if(!user){if(S.student&&S.student.demo)return;const m=PENDING;PENDING='';toLogin(m);maybeIntro();return;}
 admit(user).catch(e=>{console.error(e);fail('Something went wrong while signing in. Please try again.');});
});
})();
