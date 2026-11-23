// Token Radar v2 dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the fitted model's own inputs, the token odds, the 80% interval and the costed farm
// plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMoney(n) {
    if (!isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    return sign + '$' + (a >= 100 ? Math.round(a) : a.toFixed(2));
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar · radar-2' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }
  function lede() {
    var m = DATA.model;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by expected implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor that pass the watchlist exclusion rules in full. Expected value is launch value times token odds. It is a model, not a promise.' })
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Value model, LOO RMSE (log)' }), el('b', { text: m.loo_rmse.toFixed(3) }), el('small', { text: 'walk-forward ' + m.walkforward_rmse.toFixed(3) + ' vs mean ' + m.walkforward_baseline.toFixed(3) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Token odds, AUC / LOO log-loss' }), el('b', { text: m.odds_auc.toFixed(3) + ' / ' + m.odds_loo_logloss.toFixed(3) }), el('small', { text: 'base-rate log-loss ' + m.odds_baseline_logloss.toFixed(3) })),
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: DATA.board_size + ' rows: ' + DATA.early_size + ' early' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Audit of the snapshot' }), el('b', { text: DATA.audit.total + ' / ' + DATA.audit.total }), el('small', { text: DATA.audit.traded + ' traded · ' + DATA.audit.pre_token + ' pre-token' }))
      )
    );
  }
  function auditStrip() {
    var a = DATA.audit;
    return el('div', { class: 'audit' },
      el('span', null, 'Audit: ', el('b', { text: String(a.total) }), ' protocols accounted for'),
      el('span', null, el('b', { text: String(a.traded) }), ' already trade (symbol on record)'),
      el('span', null, el('b', { text: String(a.pre_token) }), ' record no token'),
      el('span', null, el('b', { text: String(a.rankable) }), ' rankable · ', el('b', { text: String(a.excluded) }), ' excluded as wrapped, staked, bridged, versioned or CEX'),
      el('span', null, el('b', { text: String(a.comps_mcap) }), ' traded comps fit the value model')
    );
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictClass(v) { return v === 'FARM' ? 'farm' : v === 'THIN' ? 'thin' : 'skip'; }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: (r.token_odds * 100).toFixed(0) + '%' }),
        el('td', null, el('span', { class: 'verdict ' + verdictClass(r.farm.verdict), text: r.farm.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest expected implied value first. Select a row for its model, odds and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Expected value'),
            sortHeader('odds', 'Token odds'),
            el('th', { scope: 'col', text: 'Farm' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the value is computed — and where it is weak' }),
      el('div', { class: 'formula' },
        'launch value = exp(' + m.log_intercept + ' + ' + m.log_slope + ' x ln(tvl_usd))' +
        '\ntoken odds = p(traded | TVL, age, growth) x (1 - F(age)), the survivor discount' +
        '\nexpected value = launch value x token odds' +
        '\n80% interval = expected value x 0.06 to 8.63 (leave-one-out residuals, 10th to 90th pct)'
      ),
      el('p', { class: 'note', text: 'Fitted on the 128 traded comps with a market cap: log(mcap) on log(TVL), R2 ' + m.r2.toFixed(3) + ', residual SD ' + m.resid_sd.toFixed(2) + ' in log space. TVL alone is a weak predictor — a one-standard-deviation miss moves the value about 8x — so every row shows its interval, not just a point. Growth, age, chain count, a squared TVL term and shrunk category means were each tested and dropped: none improved leave-one-out or walk-forward error. Growth and age still enter the token-odds fit, and age sets the farm hold.' }),
      el('p', { class: 'note', text: 'Token odds: logistic fit on all 758 protocols, traded = symbol on record (416 traded, 342 pre-token). AUC ' + m.odds_auc.toFixed(3) + ', LOO log-loss ' + m.odds_loo_logloss.toFixed(3) + ' vs base rate ' + m.odds_baseline_logloss.toFixed(3) + '. Cross-sectionally, older protocols trade more often (26% at 0-180 days, 79% past 1095 days) because they had more time to launch. A protocol still pre-token at that age is a survivor, so its odds are discounted by the share still untraded at its age; net odds fall gently for the oldest survivors.' }),
      el('p', { class: 'note', text: 'Farm economics are an assumption, stated, not a measurement: the airdrop pool is 5% of a row\u2019s expected value, split across 5,000 eligible wallets. Gas per transaction is assumed $5 on Ethereum, $0.50 on listed L2s and cheap chains, $0.05 on Solana, $2 elsewhere. Capital is deployed and comes back on exit, so only gas counts against the airdrop. Verdict: FARM at $5 or more an active hour, THIN when the airdrop covers gas but pays less, SKIP when it does not cover gas.' }),
      el('p', { class: 'note', text: 'Coverage: the board holds all 40 watchlist protocols plus 138 early protocols below the $50M floor that pass the exclusion rules in full. 200 rows are not reachable under those rules — 138 is every eligible protocol below the floor — so the board does not pad itself with wrapped, staked, bridged, versioned or CEX protocols to reach 200.' })
    );
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var f = row.farm;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth (tested, not a multiplier)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Launch value (median, from TVL)' }), el('b', { class: 'num', text: fmtUsd(row.launch_value_usd) })),
        el('div', null, el('span', { text: 'Token odds (survivor-discounted)' }), el('b', { class: 'num', text: (row.token_odds * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Expected implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: '80% interval' }), el('b', { class: 'num', text: fmtUsd(row.implied_lo_usd) + ' – ' + fmtUsd(row.implied_hi_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': log(mcap) = 6.9646 + 0.5223 x ln(TVL), fitted on 128 comps. The interval is wide because TVL alone is weak (LOO RMSE 2.107 in log space). This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Capital deployed' }), el('b', { class: 'num', text: fmtMoney(f.capital_usd) })),
        el('div', null, el('span', { text: 'Gas (' + f.tx_count + ' tx at ' + fmtMoney(f.gas_per_tx_usd) + ' on ' + (row.chains[0] || 'main chain') + ')' }), el('b', { class: 'num', text: fmtMoney(f.gas_usd) })),
        el('div', null, el('span', { text: 'Active time' }), el('b', { class: 'num', text: f.total_hours.toFixed(2) + ' h over ' + f.hold_days + ' days' })),
        el('div', null, el('span', { text: 'Expected airdrop per wallet (assumed)' }), el('b', { class: 'num', text: fmtMoney(f.expected_airdrop_usd) })),
        el('div', null, el('span', { text: 'Break-even airdrop' }), el('b', { class: 'num', text: fmtMoney(f.break_even_airdrop_usd) })),
        el('div', null, el('span', { text: 'Expected pay per active hour' }), el('b', { class: 'num', text: fmtMoney(f.usd_per_hour) + ' / h' })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: f.verdict }))
      ),
      el('p', { class: 'sub', text: 'Assumption: airdrop pool 5% of expected value across 5,000 wallets; gas as stated in the model panel. FARM at $5/h or more, THIN when it covers gas, SKIP when it does not.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(auditStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
