# 生日记录 · 网页版（PWA）

以**农历为主**记录亲友生日，自动算出下一年对应的公历日期、显示倒计时，并可一键写入 iPhone 系统日历。

加到 iPhone 主屏幕后，图标、启动画面、离线使用都和原生 App 一样，**不需要证书、不需要电脑、永不过期**。

---

## 一、文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架（含 PWA 相关 meta） |
| `styles.css` | 样式（渐变配色、倒计时环、底部弹窗、深色模式、刘海屏适配） |
| `lunar.js` | 农历换算引擎 |
| `app.js` | 主逻辑：增删改、分组列表、倒计时、ics 导出、备份 |
| `sw.js` | Service Worker，实现离线可用 |
| `manifest.webmanifest` | PWA 清单（图标、主题色、独立窗口模式） |
| `icons/` | 180 / 192 / 512 / 1024 四种尺寸图标 |
| `_dom_stub.js`、`_test_app.js`、`_test_lunar.js`、`_syntax_check.js` | 开发期自测脚本，**部署时可以删掉** |

### 农历是怎么算的

没有内置农历数据表，而是直接调用系统自带的 ICU 农历数据：

```js
new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { ... })
```

这和 iOS 原生 `Calendar(identifier: .chinese)` 用的是**同一份数据**，所以结果与系统日历完全一致，也不存在"数据表只到 2049 年"的问题。

脚本加载时会用 5 个已知样本自检（含 2023 年闰二月），自检不通过会在设置页提示"农历不可用"。

已覆盖的边界情况：

- **闰月**：可勾选"闰月"。若某年没有这个闰月，自动落到同名的普通月。
- **三十日**：农历小月没有三十，自动落到廿九。
- **公历 2 月 29 日**：非闰年自动落到 2 月 28 日。

---

## 二、在 iPhone 上安装（添加到主屏幕）

1. 用 **Safari** 打开网址（必须是 Safari，Chrome/微信里装不了）。
2. 点底部中间的**分享**按钮（方框向上箭头）。
3. 向下滑，选**添加到主屏幕**。
4. 右上角**添加**。

主屏幕上就会出现"生日记录"图标，点开是全屏无地址栏的独立窗口。

> 数据存在手机本地（localStorage），不上传任何服务器。**删除图标或清理 Safari 数据会丢数据，建议定期用设置里的"导出备份"存一份到"文件"App 或微信收藏。**

---

## 三、加入系统日历（获得通知提醒）

网页本身不能发系统推送，所以用"写入日历"的方式实现提醒——**写进去之后就由 iOS 日历负责提醒，网页不用开着**。

1. 在 App 里点右上角**日历**按钮（单条记录也可以在详情页点"加入日历"）。
2. 弹出分享面板 → 选**日历**（或先存到"文件"再点开）。
3. 日历 App 会显示事件列表 → 右上角**添加全部**。

说明：

- 每条生日按年展开成**全天事件**，默认写 5 年（设置里可改 3 / 5 / 10 / 20 年）。
- 每个事件自带提醒：设为"当天"是当天 9:00，设为"提前 N 天"是提前 N 天的 9:00。
- 因为农历每年对应的公历日期不同，所以**不能用重复规则**，只能逐年写入。写入的年份用完后，再导出一次即可。
- 重复导入同一年不会产生重复事件（事件 UID 固定）。

---

## 四、免费部署成一个永久网址

Service Worker（离线能力）要求 **HTTPS**。下面两种都免费且自带 HTTPS。

### 方式 A：GitHub Pages

1. 新建一个 GitHub 仓库，例如 `birthday-record`。
2. 把 `BirthdayPWA` 里的文件**全部上传到仓库根目录**（注意是文件本身，不要多一层目录）。
3. 仓库 → Settings → Pages → Source 选 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)` → Save。
4. 等 1～2 分钟，访问 `https://你的用户名.github.io/birthday-record/`。

> 如果放在子目录下（上面这种带仓库名的路径），`manifest.webmanifest` 里的 `start_url` 和 `scope` 保持相对路径即可，无需改动。

### 方式 B：Vercel（更快，可绑自己的域名）

1. 打开 vercel.com 用 GitHub 登录 → Add New → Project → 选上面那个仓库。
2. Framework Preset 选 **Other**，Build Command 和 Output Directory 都留空 → Deploy。
3. 得到 `https://xxx.vercel.app`。

### 方式 C：局域网临时试用（不部署）

在这台 Mac 上执行：

```bash
cd BirthdayPWA
python3 -m http.server 8765 --bind 0.0.0.0
```

iPhone 连**同一个 WiFi**，Safari 打开 `http://这台Mac的IP:8765/`。

当前这台机器的地址是：**http://10.253.72.193:8765/**（IP 可能随网络变化，用 `ipconfig getifaddr en0` 重新查）

> http 下 Service Worker 不生效（离线用不了），但添加到主屏幕、农历计算、导出 ics 都能正常测。正式用请走 A 或 B。

---

## 五、更新版本

改了代码后，请把 `sw.js` 里的这一行版本号加一：

```js
var CACHE = 'birthday-record-v1';   // 改成 v2、v3 ...
```

否则手机上会一直用旧的缓存。改完重新部署，再把主屏幕上的 App 关掉重开即可。

---

## 六、本地自测（可选）

本机没有 Node，用 macOS 自带的 JavaScriptCore 跑：

```bash
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

# 农历引擎测试
$JSC lunar.js _test_lunar.js

# 主逻辑端到端测试（ICS 结构、列表渲染）
$JSC lunar.js _dom_stub.js app.js _test_app.js

# 语法检查
$JSC _syntax_check.js
```