(function () {
  'use strict';

  // Мобильное меню
  const burger = document.getElementById('os-burger');
  const nav = document.getElementById('os-nav');
  burger.addEventListener('click', () => nav.classList.toggle('os-nav--open'));
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') nav.classList.remove('os-nav--open');
  });

  // Демо-форма: данные никуда не уходят, в боевом варианте заявка попадает в чат-движок
  const form = document.getElementById('os-form');
  const note = document.getElementById('os-form-note');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    note.hidden = false;
    form.reset();
  });
})();
