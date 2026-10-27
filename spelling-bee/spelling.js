(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const clock=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const pct=(c,t)=>t?Math.round(c/t*100):0,WEAK=60,TEST_N=20;
const verdict=p=>p>=80?{t:'Strong',c:'good'}:p>=WEAK?{t:'Getting there',c:'mid'}:{t:'Needs work',c:'low'};
let db=null,root=null,auth=null;
if(window.FIREBASE_READY&&window.firebase){try{if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);db=firebase.database();root=db.ref();auth=firebase.auth();}catch(e){console.error(e);}}
const S={student:null,words:[],sessions:[],quiz:null,timer:null,off:[],last:null,hist:{seq:0,w:{}},lastReg:null};
const SP=p=>root.child('spelling/'+p);
function show(v){['loginView','dashView','testView','resultView'].forEach(id=>$(id).classList.toggle('hidden',id!==v));$('logoutBtn').classList.toggle('hidden',v==='loginView');window.scrollTo({top:0,behavior:'smooth'});}
function coach(t){$('dockSays').textContent=t;}
/* The word is never shown on screen during a test: clues replace it (and its stem) with blanks. */
function mask(t,w){const stem=String(w).slice(0,Math.max(3,w.length-2)).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return String(t||'').replace(new RegExp('\\b'+stem+'\\w*','gi'),'_____');}
/* ---------- Voice ---------- */
let voice=null,lastSaid='';
if('speechSynthesis' in window)speechSynthesis.onvoiceschanged=()=>{voice=null;};
function pickVoice(){if(voice||!('speechSynthesis' in window))return voice;const sc=v=>{const n=(v.name||'').toLowerCase(),l=(v.lang||'').toLowerCase();let s=0;if(/natural|neural|online/.test(n))s+=100;if(/aria|jenny|sonia|zira|samantha|victoria|serena|hazel|libby|natasha|ava|allison|karen|moira|tessa|female|woman/.test(n))s+=120;if(/en-ng/.test(l))s+=25;else if(/en-gb/.test(l))s+=20;else if(/en-us/.test(l))s+=15;return s;};return voice=speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)).sort((a,b)=>sc(b)-sc(a))[0]||null;}
function say(t,blocked,rate){if(!('speechSynthesis' in window)){coach('Read-aloud is not supported in this browser.');return;}lastSaid=t;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t),v=pickVoice();if(v){u.voice=v;u.lang=v.lang;}u.rate=rate||.9;u.onstart=()=>$('dock').classList.add('speaking');u.onend=()=>$('dock').classList.remove('speaking');u.onerror=e=>{$('dock').classList.remove('speaking');if(blocked&&e&&e.error==='not-allowed')blocked();};speechSynthesis.speak(u);if(blocked)setTimeout(()=>{if(!speechSynthesis.speaking)blocked();},1500);}
function stopSay(){if('speechSynthesis' in window)speechSynthesis.cancel();$('dock').classList.remove('speaking');}
const letters=w=>w.toUpperCase().split('').join(', ');
/* ---------- Login ---------- */
const err=t=>{$('loginError').textContent=t;};
async function login(email,password,silent){
 if(!db||!auth){err('Firebase Authentication is not configured.');return;}
 try {
  const cred=await auth.signInWithEmailAndPassword(email,password), user=cred.user;
  const snap=await SP('students/'+user.uid).once('value'), profile=snap.val();
  if(!profile||profile.active===false){await auth.signOut();err('Your spelling account is inactive or not assigned. Contact your teacher.');return;}
  const deviceKey='spelling-device-v1', deviceId=localStorage.getItem(deviceKey)||([1,2,3,4].map(()=>Math.random().toString(36).slice(2)).join(''));
  localStorage.setItem(deviceKey,deviceId);
  const lockRef=SP('deviceLocks/'+user.uid);let lockError='';
  await lockRef.transaction(cur=>{if(!cur||cur.unlocked===true||cur.deviceId===deviceId)return {deviceId,unlocked:false,updatedAt:Date.now()};return;},(error,committed,snap2)=>{if(error)lockError='Unable to verify device lock.';else if(!committed)lockError='This account is active or locked to another device. Contact the administrator on WhatsApp to request a device change.';});
  if(lockError){await auth.signOut();err(lockError);return;}
  S.student={id:user.uid,uid:user.uid,name:profile.name||user.displayName||user.email,classId:profile.classId||'',className:profile.className||'',demo:false,email:user.email,deviceId};
  sessionStorage.setItem('spellingSignedIn','1');enter();
 }catch(e){console.error(e);err(e.code==='auth/invalid-credential'||e.code==='auth/wrong-password'||e.code==='auth/user-not-found'?'Email or password is incorrect.':e.message||'Unable to sign in.');}
}
$('loginForm').addEventListener('submit',e=>{e.preventDefault();err('');login($('studentEmail').value.trim(),$('studentPassword').value).catch(x=>{console.error(x);err('Unable to connect. Check your internet and Firebase settings.');});});
$('demoLoginBtn').onclick=()=>{S.student={id:'demo',name:'Demo Student',className:'Free Demo',demo:true};enter();};
$('logoutBtn').onclick=async()=>{if(S.student&&!S.student.demo&&S.student.deviceId&&db){try{await SP('deviceLocks/'+S.student.id).transaction(cur=>cur&&cur.deviceId===S.student.deviceId?null:cur);}catch(e){console.warn(e);}}if(auth)await auth.signOut().catch(()=>{});sessionStorage.removeItem('spellingSignedIn');stopFeed();stopTimer();stopSay();S.student=null;S.sessions=[];S.words=[];S.quiz=null;S.hist={seq:0,w:{}};S.lastReg=null;show('loginView');coach('Choose a register when you are ready.');};
/* ---------- Words feed ---------- */
function clean(id,w){if(!w||typeof w!=='object'||w.status==='draft')return null;const word=String(w.word||'').replace(/[\u2018\u2019`\u00b4]/g,"'").replace(/\s+/g,' ').trim().toLowerCase();if(!/^[a-z'\- ]{2,40}$/.test(word))return null;return {id,word,register:String(w.register||'General').replace(/\s+/g,' ').trim()||'General',def:String(w.definition||'').trim(),sen:String(w.sentence||'').trim(),origin:String(w.origin||'').trim()};}
function demoBank(){const o={};(window.SP_WORDS||[]).forEach((r,i)=>{o['demo_'+String(i+1).padStart(3,'0')]={word:r[0],register:r[1],definition:r[2],sentence:r[3],origin:r[4],demo:true,status:'published',createdAt:Date.now()};});return o;}
function startFeed(){stopFeed();S.feedErr='';const s=S.student,F={a:{},b:{},c:{}};let busy=false;
 const rebuild=()=>{const m={};[F.a,F.b,F.c].forEach(src=>Object.entries(src).forEach(([id,w])=>{const c=clean(id,w);if(c)m[id]=c;}));const canon={};Object.values(m).forEach(c=>{const k=c.register.toLowerCase();if(!canon[k]||(/[A-Z]/.test(c.register)&&!/[A-Z]/.test(canon[k])))canon[k]=c.register;});Object.values(m).forEach(c=>{c.register=canon[c.register.toLowerCase()];});S.words=Object.values(m);if(!$('dashView').classList.contains('hidden'))renderDash();};
 const onErr=e=>{console.error(e);if(s.demo&&!Object.keys(F.a).length){F.a=demoBank();rebuild();return;}S.feedErr=String(e&&e.message||e||'error');if(!$('dashView').classList.contains('hidden'))renderDash();else $('bankInfo').textContent='Could not load words.';diagnose();};
 const watch=(q,fn)=>{q.on('value',fn,onErr);S.off.push(()=>q.off('value',fn));};

 /* Self-healing + evidence: read the whole bank once, pick this student's words locally, and say exactly why none are visible. */
 const diagnose=async()=>{if(busy||s.demo||S.student!==s)return;busy=true;const d=$('diag'),say=h=>{if(!d)return;d.className='mq-weak';d.innerHTML=h;};
  try{const prof=(await SP('students/'+s.id).once('value')).val()||{},cid=prof.classId||'';
   if(cid!==s.classId){s.classId=cid;s.className=prof.className||s.className;}
   const all=(await SP('words').once('value')).val()||{},ids=Object.keys(all),mine={};
   ids.forEach(k=>{const w=all[k];if(w&&((cid&&w.classId===cid)||w.studentId===s.id))mine[k]=w;});
   if(Object.keys(mine).length){F.c=mine;S.feedErr='';rebuild();}
   if(S.words.length){if(d)d.className='hidden';return;}
   const nm=Object.keys(mine).length,drafts=Object.values(mine).filter(w=>w.status==='draft').length;
   if(!ids.length)say('<b>Why you see no words</b><p>The word bank is empty. Your teacher has not added any words yet.</p>');
   else if(!cid)say('<b>Why you see no words</b><p>Your account is not assigned to a class ('+ids.length+' words exist in the system). Ask your teacher to assign you to a class.</p>');
   else if(!nm)say('<b>Why you see no words</b><p>'+ids.length+' words exist, but none are assigned to your class ('+esc(prof.className||cid)+') or to you personally. Your teacher must open the admin page, choose <b>Class: '+esc(prof.className||'your class')+'</b> in Word bank, then add or upload words.</p>');
   else say('<b>Why you see no words</b><p>'+nm+' words are assigned to you, but '+(drafts?drafts+' are drafts and ':'')+'the rest have invalid spelling characters (only letters, hyphen, apostrophe and space are allowed). Ask your teacher to correct them.</p>');
  }catch(e){console.error(e);if(d){d.className='mq-weak';d.innerHTML='<b>The database refused access</b><p>'+esc(e&&e.message||e)+'. Your teacher must publish the latest <b>database.rules.json</b> in Firebase (Realtime Database, Rules, Publish).</p>';}}
  finally{setTimeout(()=>{busy=false;},4000);}};
 setTimeout(()=>{if(S.student===s&&!S.words.length)diagnose();},2500);
 if(s.demo){F.a=demoBank();rebuild();}
 else{if(s.classId)watch(SP('words').orderByChild('classId').equalTo(s.classId),sn=>{F.a=sn.val()||{};rebuild();});watch(SP('words').orderByChild('studentId').equalTo(s.id),sn=>{F.b=sn.val()||{};rebuild();});}}
function stopFeed(){S.off.splice(0).forEach(f=>{try{f();}catch(e){}});}
async function enter(){const me=S.student;$('studentName').textContent=me.name||'Learner';show('dashView');startFeed();
 try{S.sessions=me.demo?[]:Object.entries((await SP('sessions').orderByChild('studentId').equalTo(me.id).once('value')).val()||{}).map(([id,v])=>({id,...v})).sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));}catch(e){console.error(e);S.sessions=[];}
 if(S.student!==me)return;await loadHist();if(S.student!==me)return;renderDash();coach('Choose a register and press Start test.');
 say('Welcome '+(me.demo?'to the free demo':(me.name||'Learner'))+'. Choose a word register, press Start test, and I will say each word. Type it on the keypad. Use the clue buttons if you need help.');}
/* ---------- Dashboard and analysis ---------- */
function regRows(list){return list.length?list.map(x=>{const p=pct(x.correct,x.total),v=verdict(p);return `<div class="mq-trow"><div class="mq-tname"><b>${esc(x.register)}</b><small>${x.correct}/${x.total} correct</small></div><div class="mq-tbar"><i class="${v.c}" style="width:${p}%"></i></div><span class="mq-tchip ${v.c}">${p}% · ${v.t}</span></div>`;}).join(''):'<p class="mq-muted">No data yet.</p>';}
function analyse(ss){const m={};ss.forEach(s=>{(Array.isArray(s.registers)?s.registers:Object.values(s.registers||{})).forEach(x=>{if(!x||!x.register)return;const o=m[x.register]||(m[x.register]={register:x.register,correct:0,total:0});o.correct+=x.correct||0;o.total+=x.total||0;});});return Object.values(m).sort((a,b)=>pct(a.correct,a.total)-pct(b.correct,b.total));}
function renderDash(){
 const ws=S.words,ss=S.sessions,regs={};ws.forEach(w=>{regs[w.register]=(regs[w.register]||0)+1;});
 drawRegCards(regs);
 $('bankInfo').textContent=(S.student.className?S.student.className+' · ':'')+(ws.length?`${ws.length} words across ${Object.keys(regs).length} register${Object.keys(regs).length===1?'':'s'} are ready for you.`:(S.feedErr?'Could not load your words ('+S.feedErr+'). Please tell your teacher: the database rules must be published.':(!S.student.classId&&!S.student.demo)?'You are not assigned to a class yet. Ask your teacher to assign you to a class.':'No words have been set for you yet. Ask your teacher.'));
 const avg=ss.length?Math.round(ss.reduce((a,s)=>a+(s.score||0),0)/ss.length):null;
 $('mTaken').textContent=ss.length;$('mAvg').textContent=avg===null?'—':avg+'%';$('mBest').textContent=ss.length?Math.max(...ss.map(s=>s.score||0))+'%':'—';$('mAnswered').textContent=ss.reduce((a,s)=>a+(s.total||0),0);
 $('history').innerHTML=ss.length?ss.slice(0,8).map(s=>`<div class="mq-row"><div><b>${esc(s.title||'Test')}</b><small>${new Date(s.completedAt||Date.now()).toLocaleString([],{dateStyle:'medium',timeStyle:'short'})} · ${s.correct||0}/${s.total||0} correct · ${clock(s.durationSeconds||0)}</small></div><span class="mq-chip ${s.score>=70?'high':s.score<40?'low':''}">${Math.round(s.score||0)}%</span></div>`).join(''):'<p class="mq-muted">Finished tests appear here.</p>';
 const A=analyse(ss),weak=A.filter(x=>pct(x.correct,x.total)<WEAK&&x.total>=3);
 $('anaLead').textContent=S.student.demo?'The demo does not save results.':ss.length?`Based on ${ss.length} test${ss.length===1?'':'s'}. Strong is 80% or more, needs work is below ${WEAK}%.`:'Finish a test and your strong and weak registers appear here.';
 $('anaReg').innerHTML=regRows(A);const w=$('anaWeak');
 if(weak.length){w.className='mq-weak';w.innerHTML=`<b>Registers to practise</b><p>${weak.map(x=>esc(x.register)+' ('+pct(x.correct,x.total)+'%)').join('; ')}.</p>${weak.slice(0,3).map(x=>`<button class="btn primary" type="button" data-reg="${esc(x.register)}">Practise ${esc(x.register)}</button>`).join('')}`;}else{w.className='hidden';w.innerHTML='';}
 updateRule();}
function updateRule(){$('rule').innerHTML='Each test has <b>'+TEST_N+' words</b>. New and previously missed words come first; words you just practised wait their turn.';}
function drawRegCards(regs){const el=$('regCards');if(!el)return;const H=(S.hist&&S.hist.w)||{},by={};
 S.words.forEach(w=>{const o=by[w.register]||(by[w.register]={m:0,t:0});o.t++;const h=H[hkey(w.word)];if(h&&h.n&&h.x===0)o.m++;});
 const names=Object.keys(regs).sort((a,b)=>a.localeCompare(b));
 if(!names.length){el.innerHTML='';return;}
 const card=(label,sub,val,special,bar)=>`<div class="sp-reg${special?' special':''}"><div class="sp-reg-h"><b>${esc(label)}</b></div>${bar===null?'':`<div class="sp-prog"><i style="width:${bar}%"></i></div>`}<small>${sub}</small><button class="btn primary" type="button" data-reg="${esc(val)}">Start test</button></div>`;
 el.innerHTML=(names.length>1?card('📚 All registers',TEST_N+' mixed words from every register','all',true,null)+card('🎲 Surprise me','A random register picked for you','random',true,null):'')
  +names.map(r=>{const o=by[r]||{m:0,t:0},p=pct(o.m,o.t);return card(r,`${o.t} word${o.t===1?'':'s'} · ${o.m} mastered · test uses ${Math.min(o.t,TEST_N)}`,r,false,p);}).join('');
 updateRule();}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-reg]');if(b)start(b.dataset.reg);const sp=e.target.closest&&e.target.closest('[data-spell]');if(sp)say(`${sp.dataset.spell}. Spelled: ${letters(sp.dataset.spell)}. ${sp.dataset.spell}.`,null,.7);});
/* ---------- Smart word selection (spaced rotation) ---------- */
const COOL_OK=3,COOL_MISS=2,REVIEW_SHARE=.25,DEMO_HIST='spelling-demo-history-v1';
const hkey=w=>String(w).trim().toLowerCase().replace(/ /g,'_');
async function loadHist(){const me=S.student;S.hist={seq:0,w:{}};
 try{if(me.demo){const raw=JSON.parse(localStorage.getItem(DEMO_HIST)||'null');if(raw&&raw.w)S.hist={seq:Number(raw.seq)||0,w:raw.w};}
  else{const v=(await SP('wordHistory/'+me.id).once('value')).val();if(v)S.hist={seq:Number(v.seq)||0,w:v.w||{}};}}
 catch(e){console.warn('Word history unavailable; using plain random selection.',e);S.hist={seq:0,w:{}};}}
/* Round-robin across registers so a mixed test is balanced. */
function spread(arr,need){const g={};arr.forEach(w=>{(g[w.register]||(g[w.register]=[])).push(w);});const lists=shuffle(Object.values(g)),out=[];
 while(out.length<need&&lists.some(l=>l.length))lists.forEach(l=>{if(l.length&&out.length<need)out.push(l.shift());});return out;}
/* Preference: (1) a few earlier misses that have rested, (2) words never asked, (3) remaining misses,
   (4) words answered right long ago, (5) recently used words, oldest first, only if nothing else is left. */
function pickWords(pool,n,balance){const H=S.hist||{seq:0,w:{}},seen=new Map();
 pool.forEach(w=>{if(!seen.has(w.word))seen.set(w.word,w);});const list=[...seen.values()];
 if(list.length<=n)return shuffle(list);
 const fresh=[],miss=[],old=[],cool=[],key=new Map();
 list.forEach(w=>{const h=H.w[hkey(w.word)];if(!h||!h.n){fresh.push(w);return;}
  const age=H.seq-(h.s||0),wrong=h.x===1;key.set(w,age+Math.random()*1.5);
  if(wrong&&age>=COOL_MISS)miss.push(w);else if(!wrong&&age>=COOL_OK)old.push(w);else cool.push(w);});
 const oldest=(a,b)=>key.get(b)-key.get(a);miss.sort(oldest);old.sort(oldest);cool.sort(oldest);
 const cap=Math.max(1,Math.round(n*REVIEW_SHARE)),tiers=[miss.slice(0,cap),shuffle(fresh),miss.slice(cap),old,cool],out=[];
 for(const t of tiers){const need=n-out.length;if(need<=0)break;out.push(...(balance?spread(t,need):t.slice(0,need)));}
 return shuffle(out);}
async function recordHist(Q){if(!Q||Q.recorded||!Q.results.length||!S.student)return;Q.recorded=true;
 const H=S.hist||(S.hist={seq:0,w:{}}),seq=H.seq+1,up={seq};
 Q.results.forEach(r=>{const k=hkey(r.word),p=H.w[k]||{},o={s:seq,n:(p.n||0)+1,c:(p.c||0)+(r.ok?1:0),x:r.ok?0:1};H.w[k]=o;up['w/'+k]=o;});H.seq=seq;
 try{if(S.student.demo)localStorage.setItem(DEMO_HIST,JSON.stringify(H));else await SP('wordHistory/'+S.student.id).update(up);}
 catch(e){console.warn('Could not save word history. Deploy the updated database rules.',e);}}
/* ---------- Test engine ---------- */
function start(sel){sel=sel||'all';let reg=sel;
 const regs=[...new Set(S.words.map(w=>w.register))];
 if(sel==='random'){const cnt=r=>S.words.filter(w=>w.register===r).length;let opts=regs.length>1?regs.filter(r=>r!==S.lastReg):regs;const full=opts.filter(r=>cnt(r)>=TEST_N);if(full.length)opts=full;reg=opts[Math.floor(Math.random()*opts.length)];}
 const all=reg==='all',pool=S.words.filter(w=>all||w.register===reg);
 if(!pool.length){$('startMsg').textContent='No words have been set for that register yet.';show('dashView');return;}$('startMsg').textContent='';
 const items=pickWords(pool,TEST_N,all);S.lastReg=all?null:reg;
 S.quiz={title:`${sel==='random'?'🎲 ':''}${all?'All registers':reg} · ${items.length} words`,mode:sel,reg:all?'Mixed':reg,items,i:0,typed:'',results:[],locked:false,startedAt:Date.now(),done:false};
 $('testTitle').textContent=S.quiz.title;show('testView');stopTimer();$('timer').textContent='00:00';S.timer=setInterval(()=>{$('timer').textContent=clock(Math.floor((Date.now()-S.quiz.startedAt)/1000));},500);renderW(true);}
function stopTimer(){clearInterval(S.timer);S.timer=null;}
const cur=()=>S.quiz.items[S.quiz.i];
function drawTyped(){const Q=S.quiz,t=$('typed');t.textContent=Q.typed||'Type the word you hear';t.classList.toggle('ph',!Q.typed);}
function renderW(speak){const Q=S.quiz,n=Q.items.length,it=cur();
 $('counter').textContent=`Word ${Q.i+1} of ${n}`;$('regTag').textContent=it.register;$('bar').style.width=(Q.i/n*100)+'%';
 Q.typed='';Q.locked=false;Q.hint=0;drawTyped();$('clue').classList.add('hidden');$('fb').classList.add('hidden');$('nextBtn').classList.add('hidden');$('checkBtn').classList.remove('hidden');
 $('pad').querySelectorAll('button').forEach(b=>b.disabled=false);coach('Listen carefully, then type the word.');if(speak)say(it.word,null,.8);}
function buildPad(){const rows=['qwertyuiop','asdfghjkl','zxcvbnm'];$('pad').innerHTML=rows.map((r,i)=>`<div class="sp-row">${r.split('').map(k=>`<button type="button" class="sp-key" data-k="${k}">${k.toUpperCase()}</button>`).join('')}${i===2?'<button type="button" class="sp-key w" data-k="back" aria-label="Backspace">⌫</button>':''}</div>`).join('')+'<div class="sp-row"><button type="button" class="sp-key w" data-k="-">-</button><button type="button" class="sp-key w" data-k="\'">\'</button><button type="button" class="sp-key w" data-k="clear">Clear</button></div>';}
function press(k){const Q=S.quiz;if(!Q||Q.locked)return;if(k==='back')Q.typed=Q.typed.slice(0,-1);else if(k==='clear')Q.typed='';else if(Q.typed.length<40)Q.typed+=k;drawTyped();}
$('pad').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(b)press(b.dataset.k);});
/* Physical keyboard is read without any text field, so browser spell-check and autocorrect never see the word. */
document.addEventListener('keydown',e=>{if($('testView').classList.contains('hidden')||e.ctrlKey||e.metaKey||e.altKey)return;const k=e.key;if(/^[a-zA-Z'-]$/.test(k)){e.preventDefault();press(k.toLowerCase());}else if(k==='Backspace'){e.preventDefault();press('back');}else if(k==='Enter'){e.preventDefault();if(!$('nextBtn').classList.contains('hidden'))next();else check();}});
$('hearBtn').onclick=()=>say(cur().word,null,.8);
const clue=(h)=>{const c=$('clue');c.innerHTML=h;c.classList.remove('hidden');};
$('defBtn').onclick=()=>{const it=cur(),t=it.def?mask(it.def,it.word):'No definition was added for this word.';$('clue').classList.add('hidden');coach('Listen to the definition.');say(t.replace(/_____/g,'blank'));};
$('senBtn').onclick=()=>{const it=cur();$('clue').classList.add('hidden');coach('Listen to the sentence.');say(it.sen||'No sentence was added for this word.');};
/* Origin: Coach Reed says only which language the word comes from (never the root word, so the spelling is not given away). */
function originSpeech(it){const o=String(it.origin||'').trim();if(!o)return 'No origin was added for this word.';
 const L=[...new Set((o.match(/\b(Old English|Middle English|Old French|Middle French|Anglo-Norman|Old Norse|Late Latin|Medieval Latin|Latin|Greek|French|German|Dutch|Italian|Spanish|Portuguese|Arabic|Persian|Hindi|Sanskrit|Yoruba|Igbo|Hausa|Norse|Icelandic|Japanese|Turkish|Swahili|English)\b/g)||[]))];
 if(!L.length)return mask(o,it.word).replace(/_____/g,'blank');
 return 'This word comes from '+L[0]+(L.length>1?', and before that from '+L.slice(1).join(' and '):'')+'.'+(/compound/i.test(o)?' It is a compound word, made from two smaller words.':'');}
$('oriBtn').onclick=()=>{$('clue').classList.add('hidden');coach('Listen to where the word comes from.');say(originSpeech(cur()));};
function check(){const Q=S.quiz;if(!Q||Q.locked)return;const it=cur(),typed=Q.typed.trim().toLowerCase();if(!typed){$('fb').className='mq-fb bad';$('fb').textContent='Type a word first.';return;}
 Q.locked=true;const ok=typed===it.word;Q.results.push({word:it.word,register:it.register,typed,ok,def:it.def,sen:it.sen,origin:it.origin});
 $('pad').querySelectorAll('button').forEach(b=>b.disabled=true);$('checkBtn').classList.add('hidden');
 const fb=$('fb');fb.className='mq-fb '+(ok?'good':'bad');
 fb.innerHTML=(ok?'<b>Correct! Well spelled.</b> ':`<b>Not quite.</b> You typed <b>${esc(typed)}</b>. The correct spelling is <span class="sp-letters">${esc(it.word.toUpperCase())}</span>. `)+`<div style="margin-top:8px">${it.def?'<b>Meaning:</b> '+esc(it.def)+'<br>':''}${it.sen?'<b>Sentence:</b> '+esc(it.sen)+'<br>':''}${it.origin?'<b>Origin:</b> '+esc(it.origin):''}</div>`;
 fb.classList.remove('hidden');const last=Q.i===Q.items.length-1;$('nextBtn').textContent=last?'See my results':'Next word';$('nextBtn').classList.remove('hidden');
 coach(ok?'Excellent! Keep going.':'Read the correct spelling, then move on.');say(ok?'Correct! '+it.word+'.':`Not quite. ${it.word} is spelled ${letters(it.word)}.`,null,.8);}
function next(){const Q=S.quiz;if(!Q||!Q.locked)return;if(Q.i>=Q.items.length-1)return finish();Q.i++;renderW(true);}
$('checkBtn').onclick=check;$('nextBtn').onclick=next;
$('quitBtn').onclick=()=>{if(S.quiz&&S.quiz.results.length&&!confirm('Leave this test? Your answers will not be saved.'))return;recordHist(S.quiz);stopTimer();stopSay();S.quiz=null;show('dashView');};
/* ---------- Results ---------- */
async function finish(){const Q=S.quiz;if(!Q||Q.done)return;stopTimer();stopSay();Q.done=true;recordHist(Q);
 const total=Q.results.length,correct=Q.results.filter(r=>r.ok).length,score=pct(correct,total),secs=Math.max(1,Math.round((Date.now()-Q.startedAt)/1000)),m={};
 Q.results.forEach(r=>{const o=m[r.register]||(m[r.register]={register:r.register,correct:0,total:0});o.total++;if(r.ok)o.correct++;});
 const res={id:'sp_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),studentId:S.student.id,studentName:S.student.name||'Learner',title:Q.title,reg:Q.reg,total,correct,score,durationSeconds:secs,completedAt:Date.now(),registers:Object.values(m)};
 S.last={...res,answers:Q.results};show('resultView');$('ring').style.setProperty('--p',score);$('ringTxt').textContent=score+'%';
 $('resTitle').textContent=score>=90?'Outstanding spelling!':score>=70?'Great job!':score>=50?'Good effort. Keep practising!':'Every champion speller starts here. Try again!';
 $('resSub').textContent=`${correct} of ${total} correct in ${clock(secs)} · ${Q.title}`;coach(score>=70?'Brilliant result!':'Review the words below, then try again.');
 const rl=res.registers.map(x=>({...x})).sort((a,b)=>pct(a.correct,a.total)-pct(b.correct,b.total));$('regRep').innerHTML=regRows(rl);
 const weak=rl.filter(x=>pct(x.correct,x.total)<WEAK),wn=$('weakNote');
 if(weak.length){wn.className='mq-weak';wn.innerHTML=`<b>Registers to practise</b><p>${weak.map(x=>esc(x.register)+' ('+pct(x.correct,x.total)+'%)').join('; ')}.</p>${weak.map(x=>`<button class="btn" type="button" data-reg="${esc(x.register)}">Practise ${esc(x.register)}</button>`).join('')}`;}else{wn.className='mq-weak ok';wn.innerHTML='<b>Well done</b><p>Every register in this test is at 60% or more.</p>';}
 $('review').innerHTML=Q.results.map((a,i)=>`<details class="${a.ok?'ok':'no'}" ${a.ok?'':'open'}><summary><span>${a.ok?'✓':'✗'}</span>${i+1}. ${esc(a.word)} <small class="mq-muted">· ${esc(a.register)}</small></summary><div class="body"><div>You typed: <b>${esc(a.typed)}</b></div>${a.ok?'':`<div>Correct spelling: <b class="sp-letters">${esc(a.word.toUpperCase())}</b></div>`}${a.def?`<div style="margin-top:6px"><b>Meaning:</b> ${esc(a.def)}</div>`:''}${a.sen?`<div><b>Sentence:</b> ${esc(a.sen)}</div>`:''}${a.origin?`<div><b>Origin:</b> ${esc(a.origin)}</div>`:''}<div style="margin-top:8px"><button class="btn" type="button" data-spell="${esc(a.word)}" style="padding:6px 12px;font-size:13px">🔊 Spell it</button></div></div></details>`).join('');
 const sm=$('saveMsg');sm.className='mq-msg';
 if(S.student.demo)sm.textContent='Demo result: not saved.';
 else{try{const up={};up['spelling/sessions/'+res.id]=res;up['spelling/sessionAnswers/'+res.id]={studentId:res.studentId,answers:Q.results};await root.update(up);S.sessions.unshift(res);sm.textContent='Result saved to your history.';sm.classList.add('good');}catch(e){console.error(e);sm.textContent='Could not save this result. Check your connection and database rules.';}}}
$('againBtn').onclick=()=>{if(S.quiz)start(S.quiz.mode||(S.quiz.reg==='Mixed'?'all':S.quiz.reg));};
$('homeBtn').onclick=()=>{stopSay();S.quiz=null;renderDash();show('dashView');};
$('sayBtn').onclick=()=>{const r=S.last;if(!r)return;const miss=r.answers.filter(a=>!a.ok).length;say(`You spelled ${r.correct} out of ${r.total} words correctly, which is ${r.score} percent. ${miss?`${miss} word${miss===1?'':'s'} to review. Press Spell it on each one.`:'Every word was right. Fantastic!'}`);};
$('dockReplay').onclick=()=>{if(lastSaid)say(lastSaid);};
window.addEventListener('pagehide',stopSay);
buildPad();
/* Introduction speaks as the page loads; if the browser blocks sound, it plays on the first tap. */
let armed=false;function arm(){if(armed)return;armed=true;coach('Tap anywhere and I will introduce myself.');const evs=['pointerdown','keydown','touchstart'],once=e=>{evs.forEach(v=>document.removeEventListener(v,once,true));if(e.target.closest&&e.target.closest('#introBtn,#dockReplay'))return;if(!$('loginView').classList.contains('hidden'))say($('introText').textContent);};evs.forEach(v=>document.addEventListener(v,once,true));}
$('introBtn').onclick=()=>{say($('introText').textContent);coach('Nice to meet you! Sign in or try the free demo when you are ready.');};
setTimeout(()=>{if(!$('loginView').classList.contains('hidden')){coach('Hello! Listen to my introduction, then sign in or try the demo.');say($('introText').textContent,arm);}},500);
})();
