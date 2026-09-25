import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
let ROSTER=[], profile=null, user=null, activeModule='all', sidebarModule='all', current=null, busy=false, selectedName='';
let pptxViewer=null, presenterBlobUrl=null;
let authMode='signin';

function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const initials=n=>n.split(/\s+/).slice(0,2).map(x=>x[0]).join('');
const isTeacher=()=>profile?.role==='teacher';
function setMessage(target,msg,error=false){const el=$(target);el.textContent=msg;el.classList.toggle('error',error);}
function showAuth(){profile=null;user=null;$('.app').classList.add('auth-hidden');$('#authScreen').hidden=false;$('#pendingScreen').hidden=true;}
function showPending(){$('.app').classList.add('auth-hidden');$('#authScreen').hidden=true;$('#pendingScreen').hidden=false;}
function showClass(){$('#authScreen').hidden=true;$('#pendingScreen').hidden=true;$('.app').classList.remove('auth-hidden');$('#signedInAs').textContent=user?.email||'';$('#teacherPanel').style.display=isTeacher()?'block':'none';}

async function handleSession(session){
  if(!session?.user){showAuth();return;}
  user=session.user;
  const {data,error}=await supabase.from('profiles').select('id,email,role,requested_roll,roll,full_name').eq('id',user.id).maybeSingle();
  if(error){showAuth();setMessage('#authMessage',`Could not load your class profile: ${error.message}`,true);return;}
  profile=data;
  if(!profile){showAuth();setMessage('#authMessage','Your account profile is not ready. Please sign out and try again.',true);return;}
  if(!isTeacher()&&!profile.roll){showPending();await populateRollChoices();return;}
  showClass();await loadClassData();
}

async function loadClassData(){
  const {data,error}=await supabase.from('students').select('roll,full_name,topic,module,completed,completed_at,canva_url').order('roll');
  if(error){setMessage('#appMessage',`Could not load class list: ${error.message}`,true);return;}
  ROSTER=(data||[]).map(x=>({...x,name:x.full_name}));
  renderRoster();renderStats();fillLibrarySelect();renderLibrary();renderCanva();
  if(isTeacher())await renderPendingUsers();
}

async function populateRollChoices(){
  const select=$('#requestedRoll');select.innerHTML='<option value="">Choose your roll number…</option>'+Array.from({length:72},(_,i)=>`<option value="${i+1}">Roll ${i+1}</option>`).join('');
  if(profile?.requested_roll)select.value=String(profile.requested_roll);
  $('#requestStatus').textContent=profile?.requested_roll?`Request for roll ${profile.requested_roll} is waiting for teacher approval.`:'Choose your roll number and request access. The teacher will approve it.';
}

function pool(){const scope=ROSTER.filter(s=>activeModule==='all'||s.module===+activeModule);return scope.filter(s=>{if(s.completed)return false;return !scope.some(other=>other.topic===s.topic&&other.roll<s.roll&&!other.completed);});}

function renderRoster(){
  const q=$('#search').value.trim().toLowerCase();
  const list=ROSTER.filter(s=>(sidebarModule==='all'||s.module===+sidebarModule)&&(!q||s.name.toLowerCase().includes(q)||String(s.roll).includes(q)||s.topic.toLowerCase().includes(q)));
  $('#rosterCount').textContent=`${list.length} student${list.length===1?'':'s'}`;
  const scoped=ROSTER.filter(s=>activeModule==='all'||s.module===+activeModule);
  $('#studentList').innerHTML=list.map(s=>{
    const previous=scoped.find(o=>o.topic===s.topic&&o.roll<s.roll&&!o.completed),waiting=!s.completed&&previous;
    return `<button class="student ${selectedName===s.roll?'selected':''}" data-roll="${s.roll}" title="${waiting?`Waiting for roll ${previous.roll} to present first`:s.topic}"><span class="avatar">${initials(s.name)}</span><span class="student-meta"><span class="student-name">${s.roll}. ${escapeHTML(s.name)}</span><span class="student-sub">${escapeHTML(s.topic)}${waiting?` · Waiting for #${previous.roll}`:''}</span></span><span class="status ${s.completed?'done':waiting?'waiting':''}">${s.completed?'✓':waiting?'⌛':''}</span></button>`;
  }).join('');
  $$('.student').forEach(b=>b.onclick=()=>selectStudent(+b.dataset.roll));
}

function renderStats(){
  const m=activeModule==='all'?ROSTER:ROSTER.filter(s=>s.module===+activeModule),done=m.filter(s=>s.completed),pct=m.length?Math.round(done.length/m.length*100):0;
  $('#totalStat').textContent=m.length;$('#doneStat').textContent=done.length;$('#remainingStat').textContent=m.length-done.length;
  $('#m2Count').textContent=`${ROSTER.filter(s=>s.module===2&&s.completed).length} / 37`;$('#m3Count').textContent=`${ROSTER.filter(s=>s.module===3&&s.completed).length} / 33`;
  $('#completionPct').textContent=`${pct}%`;$('#progressFill').style.width=`${pct}%`;$('.progress-track').setAttribute('aria-valuenow',pct);
  $('#completionSummary').textContent=`${done.length} of ${m.length} students have presented${activeModule==='all'?'':` · Module ${activeModule}`}`;
  $('#completedCount').textContent=`${done.length} completed`;
  $('#completedList').innerHTML=done.length?done.map(s=>`<div class="completed-entry"><span class="completed-check">✓</span><span class="completed-info"><span class="completed-name">${escapeHTML(s.name)}</span><span class="completed-roll">Roll ${s.roll} · Module ${s.module}</span></span>${isTeacher()?`<button class="quiet-btn undo-done" data-roll="${s.roll}" title="Undo completion">Undo</button>`:''}</div>`).join(''):'<div class="completed-empty">No presentations marked complete yet.</div>';
  $$('.undo-done').forEach(b=>b.onclick=()=>setCompleted(+b.dataset.roll,false));
  const next=pool().slice(0,3);$('#nextAvatars').innerHTML=next.map(s=>`<span class="mini-avatar">${initials(s.name)}</span>`).join('')||'<span class="mini-avatar">✓</span>';
  $('#nextCopy').innerHTML=next.length?`<b>${escapeHTML(next[0].name)}</b>${next.length>1?` &nbsp;·&nbsp; ${escapeHTML(next[1].name)}`:''}${next.length>2?` &nbsp;·&nbsp; +${next.length-2} more`:''}`:'All presentations complete';
}

function showStudent(s,animate=true){
  current=s;selectedName=s?.roll??'';
  if(!s){$('#selection').innerHTML='<div class="placeholder"><span class="spark">✓</span>Everyone in this group has presented. Nice work!</div>';$('#doneBtn').classList.remove('visible');$('#redrawBtn').style.display='none';$('#drawBtn').disabled=true;$('#drawBtn').textContent='All done';$('#drawHint').textContent='Choose another module to continue';renderRoster();return;}
  $('#drawBtn').disabled=false;$('#drawBtn').innerHTML='✦ &nbsp; Pick a student <span>↗</span>';
  $('#selection').innerHTML=`<div class="${animate?'winner':''}"><div class="winner-roll">ROLL NO. ${s.roll} &nbsp;·&nbsp; MODULE ${s.module}</div><div class="winner-name">${escapeHTML(s.name)}</div><div class="winner-topic">${escapeHTML(s.topic)}</div></div>`;
  $('#doneBtn').classList.toggle('visible',isTeacher()&&!s.completed);$('#redrawBtn').style.display='inline-block';$('#drawHint').textContent=s.completed?'Already marked complete.':isTeacher()?'Finished presenting? Mark complete to remove this student from the draw.':'Teacher marks presentations complete.';renderRoster();
}

function selectStudent(roll){
  const s=ROSTER.find(x=>x.roll===roll);if(!s)return;
  const scope=ROSTER.filter(x=>activeModule==='all'||x.module===+activeModule),previous=scope.find(o=>o.topic===s.topic&&o.roll<s.roll&&!o.completed);
  if(previous){current=null;selectedName=s.roll;$('#selection').innerHTML=`<div class="placeholder"><span class="spark">⌛</span><b style="color:#fff">This topic has a presentation order.</b><br>Roll #${previous.roll} · ${escapeHTML(previous.name)} must present first.</div>`;$('#doneBtn').classList.remove('visible');$('#redrawBtn').style.display='none';$('#drawHint').textContent='Complete the earlier same-topic presentation to unlock this student.';renderRoster();return;}
  showStudent(s,false);if(innerWidth<681)closeMenu();
}

function draw(){if(busy)return;const p=pool();if(!p.length){showStudent(null);return;}busy=true;current=null;$('#doneBtn').classList.remove('visible');$('#redrawBtn').style.display='none';let i=0;const timer=setInterval(()=>{const s=p[Math.floor(Math.random()*p.length)];$('#selection').innerHTML=`<div class="winner shuffling"><div class="winner-roll">ROLL NO. ${s.roll} · MODULE ${s.module}</div><div class="winner-name">${escapeHTML(s.name)}</div><div class="winner-topic">${escapeHTML(s.topic)}</div></div>`;if(++i>=18){clearInterval(timer);showStudent(p[Math.floor(Math.random()*p.length)],true);busy=false;}},95);}

async function setCompleted(roll,completed){
  if(!isTeacher())return;
  const {error}=await supabase.rpc(completed?'mark_student_complete':'reset_student_completion',{p_roll:roll});
  if(error){setMessage('#appMessage',error.message,true);return;}
  const s=ROSTER.find(x=>x.roll===roll);if(s){s.completed=completed;s.completed_at=completed?new Date().toISOString():null;}
  renderStats();renderRoster();if(current?.roll===roll&&!completed)showStudent(s,false);else if(current?.roll===roll&&completed){current=null;$('#selection').innerHTML=`<div class="placeholder"><span class="spark">✓</span><b style="color:#fff">${escapeHTML(s.name)} is marked complete.</b><br>Ready to draw the next presenter?</div>`;$('#doneBtn').classList.remove('visible');$('#redrawBtn').style.display='none';$('#drawBtn').disabled=false;$('#drawBtn').innerHTML='✦ &nbsp; Pick next student <span>↗</span>';}
}

async function fillLibrarySelect(){
  const select=$('#libraryStudent'),previous=select.value;
  const students=isTeacher()?ROSTER:ROSTER.filter(s=>s.roll===profile?.roll);
  select.innerHTML=students.map(s=>`<option value="${s.roll}">${escapeHTML(s.name)} · Roll ${s.roll}</option>`).join('');
  if(isTeacher()){select.insertAdjacentHTML('afterbegin','<option value="">Choose a student…</option>');select.value=students.some(s=>String(s.roll)===previous)?previous:'';}
  else if(profile?.roll)select.value=String(profile.roll);
  select.disabled=!isTeacher();
}
function libraryStudent(){return ROSTER.find(s=>s.roll===+$('#libraryStudent').value);}

async function renderLibrary(){
  const student=libraryStudent();if(!student){$('#libraryFile').innerHTML='<div class="library-empty">Choose a student folder to view or upload a presentation.</div>';return;}
  const {data,error}=await supabase.from('presentations').select('id,roll,file_name,storage_path,mime_type,uploaded_by,created_at').eq('roll',student.roll).order('created_at',{ascending:false});
  if(error){$('#libraryFile').innerHTML=`<div class="library-empty">Could not load presentations: ${escapeHTML(error.message)}</div>`;return;}
  $('#libraryCount').textContent=`${(data||[]).length} presentation${data?.length===1?'':'s'}`;
  if(!data?.length){$('#libraryFile').innerHTML=`<div class="library-empty">📁 ${escapeHTML(student.name)} folder is ready. No presentation uploaded yet.</div>`;return;}
  $('#libraryFile').innerHTML=data.map(r=>`<div class="saved-file"><div class="file-icon">${r.mime_type==='application/pdf'?'PDF':'PPTX'}</div><div class="saved-meta"><div class="saved-name">${escapeHTML(r.file_name)}</div><div class="saved-date">${escapeHTML(student.name)} folder · ${new Date(r.created_at).toLocaleString()}</div></div><div class="file-actions"><button class="quiet-btn present-deck" data-id="${r.id}">▶ Present</button><button class="quiet-btn delete-deck" data-id="${r.id}">Remove</button></div></div>`).join('');
  $$('.present-deck').forEach(b=>b.onclick=()=>presentRecord(data.find(r=>r.id===b.dataset.id),student));
  $$('.delete-deck').forEach(b=>b.onclick=()=>deleteRecord(data.find(r=>r.id===b.dataset.id)));
}

async function uploadDeck(){
  const student=libraryStudent(),file=$('#deckFile').files[0];if(!student){setMessage('#libraryMessage','Choose a student folder first.',true);return;}if(!file){setMessage('#libraryMessage','Choose a PPTX or PDF file.',true);return;}
  const ext=file.name.split('.').pop().toLowerCase();if(!['pptx','pdf'].includes(ext)){setMessage('#libraryMessage','Choose a .pptx or .pdf presentation.',true);return;}if(file.size>50*1024*1024){setMessage('#libraryMessage','This file is over the 50 MB upload limit.',true);return;}
  const safeName=file.name.replace(/[\\/]/g,'_'),path=`${student.name}/${Date.now()}-${safeName}`;
  $('#uploadDeck').disabled=true;setMessage('#libraryMessage','Uploading to shared class storage…');
  const {error:storageError}=await supabase.storage.from('presentations').upload(path,file,{contentType:file.type|| (ext==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation'),upsert:false});
  if(storageError){$('#uploadDeck').disabled=false;setMessage('#libraryMessage',storageError.message,true);return;}
  const {error:rowError}=await supabase.from('presentations').insert({roll:student.roll,file_name:file.name,storage_path:path,mime_type:ext==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation',uploaded_by:user.id});
  if(rowError){await supabase.storage.from('presentations').remove([path]);$('#uploadDeck').disabled=false;setMessage('#libraryMessage',rowError.message,true);return;}
  $('#uploadDeck').disabled=false;$('#deckFile').value='';setMessage('#libraryMessage','Presentation uploaded to the shared class folder.');await renderLibrary();
}

async function deleteRecord(row){if(!row)return;const {error}=await supabase.storage.from('presentations').remove([row.storage_path]);if(error){setMessage('#libraryMessage',error.message,true);return;}const result=await supabase.from('presentations').delete().eq('id',row.id);if(result.error){setMessage('#libraryMessage',result.error.message,true);return;}await renderLibrary();}

function presenterOpen(title,caption){if(pptxViewer){pptxViewer.destroy();pptxViewer=null;}if(presenterBlobUrl){URL.revokeObjectURL(presenterBlobUrl);presenterBlobUrl=null;}$('#presenterHeading').textContent=title;$('#presenterCaption').textContent=caption;$('#presenterStage').classList.remove('one-slide');$('#presenterStage').innerHTML='';$('#presenterOverlay').classList.add('show');document.body.style.overflow='hidden';$('#prevSlide').style.display='none';$('#nextSlide').style.display='none';$('#slideNumber').textContent='';}
function presenterClose(){if(pptxViewer){pptxViewer.destroy();pptxViewer=null;}if(presenterBlobUrl){URL.revokeObjectURL(presenterBlobUrl);presenterBlobUrl=null;}$('#presenterOverlay').classList.remove('show');document.body.style.overflow='';$('#presenterStage').innerHTML='';}
async function presentRecord(row,student){
  const {data,error}=await supabase.storage.from('presentations').createSignedUrl(row.storage_path,3600);if(error){setMessage('#libraryMessage',error.message,true);return;}
  presenterOpen(row.file_name,`${student.name} · Roll ${student.roll} · ${student.topic}`);const stage=$('#presenterStage');
  if(row.mime_type==='application/pdf'){stage.innerHTML=`<iframe title="Presentation PDF" src="${data.signedUrl}#toolbar=1&navpanes=0"></iframe>`;return;}
  stage.innerHTML='<div id="pptxMount"></div>';
  try{const lib=await import('https://cdn.jsdelivr.net/npm/@aiden0z/pptx-renderer@1.3.0/dist/aiden0z-pptx-renderer.browser.es.js');const response=await fetch(data.signedUrl);if(!response.ok)throw Error('Could not fetch the presentation.');pptxViewer=await lib.PptxViewer.open(await response.arrayBuffer(),$('#pptxMount'),{renderMode:'slide',zipLimits:lib.RECOMMENDED_ZIP_LIMITS});const update=()=>{$('#slideNumber').textContent=`${pptxViewer.currentSlideIndex+1} / ${pptxViewer.slideCount}`;$('#prevSlide').disabled=pptxViewer.currentSlideIndex===0;$('#nextSlide').disabled=pptxViewer.currentSlideIndex>=pptxViewer.slideCount-1;};stage.classList.add('one-slide');$('#prevSlide').style.display='inline-block';$('#nextSlide').style.display='inline-block';pptxViewer.addEventListener('slidechange',update);$('#prevSlide').onclick=()=>pptxViewer?.goToSlide(Math.max(0,pptxViewer.currentSlideIndex-1));$('#nextSlide').onclick=()=>pptxViewer?.goToSlide(Math.min(pptxViewer.slideCount-1,pptxViewer.currentSlideIndex+1));update();}catch(e){stage.innerHTML='<div class="library-empty">PowerPoint preview could not be loaded. Check the internet connection or download the file from the Supabase Storage dashboard.</div>';}
}

function renderCanva(){const student=libraryStudent();$('#canvaUrl').value=student?.canva_url||'';$('#openCanva').style.display=student?.canva_url?'inline-block':'none';$('#saveCanva').style.display=(student&&(isTeacher()||student.roll===profile?.roll))?'inline-block':'none';}
function canvaEmbed(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)canva\.com$/i.test(u.hostname))return null;const m=u.pathname.match(/\/design\/([^/]+)/);return m?`https://www.canva.com/design/${m[1]}/view?embed`:null;}catch{return null;}}
$('#saveCanva').onclick=async()=>{const s=libraryStudent(),raw=$('#canvaUrl').value.trim();if(!s)return;const url=raw?canvaEmbed(raw):null;if(raw&&!url){setMessage('#libraryMessage','Paste a Canva design link.',true);return;}const {error}=await supabase.rpc('save_student_canva',{p_roll:s.roll,p_url:url});if(error){setMessage('#libraryMessage',error.message,true);return;}s.canva_url=url;renderCanva();};
$('#openCanva').onclick=()=>{const s=libraryStudent(),url=s?.canva_url&&canvaEmbed(s.canva_url);if(!s||!url)return;presenterOpen(`${s.name} · Canva`,`${s.topic} · Canva presentation`);$('#presenterStage').innerHTML=`<iframe title="Canva presentation" allow="fullscreen" allowfullscreen src="${url}"></iframe>`;};

async function renderPendingUsers(){
  if(!isTeacher())return;
  const {data,error}=await supabase.from('profiles').select('id,email,requested_roll,created_at').is('roll',null).not('requested_roll','is',null).order('created_at');
  if(error){$('#pendingUsers').innerHTML=`<div class="completed-empty">${escapeHTML(error.message)}</div>`;return;}
  $('#pendingUsers').innerHTML=data?.length?data.map(p=>{const s=ROSTER.find(x=>x.roll===p.requested_roll);return `<div class="completed-entry"><span class="completed-info"><span class="completed-name">${escapeHTML(p.email)}</span><span class="completed-roll">Requests roll ${p.requested_roll}${s?` · ${escapeHTML(s.name)}`:''}</span></span><button class="quiet-btn approve-user" data-id="${p.id}">Approve</button></div>`;}).join(''):'<div class="completed-empty">No student requests are waiting.</div>';
  $$('.approve-user').forEach(b=>b.onclick=async()=>{const {error}=await supabase.rpc('approve_student_roll',{p_user:b.dataset.id});if(error){setMessage('#appMessage',error.message,true);return;}await renderPendingUsers();});
}

async function requestRoll(){const roll=Number($('#requestedRoll').value);if(!roll){setMessage('#requestMessage','Choose your roll number.',true);return;}const {error}=await supabase.rpc('request_student_roll',{p_roll:roll});if(error){setMessage('#requestMessage',error.message,true);return;}profile.requested_roll=roll;$('#requestStatus').textContent=`Request for roll ${roll} sent. The teacher must approve it before you can use the app.`;setMessage('#requestMessage','Request sent.');}

$('#authForm').onsubmit=async e=>{e.preventDefault();const email=$('#authEmail').value.trim(),password=$('#authPassword').value;if(authMode==='signup'){const {error}=await supabase.auth.signUp({email,password});if(error){setMessage('#authMessage',error.message,true);return;}setMessage('#authMessage','Account created. Check your email to confirm, then sign in.');}else{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setMessage('#authMessage',error.message,true);}};
$('#toggleAuth').onclick=()=>{authMode=authMode==='signin'?'signup':'signin';$('#authTitle').textContent=authMode==='signin'?'Welcome back':'Create your class account';$('#authSubmit').textContent=authMode==='signin'?'Sign in':'Create account';$('#toggleAuth').textContent=authMode==='signin'?'New student? Create an account':'Already registered? Sign in';setMessage('#authMessage','');};
$('#forgotPassword').onclick=async()=>{const email=$('#authEmail').value.trim();if(!email){setMessage('#authMessage','Enter your email address first.',true);return;}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.href});setMessage('#authMessage',error?.message||'Password reset link sent if that account exists.',!!error);};
$('#requestRollBtn').onclick=requestRoll;$('#signOutBtn').onclick=()=>supabase.auth.signOut();

$('#drawBtn').onclick=draw;$('#redrawBtn').onclick=draw;$('#doneBtn').onclick=()=>current&&setCompleted(current.roll,true);
$$('.module-btn').forEach(b=>b.onclick=()=>{$$('.module-btn').forEach(x=>x.classList.toggle('active',x===b));activeModule=b.dataset.mod;current=null;$('#selection').innerHTML='<div class="placeholder"><span class="spark">✳</span>Ready to find out who’s up next?</div>';$('#doneBtn').classList.remove('visible');$('#redrawBtn').style.display='none';$('#drawBtn').disabled=false;$('#drawBtn').innerHTML='✦ &nbsp; Pick a student <span>↗</span>';$('#drawHint').textContent='Every student gets one turn · names are drawn from those still to present';renderStats();renderRoster();});
$$('.filter').forEach(b=>b.onclick=()=>{$$('.filter').forEach(x=>x.classList.toggle('active',x===b));sidebarModule=b.dataset.filter;renderRoster();});$('#search').oninput=renderRoster;
$('#queueLink').onclick=()=>innerWidth<681?openMenu():$('#studentList').scrollTo({top:0,behavior:'smooth'});
$('#libraryStudent').onchange=()=>{renderLibrary();renderCanva();};$('#uploadDeck').onclick=uploadDeck;
$('#closePresenter').onclick=presenterClose;$('#presenterOverlay').onclick=e=>{if(e.target===$('#presenterOverlay'))presenterClose();};document.addEventListener('keydown',e=>{if(!$('#presenterOverlay').classList.contains('show'))return;if(e.key==='Escape')presenterClose();if(e.key==='ArrowRight')$('#nextSlide').click();if(e.key==='ArrowLeft')$('#prevSlide').click();});
function openMenu(){$('#sidebar').classList.add('open');$('#overlay').classList.add('show')}function closeMenu(){$('#sidebar').classList.remove('open');$('#overlay').classList.remove('show')}$('#menuBtn').onclick=openMenu;$('#overlay').onclick=closeMenu;
supabase.auth.onAuthStateChange((_event,session)=>queueMicrotask(()=>handleSession(session)));
supabase.auth.getSession().then(({data})=>handleSession(data.session));
