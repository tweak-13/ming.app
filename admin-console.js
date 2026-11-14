(function(){
'use strict';
const ADMIN_EMAIL='christopherconnell69@gmail.com';
const ADMIN_ID='c6af7732-71da-4e06-91b8-2cca899b3d81';
const SUPABASE_URL='https://avnuejgqaxygxeiyqeny.supabase.co';
const SUPABASE_KEY='sb_publishable_wF8lZnLfC-x9ySqXUqRcHQ_CI_QWrHW';
let client=null, currentUser=null, activeTab='overview', activeModule='spaces', root=null, panel=null, usersPage=1, usersSearch='';
const MODULES=[['Command shell & search',40,'Available','Global navigation, search, saved views and command palette'],['Overview & platform health',60,'Available','Account growth, activity, queue health and service indicators'],['Users & account lifecycle',130,'Available','Identity lookup, account status, conduct history and interventions'],['Trust, safety & moderation',130,'Available','Reports, review cases, enforcement and appeals'],['Content governance',90,'Available','Posts, comments, removals and content history'],['Messaging oversight',60,'Planned','Conversation safety, spam signals and admin communications'],['Spaces operations',70,'Planned','Space owners, membership, permissions and policy review'],['Places & discovery',60,'Planned','Place review, audience matching and location privacy'],['Commerce & wallet oversight',80,'Planned · schema review','Marketplace, disputes, refunds and ledger oversight'],['Analytics & experimentation',80,'Planned','Retention, cohorts, funnels and experiments'],['Growth & notifications',70,'Planned','Campaigns, notification templates and frequency controls'],['Support operations',70,'Planned','Tickets, escalations, macros and service levels'],['Privacy & data requests',60,'Planned','Access, export, deletion, consent and retention'],['Security & access control',80,'Planned','Staff roles, permissions, sessions and break-glass'],['Audit & compliance',60,'Available','Privileged activity, accountability and evidence'],['Developer & platform operations',70,'Planned','Jobs, functions, database, storage and deployments'],['Configuration & feature flags',40,'Planned','Rollouts, kill switches and remote configuration'],['Incident response',50,'Planned','Incident command, runbooks and emergency controls']];

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v?new Date(v).toLocaleString():'—';
function isAdmin(u){return !!u&&u.id===ADMIN_ID&&String(u.email||'').toLowerCase()===ADMIN_EMAIL&&['moderator','admin'].includes(String(u.app_metadata?.role||'').toLowerCase());}
async function call(action,extra={}){const {data,error}=await client.functions.invoke('admin-console',{body:{action,...extra}});if(error)throw error;if(data?.error)throw new Error(data.error);return data;}
function ensureUI(){
 if(document.getElementById('tweaklr-admin-launcher'))return;
 const b=document.createElement('button');b.id='tweaklr-admin-launcher';b.type='button';b.innerHTML='<span class="tac-moon">🌕</span><span class="tac-launcher-label">Admin</span><i>✓</i>';b.setAttribute('aria-label','Open Tweaklr Admin Console');b.title='Admin Console';b.addEventListener('click',openPanel);
 const brand=document.querySelector('#screen-home .brand');
 if(brand){brand.parentElement.classList.add('tac-home-brand');brand.parentElement.insertBefore(b,brand);}else{document.body.appendChild(b);}
 root=document.createElement('div');root.id='tweaklr-admin-root';root.hidden=true;root.innerHTML='<div class="tac-backdrop" data-tac-close></div><section class="tac-panel tac-command" role="dialog" aria-modal="true" aria-label="Tweaklr Platform Command Centre"><aside class="tac-sidebar"><div class="tac-side-brand"><span>☾</span><div><b>TWEAKLR</b><small>PLATFORM COMMAND</small></div></div><div class="tac-env"><i></i> PRODUCTION ENVIRONMENT</div><div class="tac-side-label">COMMAND</div><button class="tac-nav is-active" data-tab="overview"><span>◈</span> Control room</button><button class="tac-nav" data-tab="users"><span>♙</span> User directory</button><button class="tac-nav" data-tab="posts"><span>▤</span> Content governance</button><button class="tac-nav" data-tab="comments"><span>☷</span> Conversations & comments</button><button class="tac-nav" data-tab="cases"><span>⚑</span> Trust & safety <em>LIVE</em></button><button class="tac-nav" data-tab="audit"><span>◷</span> Audit & accountability</button><div class="tac-side-label">PLATFORM MODULES</div><button class="tac-nav" data-roadmap="spaces"><span>▦</span> Spaces operations</button><button class="tac-nav" data-roadmap="places"><span>⌖</span> Places & discovery</button><button class="tac-nav" data-roadmap="messaging"><span>✉</span> Messaging systems</button><button class="tac-nav" data-roadmap="commerce"><span>◇</span> Commerce & wallet</button><button class="tac-nav" data-roadmap="analytics"><span>⌁</span> Intelligence & analytics</button><button class="tac-nav" data-roadmap="security"><span>⛨</span> Security & access</button><button class="tac-nav" data-roadmap="operations"><span>⚙</span> Platform operations</button><div class="tac-side-spacer"></div><div class="tac-side-user"><span class="tac-admin-avatar">☾</span><div><b>Tweaklr Admin</b><small>OWNER ACCESS · VERIFIED</small></div><i>✓</i></div></aside><div class="tac-workspace"><header class="tac-head"><div class="tac-mobile-brand"><span>☾</span><b>COMMAND CENTRE</b></div><div class="tac-top-search"><span>⌕</span><input id="tac-command-search" placeholder="Search accounts by email, username or ID…" aria-label="Search Admin Console"/><kbd>⌘ K</kbd></div><div class="tac-head-right"><span class="tac-live-dot">SYSTEM LIVE</span><span class="tac-head-owner">OWNER <i>✓</i></span><button class="tac-close" data-tac-close aria-label="Close">×</button></div></header><main class="tac-main"><div id="tac-content"><div class="tac-loading">Loading secure operations…</div></div></main></div></section>';
 document.body.appendChild(root);
 root.addEventListener('click',e=>{const close=e.target.closest('[data-tac-close]');if(close){closePanel();return;}const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;renderTab();return;}const roadmap=e.target.closest('[data-roadmap]');if(roadmap){activeTab='roadmap';activeModule=roadmap.dataset.roadmap;renderTab();}});
 root.addEventListener('click',handleAction);
 const commandSearch=root.querySelector('#tac-command-search');
 if(commandSearch){commandSearch.addEventListener('keydown',e=>{if(e.key==='Enter'&&commandSearch.value.trim()){usersSearch=commandSearch.value.trim();usersPage=1;activeTab='users';renderTab();}});}
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
 root.querySelectorAll('[data-roadmap]').forEach(x=>x.classList.toggle('is-active',activeTab==='roadmap'&&x.dataset.roadmap===activeModule));
 setLoading();
 try{
  if(activeTab==='overview'){
   const d=await call('overview'),s=d.stats||{};
   const total=MODULES.reduce((n,m)=>n+m[1],0);
   setContent('<div class="tac-hero"><div><span class="tac-eyebrow">TWEAKLR · PLATFORM OPERATIONS</span><h1>Good to have you back.</h1><p>Your platform, at a glance. Every privileged action is permission-checked and audited.</p></div><div class="tac-hero-mark">☾<small>OWNER</small></div></div><div class="tac-section-title"><div><span>LIVE PULSE</span><h2>Platform intelligence</h2><p>Current operational signals from Tweaklr.</p></div><button class="tac-refresh" data-action="refresh">↻ Refresh</button></div><div class="tac-stats">'+statsCard('Total accounts',s.total_accounts,'Registered profiles')+statsCard('New · 24 hours',s.created_last_24h,'New registrations')+statsCard('Active · 5 minutes',s.active_last_5m,'Recent sessions')+statsCard('Open review cases',s.open_cases,'Awaiting moderation')+'</div><div class="tac-overview-grid"><section class="tac-feature-card"><div class="tac-card-top"><span>OPERATIONS INDEX</span><b>'+total.toLocaleString()+' CAPABILITIES</b></div><h3>One command centre.<br/>Every layer of Tweaklr.</h3><p>A phased catalogue of 1,300 distinct platform operations across 18 modules. Planned capabilities are clearly marked—not presented as working controls.</p><div class="tac-module-progress"><i></i></div><small>6 modules currently connected to existing Admin actions · expansion roadmap below</small><button class="tac-outline" data-roadmap="spaces">Explore the platform map →</button></section><section class="tac-feature-card tac-security-card"><span>SECURITY POSTURE</span><div class="tac-security-orb">✓</div><h3>Privileged access protected</h3><p>Owner identity verified · service-side authorisation · audit trail enabled.</p><div class="tac-security-line"><i></i> ADMIN SESSION RECOGNISED</div><small>Passwords, hashes, tokens and recovery secrets are never exposed.</small></section></div><div class="tac-section-title tac-module-heading"><div><span>COMMAND DIRECTORY</span><h2>Platform modules</h2><p>Explore the complete 1,300-capability operating map.</p></div></div><div class="tac-module-grid">'+MODULES.map((m,i)=>'<button class="tac-module-card" data-roadmap="'+i+'"><span class="tac-module-index">'+String(i+1).padStart(2,'0')+'</span><b>'+esc(m[0])+'</b><strong>'+m[1]+'</strong><small>'+esc(m[2])+'</small></button>').join('')+'</div>');
  }else if(activeTab==='roadmap'){
   const m=MODULES.find((x,i)=>String(i)===activeModule)||MODULES.find(x=>x[0].toLowerCase().includes(activeModule));
   setContent('<div class="tac-section-title"><div><span>PLATFORM MODULE / CAPABILITY MAP</span><h2>'+esc(m?.[0]||'Platform modules')+'</h2><p>'+esc(m?.[3]||'A phased catalogue of platform capabilities.')+'</p></div><button class="tac-refresh" data-tab="overview">← Control room</button></div><div class="tac-roadmap-banner"><strong>'+esc(m?.[1]??1300)+'</strong><div><b>Capability catalogue</b><small>'+esc(m?.[2]||'Planned')+' · roadmap status, not all live actions</small></div></div><div class="tac-note"><b>Implementation standard</b><span>Each capability will have a defined permission, risk tier, reason capture, backend enforcement and audit event before it is marked available.</span></div><div class="tac-empty">This module is on the Tweaklr Admin roadmap. Its controls will appear here as each backend workflow is implemented and verified.</div>');
  }else if(activeTab==='users'){
   usersPage=1;usersSearch='';
   const d=await call('users',{page:usersPage,search:usersSearch});
   const rows=d.users||[];
   setContent('<div class="tac-section-title"><div><span>ACCOUNT DIRECTORY</span><h2>Every Tweaklr user</h2><p>Registered email, account status and conduct record.</p></div><button class="tac-refresh" data-action="refresh">Refresh</button></div><input class="tac-search" id="tac-user-search" placeholder="Search email, username or account ID…" /><div class="tac-list" id="tac-user-list">'+rows.map(userCard).join('')+'</div><p class="tac-footnote">Showing up to 50 accounts per page. Active-session count is based on sessions refreshed within five minutes.</p>');
   const search=document.getElementById('tac-user-search');let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(async()=>{try{usersPage=1;usersSearch=search.value;const x=await call('users',{page:usersPage,search:usersSearch});document.getElementById('tac-user-list').innerHTML=(x.users||[]).map(userCard).join('')||'<div class="tac-empty">No matching accounts.</div>';document.getElementById('tac-user-pagination').innerHTML=userPagination(x.has_more);}catch(e){errorView(e);}},250);});
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
function userPagination(hasMore){return '<button data-action="users-page" data-page="'+Math.max(1,usersPage-1)+'" '+(usersPage<=1?'disabled':'')+'>Previous</button><span>Page '+usersPage+'</span><button data-action="users-page" data-page="'+(usersPage+1)+'" '+(!hasMore?'disabled':'')+'>Next</button>';}
function userCard(u){return '<article class="tac-row"><div class="tac-avatar">'+(u.avatar_url?'<img src="'+esc(u.avatar_url)+'" alt="">':'☾')+'</div><div class="tac-row-main"><b>'+esc(u.display_name||u.username||'Tweaklr user')+'</b><small>@'+esc(u.username||'—')+' · '+esc(u.email)+'</small><p>Joined '+time(u.created_at)+' · Last sign-in '+time(u.last_sign_in_at)+'</p><div class="tac-pills"><span>Trust score '+esc(u.loyalty_score)+'%</span><span>'+esc(u.confirmed_violations)+' confirmed violations</span>'+(u.banned_until?'<span class="is-danger">Suspended until '+time(u.banned_until)+'</span>':'')+'</div></div><button class="tac-action" data-action="message" data-id="'+esc(u.id)+'" data-label="'+esc(u.display_name||u.email)+'">Message</button></article>';}
function postCard(p){return '<article class="tac-row tac-post"><div class="tac-row-main"><b>'+esc(p.source.replaceAll('_',' '))+'</b><small>'+esc(p.author?.display_name||p.author?.username||'Unknown author')+' · '+time(p.created_at)+'</small><p>'+esc(p.body||p.preview||'Media post')+'</p><small>Record: '+esc(p.id)+'</small></div><button class="tac-danger" data-action="delete-post" data-id="'+esc(p.id)+'" data-source="'+esc(p.source)+'">Delete</button></article>';}
function commentCard(c){return '<article class="tac-row"><div class="tac-row-main"><b>'+(c.anonymous?'Anonymous comment':'Comment')+'</b><small>'+esc(c.source)+' · '+time(c.created_at)+'</small><p>'+esc(c.body||'')+'</p>'+(c.voice_note?'<div class="tac-pills"><span>Voice note · '+esc(c.voice_duration||'duration unknown')+' sec</span>'+(c.voice_view_once?'<span>View once</span>':'')+'<span>Playback remains subject to the original view-once rules</span></div>':'')+(c.author?'<small>Author: '+esc(c.author.display_name||c.author.username||c.author.id)+'</small>':'<small>Author identity hidden</small>')+'</div><div class="tac-case-actions">'+(c.anonymous?'<button data-action="reveal-author" data-id="'+esc(c.id)+'" data-source="'+esc(c.source)+'">Reveal author</button>':'')+'<button class="tac-danger" data-action="delete-comment" data-id="'+esc(c.id)+'" data-source="'+esc(c.source)+'">Delete</button></div></article>';}
function caseCard(c){return '<article class="tac-row"><div class="tac-row-main"><b>'+esc(c.profile?.display_name||c.profile?.username||c.email||'Account review')+'</b><small>'+esc(c.email)+' · '+time(c.created_at)+'</small><p>'+esc(c.distinct_report_count||0)+' distinct reports · Status: '+esc(c.status)+' · Suspension applied: '+(c.suspension_applied?'Yes':'No')+'</p><small>Case '+esc(c.id)+'</small></div><div class="tac-case-actions"><button data-action="verdict" data-id="'+esc(c.id)+'" data-verdict="under_review">Review</button><button data-action="verdict" data-id="'+esc(c.id)+'" data-verdict="dismissed">Dismiss</button><button class="tac-danger" data-action="verdict" data-id="'+esc(c.id)+'" data-verdict="confirmed_violation">Confirm violation</button></div></article>';}
async function handleAction(e){
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action;
 try{
  if(action==='refresh'){renderTab();return;}
  if(action==='users-page'){
   const next=Number(b.dataset.page);if(!Number.isFinite(next)||next<1)return;
   const d=await call('users',{page:next,search:usersSearch});usersPage=next;
   document.getElementById('tac-user-list').innerHTML=(d.users||[]).map(userCard).join('')||'<div class="tac-empty">No matching accounts.</div>';
   document.getElementById('tac-user-pagination').innerHTML=userPagination(d.has_more);return;
  }
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