/* Тема Б «Пространство» — логика витрины «Гараж 46».
   Всё на клиенте: tilt-карточки и параллакс — rAF, герой-объект — Zdog
   (вендорен локально, грузится лениво после load). Сервер не участвует.
   prefers-reduced-motion отключает всю глубину: страница живёт статикой. */

(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- шапка: бургер ---------- */

  var burger = document.getElementById('sp-burger');
  var nav = document.getElementById('sp-nav');

  burger.addEventListener('click', function () {
    nav.classList.toggle('sp-nav--open');
  });

  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') nav.classList.remove('sp-nav--open');
  });

  /* ---------- форма заявки (демо: никуда не отправляется) ---------- */

  var form = document.getElementById('sp-form');
  var note = document.getElementById('sp-form-note');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    note.hidden = false;
    form.reset();
  });

  /* ---------- параллакс фона: плоскости двигаются с разной скоростью ---------- */

  var planeFar = document.querySelector('.sp-bg__plane--far');
  var blobBlue = document.querySelector('.sp-bg__blob--blue');
  var blobWarm = document.querySelector('.sp-bg__blob--warm');
  var parallaxTick = false;

  function parallax() {
    parallaxTick = false;
    var y = window.scrollY;
    planeFar.style.transform = 'translateY(' + y * 0.06 + 'px)';
    blobBlue.style.transform = 'translateY(' + y * 0.12 + 'px)';
    blobWarm.style.transform = 'translateY(' + y * -0.08 + 'px)';
  }

  if (!reduceMotion && !window.matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('scroll', function () {
      if (!parallaxTick) {
        parallaxTick = true;
        requestAnimationFrame(parallax);
      }
    }, { passive: true });
  }

  /* ---------- tilt-карточки услуг: слои внутри живут на translateZ ---------- */

  var services = document.getElementById('sp-services');

  if (!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var MAX_TILT = 6;

    services.addEventListener('pointermove', function (e) {
      var card = e.target.closest('.sp-card');
      if (!card) return;

      var rect = card.getBoundingClientRect();
      var px = (e.clientX - rect.left) / rect.width - 0.5;
      var py = (e.clientY - rect.top) / rect.height - 0.5;

      card.style.transform =
        'rotateX(' + (-py * MAX_TILT).toFixed(2) + 'deg)' +
        ' rotateY(' + (px * MAX_TILT).toFixed(2) + 'deg)' +
        ' translateZ(10px)';
    });

    services.addEventListener('pointerout', function (e) {
      var card = e.target.closest('.sp-card');
      if (card && !card.contains(e.relatedTarget)) {
        card.style.transform = '';
      }
    });
  }

  /* ---------- герой-объект: статичный SVG → Zdog ---------- */

  var sceneSvg = document.getElementById('sp-scene-svg');
  var sceneCanvas = document.getElementById('sp-scene-canvas');

  window.addEventListener('load', function () {
    if (reduceMotion) return; // статичный SVG остаётся навсегда

    var script = document.createElement('script');
    script.src = './zdog.dist.min.js';
    script.onload = initZdog;
    script.onerror = function () { /* движок не загрузился — SVG и есть сцена */ };
    document.head.appendChild(script);
  });

  function initZdog() {
    if (!window.Zdog) return;

    var TAU = Zdog.TAU;
    var COLOR = {
      tyre: '#232B3A',
      rim: '#2E62E8',
      spoke: '#DDE5F5',
      hub: '#1B3A8F',
      axle: '#9AA7BE',
      ground: 'rgba(46, 98, 232, 0.14)',
    };

    var dpr = Math.min(window.devicePixelRatio || 1, 2); // кап разрешения — бережём GPU
    var SIZE = 360;

    var visible = true;
    var dragging = false;
    var rafId = null;

    sceneCanvas.width = SIZE * dpr;
    sceneCanvas.height = SIZE * dpr;

    var scene = new Zdog.Illustration({
      element: sceneCanvas,
      zoom: 1.05,
      dragRotate: true,
      rotate: { x: 0.5, y: -0.5 },
      onDragStart: function () { dragging = true; },
      onDragEnd: function () { dragging = false; },
    });

    // тень-подиум лежит на «полу»
    new Zdog.Ellipse({
      addTo: scene,
      diameter: 190,
      stroke: 4,
      translate: { y: 128 },
      rotate: { x: TAU / 4 },
      color: COLOR.ground,
      fill: true,
    });

    var wheel = new Zdog.Anchor({
      addTo: scene,
      translate: { y: -8 },
    });

    new Zdog.Ellipse({
      addTo: wheel,
      diameter: 156,
      stroke: 34,
      color: COLOR.tyre,
    });

    new Zdog.Ellipse({
      addTo: wheel,
      diameter: 100,
      stroke: 14,
      color: COLOR.rim,
    });

    var TAU5 = TAU / 5;
    for (var i = 0; i < 5; i++) {
      new Zdog.Shape({
        addTo: wheel,
        path: [{ x: 0, y: 0 }, { x: 38, y: 0 }],
        rotate: { z: i * TAU5 },
        stroke: 9,
        color: COLOR.spoke,
      });
    }

    new Zdog.Ellipse({
      addTo: wheel,
      diameter: 30,
      stroke: 16,
      color: COLOR.hub,
    });

    // ось: намёк на третье измерение, видно при повороте
    new Zdog.Shape({
      addTo: scene,
      path: [{ z: -70 }, { z: 70 }],
      translate: { y: -8 },
      stroke: 6,
      color: COLOR.axle,
    });

    sceneSvg.hidden = true;
    sceneCanvas.hidden = false;

    // канвас квадратный: CSS-ширина повторяет ширину, которую имел SVG
    function fitCanvas() {
      sceneCanvas.style.width = sceneSvg.clientWidth + 'px';
      sceneCanvas.style.height = sceneSvg.clientWidth + 'px';
    }

    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    // рендер только когда сцена на экране и вкладка видима — иначе пауза
    function tick() {
      rafId = null;
      if (!visible || document.hidden) return;
      if (!dragging) wheel.rotate.z += 0.007;
      scene.updateRenderCanvas();
      rafId = requestAnimationFrame(tick);
    }

    function play() {
      if (rafId === null && visible && !document.hidden) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function pause() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) play(); else pause();
      }, { threshold: 0.05 }).observe(sceneCanvas);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause(); else play();
    });

    play();
  }
})();
