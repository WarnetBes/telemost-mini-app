/* telemost-mini-app — форма анкеты смены БКСМН.
   Собирает текст анкеты в ключ-строчном формате, который парсит
   smeta.py (модуль telemost-bot из issue #9). Отправляет через
   Telegram.WebApp.sendData(data) — сервисное сообщение web_app_data
   уходит боту; бот вызывает генератор.
   Работает и вне Telegram (preview.html) — тогда показывает анкету,
   копирует в буфер. */

(function () {
  'use strict';

  var WebApp = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(WebApp && WebApp.initDataUnsafe && WebApp.initDataUnsafe.user_id);
  var C11 = { name: 'C11', display: 'С11' };
  var B18 = { name: 'B18', display: 'В18-19' };

  var NUM_FIELDS = ['план', 'факт', 'брак', 'часы', 'подготовка', 'уборка', 'обед'];

  // ---------- DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
  function setVal(id, v) { var e = $(id); if (e) e.value = v; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Дефолт даты — сегодня (для поля type=date нужен YYYY-MM-DD)
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // ---------- Динамические блоки ----------
  var участки = [];   // [{id, el}]
  var uid = 0;

  function mkRow(fieldsHtml) {
    var div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = fieldsHtml;
    return div;
  }

  function addУчасток() {
    var c = $('участкиContainer');
    var wrap = document.createElement('section');
    wrap.className = 'участок';
    var i = ++uid;
    wrap.innerHTML = '' +
      '<div class="uhead">' +
        '<span class="ulabel">Участок ' + i + '</span>' +
        '<button type="button" class="del" data-u="' + i + '" aria-label="Удалить">✕</button>' +
      '</div>' +
      '<fieldset>' +
        '<div class="row"><label>Имя участка<input class="u_имя" type="text" placeholder="АКО"></label>' +
        '<label>Заголовок<input class="u_заголовок" type="text" placeholder="Жарочная плита АКО"></label></div>' +
        '<div class="row"><label>Примечание<input class="u_примечание" type="text" placeholder="работала одна плита"></label>' +
        '<label>План <input class="u_план" type="number" placeholder="13364"></label></div>' +
        '<div class="row"><label>Факт <input class="u_факт" type="number" placeholder="7762"></label>' +
        '<label>Доделка (прошлая смена)<input class="u_доделка" type="number" placeholder="0"></label>' +
        '<label>Ед. изм.<input class="u_ед" type="text" value="шт"></label></div>' +
        '<div class="subblock" data-positions></div>' +
        '<div class="subblock" data-sotrudniki></div>' +
        '<div class="row simple">' +
          '<label>Подготовка (мин)<input class="u_подготовка" type="number" value="30"></label>' +
          '<label>Уборка (мин)<input class="u_уборка" type="number" value="30"></label>' +
          '<label>Обед (мин)<input class="u_обед" type="number" value="60"></label>' +
        '</div>' +
        '<div class="subblock" data-prostoi></div>' +
        '<div class="acts">' +
          '<button type="button" class="add small" data-add-pos>+ Позиция</button>' +
          '<button type="button" class="add small" data-add-sotr>+ Сотрудник</button>' +
          '<button type="button" class="add small" data-add-prostoi>+ Простой</button>' +
        '</div>' +
      '</fieldset>';
    c.appendChild(wrap);
    участки.push(wrap);
    wrap.querySelector('[data-add-pos]').addEventListener('click', addПозиция.bind(null, wrap));
    wrap.querySelector('[data-add-sotr]').addEventListener('click', addСотрудник.bind(null, wrap));
    wrap.querySelector('[data-add-prostoi]').addEventListener('click', addПростой.bind(null, wrap));
    wrap.querySelector('.del').addEventListener('click', function () {
      wrap.remove();
      участки = участки.filter(function (x) { return x !== wrap; });
      rebuild();
    });
    rebuild();
    return wrap;
  }

  function addПозиция(wrap) {
    var box = wrap.querySelector('[data-positions]');
    var row = document.createElement('div');
    row.className = 'hline';
    row.innerHTML = '<input class="p_имя" type="text" placeholder="Котлеты из курицы">' +
      '<input class="p_план" type="number" placeholder="план">' +
      '<input class="p_факт" type="number" placeholder="факт">' +
      '<button type="button" class="del small" aria-label="Удалить">✕</button>';
    row.querySelector('.del').addEventListener('click', function () { row.remove(); rebuild(); });
    box.appendChild(row);
    rebuild();
  }

  function addСотрудник(wrap) {
    var box = wrap.querySelector('[data-sotrudniki]');
    var row = document.createElement('div');
    row.className = 'hline';
    row.innerHTML = '<input class="s_фио" type="text" placeholder="Фамилия Имя (штат)">' +
      '<button type="button" class="del small" aria-label="Удалить">✕</button>';
    row.querySelector('.del').addEventListener('click', function () { row.remove(); rebuild(); });
    box.appendChild(row);
    rebuild();
  }

  function addПростой(wrap) {
    var box = wrap.querySelector('[data-prostoi]');
    var row = document.createElement('div');
    row.className = 'hline';
    row.innerHTML = '<input class="pr_имя" type="text" placeholder="Ожидание ПФ / Поломка оборудования">' +
      '<input class="pr_мин" type="number" placeholder="мин">' +
      '<button type="button" class="del small" aria-label="Удалить">✕</button>';
    row.querySelector('.del').addEventListener('click', function () { row.remove(); rebuild(); });
    box.appendChild(row);
    rebuild();
  }

  // ---------- ПК-блок ----------
  function addПКСтрока(тип) {
    var box = $('пкБлок');
    var row = document.createElement('div');
    row.className = 'hline';
    var ph = (тип === 'пробито') ? 'Котлеты | факт 7762 | сверка: Котлеты из курицы обжаренные'
                                  : 'Фрикадельки мясные | факт 8958 | план 8958';
    row.innerHTML = '<input type="text" data-тип="' + тип + '" placeholder="' + esc(ph) + '">' +
      '<button type="button" class="del small" aria-label="Удалить">✕</button>';
    row.querySelector('.del').addEventListener('click', function () { row.remove(); rebuild(); });
    box.appendChild(row);
    rebuild();
  }

  // ---------- Состав ----------
  function addСостав() {
    var box = $('составБлок');
    var row = document.createElement('div');
    row.className = 'hline';
    row.innerHTML = '<input class="sst_имя" type="text" placeholder="АКО">' +
      '<input class="sst_кол" type="number" placeholder="кол-во" value="1">' +
      '<input class="sst_прим" type="text" placeholder="примечание (необязательно)">' +
      '<button type="button" class="del small" aria-label="Удалить">✕</button>';
    row.querySelector('.del').addEventListener('click', function () { row.remove(); rebuild(); });
    box.appendChild(row);
    rebuild();
  }

  // ---------- Сборка анкеты ----------
  function join(s) { return s.filter(function (x) { return x !== null && x !== undefined && x.trim() !== ''; }).join('\n'); }

  function collectPosition(row) {
    var имя = row.querySelector('.p_имя').value.trim();
    var план = row.querySelector('.p_план').value.trim();
    var факт = row.querySelector('.p_факт').value.trim();
    var parts = ['позиция: ' + имя];
    if (план) parts.push('план ' + план);
    if (факт) parts.push('факт ' + факт);
    return parts.join(' | ');
  }

  function collectУчасток(wrap) {
    var lines = [];
    var имя = wrap.querySelector('.u_имя').value.trim();
    if (!имя) return null;
    lines.push('участок: ' + имя);
    var заг = wrap.querySelector('.u_заголовок').value.trim();
    if (заг) lines.push('заголовок: ' + заг);
    var прим = wrap.querySelector('.u_примечание').value.trim();
    if (прим) lines.push('примечание: ' + прим);
    var план = wrap.querySelector('.u_план').value.trim();
    if (план) lines.push('план: ' + план);
    var факт = wrap.querySelector('.u_факт').value.trim();
    if (факт) lines.push('факт: ' + факт);
    var дод = wrap.querySelector('.u_доделка').value.trim();
    if (дод) lines.push('доделка: ' + дод);
    var ед = wrap.querySelector('.u_ед').value.trim();
    if (ед && ед !== 'шт') lines.push('ед: ' + ед);

    wrap.querySelectorAll('[data-positions] .hline').forEach(function (r) {
      var l = collectPosition(r);
      if (l) lines.push(l);
    });
    wrap.querySelectorAll('[data-sotrudniki] .hline').forEach(function (r) {
      var ф = r.querySelector('.s_фио').value.trim();
      if (ф) lines.push('сотрудник: ' + ф);
    });
    var подг = wrap.querySelector('.u_подготовка').value.trim();
    var уб = wrap.querySelector('.u_уборка').value.trim();
    var обед = wrap.querySelector('.u_обед').value.trim();
    if (подг && подг !== '30') lines.push('подготовка: ' + подг);
    if (уб && уб !== '30') lines.push('уборка: ' + уб);
    if (обед && обед !== '60') lines.push('обед: ' + обед);
    wrap.querySelectorAll('[data-prostoi] .hline').forEach(function (r) {
      var имяП = r.querySelector('.pr_имя').value.trim();
      var мин = r.querySelector('.pr_мин').value.trim();
      if (имяП && мин) lines.push('простой: ' + имяП + ' | ' + мин);
    });
    return lines;
  }

  function build() {
    var lines = ['#Отчет'];
    lines.push('цех: ' + val('цех'));
    lines.push('дата: ' + (val('дата') || ''));
    lines.push('смена: ' + (val('смена') || 'ночь'));
    lines.push('часы: ' + (val('часы') || '12'));
    if (val('брак')) lines.push('брак: ' + val('брак'));
    if (val('замечания')) lines.push('замечания: ' + val('замечания'));

    участки.forEach(function (w) {
      var cols = collectУчасток(w);
      if (cols) lines = lines.concat(cols);
    });

    var пкЗаг = val('пкЗаголовок');
    var пкСтрок = $('пкБлок').querySelectorAll('.hline');
    var естьПК = пкЗаг || пкСтрок.length || val('пкОхлаждение');
    if (естьПК) {
      lines.push('пк: ' + (пкЗаг || 'охлаждение и перетарка'));
      $('пкБлок').querySelectorAll('.hline').forEach(function (r) {
        var inp = r.querySelector('input');
        var v = inp.value.trim();
        if (v) lines.push(inp.getAttribute('data-тип') + ': ' + v);
      });
      if (val('пкОхлаждение')) lines.push('охлаждение: ' + val('пкОхлаждение'));
      var пПод = val('пкПодготовка'), пУб = val('пкУборка'), пОб = val('пкОбед');
      if (пПод && пПод !== '30') lines.push('подготовка: ' + пПод);
      if (пУб && пУб !== '30') lines.push('уборка: ' + пУб);
      if (пОб && пОб !== '60') lines.push('обед: ' + пОб);
    }

    var сост = $('составБлок').querySelectorAll('.hline');
    сост.forEach(function (r) {
      var имяС = r.querySelector('.sst_имя').value.trim();
      var кол = r.querySelector('.sst_кол').value.trim();
      var прим = r.querySelector('.sst_прим').value.trim();
      if (имяС) {
        var s = 'состав: ' + имяС + ' | ' + (кол || '1');
        if (прим) s += ' | ' + прим;
        lines.push(s);
      }
    });

    if (val('времяРаботы')) lines.push('время_работы_цеха: ' + val('времяРаботы'));

    return join(lines);
  }

  // ---------- Валидация на клиенте (зеркалит smeta.py) ----------
  function validate() {
    var problems = [];
    if (!val('цех')) problems.push('не выбран цех');
    if (!val('дата')) problems.push('не заполнена дата');
    участки.forEach(function (w) {
      var имя = w.querySelector('.u_имя').value.trim();
      if (!имя) problems.push('у одного из участков не заполнено имя');
    });
    return problems;
  }

  // ---------- Предпросмотр + отправка ----------
  function rebuild() {
    var txt = build();
    var preEl = $('pre');
    if (preEl) preEl.textContent = txt;

    var problems = validate();
    var err = $('errorBox');
    if (problems.length) {
      err.textContent = 'Проверьте: ' + problems.join('; ');
      err.hidden = false;
    } else {
      err.hidden = true;
    }

    var send = $('sendBtn');
    if (send) send.disabled = problems.length > 0 || !txt;
  }

  function currentDisplay() {
    return (val('цех') || 'C11') === 'C11' ? 'С11' : 'В18-19';
  }

  function send() {
    var txt = build();
    if (!txt) return;
    var problems = validate();
    if (problems.length) {
      if (WebApp) WebApp.showAlert('Анкета не заполнена: ' + problems.join('; '));
      else alert('Анкета не заполнена: ' + problems.join('; '));
      return;
    }
    if (WebApp && WebApp.sendData) {
      WebApp.sendData(txt);
    } else if (WebApp) {
      // открыт НЕ клавиатурной web_app-кнопкой (меню/инлайн) — sendData недоступен
      WebApp.showAlert('Откройте форму через кнопку «Заполнить отчёт» в чате (/start). Из меню Mini App отправить нельзя (лимит Telegram).');
    } else {
      // вне Telegram: копируем в буфер
      navigator.clipboard.writeText(txt).catch(function () {});
      alert('Анкета скопирована в буфер:\n\n' + txt);
    }
  }

  // ---------- Telegram-интеграция ----------
  function initTelegram() {
    if (!WebApp) return;
    WebApp.ready();
    WebApp.expand();
    WebApp.MainButton.setText('Отправить мастеру');
    WebApp.MainButton.onClick(send);
    WebApp.MainButton.disable();
    if (WebApp.BackButton) WebApp.BackButton.show();
  }

  function onFieldChange() { rebuild(); if (WebApp && WebApp.MainButton) { if (validate().length === 0) WebApp.MainButton.enable(); else WebApp.MainButton.disable(); } }

  // ---------- Инициализация ----------
  function init() {
    setVal('дата', todayISO());

    ['цех','смена','часы','брак','замечания','пкЗаголовок','пкОхлаждение','пкПодготовка','пкУборка','пкОбед','времяРаботы']
      .forEach(function (id) {
        var e = $(id);
        if (e) e.addEventListener('input', onFieldChange);
      });

    // делегированный ввод внутри контейнеров
    ['участкиContainer','пкБлок','составБлок'].forEach(function (cid) {
      $(cid).addEventListener('input', onFieldChange);
    });

    $('addУчасток').addEventListener('click', addУчасток);
    $('addПробито').addEventListener('click', function () { addПКСтрока('пробито'); });
    $('addЗаморозка').addEventListener('click', function () { addПКСтрока('заморозка'); });
    $('addСостав').addEventListener('click', addСостав);
    $('sendBtn').addEventListener('click', send);

    addУчасток(); // стартовый участок

    initTelegram();
    if (!inTelegram) {
      var badge = $('modeBadge');
      if (badge) { badge.textContent = 'режим теста'; badge.classList.add('test'); }
    } else {
      // в Telegram используем родную MainButton, кастомную нижнюю скрываем
      var sb = $('sendBtn');
      if (sb) sb.style.display = 'none';
    }
    onFieldChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();