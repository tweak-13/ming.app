/* Isolated auth-page enhancement; Supabase authentication remains in script.js. */
document.addEventListener('DOMContentLoaded', () => {
 ['login-password','signup-password'].forEach(id => {
  const input=document.getElementById(id); if(!input||input.dataset.revealReady)return;
  input.dataset.revealReady='1';
  const button=document.createElement('button'); button.type='button'; button.className='auth-password-toggle'; button.textContent='Show';
  button.setAttribute('aria-label','Show password'); button.setAttribute('aria-pressed','false');
  button.addEventListener('click',()=>{const reveal=input.type==='password';input.type=reveal?'text':'password';button.textContent=reveal?'Hide':'Show';button.setAttribute('aria-label',reveal?'Hide password':'Show password');button.setAttribute('aria-pressed',String(reveal));input.focus();});
  input.parentElement.appendChild(button);
 });
});