// СметаПро AI - интерфейс
(function () {
  "use strict";
  var SP = window.SP, cfg = SP.cfg;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n0(x) { return Math.round(x).toLocaleString("ru-RU"); }
  function sec(ms) { return (ms / 1000).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " с"; }
  function chip(mk) { var m = cfg.models[mk]; return m ? '<span class="mchip ' + m.provider + '">' + esc(m.label) + "</span>" : ""; }
  function toolChip() { return '<span class="mchip tool">Python-формулы</span>'; }
  function stepModel(s) { return s.kind === "llm" ? (s.id === "chat" ? cfg.chat.model : cfg.steps[s.id].model) : null; }
  function hlJSON(text) {
    return esc(text).replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g, function (m, str, colon, bool) {
      if (str) return colon ? '<span class="k">' + str + "</span>" + colon : '<span class="s">' + str + "</span>";
      if (bool) return '<span class="b">' + m + "</span>";
      return '<span class="n">' + m + "</span>";
    });
  }
  function hlTpl(text) { return esc(text).replace(/\{\{(\w+)\}\}/g, '<span class="v">{{$1}}</span>'); }
  function dt(t, withDate) {
    var d = new Date(t), hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return withDate ? String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + " " + hh : hh;
  }
  var STEP_NAMES = { parse: "Разбор заявки", review: "Проверка инженером", doc: "Заключение", qa: "Контроль качества", chat: "Чат-помощник", test: "Проверка ключа" };
  var LLM_STEPS = SP.STEPS.filter(function (s) { return s.kind === "llm"; });

  SP.seed();

  /* ---------- шапка и режим ---------- */
  function renderStatus() {
    var live = cfg.mode === "live";
    $("status").classList.toggle("live", live);
    $("statusText").innerHTML = live ? '<b>Боевой режим</b><span class="st-x"> · OpenAI + Gemini</span>' : '<b>Демо-режим</b><span class="st-x"> · ответы ИИ по правилам</span>';
    $("footMode").textContent = live ? "Боевой режим: запросы идут в API OpenAI и Google Gemini." : "Демо-режим: ответы моделей имитируются по тем же промтам, токены и цена считаются по тарифам.";
    $("chatModel").textContent = (cfg.models[cfg.chat.model] || {}).label + (live ? " · боевой режим" : " · демо-режим");
  }
  $("status").onclick = function () { go("admin"); setTimeout(function () { $("liveSw").scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); };

  function avgRunCost() {
    var rs = SP.runs.filter(function (r) { return r.cost; });
    return rs.length ? rs.reduce(function (a, r) { return a + r.cost; }, 0) / rs.length : 0.0046;
  }
  function renderHero() {
    var last = SP.lastRun;
    var h = '<div class="pipe-head"><b>AI-конвейер</b><span class="live"><i></i>' + (cfg.mode === "live" ? "боевой режим" : "демо-режим") + "</span></div>";
    SP.STEPS.forEach(function (s, i) {
      h += '<div class="prow"><span class="pnum">' + (i + 1) + '</span><span><div class="pn">' + esc(s.name) + '</div><div class="ps">' + esc(s.short) + "</div></span>" +
        (s.kind === "llm" ? chip(stepModel(s)) : toolChip()) + "</div>";
    });
    var c = last ? last.cost : avgRunCost();
    h += '<div class="pipe-foot"><span>' + (last ? "последний расчёт" : "в среднем за расчёт") + '</span><span><b>' + (last ? n0(last.tokens) + " ток" : "≈3 900 ток") + "</b> · <b>" + SP.usd(c) + "</b> ≈ " + SP.rub(c) + "</span></div>";
    $("heroPipe").innerHTML = h;
    $("heroCost").textContent = "5 шагов · себестоимость расчёта ≈ " + SP.rub(avgRunCost());
  }

  /* ---------- навигация ---------- */
  var views = ["service", "trace", "admin"];
  function go(v, keepHash) {
    views.forEach(function (x) { $("view-" + x).classList.toggle("hidden", x !== v); });
    Array.prototype.forEach.call(document.querySelectorAll("nav.tabs button"), function (b) { b.classList.toggle("on", b.getAttribute("data-view") === v); });
    if (v === "trace") renderTrace();
    if (v === "admin") renderAdmin();
    if (!keepHash) history.replaceState(null, "", v === "service" ? location.pathname + location.search : "#" + v);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  Array.prototype.forEach.call(document.querySelectorAll("nav.tabs button"), function (b) { b.onclick = function () { go(b.getAttribute("data-view")); }; });

  /* ---------- квиз ---------- */
  var ICONS = { screed: "▤", brick: "▦", roof: "⌂" };
  var state = { work: null, vals: {} };
  var stepsEl = [$("step1"), $("step2"), $("step3")];
  function show(n) {
    stepsEl.forEach(function (s, i) { s.classList.toggle("hidden", i !== n); });
    ["s1", "s2", "s3"].forEach(function (id, i) { $(id).classList.toggle("on", i <= n); });
  }
  var tiles = $("tiles");
  Object.keys(SP.WORKS).forEach(function (key) {
    var w = SP.WORKS[key], b = document.createElement("button");
    b.className = "tile"; b.type = "button";
    b.innerHTML = '<span class="ic">' + ICONS[key] + "</span><b>" + w.name + "</b><small>" + w.desc + "</small>";
    b.onclick = function () {
      state.work = key;
      Array.prototype.forEach.call(tiles.children, function (t) { t.classList.remove("on"); });
      b.classList.add("on"); $("to2").disabled = false;
    };
    tiles.appendChild(b);
  });
  $("to2").onclick = function () {
    var w = SP.WORKS[state.work], html = "";
    $("sub2").textContent = w.name + ": укажите размеры";
    w.fields.forEach(function (f) {
      var cur = state.vals[f.id] != null ? state.vals[f.id] : f.def;
      if (f.type === "select") html += "<label>" + f.label + '<select id="f_' + f.id + '">' + f.opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>";
      else html += "<label>" + f.label + '<input id="f_' + f.id + '" type="number" inputmode="decimal" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + cur + '"></label>';
    });
    $("fields").innerHTML = html; $("err").textContent = ""; show(1);
  };
  $("back1").onclick = function () { show(0); };
  $("to3").onclick = function () {
    var w = SP.WORKS[state.work], vals = {}, bad = "";
    w.fields.forEach(function (f) {
      var el = $("f_" + f.id);
      if (f.type === "select") { vals[f.id] = el.value; return; }
      var n = parseFloat(String(el.value).replace(",", "."));
      if (isNaN(n) || n < f.min || n > f.max) { bad = f.label + ": от " + f.min + " до " + f.max; return; }
      vals[f.id] = n;
    });
    if (bad) { $("err").textContent = "Проверьте поле: " + bad; return; }
    state.vals = vals; show(2);
  };
  $("back2").onclick = function () { show(1); };
  SP.EXAMPLES.forEach(function (t) {
    var b = document.createElement("button"); b.type = "button"; b.textContent = t;
    b.onclick = function () { $("comment").value = t; };
    $("examples").appendChild(b);
  });

  function collectInput() {
    var cityK = parseFloat($("city").value), gradeK = parseFloat($("grade").value);
    return {
      work: state.work, vals: state.vals, cityK: cityK, k: cityK * gradeK, labor: $("labor").value === "1",
      city: $("city").selectedOptions[0].text, grade: $("grade").selectedOptions[0].text, comment: $("comment").value.trim().slice(0, 600)
    };
  }

  /* ---------- запуск конвейера ---------- */
  var typing = null;
  function typeText(el, text, instant) {
    if (typing) clearInterval(typing);
    if (instant) { el.textContent = text; el.classList.remove("caret"); return; }
    el.textContent = ""; el.classList.add("caret");
    var i = 0;
    typing = setInterval(function () {
      i += 3; el.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typing); typing = null; el.classList.remove("caret"); }
    }, 16);
  }
  function stepMetaHTML(rec) {
    if (!rec) return "";
    if (rec.kind === "tool") return "<b>" + (rec.output ? rec.output.rows.length : 0) + " позиций</b><br>" + rec.ms + " мс";
    return "<b>" + n0(rec.tin) + " → " + n0(rec.tout + (rec.treason || 0)) + " ток</b><br>" + SP.usd(rec.cost) + " · " + sec(rec.ms);
  }
  function renderRunList() {
    $("runList").innerHTML = SP.STEPS.map(function (s, i) {
      return '<div class="rstep" id="rs_' + s.id + '"><span class="st">' + (i + 1) + '</span><span><div class="rn">' + esc(s.name) + '</div><div class="rs">' +
        (s.kind === "llm" ? chip(stepModel(s)) : toolChip()) + " &nbsp;" + esc(s.short) + '</div></span><span class="rm"></span></div>';
    }).join("");
  }
  var busy = false;
  $("calc").onclick = async function () {
    if (busy) return; busy = true; $("calc").disabled = true;
    var input = collectInput();
    $("resEmpty").classList.add("hidden"); $("resBody").classList.add("hidden"); $("resRun").classList.remove("hidden");
    $("runSub").textContent = cfg.mode === "live" ? "Боевой режим: запросы уходят в OpenAI и Gemini" : "Демо-режим: ответы моделей по правилам, токены и цена - по тарифам";
    renderRunList();
    if (window.innerWidth < 1020) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      var run = await SP.runPipeline(input, {
        start: function (id) { var el = $("rs_" + id); if (el) el.classList.add("run"); },
        done: function (id, rec) {
          var el = $("rs_" + id); if (!el) return;
          el.classList.remove("run"); el.classList.add(rec.status === "fallback" ? "fb" : "done");
          el.querySelector(".st").textContent = rec.status === "fallback" ? "!" : "✓";
          el.querySelector(".rm").innerHTML = stepMetaHTML(rec);
        }
      });
      await new Promise(function (r) { setTimeout(r, 350); });
      renderResult(run, false);
      renderHero();
    } catch (e) {
      $("runSub").textContent = "Ошибка: " + (e && e.message || e);
    }
    busy = false; $("calc").disabled = false;
  };

  function renderResult(run, instant) {
    var w = SP.WORKS[run.work], c = run.calc, inp = run.input;
    $("resRun").classList.add("hidden"); $("resEmpty").classList.add("hidden"); $("resBody").classList.remove("hidden");
    $("resTitle").textContent = w.name;
    $("resSub").textContent = inp.city + ", " + inp.grade.toLowerCase() + " · запас материалов " + c.reserve + "%";
    var fb = run.steps.some(function (s) { return s.status === "fallback"; });
    var tag = $("resTag"); tag.className = "tag " + (fb ? "warn" : "ok"); tag.textContent = fb ? "Часть шагов по правилам" : "✓ Проверено ИИ";
    var conds = (run.parsed.conditions || []).map(function (x) { return '<span class="cond">ИИ нашёл: ' + esc(x.type) + " - " + esc(x.value) + "</span>"; });
    (run.parsed.missing || []).forEach(function (m) { conds.push('<span class="cond" style="background:#fdf1d9;color:#8a5a00">Уточнить: ' + esc(m) + "</span>"); });
    $("conds").innerHTML = conds.join("");
    var h = "<tr><th>Позиция</th><th>Кол-во</th><th class='pc'>Цена</th><th>Сумма</th></tr>";
    c.rows.forEach(function (r) { h += "<tr><td>" + esc(r.name) + "</td><td>" + r.qty.toLocaleString("ru-RU") + " " + r.unit + "</td><td class='pc'>" + SP.money(r.price) + "</td><td>" + SP.money(r.sum) + "</td></tr>"; });
    h += '<tr class="tot"><td colspan="2">Материалы</td><td class="pc"></td><td>' + SP.money(c.mat) + "</td></tr>";
    if (c.work) h += '<tr class="tot"><td colspan="2">Работы</td><td class="pc"></td><td>' + SP.money(c.work) + "</td></tr>";
    h += '<tr class="tot big"><td colspan="2">Итого ориентировочно</td><td class="pc"></td><td>' + SP.money(c.total) + "</td></tr>";
    $("tbl").innerHTML = h;
    var LV = { high: "высокий", mid: "средний", low: "норма" };
    $("risks").innerHTML = (run.review.risks || []).map(function (r) { var lv = LV[r.level] ? r.level : "mid"; return '<div class="risk ' + lv + '"><span class="lv">' + LV[lv] + "</span><span>" + esc(r.text) + "</span></div>"; }).join("");
    var adj = run.review.adjustments || [];
    $("adj").innerHTML = adj.length ? '<div class="adj"><b>Инженер-ИИ предлагает поправку:</b> ' + adj.map(function (a) { return esc(a.item) + " " + esc(a.delta) + " <span class='muted'>(" + esc(a.formula) + ")</span>"; }).join("; ") + "</div>" : "";
    $("docModel").outerHTML = '<span id="docModel">' + chip(cfg.steps.doc.model) + "</span>";
    typeText($("aiText"), run.doc, instant);
    var qa = run.qa || {};
    $("qa").className = "qa" + (qa.ok === false ? " bad" : "");
    $("qa").textContent = qa.ok === false ? "⚠ Контроль качества: " + (qa.issues || []).join("; ") : "✓ Контроль качества: " + (qa.checked_numbers || 0) + " чисел сверено с таблицей, расхождений нет";
    $("meta").innerHTML = "<span><b>" + run.calls + "</b> вызова ИИ</span><span><b>" + n0(run.tokens) + "</b> токенов</span><span><b>" + SP.usd(run.cost) + "</b> ≈ " + SP.rub(run.cost) + "</span><span><b>" + sec(run.ms) + "</b></span>" +
      '<a id="toTrace">Как ИИ это посчитал →</a>';
    $("toTrace").onclick = function () { go("trace"); };
    $("getPdf").textContent = "Получить смету в PDF - " + cfg.pdfPrice + " ₽";
  }
  $("again").onclick = function () {
    $("resBody").classList.add("hidden"); $("resEmpty").classList.remove("hidden");
    state.work = null; state.vals = {}; $("comment").value = "";
    Array.prototype.forEach.call(tiles.children, function (t) { t.classList.remove("on"); });
    $("to2").disabled = true; show(0); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ---------- оплата (демо) ---------- */
  var method = "sbp";
  $("getPdf").onclick = function () {
    var m = $("modal"), b = $("payBox"), price = cfg.pdfPrice;
    b.innerHTML = "<h3>Оплата сметы</h3><p class=\"sub\">PDF-документ с расчётом и заключением ИИ, " + price + " ₽. Демо: деньги не списываются.</p>" +
      '<button class="method on" data-m="sbp" type="button"><span style="font-size:22px">⚡</span><span><b>СБП</b><br><small class="muted">QR-код в приложении банка</small></span></button>' +
      '<button class="method" data-m="card" type="button"><span style="font-size:22px">💳</span><span><b>Банковская карта</b><br><small class="muted">Мир, Visa, Mastercard</small></span></button>' +
      '<div class="actions" style="margin-top:14px"><button class="btn" id="doPay" style="flex:1">Оплатить ' + price + ' ₽</button><button class="btn ghost" id="cancelPay">Отмена</button></div>' +
      '<p class="hint" style="margin-top:10px">В рабочей версии - ЮKassa или Т-Касса, чек по 54-ФЗ придёт на e-mail.</p>';
    m.classList.add("open");
    Array.prototype.forEach.call(b.querySelectorAll(".method"), function (x) {
      x.onclick = function () { method = x.getAttribute("data-m"); Array.prototype.forEach.call(b.querySelectorAll(".method"), function (y) { y.classList.toggle("on", y === x); }); };
    });
    $("cancelPay").onclick = function () { m.classList.remove("open"); };
    $("doPay").onclick = function () {
      $("doPay").disabled = true; $("doPay").textContent = "Обработка...";
      setTimeout(function () {
        if (SP.lastRun) SP.markPaid(SP.lastRun.id);
        b.innerHTML = '<h3 class="ok">Оплачено</h3><p class="sub">Демо-платёж прошёл. Сейчас откроется документ, сохраните его как PDF.</p><div class="actions"><button class="btn" id="printNow" style="flex:1">Открыть PDF</button><button class="btn ghost" id="closePay">Закрыть</button></div>';
        $("printNow").onclick = function () { m.classList.remove("open"); setTimeout(function () { window.print(); }, 120); };
        $("closePay").onclick = function () { m.classList.remove("open"); };
      }, 900);
    };
  };
  $("modal").onclick = function (e) { if (e.target === $("modal")) $("modal").classList.remove("open"); };

  /* ---------- как работает ИИ ---------- */
  var traceSel = "parse", traceTab = "prompt";
  function renderTrace() {
    var run = SP.lastRun;
    if (!run) return;
    $("traceSub").textContent = (run.example ? "Пример расчёта" : "Последний расчёт") + ": " + SP.WORKS[run.work].name.toLowerCase() + ", " + run.input.city +
      (run.input.comment ? ", комментарий «" + run.input.comment + "»" : "") + ". Каждая заявка проходит 5 шагов - ниже промты, что ушло в модель, ответ и стоимость.";
    $("sumrow").innerHTML =
      '<div class="sum"><b>5</b><small>шагов</small></div>' +
      '<div class="sum"><b>' + run.calls + '</b><small>вызова ИИ</small></div>' +
      '<div class="sum"><b>' + n0(run.tokens) + '</b><small>токенов</small></div>' +
      '<div class="sum"><b>' + sec(run.ms) + '</b><small>время</small></div>' +
      '<div class="sum acc"><b>' + SP.usd(run.cost) + '</b><small>≈ ' + SP.rub(run.cost) + " за расчёт</small></div>";
    $("tsteps").innerHTML = SP.STEPS.map(function (s, i) {
      var rec = run.steps.filter(function (x) { return x.id === s.id; })[0] || {};
      var meta = s.kind === "llm"
        ? chip(rec.model) + "<span><b>" + n0(rec.tin || 0) + "</b> → <b>" + n0((rec.tout || 0) + (rec.treason || 0)) + "</b> ток</span><span><b>" + SP.usd(rec.cost || 0) + "</b></span><span>" + sec(rec.ms || 0) + "</span>"
        : toolChip() + "<span><b>0</b> токенов</span><span><b>$0</b></span><span>" + (rec.ms || 1) + " мс</span>";
      var st = rec.status === "fallback" ? ' <span class="tag warn">по правилам</span>' : rec.status === "retry" ? ' <span class="tag warn">повтор</span>' : "";
      return '<li class="ts' + (s.id === traceSel ? " on" : "") + '" data-id="' + s.id + '"><div class="tt"><span class="tn">' + (i + 1) + '</span><span class="tl"><b>' + esc(s.name) + st + "</b><small>" + esc(s.short) + '</small></span></div><div class="tm">' + meta + "</div></li>";
    }).join("");
    Array.prototype.forEach.call($("tsteps").children, function (li) { li.onclick = function () { traceSel = li.getAttribute("data-id"); renderTrace(); }; });
    renderTraceDetail(run);
  }
  function renderTraceDetail(run) {
    var s = SP.stepById(traceSel), rec = run.steps.filter(function (x) { return x.id === traceSel; })[0] || {};
    var tabs = s.kind === "llm" ? [["prompt", "Промт"], ["answer", "Ответ модели"], ["info", "Детали и стоимость"]] : [["code", "Вход и выход"], ["info", "Детали"]];
    if (!tabs.some(function (t) { return t[0] === traceTab; })) traceTab = tabs[0][0];
    var h = '<div class="tdh"><div class="res-head"><h2>' + (SP.STEPS.indexOf(s) + 1) + ". " + esc(s.name) + "</h2>" + (s.kind === "llm" ? chip(rec.model) : toolChip()) + '</div><p class="why">' + esc(s.why) + "</p></div>";
    h += '<div class="ttabs">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === traceTab ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="tbody">';
    if (rec.error) h += '<div class="errbox">API ответил ошибкой: ' + esc(rec.error) + ". Шаг выполнен по правилам, расчёт не сломался.</div>";
    if (traceTab === "prompt") {
      h += '<pre class="code"><span class="lab">system - инструкция модели (редактируется в админке)</span>' + esc(rec.system) + "</pre>";
      h += '<pre class="code"><span class="lab">user - шаблон, переменные подставляются из заявки</span>' + hlTpl(cfg.steps[s.id].user) + "</pre>";
      h += '<pre class="code"><span class="lab">user - что ушло в модель</span>' + esc(rec.user) + "</pre>";
    } else if (traceTab === "answer") {
      h += '<pre class="code"><span class="lab">' + (s.json ? "ответ модели, JSON" : "ответ модели, текст") + "</span>" + (s.json ? hlJSON(rec.text) : esc(rec.text)) + "</pre>";
    } else if (traceTab === "code") {
      h += '<pre class="code"><span class="lab">функция</span>' + esc(s.fn) + "</pre>";
      h += '<pre class="code"><span class="lab">вход</span>' + hlJSON(JSON.stringify(rec.input, null, 2)) + "</pre>";
      h += '<pre class="code"><span class="lab">выход</span>' + hlJSON(JSON.stringify(rec.output, null, 2)) + "</pre>";
    } else {
      var m = cfg.models[rec.model] || {}, rows;
      if (s.kind === "llm") {
        var billed = (rec.tout || 0) + (rec.treason || 0);
        rows = [
          ["Модель", (m.label || "") + " <span class='muted mono'>" + esc(m.id || "") + "</span>"],
          ["Провайдер", m.provider ? SP.PROVIDERS[m.provider].name : ""],
          ["Температура", cfg.steps[s.id].temp == null ? "по умолчанию (модель с рассуждением)" : String(cfg.steps[s.id].temp)],
          ["Формат ответа", s.json ? "строгий JSON" : "текст"],
          ["Токены на входе", n0(rec.tin || 0) + " × $" + m.in + " / 1M = " + SP.usd((rec.tin || 0) * m.in / 1e6)],
          ["Токены на выходе", n0(rec.tout || 0) + (rec.treason ? " + " + n0(rec.treason) + " рассуждения" : "") + " × $" + m.out + " / 1M = " + SP.usd(billed * m.out / 1e6)],
          ["Стоимость шага", "<b>" + SP.usd(rec.cost || 0) + "</b> ≈ " + SP.rub(rec.cost || 0)],
          ["Время ответа", sec(rec.ms || 0)],
          ["Статус", rec.status === "fallback" ? "ошибка API, ответ по правилам" : rec.status === "retry" ? "ок после повтора" : "ок"],
          ["Режим", rec.status === "fallback" ? "боевой: API вернул ошибку, шаг выполнен по правилам и не оплачивался" : rec.mode === "live" ? "боевой: реальный запрос в API, токены из ответа API" : "демо: ответ по правилам, токены оценены по длине текста"]
        ];
      } else rows = [["Что делает", "Считает количество материалов и сумму по формулам и ценам из админки"], ["Почему не ИИ", "Языковые модели ошибаются в арифметике, а смете нужны точные цифры"], ["Время", (rec.ms || 1) + " мс"], ["Стоимость", "$0 - выполняется на сервере"]];
      h += '<div class="kv">' + rows.map(function (r) { return "<div>" + r[0] + "</div><div>" + r[1] + "</div>"; }).join("") + "</div>";
    }
    h += "</div>";
    $("tdetail").innerHTML = h;
    Array.prototype.forEach.call($("tdetail").querySelectorAll(".ttabs button"), function (b) { b.onclick = function () { traceTab = b.getAttribute("data-t"); renderTraceDetail(run); }; });
  }

  /* ---------- админка ---------- */
  function monthLog() { var d = new Date(), s = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return SP.log.filter(function (x) { return x.t >= s; }); }
  function renderAdmin() {
    var live = cfg.mode === "live", ml = monthLog(), now = new Date();
    var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var spend = ml.reduce(function (a, x) { return a + x.cost; }, 0);
    var today = ml.filter(function (x) { return x.t >= dayStart; });
    var tSpend = today.reduce(function (a, x) { return a + x.cost; }, 0);
    var mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var runsM = SP.runs.filter(function (r) { return r.t >= mStart; });
    var paid = runsM.filter(function (r) { return r.paid; });
    var revenue = paid.length * cfg.pdfPrice, avg = avgRunCost(), used = spend / cfg.budget * 100;
    var hasSample = SP.log.some(function (x) { return x.mode === "sample"; });
    $("banner").className = "banner" + (live ? " live" : "");
    $("banner").innerHTML = live
      ? "<b>●</b><span>Боевой режим: новые запросы уходят в API OpenAI и Google Gemini, токены и стоимость берутся из ответа API.</span>"
      : "<b>✦</b><span>Демо-режим: ответы моделей имитируются по тем же промтам, токены оценены по длине текста." + (hasSample ? " История за прошлые дни - пример, как выглядит работающий сервис." : "") + " Включите боевой режим и вставьте свой ключ, чтобы запросы шли в настоящие нейросети.</span>";
    $("kpis").innerHTML =
      '<div class="kpi acc"><small>Расход на API в этом месяце</small><b>' + SP.usd(spend) + "</b><span>≈ " + SP.rub(spend) + " · " + used.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "% лимита $" + cfg.budget + '</span><div class="meter"><i style="width:' + Math.min(100, Math.max(1.5, used)) + '%"></i></div></div>' +
      '<div class="kpi"><small>Сегодня</small><b>' + SP.usd(tSpend) + "</b><span>" + today.length + " вызовов ИИ</span></div>" +
      '<div class="kpi"><small>Вызовов ИИ за месяц</small><b>' + n0(ml.length) + "</b><span>" + runsM.length + " расчётов смет</span></div>" +
      '<div class="kpi"><small>Себестоимость расчёта</small><b>' + SP.usd(avg) + "</b><span>≈ " + SP.rub(avg) + " за 4 вызова</span></div>" +
      '<div class="kpi"><small>Оплачено PDF</small><b>' + paid.length + "</b><span>" + SP.money(revenue) + (spend ? " · API окупился ×" + n0(revenue / (spend * cfg.rate)) : "") + "</span></div>";
    renderChart();
    // по моделям
    var by = {};
    ml.forEach(function (x) { var b = by[x.model] || (by[x.model] = { cost: 0, calls: 0, tok: 0 }); b.cost += x.cost; b.calls++; b.tok += x.tin + x.tout + (x.tr || 0); });
    var keys = Object.keys(by).sort(function (a, b) { return by[b].cost - by[a].cost; });
    $("bymodel").innerHTML = keys.map(function (k) {
      var m = cfg.models[k] || { provider: "", label: k }, sh = spend ? by[k].cost / spend * 100 : 0;
      return '<div class="mrow"><span>' + chip(k) + '</span><b class="mono">' + SP.usd(by[k].cost) + '</b><div class="bar2"><i style="width:' + sh + "%;background:var(--" + m.provider + ')"></i></div><small>' + by[k].calls + " вызовов · " + n0(by[k].tok) + " ток · " + Math.round(sh) + "% расхода</small></div>";
    }).join("") || '<p class="muted">Пока нет вызовов</p>';
    // журнал
    var MODE = { live: '<span class="tag ok">боевой</span>', demo: '<span class="tag demo">демо</span>', sample: '<span class="tag">пример</span>' };
    var STAT = { ok: '<span class="tag ok">ок</span>', retry: '<span class="tag warn">повтор</span>', fallback: '<span class="tag bad">ошибка → правила</span>' };
    var last = SP.log.slice(-14).reverse();
    $("logCount").textContent = n0(SP.log.length) + " записей";
    $("logt").innerHTML = "<tr><th>Время</th><th>Шаг</th><th>Модель</th><th>Токены вх → вых</th><th>Рассужд.</th><th>Стоимость</th><th>Ответ</th><th>Статус</th><th>Режим</th></tr>" +
      last.map(function (x) {
        return "<tr><td class='mono'>" + dt(x.t, x.t < dayStart) + "</td><td style='text-align:left'>" + esc(STEP_NAMES[x.step] || x.step) + (x.note ? "<br><small class='muted'>" + esc(x.note) + "</small>" : "") + "</td><td style='text-align:left'>" + chip(x.model) +
          "</td><td class='mono'>" + n0(x.tin) + " → " + n0(x.tout) + "</td><td class='mono'>" + (x.tr ? n0(x.tr) : "-") + "</td><td class='mono'><b>" + SP.usd(x.cost) + "</b></td><td class='mono'>" + sec(x.ms) + "</td><td>" + (STAT[x.status] || x.status) + "</td><td>" + (MODE[x.mode] || "") + "</td></tr>";
      }).join("");
    renderPrompts(); renderKeys(); renderTariffs(); renderPrices(); renderPays();
  }
  function renderChart() {
    var now = new Date(), days = [];
    for (var i = 13; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), s = d.getTime(), e = s + 86400000;
      var o = { d: d, openai: 0, gemini: 0 };
      SP.log.forEach(function (x) { if (x.t >= s && x.t < e) { var p = (cfg.models[x.model] || {}).provider; if (p) o[p] += x.cost; } });
      days.push(o);
    }
    var max = Math.max.apply(null, days.map(function (x) { return x.openai + x.gemini; })) || 0.01;
    var nice = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10, 20, 50].filter(function (v) { return v >= max; })[0] || max;
    var W = 720, H = 230, L = 52, B = 26, T = 10, cw = (W - L - 8) / days.length, bw = Math.min(30, cw * 0.62);
    var y = function (v) { return T + (H - T - B) * (1 - v / nice); };
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Расход на API по дням">';
    [0, 0.5, 1].forEach(function (f) {
      var v = nice * f, yy = y(v);
      svg += '<line x1="' + L + '" x2="' + (W - 4) + '" y1="' + yy + '" y2="' + yy + '" stroke="#ece7dd" stroke-dasharray="' + (f ? "3 4" : "0") + '"/>';
      svg += '<text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="#8a8f98" font-family="JetBrains Mono,monospace">$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2)) + "</text>";
    });
    days.forEach(function (o, i) {
      var x = L + i * cw + (cw - bw) / 2, yo = y(o.openai), yg = y(o.openai + o.gemini), base = y(0);
      var isToday = i === days.length - 1;
      if (o.openai > 0) svg += '<rect x="' + x + '" y="' + yo + '" width="' + bw + '" height="' + (base - yo) + '" rx="3" fill="#10a37f"' + (isToday ? "" : ' opacity=".92"') + "><title>OpenAI " + SP.usd(o.openai) + "</title></rect>";
      if (o.gemini > 0) svg += '<rect x="' + x + '" y="' + yg + '" width="' + bw + '" height="' + (yo - yg) + '" rx="3" fill="#3b7bf6"><title>Gemini ' + SP.usd(o.gemini) + "</title></rect>";
      if (!o.openai && !o.gemini) svg += '<rect x="' + x + '" y="' + (base - 2) + '" width="' + bw + '" height="2" rx="1" fill="#e4dfd4"/>';
      if (i % 2 === 1 || isToday) svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="' + (isToday ? "#15171a" : "#8a8f98") + '" font-weight="' + (isToday ? 700 : 400) + '" font-family="Manrope,sans-serif">' + (isToday ? "сегодня" : String(o.d.getDate()).padStart(2, "0") + "." + String(o.d.getMonth() + 1).padStart(2, "0")) + "</text>";
    });
    svg += "</svg>";
    $("chart").innerHTML = svg;
    var sum = days.reduce(function (a, o) { return a + o.openai + o.gemini; }, 0);
    $("chartTotal").textContent = "14 дней: " + SP.usd(sum);
  }
  var promptSel = "parse";
  function renderPrompts() {
    var list = LLM_STEPS.concat([SP.CHAT]);
    $("ptabs").innerHTML = list.map(function (s) { return '<button data-id="' + s.id + '" class="' + (s.id === promptSel ? "on" : "") + '">' + (s.id === "chat" ? "Чат" : (SP.STEPS.indexOf(s) + 1) + ". " + s.name) + "</button>"; }).join("");
    Array.prototype.forEach.call($("ptabs").children, function (b) { b.onclick = function () { promptSel = b.getAttribute("data-id"); renderPrompts(); }; });
    var isChat = promptSel === "chat", sc = isChat ? cfg.chat : cfg.steps[promptSel], s = SP.stepById(promptSel);
    var opts = Object.keys(cfg.models).map(function (k) { return '<option value="' + k + '"' + (k === sc.model ? " selected" : "") + ">" + esc(cfg.models[k].label) + "</option>"; }).join("");
    var isOpenai = (cfg.models[sc.model] || {}).provider === "openai";
    var h = '<div class="row3 f"><label>Модель<select id="pModel">' + opts + "</select></label>" +
      "<label>Температура<input id=\"pTemp\" type=\"number\" min=\"0\" max=\"1.5\" step=\"0.1\" value=\"" + (sc.temp == null ? "" : sc.temp) + "\"" + (isOpenai || isChat ? " disabled placeholder=\"" + (isOpenai ? "у GPT-5 не настраивается" : String(SP.CHAT.temp)) + "\"" : "") + "></label>" +
      "<label>Формат ответа<input value=\"" + (s.json ? "строгий JSON" : "текст") + "\" disabled></label></div>";
    h += '<label class="hint" style="display:block;margin-bottom:6px;font-weight:700">System - инструкция модели</label><textarea id="pSys">' + esc(sc.system) + "</textarea>";
    if (!isChat) h += '<label class="hint" style="display:block;margin:12px 0 6px;font-weight:700">User - шаблон запроса</label><textarea id="pUser" class="user">' + esc(sc.user) + "</textarea>";
    h += '<div class="actions"><button class="btn dark sm" id="pSave">Сохранить промт</button><button class="btn ghost sm" id="pReset">Вернуть по умолчанию</button></div><div class="saved" id="pMsg"></div>';
    $("pedit").innerHTML = h;
    $("pModel").onchange = function () { sc.model = $("pModel").value; renderPrompts(); };
    $("pSave").onclick = function () {
      sc.model = $("pModel").value; sc.system = $("pSys").value;
      if (!isChat) { sc.user = $("pUser").value; var tv = $("pTemp").value; sc.temp = tv === "" ? null : parseFloat(tv); }
      SP.saveCfg(); renderHero(); $("pMsg").textContent = "Сохранено. Новый промт работает со следующего расчёта.";
    };
    $("pReset").onclick = function () { SP.resetStep(promptSel); renderPrompts(); renderHero(); $("pMsg").textContent = "Промт возвращён по умолчанию."; };
  }
  function renderKeys() {
    $("liveSw").checked = cfg.mode === "live";
    $("kOpenai").value = cfg.keys.openai; $("kGemini").value = cfg.keys.gemini;
  }
  $("liveSw").onchange = function () {
    cfg.mode = $("liveSw").checked ? "live" : "demo";
    if (cfg.mode === "live" && !cfg.keys.openai && !cfg.keys.gemini) $("keysMsg").textContent = "Вставьте хотя бы один ключ. Шаги без ключа выполнятся по правилам.";
    else $("keysMsg").textContent = cfg.mode === "live" ? "Боевой режим включён." : "Демо-режим включён.";
    SP.saveCfg(); renderStatus(); renderHero(); renderAdmin();
  };
  $("saveKeys").onclick = function () {
    cfg.keys.openai = $("kOpenai").value.trim(); cfg.keys.gemini = $("kGemini").value.trim(); SP.saveCfg();
    $("keysMsg").textContent = "Ключи сохранены в этом браузере.";
  };
  function testBtn(id, provider) {
    $(id).onclick = async function () {
      cfg.keys.openai = $("kOpenai").value.trim(); cfg.keys.gemini = $("kGemini").value.trim(); SP.saveCfg();
      $("keysMsg").style.color = ""; $("keysMsg").textContent = "Проверяю " + SP.PROVIDERS[provider].short + "...";
      try {
        var r = await SP.testConnection(provider);
        $("keysMsg").textContent = SP.PROVIDERS[provider].short + " работает: " + cfg.models[r.model].label + " ответил «" + r.text.trim().slice(0, 40) + "» за " + sec(r.ms) + ", " + SP.usd(r.cost);
        renderAdmin();
      } catch (e) { $("keysMsg").style.color = "var(--bad)"; $("keysMsg").textContent = "Ошибка: " + (e && e.message || e); }
    };
  }
  testBtn("testOpenai", "openai"); testBtn("testGemini", "gemini");
  function renderTariffs() {
    $("budget").value = cfg.budget; $("rate").value = cfg.rate;
    $("tariffs").innerHTML = "<tr><th>Модель</th><th style='text-align:left'>ID в API</th><th>Вход</th><th>Выход</th></tr>" + Object.keys(cfg.models).map(function (k) {
      var m = cfg.models[k];
      return "<tr><td>" + chip(k) + '</td><td style="text-align:left"><input class="id" data-k="' + k + '" data-f="id" value="' + esc(m.id) + '"></td><td><input data-k="' + k + '" data-f="in" type="number" step="0.01" min="0" value="' + m.in + '"></td><td><input data-k="' + k + '" data-f="out" type="number" step="0.01" min="0" value="' + m.out + '"></td></tr>';
    }).join("");
  }
  $("saveTariffs").onclick = function () {
    var b = parseFloat($("budget").value), r = parseFloat($("rate").value);
    if (b > 0) cfg.budget = b; if (r > 0) cfg.rate = r;
    Array.prototype.forEach.call($("tariffs").querySelectorAll("input"), function (i) {
      var m = cfg.models[i.getAttribute("data-k")], f = i.getAttribute("data-f");
      if (f === "id") { if (i.value.trim()) m.id = i.value.trim(); } else { var v = parseFloat(i.value); if (!isNaN(v) && v >= 0) m[f] = v; }
    });
    SP.saveCfg(); $("tarMsg").textContent = "Сохранено. Новые цены применяются к следующим вызовам."; renderHero(); renderAdmin();
  };
  function renderPrices() {
    $("ptable").innerHTML = Object.keys(SP.PRICE_NAMES).map(function (k) { return "<tr><td>" + SP.PRICE_NAMES[k] + '</td><td><input data-k="' + k + '" type="number" min="0" value="' + SP.prices[k] + '"></td></tr>'; }).join("");
  }
  $("savePrices").onclick = function () {
    Array.prototype.forEach.call($("ptable").querySelectorAll("input"), function (i) { var v = parseFloat(i.value); if (!isNaN(v) && v >= 0) SP.prices[i.getAttribute("data-k")] = v; });
    SP.savePrices(); $("priceMsg").textContent = "Цены сохранены.";
  };
  $("resetPrices").onclick = function () { SP.prices = Object.assign({}, SP.DEFAULT_PRICES); SP.savePrices(); renderPrices(); $("priceMsg").textContent = "Цены сброшены."; };
  function renderPays() {
    var paid = SP.runs.filter(function (r) { return r.paid; }).slice(-8).reverse();
    var all = SP.runs.filter(function (r) { return r.paid; }).length;
    $("paySub").textContent = all + " оплат по " + cfg.pdfPrice + " ₽ · конверсия из расчёта в оплату " + (SP.runs.length ? Math.round(all / SP.runs.length * 100) : 0) + "%";
    $("payt").innerHTML = "<tr><th>Дата</th><th style='text-align:left'>Вид работ</th><th>Смета</th><th>Оплата</th><th>ИИ</th></tr>" + paid.map(function (r) {
      return "<tr><td class='mono'>" + dt(r.t, true) + "</td><td style='text-align:left'>" + SP.WORKS[r.work].name + "</td><td>" + SP.money(r.total) + "</td><td><b>" + cfg.pdfPrice + " ₽</b></td><td class='mono'>" + SP.usd(r.cost) + "</td></tr>";
    }).join("") || "<tr><td colspan='5' class='muted' style='text-align:left'>Пока нет оплат</td></tr>";
  }
  $("resetDemo").onclick = function () {
    if (!confirm("Сбросить журнал, оплаты и пример расчёта к исходным демо-данным? Промты, ключи и цены останутся.")) return;
    SP.seed(true); SP.lastRun = null; SP.store.set("sp2_last", null); ensureExample().then(function () { renderHero(); renderAdmin(); });
  };

  /* ---------- чат ---------- */
  var chat = $("chat"), msgs = $("msgs"), chHist = [];
  function addMsg(t, who, rec) {
    var d = document.createElement("div"); d.className = "m " + who; d.textContent = t;
    if (rec) { var mm = document.createElement("span"); mm.className = "mm"; mm.textContent = (cfg.models[rec.model] || {}).label + " · " + n0(rec.tin + rec.tout) + " ток · " + SP.usd(rec.cost); d.appendChild(mm); }
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }
  function openChat() {
    chat.classList.add("open");
    if (!msgs.children.length) {
      addMsg("Здравствуйте! Я помощник СметаПро. Помогу с расчётом и отвечу на вопросы.", "bot");
      ["Как считает ИИ?", "Сколько стоит PDF?", "Позвать менеджера"].forEach(function (t) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = t; b.onclick = function () { send(t); }; $("chips").appendChild(b);
      });
    }
    setTimeout(function () { $("chatIn").focus(); }, 50);
  }
  async function send(t) {
    t = String(t || "").trim(); if (!t) return;
    addMsg(t, "me");
    var tp = document.createElement("div"); tp.className = "m bot"; tp.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; msgs.appendChild(tp); msgs.scrollTop = msgs.scrollHeight;
    var r = await SP.chatAsk(t, chHist);
    tp.remove(); addMsg(r.text, "bot", r.rec);
    chHist.push({ role: "user", content: t }, { role: "assistant", content: r.text });
  }
  $("fab").onclick = function () { chat.classList.contains("open") ? chat.classList.remove("open") : openChat(); };
  $("chatClose").onclick = function () { chat.classList.remove("open"); };
  $("chatForm").onsubmit = function (e) { e.preventDefault(); send($("chatIn").value); $("chatIn").value = ""; };

  /* ---------- старт ---------- */
  var EXAMPLE = { work: "screed", vals: { area: 42, h: 40 }, cityK: 1, k: 1, labor: true, city: "Казань", grade: "Стандарт", comment: "Старый дом, пол неровный, перепад около 3 см" };
  async function ensureExample() {
    if (SP.lastRun) return SP.lastRun;
    var saved = SP.store.get("sp2_last", null);
    if (saved && saved.steps) { SP.lastRun = saved; return saved; }
    var keepMode = cfg.mode; cfg.mode = "demo";
    var run = await SP.runPipeline(Object.assign({ silent: true }, EXAMPLE), {});
    cfg.mode = keepMode;
    run.example = true; SP.lastRun = run; SP.store.set("sp2_last", run);
    return run;
  }
  renderStatus();
  ensureExample().then(function () {
    renderHero();
    var hsh = location.hash.replace("#", "");
    if (hsh === "trace" || hsh === "admin") go(hsh, true);
    if (hsh === "result") {
      var lr = SP.lastRun; state.work = lr.work; state.vals = lr.input.vals;
      Array.prototype.forEach.call(tiles.children, function (t, i) { t.classList.toggle("on", Object.keys(SP.WORKS)[i] === lr.work); });
      $("to2").disabled = false; $("comment").value = lr.input.comment || ""; show(2);
      renderResult(lr, true);
    }
    var q = new URLSearchParams(location.search);
    if (q.get("shot") === "1") { $("fab").style.display = q.get("fab") === "1" ? "" : "none"; document.documentElement.style.scrollBehavior = "auto"; }
    if (q.get("step")) { traceSel = q.get("step"); traceTab = q.get("tab") || traceTab; if (hsh === "trace") renderTrace(); }
    if (q.get("chat") === "1") { openChat(); send("Как считает ИИ?"); }
    if (q.get("to")) { var el = $(q.get("to")); if (el) { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -(parseInt(q.get("off") || "84", 10))); } }
  });
})();
