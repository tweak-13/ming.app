/* Tweaklr Friendship — focused social + Trends layer.
   Additive only: keeps other Space natures and their views untouched. */
(() => {
  'use strict';
  if (window.__tweaklrFriendshipEnhancements) return;
  window.__tweaklrFriendshipEnhancements = true;

  const nature = window.NATURES?.friendly;
  const views = window.VIEWS?.friendly;
  if (!nature || !views) return;

  nature.label = 'Friendship';
  nature.eyebrow = 'Find your kind of people';
  nature.blurb = 'Meet people through shared interests, hobbies and the things you love.';
  nature.signature = 'The connection circle';
  nature.promise = 'Find people who enjoy what you enjoy, then turn shared interests into real friendships.';
  nature.features = ['Interest-led friend discovery', 'Photo and video feed', '24-hour stories', 'Trends and community challenges'];
  nature.tabs = [
    ['home', 'Home', 'home'],
    ['trends', 'Trends', 'sp-bolt'],
    ['discover', 'Discover', 'spark'],
    ['moments', 'Stories', 'sp-camera'],
    ['people', 'People', 'users']
  ];

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const trendPosts = spaceId => (window.friendlyPosts?.(spaceId) || []).filter(post =>
    post.postFormat === 'trend' || (Array.isArray(post.media) && post.media.some(item => String(item.mime || '').startsWith('video/')))
  );

  views.trends = space => {
    const posts = trendPosts(space.id);
    const challenges = [...new Map(posts.filter(p => p.trendTitle).map(p => [String(p.trendTitle).toLowerCase(), p.trendTitle])).values()];
    return '<main class="tw-trends">' +
      '<section class="tw-trends-hero"><span class="tw-trends-kicker">TWEAKLR · COMMUNITY IN MOTION</span>' +
      '<h2>Same interests. New ways to connect.</h2>' +
      '<p>Join a challenge, share your take and meet people who love the same things you do.</p>' +
      '<button type="button" data-tw-trend-compose>＋ Create a trend video</button></section>' +
      (challenges.length ? '<section class="tw-challenge-rail"><div class="tw-trend-heading"><div><span>HAPPENING IN YOUR CIRCLE</span><h3>Challenges to try</h3></div></div>' +
        challenges.slice(0,8).map(title => '<span class="tw-challenge-chip">✳ ' + esc(title) + '</span>').join('') + '</section>' : '') +
      '<div class="tw-trend-heading"><div><span>WATCH · RECREATE · CONNECT</span><h3>Video trends</h3></div><span>' + posts.length + ' videos</span></div>' +
      (posts.length ? '<div class="tw-trend-feed">' + posts.map(post => {
        const media = (post.media || []).map((item,index) => ({item,index,url:item.url || (window.friendlyMediaUrlCache?.get(post.id) || [])[index] || ''})).filter(x => x.url && String(x.item.mime || '').startsWith('video/'));
        if (!media.length) return '';
        const author = window.personOf?.(post.authorId) || {};
        const liked = !!post.mine?.like;
        const video = media[0];
        return '<article class="tw-trend-card" data-trend-id="' + esc(post.id) + '">' +
          '<video class="tw-trend-video" src="' + esc(video.url) + '" controls playsinline preload="metadata"></video>' +
          '<div class="tw-trend-overlay"><div class="tw-trend-author"><b>' + esc(author.short || author.name || 'Tweaklr member') + '</b><small>' + esc(author.username || '@tweaklr-member') + '</small></div>' +
          (post.trendTitle ? '<span class="tw-trend-title">✳ ' + esc(post.trendTitle) + '</span>' : '') +
          (post.caption ? '<p>' + esc(post.caption) + '</p>' : '') +
          '<div class="tw-trend-tags">' + (post.interests || []).slice(0,4).map(t => '<span>#' + esc(t) + '</span>').join('') + '</div></div>' +
          '<div class="tw-trend-actions"><button class="' + (liked ? 'is-liked' : '') + '" data-sp="friend-like:' + esc(post.id) + '">♥ ' + Math.max(0,Number(post.reacts?.like || 0)) + '</button>' +
          '<button data-sp="friend-comments:' + esc(post.id) + '">Comment</button>' +
          '<button data-tw-remix="' + esc(post.id) + '">＋ Join trend</button></div></article>';
      }).join('') + '</div>' : '<div class="friend-empty"><span>✦</span><h3>Start the first trend.</h3><p>Share a video around something you love. Other members can join in and add their own version.</p><button type="button" data-tw-trend-compose>Create the first trend video</button></div>') +
      '</main>';
  };

  const style = document.createElement('style');
  style.textContent = `
    .tw-trends{display:grid;gap:18px;padding:14px 0 34px}
    .tw-trends-hero{position:relative;overflow:hidden;padding:24px 20px;border:1px solid rgba(197,165,114,.2);border-radius:22px;background:radial-gradient(220px 150px at 100% 0%,rgba(139,53,67,.34),transparent 72%),linear-gradient(145deg,#241714,#120e0d 78%);box-shadow:0 16px 38px rgba(0,0,0,.18)}
    .tw-trends-hero:after{content:"";position:absolute;width:150px;height:150px;right:-66px;bottom:-90px;border:1px solid rgba(241,210,174,.22);border-radius:50%;box-shadow:0 0 0 18px rgba(241,210,174,.035),0 0 0 38px rgba(241,210,174,.025)}
    .tw-trends-kicker,.tw-trend-heading span{font-size:9px;font-weight:850;letter-spacing:.17em;color:#d6b58b}
    .tw-trends-hero h2{max-width:290px;margin:9px 0 7px;color:#f6e7d6;font-size:25px;line-height:1.08;letter-spacing:-.045em}
    .tw-trends-hero p{max-width:330px;margin:0;color:rgba(246,231,214,.68);font-size:12px;line-height:1.6}
    .tw-trends-hero button,.tw-trends .friend-empty button{position:relative;z-index:1;margin-top:16px;padding:11px 15px;border:1px solid rgba(241,210,174,.28);border-radius:13px;background:linear-gradient(135deg,#8b3543,#5c2630);color:#fff0df;font-size:11px;font-weight:800}
    .tw-trend-heading{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:0 3px}
    .tw-trend-heading h3{margin:4px 0 0;color:var(--text,#f4e8dc);font-size:18px;letter-spacing:-.035em}
    .tw-trend-heading>span{font-size:10px;color:var(--muted,#9d8b80);letter-spacing:0}
    .tw-challenge-rail{display:flex;flex-wrap:wrap;gap:8px}
    .tw-challenge-rail .tw-trend-heading{width:100%}
    .tw-challenge-chip{padding:9px 12px;border:1px solid rgba(197,165,114,.2);border-radius:999px;background:rgba(139,53,67,.1);color:#e7c9aa;font-size:10px;font-weight:750}
    .tw-trend-feed{display:grid;gap:16px}
    .tw-trend-card{position:relative;overflow:hidden;min-height:390px;border:1px solid rgba(197,165,114,.2);border-radius:22px;background:#100c0b;isolation:isolate}
    .tw-trend-video{display:block;width:100%;max-height:72vh;min-height:390px;object-fit:cover;background:#090707}
    .tw-trend-overlay{position:absolute;inset:auto 0 54px;padding:52px 15px 15px;background:linear-gradient(transparent,rgba(0,0,0,.84));pointer-events:none}
    .tw-trend-author{display:grid;gap:2px;color:#fff1e4;font-size:12px}.tw-trend-author small{color:rgba(255,241,228,.65);font-size:10px}
    .tw-trend-title{display:inline-block;margin-top:9px;color:#f3c99f;font-size:11px;font-weight:850}
    .tw-trend-overlay p{margin:7px 0;color:#fff1e4;font-size:12px;line-height:1.45}
    .tw-trend-tags{display:flex;flex-wrap:wrap;gap:6px}.tw-trend-tags span{color:#f3c99f;font-size:10px}
    .tw-trend-actions{position:absolute;right:10px;bottom:10px;left:10px;display:flex;gap:7px;justify-content:flex-end}
    .tw-trend-actions button{padding:8px 11px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(20,13,12,.78);color:#f7e9dc;font-size:10px;font-weight:750;backdrop-filter:blur(12px)}
    .tw-trend-actions button.is-liked{color:#ff9ca6;border-color:rgba(255,156,166,.4)}
    @media(min-width:700px){.tw-trend-feed{grid-template-columns:repeat(2,minmax(0,1fr))}.tw-trend-card{min-height:480px}.tw-trend-video{min-height:480px}}
  `;
  document.head.appendChild(style);

  function openTrendComposer(remixId) {
    const parent = remixId ? trendPosts(window.sp?.activeId).find(p => p.id === remixId) : null;
    const challenge = parent?.trendTitle || '';
    window.openSheet({
      title: remixId ? 'Join this trend' : 'Create a trend video',
      sub: 'Show your take on something you love. Shared interests are where friendships begin.',
      body: '<div class="tw-trend-composer">' +
        '<div class="field"><label for="tw-trend-title">TREND OR CHALLENGE NAME</label><input id="tw-trend-title" maxlength="70" placeholder="e.g. Show us your favourite hobby" value="' + esc(challenge) + '"></div>' +
        '<div class="field"><label for="tw-trend-caption">YOUR CAPTION</label><textarea id="tw-trend-caption" maxlength="300" rows="3" placeholder="Tell people what this trend is about…"></textarea></div>' +
        '<div class="field"><label for="tw-trend-tags">SHARED INTERESTS · COMMA SEPARATED</label><input id="tw-trend-tags" maxlength="140" placeholder="Photography, dance, football, books"></div>' +
        '<div class="field"><label for="tw-trend-video">YOUR VIDEO</label><input id="tw-trend-video" type="file" accept="video/*" capture="user"><small>One video · up to 50 MB</small><div id="tw-trend-preview"></div></div>' +
        '<p class="friend-composer-privacy">Visible to members of this Friendship Space. Your exact location is never attached.</p></div>',
      foot: '<button type="button" class="btn btn--soft" data-action="close-sheet">Cancel</button><button type="button" class="btn btn--primary" data-tw-trend-submit>Share video</button>'
    });
    const input = document.getElementById('tw-trend-video');
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      const host = document.getElementById('tw-trend-preview');
      if (!host) return;
      host.innerHTML = file ? '<video controls playsinline style="width:100%;max-height:220px;border-radius:14px" src="' + esc(URL.createObjectURL(file)) + '"></video>' : '';
    });
  }

  async function publishTrend() {
    const space = window.spaceById?.(window.sp?.activeId);
    const file = document.getElementById('tw-trend-video')?.files?.[0];
    const title = document.getElementById('tw-trend-title')?.value.trim() || '';
    const caption = document.getElementById('tw-trend-caption')?.value.trim() || '';
    const interests = (document.getElementById('tw-trend-tags')?.value || '').split(',').map(x => x.trim().replace(/^#/,'')).filter(Boolean).slice(0,8);
    if (!space || space.nature !== 'friendly') return;
    if (!file || !file.type.startsWith('video/')) { window.toast?.('Choose a video to share.','alert'); return; }
    if (file.size > 50*1024*1024) { window.toast?.('Videos must be 50 MB or smaller.','alert'); return; }
    if (!title) { window.toast?.('Give your trend a name.','alert'); return; }
    if (!caption) { window.toast?.('Add a short caption.','alert'); return; }
    const path = window.currentUser.id + '/friendly-' + space.id + '/' + crypto.randomUUID() + '-trend-' + (file.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,70) || 'video');
    const {error: uploadError} = await window.supabaseClient.storage.from('ming-post-media').upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false});
    if (uploadError) { window.toast?.('Your video could not be uploaded.','x'); return; }
    const payload = {caption,lookingFor:'',friendshipType:'open',interests,postFormat:'trend',trendTitle:title,media:[{path,name:file.name,mime:file.type}],reacts:{},mine:{},comments:[]};
    const result = await window.Server.submit('space.post',{spaceId:space.id,kind:'friend_post',payload});
    if (!result.ok) { await window.supabaseClient.storage.from('ming-post-media').remove([path]); window.toast?.(result.error || 'Your trend could not be shared.','x'); return; }
    const row = result.data.row;
    const {data} = await window.supabaseClient.storage.from('ming-post-media').createSignedUrl(path,3600);
    window.friendlyMediaUrlCache?.set(row.id,Object.assign([data?.signedUrl || ''],{expiresAt:Date.now()+3500000}));
    window.closeSheet?.();
    window.sp.tab = 'trends';
    window.renderSpace?.();
    window.toast?.('Your trend video is live.','check');
  }

  document.addEventListener('click', event => {
    const compose = event.target.closest('[data-tw-trend-compose]');
    const remix = event.target.closest('[data-tw-remix]');
    const submit = event.target.closest('[data-tw-trend-submit]');
    if (compose) { event.preventDefault(); event.stopImmediatePropagation(); openTrendComposer(''); }
    else if (remix) { event.preventDefault(); event.stopImmediatePropagation(); openTrendComposer(remix.getAttribute('data-tw-remix')); }
    else if (submit) { event.preventDefault(); event.stopImmediatePropagation(); void publishTrend(); }
  }, true);
})();
