/* Тема В «Милый брутализм» — логика витрины «Гараж 46».
   Минимум JS: бургер и демо-форма. Вся «жизнь» темы — в CSS:
   marquee, продавливание кнопок, наклоны стикеров. */

(function () {
  'use strict';

  var burger = document.getElementById('bt-burger');
  var nav = document.getElementById('bt-nav');

  burger.addEventListener('click', function () {
    nav.classList.toggle('bt-nav--open');
  });

  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') nav.classList.remove('bt-nav--open');
  });

  var form = document.getElementById('bt-form');
  var note = document.getElementById('bt-form-note');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    note.hidden = false;
    form.reset();
  });
})();
