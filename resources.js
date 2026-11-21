/* 免费资源版块（免费服务器 / 容器类 / 免费 AI 模型）
   数据来自同目录 resources.json，与空投项目 data.json 完全独立。
   标签切换只控制显示，不动 app.js 的筛选、收藏、任务逻辑。 */
(function () {
  'use strict';

  var RES_URL = 'resources.json';
  var resources = null;
  var rendered = {};
  var currentView = 'airdrops';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 绑卡列：免卡给绿底小标签，需绑卡给灰底小标签，其余按原样显示 */
  function cardCell(card) {
    if (card === '不用' || card.indexOf('不用（') === 0) {
      var restFree = card === '不用' ? '' : card.slice(2).trim();
      return '<span class="rc-badge rc-free">免卡</span>' +
        (restFree ? ' <span class="rc-muted">' + esc(restFree) + '</span>' : '');
    }
    if (card === '免费福利要绑 Discord') return '<span class="rc-badge rc-discord">需绑 Discord</span>';
    if (card === '未说明') return '<span class="rc-muted">未说明</span>';
    if (card.indexOf('要') === 0) {
      var rest = card.slice(1).trim();
      return '<span class="rc-badge rc-card">需绑卡</span>' +
        (rest ? ' <span class="rc-muted">' + esc(rest) + '</span>' : '');
    }
    return esc(card);
  }

  function nameCell(item) {
    var badge = '';
    if (item.badge) {
      badge = ' <span class="rc-badge ' + esc(item.badgeClass || '') + '">' + esc(item.badge) + '</span>';
    }
    var name = esc(item.name);
    if (item.url) {
      name = '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' + name + ' ↗</a>';
    }
    return '<td class="rc-name">' + name + badge + '</td>';
  }

  function sectionHtml(sec) {
    var html = '<section class="rc-section" aria-label="' + esc(sec.title) + '">';
    html += '<h2>' + esc(sec.title) + ' <span class="rc-count">（' + sec.items.length + ' 条）</span></h2>';
    if (sec.subtitle) html += '<p class="rc-sub">' + esc(sec.subtitle) + '</p>';
    if (sec.note) html += '<p class="rc-note">' + esc(sec.note) + '</p>';
    html += '<p class="rc-disclaimer">' + esc(sec.disclaimer || '额度以官网实时为准。') + '</p>';
    html += '<div class="rc-wrap"><table class="rc-table"><thead><tr>' +
      sec.cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    sec.items.forEach(function (item) {
      html += '<tr>';
      sec.cols.forEach(function (c) {
        if (c.key === 'name') { html += nameCell(item); return; }
        if (c.key === 'card') { html += '<td>' + cardCell(item.card) + '</td>'; return; }
        html += '<td>' + esc(item[c.key] || '') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    if (sec.noFree && sec.noFree.length) {
      html += '<div class="rc-nofree"><strong>' + esc(sec.noFreeNote || '明确没有免费 API 档的：') + '</strong>' +
        '<ul><li>' + sec.noFree.map(esc).join('</li><li>') + '</li></ul></div>';
    }
    html += '</section>';
    return html;
  }

  function renderSection(id) {
    if (rendered[id] || !resources) return;
    var sec = null;
    resources.sections.forEach(function (s) { if (s.id === id) sec = s; });
    if (!sec) return;
    $('resourcesRoot').innerHTML = sectionHtml(sec);
    rendered[id] = true;
  }

  function setView(view) {
    currentView = view;
    var tabs = document.querySelectorAll('.view-tab');
    tabs.forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === view);
    });
    var isAirdrop = view === 'airdrops';
    var toolbar = document.querySelector('.toolbar');
    var layout = document.querySelector('.layout');
    if (toolbar) toolbar.hidden = !isAirdrop;
    if (layout) layout.hidden = !isAirdrop;
    var rv = $('resourcesView');
    if (rv) rv.hidden = isAirdrop;
    if (!isAirdrop) {
      if (!resources) {
        if ($('resourcesRoot')) {
          $('resourcesRoot').innerHTML = '<div class="empty">资源数据加载中…</div>';
        }
      } else {
        renderSection(view);
      }
    }
    window.scrollTo({ top: 0 });
    if (view !== 'airdrops') {
      try { history.replaceState(null, '', '#' + view); } catch (e) { /* 忽略 */ }
    } else {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* 忽略 */ }
    }
  }

  function bindTabs() {
    document.querySelectorAll('.view-tab').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
  }

  function initView() {
    var hash = (location.hash || '').replace('#', '');
    if (hash === 'servers' || hash === 'containers' || hash === 'ai' ||
        hash === 'ai-trial' || hash === 'databases' || hash === 'storage' ||
        hash === 'domains' || hash === 'email' || hash === 'crypto') {
      setView(hash);
    }
  }

  bindTabs();

  fetch(RES_URL)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + '：' + RES_URL);
      return r.json();
    })
    .then(function (data) {
      resources = data;
      if (currentView !== 'airdrops') renderSection(currentView);
    })
    .catch(function (err) {
      if ($('resourcesRoot') && currentView !== 'airdrops') {
        $('resourcesRoot').innerHTML =
          '<div class="empty">资源数据加载失败：' + esc(err.message || String(err)) + '</div>';
      }
    });

  initView();
})();
