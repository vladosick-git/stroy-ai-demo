// СметаПро AI - движок: настройки, AI-конвейер, вызовы моделей, журнал расходов.
(function () {
  "use strict";
  var SP = window.SP;

  /* ---------- хранилище ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  SP.store = store;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- настройки ---------- */
  function loadCfg() {
    var saved = store.get("sp2_cfg", {});
    var cfg = {
      mode: saved.mode === "live" ? "live" : "demo",
      keys: Object.assign({ openai: "", gemini: "" }, saved.keys || {}),
      rate: saved.rate || 80,
      budget: saved.budget || 20,
      pdfPrice: saved.pdfPrice || 199,
      models: clone(SP.DEFAULT_MODELS),
      steps: {},
      chat: { model: SP.CHAT.model, system: SP.CHAT.system }
    };
    Object.keys(saved.models || {}).forEach(function (k) { if (cfg.models[k]) Object.assign(cfg.models[k], saved.models[k]); });
    SP.STEPS.forEach(function (s) {
      if (s.kind !== "llm") return;
      cfg.steps[s.id] = Object.assign({ model: s.model, temp: s.temp, system: s.system, user: s.user }, (saved.steps || {})[s.id] || {});
    });
    if (saved.chat) Object.assign(cfg.chat, saved.chat);
    return cfg;
  }
  SP.cfg = loadCfg();
  SP.saveCfg = function () { store.set("sp2_cfg", SP.cfg); };
  SP.resetStep = function (id) {
    var s = SP.STEPS.filter(function (x) { return x.id === id; })[0];
    if (id === "chat") { SP.cfg.chat = { model: SP.CHAT.model, system: SP.CHAT.system }; }
    else if (s) SP.cfg.steps[id] = { model: s.model, temp: s.temp, system: s.system, user: s.user };
    SP.saveCfg();
  };
  SP.prices = Object.assign({}, SP.DEFAULT_PRICES, store.get("sp2_prices", {}));
  SP.savePrices = function () { store.set("sp2_prices", SP.prices); };

  /* ---------- утилиты ---------- */
  SP.rng = function (seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };
  var rand = Math.random;
  function between(r, a, b) { return Math.round(a + r() * (b - a)); }
  SP.tok = function (s) { return Math.max(1, Math.round(String(s || "").length / 3.3)); };
  SP.cost = function (modelKey, tin, toutBilled) {
    var m = SP.cfg.models[modelKey] || { in: 0, out: 0 };
    return (tin * m.in + toutBilled * m.out) / 1e6;
  };
  SP.fill = function (tpl, v) { return String(tpl).replace(/\{\{(\w+)\}\}/g, function (a, k) { return v[k] != null ? String(v[k]) : a; }); };
  SP.parseJSON = function (text) {
    var t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    var a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("Модель вернула не JSON");
    return JSON.parse(t.slice(a, b + 1));
  };
  SP.money = function (n) { return Math.round(n).toLocaleString("ru-RU") + " ₽"; };
  SP.usd = function (x) {
    if (!x) return "$0";
    if (x < 0.001) return "$" + x.toFixed(5);
    if (x < 0.01) return "$" + x.toFixed(4);
    if (x < 1) return "$" + x.toFixed(3);
    return "$" + x.toFixed(2);
  };
  SP.rub = function (x) { return (x * SP.cfg.rate).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽"; };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  SP.stepById = function (id) { return SP.STEPS.filter(function (s) { return s.id === id; })[0] || (id === "chat" ? SP.CHAT : null); };
  SP.hasKey = function (modelKey) { var m = SP.cfg.models[modelKey]; return !!(m && SP.cfg.keys[m.provider]); };

  /* ---------- журнал ---------- */
  SP.log = store.get("sp2_log", []);
  SP.runs = store.get("sp2_runs", []);
  function saveLog() {
    if (SP.log.length > 900) SP.log = SP.log.slice(-900);
    if (SP.runs.length > 300) SP.runs = SP.runs.slice(-300);
    store.set("sp2_log", SP.log); store.set("sp2_runs", SP.runs);
  }
  SP.saveLog = saveLog;
  function logCall(rec, runId) {
    SP.log.push({ t: Date.now(), run: runId, step: rec.id, model: rec.model, tin: rec.tin, tout: rec.tout, tr: rec.treason || 0,
      cost: rec.cost, ms: rec.ms, status: rec.status, mode: rec.mode, note: rec.note || "" });
  }

  /* ---------- вызов моделей (боевой режим) ---------- */
  async function fetchRetry(url, opts, rec) {
    var delays = [1500, 3500];
    for (var i = 0; ; i++) {
      var r = await fetch(url, opts);
      if ((r.status === 429 || r.status >= 500) && i < delays.length) {
        if (rec) { rec.retries = (rec.retries || 0) + 1; rec.note = "HTTP " + r.status + ", повтор"; }
        await wait(delays[i]); continue;
      }
      return r;
    }
  }
  SP.callModel = async function (modelKey, temp, system, user, json, history, rec) {
    var m = SP.cfg.models[modelKey];
    if (!m) throw new Error("Неизвестная модель " + modelKey);
    var key = SP.cfg.keys[m.provider];
    if (!key) throw new Error("Не указан ключ " + SP.PROVIDERS[m.provider].short);
    history = history || [];
    var r, j;
    if (m.provider === "openai") {
      var body = { model: m.id, messages: [{ role: "system", content: system }].concat(history, [{ role: "user", content: user }]) };
      if (json) body.response_format = { type: "json_object" };
      r = await fetchRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(body)
      }, rec);
      j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
      var u = j.usage || {}, reason = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
      return { text: (j.choices && j.choices[0] && j.choices[0].message.content) || "", tin: u.prompt_tokens || 0, tout: Math.max(0, (u.completion_tokens || 0) - reason), treason: reason };
    }
    var contents = history.map(function (h) { return { role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] }; });
    contents.push({ role: "user", parts: [{ text: user }] });
    var gb = { systemInstruction: { parts: [{ text: system }] }, contents: contents, generationConfig: {} };
    if (temp != null) gb.generationConfig.temperature = temp;
    if (json) gb.generationConfig.responseMimeType = "application/json";
    r = await fetchRetry("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(m.id) + ":generateContent?key=" + encodeURIComponent(key), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gb)
    }, rec);
    j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
    var c = j.candidates && j.candidates[0];
    var text = ((c && c.content && c.content.parts) || []).map(function (p) { return p.text || ""; }).join("");
    var um = j.usageMetadata || {};
    return { text: text, tin: um.promptTokenCount || 0, tout: um.candidatesTokenCount || 0, treason: um.thoughtsTokenCount || 0 };
  };

  /* ---------- демо-режим: ответы моделей по правилам ---------- */
  function num(s) { return parseFloat(String(s).replace(",", ".")); }
  SP.readComment = function (c) {
    c = String(c || "");
    var cond = [], flags = [], unevenMm = null;
    var m = c.match(/перепад\D{0,20}(\d+(?:[.,]\d+)?)\s*(см|мм)/i) || c.match(/(\d+(?:[.,]\d+)?)\s*(см|мм)\D{0,15}перепад/i);
    if (m) unevenMm = num(m[1]) * (/см/i.test(m[2]) ? 10 : 1);
    if (/неровн|перепад|горб|завал/i.test(c)) { cond.push({ type: "основание", value: "неровное" + (unevenMm ? ", перепад " + unevenMm + " мм" : ", перепад не указан"), source: "comment" }); flags.push("uneven_base"); }
    if (/стар|ветх|хрущ|сталин|деревянн\S* перекр/i.test(c)) { cond.push({ type: "здание", value: "старый фонд", source: "comment" }); flags.push("old_building"); }
    if (/зим|мороз|ноябр|декабр|январ|феврал/i.test(c) || (/холод/i.test(c) && !/до холод/i.test(c))) { cond.push({ type: "сезон", value: "работы в холодное время", source: "comment" }); flags.push("cold_season"); }
    if (/т[её]пл\S* пол/i.test(c)) { cond.push({ type: "инженерия", value: "тёплый пол под стяжкой", source: "comment" }); flags.push("floor_heating"); }
    if (/срочн|быстр|до холод|к \d|до \d/i.test(c)) { cond.push({ type: "сроки", value: "сжатые сроки", source: "comment" }); flags.push("tight_deadline"); }
    if (/ендов|мансард|сложн|много скат|эркер/i.test(c)) { cond.push({ type: "кровля", value: "сложная форма", source: "comment" }); flags.push("complex_roof"); }
    return { cond: cond, flags: flags, unevenMm: unevenMm };
  };

  function demoParse(ctx) {
    var rc = SP.readComment(ctx.comment), missing = [];
    if (!ctx.comment) missing.push("состояние объекта (комментарий не заполнен)");
    if (ctx.work === "screed" && rc.flags.indexOf("uneven_base") >= 0 && !rc.unevenMm) missing.push("величина перепада основания, мм");
    return {
      work: ctx.work, params: ctx.vals, city: ctx.city, grade: ctx.grade, labor: ctx.labor,
      conditions: rc.cond, risk_flags: rc.flags, missing: missing
    };
  }

  function demoReview(ctx, parsed) {
    var f = parsed.risk_flags || [], v = ctx.vals, risks = [], tips = [], adj = [], u = SP.readComment(ctx.comment).unevenMm;
    var has = function (x) { return f.indexOf(x) >= 0; };
    if (ctx.work === "screed") {
      if (u) {
        var minH = v.h - u / 2;
        if (minH < 30) {
          risks.push({ level: "high", text: "При перепаде " + u + " мм в высокой точке слой будет около " + Math.round(minH) + " мм - тоньше 30 мм стяжка трескается." });
          var add = Math.ceil(v.area * (u / 2) / 1000 * 2000 / 50 * 1.05);
          adj.push({ item: "Сухая смесь М150", formula: "толщина = средняя + перепад / 2", delta: "+" + add + " мешков" });
        } else risks.push({ level: "low", text: "Перепад " + u + " мм съест часть толщины: в высокой точке останется около " + Math.round(minH) + " мм, это допустимо." });
      }
      if (v.h < 40) risks.push({ level: "mid", text: "Толщина " + v.h + " мм - на грани. Для стяжки по перекрытию лучше от 40 мм или с фиброй." });
      if (has("old_building")) risks.push({ level: "mid", text: "Старый фонд: стяжка " + v.h + " мм даёт около " + v.h * 2 + " кг/м² нагрузки, перекрытие стоит проверить или взять облегчённую смесь." });
      if (has("floor_heating")) tips.push("Над трубами тёплого пола нужно не меньше 30 мм раствора, лучше добавить фибру - меньше трещин от нагрева.");
      if (has("cold_season")) risks.push({ level: "mid", text: "Ниже +5 °C раствор не набирает прочность: нужен прогрев помещения или противоморозная добавка." });
      tips.push("Сетку класть в середину слоя на фиксаторы, а не на основание.");
      tips.push("Демпферную ленту ставить по всему периметру до заливки.");
    } else if (ctx.work === "brick") {
      var t = parseFloat(v.thick);
      if (t === 0.5 && v.hgt > 3) risks.push({ level: "high", text: "Стена в полкирпича высотой " + v.hgt + " м неустойчива: нужна толщина в кирпич или каркас." });
      if (has("old_building")) risks.push({ level: "mid", text: "Метр квадратный кладки в кирпич весит около 450 кг - основание под новую стену стоит проверить." });
      if (has("cold_season")) risks.push({ level: "mid", text: "Кладка в мороз - только с противоморозной добавкой и укрытием свежей кладки." });
      tips.push("Армировать кладочной сеткой каждые 4-5 рядов.");
      tips.push("Над каждым проёмом обязательна перемычка с опорой не меньше 250 мм.");
    } else {
      if (has("complex_roof")) {
        risks.push({ level: "mid", text: "Для сложной кровли с ендовами запаса 10% мало, обычно закладывают 15%." });
        adj.push({ item: "Гибкая черепица", formula: "запас 15% вместо 10%", delta: "+" + Math.ceil(v.area * 0.05 / 3) + " уп" });
      }
      if (has("cold_season")) risks.push({ level: "high", text: "Ниже +5 °C клеевой слой черепицы не схватывается - нужен строительный фен или перенос работ." });
      tips.push("Под мягкую черепицу нужно сплошное основание из влагостойкой OSB-3.");
      tips.push("Предусмотреть вентиляцию подкровельного пространства в коньке.");
    }
    if (!risks.length) risks.push({ level: "low", text: "Расчёт в норме, запас " + ctx.reserve + "% соответствует нормативу." });
    return { risks: risks, tips: tips.slice(0, 3), adjustments: adj, confidence: Math.round((0.86 + rand() * 0.07) * 100) / 100 };
  }

  function pl(n, a, b, c) { var m10 = n % 10, m100 = n % 100; return n + " " + (m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c); }
  function demoDoc(ctx, parsed, review) {
    var v = {}, F = {}, s = [];
    Object.keys(ctx.vals).forEach(function (k) { v[k] = typeof ctx.vals[k] === "number" ? String(ctx.vals[k]).replace(".", ",") : ctx.vals[k]; });
    Object.keys(ctx.facts).forEach(function (k) { F[k] = typeof ctx.facts[k] === "number" && k !== "мешков" && k !== "кирпичей" && k !== "упаковок черепицы" ? String(ctx.facts[k]).replace(".", ",") : ctx.facts[k]; });
    if (ctx.work === "screed") s.push("На " + v.area + " м² при средней толщине " + v.h + " мм нужно около " + pl(F["мешков"], "мешка", "мешков", "мешков") + " смеси - это " + F["объём, м³"] + " м³ раствора с запасом 5%.");
    if (ctx.work === "brick") s.push("Площадь кладки без проёмов " + F["площадь кладки, м²"] + " м², на неё уйдёт около " + pl(F["кирпичей"], "кирпича", "кирпичей", "кирпичей") + " и " + F["раствор, м³"] + " м³ раствора, запас 5% на бой уже учтён.");
    if (ctx.work === "roof") s.push("На кровлю " + v.area + " м² нужно " + pl(F["упаковок черепицы"], "упаковка", "упаковки", "упаковок") + " гибкой черепицы, запас 10% на подрезку заложен.");
    var serious = (review.risks || []).filter(function (r) { return r.level !== "low"; });
    if (serious.length) s.push("Главное, на что стоит обратить внимание: " + serious[0].text.charAt(0).toLowerCase() + serious[0].text.slice(1));
    if (serious.length > 1) s.push("И ещё: " + serious[1].text.charAt(0).toLowerCase() + serious[1].text.slice(1));
    if (review.adjustments && review.adjustments.length) s.push("Инженер советует добавить: " + review.adjustments.map(function (a) { return a.item.charAt(0).toLowerCase() + a.item.slice(1) + " " + a.delta; }).join(", ") + ".");
    if (review.tips && review.tips[0]) s.push(review.tips[0]);
    s.push("Сумма " + SP.money(ctx.total) + " ориентировочная, точную смету даст замер - его можно заказать в один клик.");
    return s.join(" ");
  }

  function demoQA(ctx, docText) {
    var nums = (docText.match(/\d+(?:[.,]\d+)?/g) || []);
    var hay = JSON.stringify(ctx.facts) + " " + JSON.stringify(ctx.vals) + " " + ctx.tableText + " " + JSON.stringify(ctx.review || {}) + " 5 10 15 30 40 250 450 " + SP.money(ctx.total);
    var checked = 0, bad = [];
    nums.forEach(function (n) { var x = n.replace(",", "."); if (hay.indexOf(n) >= 0 || hay.indexOf(x) >= 0) checked++; else bad.push(n); });
    return { ok: bad.length === 0, checked_numbers: checked, issues: bad.map(function (b) { return "число " + b + " не найдено в расчёте"; }), fixed_text: null };
  }

  function simLatency(modelKey, tout, tr) {
    var m = SP.cfg.models[modelKey], speed = m && m.provider === "openai" ? 95 : 160;
    return Math.round(320 + (tout + tr) / speed * 1000 + rand() * 350);
  }

  /* ---------- конвейер ---------- */
  function tableText(rows) {
    return rows.map(function (r) { return "- " + r.name + ": " + r.qty + " " + r.unit + " × " + SP.money(r.price) + " = " + SP.money(r.sum); }).join("\n");
  }

  SP.buildCalc = function (input) {
    var w = SP.WORKS[input.work];
    var res = w.calc(input.vals, SP.prices, input.k, input.labor, input.cityK);
    var rows = res.rows.map(function (x) { return { name: x[0], qty: x[1], unit: x[2], price: x[3], sum: x[1] * x[3], work: !!x[4] }; });
    var mat = 0, wk = 0;
    rows.forEach(function (r) { if (r.work) wk += r.sum; else mat += r.sum; });
    return { rows: rows, mat: mat, work: wk, total: mat + wk, reserve: res.reserve, facts: res.facts };
  };

  SP.runPipeline = async function (input, hooks) {
    hooks = hooks || {};
    var cfg = SP.cfg, w = SP.WORKS[input.work], runId = Date.now();
    var run = { id: runId, t: runId, work: input.work, mode: cfg.mode, input: input, steps: [], calc: null };
    var params = w.fields.map(function (f) {
      var val = input.vals[f.id];
      if (f.type === "select") val = f.opts.filter(function (o) { return o[0] === String(val); })[0][1];
      return f.label + " = " + val;
    }).join("; ");
    var ctx = { work: input.work, vals: input.vals, city: input.city, grade: input.grade, labor: input.labor, comment: input.comment };
    var vars = { work: input.work, work_name: w.name, params: params, city: input.city, grade: input.grade, labor: input.labor ? "нужны, считать с работой" : "не нужны, только материалы", comment: input.comment || "нет" };

    async function llm(step, demoFn) {
      var sc = cfg.steps[step.id];
      var rec = { id: step.id, kind: "llm", model: sc.model, system: sc.system, user: SP.fill(sc.user, vars), mode: cfg.mode, status: "ok", json: step.json };
      if (hooks.start) hooks.start(step.id, rec);
      var t0 = performance.now(), live = cfg.mode === "live";
      if (live) {
        try {
          var r = await SP.callModel(sc.model, sc.temp, rec.system, rec.user, step.json, null, rec);
          rec.text = r.text; rec.tin = r.tin; rec.tout = r.tout; rec.treason = r.treason;
          rec.ms = Math.round(performance.now() - t0);
          rec.obj = step.json ? SP.parseJSON(r.text) : null;
          if (rec.retries) rec.status = "retry";
        } catch (e) {
          rec.status = "fallback"; rec.error = String(e && e.message || e); rec.note = "ошибка API, ответ по правилам";
          live = false;
        }
      }
      if (!live) {
        var d = demoFn();
        rec.obj = step.json ? d : null;
        rec.text = step.json ? JSON.stringify(d, null, 2) : d;
        rec.tin = SP.tok(rec.system) + SP.tok(rec.user);
        rec.tout = SP.tok(rec.text);
        var m = cfg.models[sc.model];
        rec.treason = step.id === "review" && m.provider === "openai" ? between(rand, 380, 720) : (step.id === "doc" && /2\.5-flash$/.test(m.id) ? between(rand, 180, 420) : 0);
        rec.ms = simLatency(sc.model, rec.tout, rec.treason);
        if (rec.status !== "fallback") rec.mode = "demo";
        if (!input.silent) await wait(Math.min(1500, Math.max(450, rec.ms * 0.33)));
      }
      if (rec.status === "fallback") { rec.tin = 0; rec.tout = 0; rec.treason = 0; }
      rec.cost = SP.cost(sc.model, rec.tin, rec.tout + (rec.treason || 0));
      run.steps.push(rec); if (!input.silent) logCall(rec, runId);
      if (hooks.done) hooks.done(step.id, rec);
      return rec;
    }

    // 1. разбор
    var sParse = await llm(SP.STEPS[0], function () { return demoParse(ctx); });
    var parsed = sParse.obj || demoParse(ctx);

    // 2. формулы
    if (hooks.start) hooks.start("calc", {});
    var t1 = performance.now();
    var calc = SP.buildCalc(input);
    run.calc = calc;
    ctx.facts = calc.facts; ctx.total = calc.total; ctx.reserve = calc.reserve; ctx.tableText = tableText(calc.rows);
    if (!input.silent) await wait(260);
    var recCalc = {
      id: "calc", kind: "tool", status: "ok", mode: cfg.mode, ms: Math.max(2, Math.round(performance.now() - t1 - (input.silent ? 0 : 260))),
      input: { work: input.work, params: input.vals, k_city: input.cityK, k_grade: r2(input.k / input.cityK), labor: input.labor },
      output: { rows: calc.rows.map(function (r) { return [r.name, r.qty, r.unit, Math.round(r.price)]; }), materials: Math.round(calc.mat), works: Math.round(calc.work), total: Math.round(calc.total), reserve_pct: calc.reserve },
      tin: 0, tout: 0, cost: 0
    };
    run.steps.push(recCalc);
    if (hooks.done) hooks.done("calc", recCalc);

    vars.parsed = JSON.stringify(parsed, null, 2); vars.table = ctx.tableText; vars.reserve = calc.reserve;
    vars.facts = Object.keys(calc.facts).map(function (k) { return k + ": " + calc.facts[k]; }).join("; ");
    vars.total = SP.money(calc.total);
    vars.conditions = (parsed.conditions || []).map(function (c) { return c.type + " - " + c.value; }).join("; ") || "не указаны";

    // 3. проверка
    var sRev = await llm(SP.STEPS[2], function () { return demoReview(ctx, parsed); });
    var review = sRev.obj || demoReview(ctx, parsed);
    ctx.review = review; vars.review = JSON.stringify(review, null, 2);

    // 4. заключение
    var sDoc = await llm(SP.STEPS[3], function () { return demoDoc(ctx, parsed, review); });
    var docText = String(sDoc.text || "").trim() || demoDoc(ctx, parsed, review);
    vars.doc = docText;

    // 5. контроль
    var sQa = await llm(SP.STEPS[4], function () { return demoQA(ctx, docText); });
    var qa = sQa.obj || demoQA(ctx, docText);
    if (qa && qa.ok === false && qa.fixed_text) docText = qa.fixed_text;

    run.parsed = parsed; run.review = review; run.doc = docText; run.qa = qa;
    run.cost = run.steps.reduce(function (a, s) { return a + (s.cost || 0); }, 0);
    run.tokens = run.steps.reduce(function (a, s) { return a + (s.tin || 0) + (s.tout || 0) + (s.treason || 0); }, 0);
    run.ms = run.steps.reduce(function (a, s) { return a + (s.ms || 0); }, 0);
    run.calls = run.steps.filter(function (s) { return s.kind === "llm"; }).length;
    run.total = calc.total; run.paid = false;
    if (!input.silent) { SP.runs.push({ id: runId, t: runId, work: input.work, total: Math.round(calc.total), cost: run.cost, paid: false, mode: run.mode }); saveLog(); }
    SP.lastRun = run; store.set("sp2_last", run);
    return run;
  };
  function r2(n) { return Math.round(n * 100) / 100; }

  SP.markPaid = function (runId) {
    SP.runs.forEach(function (r) { if (r.id === runId) r.paid = true; });
    saveLog();
  };

  /* ---------- чат ---------- */
  var QA = [
    [/цен|стоим|сколько/i, "Первый расчёт на экране бесплатный. Готовый PDF-документ со сметой стоит 199 ₽."],
    [/запас|бой|подрезк/i, "Запас обычно 5% на стяжку и кирпич и 10% на кровлю, он уже учтён в расчёте. Для сложной кровли ИИ предложит 15%."],
    [/стяжк|пол/i, "Для стяжки важны толщина и ровность основания. Напишите перепад в комментарии - ИИ пересчитает толщину в высокой точке."],
    [/кирпич|стен/i, "Укажите длину, высоту и площадь проёмов, остальное посчитают формулы. Перемычки над проёмами добавятся сами."],
    [/кровл|черепиц/i, "Для мягкой кровли нужна сплошная обрешётка из OSB. Если кровля сложная, напишите это в комментарии."],
    [/оплат|pdf|док/i, "Оплатить можно через СБП или картой. После оплаты откроется документ, его можно сохранить как PDF."],
    [/ии|нейро|gpt|gemini|модел/i, "Заявку разбирает Gemini, проверяет GPT-5 mini, а цифры считают формулы - поэтому нейросеть не ошибается в количестве."],
    [/привет|здравств/i, "Здравствуйте! Помогу с расчётом материалов. О чём хотите узнать?"],
    [/мастер|человек|менеджер|позвон/i, "Передал вопрос менеджеру, он свяжется с вами в рабочее время. Оставьте телефон в сообщении."]
  ];
  SP.chatAsk = async function (q, history) {
    var rec = { id: "chat", kind: "llm", model: SP.cfg.chat.model, mode: SP.cfg.mode, status: "ok", system: SP.cfg.chat.system, user: q };
    var t0 = performance.now(), text = null;
    if (SP.cfg.mode === "live") {
      try {
        var r = await SP.callModel(rec.model, SP.CHAT.temp, rec.system, q, false, history.slice(-6), rec);
        text = r.text.trim(); rec.tin = r.tin; rec.tout = r.tout; rec.treason = r.treason; rec.ms = Math.round(performance.now() - t0);
      } catch (e) { rec.status = "fallback"; rec.error = String(e && e.message || e); rec.note = "ошибка API, ответ по правилам"; }
    }
    if (text == null) {
      for (var i = 0; i < QA.length && text == null; i++) if (QA[i][0].test(q)) text = QA[i][1];
      if (text == null) text = "Этого я точно не знаю, лучше уточнить у менеджера. Напишите «менеджер», и я передам вопрос.";
      rec.tin = SP.tok(rec.system) + SP.tok(history.map(function (h) { return h.content; }).join(" ")) + SP.tok(q);
      rec.tout = SP.tok(text); rec.treason = 0; rec.ms = simLatency(rec.model, rec.tout, 0);
      if (rec.status !== "fallback") rec.mode = "demo";
      await wait(Math.min(900, rec.ms * 0.5));
    }
    if (rec.status === "fallback") { rec.tin = 0; rec.tout = 0; rec.treason = 0; }
    rec.cost = SP.cost(rec.model, rec.tin, rec.tout + rec.treason);
    logCall(rec, null); saveLog();
    return { text: text, rec: rec };
  };

  SP.testConnection = async function (provider) {
    var mk = Object.keys(SP.cfg.models).filter(function (k) { return SP.cfg.models[k].provider === provider; })
      .sort(function (a, b) { return SP.cfg.models[a].out - SP.cfg.models[b].out; })[0];
    var t0 = performance.now();
    var r = await SP.callModel(mk, 0, "Отвечай одним словом.", "Скажи: работает", false, null, {});
    var c = SP.cost(mk, r.tin, r.tout + r.treason);
    SP.log.push({ t: Date.now(), run: null, step: "test", model: mk, tin: r.tin, tout: r.tout, tr: r.treason, cost: c, ms: Math.round(performance.now() - t0), status: "ok", mode: "live", note: "проверка подключения" });
    saveLog();
    return { model: mk, text: r.text, ms: Math.round(performance.now() - t0), cost: c };
  };

  /* ---------- история для демо: сервис запущен 12 дней назад ---------- */
  SP.seed = function (force) {
    if (!force && store.get("sp2_seed_ver", 0) === 2) return;
    var R = SP.rng(20261016), now = new Date(), log = [], runs = [];
    var perDay = [2, 1, 3, 5, 4, 6, 3, 8, 7, 9, 6, 7, 4]; // последние 13 дней, последний - сегодня
    var works = ["screed", "screed", "screed", "brick", "roof", "roof"];
    var retryDone = false;
    perDay.forEach(function (cnt, di) {
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (perDay.length - 1 - di));
      var isToday = di === perDay.length - 1;
      var endMin = isToday ? Math.max(0, now.getHours() * 60 + now.getMinutes() - 20) : 22 * 60;
      var startMin = Math.min(8 * 60 + 30, endMin);
      if (isToday && endMin < 60) cnt = 0;
      for (var i = 0; i < cnt; i++) {
        var mins = startMin + Math.floor(R() * Math.max(1, endMin - startMin));
        var t = day.getTime() + mins * 60000, id = t;
        var calls = [
          ["parse", "gemini-2.5-flash-lite", between(R, 280, 360), between(R, 110, 170), 0],
          ["review", "gpt-5-mini", between(R, 440, 620), between(R, 140, 260), between(R, 380, 720)],
          ["doc", "gemini-2.5-flash", between(R, 390, 520), between(R, 140, 260), between(R, 180, 420)],
          ["qa", "gemini-2.5-flash-lite", between(R, 360, 470), between(R, 22, 45), 0]
        ];
        var runCost = 0, tt = t;
        calls.forEach(function (c) {
          var ms = Math.round(320 + (c[3] + c[4]) / (c[1] === "gpt-5-mini" ? 95 : 160) * 1000 + R() * 350);
          var status = "ok", note = "";
          if (!retryDone && di === 8 && c[0] === "review") { status = "retry"; note = "HTTP 429, повтор через 1,5 с"; ms += 1500; retryDone = true; }
          var cost = SP.cost(c[1], c[2], c[3] + c[4]); runCost += cost;
          log.push({ t: tt, run: id, step: c[0], model: c[1], tin: c[2], tout: c[3], tr: c[4], cost: cost, ms: ms, status: status, mode: "sample", note: note });
          tt += ms;
        });
        var total = between(R, 9000, 160000);
        runs.push({ id: id, t: t, work: works[Math.floor(R() * works.length)], total: total, cost: runCost, paid: R() < 0.18, mode: "sample" });
        var chats = R() < 0.55 ? (R() < 0.35 ? 2 : 1) : 0;
        for (var c2 = 0; c2 < chats; c2++) {
          var tin = between(R, 160, 260), tout = between(R, 30, 90);
          tt += between(R, 20000, 200000);
          log.push({ t: tt, run: null, step: "chat", model: "gemini-2.5-flash-lite", tin: tin, tout: tout, tr: 0, cost: SP.cost("gemini-2.5-flash-lite", tin, tout), ms: between(R, 450, 900), status: "ok", mode: "sample", note: "" });
        }
      }
    });
    log.sort(function (a, b) { return a.t - b.t; }); runs.sort(function (a, b) { return a.t - b.t; });
    SP.log = log.filter(function (x) { return x.t <= Date.now(); }); SP.runs = runs;
    store.set("sp2_seed_ver", 2); saveLog();
  };
})();
