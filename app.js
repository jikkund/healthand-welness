import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STUDENT_ROSTER_CSV_URL, STUDENT_PRESENTATIONS_CSV_URL } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{experimental:{passkey:true}}});
const $=s=>document.querySelector(s);
let roster=[],teacher=null,current=null,busy=false,presentationsByRoll=new Map(),presentationsLoaded=false,rosterFilter='all';
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(id,text,error=false){const e=$(id);e.textContent=text;e.style.color=error?'#a9473c':'';}
function isTeacher(){return teacher?.role==='teacher';}
function accessUI(){
  $('#teacherLoginBtn').hidden=isTeacher();$('#signOutBtn').hidden=!isTeacher();
  $('#drawBtn').disabled=!isTeacher()||busy;$('#doneBtn').disabled=!isTeacher()||busy||!current||current.completed;
  $('#drawHint').textContent=isTeacher()?'Teacher access is active. Confirm with your password or a device passkey for each action.':'Teacher sign-in is required to use the picker or change completion.';
  $('#registerPasskeyBtn').hidden=!isTeacher();
  renderRoster();renderProgress();renderUploadProgress();
}
function parseCSV(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows;
}
async function loadSheetNames(){
  if(!STUDENT_ROSTER_CSV_URL)return null;
  const response=await fetch(STUDENT_ROSTER_CSV_URL,{cache:'no-store'});
  if(!response.ok)throw new Error(`Roster sheet returned HTTP ${response.status}`);
  const rows=parseCSV(await response.text());
  const names=new Map();
  for(const cells of rows){const roll=Number.parseInt(cells[0],10),name=(cells[1]||'').trim();if(Number.isInteger(roll)&&name)names.set(roll,name);}
  if(!names.size)throw new Error('The published roster has no rows with Roll No and Student Name.');
  return names;
}
async function loadPresentations(){
  const response=await fetch(STUDENT_PRESENTATIONS_CSV_URL,{cache:'no-store'});
  if(!response.ok)throw new Error(`Presentation links returned HTTP ${response.status}`);
  const rows=parseCSV(await response.text()),items=new Map();
  for(const cells of rows){
    const roll=Number.parseInt(cells[0],10),topic=(cells[2]||'').trim(),raw=(cells[3]||'').trim();
    if(!Number.isInteger(roll)||!raw)continue;
    try{const url=new URL(raw);if(url.protocol==='https:')items.set(roll,{topic,url:url.href});}catch{}
  }
  return items;
}
async function loadRoster(){
  const {data,error}=await supabase.from('students').select('roll,full_name,completed,module').order('roll');
  if(error){message('#appMessage',`Could not load students: ${error.message}`,true);return;}
  let sheetNames=null;
  try{sheetNames=await loadSheetNames();}catch(e){message('#appMessage',`Could not read the linked roster sheet: ${e.message}`,true);}
  try{presentationsByRoll=await loadPresentations();presentationsLoaded=true;}catch(e){presentationsByRoll=new Map();presentationsLoaded=false;message('#appMessage',`Could not load presentation links: ${e.message}`,true);}
  roster=(data||[]).map(s=>({...s,name:sheetNames?.get(s.roll)||s.full_name}));
  if(sheetNames){const missing=[...sheetNames.keys()].filter(roll=>!roster.some(s=>s.roll===roll));if(missing.length)message('#appMessage',`${missing.length} roll number(s) in the sheet are not in the class database; add them to Supabase before they can be picked or marked.`,true);}
  $('#rosterCount').textContent=`${roster.length} students`;renderRoster();renderProgress();renderUploadProgress();
  const {data:state}=await supabase.from('class_state').select('active_roll').eq('id',true).maybeSingle();
  current=roster.find(s=>s.roll===state?.active_roll)||null;showCurrent();
}
function renderRoster(){
  const q=$('#search').value.trim().toLowerCase(),list=roster.filter(s=>{const uploaded=presentationsByRoll.has(s.roll);const matches=s.name.toLowerCase().includes(q)||String(s.roll).includes(q);return matches&&(rosterFilter==='all'||(rosterFilter==='pending'&&!uploaded)||(rosterFilter==='uploaded'&&uploaded)||(rosterFilter==='completed'&&s.completed));});
  $('#studentList').innerHTML=list.map(s=>{const presentation=presentationsByRoll.get(s.roll),initials=s.name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('');return `<div class="row"><div class="avatar" aria-hidden="true">${escapeHTML(initials)}</div><div class="name"><div class="student-name">${escapeHTML(s.name)}</div><div class="roll">Roll ${s.roll}</div>${presentation?.topic?`<div class="topic">${escapeHTML(presentation.topic)}</div>`:''}</div><button class="preview-button ${presentation?'':'preview-disabled'}" ${presentation?`data-presentation-roll="${s.roll}"`:'disabled'} aria-label="${presentation?`Preview ${escapeHTML(s.name)}’s presentation`:`No presentation uploaded for ${escapeHTML(s.name)}`}" title="${presentation?'Preview presentation':'No presentation link added yet'}">▶ Preview</button><span class="badge ${s.completed?'done':''}">${s.completed?'Completed':'Not completed'}</span>${isTeacher()?`<button class="teacher status-toggle" data-roll="${s.roll}" aria-label="Change completion for ${escapeHTML(s.name)}">${s.completed?'Undo':'Mark done'}</button>`:''}</div>`;}).join('')||'<div class="count">No students match this filter.</div>';
  document.querySelectorAll('.status-toggle').forEach(b=>b.onclick=()=>setStatus(+b.dataset.roll,!roster.find(s=>s.roll===+b.dataset.roll)?.completed));
  document.querySelectorAll('.preview-button').forEach(b=>b.onclick=()=>previewStudentPresentation(+b.dataset.presentationRoll));
}
function presentationEmbedUrl(raw){
  const url=new URL(raw);if(url.protocol!=='https:')return null;
  const slides=url.pathname.match(/\/presentation\/d\/([\w-]+)/);
  if(slides)return `https://docs.google.com/presentation/d/${slides[1]}/embed?start=false&loop=false&delayms=3000`;
  const drive=url.pathname.match(/\/file\/d\/([\w-]+)/);
  if(drive)return `https://drive.google.com/file/d/${drive[1]}/preview`;
  if(url.hostname==='canva.com'||url.hostname.endsWith('.canva.com')){url.searchParams.set('embed','');return url.href;}
  if(url.pathname.toLowerCase().endsWith('.pdf'))return url.href;
  if(url.pathname.toLowerCase().endsWith('.pptx'))return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url.href)}`;
  return null;
}
function previewStudentPresentation(roll){
  const student=roster.find(s=>s.roll===roll),presentation=presentationsByRoll.get(roll);if(!student||!presentation)return;
  $('#presentationTitle').textContent=presentation.topic||`${student.name} · Roll ${roll}`;
  $('#presentationStudent').textContent=`${student.name} · Roll ${roll}`;
  $('#presentationExternal').href=presentation.url;
  const embed=presentationEmbedUrl(presentation.url),frame=$('#presentationFrame'),fallback=$('#presentationFallback');
  frame.hidden=!embed;fallback.hidden=!!embed;
  if(embed)frame.src=embed;else frame.removeAttribute('src');
  $('#presentationScreen').hidden=false;
}
function renderProgress(){
  const done=roster.filter(s=>s.completed),pct=roster.length?Math.round(done.length/roster.length*100):0;
  $('#completionDonut').style.setProperty('--progress',`${pct}%`);$('#studentTotal').textContent=roster.length;$('#completedStat').textContent=done.length;$('#completedStatNote').textContent=`${pct}% of the class has presented`;
  $('#completionPct').textContent=`${pct}%`;$('#progressFill').style.width=`${pct}%`;
  $('#completionLegendDone').textContent=done.length;$('#completionLegendPending').textContent=roster.length-done.length;
  $('#completionSummary').textContent=`${done.length} of ${roster.length} students completed`;
  $('#completedCount').textContent=`${done.length} completed`;
  $('#completedList').innerHTML=done.map(s=>`<div class="done-item">✓ &nbsp; ${escapeHTML(s.name)} <span class="count">· Roll ${s.roll}</span></div>`).join('')||'<div class="count">No students completed yet.</div>';
}
function renderUploadProgress(){
  const uploaded=roster.filter(s=>presentationsByRoll.has(s.roll));
  const pending=roster.filter(s=>!presentationsByRoll.has(s.roll));
  const pct=roster.length?Math.round(uploaded.length/roster.length*100):0;
  $('#uploadPct').textContent=presentationsLoaded?`${pct}%`:'—';
  $('#uploadDonut').style.setProperty('--progress',presentationsLoaded?`${pct}%`:'0%');$('#uploadStat').textContent=presentationsLoaded?`${uploaded.length} / ${roster.length}`:'—';$('#uploadStatNote').textContent=presentationsLoaded?`${pct}% of the class has shared a link`:'Waiting for sheet data';$('#uploadLegendDone').textContent=presentationsLoaded?uploaded.length:'—';$('#uploadLegendPending').textContent=presentationsLoaded?pending.length:'—';
  $('#uploadFill').style.width=presentationsLoaded?`${pct}%`:'0%';
  $('#uploadSummary').textContent=presentationsLoaded?`${uploaded.length} of ${roster.length} students have a presentation link`:'Could not load the presentation sheet';
  $('#uploadMissingCount').textContent=presentationsLoaded?`${pending.length} still to upload`:'Waiting for sheet access';
  $('#uploadMissingList').innerHTML=!presentationsLoaded?'<div class="count">Check that the Student Presentations tab is published for anyone with the link.</div>':pending.map(s=>`<div class="pending-item">○ &nbsp; ${escapeHTML(s.name)} <span class="count">· Roll ${s.roll}</span></div>`).join('')||'<div class="count">Everyone has added a presentation link.</div>';
}
function showCurrent(){
  $('#selection').innerHTML=current?`<div><div class="picked-name">${escapeHTML(current.name)}</div><div class="picked-sub">Roll ${current.roll}${current.completed?' · Completed':''}</div></div>`:'<div class="picked-sub">No student picked yet.</div>';
  $('#doneBtn').disabled=!isTeacher()||busy||!current||current.completed;
}
function askForActionAuth(){
  return new Promise(resolve=>{
    const modal=$('#actionAuthScreen'),form=$('#actionAuthForm'),password=$('#actionAuthPassword');
    const finish=value=>{modal.hidden=true;form.removeEventListener('submit',submit);$('#cancelActionAuth').removeEventListener('click',cancel);$('#usePasskeyBtn').removeEventListener('click',passkey);resolve(value);};
    const cancel=e=>{e?.preventDefault();finish(false);};
    const submit=async e=>{
      e.preventDefault();$('#actionAuthMessage').textContent='Checking your password…';
      const {error}=await supabase.auth.signInWithPassword({email:teacher.email,password:password.value});
      if(error){$('#actionAuthMessage').textContent='That password didn’t match. Try again or use your passkey.';password.select();return;}
      password.value='';finish(true);
    };
    const passkey=async()=>{
      const button=$('#usePasskeyBtn');button.disabled=true;$('#actionAuthMessage').textContent='Waiting for your device…';
      const {error}=await supabase.auth.signInWithPasskey();
      button.disabled=false;
      if(error){$('#actionAuthMessage').textContent='Passkey unavailable or not enrolled yet. Use your password, or set up a passkey after signing in.';return;}
      await sessionQueue;
      if(isTeacher())finish(true);else $('#actionAuthMessage').textContent='This passkey account does not have teacher access.';
    };
    $('#actionAuthMessage').textContent='';password.value='';modal.hidden=false;
    form.addEventListener('submit',submit);$('#cancelActionAuth').addEventListener('click',cancel);$('#usePasskeyBtn').addEventListener('click',passkey);
    password.focus();
  });
}
async function verifyTeacherAction(){
  if(!isTeacher()){message('#appMessage','Sign in as the teacher first.',true);return false;}
  return askForActionAuth();
}
$('#registerPasskeyBtn').onclick=async()=>{
  const button=$('#registerPasskeyBtn');button.disabled=true;message('#appMessage','Follow the prompt from your device to save a passkey.');
  const {error}=await supabase.auth.registerPasskey();button.disabled=false;
  if(error)message('#appMessage',`Could not set up a passkey: ${error.message}`,true);
  else message('#appMessage','Passkey saved on this device. You can use its fingerprint, face unlock, PIN, or security key when confirming teacher actions.');
};
async function pickStudent(){
  if(busy||!await verifyTeacherAction())return;
  const pool=roster.filter(s=>!s.completed);if(!pool.length){current=null;showCurrent();message('#appMessage','All students are marked complete.');return;}
  busy=true;accessUI();let ticks=0;
  const timer=setInterval(async()=>{
    const preview=pool[Math.floor(Math.random()*pool.length)];$('#selection').innerHTML=`<div class="picked-name">${escapeHTML(preview.name)}</div><div class="picked-sub">Roll ${preview.roll}</div>`;
    if(++ticks>=18){clearInterval(timer);current=pool[Math.floor(Math.random()*pool.length)];const {error}=await supabase.rpc('set_active_presenter',{p_roll:current.roll,p_module:null});if(error)message('#appMessage',`Could not save the pick: ${error.message}`,true);showCurrent();busy=false;accessUI();}
  },90);
}
async function setStatus(roll,completed){
  if(!await verifyTeacherAction())return;
  const s=roster.find(x=>x.roll===roll);if(!s)return;
  const {error}=await supabase.rpc(completed?'mark_student_complete':'reset_student_completion',{p_roll:roll});
  if(error){message('#appMessage',`Could not update status: ${error.message}`,true);return;}
  s.completed=completed;if(current?.roll===roll&&completed)current=null;showCurrent();accessUI();message('#appMessage',`${s.name} marked ${completed?'complete':'not complete'}.`);
}
let sessionQueue=Promise.resolve();
function sessionChanged(session){
  sessionQueue=sessionQueue.then(async()=>{
    teacher=null;
    if(session?.user){
      const {data,error}=await supabase.from('profiles').select('id,email,role').eq('id',session.user.id).maybeSingle();
      if(!error&&data?.role==='teacher')teacher={...data,email:session.user.email};
      else{await supabase.auth.signOut();$('#authScreen').hidden=false;message('#authMessage','This account does not have teacher access.',true);}
    }
    accessUI();
  });
  return sessionQueue;
}
$('#search').oninput=renderRoster;
window.addEventListener('scroll',()=>document.documentElement.style.setProperty('--scroll-y',`${window.scrollY}px`),{passive:true});
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{rosterFilter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(chip=>chip.classList.toggle('active',chip===button));renderRoster();});
$('#closePresentation').onclick=()=>{$('#presentationScreen').hidden=true;$('#presentationFrame').removeAttribute('src');};
$('#teacherLoginBtn').onclick=()=>{$('#authScreen').hidden=false;$('#authPassword').value='';message('#authMessage','');};
$('#closeTeacherLogin').onclick=()=>$('#authScreen').hidden=true;
$('#authForm').onsubmit=async e=>{e.preventDefault();message('#authMessage','');const {error}=await supabase.auth.signInWithPassword({email:$('#authEmail').value.trim(),password:$('#authPassword').value});if(error){message('#authMessage',error.message,true);return;}await sessionQueue;if(isTeacher())$('#authScreen').hidden=true;};
$('#signOutBtn').onclick=()=>supabase.auth.signOut();$('#drawBtn').onclick=pickStudent;$('#doneBtn').onclick=()=>current&&setStatus(current.roll,true);
supabase.auth.onAuthStateChange((_event,session)=>queueMicrotask(()=>sessionChanged(session)));
supabase.auth.getSession().then(({data})=>sessionChanged(data.session));
loadRoster();setInterval(loadRoster,10000);
