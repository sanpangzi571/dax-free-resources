/* 零撸空投雷达 · 独立静态版
   数据来自同目录 data.json（Muse artifact getboard 导出）。
   收藏与任务勾选只存浏览器 localStorage，不上传服务器。 */
(function () {
  'use strict';

  var DATA_URL = 'data.json';
  var LS_FAV = 'airdrop-radar:favs';
  var LS_TASKS = 'airdrop-radar:tasks';
  var NEWS_PAGE = 12;

  var board = null;
  var projectsBySlug = {};
  var newsShown = NEWS_PAGE;

  var state = {
    q: '',
    cat: 'all',
    status: 'all',
    cost: 'all',
    sort: 'deadline',
    favOnly: false,
    verifiedOnly: false
  };

  var CAT_LABEL = { points: '积分', testnet: '测试网', claim: '领取', quest: '任务' };
  var STATUS_LABEL = { active: '进行中', claimable: '可领取', tge_soon: '即将 TGE', ended: '已结束' };
  var COST_LABEL = { free: '免费', gas_only: '仅 gas', mixed: '混合成本' };
  var KIND_LABEL = { new: '新收录', update: '更新', deadline: '截止提醒', ended: '已结束' };

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 北京时间格式化：中国无夏令时，UTC+8 固定偏移，直接算，不依赖浏览者时区
  // （数据里的截止文案本身就是北京时间，统一用北京时间显示）
  function bjParts(ms) {
    var t = new Date(ms).getTime(); // ms 可能是 ISO 字符串（如 lastRefreshedAt）或 epoch 毫秒
    if (isNaN(t)) return null;
    var d = new Date(t + 8 * 3600000);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      y: d.getUTCFullYear(),
      m: p(d.getUTCMonth() + 1),
      day: p(d.getUTCDate()),
      h: p(d.getUTCHours()),
      min: p(d.getUTCMinutes())
    };
  }

  // 北京时间格式化：ms -> "11-21 09:28"
  function fmtMD(ms) {
    if (!ms) return '';
    var o = bjParts(ms);
    if (!o) return '';
    return (+o.m) + '-' + o.day + ' ' + o.h + ':' + o.min;
  }

  // 北京时间完整："2026-11-21 09:28"
  function fmtFull(ms) {
    if (!ms) return '';
    var o = bjParts(ms);
    if (!o) return '';
    return o.y + '-' + o.m + '-' + o.day + ' ' + o.h + ':' + o.min;
  }

  // 剩余天数：ceil，不足一天按 1 天计；过去为负数
  function daysLeft(ms) {
    if (!ms) return null;
    var now = new Date();
    var d = new Date(ms);
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((day - today) / 86400000);
  }

  function deadlineHtml(p) {
    if (!p.deadlineAt) {
      return '<span class="deadline">' + esc(p.deadlineLabel || '截止时间待确认') + '</span>';
    }
    var d = daysLeft(p.deadlineAt);
    var cls = 'deadline';
    var txt;
    if (d < 0) { cls += ' urgent'; txt = '已截止'; }
    else if (d === 0) { cls += ' urgent'; txt = '今天截止'; }
    else if (d <= 3) { cls += ' urgent'; txt = '剩 ' + d + ' 天'; }
    else if (d <= 7) { cls += ' soon'; txt = '剩 ' + d + ' 天'; }
    else { txt = '剩 ' + d + ' 天'; }
    var label = p.deadlineLabel ? ' · ' + esc(p.deadlineLabel) : ' · ' + fmtMD(p.deadlineAt);
    return '<span class="' + cls + '">⏰ ' + txt + label + '</span>';
  }

  function starsHtml(potential) {
    var n = potential || 0;
    var s = '';
    for (var i = 1; i <= 5; i++) s += (i <= n ? '★' : '☆');
    return '<span class="stars" title="潜力 ' + n + '/5">' + s + ' <span class="num">' + n + '/5</span></span>';
  }

  function statusTag(p) {
    return '<span class="tag tag-st-' + esc(p.status) + '">' + esc(STATUS_LABEL[p.status] || p.status) + '</span>';
  }
  function catTag(p) {
    return '<span class="tag tag-cat">' + esc(CAT_LABEL[p.category] || p.category) + '</span>';
  }
  function costTag(p) {
    return '<span class="tag tag-cost">' + esc(COST_LABEL[p.cost] || p.cost) + '</span>';
  }

  /* ---------- localStorage：收藏 / 任务 ---------- */
  function loadFavs() {
    try {
      var raw = localStorage.getItem(LS_FAV);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 忽略损坏的本地数据 */ }
    // 首次使用：沿用导出数据自带的收藏
    var init = {};
    board.projects.forEach(function (p) { if (p.favorite) init[p.slug] = true; });
    return init;
  }
  function saveFavs(favs) {
    try { localStorage.setItem(LS_FAV, JSON.stringify(favs)); } catch (e) { /* 忽略 */ }
  }
  function loadTasks() {
    try {
      var raw = localStorage.getItem(LS_TASKS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveTasks(tasks) {
    try { localStorage.setItem(LS_TASKS, JSON.stringify(tasks)); } catch (e) { /* 忽略 */ }
  }

  var favs = {};
  var doneTasks = {};

  function isFav(p) { return !!favs[p.slug]; }
  function doneCount(p) {
    var set = doneTasks[p.slug] || {};
    var n = 0;
    (p.tasks || []).forEach(function (t) { if (set[t.id]) n++; });
    return n;
  }

  /* ---------- 筛选与排序 ---------- */
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = board.projects.filter(function (p) {
      if (state.cat !== 'all' && p.category !== state.cat) return false;
      if (state.status !== 'all' && p.status !== state.status) return false;
      if (state.cost !== 'all' && p.cost !== state.cost) return false;
      if (state.favOnly && !isFav(p)) return false;
      if (state.verifiedOnly && !p.confirmed) return false;
      if (q) {
        var hay = [p.name, p.symbol, p.chain, p.description, p.slug,
          CAT_LABEL[p.category], STATUS_LABEL[p.status]].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (state.sort === 'potential') {
      list.sort(function (a, b) {
        return (b.potential - a.potential) || ((a.deadlineAt || Infinity) - (b.deadlineAt || Infinity));
      });
    } else if (state.sort === 'updated') {
      list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    } else {
      // 即将截止：未结束的按截止升序，已结束的沉底
      list.sort(function (a, b) {
        var ae = a.status === 'ended' ? 1 : 0;
        var be = b.status === 'ended' ? 1 : 0;
        if (ae !== be) return ae - be;
        return (a.deadlineAt || Infinity) - (b.deadlineAt || Infinity);
      });
    }
    return list;
  }

  /* ---------- 渲染：项目网格 ---------- */
  function cardHtml(p) {
    var sym = p.symbol ? '<span class="sym">' + esc(p.symbol) + '</span>' : '';
    var feat = p.featured ? '<span class="tag tag-featured">精选</span>' : '';
    var verified = p.confirmed ? '<span class="tag-verified">✓ 已核实</span>' : '<span class="tag-verified" style="color:var(--ink-4)">待核实</span>';
    var chain = p.chain ? '<span class="tag tag-chain">' + esc(p.chain) + '</span>' : '';
    var tasks = p.tasks || [];
    var taskInfo = tasks.length ? ('任务 ' + doneCount(p) + '/' + tasks.length) : '';
    return '' +
      '<article class="card' + (p.status === 'ended' ? ' is-ended' : '') + '" data-slug="' + esc(p.slug) + '" tabindex="0" role="button" aria-label="' + esc(p.name) + ' 详情">' +
        '<div class="card-top">' +
          '<h3 class="card-name">' + esc(p.name) + sym + '</h3>' +
          '<button class="fav-btn' + (isFav(p) ? ' on' : '') + '" data-fav="' + esc(p.slug) + '" aria-label="收藏" title="收藏">★</button>' +
        '</div>' +
        '<div class="tags">' + statusTag(p) + catTag(p) + costTag(p) + chain + feat + verified + '</div>' +
        '<p class="card-desc">' + esc(p.description || '') + '</p>' +
        '<div class="card-foot">' +
          deadlineHtml(p) +
          starsHtml(p.potential) +
          '<span class="card-tasks">' + esc(taskInfo) + '</span>' +
        '</div>' +
        '<div class="card-src">来源：' + esc(p.sourceName || '') + '</div>' +
      '</article>';
  }

  function renderGrid() {
    var list = filtered();
    var grid = $('grid');
    if (!list.length) {
      grid.innerHTML = '<div class="empty">没有符合条件的项目，换个筛选试试。</div>';
    } else {
      grid.innerHTML = list.map(cardHtml).join('');
    }
    $('resultLine').innerHTML = '共 <strong>' + board.projects.length + '</strong> 个项目 · 当前显示 <strong>' +
      list.length + '</strong> 个 · 收藏 <strong>' +
      Object.keys(favs).filter(function (s) { return favs[s]; }).length + '</strong> 个';
  }

  /* ---------- 渲染：动态 ---------- */
  function renderNews() {
    var list = (board.news || []).slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var show = list.slice(0, newsShown);
    $('newsCount').textContent = '（' + list.length + ' 条）';
    $('newsList').innerHTML = show.map(function (n) {
      return '<li data-slug="' + esc(n.projectSlug || '') + '">' +
        '<span class="news-kind ' + esc(n.kind) + '">' + esc(KIND_LABEL[n.kind] || n.kind) + '</span>' +
        esc(n.text) +
        '<span class="news-time">' + fmtMD(n.createdAt) + '</span>' +
      '</li>';
    }).join('');
    var more = $('newsMore');
    more.style.display = list.length > newsShown ? '' : 'none';
    more.textContent = list.length > newsShown ? '展开全部动态（还剩 ' + (list.length - newsShown) + ' 条）' : '';
  }

  /* ---------- 渲染：筛选 pills ---------- */
  function pillGroup(el, options, current, key) {
    el.innerHTML = options.map(function (o) {
      var count = o.count != null ? '<span class="n">' + o.count + '</span>' : '';
      return '<button type="button" class="pill' + (current === o.value ? ' on' : '') +
        '" data-key="' + key + '" data-value="' + esc(o.value) + '">' + esc(o.label) + count + '</button>';
    }).join('');
  }

  function countBy(field) {
    var c = {};
    board.projects.forEach(function (p) { c[p[field]] = (c[p[field]] || 0) + 1; });
    return c;
  }

  function renderFilters() {
    var cc = countBy('category');
    pillGroup($('catGroup'), [
      { value: 'all', label: '全部分类', count: board.projects.length },
      { value: 'points', label: '积分', count: cc.points || 0 },
      { value: 'testnet', label: '测试网', count: cc.testnet || 0 },
      { value: 'claim', label: '领取', count: cc.claim || 0 },
      { value: 'quest', label: '任务', count: cc.quest || 0 }
    ], state.cat, 'cat');
    var sc = countBy('status');
    pillGroup($('statusGroup'), [
      { value: 'all', label: '全部状态', count: board.projects.length },
      { value: 'active', label: '进行中', count: sc.active || 0 },
      { value: 'claimable', label: '可领取', count: sc.claimable || 0 },
      { value: 'tge_soon', label: '即将 TGE', count: sc.tge_soon || 0 },
      { value: 'ended', label: '已结束', count: sc.ended || 0 }
    ], state.status, 'status');
    var kc = countBy('cost');
    pillGroup($('costGroup'), [
      { value: 'all', label: '全部成本', count: board.projects.length },
      { value: 'free', label: '免费', count: kc.free || 0 },
      { value: 'gas_only', label: '仅 gas', count: kc.gas_only || 0 },
      { value: 'mixed', label: '混合成本', count: kc.mixed || 0 }
    ], state.cost, 'cost');
  }

  /* ---------- 详情弹窗 ---------- */
  function openDetail(slug) {
    var p = projectsBySlug[slug];
    if (!p) return;
    $('modalTitle').textContent = p.name + (p.symbol ? '（' + p.symbol + '）' : '');
    $('modalTags').innerHTML = statusTag(p) + catTag(p) + costTag(p) +
      (p.chain ? '<span class="tag tag-chain">' + esc(p.chain) + '</span>' : '') +
      (p.featured ? '<span class="tag tag-featured">精选</span>' : '') +
      (p.confirmed ? '<span class="tag-verified">✓ 已核实</span>' : '<span class="tag-verified" style="color:var(--ink-4)">待核实</span>');

    var kv = '<dl class="kv">' +
      '<dt>截止时间</dt><dd>' + esc(p.deadlineLabel || (p.deadlineAt ? fmtFull(p.deadlineAt) : '待确认')) + '</dd>' +
      '<dt>潜力</dt><dd>' + (p.potential || 0) + ' / 5</dd>' +
      '<dt>官网</dt><dd>' + (p.officialUrl
        ? '<a href="' + esc(p.officialUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(p.officialUrl) + '</a>'
        : '待确认') + '</dd>' +
      '</dl>';

    var html = '<h3>项目介绍</h3><p>' + esc(p.description || '') + '</p>' + kv;

    if (p.rewardNote) html += '<h3>奖励说明</h3><p>' + esc(p.rewardNote) + '</p>';

    if (p.prepItems && p.prepItems.length) {
      html += '<h3>准备清单</h3><ul>' + p.prepItems.map(function (x) {
        return '<li>' + esc(x) + '</li>';
      }).join('') + '</ul>';
    }

    if (p.steps && p.steps.length) {
      html += '<h3>保姆级步骤</h3><ol class="steps">' + p.steps.map(function (s) {
        return '<li><h4>' + esc(s.title) + '</h4><p>' + esc(s.body || '') + '</p>' +
          (s.caution ? '<div class="caution">⚠ ' + esc(s.caution) + '</div>' : '') + '</li>';
      }).join('') + '</ol>';
    }

    if (p.tasks && p.tasks.length) {
      var set = doneTasks[p.slug] || {};
      html += '<h3>任务清单（' + doneCount(p) + '/' + p.tasks.length + '）</h3><ul class="task-list">' +
        p.tasks.map(function (t) {
          var done = !!set[t.id];
          return '<li class="' + (done ? 'done' : '') + '">' +
            '<input type="checkbox" data-task-slug="' + esc(p.slug) + '" data-task-id="' + t.id + '"' +
            (done ? ' checked' : '') + ' aria-label="' + esc(t.text) + '">' +
            '<span class="t-text">' + esc(t.text) +
            (t.detail ? '<small>' + esc(t.detail) + '</small>' : '') + '</span></li>';
        }).join('') + '</ul>';
    }

    if (p.riskItems && p.riskItems.length) {
      html += '<h3>风险提示</h3><div class="risk"><ul>' + p.riskItems.map(function (x) {
        return '<li>' + esc(x) + '</li>';
      }).join('') + '</ul></div>';
    }

    $('modalBody').innerHTML = html;

    $('modalFoot').innerHTML =
      (p.officialUrl
        ? '<a class="btn" href="' + esc(p.officialUrl) + '" target="_blank" rel="noopener noreferrer">打开官网 ↗</a>'
        : '') +
      '<button class="btn-ghost" type="button" id="modalFav">' + (isFav(p) ? '★ 已收藏' : '☆ 收藏此项目') + '</button>' +
      '<span class="src">来源：' + (p.sourceUrl
        ? '<a href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(p.sourceName || '来源') + '</a>'
        : esc(p.sourceName || '')) + '</span>';

    var favBtn = $('modalFav');
    if (favBtn) {
      favBtn.addEventListener('click', function () {
        toggleFav(p.slug);
        favBtn.textContent = isFav(p) ? '★ 已收藏' : '☆ 收藏此项目';
      });
    }

    $('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    $('modalOverlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  function toggleFav(slug) {
    favs[slug] = !favs[slug];
    if (!favs[slug]) delete favs[slug];
    saveFavs(favs);
    renderGrid();
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    $('q').addEventListener('input', function (e) { state.q = e.target.value; renderGrid(); });
    $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderGrid(); });
    $('favOnly').addEventListener('change', function (e) { state.favOnly = e.target.checked; renderGrid(); });
    $('verifiedOnly').addEventListener('change', function (e) { state.verifiedOnly = e.target.checked; renderGrid(); });

    document.addEventListener('click', function (e) {
      var pill = e.target.closest('.pill');
      if (pill) {
        state[pill.getAttribute('data-key')] = pill.getAttribute('data-value');
        renderFilters();
        renderGrid();
        return;
      }
      var favBtn = e.target.closest('[data-fav]');
      if (favBtn) {
        e.stopPropagation();
        toggleFav(favBtn.getAttribute('data-fav'));
        return;
      }
      var card = e.target.closest('.card');
      if (card) { openDetail(card.getAttribute('data-slug')); return; }
      var newsItem = e.target.closest('.news-list li');
      if (newsItem) {
        var slug = newsItem.getAttribute('data-slug');
        if (slug && projectsBySlug[slug]) openDetail(slug);
        return;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDetail();
      if (e.key === 'Enter') {
        var card = e.target.closest && e.target.closest('.card');
        if (card) openDetail(card.getAttribute('data-slug'));
      }
    });

    // 任务勾选（事件委托，弹窗内动态生成）
    $('modalBody').addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-task-id]');
      if (!cb) return;
      var slug = cb.getAttribute('data-task-slug');
      var id = cb.getAttribute('data-task-id');
      doneTasks[slug] = doneTasks[slug] || {};
      if (cb.checked) doneTasks[slug][id] = true; else delete doneTasks[slug][id];
      saveTasks(doneTasks);
      cb.closest('li').classList.toggle('done', cb.checked);
      // 同步更新弹窗内的任务计数标题与卡片上的计数
      var p = projectsBySlug[slug];
      renderGrid();
      openDetailRefreshCount(p);
    });

    $('modalClose').addEventListener('click', closeDetail);
    $('modalOverlay').addEventListener('click', function (e) {
      if (e.target === $('modalOverlay')) closeDetail();
    });
    $('newsMore').addEventListener('click', function () {
      newsShown = (board.news || []).length;
      renderNews();
    });
  }

  // 勾选任务后只刷新弹窗内的“任务清单（x/y）”标题，避免重建弹窗丢失滚动位置
  function openDetailRefreshCount(p) {
    var heads = $('modalBody').querySelectorAll('h3');
    heads.forEach(function (h) {
      if (h.textContent.indexOf('任务清单') === 0) {
        h.textContent = '任务清单（' + doneCount(p) + '/' + (p.tasks || []).length + '）';
      }
    });
  }

  /* ---------- 启动 ---------- */
  function showError(msg) {
    document.querySelector('main').innerHTML =
      '<div class="load-error"><strong>数据加载失败</strong><p>' + esc(msg) +
      '</p><p>请确认 data.json 与 index.html 在同一目录，并用 HTTP 服务访问（直接双击打开文件可能因浏览器限制读不到数据）。</p></div>';
  }

  fetch(DATA_URL)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + '：' + DATA_URL);
      return r.json();
    })
    .then(function (data) {
      board = data;
      board.projects.forEach(function (p) { projectsBySlug[p.slug] = p; });
      favs = loadFavs();
      doneTasks = loadTasks();

      $('siteMeta').innerHTML = '最后刷新：<strong>' + fmtFull(board.lastRefreshedAt) + '</strong>（北京时间）<br>' +
        '项目 <strong>' + board.projects.length + '</strong> 个 · 动态 <strong>' + (board.news || []).length + '</strong> 条';
      $('footMeta').textContent = '数据最后刷新：' + fmtFull(board.lastRefreshedAt) + '（北京时间）';

      renderFilters();
      renderGrid();
      renderNews();
      bindEvents();
    })
    .catch(function (err) { showError(err.message || String(err)); });
})();
