/*
 * lunar.js —— 农历换算核心
 *
 * 设计要点：不内置任何农历数据表，而是直接使用浏览器内置的 ICU 中国农历
 * （Intl.DateTimeFormat + calendar=chinese），这与 iOS 原生
 * Calendar(identifier: .chinese) 是同一套数据，闰月、大小月天然准确。
 *
 * 反向换算（农历 -> 公历）没有现成 API，这里用「按农历年构建索引表」的办法：
 * 先定位该农历年的正月初一（春节），再逐日向后扫描到下一个春节，
 * 把每一天的 农历月/日/是否闰月 记进 Map，一年只扫一次并缓存。
 */
(function (global) {
  'use strict';

  var MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  var DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
  ];
  var ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

  var CN_NUM = {
    '正': 1, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
    '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12,
    '冬': 11, '腊': 12
  };

  // ---------- 日期小工具（全部按本地时区的「天」处理） ----------
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function daysBetween(a, b) {
    var MS = 86400000;
    var ta = startOfDay(a).getTime();
    var tb = startOfDay(b).getTime();
    return Math.round((tb - ta) / MS);
  }
  function ymd(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  // ---------- 农历解析器两套实现 + 启动自检挑选可用的那套） ----------
  function makeParser(locale, monthStyle) {
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat(locale, {
        calendar: 'chinese',
        month: monthStyle,
        day: 'numeric',
        numberingSystem: 'latn'
      });
    } catch (e) {
      return null;
    }
    return function (date) {
      var parts;
      try {
        parts = fmt.formatToParts(date);
      } catch (e) {
        return null;
      }
      var rawMonth = '', rawDay = '';
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'month') rawMonth = parts[i].value;
        else if (parts[i].type === 'day') rawDay = parts[i].value;
      }
      if (!rawMonth || !rawDay) return null;

      var isLeap = false;
      var s = rawMonth;
      // 中文写法「闰五月」；ICU 英文写法「5bis」
      if (s.indexOf('闰') === 0) { isLeap = true; s = s.slice(1); }
      if (/bis/i.test(s)) { isLeap = true; s = s.replace(/bis/i, ''); }
      s = s.replace(/月$/, '').trim();

      var month = /^\d+$/.test(s) ? parseInt(s, 10) : CN_NUM[s];
      var day = parseInt(rawDay, 10);
      if (!month || !day || month < 1 || month > 12 || day < 1 || day > 30) return null;
      return { month: month, day: day, isLeap: isLeap };
    };
  }

  // 自检样本：公历日期 -> 期望农历（含一个闰月样本）
  var PROBES = [
    ['2023-01-22', 1, 1, false],
    ['2023-03-22', 2, 1, true],   // 2023 年闰二月初一
    ['2024-02-10', 1, 1, false],
    ['2025-01-29', 1, 1, false],
    ['2024-06-10', 5, 5, false]   // 端午
  ];

  function validate(parser) {
    if (!parser) return false;
    for (var i = 0; i < PROBES.length; i++) {
      var p = PROBES[i];
      var bits = p[0].split('-');
      var d = new Date(+bits[0], +bits[1] - 1, +bits[2]);
      var r = parser(d);
      if (!r || r.month !== p[1] || r.day !== p[2] || r.isLeap !== p[3]) return false;
    }
    return true;
  }

  var candidates = [
    makeParser('zh-CN-u-ca-chinese', 'long'),
    makeParser('en-US-u-ca-chinese', 'numeric'),
    makeParser('zh-CN-u-ca-chinese', 'numeric')
  ];
  var parse = null;
  for (var ci = 0; ci < candidates.length; ci++) {
    if (validate(candidates[ci])) { parse = candidates[ci]; break; }
  }
  var supported = !!parse;

  function lunarOf(date) {
    if (!supported) return null;
    return parse(startOfDay(date));
  }

  // ---------- 农历年索引表 ----------
  var cache = {};

  function keyOf(month, day, isLeap) {
    return month + '/' + day + '/' + (isLeap ? 'L' : 'N');
  }
  function monthKeyOf(month, isLeap) {
    return month + '/' + (isLeap ? 'L' : 'N');
  }

  // 定位农历 year 年的正月初一（春节落在公历 1/21 ~ 2/21 之间）
  function springFestival(year) {
    var d = new Date(year, 0, 10);
    for (var i = 0; i < 70; i++) {
      var r = lunarOf(d);
      if (r && r.month === 1 && r.day === 1 && !r.isLeap) return d;
      d = addDays(d, 1);
    }
    return null;
  }

  // 返回 { dates: {key: Date}, maxDay: {monthKey: n}, hasLeap: {month: true} }
  function yearTable(year) {
    if (cache[year]) return cache[year];
    if (!supported) return null;
    var start = springFestival(year);
    if (!start) return null;

    var table = { dates: {}, maxDay: {}, hasLeap: {}, start: start };
    var c = start;
    for (var i = 0; i < 400; i++) {
      var r = lunarOf(c);
      if (!r) break;
      if (i > 0 && r.month === 1 && r.day === 1 && !r.isLeap) break; // 已进入下一农历年
      var k = keyOf(r.month, r.day, r.isLeap);
      if (!table.dates[k]) table.dates[k] = c;
      var mk = monthKeyOf(r.month, r.isLeap);
      if (!table.maxDay[mk] || table.maxDay[mk] < r.day) table.maxDay[mk] = r.day;
      if (r.isLeap) table.hasLeap[r.month] = true;
      c = addDays(c, 1);
    }
    cache[year] = table;
    return table;
  }

  /**
   * 农历 -> 公历：求农历 year 年 month 月 day 日对应的公历日期。
   * 容错规则（与 iOS 原生版一致）：
   *   1. 该年没有这个闰月 -> 退回同名的普通月
   *   2. 该月是小月（只有廿九）而生日是三十 -> 退回廿九
   */
  function solve(year, month, day, isLeap) {
    var t = yearTable(year);
    if (!t) return null;

    var wantLeap = !!isLeap;
    if (wantLeap && !t.hasLeap[month]) wantLeap = false; // 规则 1

    var max = t.maxDay[monthKeyOf(month, wantLeap)];
    if (!max) {
      if (wantLeap) { wantLeap = false; max = t.maxDay[monthKeyOf(month, false)]; }
      if (!max) return null;
    }
    var d = Math.min(day, max); // 规则 2
    return t.dates[keyOf(month, d, wantLeap)] || null;
  }

  /** 从今天起，算农历生日的下一次（含今天）公历日期 */
  function nextLunarOccurrence(month, day, isLeap, from) {
    var today = startOfDay(from || new Date());
    var y = today.getFullYear();
    // 从 y-1 开始：公历 1 月初时农历年仍停留在上一年（春节未到），
    // 此时「农历 y-1 年的腊月生日」可能仍在未来，不能漏掉。
    for (var i = -1; i <= 3; i++) {
      var d = solve(y + i, month, day, isLeap);
      if (d && daysBetween(today, d) >= 0) return d;
    }
    return null;
  }

  /** 从今天起，算公历生日的下一次（含今天）日期 */
  function nextSolarOccurrence(month, day, from) {
    var today = startOfDay(from || new Date());
    var y = today.getFullYear();
    for (var i = 0; i <= 2; i++) {
      var yy = y + i;
      var last = new Date(yy, month, 0).getDate(); // 处理 2/29
      var d = new Date(yy, month - 1, Math.min(day, last));
      if (daysBetween(today, d) >= 0) return d;
    }
    return null;
  }

  function formatLunar(month, day, isLeap) {
    var m = MONTH_NAMES[month - 1] || month;
    var dd = DAY_NAMES[day - 1] || day;
    return (isLeap ? '闰' : '') + m + '月' + dd;
  }

  function zodiacOf(lunarYear) {
    return ZODIAC[((lunarYear - 4) % 12 + 12) % 12];
  }

  /** 公历日期所属的农历年份（按春节划界） */
  function lunarYearOf(date) {
    var d = startOfDay(date);
    var y = d.getFullYear();
    var sf = springFestival(y);
    if (sf && daysBetween(sf, d) < 0) return y - 1;
    return y;
  }

  global.Lunar = {
    supported: supported,
    MONTH_NAMES: MONTH_NAMES,
    DAY_NAMES: DAY_NAMES,
    ZODIAC: ZODIAC,
    startOfDay: startOfDay,
    addDays: addDays,
    daysBetween: daysBetween,
    ymd: ymd,
    lunarOf: lunarOf,
    yearTable: yearTable,
    solve: solve,
    nextLunarOccurrence: nextLunarOccurrence,
    nextSolarOccurrence: nextSolarOccurrence,
    formatLunar: formatLunar,
    zodiacOf: zodiacOf,
    lunarYearOf: lunarYearOf,
    keyOf: keyOf,
    monthKeyOf: monthKeyOf,
    springFestival: springFestival
  };
})(typeof window !== 'undefined' ? window : globalThis);