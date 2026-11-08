/* Tweaklr unified Status — shared engine for Home, Friendly and Business Spaces. */
(function(){
'use strict';
const HOUR=3600000,DAY=24*HOUR,BUCKET='ming-post-media';
let cache=new Map(),activeViewer=null,progressTimer=null,paused=false,startedAt=0,remaining=0;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const escS=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>window.currentUser?.id||'';
const profile=(id,row)=>id===uid()?window.currentUser:{id,name:row?.author_display_name||row?.display_name||row?.author_username||'Tweaklr member',short:row?.author_display_name||row?.display_name||row?.author_username||'Tweaklr member',username:row?.author_username?'@'+String(row.author_username).replace(/^@/,''):'',avatarUrl:row?.author_avatar_url||row?.avatar_url||'',hue:24};
function toastS(t,type){if(typeof window.toast==='function')window.toast(t,type||'alert');else console.info(t);}
function spaceScope(s){return s?.nature==='friendly'?'friendly':s?.nature==='business'?'business':'main';}
async function fetchStatuses(scope='main',spaceId=null){
 if(!window.supabaseClient||!uid())return [];
 const {data,error}=await supabaseClient.rpc('get_tweaklr_statuses',{p_scope:scope,p_space_id:spaceId});
 if(error){console.warn('Tweaklr Status load failed:',error.message);return [];}
 const rows=await Promise.all((data||[]).map(async r=>{
   let mediaUrl='';
   if(r.media_path){const {data:signed,error:signedError}=await supabaseClient.storage.from(BUCKET).createSignedUrl(r.media_path,3600);if(!signedError)mediaUrl=signed?.signedUrl||'';}
   return {...r,media_url:mediaUrl,author:profile(r.author_id,r),createdMs:new Date(r.created_at).getTime(),expiresMs:new Date(r.expires_at).getTime()};
 }));
 cache.set(scope+':'+(spaceId||''),rows);
 return rows;
}
function groups(rows){const map=new Map();rows.forEach(r=>{if(!map.has(r.author_id))map.set(r.author_id,[]);map.get(r.author_id).push(r);});return [...map.values()].map(a=>({authorId:a[0].author_id,author:a[0].author,statuses:a.sort((x,y)=>x.createdMs-y.createdMs),allViewed:a.every(x=>x.viewed||x.is_mine),mine:a[0].author_id===uid()}));}
function ringMarkup(g,add=false){const p=g.author||window.currentUser;const img=p.avatarUrl?'<img src="'+escS(p.avatarUrl)+'" alt="">':'<span>'+escS((p.short||p.name||'T').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase())+'</span>';return '<button class="tw-status-person '+(g.allViewed?'is-seen':'is-new')+(g.mine?' is-mine':'')+'" data-tw-status-open="'+escS(g.authorId)+'" aria-label="'+(g.mine?'Your status':'View '+escS(p.short||p.name)+' status')+'"><span class="tw-status-ring"><span class="tw-status-avatar">'+img+'</span>'+(add?'<i>＋</i>':'')+'</span><small>'+(g.mine?'Your status':escS((p.short||p.name||'Member').split(' ')[0]))+'</small></button>';}
function trayHTML(rows,scope,spaceId){
 const gs=groups(rows),mine=gs.find(g=>g.mine),others=gs.filter(g=>!g.mine);
 const add=mine||{authorId:uid(),author:window.currentUser,statuses:[],mine:true,allViewed:true};
 return '<section class="tw-status-tray" data-tw-status-scope="'+scope+'" data-tw-status-space="'+escS(spaceId||'')+'"><div class="tw-status-tray-head"><div><span>THE MOMENTS THAT MATTER</span><h3>Statuses</h3></div><button data-tw-status-compose="'+scope+'" data-tw-status-space="'+escS(spaceId||'')+'">＋ Add status</button></div><div class="tw-status-row">'+ringMarkup(add,true)+others.map(g=>ringMarkup(g)).join('')+'</div></section>';
}
async function mountHome(){
 const host=$('#home-status-tray');if(!host)return;
 const rows=await fetchStatuses('main',null);host.innerHTML=trayHTML(rows,'main',null);
 applyAvatarRings(rows);
}
async function mountSpace(space){
 const host=$('#sp-body');if(!host||!space||!['friendly','business'].includes(space.nature))return;
 let tray=$('#tw-space-status-mount',host);if(!tray){tray=document.createElement('div');tray.id='tw-space-status-mount';host.prepend(tray);}
 const rows=await fetchStatuses(spaceScope(space),space.id);tray.innerHTML=trayHTML(rows,spaceScope(space),space.id);
 applyAvatarRings(rows);
}
function applyAvatarRings(rows){
 const ids=new Set(rows.map(r=>r.author_id));
 $$('[data-profile-id]').forEach(el=>{const id=el.dataset.profileId;if(!ids.has(id))return;const personRows=rows.filter(r=>r.author_id===id);el.classList.add('tw-avatar-has-status');el.classList.toggle('tw-avatar-status-seen',personRows.every(r=>r.viewed||r.is_mine));});
}
function openComposer(scope,spaceId){
 const main=scope==='main',people=main?(window.connections||[]).map(c=>c.personId).filter(Boolean):[];
 const profiles=people.map(id=>window.mingConnectionProfiles?.get(id)).filter(Boolean);
 const privacy=main?'<div class="tw-status-field"><label>Status privacy</label><select id="tw-status-audience"><option value="connections">My connections</option><option value="except">My connections except…</option><option value="selected">Only share with…</option></select></div><div class="tw-status-field" id="tw-status-privacy-people" hidden><label>Select people</label><div class="tw-status-people">'+profiles.map(p=>'<label><input type="checkbox" value="'+escS(p.id)+'"><span>'+(p.avatarUrl?'<img src="'+escS(p.avatarUrl)+'">':'')+escS(p.short||p.name)+'</span></label>').join('')+'</div></div>':'<p class="tw-status-note">Visible to approved members of this '+(scope==='friendly'?'Friendly':'Business')+' Space.</p>';
 const html='<div class="tw-status-compose" data-scope="'+scope+'" data-space="'+escS(spaceId||'')+'"><div class="tw-status-type-switch"><button class="on" data-tw-type="text">Text</button><button data-tw-type="media">Photo / video</button></div><div id="tw-status-text-panel"><textarea id="tw-status-caption" maxlength="700" placeholder="Type a status…"></textarea><div class="tw-status-colors">'+['#5B332A','#8B3543','#263B52','#315448','#5A4775','#202020'].map(c=>'<button style="background:'+c+'" data-tw-bg="'+c+'" aria-label="Text background"></button>').join('')+'</div></div><div id="tw-status-media-panel" hidden><input id="tw-status-file" type="file" accept="image/*,video/mp4,video/webm,video/quicktime"><div id="tw-status-preview"></div><p>Photos up to 15 MB · videos up to 50 MB and 60 seconds.</p></div>'+privacy+'</div>';
 const overlay=document.createElement('div');overlay.className='tw-status-modal';overlay.innerHTML='<div class="tw-status-dialog"><header><button data-tw-close>×</button><div><b>Create status</b><small>It disappears after 24 hours.</small></div></header><div class="tw-status-compose-body">'+html+'</div><footer><button class="tw-status-publish" data-tw-publish>Share status</button></footer></div>';document.body.append(overlay);
 overlay.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-tw-close')){overlay.remove();return;}
  if(b.dataset.twType){$$('[data-tw-type]',overlay).forEach(x=>x.classList.toggle('on',x===b));$('#tw-status-text-panel',overlay).hidden=b.dataset.twType!=='text';$('#tw-status-media-panel',overlay).hidden=b.dataset.twType!=='media';return;}
  if(b.dataset.twBg){overlay.dataset.bg=b.dataset.twBg;$$('[data-tw-bg]',overlay).forEach(x=>x.classList.toggle('on',x===b));return;}
  if(b.hasAttribute('data-tw-publish')){b.disabled=true;b.textContent='Sharing…';try{await publish(overlay,scope,spaceId);overlay.remove();}catch(err){toastS(err.message||'Could not share status.');b.disabled=false;b.textContent='Share status';}}
 });
 overlay.addEventListener('change',e=>{if(e.target.id==='tw-status-audience')$('#tw-status-privacy-people',overlay).hidden===false?$('#tw-status-privacy-people',overlay).hidden=!['except','selected'].includes(e.target.value):$('#tw-status-privacy-people',overlay).hidden=!['except','selected'].includes(e.target.value);if(e.target.id==='tw-status-file'){const f=e.target.files?.[0],p=$('#tw-status-preview',overlay);p.innerHTML=f?'<p>'+escS(f.name)+' · '+(f.size/1048576).toFixed(1)+' MB</p>':'';}});
}
async function publish(overlay,scope,spaceId){
 const type=$('[data-tw-type].on',overlay)?.dataset.twType||'text',caption=$('#tw-status-caption',overlay)?.value.trim()||'',file=$('#tw-status-file',overlay)?.files?.[0]||null;
 if(type==='text'&&!caption)throw new Error('Write something before sharing.');
 if(type==='media'&&!file)throw new Error('Choose a photo or video first.');
 if(file){if(!file.type.startsWith('image/')&&!file.type.startsWith('video/'))throw new Error('Choose a photo or video.');if(file.size>(file.type.startsWith('video/')?50:15)*1048576)throw new Error('This file is too large.');if(file.type.startsWith('video/')&&file.duration>60)throw new Error('Videos must be 60 seconds or shorter.');}
 let path=null,mime=null;
 if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,80)||'status-media';path=uid()+'/statuses/'+crypto.randomUUID()+'-'+safe;const {error}=await supabaseClient.storage.from(BUCKET).upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false});if(error)throw error;mime=file.type;}
 const audience=$('#tw-status-audience',overlay)?.value||'connections',selected=$$('#tw-status-privacy-people input:checked',overlay).map(x=>x.value);
 const {data,error}=await supabaseClient.rpc('create_tweaklr_status',{p_scope:scope,p_space_id:spaceId||null,p_status_type:type==='text'?'text':file.type.startsWith('video/')?'video':'image',p_caption:caption,p_media_path:path,p_media_mime:mime,p_text_background:overlay.dataset.bg||'#5B332A',p_audience:audience,p_included_user_ids:audience==='selected'?selected:[],p_excluded_user_ids:audience==='except'?selected:[]});
 if(error){if(path)await supabaseClient.storage.from(BUCKET).remove([path]);throw error;}
 toastS('Status shared.','check');
 if(scope==='main')await mountHome();else{const s=window.spaceById?.(spaceId);if(s)await mountSpace(s);}
}
function closeViewer(){if(progressTimer)clearInterval(progressTimer);progressTimer=null;activeViewer=null;paused=false;$('.tw-status-viewer')?.remove();}
async function openViewer(authorId,scope,spaceId){
 const rows=await fetchStatuses(scope,spaceId),group=groups(rows).find(g=>g.authorId===authorId);if(!group?.statuses.length)return;
 closeViewer();activeViewer={group,scope,spaceId,index:0,rows};renderViewer();
}
function renderViewer(){
 if(!activeViewer)return;if(progressTimer)clearInterval(progressTimer);progressTimer=null;
 const {group,index}=activeViewer,status=group.statuses[index];if(!status){closeViewer();return;}
 const overlay=document.createElement('div');overlay.className='tw-status-viewer';overlay.innerHTML='<div class="tw-status-viewer-card"><div class="tw-status-progress">'+group.statuses.map((s,i)=>'<span><i style="width:'+(i<index?'100%':'0%')+'"></i></span>').join('')+'</div><header><button data-tw-view-close>‹</button><span class="tw-status-viewer-avatar">'+(group.author.avatarUrl?'<img src="'+escS(group.author.avatarUrl)+'">':'')+'</span><div><b>'+escS(group.author.short||group.author.name||'Tweaklr member')+'</b><small>'+escS(new Date(status.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</small></div><button data-tw-view-more>•••</button></header><main class="tw-status-stage" style="background:'+(status.status_type==='text'?escS(status.text_background):'#100b09')+'">'+(status.status_type==='text'?'<p>'+escS(status.caption)+'</p>':status.status_type==='video'?'<video src="'+escS(status.media_url)+'" autoplay playsinline></video>':'<img src="'+escS(status.media_url)+'">')+(status.caption&&status.status_type!=='text'?'<div class="tw-status-caption">'+escS(status.caption)+'</div>':'')+'</main><footer>'+(group.mine?'<button data-tw-viewers>◉ '+status.view_count+' views</button><button data-tw-delete>Delete</button>':'<div class="tw-status-reactions">'+['❤️','😂','😮','😢','👏','🔥'].map(x=>'<button data-tw-react="'+x+'">'+x+'</button>').join('')+'</div><button data-tw-reply>Reply</button>')+'</footer></div>';
 document.body.append(overlay);const video=$('video',overlay);let duration=5000;if(video){video.addEventListener('loadedmetadata',()=>{duration=Math.max(5000,Math.min(60000,video.duration*1000));startProgress(duration);});video.addEventListener('ended',nextStatus);if(video.readyState>=1)duration=Math.max(5000,Math.min(60000,video.duration*1000));}
 if(!status.is_mine&&!status.viewed){await supabaseClient.rpc('mark_tweaklr_status_viewed',{p_status_id:status.id});status.viewed=true;}
 if(!video||video.readyState>=1)startProgress(duration);
 overlay.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(b){if(b.hasAttribute('data-tw-view-close')){closeViewer();return;}if(b.hasAttribute('data-tw-view-more')){showStatusMenu(status,group,scope,spaceId);return;}if(b.hasAttribute('data-tw-viewers')){await showViewers(status);return;}if(b.hasAttribute('data-tw-delete')){if(confirm('Delete this status?')){const {data,error}=await supabaseClient.rpc('delete_tweaklr_status',{p_status_id:status.id});if(error){toastS(error.message);return;}if(data)await supabaseClient.storage.from(BUCKET).remove([data]);group.statuses.splice(index,1);if(!group.statuses.length)closeViewer();else{activeViewer.index=Math.min(index,group.statuses.length-1);renderViewer();}if(scope==='main')mountHome();else{const s=window.spaceById?.(spaceId);if(s)mountSpace(s);} }return;}if(b.dataset.twReact){const {error}=await supabaseClient.rpc('set_tweaklr_status_reaction',{p_status_id:status.id,p_reaction:b.dataset.twReact});if(error)toastS(error.message);else{b.classList.add('selected');toastS('Reaction sent.','check');}return;}if(b.hasAttribute('data-tw-reply')){const fn=window.openChat||window.openConversation;if(typeof fn==='function')fn(group.authorId);else toastS('Open the member profile to start a conversation.');return;}}
  const stage=e.target.closest('.tw-status-stage');if(stage){const rect=stage.getBoundingClientRect();if(e.clientX<rect.left+rect.width*.35)prevStatus();else nextStatus();}
 });
 overlay.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;paused=true;if(progressTimer)clearInterval(progressTimer);if(video)video.pause();});
 overlay.addEventListener('pointerup',()=>{if(!paused)return;paused=false;if(video)video.play().catch(()=>{});startProgress(remaining||5000);});
}
function startProgress(ms){if(!activeViewer)return;remaining=ms;startedAt=Date.now();const index=activeViewer.index;const bar=$$('.tw-status-progress i')[index];if(!bar)return;progressTimer=setInterval(()=>{if(paused)return;const elapsed=Date.now()-startedAt;remaining=Math.max(0,ms-elapsed);bar.style.width=Math.min(100,elapsed/ms*100)+'%';if(remaining<=0)nextStatus();},50);}
function nextStatus(){if(!activeViewer)return;activeViewer.index++;if(activeViewer.index>=activeViewer.group.statuses.length){closeViewer();return;}renderViewer();}
function prevStatus(){if(!activeViewer)return;activeViewer.index=Math.max(0,activeViewer.index-1);renderViewer();}
async function showViewers(status){const {data,error}=await supabaseClient.rpc('get_tweaklr_status_viewers',{p_status_id:status.id});if(error){toastS(error.message);return;}const list=(data||[]).map(v=>'<div class="tw-status-viewer-row">'+(v.avatar_url?'<img src="'+escS(v.avatar_url)+'">':'')+'<span><b>'+escS(v.display_name||v.username||'Tweaklr member')+'</b><small>'+escS(new Date(v.viewed_at).toLocaleString())+'</small></span></div>').join('');const box=document.createElement('div');box.className='tw-status-list-modal';box.innerHTML='<div><header><b>Viewed by · '+(data||[]).length+'</b><button>×</button></header>'+(list||'<p>No views yet.</p>')+'</div>';box.querySelector('button').onclick=()=>box.remove();box.onclick=e=>{if(e.target===box)box.remove();};document.body.append(box);}
async function showStatusMenu(status,group,scope,spaceId){const muted=false;const box=document.createElement('div');box.className='tw-status-list-modal';box.innerHTML='<div><header><b>Status options</b><button>×</button></header>'+(group.mine?'<button data-menu-delete>Delete status</button>':'<button data-menu-mute>Mute this person\'s statuses</button>')+'</div>';box.querySelector('header button').onclick=()=>box.remove();box.addEventListener('click',async e=>{if(e.target.hasAttribute('data-menu-mute')){const {error}=await supabaseClient.rpc('toggle_tweaklr_status_mute',{p_author_id:group.authorId,p_muted:true});if(error)toastS(error.message);else{toastS('Statuses muted.','check');box.remove();closeViewer();}}if(e.target.hasAttribute('data-menu-delete')){box.remove();if(confirm('Delete this status?')){const {data,error}=await supabaseClient.rpc('delete_tweaklr_status',{p_status_id:status.id});if(error){toastS(error.message);return;}if(data)await supabaseClient.storage.from(BUCKET).remove([data]);closeViewer();if(scope==='main')mountHome();else{const s=window.spaceById?.(spaceId);if(s)mountSpace(s);}}}});document.body.append(box);}
document.addEventListener('click',e=>{
 const compose=e.target.closest('[data-tw-status-compose]');if(compose){openComposer(compose.dataset.twStatusCompose,compose.dataset.twStatusSpace||null);return;}
 const open=e.target.closest('[data-tw-status-open]');if(open){const tray=open.closest('[data-tw-status-scope]');openViewer(open.dataset.twStatusOpen,tray?.dataset.twStatusScope||'main',tray?.dataset.twStatusSpace||null);}
});
document.addEventListener('change',e=>{if(e.target.id==='tw-status-audience'){const p=$('#tw-status-privacy-people');if(p)p.hidden=!['except','selected'].includes(e.target.value);}});
const observer=new MutationObserver(()=>{const rows=[...cache.values()].flat();if(rows.length)applyAvatarRings(rows);});observer.observe(document.body,{subtree:true,childList:true});
window.TweaklrStatus={mountHome,mountSpace,refresh:async()=>{await mountHome();const s=window.spaceById?.(window.sp?.activeId);if(s)await mountSpace(s);}};
})();
