/* Tweaklr Messages media fallback.
   This file only repairs chat image/video rendering when an older cached
   attachment renderer is still present. It does not change messaging data. */
(function () {
  'use strict';

  async function hydrateNode(node) {
    if (!node || node.dataset.mingMediaFix === 'loading' || node.dataset.mingMediaFix === 'ready') return;
    const path = node.dataset.chatAttachment;
    if (!path || typeof supabaseClient === 'undefined') return;

    const img = node.querySelector('[data-chat-attachment-image]');
    const video = node.querySelector('[data-chat-attachment-video]');
    if (!img && !video) return;

    node.dataset.mingMediaFix = 'loading';

    try {
      const result = await supabaseClient.storage
        .from('ming-message-files')
        .createSignedUrl(path, 2592000);

      const url = result?.data?.signedUrl;
      if (!url) throw new Error(result?.error?.message || 'No signed URL');

      const loading = node.querySelector('.chat-attachment-loading');

      if (img) {
        img.alt = '';
        img.removeAttribute('hidden');
        img.onload = function () {
          if (loading) loading.remove();
          node.dataset.mingMediaFix = 'ready';
        };
        img.onerror = function () {
          img.setAttribute('hidden', '');
          node.dataset.mingMediaFix = '';
          if (loading) loading.textContent = 'Image could not be loaded';
        };
        img.src = url;
        return;
      }

      if (video) {
        video.removeAttribute('hidden');
        video.onloadedmetadata = function () {
          if (loading) loading.remove();
          node.dataset.mingMediaFix = 'ready';
        };
        video.onerror = function () {
          video.setAttribute('hidden', '');
          node.dataset.mingMediaFix = '';
          if (loading) loading.textContent = 'Video could not be loaded';
        };
        video.src = url;
      }
    } catch (error) {
      node.dataset.mingMediaFix = '';
      const loading = node.querySelector('.chat-attachment-loading');
      if (loading) loading.textContent = 'Attachment unavailable';
    }
  }

  function scan() {
    document.querySelectorAll('[data-chat-attachment]').forEach(hydrateNode);
  }

  function start() {
    scan();
    const thread = document.querySelector('#chat-thread');
    if (thread) {
      new MutationObserver(scan).observe(thread, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
