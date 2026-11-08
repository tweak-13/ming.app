/* Tweaklr unified Status — shared engine for Home, Friendly and Business Spaces. */
(function(){
'use strict';
const app=()=>window.TweaklrStatusContext?window.TweaklrStatusContext():{};
const HOUR=3600000,DAY=24*HOUR,BUCKET='ming-post-media';
let cache=new Map(),activeViewer=null,progressTimer=null,paused=false,startedAt=0,remaining=0;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const escS=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>app().currentUser?.id||'';
const profile=(id,row)=>id===uid()?app().currentUser:{id,name:row?.author_display_name||row?.display_name||row?.author_username||'Tweaklr member',short:row?.author_display_name||row?.display_name||row?.author_username||'Tweaklr member',username:row?.author_username?'@'+String(row.author_username).replace(/^@/,''):'',avatarUrl:row?.author_avatar_url||row?.avatar_url||'',hue:24};
function toastS(t,type){if(typeof app().toast==='function')app().toast(t,type||'alert');else console.info(t);}
function spaceScope(s){return s?.nature==='friendly'?'friendly':s?.nature==='business'?'business':'main';}
async function fetchStatuses(scope='main',spaceId=null){
 if(!app().supabaseClient||!uid())return [];
 const {data,error}=await app().supabaseClient.rpc('get_tweaklr_statuses',{p_scope:scope,p_space_id:spaceId});
 if(error){console.warn('Tweaklr Status load failed:',error.message);return [];}
 const rows=await Promise.all((data||[]).map(async r=>{
   let mediaUrl='';
   if(r.media_path){const {data:signed,error:signedError}=await app().supabaseClient.storage.from(BUCKET).createSignedUrl(r.media_path,3600);if(!signedError)mediaUrl=signed?.signedUrl||'';}
   return {...r,scope,spaceId,media_url:mediaUrl,author:profile(r.author_id,r),createdMs:new Date(r.created_at).getTime(),expiresMs:new Date(r.expires_at).getTime()};
 }));
 cache.set(scope+':'+(spaceId||''),rows);
 return rows;
}
function groups(rows){const map=new Map();rows.forEach(r=>{if(!map.has(r.author_id))map.set(r.author_id,[]);map.get(r.author_id).push(r);});return [...map.values()].map(a=>({authorId:a[0].author_id,author:a[0].author,statuses:a.sort((x,y)=>x.createdMs-y.createdMs),allViewed:a.every(x=>x.viewed||x.is_mine),mine:a[0].author_id===uid()})).sort((a,b)=>b.statuses[b.statuses.length-1].createdMs-a.statuses[a.statuses.length-1].createdMs);}
function statusTime(r){
 const diff=Math.max(0,Date.now()-(r?.createdMs||Date.now()));
 if(diff<60000)return 'Just now';
 if(diff<3600000)return Math.floor(diff/60000)+' min ago';
 if(diff<86400000)return Math.floor(diff/3600000)+' hr ago';
 return 'Yesterday';
}
function ringMarkup(g,add=false){
 const p=g.author||app().currentUser||{},label=g.mine?'Your status':(p.short||p.name||'Tweaklr member');
 const img=p.avatarUrl?'<img src="'+escS(p.avatarUrl)+'" alt="">':'<span>'+escS((label||'T').split(/\\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase())+'</span>';
 return '<button type="button" class="tw-status-person '+(g.allViewed?'is-seen':'is-new')+(g.mine?' is-mine':'')+'" data-tw-status-open="'+escS(g.authorId)+'" aria-label="'+(g.mine?'Add or view your status':'View '+escS(label)+' status')+'"><span class="tw-status-ring"><span class="tw-status-avatar">'+img+'</span>'+(add?'<i aria-hidden="true">+</i>':'')+'</span></button>';
}
function trayHTML(rows,scope,spaceId){
 const gs=groups(rows),mine=gs.find(g=>g.mine),others=gs.filter(g=>!g.mine);
 const add=mine||{authorId:uid(),author:app().currentUser,statuses:[],mine:true,allViewed:true};
 const ordered=[add,...others];
 return '<section class="tw-status-tray tw-status-tray-compact" data-tw-status-scope="'+scope+'" data-tw-status-space="'+escS(spaceId||'')+'"><div class="tw-status-row">'+ordered.map(g=>ringMarkup(g,g.mine)).join('')+'</div></section>';
}
async function mountHome(){
 const host=$('#home-status-tray');if(!host)return;
 let rows=[];
 try{rows=await fetchStatuses('main',null);}catch(error){console.warn('Tweaklr Status: Home load failed; showing the tray anyway.',error);}
 host.innerHTML=trayHTML(rows,'main',null);
 host.style.display='block';host.style.visibility='visible';
 applyAvatarRings();
}
async function mountSpace(space){
 const host=$('#sp-body');if(!host||!space||!['friendly','business'].includes(space.nature))return;
 let tray=$('#tw-space-status-mount',host);if(!tray){tray=document.createElement('div');tray.id='tw-space-status-mount';host.prepend(tray);}
 const rows=await fetchStatuses(spaceScope(space),space.id);tray.innerHTML=trayHTML(rows,spaceScope(space),space.id);
 applyAvatarRings(rows);
}
function applyAvatarRings(){
 const all=[...cache.values()].flat().filter(r=>r.expiresMs>Date.now()),latest=new Map();
 all.forEach(r=>{const old=latest.get(r.author_id);if(!old||r.createdMs>old.createdMs)latest.set(r.author_id,r);});
 $$('[data-profile-id]').forEach(el=>{el.classList.remove('tw-avatar-has-status','tw-avatar-status-seen');delete el.dataset.twStatusScope;delete el.dataset.twStatusSpace;const r=latest.get(el.dataset.profileId);if(!r)return;el.classList.add('tw-avatar-has-status');el.classList.toggle('tw-avatar-status-seen',all.filter(x=>x.author_id===r.author_id).every(x=>x.viewed||x.is_mine));el.dataset.twStatusScope=r.scope;el.dataset.twStatusSpace=r.spaceId||'';});
}
function openComposer(scope,spaceId){
 const main=scope==='main',people=main?(app().connections||[]).map(c=>c.personId).filter(Boolean):[];
 const profiles=people.map(id=>app().mingConnectionProfiles?.get(id)).filter(Boolean);
 const privacy=main?'<div class="tw-status-field"><label>Status privacy</label><select id="tw-status-audience"><option value="connections">My connections</option><option value="except">My connections except…</option><option value="selected">Only share with…</option></select></div><div class="tw-status-field" id="tw-status-privacy-people" hidden><label>Select people</label><div class="tw-status-people">'+profiles.map(p=>'<label><input type="checkbox" value="'+escS(p.id)+'"><span>'+(p.avatarUrl?'<img src="'+escS(p.avatarUrl)+'">':'')+escS(p.short||p.name)+'</span></label>').join('')+'</div></div>':'<p class="tw-status-note">Visible to approved members of this '+(scope==='friendly'?'Friendly':'Business')+' Space.</p>';
 const html='<div class="tw-status-compose" data-scope="'+scope+'" data-space="'+escS(spaceId||'')+'"><div class="tw-status-type-switch"><button class="on" data-tw-type="text">Text</button><button data-tw-type="media">Photo / video</button></div><div id="tw-status-text-panel"><textarea id="tw-status-caption" maxlength="700" placeholder="Type a status…"></textarea><div class="tw-status-colors">'+['#493224','#8B3543','#263B52','#315448','#5A4775','#202020'].map(c=>'<button style="background:'+c+'" data-tw-bg="'+c+'" aria-label="Text background"></button>').join('')+'</div></div><div id="tw-status-media-panel" class="tw-status-media-panel" hidden>
 <div class="tw-media-intro"><span class="tw-media-eyebrow">VISUAL UPDATE</span><b>Share a moment</b><small>Choose a photo or a short video from your device.</small></div>
 <div class="tw-media-pick-grid">
  <button type="button" class="tw-media-pick-card" data-tw-pick-media="image"><span class="tw-media-pick-icon">▧</span><b>Photo</b><small>JPG, PNG, WEBP</small></button>
  <button type="button" class="tw-media-pick-card" data-tw-pick-media="video"><span class="tw-media-pick-icon">▶</span><b>Video</b><small>MP4, MOV, WEBM</small></button>
 </div>
 <input id="tw-status-file" class="tw-status-file-input" type="file" accept="image/*,video/mp4,video/webm,video/quicktime">
 <div id="tw-status-preview" class="tw-status-preview"></div>
 <div class="tw-media-limits"><span>↗</span><p><b>Keep it crisp.</b> Photos up to 15 MB. Videos up to 50 MB and 60 seconds.</p></div>
</div>'+privacy+'</div>';
 const overlay=document.createElement('div');overlay.className='tw-status-modal';overlay.innerHTML='<div class="tw-status-dialog"><header><button data-tw-close>×</button><div><b>Create status</b><small>It disappears after 24 hours.</small></div></header><div class="tw-status-compose-body">'+html+'</div><footer><button class="tw-status-publish" data-tw-publish>Share status</button></footer></div>';document.body.append(overlay);
 overlay.addEventListener('click',async e=>{
  if(e.target===overlay){overlay.remove();return;}
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-tw-close')){overlay.remove();return;}
  if(b.dataset.twType){$$('[data-tw-type]',overlay).forEach(x=>x.classList.toggle('on',x===b));$('#tw-status-text-panel',overlay).hidden=b.dataset.twType!=='text';$('#tw-status-media-panel',overlay).hidden=b.dataset.twType!=='media';return;}
  if(b.dataset.twBg){overlay.dataset.bg=b.dataset.twBg;$('[data-tw-bg]',overlay).forEach(x=>x.classList.toggle('on',x===b));return;}
  if(b.dataset.twPickMedia){const input=$('#tw-status-file',overlay);if(input){input.value='';input.accept=b.dataset.twPickMedia==='image'?'image/*':'video/mp4,video/webm,video/quicktime';input.click();}return;}
  if(b.hasAttribute('data-tw-media-remove')){const input=$('#tw-status-file',overlay);if(input)input.value='';renderMediaPreview(overlay,null);return;}
  if(b.hasAttribute('data-tw-publish')){b.disabled=true;b.textContent='Sharing…';try{await publish(overlay,scope,spaceId);overlay.remove();}catch(err){toastS(err.message||'Could not share status.');b.disabled=false;b.textContent='Share status';}}
 });
 overlay.addEventListener('change',e=>{if(e.target.id==='tw-status-audience'){const p=$('#tw-status-privacy-people',overlay);if(p)p.hidden=!['except','selected'].includes(e.target.value);}if(e.target.id==='tw-status-file'){renderMediaPreview(overlay,e.target.files?.[0]||null);}});
}
function renderMediaPreview(overlay,file){
 const host=$('#tw-status-preview',overlay);if(!host)return;
 if(!file){host.innerHTML='';return;}
 const isVideo=file.type.startsWith('video/'),url=URL.createObjectURL(file);
 host.innerHTML='<div class="tw-media-preview-card"><div class="tw-media-preview-frame">'+(isVideo?'<video src="'+url+'" controls playsinline></video>':'<img src="'+url+'" alt="Selected status photo">')+'<span class="tw-media-preview-badge">'+(isVideo?'VIDEO':'PHOTO')+'</span></div><div class="tw-media-preview-meta"><span><b>'+escS(file.name)+'</b><small>'+(file.size/1048576).toFixed(1)+' MB · Ready to share</small></span><button type="button" data-tw-media-remove aria-label="Remove selected media">×</button></div></div>';
}
async function getVideoDuration(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),video=document.createElement('video');video.preload='metadata';video.onloadedmetadata=()=>{const duration=video.duration;URL.revokeObjectURL(url);resolve(duration);};video.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read this video.'));};video.src=url;});}
async function publish(overlay,scope,spaceId){
 const type=$('[data-tw-type].on',overlay)?.dataset.twType||'text',caption=$('#tw-status-caption',overlay)?.value.trim()||'',file=$('#tw-status-file',overlay)?.files?.[0]||null;
 if(type==='text'&&!caption)throw new Error('Write something before sharing.');
 if(type==='media'&&!file)throw new Error('Choose a photo or video first.');
 if(file){if(!file.type.startsWith('image/')&&!file.type.startsWith('video/'))throw new Error('Choose a photo or video.');if(file.size>(file.type.startsWith('video/')?50:15)*1048576)throw new Error('This file is too large.');if(file.type.startsWith('video/')){const duration=await getVideoDuration(file);if(duration>60)throw new Error('Videos must be 60 seconds or shorter.');}}
 let path=null,mime=null;
 if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,80)||'status-media';path=uid()+'/statuses/'+crypto.randomUUID()+'-'+safe;const {error}=await app().supabaseClient.storage.from(BUCKET).upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false});if(error)throw error;mime=file.type;}
 const audience=$('#tw-status-audience',overlay)?.value||'connections',selected=Array.from(overlay.querySelectorAll('#tw-status-privacy-people input:checked')).map(x=>x.value);if(scope==='main'&&audience==='selected'&&!selected.length)throw new Error('Choose at least one person for this privacy setting.');
 const {data,error}=await app().supabaseClient.rpc('create_tweaklr_status',{p_scope:scope,p_space_id:spaceId||null,p_status_type:type==='text'?'text':file.type.startsWith('video/')?'video':'image',p_caption:caption,p_media_path:path,p_media_mime:mime,p_text_background:overlay.dataset.bg||'#493224',p_audience:audience,p_included_user_ids:audience==='selected'?selected:[],p_excluded_user_ids:audience==='except'?selected:[]});
 if(error){if(path)await app().supabaseClient.storage.from(BUCKET).remove([path]);throw error;}
 toastS('Status shared.','check');
 if(scope==='main')await mountHome();else{const s=({id:spaceId,nature:scope});if(s)await mountSpace(s);}
}
async function openStatusPrivacy(){
 const [{data,error},{data:mutedRows,error:mutedError}]=await Promise.all([
  app().supabaseClient.rpc('get_tweaklr_status_read_receipts'),
  app().supabaseClient.rpc('get_tweaklr_muted_status_authors')
 ]);
 if(error){toastS('Status privacy settings are not available yet. Apply the Status SQL migration first.');return;}
 if(mutedError)console.warn('Tweaklr muted Status accounts could not be loaded:',mutedError.message);
 const mutedMarkup=(mutedRows||[]).map(p=>'<div class="tw-status-muted-row"><span>'+(p.avatar_url?'<img src="'+escS(p.avatar_url)+'">':'')+'<b>'+escS(p.display_name||p.username||'Tweaklr member')+'</b></span><button data-tw-unmute="'+escS(p.author_id)+'">Unmute</button></div>').join('');
 const overlay=document.createElement('div');overlay.className='tw-status-modal';overlay.innerHTML='<div class="tw-status-dialog"><header><button data-tw-close>×</button><div><b>Status privacy</b><small>Control what others can see.</small></div></header><div class="tw-status-compose-body"><label class="tw-status-receipt-toggle"><input type="checkbox" id="tw-status-read-receipts" '+(data===false?'':'checked')+'><span><b>Read receipts</b><small>When enabled, you can see who viewed your statuses and others can see when you view theirs.</small></span></label><p class="tw-status-note">Turning this off hides your status views from other people and hides their viewer lists from you. Status privacy choices are separate from your Space memberships.</p><section class="tw-status-muted"><b>Muted status accounts</b>'+(mutedMarkup||'<p>No muted accounts.</p>')+'</section></div><footer><button class="tw-status-publish" data-tw-privacy-save>Save privacy settings</button></footer></div>';document.body.append(overlay);
 overlay.addEventListener('click',async e=>{if(e.target.closest('[data-tw-close]')||e.target===overlay){overlay.remove();return;}const unmute=e.target.closest('[data-tw-unmute]');if(unmute){const {error:unmuteError}=await app().supabaseClient.rpc('toggle_tweaklr_status_mute',{p_author_id:unmute.dataset.twUnmute,p_muted:false});if(unmuteError){toastS(unmuteError.message);return;}unmute.closest('.tw-status-muted-row').remove();toastS('Statuses unmuted.','check');return;}if(e.target.closest('[data-tw-privacy-save]')){const enabled=$('#tw-status-read-receipts',overlay).checked;const {error:saveError}=await app().supabaseClient.rpc('set_tweaklr_status_read_receipts',{p_enabled:enabled});if(saveError){toastS(saveError.message);return;}overlay.remove();toastS('Status privacy updated.','check');}});
}
function closeViewer(){if(progressTimer)clearInterval(progressTimer);progressTimer=null;activeViewer=null;paused=false;$('.tw-status-viewer')?.remove();}
async function openViewer(authorId,scope,spaceId){
 const rows=await fetchStatuses(scope,spaceId),group=groups(rows).find(g=>g.authorId===authorId);if(!group?.statuses.length){if(authorId===uid())openComposer(scope,spaceId);return;}
 closeViewer();const allGroups=groups(rows);activeViewer={group,groups:allGroups,groupIndex:allGroups.findIndex(g=>g.authorId===authorId),scope,spaceId,index:0,rows};renderViewer();
}
async function renderViewer(){
 if(!activeViewer)return;if(progressTimer)clearInterval(progressTimer);progressTimer=null;
 const {group,index,scope,spaceId}=activeViewer,status=group.statuses[index];if(!status){closeViewer();return;}
 const overlay=document.createElement('div');overlay.className='tw-status-viewer';overlay.innerHTML='<div class="tw-status-viewer-card"><div class="tw-status-progress">'+group.statuses.map((s,i)=>'<span><i style="width:'+(i<index?'100%':'0%')+'"></i></span>').join('')+'</div><header><button data-tw-view-close>‹</button><span class="tw-status-viewer-avatar">'+(group.author.avatarUrl?'<img src="'+escS(group.author.avatarUrl)+'">':'')+'</span><div><b>'+escS(group.author.short||group.author.name||'Tweaklr member')+'</b><small>'+escS(new Date(status.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</small></div><button data-tw-view-more>•••</button></header><main class="tw-status-stage" style="background:'+(status.status_type==='text'?escS(status.text_background):'#100b09')+'">'+(status.status_type==='text'?'<p>'+escS(status.caption)+'</p>':status.status_type==='video'?'<video src="'+escS(status.media_url)+'" autoplay playsinline></video>':'<img src="'+escS(status.media_url)+'">')+(status.caption&&status.status_type!=='text'?'<div class="tw-status-caption">'+escS(status.caption)+'</div>':'')+'</main><footer>'+(group.mine?'<div class="tw-status-owner-actions"><button data-tw-viewers>◉ '+status.view_count+' views</button><button data-tw-delete>Delete status</button></div>':'<div class="tw-status-reactions">'+['❤️','😂','😮','😢','👏','🔥'].map(x=>'<button type="button" data-tw-react="'+x+'" aria-label="React '+x+'">'+x+'</button>').join('')+'</div><form class="tw-status-reply-form"><input id="tw-status-reply-input" type="text" maxlength="500" placeholder="Reply privately…" autocomplete="off"><button type="button" data-tw-reply aria-label="Send reply">➤</button></form>')+'</footer></div>';
 document.body.append(overlay);overlay.addEventListener('submit',e=>{if(e.target.matches('.tw-status-reply-form')){e.preventDefault();$('[data-tw-reply]',overlay)?.click();}});let suppressNextClick=false;const video=$('video',overlay);let duration=5000;if(video){video.addEventListener('loadedmetadata',()=>{duration=Math.max(5000,Math.min(60000,video.duration*1000));startProgress(duration);});video.addEventListener('ended',nextStatus);video.addEventListener('error',()=>startProgress(5000));if(video.readyState>=1)duration=Math.max(5000,Math.min(60000,video.duration*1000));}
 if(!status.is_mine&&!status.viewed){const {error:viewError}=await app().supabaseClient.rpc('mark_tweaklr_status_viewed',{p_status_id:status.id});if(!viewError){status.viewed=true;applyAvatarRings();}}
 if(!video||video.readyState>=1)startProgress(duration);
 overlay.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(b){if(b.hasAttribute('data-tw-view-close')){closeViewer();return;}if(b.hasAttribute('data-tw-view-more')){showStatusMenu(status,group,scope,spaceId);return;}if(b.hasAttribute('data-tw-viewers')){await showViewers(status);return;}if(b.hasAttribute('data-tw-delete')){if(confirm('Delete this status?')){const {data,error}=await app().supabaseClient.rpc('delete_tweaklr_status',{p_status_id:status.id});if(error){toastS(error.message);return;}if(data)await app().supabaseClient.storage.from(BUCKET).remove([data]);group.statuses.splice(index,1);if(!group.statuses.length)closeViewer();else{activeViewer.index=Math.min(index,group.statuses.length-1);renderViewer();}if(scope==='main')mountHome();else{const s=({id:spaceId,nature:scope});if(s)mountSpace(s);} }return;}if(b.dataset.twReact){const {error}=await app().supabaseClient.rpc('set_tweaklr_status_reaction',{p_status_id:status.id,p_reaction:b.dataset.twReact});if(error)toastS(error.message);else{b.classList.add('selected');toastS('Reaction sent.','check');}return;}if(b.hasAttribute('data-tw-reply')){const input=$('#tw-status-reply-input',overlay),reply=input?.value.trim();if(!reply)return;const fn=app().openChat,send=app().sendMessage;if(typeof fn!=='function'||typeof send!=='function'){toastS('Chat is not available right now.');return;}closeViewer();fn(group.authorId);setTimeout(()=>send(reply),350);return;}}
  if(suppressNextClick)return;const stage=e.target.closest('.tw-status-stage');if(stage){const rect=stage.getBoundingClientRect();if(e.clientX<rect.left+rect.width*.35)prevStatus();else if(e.clientX>rect.left+rect.width*.65)nextStatus();}
 });
 overlay.addEventListener('pointerdown',e=>{if(!e.target.closest('.tw-status-stage'))return;paused=true;if(progressTimer)clearInterval(progressTimer);if(video)video.pause();});
 let swipeX=0,swipeY=0;overlay.addEventListener('touchstart',e=>{const t=e.touches?.[0];if(t){swipeX=t.clientX;swipeY=t.clientY;}},{passive:true});overlay.addEventListener('touchend',e=>{const t=e.changedTouches?.[0];if(!t)return;const dx=t.clientX-swipeX,dy=t.clientY-swipeY;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)){suppressNextClick=true;setTimeout(()=>{suppressNextClick=false;},350);if(progressTimer)clearInterval(progressTimer);paused=false;dx<0?nextStatus():prevStatus();}else if(dy>100&&dy>Math.abs(dx)){suppressNextClick=true;setTimeout(()=>{suppressNextClick=false;},350);closeViewer();}else if(dy<-100&&Math.abs(dy)>Math.abs(dx)){suppressNextClick=true;setTimeout(()=>{suppressNextClick=false;},350);$('#tw-status-reply-input')?.focus();}},{passive:true});
 overlay.addEventListener('pointerup',e=>{if(!paused||!e.target.closest('.tw-status-stage'))return;paused=false;if(video)video.play().catch(()=>{});startProgress(remaining||5000);});
 overlay.addEventListener('pointercancel',()=>{if(!paused)return;paused=false;if(video)video.play().catch(()=>{});startProgress(remaining||5000);});
}
function startProgress(ms){if(!activeViewer)return;if(progressTimer)clearInterval(progressTimer);remaining=ms;startedAt=Date.now();const index=activeViewer.index;const bar=$$('.tw-status-progress i')[index];if(!bar)return;progressTimer=setInterval(()=>{if(paused)return;const elapsed=Date.now()-startedAt;remaining=Math.max(0,ms-elapsed);bar.style.width=Math.min(100,elapsed/ms*100)+'%';if(remaining<=0)nextStatus();},50);}
function nextStatus(){if(!activeViewer)return;activeViewer.index++;if(activeViewer.index>=activeViewer.group.statuses.length){const next=activeViewer.groupIndex+1;if(next>=activeViewer.groups.length){closeViewer();return;}activeViewer.groupIndex=next;activeViewer.group=activeViewer.groups[next];activeViewer.index=0;}renderViewer();}
function prevStatus(){if(!activeViewer)return;if(activeViewer.index>0)activeViewer.index--;else if(activeViewer.groupIndex>0){activeViewer.groupIndex--;activeViewer.group=activeViewer.groups[activeViewer.groupIndex];activeViewer.index=activeViewer.group.statuses.length-1;}renderViewer();}
async function showViewers(status){const {data,error}=await app().supabaseClient.rpc('get_tweaklr_status_viewers',{p_status_id:status.id});if(error){toastS(error.message);return;}const list=(data||[]).map(v=>'<div class="tw-status-viewer-row">'+(v.avatar_url?'<img src="'+escS(v.avatar_url)+'">':'')+'<span><b>'+escS(v.display_name||v.username||'Tweaklr member')+'</b><small>'+escS(new Date(v.viewed_at).toLocaleString())+'</small></span></div>').join('');const box=document.createElement('div');box.className='tw-status-list-modal';box.innerHTML='<div><header><b>Viewed by · '+(data||[]).length+'</b><button>×</button></header>'+(list||'<p>No views yet.</p>')+'</div>';box.querySelector('button').onclick=()=>box.remove();box.onclick=e=>{if(e.target===box)box.remove();};document.body.append(box);}
async function showStatusMenu(status,group,scope,spaceId){const muted=false;const box=document.createElement('div');box.className='tw-status-list-modal';box.innerHTML='<div><header><b>Status options</b><button>×</button></header>'+(group.mine?'<button data-menu-delete>Delete status</button>':'<button data-menu-mute>Mute this person\'s statuses</button>')+'</div>';box.querySelector('header button').onclick=()=>box.remove();box.addEventListener('click',async e=>{if(e.target.hasAttribute('data-menu-mute')){const {error}=await app().supabaseClient.rpc('toggle_tweaklr_status_mute',{p_author_id:group.authorId,p_muted:true});if(error)toastS(error.message);else{toastS('Statuses muted.','check');box.remove();closeViewer();if(scope==='main')void mountHome();else void mountSpace({id:spaceId,nature:scope});}}if(e.target.hasAttribute('data-menu-delete')){box.remove();if(confirm('Delete this status?')){const {data,error}=await app().supabaseClient.rpc('delete_tweaklr_status',{p_status_id:status.id});if(error){toastS(error.message);return;}if(data)await app().supabaseClient.storage.from(BUCKET).remove([data]);closeViewer();if(scope==='main')mountHome();else{const s=({id:spaceId,nature:scope});if(s)mountSpace(s);}}}});document.body.append(box);}
/* Prioritise the Home + control over other app-level click handlers. */
document.addEventListener('click',e=>{
 const compose=e.target.closest('[data-tw-status-compose]');
 if(!compose)return;
 e.preventDefault();
 e.stopPropagation();
 e.stopImmediatePropagation();
 openComposer(compose.dataset.twStatusCompose,compose.dataset.twStatusSpace||null);
},true);
document.addEventListener('click',e=>{
 if(e.target.closest('[data-tw-status-privacy]')){openStatusPrivacy();return;}
 const compose=e.target.closest('[data-tw-status-compose]');if(compose){openComposer(compose.dataset.twStatusCompose,compose.dataset.twStatusSpace||null);return;}
 const open=e.target.closest('[data-tw-status-open]');if(open){const tray=open.closest('[data-tw-status-scope]');openViewer(open.dataset.twStatusOpen,tray?.dataset.twStatusScope||'main',tray?.dataset.twStatusSpace||null);}
});
document.addEventListener('change',e=>{if(e.target.id==='tw-status-audience'){const p=$('#tw-status-privacy-people');if(p)p.hidden=!['except','selected'].includes(e.target.value);}});
document.addEventListener('click',e=>{const el=e.target.closest('.tw-avatar-has-status[data-profile-id]');if(!el)return;const scope=el.dataset.twStatusScope||'main',spaceId=el.dataset.twStatusSpace||null,group=groups(cache.get(scope+':'+(spaceId||''))||[]).find(g=>g.authorId===el.dataset.profileId);if(!group)return;e.preventDefault();e.stopImmediatePropagation();openViewer(group.authorId,scope,spaceId);},true);
const observer=new MutationObserver(()=>{if(cache.size)applyAvatarRings();const host=$('#home-status-tray');if(host&&!host.querySelector('.tw-status-tray')&&uid()&&!host.dataset.twStatusLoading){host.dataset.twStatusLoading='1';void mountHome().finally(()=>{delete host.dataset.twStatusLoading;});}});observer.observe(document.body,{subtree:true,childList:true});
/* Recover the Home strip if the app rendered before this module finished loading. */
let homeRetryCount=0;
const homeRetry=setInterval(()=>{const host=$('#home-status-tray');if(!host){if(++homeRetryCount>60)clearInterval(homeRetry);return;}
 if(!host.querySelector('.tw-status-tray'))void mountHome();
 if(host.querySelector('.tw-status-tray')||++homeRetryCount>60)clearInterval(homeRetry);
},500);
window.addEventListener('load',()=>{const host=$('#home-status-tray');if(host&&!host.querySelector('.tw-status-tray'))void mountHome();});
window.TweaklrStatus={mountHome,mountSpace,refresh:async()=>{await mountHome();const screen=document.getElementById('screen-space');const id=screen?.dataset.spaceId;const nature=screen?.dataset.nature;if(id&&['friendly','business'].includes(nature))await mountSpace({id,nature});}};
})();
