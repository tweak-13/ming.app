/* Final Casual renderer fallback, loaded after all Space enhancements. */
(() => {
  if (typeof VIEWS === 'undefined' || !VIEWS.casual ||
      typeof contentOf !== 'function' || typeof renderSpace !== 'function') {
    console.error('Tweaklr Casual fallback: required Space renderer is unavailable.');
    return;
  }
  VIEWS.casual.now = s => {
    const now = Date.now(), cutoff = now - 6 * 60 * 60 * 1000;
    const posts = contentOf(s.id, 'now')
      .filter(p => Number(p.at || 0) > cutoff && Number(p.at || 0) <= now + 60000)
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    const polls = contentOf(s.id, 'poll');
    const meeting = contentOf(s.id, 'meeting')[0];
    const close = s.expiresAt
      ? new Date(s.expiresAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
      : 'Auto-closes after its live window';
    let html = '<div class="spx spx--casual"><section class="spx-hero spx-hero--casual">' +
      '<span class="spx-eyebrow"><i></i> LIVE SPACE · CASUAL</span>' +
      '<h2>Make the most<br>of <em>right now.</em></h2>' +
      '<p>Quick plans, live updates and the people around the moment.</p>' +
      '<div class="spx-hero-meta"><span>◷ '+esc(close)+'</span><span>◎ '+Server.memberCount(s.id)+' members</span></div>' +
      '<button class="spx-primary" data-sp="new:now">＋ Share a live update</button></section>' +
      '<section class="spx-section"><div class="spx-section-head"><div><span>THE MOMENT</span><h3>Happening now</h3></div><small>'+posts.length+' updates</small></div>';
    html += posts.length ? posts.map(p =>
      '<article class="spx-live-post"><div class="spx-post-author">'+avatar(personOf(p.authorId),34,{status:false})+
      '<div><b>'+esc(nameOf(p.authorId))+'</b><small>'+esc(timeAgo(p.at))+'</small></div><span>LIVE</span></div>' +
      '<p>'+esc(p.text)+'</p><small class="spx-expiry">◷ '+Math.max(1,Math.round((Number(p.at||Date.now())+21600000-Date.now())/3600000))+'h left</small></article>'
    ).join('') : '<div class="spx-empty"><span>✧</span><b>Nothing happening yet</b><p>Drop a quick update and give the room a reason to come alive.</p><button class="spx-secondary" data-sp="new:now">Post the first update</button></div>';
    html += '</section><section class="spx-section"><div class="spx-section-head"><div><span>DECIDE TOGETHER</span><h3>Quick polls</h3></div><button data-sp="new:poll">＋ New poll</button></div>';
    html += polls.length ? polls.map(pollCard).join('') :
      '<div class="spx-empty spx-empty--compact"><b>Make the group decision easier.</b><p>Ask where to go, what to do or when to meet.</p><button class="spx-secondary" data-sp="new:poll">Create a poll</button></div>';
    html += '</section><section class="spx-meet"><div><span>SHARED MEETING POINT</span><h3>'+esc(meeting?.title||'No meeting point yet')+
      '</h3><p>'+(meeting?'Visible only to approved members of this Space.':'Choose a simple place for everyone to meet.')+
      '</p></div><button class="spx-secondary" data-sp="new:meeting">'+(meeting?'Update gathering':'Host a gathering')+'</button></section></div>';
    return html;
  };
  document.addEventListener('DOMContentLoaded', () => {
    const screen=document.getElementById('screen-space');
    if(screen?.dataset.nature==='casual' && sp.activeId && sp.tab==='now') renderSpace();
  });
  window.__tweaklrCasualRendererReady=true;
})();
