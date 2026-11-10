/* Isolated auth-page enhancement. Supabase remains the authentication authority. */
document.addEventListener('DOMContentLoaded', () => {
  ['login-password','signup-password','recovery-password','recovery-confirm'].forEach(id => {
    const input = document.getElementById(id);
    if (!input || input.dataset.revealReady) return;
    input.dataset.revealReady = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'auth-password-toggle';
    button.textContent = 'Show';
    button.setAttribute('aria-label', 'Show password');
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.textContent = reveal ? 'Hide' : 'Show';
      button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', String(reveal));
      input.focus();
    });
    input.parentElement.appendChild(button);
  });

  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const recoveryForm = document.getElementById('recovery-form');
  const forgotButton = document.getElementById('forgot-password');
  const loginEmail = document.getElementById('login-email');
  const loginMessage = document.getElementById('login-message');
  const recoveryMessage = document.getElementById('recovery-message');
  const recoveryPassword = document.getElementById('recovery-password');
  const recoveryConfirm = document.getElementById('recovery-confirm');

  /*
   * Keep login independent from the large application bundle.
   * Capture the submit before other handlers; this prevents a failed or
   * duplicate app-level listener from falling back to a native form reload.
   */
  if (loginForm && !loginForm.dataset.standaloneAuthReady) {
    loginForm.dataset.standaloneAuthReady = '1';
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (loginForm.dataset.standaloneSubmitting === 'true') return;

      const email = (loginEmail?.value || '').trim();
      const passwordInput = document.getElementById('login-password');
      const password = passwordInput?.value || '';
      if (!email || !loginEmail?.checkValidity() || !password) {
        setMessage(loginMessage, 'Enter your email address and password.');
        return;
      }

      loginForm.dataset.standaloneSubmitting = 'true';
      const submit = loginForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      setMessage(loginMessage, 'Signing you in…');

      try {
        if (!window.supabase?.createClient) {
          throw new Error('Supabase authentication library did not load');
        }

        const authClient = window.supabase.createClient(
          'https://avnuejgqaxygxeiyqeny.supabase.co',
          'sb_publishable_wF8lZnLfC-x9ySqXUqRcHQ_CI_QWrHW',
          {
            auth: {
              autoRefreshToken: true,
              persistSession: true,
              detectSessionInUrl: true,
              storage: window.localStorage
            }
          }
        );

        const { data, error } = await authClient.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;
        if (!data?.session?.access_token || !data?.user?.id) {
          throw new Error('Authentication returned no active session');
        }

        setMessage(loginMessage, 'Signed in successfully. Opening Tweaklr…');
        window.location.assign(new URL('app.html', window.location.href).href);
      } catch (error) {
        console.error('Tweaklr standalone sign-in failed:', error?.message || error);
        const messageText = error?.message || '';
        if (/invalid login credentials/i.test(messageText)) {
          setMessage(loginMessage, 'Email or password is incorrect.');
        } else if (/email not confirmed/i.test(messageText)) {
          setMessage(loginMessage, 'Please confirm your email address before signing in.');
        } else if (/rate limit|too many requests/i.test(messageText)) {
          setMessage(loginMessage, 'Too many attempts. Please wait a moment and try again.');
        } else if (/failed to fetch|network|load/i.test(messageText)) {
          setMessage(loginMessage, 'Could not reach the sign-in service. Check your connection and try again.');
        } else {
          setMessage(loginMessage, 'Sign-in failed. Please check your details and try again.');
        }
      } finally {
        loginForm.dataset.standaloneSubmitting = 'false';
        if (submit) submit.disabled = false;
      }
    }, true);
  }

  const setMessage = (node, value) => {
    if (node) node.textContent = value;
  };

  const showRecovery = () => {
    if (loginForm) loginForm.hidden = true;
    if (signupForm) signupForm.hidden = true;
    if (recoveryForm) recoveryForm.hidden = false;
    setMessage(recoveryMessage, '');
    recoveryPassword?.focus();
  };

  const showLogin = message => {
    if (recoveryForm) recoveryForm.hidden = true;
    if (signupForm) signupForm.hidden = true;
    if (loginForm) loginForm.hidden = false;
    if (recoveryPassword) recoveryPassword.value = '';
    if (recoveryConfirm) recoveryConfirm.value = '';
    setMessage(loginMessage, message || '');
  };

  if (forgotButton) {
    forgotButton.addEventListener('click', async () => {
      const email = (loginEmail?.value || '').trim().toLowerCase();
      if (!email || !loginEmail?.checkValidity()) {
        setMessage(loginMessage, 'Enter your email address first.');
        loginEmail?.focus();
        return;
      }
      if (forgotButton.dataset.submitting === 'true') return;
      forgotButton.dataset.submitting = 'true';
      forgotButton.disabled = true;
      setMessage(loginMessage, 'If an account exists for that address, a password reset link will be sent.');
      try {
        if (typeof supabaseClient === 'undefined') throw new Error('Auth unavailable');
        const redirectTo = window.location.href.split('#')[0].split('?')[0];
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) console.warn('Tweaklr password reset request could not be completed.');
      } catch (_) {
        // Keep the response generic to avoid disclosing whether an account exists.
      } finally {
        forgotButton.dataset.submitting = 'false';
        forgotButton.disabled = false;
      }
    });
  }

  if (recoveryForm) {
    recoveryForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (recoveryForm.dataset.submitting === 'true') return;
      const password = recoveryPassword?.value || '';
      const confirmation = recoveryConfirm?.value || '';
      if (password.length < 12 || password.length > 128) {
        setMessage(recoveryMessage, 'Password must be 12–128 characters long.');
        return;
      }
      if (password !== confirmation) {
        setMessage(recoveryMessage, 'The passwords do not match.');
        recoveryConfirm?.focus();
        return;
      }

      recoveryForm.dataset.submitting = 'true';
      const submit = recoveryForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (typeof supabaseClient === 'undefined') throw new Error('Auth unavailable');
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError || !session?.user) {
          setMessage(recoveryMessage, 'This reset link is invalid or expired. Request a new password reset link.');
          return;
        }
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) {
          setMessage(recoveryMessage, 'Your password could not be updated. Request a new reset link and try again.');
          return;
        }
        await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => {});
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        showLogin('Password updated. Sign in with your new password.');
      } catch (_) {
        setMessage(recoveryMessage, 'Something went wrong. Request a new reset link and try again.');
      } finally {
        recoveryForm.dataset.submitting = 'false';
        if (submit) submit.disabled = false;
      }
    });
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (hashParams.get('type') === 'recovery') showRecovery();

  if (typeof supabaseClient !== 'undefined' && supabaseClient.auth?.onAuthStateChange) {
    supabaseClient.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') showRecovery();
    });
  }
});
