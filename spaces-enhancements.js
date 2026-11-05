/* Tweaklr Spaces DNA add-on.
 * Additive companion module: never replaces existing Space renderers,
 * message handlers, or backend state. Experimental personal tools are
 * persisted in Supabase for the signed-in member of each Space.
 */
(function () {
  'use strict';
  if (window.__tweaklrSpacesDNAInstalled) return;
  window.__tweaklrSpacesDNAInstalled = true;

  const ROOT = '#screen-space';
  // Custom Tweaklr moon-glass mini-icons replace platform emoji throughout this panel.
  const ICON_PATHS = {
    target:'<path d="M12 3.2l1.9 4.1 4.5.6-3.2 3.1.8 4.5-4-2.1-4 2.1.8-4.5-3.2-3.1 4.5-.6z"/><circle cx="12" cy="12" r="9.3" stroke-dasharray="1.4 3.2"/><path d="M17.7 17.7l2 2"/>',
    timer:'<path d="M12 3.2a8.8 8.8 0 108.8 8.8"/><path d="M12 6.8v5.4l3.6 2"/><path d="M16.2 2.8l.8 2.1 2.2.1-1.7 1.4.6 2.1-1.9-1.2-1.8 1.2.5-2.1-1.6-1.4 2.1-.1z"/>',
    hands:'<path d="M3 12l4-4 3 2 2-1 5 2-5 5-4-2-3 1z"/><path d="M7 8l2-3 3 2m-1 8 2 1 4-4"/>',
    laugh:'<circle cx="12" cy="12" r="9"/><path d="M8 10h.1M16 10h.1M7.5 13a4.5 4.5 0 009 0z"/>',
    cloud:'<path d="M6 18h11a4 4 0 000-8 5.5 5.5 0 00-10-1A4.5 4.5 0 006 18z"/>',
    leaf:'<path d="M20 4C10 4 5 7 5 13a5 5 0 005 5c6 0 9-7 10-14zM4 21l8-9"/>',
    dice:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.1M16 8h.1M12 12h.1M8 16h.1M16 16h.1"/>',
    trophy:'<path d="M8 4h8v5a4 4 0 01-8 0zM8 6H4v2a4 4 0 004 4m8-6h4v2a4 4 0 01-4 4M12 13v5m-4 2h8m-6-2h4"/>',
    heart:'<path d="M12 20S3 14.5 3 8.5A4.5 4.5 0 0112 7a4.5 4.5 0 019 1.5C21 14.5 12 20 12 20z"/>',
    letter:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
    moon:'<path d="M19 15A8 8 0 019 5a8 8 0 1010 10z"/><path d="M16 3v3m-1.5-1.5h3"/>',
    handshake:'<path d="M3 10l4-4 4 2 2-1 8 4-7 6-4-2-3 1-4-4z"/><path d="m9 13 3 2m1-4 3 2"/>',
    bag:'<path d="M5 8h14l1 12H4L5 8z"/><path d="M9 8V6a3 3 0 016 0v2m-6 5h6"/>',
    briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18m-11 0v2h4v-2"/>',
    pin:'<path d="M12 21s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="9" r="2"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
    good:'<path d="M8 11V5a2 2 0 014 0v4h5a2 2 0 012 2l-1 7a2 2 0 01-2 2H9l-4-3v-6z"/>',
    rain:'<path d="M6 14a4 4 0 010-8 6 6 0 0111 2 3 3 0 010 6zM8 17l-1 2m6-2-1 2m6-2-1 2"/>',
    fire:'<path d="M13 2c1 5-4 6-2 10 1-2 3-3 4-5 4 4 5 7 2 11a6 6 0 01-11-3c0-4 3-7 7-13z"/>',
    bubbles:'<circle cx="9" cy="10" r="5"/><circle cx="16" cy="15" r="4"/><circle cx="17" cy="5" r="2"/>'
  };
  function brandIcon(name) {
    return '<svg class="sp-dna-emoji" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><defs><linearGradient id="sp-dna-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1D2AE"/><stop offset=".52" stop-color="#B77A80"/><stop offset="1" stop-color="#8B3543"/></linearGradient></defs><circle class="sp-dna-emoji__orb" cx="12" cy="12" r="11"/><g class="sp-dna-emoji__symbol">' + (ICON_PATHS[name] || ICON_PATHS.moon) + '</g></svg>';
  }
  const MOODS = [
    ['sun', 'Sunny'], ['good', 'Good'], ['rain', 'Low-key'], ['fire', 'Energised'], ['bubbles', 'Need calm']
  ];
  const DARES = [
    '🎭 DRAMA MODE — Describe your last meal like it was the season finale of a hit series.',
    '🫠 EMOJI ONLY — Explain your current mood using exactly five emojis. No words.',
    '🏆 HYPE PERSON — Give someone in this Space an outrageously specific compliment.',
    '🧠 BIG BRAIN — Invent a completely unnecessary life hack and pitch it like a billionaire.',
    '🌶️ HOT TAKE — Drop a harmless hot take and defend it in three short messages.',
    '🎬 TRAILER VOICE — Narrate your next three messages like a blockbuster movie trailer.',
    '🕺 MAIN CHARACTER — Give your day a dramatic movie title and tagline.',
    '🧪 INVENTOR — Create a new holiday. Name it, explain the tradition, sell us on it.',
    '🍿 PLOT TWIST — Tell a tiny true story from your day with one unexpected twist.',
    '🎤 PRESS CONFERENCE — Answer the next question like a celebrity after a scandal involving spilled juice.',
    '🦸 SUPERPOWER — Give the person above you a ridiculous superpower and a hilarious weakness.',
    '📢 BREAKING NEWS — Announce what you last ate as a world-changing news alert.',
    '🧑‍⚖️ COURT IS IN SESSION — Defend a silly opinion like your future depends on it.',
    '🧙 PROPHECY — Predict something hilariously specific that will happen in this Space.',
    '💅 AWARD SPEECH — Thank three completely unexpected things in a 20-second award speech.',
    '🧩 TWO TRUTHS — Share two true things and one believable lie; let the room guess.',
    '🎨 WORD ART — Describe your favourite colour without naming it.',
    '📱 AUTOCORRECT CHAOS — Write a sentence with your eyes closed, then share the result.',
    '🐸 CREATURE ENERGY — Choose an animal that matches your vibe and defend your choice.',
    '💬 THE REBRAND — Rename yourself for the next five minutes based on your current mood.',
    '🎵 SOUNDTRACK — Pick a song title that describes today; no lyrics needed.',
    '🧳 TIME TRAVEL — Send one piece of advice to your past self in exactly seven words.',
    '🍳 CHEF CHAOS — Invent a cursed food combination and give it a five-star review.',
    '🪞 MIRROR MODE — Describe yourself like a product listing with three honest features.',
    '🚀 PITCH IT — Sell the group an imaginary product nobody needs but everybody wants.',
    '🧊 UNPOPULAR OPINION — Share a harmless preference you will defend forever.',
    '🧸 NOSTALGIA — Name a childhood thing you thought was elite and explain why.',
    '🌀 RANDOM LORE — Invent a completely fake fact about yourself that sounds almost true.',
    '📸 CAPTION THIS — Describe the last photo you took as if it belongs in a museum.',
    '👑 ROYAL DECREE — Make one harmless new rule for this Space for the next ten minutes.'
  ];
  const ROASTS = [
    name => name + ' has the confidence of a phone on 1% with no charger in sight.',
    name => name + ' would open 37 tabs to avoid one simple decision.',
    name => name + ' gives “I’ll be ready in five minutes” a completely new meaning.',
    name => name + ' could turn a quick story into a limited series with bonus episodes.',
    name => name + ' has premium main-character energy and free-trial planning skills.',
    name => name + ' would lose a staring contest with a front camera.',
    name => name + ' brings loading-screen energy to a room full of fast Wi-Fi.',
    name => name + ' could overthink a yes-or-no question into a documentary.',
    name => name + ' is the human version of “update available — remind me later.”',
    name => name + ' has 4K confidence and 144p directions.',
    name => name + ' would ask the GPS for emotional support.',
    name => name + ' treats a small inconvenience like a season finale.',
    name => name + ' has the organisation style of 19 screenshots named “IMG_0001”.',
    name => name + ' would bring vibes to a group project and call it leadership.',
    name => name + ' is proof that chaos can have excellent fashion sense.',
    name => name + ' could make choosing a snack feel like a board meeting.',
    name => name + ' has a PhD in “I was just about to do that.”',
    name => name + ' would put “professional napper” on a résumé and get shortlisted.',
    name => name + ' has the timing of a plot twist and the memory of a goldfish.',
    name => name + ' is a walking notification that somehow nobody wants to dismiss.'
  ];

  function activeScreen() { return document.querySelector(ROOT); }
  function activeNature() { return activeScreen()?.dataset.nature || ''; }
  function activeName() {
    return document.querySelector(ROOT + ' .sp-bar .ttl .n')?.textContent?.trim() || 'Space';
  }
  // Signature-tool state is stored in Supabase per Space and signed-in user.
  // No localStorage fallback: a backend failure must never pretend the data was saved.
  let dnaState = {};
  let dnaSpaceId = '';
  let dnaLoaded = false;
  let dnaLoadingSpaceId = '';
  let dnaSaveQueue = Promise.resolve();
  function activeSpaceId() { return activeScreen()?.dataset.spaceId || ''; }
  function read(suffix, fallback) {
    return Object.prototype.hasOwnProperty.call(dnaState, suffix) ? dnaState[suffix] : fallback;
  }
  // Quiet Mode only suppresses in-app popup alerts while the user's own
  // Casual Space is open; it never changes message delivery or receipts.
  window.tweaklrQuietModeActive = function () {
    return !!(dnaLoaded && activeSpaceId() && activeNature() === 'casual' && read('quiet', false));
  };
  function write(suffix, value) {
    const spaceId = activeSpaceId();
    if (!spaceId || !dnaLoaded || !supabaseClient) {
      announce('Open a saved Space and sign in to save this.');
      return false;
    }
    dnaState[suffix] = value;
    const snapshot = JSON.parse(JSON.stringify(dnaState));
    dnaSaveQueue = dnaSaveQueue.then(async () => {
      const { error } = await supabaseClient.rpc('save_ming_space_dna_state', {
        p_space_id: spaceId, p_state: snapshot
      });
      if (error) throw error;
    }).then(() => {
      if (activeSpaceId() === spaceId) announce('Saved to your Space.');
    }).catch(error => {
      console.warn('Tweaklr Spaces signature-tool save failed.', error);
      if (activeSpaceId() === spaceId) announce('Could not save to the database. Run the Spaces DNA migration and try again.');
    });
    return true;
  }
  async function loadDnaState() {
    const spaceId = activeSpaceId();
    if (!spaceId || !supabaseClient || !supabaseClient.auth) {
      dnaState = {}; dnaSpaceId = ''; dnaLoaded = false; return;
    }
    if (spaceId === dnaSpaceId && (dnaLoaded || dnaLoadingSpaceId === spaceId)) return;
    dnaSpaceId = spaceId; dnaState = {}; dnaLoaded = false; dnaLoadingSpaceId = spaceId;
    try {
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !session?.user) {
        announce('Sign in to load your saved Space tools.');
        return;
      }
      const { data, error } = await supabaseClient.rpc('get_ming_space_dna_state', { p_space_id: spaceId });
      if (error) throw error;
      if (activeSpaceId() !== spaceId) return;
      dnaState = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      dnaLoaded = true;
      dnaLoadingSpaceId = '';
    } catch (error) {
      console.warn('Tweaklr Spaces signature-tool load failed.', error);
      if (activeSpaceId() === spaceId) announce('Could not load saved tools. Run the Spaces DNA migration.');
    }
    if (activeSpaceId() === spaceId) refreshPanel();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
  function announce(message) {
    let n = document.getElementById('sp-dna-notice');
    if (!n) {
      n = document.createElement('div'); n.id = 'sp-dna-notice';
      n.className = 'sp-dna-notice'; n.setAttribute('role', 'status');
      const host = document.querySelector(ROOT + ' .sp-head');
      if (host) host.appendChild(n);
    }
    if (n) { n.textContent = message; n.hidden = false; clearTimeout(n._timer); n._timer = setTimeout(() => { n.hidden = true; }, 2600); }
  }
  function toolButton(action, label, icon) {
    return '<button type="button" class="sp-dna-action" data-sp-dna="' + action + '">' +
      '<span class="sp-dna-action__icon" aria-hidden="true">' + brandIcon(icon) + '</span><b>' + label + '</b></button>';
  }
  function renderTools() {
    const screen = activeScreen();
    const head = screen?.querySelector('#sp-head');
    if (!screen || !head || !screen.dataset.nature) return;
    const nature = activeNature();
    let panel = document.getElementById('sp-dna-panel');

    // Business Spaces use the Home experience; remove the legacy Board Mode panel.
    // Marketplace Deal Studio remains removed. Other Space tools stay unchanged.
    if (nature === 'business' || nature === 'marketplace') {
      panel?.remove();
      return;
    }

    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'sp-dna-panel'; panel.className = 'sp-dna-panel';
      panel.setAttribute('aria-label', 'Space signature tools');
      head.insertAdjacentElement('afterend', panel);
    }
    const config = {
      business: { title: 'BOARD MODE', desc: 'Keep a goal and deadline close.', buttons: toolButton('goal','Set pinned goal','target') + toolButton('deadline','Set deadline','timer') },
      friendly: { title: 'VIBE CHECK', desc: 'Save your mood to your account for this Space.', buttons: toolButton('mood','Choose mood','hands') + toolButton('joke','Save an inside joke','laugh') },
      casual: { title: 'NO PRESSURE', desc: 'While this Casual Space is open, pause in-app notification popups and sounds. Messages and read receipts stay normal.', buttons: toolButton('quiet', read('quiet', false) ? 'Turn Quiet Mode off' : 'Turn Quiet Mode on', 'cloud') + toolButton('reset-quiet','Reset preference','leaf') },
      silly: { title: 'CHAOS ENGINE', desc: 'Spin the wheel. Choose friendly chaos. Make this Space legendary.', buttons: toolButton('dare','Spin Chaos Roulette','dice') + toolButton('roast','Playful Auto-Roast','laugh') + toolButton('meme-vote','Vote meme of the day','trophy') }
    }[nature];
    if (!config) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = '<div class="sp-dna-top"><div><span class="sp-dna-kicker">TWEAKLR SIGNATURE</span><h3>' + config.title + '</h3><p>' + config.desc + '</p></div><span class="sp-dna-orb" aria-hidden="true">' + brandIcon(({business:'briefcase',friendly:'hands',casual:'cloud',silly:'dice',romantic:'moon',marketplace:'bag'}[nature] || 'moon')) + '</span></div>' +
      '<div class="sp-dna-actions">' + config.buttons + '</div>' + renderSavedSummary(nature);
    panel.dataset.nature = nature;
    panel.dataset.spaceName = activeName();
  }
  function renderSavedSummary(nature) {
    if (nature === 'business') {
      const goal = read('goal', '');
      const deadline = read('deadline', '');
      let countdown = '';
      if (deadline) {
        const ms = new Date(deadline).getTime() - Date.now();
        countdown = '<span class="sp-dna-summary">' + (Number.isFinite(ms) ? (ms >= 0 ? Math.ceil(ms / 3600000) + ' hours left' : 'Deadline passed') : 'Deadline saved') + '</span>';
      }
      return goal ? '<div class="sp-dna-saved"><span class="sp-dna-saved-icon">' + brandIcon('pin') + '</span><b>' + esc(goal) + '</b>' + countdown + '</div>' : '';
    }
    if (nature === 'friendly') {
      const mood = read('mood', null), jokes = read('jokes', []);
      const moodIcon = mood ? MOODS.find(m => (m[0] + ' ' + m[1]) === mood)?.[0] : null;
      return '<div class="sp-dna-saved">' + (mood ? '<span class="sp-dna-saved-icon">' + brandIcon(moodIcon || 'moon') + '</span><b>Your vibe today: ' + esc(mood.split(' ').slice(1).join(' ')) + '</b>' : '<span>No mood selected today.</span>') +
        (jokes.length ? '<span>' + jokes.length + ' inside joke' + (jokes.length === 1 ? '' : 's') + ' saved to your account</span>' : '') + '</div>';
    }
    if (nature === 'casual') return '<div class="sp-dna-saved sp-casual-status' + (read('quiet', false) ? ' is-quiet' : '') + '"><span class="sp-casual-status__icon" aria-hidden="true">' + brandIcon(read('quiet', false) ? 'moon' : 'cloud') + '</span><div><b>' + (read('quiet', false) ? 'Quiet Mode is on' : 'Quiet Mode is off') + '</b><span>' + (read('quiet', false) ? 'While this Space is open, in-app notification popups and sounds are paused. Notifications remain in your inbox; messages and read receipts stay normal.' : 'Turn it on to pause in-app notification popups and sounds while this Space is open.') + '</span></div></div>';
    if (nature === 'silly') {
      const dare = read('dare', '');
      const roast = read('roast', '');
      return '<div class="sp-dna-silly-feed">' +
        '<div class="sp-dna-silly-card sp-dna-silly-card--dare"><span class="sp-dna-silly-card__label">🎲 YOUR LATEST CHAOS</span><p>' + esc(dare || 'The wheel is waiting. Spin it and give the room a story to tell.') + '</p></div>' +
        (roast ? '<div class="sp-dna-silly-card sp-dna-silly-card--roast"><span class="sp-dna-silly-card__label">🔥 FRIENDLY FIRE</span><p>' + esc(roast) + '</p><small>Just for laughs — keep it kind.</small></div>' : '') +
        '</div>';
    }
    if (nature === 'romantic') {
      const date = read('rom-date', '');
      return '<div class="sp-dna-saved"><span class="sp-dna-saved-icon">' + brandIcon(date ? 'moon' : 'heart') + '</span><span>' + (date ? 'Countdown: ' + esc(date) : 'Your little rituals, saved privately to your account.') + '</span></div>';
    }
    if (nature === 'marketplace') {
      const claim = read('claim', '');
      const offers = read('offers', []);
      const claimText = typeof claim === 'string' ? claim : (claim && claim.item ? claim.item : '');
      const claimCard = claimText ? '<div class="sp-dna-deal-card"><div><b>' + esc(claimText) + '</b><small>Interest saved · not reserved</small></div><span class="sp-dna-deal-pill">Tracking</span></div>' : '';
      const offerCards = Array.isArray(offers) ? offers.slice(0,5).map((offer, index) => {
        const currency = esc(offer.currency || '');
        const amount = Number(offer.amount);
        const price = Number(offer.price);
        const amountText = Number.isFinite(amount) ? amount.toLocaleString(undefined,{maximumFractionDigits:2}) : '—';
        const priceText = Number.isFinite(price) ? price.toLocaleString(undefined,{maximumFractionDigits:2}) : '—';
        const statuses = ['Prepared','Sent','Accepted','Declined','Cancelled'];
        const options = statuses.map(status => '<option value="' + status + '"' + (offer.status === status ? ' selected' : '') + '>' + status + '</option>').join('');
        return '<div class="sp-dna-deal-card"><div><b>' + esc(offer.item || 'Offer') + '</b><small>Offer: ' + currency + amountText + ' · Asking: ' + currency + priceText + '</small></div><label class="sp-dna-deal-status"><span>Status</span><select data-sp-deal-status="' + index + '" aria-label="Offer status for ' + esc(offer.item || 'offer') + '">' + options + '</select></label></div>';
      }).join('') : '';
      return '<div class="sp-dna-deal-list">' + (offerCards || '') + claimCard + (!offerCards && !claimCard ? '<div class="sp-dna-saved"><span class="sp-dna-saved-icon">' + brandIcon('bag') + '</span><span>Your offers and tracked items will appear here.</span></div>' : '') + '</div>';
    }
    return '';
  }
  function refreshPanel() {
    const p = document.getElementById('sp-dna-panel');
    if (p) { p.remove(); }
    renderTools();
  }
  function ask(label, initial) {
    const result = window.prompt(label, initial || '');
    return result === null ? null : result.trim();
  }
  function openBoardEditor(action) {
    const isGoal = action === 'goal';
    const screen = activeScreen();
    if (!screen || !document.getElementById('sp-dna-panel')) return;
    document.getElementById('sp-dna-editor')?.remove();

    const currentGoal = String(read('goal', '') || '');
    const currentDeadline = String(read('deadline', '') || '');
    const localDeadline = currentDeadline ? (() => {
      const date = new Date(currentDeadline);
      if (!Number.isFinite(date.getTime())) return '';
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    })() : '';

    const modal = document.createElement('div');
    modal.id = 'sp-dna-editor';
    modal.className = 'sp-dna-editor-backdrop';
    modal.innerHTML = '<section class="sp-dna-editor" role="dialog" aria-modal="true" aria-labelledby="sp-dna-editor-title">' +
      '<div class="sp-dna-editor__top"><span class="sp-dna-editor__icon">' + brandIcon(isGoal ? 'target' : 'timer') + '</span>' +
      '<button type="button" class="sp-dna-editor__close" data-editor-cancel aria-label="Close editor">×</button></div>' +
      '<span class="sp-dna-editor__eyebrow">TWEAKLR SIGNATURE · BOARD MODE</span>' +
      '<h3 id="sp-dna-editor-title">' + (isGoal ? 'Pin your next big move' : 'Set your finish line') + '</h3>' +
      '<p class="sp-dna-editor__desc">' + (isGoal ? 'Give this Space one clear priority. Keep it focused, visible, and actionable.' : 'Choose when this goal should be complete. We’ll show the deadline with your pinned goal.') + '</p>' +
      (isGoal
        ? '<label class="sp-dna-editor__label" for="sp-dna-editor-goal">YOUR PRIORITY</label><textarea id="sp-dna-editor-goal" maxlength="180" rows="3" placeholder="e.g. Ship the new product landing page"></textarea><div class="sp-dna-editor__meta"><span>Make it clear and achievable.</span><span id="sp-dna-goal-count">0 / 180</span></div>'
        : '<label class="sp-dna-editor__label" for="sp-dna-editor-deadline">DEADLINE · YOUR LOCAL TIME</label><input id="sp-dna-editor-deadline" type="datetime-local"><p class="sp-dna-editor__hint">Your time is converted automatically when saved.</p>') +
      '<div class="sp-dna-editor__error" id="sp-dna-editor-error" role="alert" hidden></div>' +
      '<div class="sp-dna-editor__actions">' +
      ((isGoal ? currentGoal : currentDeadline) ? '<button type="button" class="sp-dna-editor__clear" data-editor-clear>Clear ' + (isGoal ? 'goal' : 'deadline') + '</button>' : '') +
      '<button type="button" class="sp-dna-editor__cancel" data-editor-cancel>Cancel</button>' +
      '<button type="button" class="sp-dna-editor__save" data-editor-save>Save ' + (isGoal ? 'goal' : 'deadline') + '</button></div></section>';
    screen.appendChild(modal);

    const field = modal.querySelector(isGoal ? '#sp-dna-editor-goal' : '#sp-dna-editor-deadline');
    if (isGoal) {
      field.value = currentGoal;
      const count = modal.querySelector('#sp-dna-goal-count');
      const updateCount = () => { count.textContent = field.value.length + ' / 180'; };
      field.addEventListener('input', updateCount);
      updateCount();
    } else {
      field.value = localDeadline;
      field.min = (() => {
        const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
        return now.toISOString().slice(0, 16);
      })();
    }
    const close = () => modal.remove();
    const cancelButtons = modal.querySelectorAll('[data-editor-cancel]');
    cancelButtons.forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      close();
    }));
    modal.addEventListener('click', event => {
      if (event.target === modal) close();
    });
    const clearButton = modal.querySelector('[data-editor-clear]');
    if (clearButton) {
      clearButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!write(isGoal ? 'goal' : 'deadline', '')) return;
        close();
        refreshPanel();
      });
    }
    const saveButton = modal.querySelector('[data-editor-save]');
    // Handle editor actions at the modal's capture phase so app-wide delegated
    // click handlers cannot swallow Save/Clear taps before they reach the button.
    modal.addEventListener('click', async event => {
      const button = event.target instanceof Element ? event.target.closest('[data-editor-save], [data-editor-clear]') : null;
      if (!button || !modal.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const error = modal.querySelector('#sp-dna-editor-error');
      error.hidden = true;
      const key = isGoal ? 'goal' : 'deadline';
      let value;
      if (button.hasAttribute('data-editor-clear')) {
        value = '';
      } else if (isGoal) {
        value = field.value.trim();
        if (!value) {
          error.textContent = 'Add a goal first, or use Clear goal to remove the current one.';
          error.hidden = false;
          field.focus();
          return;
        }
      } else {
        if (!field.value) {
          error.textContent = 'Choose a date and time, or use Clear deadline to remove it.';
          error.hidden = false;
          field.focus();
          return;
        }
        const parsed = new Date(field.value);
        if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
          error.textContent = 'Choose a time later than now. The current minute may already have passed.';
          error.hidden = false;
          field.focus();
          return;
        }
        value = parsed.toISOString();
      }

      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = button.hasAttribute('data-editor-clear') ? 'Clearing…' : 'Saving…';
      try {
        if (!write(key, value)) {
          error.textContent = 'Your change was not saved. Make sure you are signed in and this is a saved Space, then try again.';
          error.hidden = false;
          button.disabled = false;
          button.textContent = originalText;
          return;
        }
        close();
        refreshPanel();
      } catch (saveError) {
        console.warn('Tweaklr Board Mode editor action failed.', saveError);
        error.textContent = 'Something interrupted the save. Please try again.';
        error.hidden = false;
        button.disabled = false;
        button.textContent = originalText;
      }
    }, true);
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveButton.click();
    });
    field.focus();
  }


  // Friendly-only UI. Data remains in the existing per-member, per-Space state.
  function openFriendlyModal(type) {
    if (activeNature() !== 'friendly' || !activeScreen()) return;
    document.getElementById('sp-friendly-modal')?.remove();
    const moodMode = type === 'mood';
    const currentMood = String(read('mood', '') || '');
    const jokes = Array.isArray(read('jokes', [])) ? read('jokes', []) : [];
    const modal = document.createElement('div');
    modal.id = 'sp-friendly-modal';
    modal.className = 'sp-friendly-backdrop';
    const moodOptions = MOODS.map((m, i) => '<button type="button" class="sp-friendly-mood' +
      (currentMood === m[0] + ' ' + m[1] ? ' is-selected' : '') +
      '" data-friendly-mood="' + i + '"><span class="sp-friendly-mood__icon">' + brandIcon(m[0]) +
      '</span><span><b>' + esc(m[1]) + '</b><small>' +
      ['Feeling bright and open','Doing alright','Taking it gently','Full of energy','Looking for a quieter moment'][i] +
      '</small></span><span class="sp-friendly-check">✓</span></button>').join('');
    const jokeItems = jokes.map((j, i) => {
      const text = typeof j === 'string' ? j : String(j?.text || '');
      return '<article class="sp-friendly-joke"><p>' + esc(text) +
        '</p><button type="button" data-friendly-delete="' + i + '" aria-label="Delete joke">×</button></article>';
    }).join('');
    modal.innerHTML = '<section class="sp-friendly-modal" role="dialog" aria-modal="true" aria-labelledby="sp-friendly-title">' +
      '<header><span class="sp-friendly-orb">' + brandIcon(moodMode ? 'hands' : 'laugh') + '</span>' +
      '<button type="button" data-friendly-close aria-label="Close">×</button></header>' +
      '<span class="sp-friendly-eyebrow">TWEAKLR · FRIENDLY SPACE</span>' +
      '<h3 id="sp-friendly-title">' + (moodMode ? 'Your mood, your moment' : 'The inside-joke vault') + '</h3>' +
      '<p class="sp-friendly-copy">' + (moodMode ? 'A small check-in for you. Your vibe is saved to your account for this Space.' : 'Keep the little things your circle will never stop laughing about. Saved to your account for this Space.') + '</p>' +
      (moodMode ? '<div class="sp-friendly-moods">' + moodOptions + '</div>' :
        '<form class="sp-friendly-add"><label for="sp-friendly-input">SAVE A NEW INSIDE JOKE</label><textarea id="sp-friendly-input" maxlength="240" rows="2" placeholder="A phrase, a moment, a legendary bit…"></textarea><div class="sp-friendly-add__foot"><small><span data-joke-count>0</span>/240</small><button type="submit">Save to vault ↗</button></div></form>' +
        '<div class="sp-friendly-vault-head"><b>Your saved jokes</b><span>' + jokes.length + ' / 30</span></div>' +
        (jokes.length ? '<div class="sp-friendly-jokes">' + jokeItems + '</div>' : '<div class="sp-friendly-empty">' + brandIcon('bubbles') + '<b>Your vault starts here</b><p>Save the first moment your circle will never stop laughing about.</p></div>')) +
      '<div class="sp-friendly-error" role="alert" hidden></div><footer><button type="button" data-friendly-close>Done</button></footer></section>';
    activeScreen().appendChild(modal);
    const close = () => modal.remove();
    const error = modal.querySelector('.sp-friendly-error');
    modal.querySelectorAll('[data-friendly-close]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); close(); }));
    modal.addEventListener('click', e => { if (e.target === modal) close(); e.stopPropagation(); });
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    if (moodMode) {
      modal.querySelectorAll('[data-friendly-mood]').forEach(button => button.addEventListener('click', e => {
        e.preventDefault();
        const m = MOODS[Number(button.dataset.friendlyMood)];
        if (!m) return;
        if (!write('mood', m[0] + ' ' + m[1])) {
          error.textContent = 'Could not save your vibe. Sign in and open a saved Space, then try again.';
          error.hidden = false; return;
        }
        close(); refreshPanel();
      }));
    } else {
      const input = modal.querySelector('#sp-friendly-input');
      const count = modal.querySelector('[data-joke-count]');
      input.addEventListener('input', () => { count.textContent = String(input.value.length); });
      modal.querySelector('.sp-friendly-add').addEventListener('submit', e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) { error.textContent = 'Write a little memory first.'; error.hidden = false; input.focus(); return; }
        const old = Array.isArray(read('jokes', [])) ? read('jokes', []) : [];
        if (old.length >= 30) { error.textContent = 'Your vault is full. Delete a joke before adding another.'; error.hidden = false; return; }
        if (!write('jokes', [{text, at:Date.now()}, ...old].slice(0, 30))) {
          error.textContent = 'Could not save this joke. Sign in and open a saved Space, then try again.';
          error.hidden = false; return;
        }
        close(); refreshPanel(); announce('Inside joke added to your vault.');
      });
      modal.querySelectorAll('[data-friendly-delete]').forEach(button => button.addEventListener('click', e => {
        e.preventDefault();
        const i = Number(button.dataset.friendlyDelete);
        const old = Array.isArray(read('jokes', [])) ? read('jokes', []) : [];
        if (!Number.isInteger(i) || i < 0 || i >= old.length) return;
        if (!write('jokes', old.filter((_, index) => index !== i))) {
          error.textContent = 'Could not remove that joke. Sign in and try again.'; error.hidden = false; return;
        }
        close(); refreshPanel(); announce('Inside joke removed from your vault.');
      }));
    }
  }

  async function handle(action) {
    switch (action) {
      case 'goal':
      case 'deadline': {
        openBoardEditor(action);
        return;
      }
      case 'mood': {
        const choice = ask('Choose a mood: ' + MOODS.map((m,i) => (i+1)+'. '+m[1]).join(' | '), '1');
        if (choice === null) return;
        const mood = MOODS[Number(choice)-1];
        if (!mood) { announce('Choose a number from 1 to ' + MOODS.length + '.'); return; }
        write('mood', mood[0] + ' ' + mood[1]); announce('Vibe saved to your account.'); break;
      }
      case 'joke': {
        const v = ask('Save an inside joke to your account for this Space:');
        if (v === null || !v) return;
        const jokes = read('jokes', []); jokes.unshift({text:v, at:Date.now()});
        write('jokes', jokes.slice(0, 30)); announce('Inside joke saved to your account.'); break;
      }
      case 'quiet': {
        const enabled = !read('quiet', false);
        if (!write('quiet', enabled)) break;
        announce(enabled ? 'Quiet Mode enabled for this Space. Messages and read receipts remain normal.' : 'Quiet Mode turned off for this Space.');
        break;
      }
      case 'reset-quiet':
        if (write('quiet', false)) announce('Quiet Mode reset to off for this Space.');
        break;
      case 'dare': {
        const previous = Number(read('dare-index', -1));
        let index = Math.floor(Math.random() * DARES.length);
        if (DARES.length > 1 && index === previous) index = (index + 1 + Math.floor(Math.random() * (DARES.length - 1))) % DARES.length;
        const dare = DARES[index];
        write('dare-index', index);
        write('dare', dare);
        announce('🎲 Chaos Roulette: ' + dare);
        break;
      }
      case 'roast': {
        const target = ask('Who is volunteering for a friendly roast? Enter their name or nickname. Keep it playful and get their okay first:');
        if (target === null || !target) return;
        const name = target.slice(0, 40);
        const previous = Number(read('roast-index', -1));
        let index = Math.floor(Math.random() * ROASTS.length);
        if (ROASTS.length > 1 && index === previous) index = (index + 1 + Math.floor(Math.random() * (ROASTS.length - 1))) % ROASTS.length;
        const roast = ROASTS[index](name);
        write('roast-index', index);
        write('roast', roast);
        announce('🔥 Friendly roast ready: ' + roast);
        break;
      }
      case 'meme-vote': {
        const v = ask('Vote for today’s funniest meme. Enter the member name or meme description:');
        if (v === null || !v) return;
        write('meme-vote', {vote:v, at:Date.now()}); announce('Your vote is saved to your account.'); break;
      }
      case 'thinking': {
        const count = Number(read('thinking-count', 0)) + 1;
        write('thinking-count', count); announce('Thinking of you. Gesture saved to your account.'); break;
      }
      case 'love-note': {
        const note = ask('Write your love letter. It will be saved to your account only; it is not sent to the other member.');
        if (note === null || !note) return;
        const notes = read('love-notes', []); notes.unshift({text:note, at:Date.now()});
        write('love-notes', notes.slice(0, 20)); announce('Love letter saved privately to your account, not sent.'); break;
      }
      case 'rom-countdown': {
        const v = ask('What date are you counting down to? (YYYY-MM-DD)', read('rom-date', ''));
        if (v === null) return;
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { announce('Use YYYY-MM-DD.'); return; }
        write('rom-date', v); announce(v ? 'Countdown date saved to your account.' : 'Countdown cleared.'); break;
      }
      case 'haggle': {
        const panel = document.getElementById('sp-dna-panel');
        if (!panel) return;
        panel.querySelector('.sp-dna-offer')?.remove();
        const offer = document.createElement('div'); offer.className = 'sp-dna-offer sp-dna-offer--studio';
        offer.innerHTML = '<div class="sp-dna-deal-field"><label for="sp-dna-item">Item name</label><input id="sp-dna-item" type="text" maxlength="100" placeholder="e.g. Wireless headphones"></div>' +
          '<div class="sp-dna-deal-field"><label for="sp-dna-price">Asking price</label><input id="sp-dna-price" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Enter listed price"></div>' +
          '<label for="sp-dna-haggle-range">Your offer <strong id="sp-dna-haggle-value">—</strong></label><input id="sp-dna-haggle-range" type="range" min="50" max="100" value="85" step="1" disabled>' +
          '<div class="sp-dna-deal-field"><label for="sp-dna-offer-note">Message to seller (optional)</label><textarea id="sp-dna-offer-note" maxlength="240" rows="2" placeholder="Add a friendly note…"></textarea></div>' +
          '<div class="sp-dna-deal-buttons"><button type="button" class="sp-dna-action" data-sp-dna="save-offer">Save offer</button><button type="button" class="sp-dna-action" data-sp-dna="copy-offer">Copy message</button></div>' +
          '<small>Preparing an offer does not send it or reserve the item. You can copy the message into your chat with the seller.</small>';
        panel.appendChild(offer);
        const priceInput = offer.querySelector('#sp-dna-price'), range = offer.querySelector('#sp-dna-haggle-range'), value = offer.querySelector('#sp-dna-haggle-value');
        const update = () => {
          const price = Number(priceInput.value);
          const valid = priceInput.value.trim() !== '' && Number.isFinite(price) && price > 0;
          range.disabled = !valid;
          value.textContent = valid ? price.toLocaleString(undefined,{maximumFractionDigits:2}) + ' × ' + range.value + '% = ' + (price * Number(range.value) / 100).toLocaleString(undefined,{maximumFractionDigits:2}) : 'Enter asking price';
        };
        priceInput.addEventListener('input', update); range.addEventListener('input', update); update(); break;
      }
      case 'save-offer':
      case 'copy-offer': {
        const panel = document.getElementById('sp-dna-panel');
        const item = panel?.querySelector('#sp-dna-item')?.value.trim() || '';
        const priceInput = panel?.querySelector('#sp-dna-price');
        const price = Number(priceInput?.value);
        const range = panel?.querySelector('#sp-dna-haggle-range');
        if (!priceInput || priceInput.value.trim() === '' || !Number.isFinite(price) || price <= 0 || !range || range.disabled) {
          announce('Enter a valid asking price first.'); return;
        }
        const amount = Math.round(price * Number(range.value)) / 100;
        const note = panel.querySelector('#sp-dna-offer-note')?.value.trim() || '';
        const message = 'Hi! I’m interested in ' + (item || 'this item') + '. The listed price is ' + price.toLocaleString(undefined,{maximumFractionDigits:2}) + ', and I’d like to offer ' + amount.toLocaleString(undefined,{maximumFractionDigits:2}) + ' (' + range.value + '% of asking). ' + note;
        if (action === 'copy-offer') {
          try {
            if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(message);
              announce('Offer message copied. Open your seller chat and paste it.');
            } else {
              const box = document.createElement('textarea'); box.value = message; box.setAttribute('readonly',''); box.style.position='fixed'; box.style.opacity='0'; document.body.appendChild(box); box.select();
              const copied = document.execCommand('copy'); box.remove();
              announce(copied ? 'Offer message copied. Open your seller chat and paste it.' : message);
            }
          } catch (_) { announce(message); }
          return;
        }
        const offers = read('offers', []);
        const next = Array.isArray(offers) ? offers.slice() : [];
        next.unshift({item: item || 'Untitled item', price, amount, percent:Number(range.value), note, status:'Prepared', currency:'', at:Date.now()});
        if (write('offers', next.slice(0,20))) { refreshPanel(); announce('Offer saved as Prepared. It has not been sent to the seller.'); }
        return;
      }
      case 'claim-note': {
        const v = ask('Which item do you want to track? Enter its name (this will not reserve it):');
        if (v === null || !v) return;
        if (write('claim', {item:v, status:'Interested', at:Date.now()})) { refreshPanel(); announce('Item added to your deal tracker. Nothing has been reserved.'); }
        return;
      }
    }
    refreshPanel();
  }
  document.addEventListener('change', function (event) {
    const select = event.target instanceof Element ? event.target.closest('[data-sp-deal-status]') : null;
    if (!select || activeNature() !== 'marketplace') return;
    const index = Number(select.dataset.spDealStatus);
    const offers = read('offers', []);
    if (!Array.isArray(offers) || !Number.isInteger(index) || !offers[index]) return;
    const next = offers.slice();
    next[index] = Object.assign({}, next[index], {status:select.value, statusUpdatedAt:Date.now()});
    if (write('offers', next)) { refreshPanel(); announce('Offer status updated. This only updates your tracker.'); }
  });

  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const btn = target?.closest('[data-sp-dna]');
    if (!btn || !document.querySelector(ROOT + ' #sp-dna-panel')) return;
    event.preventDefault();
    event.stopPropagation();
    if (activeNature() === 'friendly' && (btn.dataset.spDna === 'mood' || btn.dataset.spDna === 'joke')) { openFriendlyModal(btn.dataset.spDna); return; }
    handle(btn.dataset.spDna);
  });

  // Observe only the Space header; existing app renderers remain untouched.
  function start() {
    const screen = activeScreen();
    if (!screen) return;
    let lastSpaceId = '';
    const observer = new MutationObserver(() => {
      if (screen.dataset.nature) {
        const id = activeSpaceId();
        if (id && id !== lastSpaceId) {
          lastSpaceId = id;
          loadDnaState();
        }
        if (!document.getElementById('sp-dna-panel')) renderTools();
        else {
          const panel = document.getElementById('sp-dna-panel');
          if (panel.dataset.nature !== activeNature() || panel.dataset.spaceName !== activeName()) refreshPanel();
        }
      }
    });
    observer.observe(screen, {attributes:true, childList:true, subtree:true, attributeFilter:['data-nature']});
    renderTools();
    if (activeSpaceId()) { lastSpaceId = activeSpaceId(); loadDnaState(); }
    document.addEventListener('click', function (event) {
      // Romantic Space tabs and controls render locally; do not schedule an
      // extra delayed panel rebuild after every tap in this Space.
      if (activeNature() !== 'romantic' && event.target.closest('#screen-space [data-sp]')) {
        setTimeout(refreshPanel, 80);
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
