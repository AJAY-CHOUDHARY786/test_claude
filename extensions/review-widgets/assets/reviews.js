/* Product reviews storefront widget. Content is built with textContent only (never innerHTML),
   so review text cannot inject markup or scripts. */
(function () {
  'use strict';
  if (window.__prwLoaded) return;
  window.__prwLoaded = true;

  var ACCENT = /^#[0-9a-fA-F]{6}$/;
  var uid = 0;

  function h(tag, props) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function readStrings(scope) {
    var el = (scope.parentNode && scope.parentNode.querySelector('[data-prw-strings]')) || document.querySelector('[data-prw-strings]');
    try { return JSON.parse(el.textContent); } catch (e) { return {}; }
  }
  function fmt(s, vars) {
    return String(s || '').replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] !== undefined ? vars[k] : ''; });
  }
  function stars(n, strings) {
    var full = Math.max(0, Math.min(5, Math.round(n)));
    return h('span', { class: 'prw-stars', role: 'img', 'aria-label': fmt(strings.stars, { n: full }) }, '\u2605'.repeat(full) + '\u2606'.repeat(5 - full));
  }

  function request(url, init) {
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, json: j }; });
    });
  }
  function query(params) {
    return Object.keys(params).filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  }
  function getJson(base, path, params) {
    return request(base + path + '?' + query(params), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  }
  function postJson(base, path, body) {
    return request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  }

  function safePhoto(url) { return typeof url === 'string' && /^https:\/\//i.test(url); }

  function addJsonLd(text) {
    if (!text || document.querySelector('script[data-prw-ld]')) return;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.setAttribute('data-prw-ld', '');
    s.textContent = text; // text node, not parsed as HTML
    document.head.appendChild(s);
  }

  /* ---------- Full widget ---------- */
  function initWidget(root) {
    var strings = readStrings(root);
    var base = root.getAttribute('data-endpoint');
    var pid = root.getAttribute('data-product-id');
    var showForm = root.getAttribute('data-show-form') !== 'false';
    var showQuestions = root.getAttribute('data-show-questions') !== 'false';
    var state = { page: 1, sort: 'newest', rating: '' };

    var heading = h('h2', { text: root.getAttribute('data-heading') || 'Reviews' });
    var summaryEl = h('div');
    var controlsEl = h('div', { class: 'prw-controls' });
    var formArea = h('div');
    var listEl = h('ul', { class: 'prw-list' });
    var moreBtn = h('button', { type: 'button', class: 'prw-btn ghost', hidden: true, text: strings.load_more });
    var questionsEl = h('div');
    var status = h('p', { role: 'status', text: strings.loading });
    root.textContent = '';
    root.appendChild(heading); root.appendChild(status);
    [summaryEl, controlsEl, formArea, listEl, moreBtn, questionsEl].forEach(function (n) { root.appendChild(n); });

    var settings = {};

    function renderSummary(data) {
      summaryEl.textContent = '';
      var s = data.summary;
      if (!s || !s.total) { summaryEl.appendChild(h('p', { text: strings.none })); return; }
      var left = h('div', null,
        h('div', { class: 'prw-score', text: String(s.average) }),
        stars(s.average, strings),
        h('div', { text: s.total === 1 ? strings.based_on_one : fmt(strings.based_on, { count: s.total }) }));
      var dist = h('div', { class: 'prw-dist' });
      s.distribution.forEach(function (d) {
        var label = h('span', { text: d.rating + ' \u2605' });
        var bar = h('span', { class: 'prw-bar' }, h('i', { style: 'width:' + Math.max(0, Math.min(100, d.percent)) + '%' }));
        var count = h('span', { text: String(d.count) });
        if (settings.advancedDisplay && d.count > 0) {
          var btn = h('button', { type: 'button', 'aria-pressed': String(state.rating === String(d.rating)), onclick: function () { state.rating = state.rating === String(d.rating) ? '' : String(d.rating); load(true); } }, label, bar, count);
          dist.appendChild(btn);
        } else { dist.appendChild(label); dist.appendChild(bar); dist.appendChild(count); }
      });
      summaryEl.className = 'prw-summary';
      summaryEl.appendChild(left); summaryEl.appendChild(dist);
    }

    function renderControls() {
      controlsEl.textContent = '';
      if (settings.advancedDisplay) {
        var id = 'prw-sort-' + (++uid);
        var sel = h('select', { id: id, onchange: function (e) { state.sort = e.target.value; load(true); } },
          h('option', { value: 'newest', text: strings.newest }), h('option', { value: 'highest', text: strings.highest }), h('option', { value: 'lowest', text: strings.lowest }));
        sel.value = state.sort;
        controlsEl.appendChild(h('label', { for: id, text: strings.sort + ' ' })); controlsEl.appendChild(sel);
        if (state.rating) controlsEl.appendChild(h('button', { type: 'button', class: 'prw-btn ghost', text: strings.all_ratings, onclick: function () { state.rating = ''; load(true); } }));
      }
      if (showForm && settings.canSubmit) {
        var toggle = h('button', { type: 'button', class: 'prw-btn', 'aria-expanded': 'false', text: strings.write });
        toggle.addEventListener('click', function () {
          if (formArea.firstChild) { formArea.textContent = ''; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = strings.write; return; }
          formArea.appendChild(buildReviewForm());
          toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = strings.cancel;
          var first = formArea.querySelector('input,textarea'); if (first) first.focus();
        });
        controlsEl.appendChild(toggle);
      }
    }

    function renderReview(r) {
      var meta = h('div', { class: 'prw-meta' }, document.createTextNode(r.name + ' \u00b7 ' + r.date));
      if (r.verified) meta.appendChild(h('span', { class: 'prw-badge', text: strings.verified }));
      var li = h('li', { class: 'prw-item' }, stars(r.rating, strings), r.title ? h('h3', { text: r.title }) : null, meta, h('p', { class: 'prw-body', text: r.body }));
      var photos = (r.photos || []).filter(safePhoto);
      if (photos.length) {
        var wrap = h('div', { class: 'prw-photos' });
        photos.forEach(function (u) { wrap.appendChild(h('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })); });
        li.appendChild(wrap);
      }
      if (r.reply && r.reply.body) li.appendChild(h('div', { class: 'prw-reply' }, h('strong', { text: strings.store_reply }), h('div', { text: r.reply.body })));
      return li;
    }

    function load(reset) {
      if (reset) { state.page = 1; listEl.textContent = ''; }
      moreBtn.disabled = true;
      return getJson(base, '/list', { product_id: pid, page: state.page, sort: state.sort, rating: state.rating }).then(function (res) {
        status.textContent = '';
        if (!res.ok || res.json.disabled) { if (res.json && res.json.disabled) root.textContent = ''; else status.textContent = strings.error_generic; return; }
        var data = res.json;
        settings = data.settings || {};
        var accent = settings.accent;
        if (typeof accent === 'string' && ACCENT.test(accent)) root.style.setProperty('--prw-accent', accent);
        root.setAttribute('data-layout', settings.layout === 'grid' ? 'grid' : 'list');
        if (reset) {
          renderSummary(data); renderControls();
          if (showQuestions && settings.canAsk) renderQuestions(data.questions || []);
          addJsonLd(data.jsonLd);
        }
        (data.reviews || []).forEach(function (r) { listEl.appendChild(renderReview(r)); });
        moreBtn.hidden = !data.hasMore; moreBtn.disabled = false;
      }).catch(function () { status.textContent = strings.error_generic; });
    }
    moreBtn.addEventListener('click', function () { state.page += 1; load(false); });

    /* ----- review form ----- */
    function buildReviewForm() {
      var n = ++uid;
      var form = h('form', { class: 'prw-form', novalidate: true });
      var errs = {};
      function errFor(name) { var p = h('p', { class: 'prw-err', role: 'alert', hidden: true }); errs[name] = p; return p; }
      var rate = h('div', { class: 'prw-rate' });
      for (var i = 5; i >= 1; i--) {
        rate.appendChild(h('input', { type: 'radio', name: 'rating', id: 'prw-r' + n + '-' + i, value: i }));
        rate.appendChild(h('label', { for: 'prw-r' + n + '-' + i, title: fmt(strings.stars, { n: i }) }, h('span', { 'aria-hidden': 'true', text: '\u2605' }), h('span', { class: 'prw-hp', text: fmt(strings.stars, { n: i }) })));
      }
      form.appendChild(h('fieldset', null, h('legend', { text: strings.your_rating }), rate, errFor('rating')));
      form.appendChild(h('label', { for: 'prw-t' + n, text: strings.headline })); form.appendChild(h('input', { type: 'text', id: 'prw-t' + n, name: 'title', maxlength: 120 }));
      form.appendChild(h('label', { for: 'prw-b' + n, text: strings.your_review })); form.appendChild(h('textarea', { id: 'prw-b' + n, name: 'body', maxlength: 5000, required: true })); form.appendChild(errFor('body'));
      form.appendChild(h('label', { for: 'prw-n' + n, text: strings.your_name })); form.appendChild(h('input', { type: 'text', id: 'prw-n' + n, name: 'name', maxlength: 60, required: true, autocomplete: 'given-name' })); form.appendChild(errFor('name'));
      var files = null;
      if (settings.allowPhotos) {
        form.appendChild(h('label', { for: 'prw-f' + n, text: strings.photos }));
        files = h('input', { type: 'file', id: 'prw-f' + n, accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true }); form.appendChild(files);
      }
      form.appendChild(h('div', { class: 'prw-hp', 'aria-hidden': 'true' }, h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' })));
      var general = errFor('form'); form.appendChild(general);
      var submit = h('button', { type: 'submit', class: 'prw-btn', text: strings.submit }); form.appendChild(h('div', { style: 'margin-top:1rem' }, submit));

      function showErrors(map) {
        Object.keys(errs).forEach(function (k) { errs[k].hidden = true; errs[k].textContent = ''; });
        Object.keys(map).forEach(function (k) { var t = errs[k] || general; t.textContent = map[k]; t.hidden = false; });
      }
      function done(statusName) {
        form.textContent = '';
        form.appendChild(h('p', { class: 'prw-ok', role: 'status', text: statusName === 'PUBLISHED' ? strings.thanks_published : strings.thanks_pending }));
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var checked = form.querySelector('input[name=rating]:checked');
        var body = {
          productId: pid, rating: checked ? checked.value : '', title: form.elements.title.value,
          body: form.elements.body.value, name: form.elements.name.value, website: form.elements.website.value
        };
        submit.disabled = true; submit.textContent = strings.sending; showErrors({});
        postJson(base, '/submit', body).then(function (res) {
          if (res.status === 422 && res.json.errors) { showErrors(res.json.errors); return; }
          if (res.status === 429) { showErrors({ form: strings.error_rate }); return; }
          if (!res.ok) { showErrors({ form: strings.error_generic }); return; }
          var chosen = files ? Array.prototype.slice.call(files.files, 0, 5) : [];
          if (!chosen.length || !res.json.uploadToken) { done(res.json.status); return; }
          var failed = false;
          chosen.reduce(function (chain, file) {
            return chain.then(function () {
              var fd = new FormData(); fd.append('token', res.json.uploadToken); fd.append('file', file);
              return request(base + '/upload', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (u) { if (!u.ok) failed = true; });
            });
          }, Promise.resolve()).then(function () {
            done(res.json.status);
            if (failed) form.appendChild(h('p', { class: 'prw-err', text: strings.photo_failed }));
          });
        }).catch(function () { showErrors({ form: strings.error_generic }); })
          .then(function () { if (form.isConnected && form.elements.body) { submit.disabled = false; submit.textContent = strings.submit; } });
      });
      return form;
    }

    /* ----- questions ----- */
    function renderQuestions(items) {
      questionsEl.textContent = '';
      var box = h('section', { 'aria-label': strings.questions }, h('h3', { text: strings.questions }));
      items.forEach(function (q) {
        box.appendChild(h('div', { class: 'prw-q' }, h('strong', { text: q.question }), h('div', { class: 'prw-meta', text: q.asker }), h('p', { class: 'prw-body', text: q.answer })));
      });
      var area = h('div');
      var ask = h('button', { type: 'button', class: 'prw-btn ghost', text: strings.ask });
      ask.addEventListener('click', function () {
        if (area.firstChild) { area.textContent = ''; return; }
        var n = ++uid;
        var f = h('form', { class: 'prw-form', novalidate: true },
          h('label', { for: 'prw-qn' + n, text: strings.your_name }), h('input', { type: 'text', id: 'prw-qn' + n, name: 'name', maxlength: 60 }),
          h('label', { for: 'prw-qb' + n, text: strings.your_question }), h('textarea', { id: 'prw-qb' + n, name: 'body', maxlength: 1000 }),
          h('div', { class: 'prw-hp', 'aria-hidden': 'true' }, h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' })));
        var err = h('p', { class: 'prw-err', role: 'alert', hidden: true }); f.appendChild(err);
        var btn = h('button', { type: 'submit', class: 'prw-btn', text: strings.submit }); f.appendChild(h('div', { style: 'margin-top:1rem' }, btn));
        f.addEventListener('submit', function (e) {
          e.preventDefault(); btn.disabled = true; err.hidden = true;
          postJson(base, '/question', { productId: pid, name: f.elements.name.value, body: f.elements.body.value, website: f.elements.website.value }).then(function (res) {
            if (res.ok) { f.textContent = ''; f.appendChild(h('p', { class: 'prw-ok', role: 'status', text: strings.thanks_question })); return; }
            err.textContent = (res.json && res.json.error && res.status === 422) ? res.json.error : (res.status === 429 ? strings.error_rate : strings.error_generic); err.hidden = false; btn.disabled = false;
          }).catch(function () { err.textContent = strings.error_generic; err.hidden = false; btn.disabled = false; });
        });
        area.appendChild(f);
      });
      box.appendChild(ask); box.appendChild(area);
      questionsEl.appendChild(box);
    }

    load(true);
  }

  /* ---------- Small star rating ---------- */
  function initMini(a) {
    var strings = readStrings(a);
    var base = a.getAttribute('data-endpoint');
    var pid = a.getAttribute('data-product-id');
    getJson(base, '/list', { product_id: pid, summary: 1 }).then(function (res) {
      var s = res.ok && res.json.summary;
      if (!s || !s.total) return;
      a.textContent = '';
      a.appendChild(stars(s.average, strings));
      a.appendChild(h('span', { text: s.total === 1 ? strings.based_on_one : fmt(strings.based_on, { count: s.total }) }));
      var widget = document.querySelector('[data-prw]');
      if (widget) a.setAttribute('href', '#' + widget.id); else a.removeAttribute('href');
      a.hidden = false;
    }).catch(function () { /* the mini rating is optional; stay hidden */ });
  }

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-prw]'), initWidget);
    Array.prototype.forEach.call(document.querySelectorAll('[data-prw-mini]'), initMini);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
