/* Isolated Tweaklr Spaces launch layer. Main script.js remains untouched. */
(() => {
'use strict';
if (window.__tweaklrSpacesLaunchLayer) return;
window.__tweaklrSpacesLaunchLayer = true;
const anonState = new Map();
const safe = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateFor = id => { if(!anonState.has(id)) anonState.set(id,{loaded:false,loading:false,error:'',posts:[]}); return anonState.get(id); };
const when = v => { const d=new Date(v); return Number.isNaN(d.getTime())?'Just now':d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };

NATURES.anonymous={label:'Anonymous',eyebrow:'Say it without a name',icon:'sp-doc',hue:28,
 blurb:'A private room for honest thoughts, anonymous posts and anonymous replies.',
 signature:'No names. Just honesty.',
 promise:'Share what is on your mind without attaching your profile to the conversation.',
 features:['Anonymous posts','Anonymous comments','Member-only conversations','Owner and moderator controls'],
 swatch:'linear-gradient(135deg,#17100D,#493224 58%,#B88A69)',
 palettes:[{name:'After Hours',colors:['#160F0B','#493224','#B88A69']},{name:'Quiet Ember',colors:['#21130F','#6B3D31','#D5A17C']},{name:'Dark Roast',colors:['#100D0B','#30221B','#8D6850']}],
 tabs:[['wall','Anonymous wall','sp-doc']]};
delete NATURES.silly; delete HEADERS.silly; delete VIEWS.silly; delete Server.ROLE_SETS.silly;
Server.ROLE_SETS.anonymous=['owner','admin','moderator','member'];
delete FEATURE_OPTIONS.silly;
FEATURE_OPTIONS.anonymous=[
 {k:'anonymousPosts',t:'Anonymous posts',s:'Members can publish without showing their profile.'},
 {k:'anonymousComments',t:'Anonymous comments',s:'Every reply is anonymous too.'}
];
HEADERS.anonymous=s=>spBar(s,{meta:'Anonymous · identity protected'})+
 '<div class="anon-private-strip"><span>◉</span><div><b>Anonymous by design</b><small>Names and profile details are never shown on this wall.</small></div></div>';

function postCard(p,commentsEnabled){
 const comments=Array.isArray(p.comments)?p.comments:[];
 return '<article class="anon-post"><div class="anon-post__top"><span class="anon-avatar" aria-hidden="true">?</span><div><b>Anonymous member</b><small>'+safe(when(p.created_at))+'</small></div><span class="anon-tag">ANONYMOUS</span></div>'+
 '<p class="anon-post__body">'+safe(p.body)+'</p><div class="anon-post__foot">'+(commentsEnabled?'<button type="button" data-anon="comments:'+p.id+'">↳ '+comments.length+' '+(comments.length===1?'reply':'replies')+'</button>':'<span class="anon-tag">REPLIES PAUSED</span>')+' '+
 ((p.is_mine||p.can_moderate)?'<button type="button" class="anon-delete" data-anon="delete-post:'+p.id+'">Remove</button>':'')+'</div></article>';
}
function anonymousWall(s){
 const st=stateFor(s.id),postsEnabled=s.features?.anonymousPosts!==false,commentsEnabled=s.features?.anonymousComments!==false; if(!st.loaded&&!st.loading) void loadFeed(s.id);
 let html='<div class="anon-space"><section class="anon-hero"><span class="anon-kicker">TWEAKLR · ANONYMOUS SPACE</span><div class="anon-hero__mark">?</div>'+
 '<h2>Say what you<br><em>can’t say elsewhere.</em></h2><p>A place for honest thoughts, without names attached. Posts and replies stay inside this Space.</p>'+
 (postsEnabled?'<button type="button" class="anon-compose" data-anon="compose">＋ Write anonymously</button>':'<span class="anon-compose-disabled">Posting is paused by the Space owner.</span>')+'<div class="anon-privacy-line"><span>●</span> Your profile is not displayed on posts or comments</div></section>'+
 '<section class="anon-feed"><div class="anon-feed__heading"><div><span>THE WALL</span><h3>What’s on your mind?</h3></div><small>'+(st.loaded?st.posts.length+' posts':'Private feed')+'</small></div>';
 if(st.loading) html+='<div class="anon-empty"><span class="anon-loader"></span><p>Opening the anonymous wall…</p></div>';
 if(st.error) html+='<div class="anon-empty"><p>'+safe(st.error)+'</p><button type="button" data-anon="retry">Try again</button></div>';
 if(st.loaded&&!st.posts.length) html+='<div class="anon-empty"><span>✧</span><h3>A blank page. A fresh start.</h3><p>Be the first to share something. Your identity stays private.</p><button type="button" data-anon="compose">Write the first post</button></div>';
 html+=st.posts.map(p=>postCard(p,commentsEnabled)).join('')+'</section><p class="anon-footnote">Anonymity protects your identity from other members, not from platform safety processes or lawful requests. Be respectful and never share passwords, private contact details or identifying information.</p></div>';
 return html;
}
VIEWS.anonymous={wall:anonymousWall};

async function loadFeed(spaceId){
 const st=stateFor(spaceId); if(st.loading)return; st.loading=true; st.error='';
 try{
  const r=await supabaseClient.rpc('get_ming_anonymous_space_feed',{p_space_id:spaceId});
  if(r.error)throw r.error; st.posts=Array.isArray(r.data?.posts)?r.data.posts:[]; st.loaded=true;
 }catch(e){st.error=e?.message||'The anonymous wall could not be loaded.';console.error('Tweaklr Anonymous Space feed failed:',e);}
 finally{st.loading=false;if(sp.activeId===spaceId&&sp.tab==='wall')renderSpace();}
}
function compose(){
 openSheet({title:'Write anonymously',sub:'Your profile name, photo and username are not shown to other members.',
 body:'<div class="anon-sheet"><span class="anon-sheet__label">YOUR ANONYMOUS POST</span><textarea id="anon-post-body" maxlength="2000" rows="6" placeholder="Write what is on your mind…"></textarea><small>Up to 2,000 characters. Keep personal contact details private.</small></div>',
 foot:'<button type="button" class="btn btn--soft" data-action="close-sheet">Cancel</button><button type="button" class="btn btn--primary" data-anon="submit-post">Publish anonymously</button>'});
}
function comments(postId){
 const st=stateFor(sp.activeId),p=st.posts.find(x=>x.id===postId); if(!p)return;
 const rows=(p.comments||[]).map(c=>'<article class="anon-comment"><div><b>Anonymous member</b><small>'+safe(when(c.created_at))+'</small></div><p>'+safe(c.body)+'</p>'+
 ((c.is_mine||c.can_moderate)?'<button type="button" class="anon-delete" data-anon="delete-comment:'+c.id+'">Remove</button>':'')+'</article>').join('');
 openSheet({title:'Anonymous replies',sub:'Every reply is anonymous. No member names or profile pictures are displayed.',
 body:'<div class="anon-comments-sheet"><blockquote>'+safe(p.body)+'</blockquote><div class="anon-comment-list">'+(rows||'<p class="anon-no-comments">No replies yet. Start the conversation anonymously.</p>')+'</div><div class="field"><label for="anon-comment-body">Your anonymous reply</label><textarea id="anon-comment-body" maxlength="1000" rows="3" placeholder="Add something thoughtful…"></textarea></div></div>',
 foot:'<button type="button" class="btn btn--soft" data-action="close-sheet">Close</button><button type="button" class="btn btn--primary" data-anon="submit-comment:'+postId+'">Reply anonymously</button>'});
}
async function reload(spaceId){const st=stateFor(spaceId);st.loaded=false;await loadFeed(spaceId);if(sp.activeId===spaceId&&sp.tab==='wall')renderSpace();}
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-anon]'); if(!el)return;
 const bits=el.dataset.anon.split(':'); const action=bits[0],id=bits[1],spaceId=sp.activeId;
 if(!spaceId||spaceById(spaceId)?.nature!=='anonymous')return;
 if(action==='compose'){if(spaceById(spaceId)?.features?.anonymousPosts===false){toast('Anonymous posting is paused in this Space.','info');return;}compose();return;}
 if(action==='retry'){await reload(spaceId);return;}
 if(action==='comments'){if(spaceById(spaceId)?.features?.anonymousComments===false){toast('Anonymous replies are paused in this Space.','info');return;}comments(id);return;}
 if(action==='submit-post'){
  if(spaceById(spaceId)?.features?.anonymousPosts===false){toast('Anonymous posting is paused in this Space.','info');return;}
  const body=document.getElementById('anon-post-body')?.value.trim()||'';if(!body){toast('Write something before publishing.','x');return;}
  el.disabled=true;const r=await supabaseClient.rpc('create_ming_anonymous_post',{p_space_id:spaceId,p_body:body});
  if(r.error){el.disabled=false;toast(r.error.message||'Your post could not be published.','x');return;}
  closeSheet();toast('Posted anonymously','check');await reload(spaceId);return;
 }
 if(action==='submit-comment'){
  if(spaceById(spaceId)?.features?.anonymousComments===false){toast('Anonymous replies are paused in this Space.','info');return;}
  const body=document.getElementById('anon-comment-body')?.value.trim()||'';if(!body){toast('Write a reply first.','x');return;}
  el.disabled=true;const r=await supabaseClient.rpc('add_ming_anonymous_comment',{p_post_id:id,p_body:body});
  if(r.error){el.disabled=false;toast(r.error.message||'Your reply could not be saved.','x');return;}
  closeSheet();toast('Reply posted anonymously','check');await reload(spaceId);return;
 }
 if(action==='delete-post'){
  if(!window.confirm('Remove this anonymous post and all its replies?'))return;
  const r=await supabaseClient.rpc('delete_ming_anonymous_post',{p_post_id:id});
  if(r.error){toast(r.error.message||'Post could not be removed.','x');return;}
  toast('Post removed','check');await reload(spaceId);return;
 }
 if(action==='delete-comment'){
  if(!window.confirm('Remove this anonymous reply?'))return;
  const r=await supabaseClient.rpc('delete_ming_anonymous_comment',{p_comment_id:id});
  if(r.error){toast(r.error.message||'Reply could not be removed.','x');return;}
  closeSheet();toast('Reply removed','check');await reload(spaceId);
 }
});

/* Enhanced Casual, Romantic and Marketplace views; existing backend actions remain intact. */
VIEWS.casual.now=s=>{
 const posts=contentOf(s.id,'now').slice().sort((a,b)=>Number(b.at||0)-Number(a.at||0)),polls=contentOf(s.id,'poll'),meet=contentOf(s.id,'meeting')[0];
 const close=s.expiresAt?new Date(s.expiresAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Auto-closes after its live window';
 let h='<div class="spx spx--casual"><section class="spx-hero spx-hero--casual"><span class="spx-eyebrow"><i></i> LIVE SPACE · CASUAL</span><h2>Make the most<br>of <em>right now.</em></h2><p>Quick plans, live updates and the people around the moment.</p><div class="spx-hero-meta"><span>◷ '+safe(close)+'</span><span>◎ '+Server.memberCount(s.id)+' members</span></div><button class="spx-primary" data-sp="new:now">＋ Share a live update</button></section>'+
 '<section class="spx-section"><div class="spx-section-head"><div><span>THE MOMENT</span><h3>Happening now</h3></div><small>'+posts.length+' updates</small></div>';
 h+=posts.length?posts.map(p=>'<article class="spx-live-post"><div class="spx-post-author">'+avatar(personOf(p.authorId),34,{status:false})+'<div><b>'+safe(nameOf(p.authorId))+'</b><small>'+safe(timeAgo(p.at))+'</small></div><span>LIVE</span></div><p>'+safe(p.text)+'</p><small class="spx-expiry">◷ '+Math.max(1,Math.round((Number(p.at||Date.now())+6*36e5-Date.now())/36e5))+'h left</small></article>').join(''):'<div class="spx-empty"><span>✧</span><b>Nothing happening yet</b><p>Drop a quick update and give the room a reason to come alive.</p><button class="spx-secondary" data-sp="new:now">Post the first update</button></div>';
 h+='</section><section class="spx-section"><div class="spx-section-head"><div><span>DECIDE TOGETHER</span><h3>Quick polls</h3></div><button data-sp="new:poll">＋ New poll</button></div>';
 h+=polls.length?polls.map(pollCard).join(''):'<div class="spx-empty spx-empty--compact"><b>Make the group decision easier.</b><p>Ask where to go, what to do or when to meet.</p><button class="spx-secondary" data-sp="new:poll">Create a poll</button></div>';
 h+='</section><section class="spx-meet"><div><span>SHARED MEETING POINT</span><h3>'+safe(meet?.title||'No meeting point yet')+'</h3><p>'+(meet?'Visible only to approved members of this Space.':'Choose a simple place for everyone to meet.')+'</p></div><button class="spx-secondary" data-sp="new:meeting">'+(meet?'Update gathering':'Host a gathering')+'</button></section></div>';
 return h;
};

VIEWS.romantic.us=s=>{
 const plans=contentOf(s.id,'plan').slice().sort((a,b)=>String(a.when||'').localeCompare(String(b.when||''))),mem=contentOf(s.id,'memory').slice().sort((a,b)=>Number(b.at||0)-Number(a.at||0)).slice(0,3),notes=contentOf(s.id,'love_note').slice().sort((a,b)=>Number(b.at||0)-Number(a.at||0)).slice(0,2),next=plans[0];
 let h='<div class="spx spx--romantic"><section class="spx-hero spx-hero--romantic"><span class="spx-eyebrow">A PRIVATE WORLD FOR TWO</span><div class="spx-romantic-mark">♡</div><h2>Little things.<br><em>Lasting memories.</em></h2><p>A space that belongs to the two of you — quietly, completely.</p><div class="spx-romantic-actions"><button class="spx-primary" data-sp="thinking-of-you">♡ Send a little reminder</button><button class="spx-secondary" data-sp="new:loveletter">Write a letter</button></div></section>'+
 '<section class="spx-section"><div class="spx-section-head"><div><span>WHAT’S NEXT</span><h3>Your next moment</h3></div><button data-sp="new:plan">＋ Plan something</button></div>';
 h+=next?'<article class="spx-romantic-plan"><span>♡</span><div><b>'+safe(next.title)+'</b><small>'+safe(next.when||'Date to be decided')+' · '+safe(next.where||'Somewhere special')+'</small></div></article>':'<div class="spx-empty"><span>♡</span><b>Make room for something lovely.</b><p>Add a date, a little adventure or a plan you can both look forward to.</p><button class="spx-secondary" data-sp="new:plan">Create your first plan</button></div>';
 h+='</section><section class="spx-section"><div class="spx-section-head"><div><span>KEPT BETWEEN YOU</span><h3>Recent memories</h3></div><button data-sp="new:memory">＋ Keep a memory</button></div>';
 h+=mem.length?mem.map(m=>'<article class="spx-memory"><span>✧</span><div><p>'+safe(m.text)+'</p><small>'+safe(m.when||timeAgo(m.at))+'</small></div></article>').join(''):'<div class="spx-empty spx-empty--compact"><b>Your story starts with one small thing.</b><p>Save a moment you never want to lose.</p></div>';
 if(notes.length)h+='<section class="spx-section"><div class="spx-section-head"><div><span>SMALL REMINDERS</span><h3>Recently sent</h3></div></div>'+notes.map(n=>'<article class="spx-love-note"><span>♡</span><p>'+safe(n.text||'Thinking of you ♡')+'</p><small>'+safe(nameOf(n.authorId))+' · '+safe(timeAgo(n.at))+'</small></article>').join('')+'</section>';
 return h+'</section><div class="spx-privacy">♧ Private to this Space · limited to two approved members · never discoverable</div></div>';
};

VIEWS.marketplace.market=s=>{
 const products=Server.db.products.filter(p=>p.spaceId===s.id&&(sp.marketTab==='all'||p.category===sp.marketTab)),all=Server.db.products.filter(p=>p.spaceId===s.id&&p.status==='listed'),
 cats=['all',...new Set(Server.db.products.filter(p=>p.spaceId===s.id).map(p=>p.category))],seller=Server.can(s.id,'product.create');
 let h='<div class="spx spx--market"><section class="spx-hero spx-hero--market"><span class="spx-eyebrow">TWEAKLR · MEMBER MARKET</span><h2>Good finds.<br><em>Better connections.</em></h2><p>Discover what members are offering, compare listings and keep conversations in one trusted place.</p><div class="spx-market-stats"><span><b>'+all.length+'</b><small>active listings</small></span><span><b>'+Server.memberCount(s.id)+'</b><small>members</small></span><span><b>'+Server.db.orders.filter(o=>o.spaceId===s.id).length+'</b><small>orders</small></span></div>'+
 (seller?'<button class="spx-primary" data-sp="new:product">＋ Create a listing</button>':'<button class="spx-secondary" data-sp="ask-seller">Request seller access</button>')+'</section><section class="spx-market-toolbar"><label class="searchbar"><svg><use href="#i-search"/></svg><input id="mk-search" type="search" placeholder="Search products, categories and details…" aria-label="Search marketplace listings"></label><div class="chips">'+cats.map(c=>'<button class="chip '+(sp.marketTab===c?'is-on':'')+'" data-sp="mkcat:'+safe(c)+'">'+(c==='all'?'Everything':safe(c))+'</button>').join('')+'</div></section>'+
 '<section class="spx-section"><div class="spx-section-head"><div><span>CURATED BY YOUR COMMUNITY</span><h3>Explore listings</h3></div><small>'+products.length+' shown</small></div><div class="mk-grid" id="mk-grid">';
 h+=products.map(productCard).join('')||'<div class="spx-empty" style="grid-column:1/-1"><span>◇</span><b>No listings in this category yet.</b><p>New listings from approved sellers will appear here.</p>'+(seller?'<button class="spx-secondary" data-sp="new:product">List an item</button>':'')+'</div>';
 return h+'</div></section><div class="spx-market-notice"><b>Transaction transparency</b><p>Checkout and wallet flows are currently in development mode. No real money is held, transferred or protected by Tweaklr yet. Agree on payment and handover independently until a verified payment provider is connected.</p></div></div>';
};

/* Marketplace is a simulated transaction workflow until a real custodian and
   payment provider are integrated. Remove language that could imply custody. */
NATURES.marketplace.blurb='Buy and sell inside a Space with seller roles, order records and dispute workflows.';
NATURES.marketplace.features=['Member listings','Seller approvals','Order status & evidence','Test-mode transaction flow'];
FEATURE_OPTIONS.marketplace=(FEATURE_OPTIONS.marketplace||[]).map(f=>f.k==='escrow'
 ? {...f,t:'Test-mode checkout',s:'Internal test balances only. No real money is held or transferred.'}
 : f);
ORDER_STATES.funded.t='Test balance reserved';
ORDER_STATES.delivered.t='Delivery recorded · test flow';
FLOW_COPY.funded=['Test balance reserved','Internal ledger only; no real funds are held'];
FLOW_COPY.completed=['Test order completed','No real funds are transferred'];
TRANSITION_LABEL.fund='Reserve test balance';
TRANSITION_LABEL.accept='Complete test order';
TRANSITION_LABEL.resolve_release='Resolve test order · seller';
TRANSITION_LABEL.resolve_refund='Resolve test order · buyer';

openProduct=function(id){
 const p=Server.db.products.find(x=>x.id===id);if(!p)return;
 const s=spaceById(p.spaceId),seller=personOf(p.sellerId);
 openSheet({title:p.title,sub:money(p.price,p.asset)+' · '+p.condition+' · '+p.handover,
  body:'<div class="sp-card"><div style="height:145px;border-radius:14px;background:linear-gradient(150deg,hsl('+p.hue+' 30% 86%),hsl('+((p.hue+40)%360)+' 26% 60%));margin-bottom:12px"></div>'+
  '<p style="font-size:13px;line-height:1.6">'+safe(p.description)+'</p><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px"><span class="trust">TEST-MODE LISTING</span><span class="trust">'+safe(p.qty)+' in stock</span><span class="trust">'+safe(p.category||'General')+'</span></div>'+
  '<div class="mrow" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">'+avatar(seller,36)+'<div class="m"><div class="n">'+safe(seller.short||seller.name)+'</div><div class="s">Seller · '+safe(s?.name||'Marketplace Space')+'</div></div>'+
  '<button class="btn btn--soft btn--sm" data-sp="msg-seller:'+p.sellerId+'">Message</button></div></div>'+
  '<div class="spx-market-notice"><b>Before you continue</b><p>This is a development-mode marketplace. Tweaklr does not hold real funds, provide escrow protection or settle payments. Confirm payment and handover arrangements directly with the seller.</p></div>',
  foot:p.sellerId===Server.session.userId?'<button class="btn btn--soft btn--block" data-action="close-sheet">This is your listing</button>':'<button class="btn btn--primary btn--block" data-sp="buy:'+p.id+'">Continue to test checkout</button>'});
};

openCheckout=function(productId){
 const p=Server.db.products.find(x=>x.id===productId);if(!p)return;
 const fee=Math.round(p.price*0.015*100)/100;
 openSheet({title:'Test checkout',sub:p.title+' · '+money(p.price,p.asset),
  body:'<div class="sp-card" style="background:var(--surface-2);border:0"><div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0"><span>Listing price</span><b>'+safe(money(p.price,p.asset))+'</b></div>'+
  '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:4px 0"><span>Indicative platform fee</span><span>'+safe(money(fee,p.asset))+'</span></div></div>'+
  '<div class="spx-market-notice"><b>Development mode · no real payment</b><p>Continuing creates an internal test order and updates simulated balances only. No card, bank, crypto wallet or custody provider is connected. No money is charged, held, transferred or protected by Tweaklr.</p></div>',
  foot:'<button class="btn btn--soft" data-action="close-sheet">Cancel</button><button class="btn btn--primary" data-sp="pay:'+p.id+'">Create test order</button>'});
};

const baseRenderOrder=renderOrder;
renderOrder=function(){
 baseRenderOrder();
 const host=document.getElementById('ord-body');if(!host)return;
 host.innerHTML=host.innerHTML
  .replace(/Escrow/g,'Test transaction flow')
  .replace(/held by Tweaklr, not sent to the seller/gi,'internal test ledger only; no real funds are held')
  .replace(/the platform releases the funds/gi,'the test workflow completes the order')
  .replace(/The money has not moved\. It stays held by Tweaklr until a moderator decides\./g,'This is an internal test dispute. No real money is held or moved.')
  .replace(/Returned to the buyer’s wallet\./g,'The internal test balance was restored.')
  .replace(/The hold was released back to the buyer\./g,'The test order was cancelled.');
 host.insertAdjacentHTML('afterbegin','<div class="spx-market-notice"><b>Test transaction record</b><p>This order lifecycle is simulated. It does not represent a real payment, escrow service, refund or financial protection.</p></div>');
};

const baseRenderWallet=renderWallet;
renderWallet=function(){
 baseRenderWallet();
 const host=document.getElementById('wallet-body');if(!host)return;
 host.innerHTML=host.innerHTML.replace(/held in escrow/gi,'reserved in the internal test ledger').replace(/Nothing held/gi,'No test balance reserved');
};

openDisputeSheet=function(orderId){
 openSheet({title:'Report a problem',sub:'This records a dispute in the internal test ledger. It does not freeze or move real money.',
  body:'<div class="field"><label>What went wrong?</label><div class="pick" id="dp-reason">'+
  ['Not delivered','Not as described','Damaged','Wrong item','Other'].map((r,i)=>'<button type="button" data-pick="'+r+'" aria-pressed="'+(i===0)+'">'+r+'</button>').join('')+
  '</div></div><div class="field"><label for="dp-detail">What happened?</label><textarea id="dp-detail" maxlength="400" placeholder="Be specific. Dates, condition, what you expected."></textarea></div>'+
  '<div class="ephemeral-note"><span>Evidence review</span><span>Both sides can submit evidence for moderator review. This is a simulated workflow, not a financial dispute process.</span></div>',
  foot:'<button class="btn btn--primary btn--block" data-sp="dispute-submit:'+orderId+'">Open test dispute</button>'});
};

})();