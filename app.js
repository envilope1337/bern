(function () {
  'use strict';

  var BOOK = window.BOOK;
  var STORE_KEY = 'bern-progress-v1';
  var DAY = 24 * 60 * 60 * 1000;
  var TABS = [
    { id: 'notes', title: 'Конспект' },
    { id: 'quiz', title: 'Тест' },
    { id: 'write', title: 'Письменно' },
    { id: 'cards', title: 'Карточки' }
  ];
  var GRADES = ['Снова', 'Трудно', 'Хорошо', 'Легко'];
  var app = document.getElementById('app');
  var storageWorks = true;
  var state = loadState();

  // ---------- хранение прогресса ----------

  function loadState() {
    var s = null;
    try {
      s = JSON.parse(localStorage.getItem(STORE_KEY));
      localStorage.setItem(STORE_KEY + '-probe', '1');
      localStorage.removeItem(STORE_KEY + '-probe');
    } catch (e) {
      storageWorks = false;
    }
    s = s || {};
    s.read = s.read || {};
    s.quiz = s.quiz || {};
    s.write = s.write || {};
    s.cards = s.cards || {};
    return s;
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storageWorks = false;
    }
  }

  // ---------- мелкие помощники ----------

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (kid) {
      if (kid) node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  function count(n, one, few, many) {
    return n + ' ' + plural(n, one, few, many);
  }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function unitIds() {
    var ids = [];
    BOOK.sections.forEach(function (s) {
      s.units.forEach(function (id) { if (BOOK.units[id]) ids.push(id); });
    });
    return ids;
  }

  function crumbs() {
    return el('nav', { class: 'crumbs' }, [el('a', { href: '#/', text: '← Все главы' })]);
  }

  // ---------- карточки: расписание повторений ----------

  function startOfDay(t) {
    var d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function schedule(prev, grade) {
    var ease = prev ? prev.ease : 2.5;
    var ivl = prev ? prev.ivl : 0;
    var reps = prev ? prev.reps : 0;
    if (grade === 0) return { ease: Math.max(1.3, ease - 0.2), ivl: 0, reps: 0 };
    var next;
    if (reps === 0) next = [0, 1, 2, 4][grade];
    else if (grade === 1) next = Math.max(ivl + 1, Math.round(ivl * 1.2));
    else if (grade === 2) next = Math.max(ivl + 1, Math.round(ivl * ease));
    else next = Math.max(ivl + 2, Math.round(ivl * ease * 1.3));
    if (grade === 1) ease = Math.max(1.3, ease - 0.15);
    if (grade === 3) ease += 0.15;
    return { ease: ease, ivl: next, reps: reps + 1 };
  }

  function gradeCard(card, grade) {
    var now = Date.now();
    var next = schedule(state.cards[card.id], grade);
    next.due = grade === 0 ? now : startOfDay(now) + next.ivl * DAY;
    state.cards[card.id] = next;
    saveState();
  }

  function intervalLabel(card, grade) {
    if (grade === 0) return 'сегодня';
    return count(schedule(state.cards[card.id], grade).ivl, 'день', 'дня', 'дней');
  }

  function cardsOf(ids) {
    var list = [];
    ids.forEach(function (id) {
      var unit = BOOK.units[id];
      (unit.cards || []).forEach(function (c) {
        list.push({ id: c.id, q: c.q, a: c.a, unit: unit });
      });
    });
    return list;
  }

  // Новые карточки попадают в очередь только внутри своей главы,
  // общее повторение берёт те, что уже были пройдены хотя бы раз.
  function dueCards(ids, withNew) {
    var now = Date.now();
    return cardsOf(ids).filter(function (c) {
      var s = state.cards[c.id];
      return s ? s.due <= now : withNew;
    });
  }

  function nextDueText(ids) {
    var now = Date.now();
    var soonest = null;
    cardsOf(ids).forEach(function (c) {
      var s = state.cards[c.id];
      if (s && s.due > now && (soonest === null || s.due < soonest)) soonest = s.due;
    });
    if (soonest === null) return '';
    return new Date(soonest).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  // ---------- схемы состояний Я и трансакций ----------

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var EGO = [
    { key: 'P', letter: 'Р', cls: 'ego-p', y: 62 },
    { key: 'A', letter: 'В', cls: 'ego-a', y: 132 },
    { key: 'C', letter: 'Ре', cls: 'ego-c', y: 202 }
  ];
  var R = 30;

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function diagram(spec) {
    var people = spec.people || [''];
    var xs = people.length === 1 ? [160] : [84, 236];
    var root = svg('svg', { viewBox: '0 0 320 244', role: 'img', 'aria-label': spec.alt || spec.caption || '' });
    root.setAttribute('class', 'dia');

    function center(ref) {
      var ego = EGO.filter(function (e) { return e.key === ref.charAt(1); })[0];
      return { x: xs[+ref.charAt(0)], y: ego.y };
    }

    people.forEach(function (name, i) {
      if (name) {
        var label = svg('text', { x: xs[i], y: 16, 'text-anchor': 'middle' });
        label.setAttribute('class', 'dia-name');
        label.textContent = name;
        root.appendChild(label);
      }
      EGO.forEach(function (ego) {
        var c = svg('circle', { cx: xs[i], cy: ego.y, r: R });
        c.setAttribute('class', 'dia-ego ' + ego.cls);
        root.appendChild(c);
        var t = svg('text', { x: xs[i], y: ego.y + 6, 'text-anchor': 'middle' });
        t.setAttribute('class', 'dia-letter');
        t.textContent = ego.letter;
        root.appendChild(t);
      });
    });

    // Стрелки между одной и той же парой кругов разводим в стороны, чтобы не слипались.
    var groups = {};
    (spec.arrows || []).forEach(function (a) {
      var key = [a.from, a.to].sort().join('-');
      (groups[key] = groups[key] || []).push(a);
    });

    (spec.arrows || []).forEach(function (a) {
      var key = [a.from, a.to].sort().join('-');
      var group = groups[key];
      var shift = (group.indexOf(a) - (group.length - 1) / 2) * 16;
      var ends = [a.from, a.to].sort();
      var p0 = center(ends[0]);
      var p1 = center(ends[1]);
      var len0 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      var nx = -(p1.y - p0.y) / len0;
      var ny = (p1.x - p0.x) / len0;

      var s = center(a.from);
      var e = center(a.to);
      s = { x: s.x + nx * shift, y: s.y + ny * shift };
      e = { x: e.x + nx * shift, y: e.y + ny * shift };
      var len = Math.hypot(e.x - s.x, e.y - s.y);
      var ux = (e.x - s.x) / len;
      var uy = (e.y - s.y) / len;
      var x1 = s.x + ux * (R + 3);
      var y1 = s.y + uy * (R + 3);
      var x2 = e.x - ux * (R + 4);
      var y2 = e.y - uy * (R + 4);

      var line = svg('line', { x1: x1, y1: y1, x2: x2 - ux * 6, y2: y2 - uy * 6 });
      line.setAttribute('class', 'dia-arrow' + (a.dashed ? ' is-dashed' : ''));
      root.appendChild(line);

      var head = svg('polygon', {
        points: [
          x2 + ',' + y2,
          (x2 - ux * 10 - uy * 5) + ',' + (y2 - uy * 10 + ux * 5),
          (x2 - ux * 10 + uy * 5) + ',' + (y2 - uy * 10 - ux * 5)
        ].join(' ')
      });
      head.setAttribute('class', 'dia-head');
      root.appendChild(head);

      if (a.n) {
        var side = a.side || (shift >= 0 ? 1 : -1);
        var num = svg('text', {
          x: s.x + ux * len * 0.4 + nx * 11 * side,
          y: s.y + uy * len * 0.4 + ny * 11 * side + 4,
          'text-anchor': 'middle'
        });
        num.setAttribute('class', 'dia-num');
        num.textContent = a.n;
        root.appendChild(num);
      }
    });

    return el('figure', { class: 'figure' }, [root, el('figcaption', { text: spec.caption || '' })]);
  }

  // ---------- главная ----------

  function unitStatus(unit) {
    var bits = [];
    if (state.read[unit.id]) bits.push('конспект прочитан');
    var quiz = state.quiz[unit.id];
    if (quiz) bits.push('тест ' + quiz.best + ' из ' + quiz.total);
    var started = (unit.cards || []).filter(function (c) { return state.cards[c.id]; }).length;
    if (started) {
      var due = dueCards([unit.id], false).length;
      bits.push(due ? 'повторить ' + count(due, 'карточку', 'карточки', 'карточек') : 'карточки повторены');
    }
    return bits.length ? bits.join(', ') : 'ещё не начата';
  }

  function viewHome() {
    document.title = 'Берн: конспекты, тесты и карточки';

    var mark = el('div', { class: 'mark', 'aria-hidden': 'true' }, [
      el('span', { class: 'ego-p', text: 'Р' }),
      el('span', { class: 'ego-a', text: 'В' }),
      el('span', { class: 'ego-c', text: 'Ре' })
    ]);
    app.appendChild(el('header', { class: 'masthead' }, [
      mark,
      el('div', {}, [
        el('h1', { text: BOOK.title }),
        el('p', { class: 'lead', text: 'Конспект, тест и карточки по каждой главе' })
      ])
    ]));

    if (!storageWorks) {
      app.appendChild(el('p', {
        class: 'notice',
        text: 'Прогресс не сохраняется: браузер запретил хранить данные. Открой страницу в обычной вкладке, не в приватной.'
      }));
    }

    var due = dueCards(unitIds(), false).length;
    var today = el('section', { class: 'today' });
    if (due) {
      today.appendChild(el('a', {
        class: 'btn btn-primary',
        href: '#/review',
        text: 'Повторить ' + count(due, 'карточку', 'карточки', 'карточек')
      }));
    } else {
      today.appendChild(el('p', {
        class: 'muted',
        text: 'Повторять пока нечего. Карточки попадают сюда после первого прохода на вкладке «Карточки» внутри главы.'
      }));
    }
    app.appendChild(today);

    BOOK.sections.forEach(function (section) {
      var rows = section.units.filter(function (id) { return BOOK.units[id]; }).map(function (id) {
        var unit = BOOK.units[id];
        return el('li', {}, [el('a', { class: 'row', href: '#/u/' + id + '/notes' }, [
          el('span', { class: 'row-title', text: unit.title }),
          el('span', { class: 'row-meta', text: unitStatus(unit) })
        ])]);
      });
      var questions = BOOK.sectionQuiz[section.id];
      if (questions) {
        var res = state.quiz['section-' + section.id];
        rows.push(el('li', {}, [el('a', { class: 'row row-section', href: '#/s/' + section.id }, [
          el('span', { class: 'row-title', text: 'Тест по разделу' }),
          el('span', {
            class: 'row-meta',
            text: res
              ? 'лучший результат ' + res.best + ' из ' + res.total
              : count(questions.length, 'вопрос', 'вопроса', 'вопросов') + ', ещё не пройден'
          })
        ])]));
      }
      app.appendChild(el('section', { class: 'section' }, [
        el('h2', { text: section.title }),
        el('ul', { class: 'rows' }, rows)
      ]));
    });
  }

  // ---------- глава ----------

  function viewUnit(unit, tab) {
    if (!TABS.some(function (t) { return t.id === tab; })) tab = 'notes';
    document.title = unit.title;
    app.appendChild(crumbs());
    app.appendChild(el('h1', { text: unit.title }));
    app.appendChild(el('nav', { class: 'tabs', 'aria-label': 'Разделы главы' }, TABS.map(function (t) {
      return el('a', {
        class: 'tab' + (t.id === tab ? ' is-current' : ''),
        href: '#/u/' + unit.id + '/' + t.id,
        'aria-current': t.id === tab ? 'page' : null,
        text: t.title
      });
    })));

    var body = el('div', { class: 'tab-body' });
    app.appendChild(body);
    if (tab === 'notes') renderNotes(body, unit);
    if (tab === 'quiz') runQuiz(body, unit.quiz || [], unit.id);
    if (tab === 'write') renderWrite(body, unit);
    if (tab === 'cards') renderUnitCards(body, unit);
  }

  function renderNotes(root, unit) {
    var article = el('article', { class: 'notes' });
    (unit.notes || []).forEach(function (b) {
      if (b.h) article.appendChild(el('h2', { text: b.h }));
      else if (b.p) article.appendChild(el('p', { text: b.p }));
      else if (b.list) {
        article.appendChild(el('ul', {}, b.list.map(function (item) { return el('li', { text: item }); })));
      } else if (b.term) {
        article.appendChild(el('div', { class: 'def' }, [
          el('p', { class: 'def-term', text: b.term }),
          el('p', { text: b.def }),
          b.simple ? el('p', { class: 'def-simple' }, [el('strong', { text: 'Проще. ' }), b.simple]) : null
        ]));
      } else if (b.ex) {
        article.appendChild(el('div', { class: 'example' }, [
          el('p', {}, [el('strong', { text: 'Пример. ' }), b.ex])
        ]));
      } else if (b.dia) {
        article.appendChild(diagram(b.dia));
      }
    });
    root.appendChild(article);

    var foot = el('div', { class: 'actions' });
    root.appendChild(foot);
    function drawFoot() {
      foot.textContent = '';
      if (state.read[unit.id]) {
        foot.appendChild(el('p', { class: 'done-line', text: 'Конспект отмечен прочитанным' }));
        foot.appendChild(el('a', { class: 'btn btn-primary', href: '#/u/' + unit.id + '/quiz', text: 'Перейти к тесту' }));
      } else {
        foot.appendChild(el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: 'Отметить прочитанным',
          onclick: function () {
            state.read[unit.id] = true;
            saveState();
            drawFoot();
          }
        }));
      }
    }
    drawFoot();
  }

  // ---------- тест с вариантами ----------

  function runQuiz(root, questions, quizId) {
    var session = null;

    function intro() {
      root.textContent = '';
      var res = state.quiz[quizId];
      root.appendChild(el('p', {
        text: count(questions.length, 'вопрос', 'вопроса', 'вопросов') +
          ' с вариантами ответа. После каждого выбора показывается разбор: и когда ответ верный, и когда нет.'
      }));
      if (res) {
        root.appendChild(el('p', {
          class: 'muted',
          text: 'Лучший результат: ' + res.best + ' из ' + res.total + '. Последний: ' + res.last + ' из ' + res.total + '.'
        }));
      }
      root.appendChild(el('div', { class: 'actions' }, [el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: res ? 'Пройти тест ещё раз' : 'Начать тест',
        onclick: function () { start(questions); }
      })]));
    }

    function start(list) {
      session = { list: shuffle(list), pos: 0, wrong: [], full: list.length === questions.length };
      ask();
    }

    function ask() {
      root.textContent = '';
      var q = session.list[session.pos];
      var answered = false;
      var feedback = el('div', { class: 'feedback', 'aria-live': 'polite' });
      var buttons = shuffle(q.options.map(function (_, i) { return i; })).map(function (idx) {
        var b = el('button', { class: 'option', type: 'button', onclick: function () { choose(idx, b); } }, [
          el('span', { text: q.options[idx].t })
        ]);
        b.dataset.idx = idx;
        return b;
      });

      function choose(idx, btn) {
        if (answered) return;
        answered = true;
        var ok = idx === q.correct;
        buttons.forEach(function (b) {
          b.disabled = true;
          if (+b.dataset.idx === q.correct) {
            b.classList.add('is-right');
            b.appendChild(el('span', { class: 'option-tag', text: 'верный ответ' }));
          }
        });
        if (!ok) {
          btn.classList.add('is-wrong');
          btn.appendChild(el('span', { class: 'option-tag', text: 'твой ответ' }));
          session.wrong.push(q);
        }
        feedback.appendChild(el('p', { class: 'verdict ' + (ok ? 'is-ok' : 'is-bad'), text: ok ? 'Верно' : 'Неверно' }));
        if (!ok) {
          feedback.appendChild(el('p', {}, [el('strong', { text: 'Почему не этот вариант. ' }), q.options[idx].why]));
        }
        feedback.appendChild(el('p', {}, [el('strong', { text: 'Разбор. ' }), q.explain]));
        var last = session.pos === session.list.length - 1;
        var next = el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: last ? 'Показать результат' : 'Следующий вопрос',
          onclick: function () {
            session.pos += 1;
            if (last) finish(); else ask();
            window.scrollTo(0, 0);
          }
        });
        feedback.appendChild(el('div', { class: 'actions' }, [next]));
        feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      root.appendChild(el('p', { class: 'muted', text: 'Вопрос ' + (session.pos + 1) + ' из ' + session.list.length }));
      root.appendChild(el('h2', { class: 'question', text: q.q }));
      root.appendChild(el('div', { class: 'options' }, buttons));
      root.appendChild(feedback);
    }

    function finish() {
      root.textContent = '';
      var total = session.list.length;
      var right = total - session.wrong.length;
      if (session.full) {
        var prev = state.quiz[quizId];
        state.quiz[quizId] = { best: Math.max(right, prev ? prev.best : 0), last: right, total: total };
        saveState();
      }
      root.appendChild(el('h2', { text: 'Результат: ' + right + ' из ' + total }));
      var wrong = session.wrong;
      if (wrong.length) {
        root.appendChild(el('p', { text: 'Вопросы с ошибкой и верные ответы на них:' }));
        root.appendChild(el('ul', { class: 'mistakes' }, wrong.map(function (q) {
          return el('li', {}, [
            el('p', { class: 'mistake-q', text: q.q }),
            el('p', { text: q.options[q.correct].t })
          ]);
        })));
        root.appendChild(el('div', { class: 'actions' }, [
          el('button', {
            class: 'btn btn-primary',
            type: 'button',
            text: 'Повторить вопросы с ошибкой',
            onclick: function () { start(wrong); }
          }),
          el('button', { class: 'btn', type: 'button', text: 'Пройти весь тест заново', onclick: function () { start(questions); } })
        ]));
      } else {
        root.appendChild(el('p', { text: session.full ? 'Ошибок нет.' : 'Все вопросы с ошибкой теперь решены верно.' }));
        root.appendChild(el('div', { class: 'actions' }, [
          el('button', { class: 'btn', type: 'button', text: 'Пройти весь тест заново', onclick: function () { start(questions); } })
        ]));
      }
    }

    if (!questions.length) {
      root.appendChild(el('p', { class: 'muted', text: 'Для этой главы теста пока нет.' }));
      return;
    }
    intro();
  }

  // ---------- письменные вопросы ----------

  function renderWrite(root, unit) {
    var list = unit.write || [];
    if (!list.length) {
      root.appendChild(el('p', { class: 'muted', text: 'Для этой главы письменных вопросов пока нет.' }));
      return;
    }
    root.appendChild(el('p', {
      text: 'Ответь своими словами, потом сверься с эталоном и отметь, какие пункты попали в твой ответ. Ответы сохраняются на этом устройстве.'
    }));
    list.forEach(function (item, i) { root.appendChild(writeCard(item, i)); });
  }

  function writeCard(item, i) {
    var saved = state.write[item.id] || { text: '', shown: false, marks: [] };
    var card = el('article', { class: 'write' });
    var fieldId = 'answer-' + item.id;
    var area = el('textarea', { id: fieldId, rows: '6' });
    var after = el('div', { class: 'write-after' });
    area.value = saved.text;

    function persist() {
      state.write[item.id] = saved;
      saveState();
    }

    function draw() {
      after.textContent = '';
      area.readOnly = saved.shown;
      if (!saved.shown) {
        var check = el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: 'Сверить с эталоном',
          onclick: function () {
            if (!area.value.trim()) {
              hint.textContent = 'Сначала напиши ответ: хотя бы пару предложений.';
              area.focus();
              return;
            }
            saved.shown = true;
            persist();
            draw();
          }
        });
        var hint = el('p', { class: 'field-hint', 'aria-live': 'polite' });
        after.appendChild(hint);
        after.appendChild(el('div', { class: 'actions' }, [check]));
        return;
      }

      var score = el('p', { class: 'muted', 'aria-live': 'polite' });
      function drawScore() {
        score.textContent = 'Отмечено ' + saved.marks.length + ' из ' + item.points.length;
      }
      var checks = el('ul', { class: 'checks' }, item.points.map(function (point, idx) {
        var box = el('input', { type: 'checkbox' });
        box.checked = saved.marks.indexOf(idx) !== -1;
        box.addEventListener('change', function () {
          saved.marks = saved.marks.filter(function (m) { return m !== idx; });
          if (box.checked) saved.marks.push(idx);
          persist();
          drawScore();
        });
        return el('li', {}, [el('label', { class: 'check' }, [box, el('span', { text: point })])]);
      }));
      drawScore();

      var copyNote = el('p', { class: 'field-hint', 'aria-live': 'polite' });
      var copy = el('button', {
        class: 'btn',
        type: 'button',
        text: 'Скопировать вопрос и ответ',
        onclick: function () {
          var text = 'Вопрос: ' + item.q + '\n\nМой ответ: ' + area.value.trim();
          var done = function () { copyNote.textContent = 'Скопировано. Можно вставить в чат и попросить разбор.'; };
          var fail = function () { copyNote.textContent = 'Скопировать не получилось. Выдели текст ответа и скопируй вручную.'; };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
          else fail();
        }
      });
      var redo = el('button', {
        class: 'btn',
        type: 'button',
        text: 'Написать заново',
        onclick: function () {
          if (!window.confirm('Стереть этот ответ и отметки?')) return;
          saved = { text: '', shown: false, marks: [] };
          area.value = '';
          persist();
          draw();
        }
      });

      after.appendChild(el('div', { class: 'model' }, [
        el('h3', { text: 'Эталонный ответ' }),
        el('p', { text: item.model }),
        el('h3', { text: 'Что должно быть в ответе' }),
        checks,
        score
      ]));
      after.appendChild(el('div', { class: 'actions' }, [copy, redo]));
      after.appendChild(copyNote);
    }

    area.addEventListener('input', function () {
      saved.text = area.value;
      persist();
    });

    card.appendChild(el('h2', { class: 'question', text: (i + 1) + '. ' + item.q }));
    card.appendChild(el('label', { class: 'field-label', for: fieldId, text: 'Твой ответ' }));
    card.appendChild(area);
    card.appendChild(after);
    draw();
    return card;
  }

  // ---------- карточки ----------

  function renderUnitCards(root, unit) {
    var ids = [unit.id];
    if (!(unit.cards || []).length) {
      root.appendChild(el('p', { class: 'muted', text: 'Для этой главы карточек пока нет.' }));
      return;
    }
    var queue = dueCards(ids, true);
    if (queue.length) {
      runCards(root, queue, { scheduled: true, onDone: function () { root.textContent = ''; renderUnitCards(root, unit); } });
      return;
    }
    var next = nextDueText(ids);
    root.appendChild(el('p', { text: 'Все карточки этой главы на сегодня повторены.' + (next ? ' Ближайшее повторение: ' + next + '.' : '') }));
    root.appendChild(el('div', { class: 'actions' }, [el('button', {
      class: 'btn',
      type: 'button',
      text: 'Пройти все карточки вне расписания',
      onclick: function () {
        root.textContent = '';
        runCards(root, cardsOf(ids), { scheduled: false, onDone: function () { root.textContent = ''; renderUnitCards(root, unit); } });
      }
    })]));
  }

  function runCards(root, cards, opts) {
    var queue = shuffle(cards);

    function show() {
      root.textContent = '';
      if (!queue.length) { opts.onDone(); return; }
      var card = queue[0];
      var controls = el('div', { class: 'actions' });
      var back = el('p', { class: 'flash-back', hidden: true, text: card.a });

      function answer(again, grade) {
        queue.shift();
        if (opts.scheduled) gradeCard(card, grade);
        if (again) queue.push(card);
        show();
      }

      function reveal() {
        back.hidden = false;
        controls.textContent = '';
        if (opts.scheduled) {
          controls.className = 'grades';
          GRADES.forEach(function (name, grade) {
            controls.appendChild(el('button', {
              class: 'btn grade',
              type: 'button',
              onclick: function () { answer(grade === 0, grade); }
            }, [el('span', { text: name }), el('span', { class: 'grade-when', text: intervalLabel(card, grade) })]));
          });
        } else {
          controls.className = 'grades grades-two';
          controls.appendChild(el('button', { class: 'btn grade', type: 'button', text: 'Не помню', onclick: function () { answer(true); } }));
          controls.appendChild(el('button', { class: 'btn grade', type: 'button', text: 'Помню', onclick: function () { answer(false); } }));
        }
      }

      controls.appendChild(el('button', { class: 'btn btn-primary', type: 'button', text: 'Показать ответ', onclick: reveal }));

      root.appendChild(el('p', {
        class: 'muted',
        text: 'Осталось: ' + count(queue.length, 'карточка', 'карточки', 'карточек') +
          (opts.scheduled ? '' : '. Расписание повторений не меняется.')
      }));
      root.appendChild(el('div', { class: 'flash' }, [
        opts.showUnit ? el('p', { class: 'flash-unit', text: card.unit.title }) : null,
        el('p', { class: 'flash-front', text: card.q }),
        back
      ]));
      root.appendChild(controls);
    }

    show();
  }

  // ---------- тест по разделу и общее повторение ----------

  function viewSectionQuiz(section) {
    document.title = 'Тест по разделу: ' + section.title;
    app.appendChild(crumbs());
    app.appendChild(el('h1', { text: 'Тест по разделу' }));
    app.appendChild(el('p', { class: 'lead', text: section.title }));
    var body = el('div', { class: 'tab-body' });
    app.appendChild(body);
    runQuiz(body, BOOK.sectionQuiz[section.id], 'section-' + section.id);
  }

  function viewReview() {
    document.title = 'Повторение карточек';
    app.appendChild(crumbs());
    app.appendChild(el('h1', { text: 'Повторение карточек' }));
    var body = el('div', { class: 'tab-body' });
    app.appendChild(body);
    var ids = unitIds();

    function done() {
      body.textContent = '';
      var next = nextDueText(ids);
      body.appendChild(el('p', { text: 'На сегодня всё повторено.' + (next ? ' Ближайшее повторение: ' + next + '.' : '') }));
      body.appendChild(el('div', { class: 'actions' }, [el('a', { class: 'btn btn-primary', href: '#/', text: 'К списку глав' })]));
    }

    var queue = dueCards(ids, false);
    if (!queue.length) { done(); return; }
    runCards(body, queue, { scheduled: true, showUnit: true, onDone: done });
  }

  // ---------- маршруты ----------

  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    app.textContent = '';
    window.scrollTo(0, 0);
    var section = BOOK.sections.filter(function (s) { return s.id === parts[1]; })[0];
    if (parts[0] === 'u' && BOOK.units[parts[1]]) viewUnit(BOOK.units[parts[1]], parts[2]);
    else if (parts[0] === 's' && section && BOOK.sectionQuiz[section.id]) viewSectionQuiz(section);
    else if (parts[0] === 'review') viewReview();
    else viewHome();
  }

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
