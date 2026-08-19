/**
 * Vesha Shared Auth Module
 * Provides unified authentication state, UI modal, and header widgets across the app.
 */
(function (global) {
  let currentMe = null;
  let modalEl = null;

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Ошибка ' + res.status);
    }
    return data;
  }

  async function getMe(forceRefresh = false) {
    if (currentMe && !forceRefresh) return currentMe;
    try {
      currentMe = await api('/api/auth/me');
    } catch (err) {
      console.warn('Auth check failed:', err);
      currentMe = { user: null, guestId: null, usage: {}, googleEnabled: false };
    }
    return currentMe;
  }

  function dispatchAuthChange(detail) {
    const event = new CustomEvent('auth:change', { detail });
    window.dispatchEvent(event);
    document.dispatchEvent(event);
    updateAllWidgets();
  }

  async function login(email, password) {
    const res = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await getMe(true);
    dispatchAuthChange({ user: res.user, loggedIn: true });
    return res.user;
  }

  async function register(email, password, displayName) {
    const res = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });
    await getMe(true);
    dispatchAuthChange({ user: res.user, loggedIn: true });
    return res.user;
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    await getMe(true);
    dispatchAuthChange({ user: null, loggedIn: false });
  }

  function createModalDOM() {
    if (modalEl) return modalEl;

    const overlay = document.createElement('div');
    overlay.id = 'vesha-auth-modal';
    overlay.className = 'vesha-auth-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');

    overlay.innerHTML = `
      <div class="vesha-auth-modal__backdrop" data-close="true"></div>
      <div class="vesha-auth-modal__dialog">
        <button type="button" class="vesha-auth-modal__close" data-close="true" aria-label="Закрыть">&times;</button>
        <div class="vesha-auth-modal__header">
          <div class="vesha-auth-modal__brand">Vesha</div>
          <h2 class="vesha-auth-modal__title" id="vesha-auth-modal-title">Вход в аккаунт</h2>
          <p class="vesha-auth-modal__subtitle">Авторизуйтесь для доступа ко всем возможностям экспериментов</p>
        </div>

        <div class="vesha-auth-tabs" role="tablist">
          <button type="button" class="vesha-auth-tab is-active" id="vesha-tab-login" role="tab" aria-selected="true" data-tab="login">Вход</button>
          <button type="button" class="vesha-auth-tab" id="vesha-tab-register" role="tab" aria-selected="false" data-tab="register">Регистрация</button>
        </div>

        <div class="vesha-auth-alert" id="vesha-auth-alert" hidden></div>

        <form id="vesha-form-login" class="vesha-auth-form" role="tabpanel" aria-labelledby="vesha-tab-login">
          <div class="vesha-form-group">
            <label for="vesha-login-email">Email</label>
            <input type="email" id="vesha-login-email" name="email" required autocomplete="email" placeholder="name@example.com" />
          </div>
          <div class="vesha-form-group">
            <label for="vesha-login-password">Пароль</label>
            <input type="password" id="vesha-login-password" name="password" required minlength="8" autocomplete="current-password" placeholder="••••••••" />
          </div>
          <button type="submit" class="vesha-btn vesha-btn--primary vesha-btn--block" id="vesha-login-submit">
            <span>Войти</span>
          </button>
        </form>

        <form id="vesha-form-register" class="vesha-auth-form" role="tabpanel" aria-labelledby="vesha-tab-register" hidden>
          <div class="vesha-form-group">
            <label for="vesha-reg-name">Имя (необязательно)</label>
            <input type="text" id="vesha-reg-name" name="displayName" autocomplete="name" placeholder="Как вас зовут?" />
          </div>
          <div class="vesha-form-group">
            <label for="vesha-reg-email">Email</label>
            <input type="email" id="vesha-reg-email" name="email" required autocomplete="email" placeholder="name@example.com" />
          </div>
          <div class="vesha-form-group">
            <label for="vesha-reg-password">Пароль</label>
            <input type="password" id="vesha-reg-password" name="password" required minlength="8" autocomplete="new-password" placeholder="Минимум 8 символов" />
          </div>
          <button type="submit" class="vesha-btn vesha-btn--primary vesha-btn--block" id="vesha-reg-submit">
            <span>Создать аккаунт</span>
          </button>
        </form>

        <div class="vesha-auth-oauth" id="vesha-auth-oauth" hidden>
          <div class="vesha-auth-divider"><span>или</span></div>
          <a class="vesha-google-btn" id="vesha-google-btn" href="/api/auth/google">
            <svg class="vesha-google-icon" viewBox="0 0 24 24" width="18" height="18">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Войти через Google</span>
          </a>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    modalEl = overlay;

    // Listeners
    overlay.addEventListener('click', (e) => {
      if (e.target.dataset.close) {
        closeModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
        closeModal();
      }
    });

    const tabs = overlay.querySelectorAll('.vesha-auth-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        setModalTab(tab.dataset.tab);
      });
    });

    const loginForm = overlay.querySelector('#vesha-form-login');
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = overlay.querySelector('#vesha-login-submit');
      const email = loginForm.email.value.trim();
      const password = loginForm.password.value;
      setModalBusy(submitBtn, true, 'Вход…');
      hideModalAlert();

      try {
        await login(email, password);
        closeModal();
      } catch (err) {
        showModalAlert(err.message, 'error');
      } finally {
        setModalBusy(submitBtn, false, 'Войти');
      }
    });

    const regForm = overlay.querySelector('#vesha-form-register');
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = overlay.querySelector('#vesha-reg-submit');
      const displayName = regForm.displayName.value.trim();
      const email = regForm.email.value.trim();
      const password = regForm.password.value;
      setModalBusy(submitBtn, true, 'Регистрация…');
      hideModalAlert();

      try {
        await register(email, password, displayName);
        closeModal();
      } catch (err) {
        showModalAlert(err.message, 'error');
      } finally {
        setModalBusy(submitBtn, false, 'Создать аккаунт');
      }
    });

    return modalEl;
  }

  function setModalTab(tabName) {
    if (!modalEl) createModalDOM();
    const isLogin = tabName === 'login';
    const loginTab = modalEl.querySelector('#vesha-tab-login');
    const regTab = modalEl.querySelector('#vesha-tab-register');
    const loginForm = modalEl.querySelector('#vesha-form-login');
    const regForm = modalEl.querySelector('#vesha-form-register');
    const titleEl = modalEl.querySelector('#vesha-auth-modal-title');

    loginTab.classList.toggle('is-active', isLogin);
    loginTab.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    regTab.classList.toggle('is-active', !isLogin);
    regTab.setAttribute('aria-selected', !isLogin ? 'true' : 'false');

    loginForm.hidden = !isLogin;
    regForm.hidden = isLogin;

    titleEl.textContent = isLogin ? 'Вход в аккаунт' : 'Регистрация';
    hideModalAlert();
  }

  function setModalBusy(btn, busy, text) {
    btn.disabled = busy;
    btn.querySelector('span').textContent = text;
    btn.classList.toggle('is-loading', busy);
  }

  function showModalAlert(message, type = 'error') {
    const alertEl = modalEl.querySelector('#vesha-auth-alert');
    alertEl.textContent = message;
    alertEl.className = `vesha-auth-alert vesha-auth-alert--${type}`;
    alertEl.hidden = false;
  }

  function hideModalAlert() {
    if (!modalEl) return;
    const alertEl = modalEl.querySelector('#vesha-auth-alert');
    alertEl.hidden = true;
    alertEl.textContent = '';
  }

  async function openModal(initialTab = 'login') {
    createModalDOM();
    setModalTab(initialTab);
    const me = await getMe();

    const oauthWrap = modalEl.querySelector('#vesha-auth-oauth');
    const googleBtn = modalEl.querySelector('#vesha-google-btn');
    if (me.googleEnabled) {
      oauthWrap.hidden = false;
      const currentPath = window.location.pathname + window.location.search;
      googleBtn.href = `/api/auth/google?returnTo=${encodeURIComponent(currentPath)}`;
    } else {
      oauthWrap.hidden = true;
    }

    modalEl.setAttribute('aria-hidden', 'false');
    modalEl.classList.add('is-open');
    document.body.classList.add('vesha-modal-open');

    const firstInput = modalEl.querySelector(initialTab === 'login' ? '#vesha-login-email' : '#vesha-reg-name');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.classList.remove('is-open');
    document.body.classList.remove('vesha-modal-open');
    hideModalAlert();
  }

  function renderAuthWidget(containerEl) {
    if (!containerEl) return;
    const me = currentMe || { user: null };

    if (me.user) {
      const name = me.user.displayName || me.user.email.split('@')[0];
      const initial = (name || 'U').charAt(0).toUpperCase();
      containerEl.innerHTML = `
        <div class="vesha-user-bar">
          <div class="vesha-user-badge">
            <span class="vesha-user-avatar" title="${escapeHtml(me.user.email)}">${escapeHtml(initial)}</span>
            <div class="vesha-user-meta">
              <span class="vesha-user-name">${escapeHtml(name)}</span>
              <span class="vesha-user-email">${escapeHtml(me.user.email)}</span>
            </div>
          </div>
          <button type="button" class="vesha-btn vesha-btn--sm vesha-btn--outline" id="vesha-logout-btn">
            Выйти
          </button>
        </div>
      `;

      const logoutBtn = containerEl.querySelector('#vesha-logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          logoutBtn.disabled = true;
          try {
            await logout();
          } catch (err) {
            console.error('Logout error:', err);
            logoutBtn.disabled = false;
          }
        });
      }
    } else {
      containerEl.innerHTML = `
        <div class="vesha-user-bar vesha-user-bar--guest">
          <span class="vesha-guest-badge">Гость</span>
          <button type="button" class="vesha-btn vesha-btn--sm vesha-btn--primary" id="vesha-login-btn">
            Войти
          </button>
        </div>
      `;

      const loginBtn = containerEl.querySelector('#vesha-login-btn');
      if (loginBtn) {
        loginBtn.addEventListener('click', () => openModal('login'));
      }
    }
  }

  function updateAllWidgets() {
    const containers = document.querySelectorAll('[data-vesha-auth-widget]');
    containers.forEach((el) => renderAuthWidget(el));
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function init() {
    createModalDOM();
    await getMe();
    updateAllWidgets();

    document.querySelectorAll('[data-vesha-auth-open]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.dataset.veshaAuthOpen || 'login';
        openModal(tab);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.VeshaAuth = {
    getMe,
    login,
    register,
    logout,
    openModal,
    closeModal,
    renderAuthWidget,
    updateAllWidgets,
    api,
  };
})(typeof window !== 'undefined' ? window : this);
