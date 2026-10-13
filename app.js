/* app.js —— 生日记录 PWA 主逻辑 */
(function () {
  'use strict';

  var L = window.Lunar;
  var KEY = 'bd.items.v1';
  var SKEY = 'bd.settings.v1';

  var state = {
    items: [],
    settings: { years: 5 },
    editingId: null,
    detailId: null
  };

  var $ = function (id) { return document.getElementById(id); };

  // ======================= 存储 =======================
  function loadAll() {
    try {
      var raw = localStorage.getItem(KEY);
      state.items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.items)) state.items = [];
    } catch (e) { state.items = []; }
    try {
      var s = localStorage.getItem(SKEY);
      if (s) state.settings = Object.assign(state.settings, JSON.parse(s));
    } catch (e) { /* ignore */ }
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.items));
      localStorage.setItem(SKEY, JSON.stringify(state.settings));
    } catch (e) { toast('保存失败：存储空间不足'); }
  }
  function uid() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  // ======================= 日期计算 =======================
  /** 某条记录在「公历 year 年」范围内对应的那一天（用于 ics 逐年展开） */
  function dateInYear(item, year) {
    if (item.type === 'lunar') {
      return L.solve(year, item.month, item.day, !!item.isLeap);
    }
    var last = new Date(year, item.month, 0).getDate();
    return new Date(year, item.month - 1, Math.min(item.day, last));
  }

  /** 下一次生日（含今天）；from 可选，用于测试模拟「今天」 */
  function nextDate(item, from) {
    if (item.type === 'lunar') {
      return L.nextLunarOccurrence(item.month, item.day, !!item.isLeap, from);
    }
    return L.nextSolarOccurrence(item.month, item.day, from);
  }

  function daysLeft(item, from) {
    var d = nextDate(item, from);
    if (!d) return null;
    return L.daysBetween(from || new Date(), d);
  }

  /** 生日写法描述 */
  function describe(item) {
    if (item.type === 'lunar') {
      return '农历 ' + L.formatLunar(item.month, item.day, !!item.isLeap);
    }
    return '公历 ' + item.month + '月' + item.day + '日';
  }

  function fmtDate(d) {
    if (!d) return '—';
    var w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + w;
  }

  /** 到下一次生日时将满多少岁（虚岁不算，按周岁） */
  function ageOnNext(item) {
    if (!item.birthYear) return null;
    var d = nextDate(item);
    if (!d) return null;
    var y = (item.type === 'lunar') ? L.lunarYearOf(d) : d.getFullYear();
    var age = y - item.birthYear;
    return age >= 0 && age < 150 ? age : null;
  }

  // ======================= UI 小工具 =======================
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function openSheet(id) {
    closeSheets(true);
    $('mask').classList.add('open');
    $(id).classList.add('open');
  }
  function closeSheets(silent) {
    ['sheetEdit', 'sheetDetail', 'sheetSettings'].forEach(function (s) {
      $(s).classList.remove('open');
    });
    if (!silent) $('mask').classList.remove('open');
  }
  var AMP = String.fromCharCode(38); // 避免源码里出现实体写法被编辑器转义
  var ESC_MAP = { '&': AMP + 'amp;', '<': AMP + 'lt;', '>': AMP + 'gt;', '"': AMP + 'quot;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ESC_MAP[c]; });
  }

  // ======================= 倒计时环 =======================
  function ringHTML(days) {
    var R = 26, C = 2 * Math.PI * R;
    var ratio, color, inner;
    if (days === null) { ratio = 0; color = '#bbb'; inner = '<span class="n">?</span>'; }
    else if (days === 0) {
      ratio = 1; color = 'url(#gradHot)';
      inner = '<span class="cake">🎂</span>';
    } else {
      ratio = Math.max(0.02, 1 - Math.min(days, 365) / 365);
      color = days <= 7 ? '#ff6b8a' : (days <= 30 ? '#ffb866' : '#9b8cff');
      inner = '<span class="n">' + days + '</span><span class="u">天</span>';
    }
    var off = C * (1 - ratio);
    return '<div class="ring">' +
      '<svg width="62" height="62" viewBox="0 0 62 62">' +
      '<defs><linearGradient id="gradHot" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#ff8fab"/><stop offset="100%" stop-color="#9b8cff"/>' +
      '</linearGradient></defs>' +
      '<circle class="track" cx="31" cy="31" r="' + R + '" fill="none" stroke-width="6"/>' +
      '<circle class="bar" cx="31" cy="31" r="' + R + '" fill="none" stroke-width="6" ' +
      'stroke="' + color + '" stroke-dasharray="' + C.toFixed(2) + '" ' +
      'stroke-dashoffset="' + off.toFixed(2) + '"/>' +
      '</svg>' +
      '<div class="txt"><div>' + inner + '</div></div>' +
      '</div>';
  }

  // ======================= 列表渲染 =======================
  function render() {
    var box = $('list');
    var today = L.startOfDay(new Date());
    var lr = L.lunarOf(today);
    $('todayLine').textContent = fmtDate(today) +
      (lr ? '　农历' + L.formatLunar(lr.month, lr.day, lr.isLeap) : '');

    if (!state.items.length) {
      box.innerHTML = '<div class="empty"><div class="big">🎈</div>' +
        '<p>还没有记录，点右下角 ＋ 添加生日</p></div>';
      return;
    }

    var rows = state.items.map(function (it) {
      return { item: it, days: daysLeft(it), next: nextDate(it) };
    }).sort(function (a, b) {
      var x = a.days === null ? 99999 : a.days;
      var y = b.days === null ? 99999 : b.days;
      if (x !== y) return x - y;
      return (a.item.name || '').localeCompare(b.item.name || '', 'zh');
    });

    var groups = [
      { title: '今天 🎉', test: function (d) { return d === 0; }, html: [] },
      { title: '最近 30 天', test: function (d) { return d > 0 && d <= 30; }, html: [] },
      { title: '以后', test: function (d) { return d === null || d > 30; }, html: [] }
    ];

    rows.forEach(function (r) {
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].test(r.days)) { groups[i].html.push(cardHTML(r)); break; }
      }
    });

    var out = '';
    groups.forEach(function (g) {
      if (!g.html.length) return;
      out += '<div class="group-title">' + g.title + '</div>' + g.html.join('');
    });
    box.innerHTML = out;

    Array.prototype.forEach.call(box.querySelectorAll('.card'), function (el) {
      el.addEventListener('click', function () { showDetail(el.getAttribute('data-id')); });
    });
  }

  function cardHTML(r) {
    var it = r.item;
    var age = ageOnNext(it);
    var cls = 'card' + (r.days === 0 ? ' today' : '');
    var typeCls = it.type === 'lunar' ? 'tag-lunar' : 'tag-solar';
    var meta = '<span class="' + typeCls + '">' + esc(describe(it)) + '</span>' +
      '　' + (r.next ? (r.next.getMonth() + 1) + '/' + r.next.getDate() : '—');
    if (age !== null) meta += '　满 <b>' + age + '</b> 岁';
    return '<div class="' + cls + '" data-id="' + it.id + '">' +
      ringHTML(r.days) +
      '<div class="info">' +
      '<div class="name">' + esc(it.name || '未命名') +
      (it.relation ? '<span class="rel">' + esc(it.relation) + '</span>' : '') +
      '</div><div class="meta">' + meta + '</div></div>' +
      '</div>';
  }

  // ======================= 详情 =======================
  function showDetail(id) {
    var it = findItem(id);
    if (!it) return;
    state.detailId = id;
    var d = nextDate(it);
    var days = daysLeft(it);
    $('dName').textContent = (it.name || '未命名') + (it.relation ? '（' + it.relation + '）' : '');
    $('dCountdown').innerHTML = days === 0
      ? '就是今天！🎂'
      : (days === null ? '无法计算日期' : '还有 <b>' + days + '</b> 天');

    var rows = '';
    function kv(k, v) { rows += '<div class="kv"><span>' + k + '</span><b>' + esc(v) + '</b></div>'; }
    kv('生日', describe(it));
    kv('下次公历', fmtDate(d));
    if (d) {
      var lr = L.lunarOf(d);
      if (lr) kv('下次农历', L.formatLunar(lr.month, lr.day, lr.isLeap));
    }
    var age = ageOnNext(it);
    if (age !== null) kv('下次年龄', age + ' 岁');
    if (it.birthYear) {
      kv('出生年', it.birthYear + ' 年（' + L.zodiacOf(it.birthYear) + '）');
    }
    kv('提醒', it.advance > 0 ? '提前 ' + it.advance + ' 天' : '当天');
    if (it.note) kv('备注', it.note);
    $('dRows').innerHTML = rows;
    openSheet('sheetDetail');
  }

  // ======================= 编辑 / 新增 =======================
  var curType = 'lunar';

  function initSelects() {
    var h = '', i;
    for (i = 1; i <= 12; i++) h += '<option value="' + i + '">' + L.MONTH_NAMES[i - 1] + '月</option>';
    $('fLMonth').innerHTML = h;
    h = '';
    for (i = 1; i <= 30; i++) h += '<option value="' + i + '">' + L.DAY_NAMES[i - 1] + '</option>';
    $('fLDay').innerHTML = h;
    h = '';
    for (i = 1; i <= 12; i++) h += '<option value="' + i + '">' + i + ' 月</option>';
    $('fSMonth').innerHTML = h;
    h = '';
    for (i = 1; i <= 31; i++) h += '<option value="' + i + '">' + i + ' 日</option>';
    $('fSDay').innerHTML = h;
  }

  function setType(t) {
    curType = t;
    Array.prototype.forEach.call($('segType').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === t);
    });
    $('boxLunar').hidden = (t !== 'lunar');
    $('boxSolar').hidden = (t !== 'solar');
  }

  function openEditor(id) {
    state.editingId = id || null;
    var it = id ? findItem(id) : null;
    $('editTitle').textContent = it ? '编辑生日' : '新增生日';
    $('fName').value = it ? (it.name || '') : '';
    $('fRelation').value = it ? (it.relation || '') : '';
    $('fNote').value = it ? (it.note || '') : '';
    $('fYear').value = (it && it.birthYear) ? it.birthYear : '';
    $('fAdvance').value = it ? String(it.advance == null ? 1 : it.advance) : '1';
    setType(it ? it.type : 'lunar');
    if (it && it.type === 'solar') {
      $('fSMonth').value = it.month;
      $('fSDay').value = it.day;
      $('fLeap').checked = false;
    } else {
      $('fLMonth').value = it ? it.month : 1;
      $('fLDay').value = it ? it.day : 1;
      $('fLeap').checked = !!(it && it.isLeap);
    }
    openSheet('sheetEdit');
  }

  function saveForm() {
    var name = $('fName').value.trim();
    if (!name) { toast('请先填写姓名'); return; }
    var isNew = !state.editingId;
    var obj = isNew ? { id: uid() } : findItem(state.editingId);
    if (!obj) { closeSheets(); return; }
    obj.name = name;
    obj.relation = $('fRelation').value.trim();
    obj.note = $('fNote').value.trim();
    obj.type = curType;
    obj.advance = parseInt($('fAdvance').value, 10) || 0;
    var y = parseInt($('fYear').value, 10);
    obj.birthYear = (y >= 1900 && y <= 2100) ? y : null;
    if (curType === 'lunar') {
      obj.month = parseInt($('fLMonth').value, 10);
      obj.day = parseInt($('fLDay').value, 10);
      obj.isLeap = $('fLeap').checked;
    } else {
      obj.month = parseInt($('fSMonth').value, 10);
      obj.day = parseInt($('fSDay').value, 10);
      obj.isLeap = false;
    }
    if (!nextDate(obj)) { toast('这个日期算不出来，请检查输入'); return; }
    if (isNew) state.items.push(obj);
    persist();
    render();
    closeSheets();
    toast(isNew ? '已添加' : '已更新');
    state.editingId = null;
  }

  // ======================= 导出 .ics 加入系统日历 =======================
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function icsDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }

  function icsText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /** 按 RFC5545 折行：每行不超过 ~72 字节，续行以空格开头 */
  function fold(line) {
    if (line.length < 25) return line;
    var out = '', cur = '', bytes = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var b = ch.charCodeAt(0) > 0x7ff ? 3 : (ch.charCodeAt(0) > 0x7f ? 2 : 1);
      if (bytes + b > 70) { out += cur + '\r\n '; cur = ''; bytes = 1; }
      cur += ch; bytes += b;
    }
    return out + cur;
  }

  function alarmTrigger(advance) {
    var hours = 9 - advance * 24; // 提醒落在当天/提前日的 09:00
    return hours >= 0 ? 'PT' + hours + 'H' : '-PT' + (-hours) + 'H';
  }

  function buildICS(items, years) {
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) +
      'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BirthdayPWA//Birthday Record//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:生日记录',
      'X-WR-TIMEZONE:Asia/Shanghai'
    ];
    var baseYear = now.getFullYear();
    var count = 0;

    items.forEach(function (it) {
      // 从 -1 开始：农历项的 year 实际是「农历年」，公历 1 月时农历还在上一年，
      // 不回退一年会漏掉今年剩下的生日；过去的日期下面会被过滤掉。
      for (var k = -1; k <= years; k++) {
        var y = baseYear + k;
        var d = dateInYear(it, y);
        if (!d) continue;
        if (L.daysBetween(now, d) < 0) continue; // 过去的不写
        var ly = (it.type === 'lunar') ? L.lunarYearOf(d) : d.getFullYear();
        var age = it.birthYear ? (ly - it.birthYear) : null;
        var lr = L.lunarOf(d);

        var summary = '🎂 ' + (it.name || '未命名') + ' 生日';
        if (age !== null && age >= 0) summary += '（' + age + '岁）';

        var desc = describe(it);
        if (lr) desc += '\n当日农历：' + L.formatLunar(lr.month, lr.day, lr.isLeap);
        if (it.relation) desc += '\n关系：' + it.relation;
        if (it.note) desc += '\n备注：' + it.note;

        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + it.id + '-' + icsDate(d) + '@birthday-record');
        lines.push('DTSTAMP:' + stamp);
        lines.push('DTSTART;VALUE=DATE:' + icsDate(d));
        lines.push('DTEND;VALUE=DATE:' + icsDate(L.addDays(d, 1)));
        lines.push(fold('SUMMARY:' + icsText(summary)));
        lines.push(fold('DESCRIPTION:' + icsText(desc)));
        lines.push('TRANSP:TRANSPARENT');
        lines.push('CATEGORIES:生日');
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('TRIGGER;RELATED=START:' + alarmTrigger(it.advance || 0));
        lines.push(fold('DESCRIPTION:' + icsText(summary)));
        lines.push('END:VALARM');
        lines.push('END:VEVENT');
        count++;
      }
    });

    lines.push('END:VCALENDAR');
    return { text: lines.join('\r\n') + '\r\n', count: count };
  }

  function deliverFile(filename, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var file = null;
    try { file = new File([blob], filename, { type: mime }); } catch (e) { file = null; }

    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).then(function () {
        toast('已发送，请在弹窗里选择「日历」');
      }).catch(function () { /* 用户取消 */ });
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
    toast('已生成文件，打开后选择「添加到日历」');
  }

  function exportCalendar(items) {
    if (!items.length) { toast('没有可导出的记录'); return; }
    var years = parseInt(state.settings.years, 10) || 5;
    var r = buildICS(items, years);
    if (!r.count) { toast('未生成任何事件'); return; }
    deliverFile('生日记录.ics', r.text, 'text/calendar');
  }

  // ======================= 备份 =======================
  function exportBackup() {
    var data = { app: 'birthday-record', version: 1, exportedAt: new Date().toISOString(), items: state.items };
    deliverFile('生日记录备份.json', JSON.stringify(data, null, 2), 'application/json');
  }

  function importBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { toast('文件格式不正确'); return; }
    var arr = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(arr)) { toast('没找到数据'); return; }
    var added = 0;
    arr.forEach(function (o) {
      if (!o || !o.name || !o.month || !o.day) return;
      state.items.push({
        id: uid(),
        name: String(o.name).slice(0, 20),
        relation: o.relation ? String(o.relation).slice(0, 10) : '',
        note: o.note ? String(o.note).slice(0, 200) : '',
        type: o.type === 'solar' ? 'solar' : 'lunar',
        month: Math.min(12, Math.max(1, parseInt(o.month, 10))),
        day: Math.min(31, Math.max(1, parseInt(o.day, 10))),
        isLeap: !!o.isLeap,
        birthYear: (o.birthYear >= 1900 && o.birthYear <= 2100) ? parseInt(o.birthYear, 10) : null,
        advance: [0, 1, 3, 7].indexOf(parseInt(o.advance, 10)) >= 0 ? parseInt(o.advance, 10) : 1
      });
      added++;
    });
    persist();
    render();
    toast('已导入 ' + added + ' 条');
  }

  // ======================= 设置面板 =======================
  function refreshSettings() {
    $('sLunarEngine').textContent = L.supported ? '系统农历（可用）' : '不可用，请升级 iOS';
    $('sCount').textContent = state.items.length + ' 条记录';
    $('sOffline').textContent = ('serviceWorker' in navigator) ? '已启用' : '不支持';
    $('sYears').value = String(state.settings.years || 5);
  }

  var DEMO = [
    { name: '妈妈', relation: '母亲', type: 'lunar', month: 8, day: 15, isLeap: false, birthYear: 1962, advance: 3, note: '中秋节生日' },
    { name: '爸爸', relation: '父亲', type: 'lunar', month: 12, day: 8, isLeap: false, birthYear: 1960, advance: 3, note: '腊八' },
    { name: '我', relation: '本人', type: 'solar', month: 6, day: 18, isLeap: false, birthYear: 1990, advance: 1, note: '' }
  ];

  // ======================= 事件绑定 =======================
  function bind() {
    $('btnAdd').addEventListener('click', function () { openEditor(null); });
    $('mask').addEventListener('click', function () { closeSheets(); });
    $('btnCancelEdit').addEventListener('click', function () { closeSheets(); });
    $('btnCloseDetail').addEventListener('click', function () { closeSheets(); });
    $('btnCloseSettings').addEventListener('click', function () { closeSheets(); });
    $('btnSave').addEventListener('click', saveForm);

    Array.prototype.forEach.call($('segType').children, function (b) {
      b.addEventListener('click', function () { setType(b.getAttribute('data-v')); });
    });

    $('btnEditThis').addEventListener('click', function (){
      var id = state.detailId;
      closeSheets(true);
      setTimeout(function () { openEditor(id); }, 60);
    });

    $('btnDeleteThis').addEventListener('click', function () {
      var it = findItem(state.detailId);
      if (!it) return;
      if (!confirm('删除「' + it.name + '」的生日记录？')) return;
      state.items = state.items.filter(function (x) { return x.id !== state.detailId; });
      persist();
      render();
      closeSheets();
      toast('已删除');
    });

    $('btnToCalendar').addEventListener('click', function () {
      var it = findItem(state.detailId);
      if (it) exportCalendar([it]);
    });

    $('btnCalendar').addEventListener('click', function () { exportCalendar(state.items); });

    $('btnSettings').addEventListener('click', function () {
      refreshSettings();
      openSheet('sheetSettings');
    });

    $('sYears').addEventListener('change', function () {
      state.settings.years = parseInt($('sYears').value, 10) || 5;
      persist();
    });

    $('btnExport').addEventListener('click', exportBackup);
    $('btnImport').addEventListener('click', function () { $('fileImport').click(); });
    $('fileImport').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { importBackup(String(fr.result)); refreshSettings(); };
      fr.onerror = function () { toast('读取文件失败'); };
      fr.readAsText(f);
      e.target.value = '';
    });

    $('btnDemo').addEventListener('click', function () {
      DEMO.forEach(function (o) {
        var c = {};
        for (var k in o) c[k] = o[k];
        c.id = uid();
        state.items.push(c);
      });
      persist();
      render();
      refreshSettings();
      toast('已填入示例数据');
    });

    $('btnClear').addEventListener('click', function () {
      if (!confirm('确定清空全部生日记录？建议先导出备份。')) return;
      state.items = [];
      persist();
      render();
      refreshSettings();
      toast('已清空');
    });

    // 回到前台时刷新倒计时（跨天场景）
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) render();
    });
    // 每 10 分钟自动刷新一次
    setInterval(render, 600000);
    // 午夜 00:00 精确刷新：生日过完立即翻到下一年
    scheduleMidnight();
  }

  /** 定时到下一个本地午夜，刷新后再定下一次 */
  function scheduleMidnight() {
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2, 0);
    var ms = next.getTime() - now.getTime();
    if (!(ms > 0)) ms = 60000;
    if (ms > 2147483000) ms = 2147483000; // 防止 setTimeout 溢出
    setTimeout(function () {
      render();
      scheduleMidnight();
    }, ms);
  }

  // ======================= 启动 =======================
  function init() {
    if (!L || !L.supported) {
      document.getElementById('list').innerHTML =
        '<div class="empty"><div class="big">⚠️</div>' +
        '<p>当前浏览器不支持系统农历换算。<br>请使用 iOS 14 以上的 Safari，或 Chrome / Edge 最新版。</p></div>';
    }
    loadAll();
    initSelects();
    bind();
    render();
  }

  // 暴露少量内部方法，便于调试与自动化测试
  window.BirthdayApp = {
    state: state,
    buildICS: buildICS,
    dateInYear: dateInYear,
    nextDate: nextDate,
    describe: describe,
    render: render,
    importBackup: importBackup
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();