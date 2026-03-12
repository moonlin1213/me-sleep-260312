# 疗愈网页设备指纹验证实现记录

## 实现时间
2026-03-11 22:25

## Moon 确认
使用 **localStorage + 设备指纹双重验证** 方案

## 修改文件

### 1. 新增文件

#### `deviceAuth.ts`
设备指纹和验证工具模块

**核心功能**：
- `generateDeviceFingerprint()`: 生成设备指纹
  - 使用稳定信息：屏幕分辨率、语言、时区、CPU 核心数、Canvas 指纹
  - 不使用容易变化的信息（userAgent）
  - 使用 SHA-256 哈希

- `registerDevice(openid, fingerprint)`: 注册新设备
  - 调用后端 `/api/register-device`
  - 存储 openid + 设备指纹

- `verifyDevice(openid, fingerprint)`: 验证设备
  - 调用后端 `/api/verify-device`
  - 验证设备指纹 + 订阅状态

- `initHealingPage()`: 初始化疗愈网页
  - 从 localStorage 读取 openid + 设备指纹
  - 验证设备指纹是否匹配
  - 如果没有，从 URL 获取 openid
  - 注册新设备
  - 清除 URL 参数

### 2. 修改文件

#### `App.tsx`
添加设备验证逻辑

**修改点**：
1. 导入 `initHealingPage` 函数
2. 添加状态：
   - `deviceVerified`: 设备是否验证成功
   - `deviceError`: 设备验证错误信息

3. 修改初始化逻辑（`useEffect`）：
   - 首先调用 `initHealingPage()` 验证设备
   - 如果验证失败，显示错误提示
   - 如果验证成功，将 openid 存储为 `user_id`（兼容现有逻辑）
   - 继续原有初始化流程

4. 添加设备验证失败 UI：
   - 显示错误提示
   - 提供「打开小程序」按钮

#### `.env.local`
添加 API 基础 URL 配置

```
REACT_APP_API_URL=http://localhost:3000
```

**生产环境需要修改为**：
```
REACT_APP_API_URL=https://api.memjoy.com
```

---

## 工作流程

### 用户首次访问

1. 小程序跳转到疗愈网页：`https://healing.memjoy.com?openid=xxx`
2. 疗愈网页加载，调用 `initHealingPage()`
3. 生成设备指纹
4. 从 URL 获取 openid
5. 调用后端 `/api/register-device` 注册设备
6. 存储 `{ openid, fingerprint }` 到 localStorage
7. 清除 URL 参数（防止分享时泄露）
8. 继续正常流程

### 用户后续访问

1. 用户点击桌面图标，打开 `https://healing.memjoy.com`（不带参数）
2. 疗愈网页加载，调用 `initHealingPage()`
3. 生成当前设备指纹
4. 从 localStorage 读取 `{ openid, fingerprint }`
5. 验证设备指纹是否匹配
6. 如果匹配，调用后端 `/api/verify-device` 验证设备和订阅状态
7. 如果验证成功，继续正常流程

### 设备验证失败

1. 显示错误提示：「为了保护你的账号安全，请从小程序打开」
2. 提供「打开小程序」按钮
3. 点击按钮跳转到小程序

---

## 安全性

### 为什么不加密 localStorage？

1. **localStorage 本身是安全的**：
   - 只能被同源的 JavaScript 读取
   - 如果攻击者能执行 JavaScript，说明网站已经被 XSS 攻击了
   - 这种情况下，任何存储方式（cookie、sessionStorage、加密）都不安全

2. **设备指纹已经提供了足够的保护**：
   - 即使攻击者获取了 localStorage 里的 openid
   - 攻击者的设备指纹不匹配，后端会拒绝请求

3. **加密会增加复杂度**：
   - 需要引入加密库（CryptoJS）
   - 需要管理加密密钥
   - 对于疗愈音频这种低风险场景，不值得

**结论**：不需要加密 localStorage，设备指纹验证已经足够安全。

---

## 边界情况

### 1. 用户清除浏览器数据

**场景**：
- 用户在手机 A 上已经授权过，保存了桌面图标
- 用户清除了浏览器数据（localStorage 被清空）
- 用户点击桌面图标，打开疗愈网页

**会发生什么**：
- localStorage 里没有数据 → 提示「请从小程序重新打开」

**用户体验**：
- 用户需要重新打开小程序，重新授权一次
- 然后重新保存桌面图标

**频率**：很低（大部分用户不会主动清除浏览器数据）

### 2. 用户更新浏览器或系统

**场景**：
- 用户在手机 A 上已经授权过
- 用户更新了浏览器或系统（比如 iOS 升级）

**会发生什么**：
- 设备指纹稳定（因为不用 userAgent），不需要重新授权

**用户体验**：无感知，继续使用

### 3. 用户换手机

**场景**：
- 用户换到手机 B

**会发生什么**：
- 设备指纹不匹配 → 提示「请从小程序重新打开」

**用户体验**：
- 用户需要在新手机上打开小程序，重新授权一次
- 然后保存桌面图标

**频率**：低（用户换手机频率低）

### 4. 用户在同一设备的不同浏览器

**场景**：
- 用户在手机 A 的微信浏览器里授权过
- 用户在手机 A 的 Safari 浏览器里打开疗愈网页

**会发生什么**：
- 不同浏览器的 localStorage 是隔离的 → 提示「请从小程序重新打开」

**用户体验**：
- 用户需要在 Safari 里重新授权一次
- 这是合理的（因为不同浏览器确实是不同的"设备"）

---

## 测试建议

### 测试场景 1：首次访问

1. 清空 localStorage
2. 访问 `http://localhost:5173?openid=test_openid_123`
3. 应该看到：
   - 控制台输出：设备注册成功
   - URL 参数被清除
   - 正常进入疗愈流程

### 测试场景 2：后续访问

1. 访问 `http://localhost:5173`（不带参数）
2. 应该看到：
   - 控制台输出：设备验证成功
   - 正常进入疗愈流程

### 测试场景 3：设备验证失败

1. 清空 localStorage
2. 访问 `http://localhost:5173`（不带参数）
3. 应该看到：
   - 错误提示：「为了保护你的账号安全，请从小程序打开」
   - 「打开小程序」按钮

### 测试场景 4：设备指纹不匹配

1. 修改 localStorage 里的 fingerprint
2. 访问 `http://localhost:5173`（不带参数）
3. 应该看到：
   - 控制台输出：设备指纹不匹配
   - 错误提示：「请从小程序打开」

---

## 部署注意事项

### 1. 修改 API 基础 URL

生产环境需要修改 `.env.local`：
```
REACT_APP_API_URL=https://api.memjoy.com
```

或者在构建时传入环境变量：
```bash
REACT_APP_API_URL=https://api.memjoy.com npm run build
```

### 2. 后端 CORS 配置

确保后端允许疗愈网页的域名：
```javascript
app.use(cors({
  origin: [
    'https://healing.memjoy.com',
    'http://localhost:5173'  // 开发环境
  ],
  credentials: true
}));
```

### 3. HTTPS

生产环境必须使用 HTTPS，否则：
- Web Crypto API 不可用（无法生成 SHA-256 哈希）
- localStorage 不安全

---

## 相关文档

- `HEALING-WEBPAGE-DEVICE-FINGERPRINT.md`: 详细实现指南
- `OPENID-LOCALSTORAGE-DECISION.md`: Moon 的最终决策
- `OPENID-SOLUTION-COMPARISON.md`: 方案对比

---

## 更新日志

- 2026-03-11 22:25: 前端实现完成
  - 创建 `deviceAuth.ts` 工具模块
  - 修改 `App.tsx` 添加设备验证逻辑
  - 添加设备验证失败 UI
  - 配置 API 基础 URL
