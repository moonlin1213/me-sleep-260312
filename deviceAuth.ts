/**
 * 设备指纹和验证工具
 * Moon 确认：使用 localStorage + 设备指纹双重验证
 */

// API 基础 URL（根据环境调整）
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

/**
 * 生成 Canvas 指纹（最稳定）
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'canvas-not-supported';
    
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('MEM JOY', 2, 2);
    return canvas.toDataURL();
  } catch (e) {
    return 'canvas-not-supported';
  }
}

/**
 * SHA-256 哈希
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成设备指纹
 * 司天监建议：使用稳定的信息，不用 userAgent
 */
export async function generateDeviceFingerprint(): Promise<string> {
  const components = [
    screen.width + 'x' + screen.height,
    navigator.language,
    new Date().getTimezoneOffset().toString(),
    (navigator.hardwareConcurrency || 0).toString(),
    getCanvasFingerprint()
  ];
  
  return await sha256(components.join('|'));
}

/**
 * 注册设备
 */
export async function registerDevice(openid: string, fingerprint: string): Promise<boolean> {
  try {
    const deviceName = getDeviceName();
    
    const response = await fetch(`${API_BASE_URL}/api/register-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        openid, 
        deviceFingerprint: fingerprint,
        deviceName
      })
    });
    
    const result = await response.json();
    
    if (result.code === 200) {
      console.log('[Device] 设备注册成功');
      return true;
    } else {
      console.error('[Device] 设备注册失败:', result.msg);
      return false;
    }
  } catch (error) {
    console.error('[Device] 注册设备时出错:', error);
    return false;
  }
}

/**
 * 验证设备
 */
export async function verifyDevice(openid: string, fingerprint: string): Promise<{
  valid: boolean;
  plan?: string;
  entitled_until?: string;
}> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/verify-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openid, deviceFingerprint: fingerprint })
    });
    
    const result = await response.json();
    
    if (result.code === 200) {
      console.log('[Device] 设备验证成功');
      return { valid: true, ...result.data };
    } else {
      console.error('[Device] 设备验证失败:', result.msg);
      return { valid: false };
    }
  } catch (error) {
    console.error('[Device] 验证设备时出错:', error);
    return { valid: false };
  }
}

/**
 * 获取设备名称（可选）
 */
function getDeviceName(): string {
  const ua = navigator.userAgent;
  
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(ua)) return 'Mac';
  
  return 'Unknown';
}

/**
 * 初始化疗愈网页
 * 返回 openid 或 null
 */
export async function initHealingPage(): Promise<string | null> {
  console.log('[Device] 初始化疗愈网页...');
  
  // 1. 生成当前设备指纹
  const currentFingerprint = await generateDeviceFingerprint();
  console.log('[Device] 设备指纹:', currentFingerprint.substring(0, 16) + '...');
  
  // 2. 尝试从 localStorage 读取
  const stored = localStorage.getItem('memjoy_auth');
  
  if (stored) {
    try {
      const { openid, fingerprint } = JSON.parse(stored);
      
      // 3. 验证设备指纹
      if (fingerprint === currentFingerprint) {
        console.log('[Device] 设备指纹匹配，验证中...');
        
        // 验证 openid 和设备是否有效
        const result = await verifyDevice(openid, fingerprint);
        
        if (result.valid) {
          console.log('[Device] 设备验证成功，openid:', openid);
          return openid;
        } else {
          console.log('[Device] 设备验证失败');
        }
      } else {
        console.log('[Device] 设备指纹不匹配，需要重新授权');
      }
    } catch (e) {
      console.error('[Device] localStorage 数据损坏', e);
    }
  }
  
  // 4. 如果 localStorage 没有或验证失败，从 URL 获取
  const urlParams = new URLSearchParams(window.location.search);
  const openid = urlParams.get('openid');
  
  if (openid) {
    console.log('[Device] 从 URL 获取 openid:', openid);
    
    // 5. 注册新设备
    const registered = await registerDevice(openid, currentFingerprint);
    
    if (registered) {
      // 6. 存到 localStorage
      localStorage.setItem('memjoy_auth', JSON.stringify({
        openid,
        fingerprint: currentFingerprint
      }));
      
      // 7. 清除 URL 参数（防止分享时泄露）
      window.history.replaceState({}, '', window.location.pathname);
      
      console.log('[Device] 新设备注册成功');
      
      // 8. 显示「添加到主屏幕」引导（如果是首次）
      showAddToHomeScreenGuide();
      
      return openid;
    }
  }
  
  // 9. 都没有，返回 null
  console.log('[Device] 无法获取 openid，需要从小程序打开');
  return null;
}

/**
 * 显示「添加到主屏幕」引导
 */
function showAddToHomeScreenGuide() {
  // 检查是否已经显示过
  if (localStorage.getItem('memjoy_guide_shown')) {
    return;
  }
  
  // 标记已显示（避免每次都弹出）
  localStorage.setItem('memjoy_guide_shown', 'true');
  
  // 这里可以显示一个引导弹窗
  // 具体 UI 由 App.tsx 实现
  console.log('[Device] 首次访问，应该显示「添加到主屏幕」引导');
}
