(function(){
'use strict';
const ADMIN_EMAIL='christopherconnell69@gmail.com';
const ADMIN_ID='c6af7732-71da-4e06-91b8-2cca899b3d81';
const SUPABASE_URL='https://avnuejgqaxygxeiyqeny.supabase.co';
const SUPABASE_KEY='sb_publishable_wF8lZnLfC-x9ySqXUqRcHQ_CI_QWrHW';
let client=null, currentUser=null, activeTab='overview', root=null, panel=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v?new Date(v).toLocaleString():'—';
function isAdmin(u){return !!u&&u.id===ADMIN_ID&&String(u.email||'').toLowerCase()===ADMIN_EMAIL&&['moderator','admin'].includes(String(u.app_metadata?.role||'').toLowerCase());}
async function call(action,extra={}){const {data,error}=await client.functions.invoke('admin-console',{body:{action,...extra}});if(error)throw error;if(data?.error)throw new Error(data.error);return data;}
function ensureUI(){
 if(document.getElementById('tweaklr-admin-launcher'))return;
 const b=document.createElement('button');b.id='tweaklr-admin-launcher';b.type='button';b.innerHTML='<span class="tac-moon">☾</span><span>Admin</span><i>✓</i>';b.setAttribute('aria-label','Open Tweaklr Admin Console');b.addEventListener('click',openPanel);document.body.appendChild(b);
 root=document.createElement('div');root.id='tweaklr-admin-root';root.hidden=true;root.innerHTML='<div class="tac-backdrop" data-tac-close></div><section class="tac-panel" role="dialog" aria-modal="true" aria-label="Tweaklr Admin Console"><header class="tac-head"><div class="tac-brand"><span class="tac-moon">☾</span><div><strong>Admin Console <i>✓</i></strong><small>Privileged operations · audited</small></div></div><button class="tac-close" data-tac-close aria-label="Close">×</button></header><nav class="tac-tabs"><button data-tab="overview">Overview</button><button data-tab="users">Users</button><button data-tab="posts">Content</button><button data-tab="comments">Comments</button><button data-tab="cases">Moderation</button><button data-tab="audit">Audit log</button></nav><main class="tac-main"><div id="tac-content"><div class="tac-loading">Loading Admin Console…</div></div></main></section>';
 document.body.appendChild(root);
 root.addEventListener('click',e=>{const close=e.target.closest('[data-tac-close]');if(close){closePanel();return;}const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;renderTab();}});
 root.addEventListener('click',handleAction);
}
function openPanel(){if(!root)return;root.hidden=false;document.body.classList.add('tac-open');renderTab();}
function closePanel(){if(root)root.hidden=true;document.body.classList.remove('tac-open');}
function setContent(html){const c=document.getElementById('tac-content');if(c)c.innerHTML=html;}
function setLoading(){setContent('<div class="tac-loading">Loading secure records…</div>');}
function errorView(e){setContent('<div class="tac-error">'+esc(e?.message||'Could not load this section.')+'</div>');}
function statsCard(label,value,sub){return '<article class="tac-stat"><small>'+label+'</small><strong>'+esc(value)+'</strong><span>'+sub+'</span></article>';}
async function renderTab(){
 if(!root||root.hidden)return;
 root.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('is-active',x.dataset.tab===activeTab));
 setLoading();
 try{
  if(activeTab==='overview'){
   const d=await call('overview'),s=d.stats||{};
   setContent('<div class="tac-section-title"><div><span>CONTROL ROOM</span><h2>Platform overview</h2><p>Live account and moderation indicators.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><div class="tac-stats">'+statsCard('Total accounts',s.total_accounts,'Registered profiles')+statsCard('Created in 24 hours',s.created_last_24h,'New profiles')+statsCard('Active · last 5 min',s.active_last_5m,'Recent authenticated sessions')+statsCard('Open review cases',s.open_cases,'Awaiting moderation')+'</div><div class="tac-note"><b>Admin identity active</b><span>Full-moon mark · gold verification · restricted to the authorised account.</span></div><div class="tac-note"><b>Security boundary</b><span>Emails and account records are available. Passwords, hashes, tokens and recovery secrets are never exposed.</span></div>');
  }else if(activeTab==='users'){
   const d=await call('users',{page:1});
   const rows=d.users||[];
   setContent('<div class="tac-section-title"><div><span>ACCOUNT DIRECTORY</span><h2>Every Tweaklr user</h2><p>Registered email, account status and conduct record.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><input class="tac-search" id="tac-user-search" placeholder="Search email, username or account ID…" /><div class="tac-list" id="tac-user-list">'+rows.map(userCard).join('')+'</div><p class="tac-footnote">Showing up to 50 accounts per page. Active-session count is based on sessions refreshed within five minutes.</p>');
   const search=document.getElementById('tac-user-search');let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(async()=>{try{const x=await call('users',{page:1,search:search.value});document.getElementById('tac-user-list').innerHTML=(x.users||[]).map(userCard).join('')||'<div class="tac-empty">No matching accounts.</div>';}catch(e){errorView(e);}},250);});
  }else if(activeTab==='posts'){
   const d=await call('posts',{limit:80});
   setContent('<div class="tac-section-title"><div><span>CONTENT OVERSIGHT</span><h2>Recent posts</h2><p>Review content across supported Tweaklr feeds and spaces.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><div class="tac-list">'+(d.posts||[]).map(postCard).join('')+'</div>');
  }else if(activeTab==='comments'){
   const d=await call('comments',{limit:80});
   setContent('<div class="tac-section-title"><div><span>COMMUNITY SAFETY</span><h2>Comments & voice notes</h2><p>Anonymous identities remain masked until an audited moderation reveal.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><div class="tac-list">'+(d.comments||[]).map(commentCard).join('')+'</div>');
  }else if(activeTab==='cases'){
   const d=await call('cases');
   setContent('<div class="tac-section-title"><div><span>TRUST & SAFETY</span><h2>Moderation cases</h2><p>Review reports and record evidence-based outcomes.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><div class="tac-list">'+(d.cases||[]).map(caseCard).join('')+'</div>');
  }else if(activeTab==='audit'){
   const d=await call('audit');
   setContent('<div class="tac-section-title"><div><span>ACCOUNTABILITY</span><h2>Admin audit log</h2><p>Privileged views and actions are recorded here.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><div class="tac-list">'+(d.events||[]).map(x=>'<article class="tac-row"><div class="tac-row-main"><b>'+esc(x.action)+'</b><small>'+esc(x.target_user_id||'Platform-wide')+' · '+time(x.created_at)+'</small><p>'+esc(JSON.stringify(x.details||{}))+'</p></div></article>').join('')+'</div>');
  }
 }catch(e){errorView(e);}
}
function userCard(u){return '<article class="tac-row"><div class="tac-avatar">'+(u.avatar_url?'<img src="'+esc(u.avatar_url)+'" alt="">':'☾')+'</div><div class="tac-row-main"><b>'+esc(u.display_name||u.username||'Tweaklr user')+'</b><small>@'+esc(u.username||'—')+' · '+esc(u.email)+'</small><p>Joined '+time(u.created_at)+' · Last sign-in '+time(u.last_sign_in_at)+'</p><div class="tac-pills"><span>Trust score '+esc(u.loyalty_score)+'%</span><span>'+esc(u.confirmed_violations)+' confirmed violations</span>'+(u.banned_until?'<span class="is-danger">Suspended until '+time(u.banned_until)+'</span>':'')+'</div></div><button class="tac-action" data-action="message" data-id="'+esc(u.id)+'" data-label="'+esc(u.display_name||u.email)+'">Message</button></article>';}
function postCard(p){return '<article class="tac-row tac-post"><div class="tac-row-main"><b>'+esc(p.source.replaceAll('_',' '))+'</b><small>'+esc(p.author?.display_name||p.author?.username||'Unknown author')+' · '+time(p.created_at)+'</small><p>'+esc(p.body||p.preview||'Media post')+'</p><small>Record: '+esc(p.id)+'</small></div><button class="tac-danger" data-action="delete-post" data-id="'+esc(p.id)+'" data-source="'+esc(p.source)+'">Delete</button></article>';}
function commentCard(c){return '<article class="tac-row"><div class="tac-row-main"><b>'+(c.anonymous?'Anonymous comment':'Comment')+'</b><small>'+esc(c.source)+' · '+time(c.created_at)+'</small><p>'+esc(c.body||'')+'</p>'+(c.voice_note?'<div class="tac-pills"><span>Voice note · '+esc(c.voice_duration||'duration unknown')+' sec</span>'+(c.voice_view_once?'<span>View once</span>':'')+'<span>Playback remains subject to the original view-once rules</span></div>':'')+(c.author?'<small>Author: '+esc(c.author.display_name||c.author.username||c.author.id)+'</small>':'<small>Author identity hidden</small>')+'</div><div class="tac-case-actions">'+(c.anonymous?'<button data-action="reveal-author" data-id="'+esc(c.id)+'" data-source="'+esc(c.source)+'">Reveal author</button>':'')+'<button class="tac-danger" data-action="delete-comment" data-id="'+esc(c.id)+'" data-source="'+esc(c.source)+'">Delete</button></div></article>';}
function caseCard(c){return '<article class="tac-row"><div class="tac-row-main"><b>'+esc(c.profile?.display_name||c.profile?.username||c.email||'Account review')+'</b><small>'+esc(c.email)+' · '+time(c.created_at)+'</small><p>'+esc(c.distinct_report_count||0)+' distinct reports · Status: '+esc(c.status)+' · Suspension applied: '+(c.suspension_applied?'Yes':'No')+'</p><small>Case '+esc(c.id)+'</small></div><div class="tac-case-actions"><button data-action="verdict" data-id="'+esc(c.id)+'" data-verdict="under_review">Review</button><button data-action="verdict" data-id="'+esc(c.id)+'" data-verdict="dismissed">Dismiss</button><button class="tac-danger" data-action="verdict" data-id="'+esc(c.id)+'" data-verdict="confirmed_violation">Confirm violation</button></div></article>';}
async function handleAction(e){
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action;
 try{
  if(action==='refresh'){renderTab();return;}
  if(action==='message'){
   const text=prompt('Send a private message to '+(b.dataset.label||'this user')+':');if(!text?.trim())return;
   await call('send_message',{target_user_id:b.dataset.id,message:text.trim()});alert('Admin message sent.');return;
  }
  if(action==='reveal-author'){
   if(!confirm('Reveal this anonymous author? The identity lookup will be permanently recorded in the Admin audit log.'))return;
   const d=await call('reveal_anonymous_comment',{comment_id:b.dataset.id,source:b.dataset.source});
   alert('Author: '+(d.author?.display_name||d.author?.username||d.author?.id||'Unknown'));
   return;
  }
  if(action==='delete-comment'){
   if(!confirm('Permanently delete this comment? This action will be audited.'))return;
   await call('delete_comment',{comment_id:b.dataset.id,source:b.dataset.source});b.closest('.tac-row')?.remove();return;
  }
  if(action==='delete-post'){
   if(!confirm('Permanently delete this content from Tweaklr? This action will be audited.'))return;
   await call('delete_post',{post_id:b.dataset.id,source:b.dataset.source});b.closest('.tac-row')?.remove();return;
  }
  if(action==='verdict'){
   const notes=prompt('Add review notes (required for an evidence-based decision):');if(notes===null||!notes.trim())return;
   if(!confirm('Confirm moderation decision: '+b.dataset.verdict.replaceAll('_',' ')+'?'))return;
   await call('review_case',{case_id:b.dataset.id,verdict:b.dataset.verdict,notes});renderTab();return;
  }
 }catch(err){alert(err?.message||'Action failed.');}
}
async function init(){
 if(!window.supabase?.createClient)return;
 client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const check=async()=>{try{const {data}=await client.auth.getUser();currentUser=data?.user||null;if(isAdmin(currentUser)){ensureUI();}else{document.getElementById('tweaklr-admin-launcher')?.remove();document.getElementById('tweaklr-admin-root')?.remove();root=null;}}catch(_){}};
 await check();client.auth.onAuthStateChange(()=>{setTimeout(check,0);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();