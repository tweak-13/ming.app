/* Tweaklr Friendly Communities — dedicated mini-spaces backed by Supabase RPCs. */
(() => {
  'use strict';
  if (window.__tweaklrFriendlyCommunities || typeof VIEWS === 'undefined' || !VIEWS.friendly || typeof supabaseClient === 'undefined') return;
  window.__tweaklrFriendlyCommunities = true;

  const state = { spaceId:null, items:[], selected:null, detail:null, tab:'feed', loading:false, loaded:false, query:'', category:'All' };
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rpc = async (name,args={}) => {
    const {data,error}=await supabaseClient.rpc(name,args);
    if(error) throw error;
    return data;
  };
  const activeSpace = () => spaceById(sp.activeId);
  const categories = ['Creative','Gaming','Study','Travel','Sports','Books','Wellbeing','Technology','Music','Photography','Entrepreneurship','Other interests'];
  const dateLabel = value => { try { return new Date(value).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'}); } catch (_) { return ''; } };
  const profileAvatar = (url,name) => url
    ? '<img class="fc-avatar" src="'+esc(url)+'" alt="" loading="lazy">'
    : '<span class="fc-avatar fc-avatar--fallback">'+esc((name||'T').trim().slice(0,1).toUpperCase())+'</span>';

  function renderIndex(s) {
    if(state.spaceId!==s.id){state.spaceId=s.id;state.items=[];state.selected=null;state.detail=null;state.loading=false;state.loaded=false;state.query='';state.category='All';}
    const items=state.items.filter(c=>(state.category==='All'||c.category===state.category)&&(!state.query||(c.name+' '+c.description+' '+c.category).toLowerCase().includes(state.query.toLowerCase())));
    return '<div class="fs-view fc-shell">'+
      '<section class="fc-hero"><div class="fc-hero-glow"></div><div class="fc-hero-copy"><span class="fc-eyebrow">FRIENDLY SPACE · COMMUNITIES</span><h2>Find your <em>people.</em><br>Build your corner.</h2><p>Smaller spaces for the interests, conversations and ideas that bring people together.</p><div class="fc-hero-stats"><span><b>'+state.items.length+'</b> communities</span><span><b>∞</b> shared interests</span></div></div><div class="fc-hero-orbit"><i>✳</i><span></span><b></b></div></section>'+
      '<div class="fc-index-head"><div><span class="fc-eyebrow">EXPLORE YOUR INTERESTS</span><h3>Communities</h3><p>Join a conversation that feels like yours.</p></div><button class="fc-create" data-fc="create"><i>＋</i> Create</button></div>'+
      '<label class="fc-search"><span>⌕</span><input data-fc-search type="search" value="'+esc(state.query)+'" placeholder="Search communities, interests…" aria-label="Search communities"></label>'+
      '<div class="fc-filters">'+['All',...categories].map(c=>'<button class="'+(state.category===c?'is-active':'')+'" data-fc-category="'+esc(c)+'">'+esc(c)+'</button>').join('')+'</div>'+
      (state.loading?'<div class="fc-loading"><span></span><b>Finding your communities…</b></div>':
      items.length?'<div class="fc-grid">'+items.map(communityCard).join('')+'</div>':
      '<section class="fc-empty"><div class="fc-empty-mark">◎</div><span class="fc-eyebrow">'+(state.query||state.category!=='All'?'NO MATCHES YET':'YOUR NEXT FAVOURITE CORNER')+'</span><h3>'+(state.query||state.category!=='All'?'Try another interest':'Start something people can belong to.')+'</h3><p>'+(state.query||state.category!=='All'?'Change your search or category to see more communities.':'Create the first community in this Friendly Space, invite people who share your interest and let it grow.')+'</p><button class="fc-create" data-fc="create">＋ Create a community</button></section>')+
      '<p class="fc-footnote">Communities are independent mini-spaces within this Friendly Space. Their posts, members and moderation stay separate from the main Friendly feed.</p></div>';
  }

  function communityCard(c) {
    const joined=c.my_status==='approved',pending=c.my_status==='pending';
    const cover=c.cover_url?'<img src="'+esc(c.cover_url)+'" alt="" loading="lazy">':'<div class="fc-card-art"><span>✳</span><i></i><b></b></div>';
    return '<article class="fc-community-card" data-fc-search-text="'+esc((c.name+' '+c.description+' '+c.category).toLowerCase())+'">'+
      '<button class="fc-card-cover" data-fc="open" data-id="'+esc(c.id)+'">'+cover+'<span class="fc-card-category">'+esc(c.category||'INTERESTS')+'</span><span class="fc-card-lock">'+(c.privacy==='private'?'◈':'◎')+'</span></button>'+
      '<div class="fc-card-copy"><div class="fc-card-title-row"><h3>'+esc(c.name)+'</h3>'+(joined?'<span class="fc-member-chip">MEMBER</span>':pending?'<span class="fc-pending-chip">PENDING</span>':'')+'</div><p>'+esc(c.description)+'</p><div class="fc-card-meta"><span>'+Number(c.member_count||0)+' members</span><span>'+Number(c.post_count||0)+' posts</span></div>'+
      '<div class="fc-card-actions">'+(joined?'<button class="fc-open-btn" data-fc="open" data-id="'+esc(c.id)+'">Enter community <span>↗</span></button>':pending?'<button class="fc-open-btn is-pending" disabled>Request pending</button>':'<button class="fc-join-btn" data-fc="join" data-id="'+esc(c.id)+'">'+(c.privacy==='private'||c.require_approval?'Request to join':'Join community')+' <span>→</span></button>')+'</div></div></article>';
  }

  async function signedPath(path) {
    if(!path)return '';
    const {data,error}=await supabaseClient.storage.from('ming-post-media').createSignedUrl(path,3600);
    return error?'':data?.signedUrl||'';
  }
  async function loadIndex(spaceId) {
    if(state.loading)return;
    state.loading=true; if(sp.activeId===spaceId&&sp.tab==='circles')renderSpace();
    try{
      const data=await rpc('get_ming_friendly_communities',{p_space_id:spaceId});
      const rows=Array.isArray(data?.communities)?data.communities:[];
      state.items=await Promise.all(rows.map(async c=>({...c,cover_url:await signedPath(c.cover_path)})));
    }catch(e){console.error('Friendly Communities load failed:',e);toast(e.message||'Communities could not be loaded.','alert');}
    finally{state.loading=false;state.loaded=true;if(sp.activeId===spaceId&&sp.tab==='circles')renderSpace();}
  }
  async function loadDetail(id) {
    const data=await rpc('get_ming_friendly_community_space',{p_community_id:id});
    const c=data?.community;
    if(!c)throw Error('This community could not be opened.');
    const posts=Array.isArray(data.posts)?data.posts:[];
    const members=Array.isArray(data.members)?data.members:[];
    const requests=Array.isArray(data.requests)?data.requests:[];
    const [cover,postRows]=await Promise.all([
      signedPath(c.cover_path),
      Promise.all(posts.map(async p=>({...p,media_urls:await Promise.all((Array.isArray(p.media)?p.media:[]).map(m=>signedPath(m.path)))})))
    ]);
    state.detail={community:{...c,cover_url:cover},posts:postRows,members,requests};
    state.selected=id;
  }
  function renderDetail() {
    const d=state.detail,c=d.community,canManage=['owner','moderator'].includes(c.my_role);
    const cover=c.cover_url?'<img src="'+esc(c.cover_url)+'" alt="">':'<div class="fc-detail-art"><span>✳</span><i></i><b></b></div>';
    return '<div class="fs-view fc-shell fc-detail">'+
      '<button class="fc-back" data-fc="back">← <span>All communities</span></button>'+
      '<section class="fc-detail-hero">'+cover+'<div class="fc-detail-shade"></div><div class="fc-detail-title"><span class="fc-eyebrow">'+esc(c.category)+' · '+(c.privacy==='private'?'PRIVATE COMMUNITY':'OPEN COMMUNITY')+'</span><h2>'+esc(c.name)+'</h2><p>'+esc(c.description)+'</p><div class="fc-detail-stats"><span><b>'+Number(c.member_count||0)+'</b> members</span><span><b>'+d.posts.length+'</b> posts</span><span>Created '+dateLabel(c.created_at)+'</span></div></div></section>'+
      '<div class="fc-detail-toolbar"><div class="fc-tabs"><button data-fc-tab="feed" class="'+(state.tab==='feed'?'is-active':'')+'">Feed</button><button data-fc-tab="members" class="'+(state.tab==='members'?'is-active':'')+'">Members <i>'+d.members.length+'</i></button><button data-fc-tab="about" class="'+(state.tab==='about'?'is-active':'')+'">About</button></div>'+
      (c.my_role==='owner'?'<button class="fc-manage" data-fc="settings">Manage <span>⌄</span></button>':'')+'</div>'+
      (state.tab==='feed'?renderFeed(d):state.tab==='members'?renderMembers(d,canManage):renderAbout(d,canManage))+
      '</div>';
  }
  function renderFeed(d) {
    const c=d.community;
    return '<section class="fc-feed">'+
      '<div class="fc-compose"><div class="fc-compose-top"><span class="fc-compose-avatar">✦</span><div><b>Bring something to the circle</b><small>Share an idea, a question or a moment with members.</small></div></div><textarea data-fc-post-text maxlength="3000" placeholder="What would you like to share with the community?"></textarea><div class="fc-compose-bottom"><label class="fc-attach">＋ Add photos or videos<input type="file" data-fc-post-files accept="image/*,video/*" multiple></label><span data-fc-file-count>Up to 4 files</span><button data-fc="publish">Publish post ↗</button></div><div class="fc-upload-preview" data-fc-preview></div></div>'+
      (d.posts.length?d.posts.map(p=>postCard(p,c)).join(''):'<div class="fc-empty fc-feed-empty"><div class="fc-empty-mark">✧</div><h3>The first conversation starts here.</h3><p>Share a thought, ask a question or post something that gets this community talking.</p></div>')+
      '</section>';
  }
  function postCard(p,c) {
    const mine=p.author_id===currentUser.id,media=(p.media||[]).map((m,i)=>p.media_urls?.[i]?'<a class="fc-post-media" href="'+esc(p.media_urls[i])+'" target="_blank" rel="noopener">'+(String(m.mime||'').startsWith('video/')?'<video src="'+esc(p.media_urls[i])+'" controls playsinline></video>':'<img src="'+esc(p.media_urls[i])+'" alt="" loading="lazy">')+'</a>':'').join('');
    return '<article class="fc-post-card"><header>'+profileAvatar(p.author_avatar_url,p.author_name)+'<div><b>'+esc(p.author_name||'Community member')+'</b><small>@'+esc(p.author_username||'member')+' · '+dateLabel(p.created_at)+'</small></div>'+(mine||['owner','moderator'].includes(c.my_role)?'<button data-fc="delete-post" data-id="'+esc(p.id)+'" aria-label="Delete post">•••</button>':'')+'</header>'+
      (p.body?'<p class="fc-post-body">'+esc(p.body).replace(/\n/g,'<br>')+'</p>':'')+media+
      '<footer><button data-fc="comments" data-id="'+esc(p.id)+'">◌ '+Number(p.comment_count||0)+' comments</button><span>Community post</span></footer></article>';
  }
  function renderMembers(d,canManage) {
    const c=d.community;
    return '<section class="fc-members-panel">'+
      (d.requests.length&&canManage?'<div class="fc-request-box"><div class="fc-section-heading"><div><span class="fc-eyebrow">COMMUNITY GATEKEEPING</span><h3>Join requests</h3></div><span>'+d.requests.length+' waiting</span></div>'+d.requests.map(m=>'<article class="fc-person-row">'+profileAvatar(m.avatar_url,m.display_name)+'<div><b>'+esc(m.display_name)+'</b><small>@'+esc(m.username||'member')+'</small></div><button data-fc="approve" data-user="'+esc(m.user_id)+'">Approve</button><button data-fc="remove-member" data-user="'+esc(m.user_id)+'">Decline</button></article>').join('')+'</div>':'')+
      '<div class="fc-section-heading"><div><span class="fc-eyebrow">THE PEOPLE BEHIND THE POSTS</span><h3>Members</h3></div><span>'+d.members.length+' people</span></div>'+
      d.members.map(m=>'<article class="fc-person-row">'+profileAvatar(m.avatar_url,m.display_name)+'<div><b>'+esc(m.display_name)+'</b><small>@'+esc(m.username||'member')+' · '+esc(m.role)+'</small></div>'+(m.role==='owner'?'<span class="fc-role-pill">CREATOR</span>':canManage?'<button data-fc="member-menu" data-user="'+esc(m.user_id)+'" data-role="'+esc(m.role)+'">Manage</button>':'')+'</article>').join('')+
      '</section>';
  }
  function renderAbout(d,canManage) {
    const c=d.community;
    return '<section class="fc-about-panel"><span class="fc-eyebrow">THE STORY OF THIS COMMUNITY</span><h3>What brings us together</h3><p>'+esc(c.description)+'</p><div class="fc-about-facts"><div><small>INTEREST</small><b>'+esc(c.category)+'</b></div><div><small>VISIBILITY</small><b>'+(c.privacy==='private'?'Private':'Public to Friendly members')+'</b></div><div><small>JOINING</small><b>'+(c.require_approval?'Approval required':'Open membership')+'</b></div><div><small>CREATED</small><b>'+dateLabel(c.created_at)+'</b></div></div>'+
      '<div class="fc-about-actions">'+(c.my_role==='owner'?'<button data-fc="settings">Edit community settings</button><button class="fc-delete-community" data-fc="delete-community">Delete community</button>':'<button data-fc="leave">Leave community</button>')+'</div></section>';
  }
  async function uploadFiles(files,spaceId,communityId) {
    const result=[];
    try{
      for(const f of files){
        const isImage=f.type.startsWith('image/'),isVideo=f.type.startsWith('video/');
        if((!isImage&&!isVideo)||f.size>(isVideo?50:15)*1048576)throw Error('Use photos up to 15 MB or videos up to 50 MB.');
        const safe=f.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,80)||'media';
        const path=currentUser.id+'/friendly-'+spaceId+'/community-'+communityId+'-'+crypto.randomUUID()+'-'+safe;
        const {error}=await supabaseClient.storage.from('ming-post-media').upload(path,f,{contentType:f.type,cacheControl:'3600',upsert:false});
        if(error)throw error;
        result.push({path,name:f.name,mime:f.type,size:f.size});
      }
      return result;
    }catch(error){if(result.length)await supabaseClient.storage.from('ming-post-media').remove(result.map(x=>x.path)).catch(()=>{});throw error;}
  }
  function showCreate() {
    openSheet({title:'Create a community',sub:'Give a shared interest a home of its own.',body:
      '<div class="fs-form fc-form"><div class="fc-form-intro"><span>✳</span><div><b>A little corner. A lot to share.</b><small>Your community becomes its own mini-space inside Friendly.</small></div></div>'+
      '<div class="field"><label>Community name</label><input id="fc-name" maxlength="70" placeholder="e.g. The Creative Collective"></div>'+
      '<div class="field"><label>What is it about?</label><textarea id="fc-description" maxlength="600" placeholder="Tell people what brings this community together…" rows="4"></textarea></div>'+
      '<div class="field"><label>Choose a category</label><select id="fc-category">'+categories.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Community visibility</label><select id="fc-privacy"><option value="public">Public · Friendly members can discover it</option><option value="private">Private · Members need approval</option></select></div>'+
      '<label class="fc-toggle-row"><span><b>Approve every join request</b><small>Keep membership intentional, even in a public community.</small></span><input type="checkbox" id="fc-approval"></label>'+
      '<div class="field"><label>Cover image · optional</label><label class="fc-cover-picker">＋ Choose a cover image<input id="fc-cover" type="file" accept="image/*"></label><small class="fc-hint">One image, up to 15 MB.</small></div></div>',
      foot:'<button class="btn btn--soft" data-action="close-sheet">Cancel</button><button class="btn btn--primary" data-fc="create-submit">Create community</button>'});
  }
  async function createCommunity() {
    const s=activeSpace(),name=document.getElementById('fc-name')?.value.trim(),description=document.getElementById('fc-description')?.value.trim();
    const file=document.getElementById('fc-cover')?.files?.[0],privacy=document.getElementById('fc-privacy')?.value||'public';
    const approval=!!document.getElementById('fc-approval')?.checked,category=document.getElementById('fc-category')?.value||'Other interests';
    if(!name||name.length<3||!description||description.length<8){toast('Add a community name and a description of at least 8 characters.','alert');return;}
    if(file&&(!file.type.startsWith('image/')||file.size>15*1048576)){toast('Choose one image up to 15 MB.','alert');return;}
    let coverPath=null;
    try{
      if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,80)||'cover';coverPath=currentUser.id+'/friendly-'+s.id+'/community-'+crypto.randomUUID()+'-'+safe;const {error}=await supabaseClient.storage.from('ming-post-media').upload(coverPath,file,{contentType:file.type,cacheControl:'3600',upsert:false});if(error)throw error;}
      const created=await rpc('create_ming_friendly_community',{p_space_id:s.id,p_name:name,p_description:description,p_category:category,p_privacy:privacy,p_require_approval:approval,p_cover_path:coverPath});
      closeSheet();await loadIndex(s.id);state.selected=created.id;await loadDetail(created.id);state.tab='feed';renderSpace();toast('Your community is ready.','check');
    }catch(e){if(coverPath)await supabaseClient.storage.from('ming-post-media').remove([coverPath]).catch(()=>{});console.error('Community creation failed:',e);toast(e.message||'Could not create this community.','alert');}
  }
  async function publishPost() {
    const d=state.detail;if(!d)return;
    const box=document.querySelector('[data-fc-post-text]'),files=Array.from(document.querySelector('[data-fc-post-files]')?.files||[]),body=box?.value.trim()||'';
    if(!body&&!files.length){toast('Write something or attach media first.','alert');return;}
    if(files.length>4){toast('Choose up to four files.','alert');return;}
    try{
      const media=files.length?await uploadFiles(files,d.community.space_id,d.community.id):[];
      await rpc('create_ming_friendly_community_post',{p_community_id:d.community.id,p_body:body,p_media:media});
      await loadDetail(d.community.id);state.tab='feed';renderSpace();toast('Posted to your community.','check');
    }catch(e){console.error('Community post failed:',e);toast(e.message||'Your post could not be published.','alert');}
  }
  async function joinCommunity(id) {
    try{
      const result=await rpc('join_ming_friendly_community',{p_community_id:id});
      await loadIndex(state.spaceId);
      if(result?.status==='approved'){await loadDetail(id);state.tab='feed';}
      renderSpace();toast(result?.status==='pending'?'Join request sent.':'You are now a member.','check');
    }catch(e){toast(e.message||'Could not join this community.','alert');}
  }
  async function comments(postId) {
    try{
      const data=await rpc('get_ming_friendly_community_comments',{p_post_id:postId});
      const rows=Array.isArray(data?.comments)?data.comments:[];
      const markup=rows.length?rows.map(c=>'<article class="fc-comment-row">'+profileAvatar(c.author_avatar_url,c.author_name)+'<div><b>'+esc(c.author_name||'Member')+'</b><p>'+esc(c.body)+'</p><small>'+dateLabel(c.created_at)+'</small></div></article>').join(''):'<p class="fc-no-comments">No comments yet. Start the conversation.</p>';
      openSheet({title:'Community discussion',sub:'Comments stay inside this community.',body:'<div class="fc-comments">'+markup+'</div><div class="fc-comment-compose"><input id="fc-comment-input" maxlength="1000" placeholder="Write a comment…"><button data-fc="comment-submit" data-id="'+esc(postId)+'">Send</button></div>',foot:'<button class="btn btn--soft" data-action="close-sheet">Close</button>'});
    }catch(e){toast(e.message||'Comments could not be loaded.','alert');}
  }
  async function submitComment(postId) {
    const input=document.getElementById('fc-comment-input'),body=input?.value.trim();if(!body){toast('Write a comment first.','alert');return;}
    try{await rpc('add_ming_friendly_community_comment',{p_post_id:postId,p_body:body});closeSheet();await loadDetail(state.selected);renderSpace();toast('Comment added.','check');}catch(e){toast(e.message||'Could not add your comment.','alert');}
  }
  async function reloadDetail() { if(state.selected){await loadDetail(state.selected);renderSpace();} }
  function showSettings() {
    const c=state.detail?.community;if(!c)return;
    openSheet({title:'Community settings',sub:'Keep your community healthy and well organised.',body:
      '<div class="fs-form fc-form"><div class="field"><label>Community name</label><input id="fc-edit-name" maxlength="70" value="'+esc(c.name)+'"></div><div class="field"><label>Description</label><textarea id="fc-edit-description" maxlength="600" rows="4">'+esc(c.description)+'</textarea></div><div class="field"><label>Category</label><select id="fc-edit-category">'+categories.map(x=>'<option '+(x===c.category?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div><div class="field"><label>Visibility</label><select id="fc-edit-privacy"><option value="public" '+(c.privacy==='public'?'selected':'')+'>Public</option><option value="private" '+(c.privacy==='private'?'selected':'')+'>Private</option></select></div><label class="fc-toggle-row"><span><b>Require approval</b><small>Review every request to join.</small></span><input type="checkbox" id="fc-edit-approval" '+(c.require_approval?'checked':'')+'></label></div>',
      foot:'<button class="btn btn--soft" data-action="close-sheet">Cancel</button><button class="btn btn--primary" data-fc="settings-save">Save changes</button>'});
  }
  async function saveSettings() {
    const c=state.detail.community;
    try{await rpc('update_ming_friendly_community',{p_community_id:c.id,p_name:document.getElementById('fc-edit-name').value.trim(),p_description:document.getElementById('fc-edit-description').value.trim(),p_category:document.getElementById('fc-edit-category').value,p_privacy:document.getElementById('fc-edit-privacy').value,p_require_approval:document.getElementById('fc-edit-approval').checked});closeSheet();await reloadDetail();toast('Community settings updated.','check');}
    catch(e){toast(e.message||'Could not update settings.','alert');}
  }
  async function memberAction(user,action) {
    try{await rpc('manage_ming_friendly_community_member',{p_community_id:state.selected,p_user_id:user,p_action:action});await reloadDetail();toast(action==='approve'?'Member approved.':action==='remove'?'Membership updated.':'Member role updated.','check');}
    catch(e){toast(e.message||'Could not update this member.','alert');}
  }
  document.addEventListener('click',async e=>{
    const el=e.target.closest('[data-fc],[data-fc-tab],[data-fc-category]');if(!el)return;
    if(el.dataset.fcCategory!==undefined){state.category=el.dataset.fcCategory;renderSpace();return;}
    if(el.dataset.fcTab){state.tab=el.dataset.fcTab;renderSpace();return;}
    const action=el.dataset.fc,id=el.dataset.id,user=el.dataset.user;
    if(action==='create'){showCreate();return;}
    if(action==='create-submit'){await createCommunity();return;}
    if(action==='open'){try{await loadDetail(id);state.tab='feed';renderSpace();}catch(err){toast(err.message||'Could not open this community.','alert');}return;}
    if(action==='back'){state.selected=null;state.detail=null;state.tab='feed';renderSpace();return;}
    if(action==='join'){await joinCommunity(id);return;}
    if(action==='publish'){await publishPost();return;}
    if(action==='comments'){await comments(id);return;}
    if(action==='comment-submit'){await submitComment(id);return;}
    if(action==='settings'){showSettings();return;}
    if(action==='settings-save'){await saveSettings();return;}
    if(action==='approve'){await memberAction(user,'approve');return;}
    if(action==='remove-member'){await memberAction(user,'remove');return;}
    if(action==='member-menu'){
      const role=el.dataset.role;
      openSheet({title:'Manage member',sub:'Community moderation',body:'<p class="fc-note">Choose an action for this member.</p>',foot:'<button class="btn btn--soft" data-action="close-sheet">Cancel</button>'+(role==='member'?'<button class="btn btn--primary" data-fc="promote" data-user="'+esc(user)+'">Make moderator</button>':'<button class="btn btn--soft" data-fc="demote" data-user="'+esc(user)+'">Remove moderator role</button>')+'<button class="btn btn--danger" data-fc="remove-member" data-user="'+esc(user)+'">Remove member</button>'});return;
    }
    if(action==='promote'){await memberAction(user,'promote');closeSheet();return;}
    if(action==='demote'){await memberAction(user,'demote');closeSheet();return;}
    if(action==='delete-community'){
      if(!confirm('Delete this community and permanently remove its posts, comments and memberships?'))return;
      try{const paths=[state.detail?.community?.cover_path,...(state.detail?.posts||[]).flatMap(p=>(p.media||[]).map(m=>m.path))].filter(Boolean);await rpc('delete_ming_friendly_community',{p_community_id:state.selected});if(paths.length){const {error}=await supabaseClient.storage.from('ming-post-media').remove(paths);if(error)console.warn('Community media cleanup failed:',error.message);}state.selected=null;state.detail=null;await loadIndex(state.spaceId);renderSpace();toast('Community deleted.','check');}catch(err){toast(err.message||'Could not delete this community.','alert');}return;
    }
    if(action==='leave'){
      if(!confirm('Leave this community? You will need to join again to see its private discussions.'))return;
      try{await rpc('leave_ming_friendly_community',{p_community_id:state.selected});state.selected=null;state.detail=null;await loadIndex(state.spaceId);renderSpace();toast('You left the community.','check');}catch(err){toast(err.message||'Could not leave.','alert');}return;
    }
    if(action==='delete-post'){
      if(!confirm('Delete this community post?'))return;
      try{const post=state.detail?.posts?.find(p=>p.id===id);await rpc('delete_ming_friendly_community_post',{p_post_id:id});const paths=(post?.media||[]).map(m=>m.path).filter(Boolean);if(paths.length){const {error}=await supabaseClient.storage.from('ming-post-media').remove(paths);if(error)console.warn('Community post media cleanup failed:',error.message);}await reloadDetail();toast('Post deleted.','check');}catch(err){toast(err.message||'Could not delete post.','alert');}return;
    }
  });
  document.addEventListener('input',e=>{
    if(e.target.matches('[data-fc-search]')){state.query=e.target.value;const q=state.query.trim().toLowerCase();let visible=0;document.querySelectorAll('.fc-community-card').forEach(card=>{const match=(card.dataset.fcSearchText||'').includes(q);card.hidden=!match;if(match)visible++;});let empty=document.querySelector('.fc-search-empty');const grid=document.querySelector('.fc-grid');if(!empty&&grid){empty=document.createElement('p');empty.className='fc-search-empty';empty.textContent='No communities match that search. Try another name or interest.';grid.after(empty);}if(empty)empty.hidden=visible>0||!grid;}
    if(e.target.matches('[data-fc-post-files]')){const files=Array.from(e.target.files||[]);const count=document.querySelector('[data-fc-file-count]');if(count)count.textContent=files.length+' / 4 selected';const preview=document.querySelector('[data-fc-preview]');if(preview)preview.textContent=files.map(f=>f.name).join(' · ');}
  });
  VIEWS.friendly.circles=s=>{
    if(state.selected&&state.detail)return renderDetail();
    const html=renderIndex(s);
    if(!state.loaded&&!state.loading)void loadIndex(s.id);
    return html;
  };
  // Repaint only when the module loads into an already-open Friendly Communities tab.
  try{const s=spaceById(sp.activeId);if(s&&s.nature==='friendly'&&sp.tab==='circles')renderSpace();}catch(_){}
  // Keep community actions in the Friendly tab only; other Space types are untouched.
})();
