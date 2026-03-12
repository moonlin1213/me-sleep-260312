import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ParticleBackground from './components/ParticleBackground';
import { AppState, Question } from './types';
import { QUESTIONS, LOGO_SVG, COLORS } from './constants';
import { initHealingPage } from './deviceAuth';

type FlowQuestion = Question & {
  key?: 'onboarding_greet' | 'nickname' | 'user_id' | 'voice_preference' | 'onboarding_ready';
  required?: boolean;
  placeholder?: string;
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.WELCOME);
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [blurOut, setBlurOut] = useState(false);

  // ✅ 首次登录不要闪到"Hi 你回来了…"
  const [displayText, setDisplayText] = useState("");

  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [userInput, setUserInput] = useState("");

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // === 设备验证状态 ===
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [showCustomAlert, setShowCustomAlert] = useState(false);

  // === Processing UI: progress + ETA + rotating soothing lines ===
  const [progress, setProgress] = useState(0); // 0-100
  const [etaSec, setEtaSec] = useState<number | null>(null);

  // ✅ 轮换语句：用 keyframes + key(remount) 解决手机端叠字
  const [sootheLine, setSootheLine] = useState("");
  const [sootheIndex, setSootheIndex] = useState(0);
  const [sootheKey, setSootheKey] = useState(0);

  // 你可以随时替换/增减这些句子
  const SOOTHE_LINES = useMemo(() => ([
    "你的需要已经被听到",
    "先慢慢呼吸 我们一起把今天放下",
    "你已经很努力了 允许自己停靠一会儿",
    "不急 只慢慢呼吸",
    "让身体松一点点就好",
    "此刻 你是安全的",
    "你不是一个人 我们在这里",
    "把重的交给我 你只要休息",
  ]), []);

  // Audio State
  const [audioProgress, setAudioProgress] = useState(0); // 0 to 1
  const [playbackStatus, setPlaybackStatus] = useState<'playing' | 'paused' | 'stopped'>('stopped');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // === Make Webhook URLs ===
  const SCENARIO_A_URL = "https://hook.us2.make.com/aj0rqt7tmk8lxrs75al61glpo3ffrt2e";
  const SCENARIO_C_URL = "https://hook.us2.make.com/c2qu8v01c7msajoinn3nnogmnxcvmf5o";

  // === 你问卷里的选项映射：显示文案 -> 后台 mood code ===
  const MOOD_MAP: Record<string, 'fine' | 'anxiety' | 'tired' | 'emo'> = {
    "不错": "fine",
    "还可以": "fine",
    "紧绷焦虑": "anxiety",
    "很累": "tired",
    "情绪低落": "emo",
  };

  // === 本地保存：所有题的答案都保留，最终一起发给 Make ===
  const [answers, setAnswers] = useState<Record<string, any>>({});

  // ====== LocalStorage Keys（不影响 UI，仅做持久化/限次）======
  const LS_NICKNAME = "healing_nickname";
  const LS_USER_ID = "healing_user_id";
  const LS_VOICE_PREF = "healing_voice_preference"; // "male" | "female"
  const LS_LAST_AUDIO_URL = "healing_last_audio_url";
  const LS_LAST_CYCLE_KEY = "healing_last_cycle_key";
  const LS_PROFILE_DONE = "healing_profile_done";

  // 本地 20:00 分界：20:00 前属于"上一天周期"，20:00 后属于"当天周期"
  const getCycleKey = (d0 = new Date()) => {
    const d = new Date(d0);
    if (d.getHours() < 20) d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const normalizeVoicePref = (v: any): "male" | "female" => {
    const s = (v ?? "").toString().trim().toLowerCase();
    return s === "female" ? "female" : "male";
  };

  const normalizeMood = (m: any): "fine" | "anxiety" | "tired" | "emo" => {
    const s = (m ?? "").toString().trim().toLowerCase();
    if (s === "anxiety" || s === "tired" || s === "emo" || s === "fine") return s;
    return "fine";
  };

  // ====== Onboarding Flow（只首次出现，不改现有 UI 风格）======
  const [isOnboarding, setIsOnboarding] = useState(false);

  // ✅ 只把"今天感觉怎么样？"强制单选（不改 constants，不改 UI）
  const QUESTIONS_PATCHED = useMemo(() => {
    if (!QUESTIONS || QUESTIONS.length === 0) return QUESTIONS;
    const q0 = { ...QUESTIONS[0], multi: false };
    return [q0, ...QUESTIONS.slice(1)];
  }, []);

  // ✅ 按你要求拆成：欢迎页 -> 昵称页 -> 微信ID页 -> 声音页(手动继续) -> 准备开始页
  const ONBOARDING_QUESTIONS: FlowQuestion[] = useMemo(() => ([

    {
      q: "希望我怎样称呼你呢？",
      isText: true,
      multi: false,
      key: "nickname",
      required: true,
      placeholder: "以后我都会这样称呼你",
    },
    {
      q: "现在 我们来建立\n专属于你的疗愈空间",
      isText: true,
      multi: false,
      key: "user_id",
      required: true,
      placeholder: "请写下你的微信ID 或 手机号",
    },
    {
      q: "希望我以什么声音陪伴你？",
      isText: false,
      multi: false,
      opts: ["男声", "女声"],
      key: "voice_preference",
      required: true,
    },
    {
      q: "那么 我们\n开始今天的疗愈吧",
      isText: false,
      multi: false,
      opts: [], // 不显示选项，只显示"继续"按钮
      key: "onboarding_ready",
      required: true,
    },
  ]), []);

  const FLOW: FlowQuestion[] = useMemo(() => {
    return isOnboarding
      ? [...ONBOARDING_QUESTIONS, ...(QUESTIONS_PATCHED as FlowQuestion[])]
      : (QUESTIONS_PATCHED as FlowQuestion[]);
  }, [isOnboarding, ONBOARDING_QUESTIONS, QUESTIONS_PATCHED]);

  // 初始化：判断首次登录 & 每日 20:00 限次（同周期内有音频就直接跳播放页）
  useEffect(() => {
    const init = async () => {
      // === 1. 设备验证（Moon 确认：localStorage + 设备指纹双重验证）===
      console.log('[App] 开始设备验证...');
      const openid = await initHealingPage();
      
      if (!openid) {
        // 设备验证失败，显示错误提示
        setDeviceError('请从小程序打开');
        setDeviceVerified(false);
        return;
      }
      
      // 设备验证成功
      console.log('[App] 设备验证成功，openid:', openid);
      setDeviceVerified(true);
      
      // 将 openid 存储为 user_id（兼容现有逻辑）
      localStorage.setItem(LS_USER_ID, openid);
      
      // === 2. 原有初始化逻辑 ===
      const storedNickname = (localStorage.getItem(LS_NICKNAME) || "").trim();
      const storedUserId = openid; // 使用验证后的 openid
      const storedVoicePref = (localStorage.getItem(LS_VOICE_PREF) || "").trim();
      const profileDone = (localStorage.getItem(LS_PROFILE_DONE) || "").trim();

      const hasProfile = !!storedNickname && !!storedUserId && !!storedVoicePref && profileDone === "1";

      // ✅ 每日限次：如果本周期已经生成过，就直接跳到音频播放页
      const cycleKeyNow = getCycleKey(new Date());
      const lastCycleKey = (localStorage.getItem(LS_LAST_CYCLE_KEY) || "").trim();
      const lastAudio = (localStorage.getItem(LS_LAST_AUDIO_URL) || "").trim();

      if (hasProfile && lastCycleKey === cycleKeyNow && lastAudio) {
        setAudioUrl(lastAudio);
        setAppState(AppState.GOODNIGHT);
        setDisplayText("");
        setVisible(true);
        setBlurOut(false);
        return;
      }

      // 首次使用：走 onboarding；否则走原流程
      setIsOnboarding(!hasProfile);

      // ✅ 先把 displayText 设置好，避免闪现"Hi 你回来了…"
      if (!hasProfile) {
      // ✅ 首次：只展示一句欢迎语（不进入题目流）
      setDisplayText("Hi 很高兴看到你来了");
      } else {
      setDisplayText("Hi 你回来了 今天还好吗？");
      }

      await sleep(1000);
      setVisible(true);
      await sleep(4000);
      setBlurOut(true);
      await sleep(2200);

      setAppState(AppState.QUESTIONS);
      setCurrentStep(0);

      if (!hasProfile) {
        setDisplayText(ONBOARDING_QUESTIONS[0].q); // ✅ 现在这就是"希望我怎样称呼你呢？"
      } else {
        setDisplayText((QUESTIONS_PATCHED as any)[0].q);
      }

      setBlurOut(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync audio progress and handle events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setAudioProgress(audio.currentTime / audio.duration);
      }
    };

    const handleEnded = () => {
      setPlaybackStatus('stopped');
      setAudioProgress(0);
    };

    const handleError = (e: any) => {
      if (audio.src && audio.src !== window.location.href) {
        console.error("Audio playback error:", e);
      }
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  // === Processing animation logic ===
  useEffect(() => {
    if (appState !== AppState.PROCESSING) return;

    // 预估总耗时（秒）：你可以根据你实际平均生成时间调整
    const EXPECT_TOTAL_SEC = 180;
    const start = Date.now();

    // 1) 进度条：平滑推进到 95%
    const tick = () => {
      const elapsedSec = (Date.now() - start) / 1000;
      const ratio = Math.min(elapsedSec / EXPECT_TOTAL_SEC, 1);
      const eased = 1 - Math.pow(1 - ratio, 3); // easeOutCubic

      const p = Math.min(95, Math.max(3, Math.round(eased * 95)));
      setProgress(p);

      const remain = Math.max(1, Math.round(EXPECT_TOTAL_SEC * (1 - eased)));
      setEtaSec(remain);
    };

    tick();
    const timer = window.setInterval(tick, 300);

    // 2) ✅ 轮换语句：递归 setTimeout + 每次 remount（解决手机端叠字）
    let alive = true;
    let t: number | undefined;

    const ROTATE_MS = 6000; // 每句总时长（要和 sootheOne 的 6000ms 对齐）

    // 初始化第一句
    setSootheIndex(0);
    setSootheLine(SOOTHE_LINES[0] ?? "你的需要已经被听到...");
    setSootheKey(k => k + 1);

    const next = () => {
      if (!alive) return;
      t = window.setTimeout(() => {
        if (!alive) return;
        setSootheIndex(prev => {
          const ni = (prev + 1) % SOOTHE_LINES.length;
          setSootheLine(SOOTHE_LINES[ni]);
          setSootheKey(k => k + 1); // ✅ 强制重建 DOM，手机端不叠
          return ni;
        });
        next();
      }, ROTATE_MS);
    };

    next();

    return () => {
      alive = false;
      if (t) window.clearTimeout(t);
      window.clearInterval(timer);
    };
  }, [appState, SOOTHE_LINES]);

  // === 工具：读取 body（尽量解析 JSON；解析不了就返回 null + raw）===
  const readJsonOrNull = async (res: Response) => {
    const raw = await res.text().catch(() => "");
    if (!raw) return { json: null as any, raw: "" };
    try {
      return { json: JSON.parse(raw), raw };
    } catch {
      return { json: null as any, raw };
    }
  };

  // 小抖动（避免所有客户端同频轮询）
  const jitter = () => Math.floor(Math.random() * 800);

  // fetch 超时
  const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController();
    const id = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(id);
    }
  };

  // === 核心：提交问卷 -> A 拿 task_id ->（A 内部触发 B 生成）-> 轮询 C 拿 audio_url ===
  const runHealingPipeline = useCallback(async (payload: any) => {
    // 1) A：创建任务（写入 daily results + 返回 task_id）
    const resA = await fetch(SCENARIO_A_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const { json: dataA, raw: rawA } = await readJsonOrNull(resA);

    if (!resA.ok || !dataA || !dataA.task_id) {
      throw new Error(`A webhook invalid response. HTTP=${resA.status} Raw=${rawA.slice(0, 300)}`);
    }

    const taskId: string = dataA.task_id;

    // 2) C：三次查询（省成本）：120s / 150s / 188s 各查一次
    const start = Date.now();
    const timeoutMs = 190000;

    // ✅ 三次查询点（ms）
    const checkpoints = [120000, 150000, 188000];

    for (let i = 0; i < checkpoints.length; i++) {
      // 等到下一次查询点
      const target = start + checkpoints[i];
      const waitMs = Math.max(0, target - Date.now());
      if (waitMs > 0) await sleep(waitMs);

      // 超时保护（理论上最后一次 188s 后还会走到这里，但不应该超过 190s）
      if (Date.now() - start > timeoutMs) {
          throw new Error("讯息传到另一个时空了，再试一次吧");
      }

      try {
        // ✅ 给每次 C 查询单独超时（避免卡死）
        const resC = await fetchWithTimeout(
          SCENARIO_C_URL,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: taskId }),
          },
          6000
        );

        const { json: dataC } = await readJsonOrNull(resC);

        // C 偶尔可能返回空/非 JSON（比如 "Accepted"），直接进入下一次检查点
        if (!resC.ok || !dataC) {
          continue;
        }

        const status = dataC.status;

        if (status === "done" && dataC.audio_url) {
          return { audio_url: dataC.audio_url, task_id: taskId };
        }

        if (status === "error") {
          throw new Error(dataC.error || "讯息传到另一个时空了，再试一次吧");
        }

        // processing / accepted / 其他：不做任何事，等下一次检查点
      } catch (e) {
        // 网络偶发断开/跨域/连接重置 → 这次就当没查到，等下一次检查点
        continue;
      }
    }

    // 三次都没拿到 → 判定异常（190s 的保险窗口）
    throw new Error("讯息传到另一个时空了，再试一次吧");

  }, [SCENARIO_A_URL, SCENARIO_C_URL]);

  const handleNext = useCallback(async () => {
    const isLastQuestion = currentStep === FLOW.length - 1;
    const currentQ = FLOW[currentStep] as FlowQuestion;

    const nextAnswers = { ...answers };

    // ===== Onboarding 写入 + 持久化（不影响原 UI）=====
    if (isOnboarding && currentQ.key) {
      const k = currentQ.key;

      if (k === "nickname") {
        const v = (userInput || "").trim();
        nextAnswers["nickname"] = v;
        localStorage.setItem(LS_NICKNAME, v);
      }

      if (k === "user_id") {
        const v = (userInput || "").trim();
        nextAnswers["user_id"] = v;
        localStorage.setItem(LS_USER_ID, v);
      }

      if (k === "voice_preference") {
        const pick = Array.from(selectedOptions)[0] ?? "";
        const vp = pick === "女声" ? "female" : "male";
        nextAnswers["voice_preference"] = vp;
        localStorage.setItem(LS_VOICE_PREF, vp);
      }

      if (k === "onboarding_ready") {
        // 完成 onboarding
        localStorage.setItem(LS_PROFILE_DONE, "1");
      }

      setAnswers(nextAnswers);

      setBlurOut(true);
      await sleep(2000);

      if (!isLastQuestion) {
        const nextIdx = currentStep + 1;
        setCurrentStep(nextIdx);
        setDisplayText(FLOW[nextIdx].q);
        setSelectedOptions(new Set());
        setUserInput("");
        setBlurOut(false);
        return;
      }
    }

    // ====== 原问卷逻辑（基于 FLOW，不改 UI）======
    if (currentQ.isText) {
      nextAnswers["note"] = userInput || "";
    } else {
      const optsArr = Array.from(selectedOptions);
      nextAnswers[`q_${currentStep}`] = currentQ.multi ? optsArr : (optsArr[0] ?? "");

      // 如果是第一题：mood（FLOW 里 mood 题在 onboarding 之后的第一题）
      const moodIndexInFlow = isOnboarding ? ONBOARDING_QUESTIONS.length : 0;
      if (currentStep === moodIndexInFlow) {
        const rawMood = (optsArr[0] ?? "");
        nextAnswers["mood_raw"] = rawMood;
        nextAnswers["mood"] = MOOD_MAP[rawMood] || rawMood;
      }

      // 如果是第二题：body_tension
      if (currentStep === moodIndexInFlow + 1) {
        nextAnswers["body_tension"] = currentQ.multi ? optsArr : (optsArr[0] ?? "");
      }
    }

    setAnswers(nextAnswers);

    setBlurOut(true);
    await sleep(2000);

    if (!isLastQuestion) {
      const nextIdx = currentStep + 1;
      setCurrentStep(nextIdx);
      setDisplayText(FLOW[nextIdx].q);
      setSelectedOptions(new Set());
      setUserInput("");
      setBlurOut(false);
      return;
    }

    // ====== 20:00 限次：最后一题准备生成前先检查本周期是否已生成 ======
    const cycleKeyNow = getCycleKey(new Date());
    const lastCycleKey = (localStorage.getItem(LS_LAST_CYCLE_KEY) || "").trim();
    const lastAudio = (localStorage.getItem(LS_LAST_AUDIO_URL) || "").trim();

    if (lastCycleKey === cycleKeyNow && lastAudio) {
      setAudioUrl(lastAudio);
      setIsProcessing(false);
      setBlurOut(true);
      await sleep(800);
      setAppState(AppState.GOODNIGHT);
      setDisplayText("");
      setBlurOut(false);
      return;
    }

    setAppState(AppState.PROCESSING);
    setDisplayText("");
    setBlurOut(false);

    try {
      setIsProcessing(true);

      // ✅ 兜底：确保这些永不为空（解决 fine//index.json）
      const storedNickname = (localStorage.getItem(LS_NICKNAME) || "").trim();
      const storedUserId = (localStorage.getItem(LS_USER_ID) || "").trim();
      const storedVoicePref = (localStorage.getItem(LS_VOICE_PREF) || "").trim();

      const nickname = ((nextAnswers.nickname ?? storedNickname) || "").toString().trim();
      const user_id = ((nextAnswers.user_id ?? storedUserId) || "").toString().trim();
      const voice_preference = normalizeVoicePref(nextAnswers.voice_preference ?? storedVoicePref);

      // ✅ voice_category = mood（一定要走映射后的 fine/anxiety/tired/emo）
      const moodNorm = normalizeMood(nextAnswers["mood"]);
      const voice_category = moodNorm;

      const mergedAnswers = {
        ...nextAnswers,
        nickname,
        user_id,
        voice_preference,
        voice_category,
        mood: moodNorm,
      };
      setAnswers(mergedAnswers);

      const payload = {
        user_id,
        nickname,
        voice_preference,          // ✅ snake
        voicePreference: voice_preference, // ✅ camel 保险
        voice_preference_raw: voice_preference === "female" ? "女声" : "男声", // ✅ raw 保险
        voice_category,
        mood: moodNorm,
        body_tension: mergedAnswers["body_tension"],
        note: mergedAnswers["note"],
        answers: mergedAnswers,
      };

      const result = await runHealingPipeline(payload);

      setAudioUrl(result.audio_url);
      setProgress(100);
      setEtaSec(0);

      // ✅ 本周期落盘（20:00 前重复打开可直接跳播放页）
      localStorage.setItem(LS_LAST_AUDIO_URL, result.audio_url);
      localStorage.setItem(LS_LAST_CYCLE_KEY, cycleKeyNow);

      setIsProcessing(false);
      setBlurOut(true);
      await sleep(2000);
      setAppState(AppState.RESULT);
      setDisplayText("");
      setBlurOut(false);
    } catch (error: any) {
      console.error(error);
      setDisplayText(error?.message || "讯息传到另一个时空了，再试一次吧");
      setIsProcessing(false);
      setBlurOut(false);
    }
  }, [currentStep, answers, userInput, selectedOptions, runHealingPipeline, FLOW, isOnboarding, ONBOARDING_QUESTIONS.length]);

  // ✅ onboarding 的 "男声/女声" 选完后不自动跳，等点"继续"
  const isManualNextStep = useMemo(() => {
    const q = FLOW[currentStep] as FlowQuestion;
    if (!isOnboarding) return false;
    return q.key === "voice_preference" || q.key === "onboarding_greet" || q.key === "onboarding_ready";
  }, [FLOW, currentStep, isOnboarding]);

  const handleOptionClick = (opt: string, multi: boolean | undefined) => {
    // "今天感觉怎么样？"强制单选（给 fc 用）
    const moodIndexInFlow = isOnboarding ? ONBOARDING_QUESTIONS.length : 0;
    const isMoodQ = currentStep === moodIndexInFlow;

    // onboarding voice_preference 依旧手动继续
    if (isManualNextStep || isMoodQ) {
      setSelectedOptions(new Set([opt]));
      return;
    }

    const isMulti = !!multi;

    if (isMulti) {
      setSelectedOptions(prev => {
        const next = new Set(prev);
        if (next.has(opt)) next.delete(opt);
        else next.add(opt);
        return next;
      });
    } else {
      setSelectedOptions(new Set([opt]));
      handleNext();
    }
  };

  const createRipple = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  };

  const playAudio = async () => {
    setAppState(AppState.GOODNIGHT);
    setDisplayText("");

    await sleep(200);

    if (audioRef.current && audioUrl) {
      try {
        audioRef.current.load();
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          await playPromise;
          setPlaybackStatus('playing');
        }
      } catch (e) {
        console.warn("Autoplay prevented or failed:", e);
        setPlaybackStatus('paused');
      }
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    audioRef.current.play().catch(console.error);
    setPlaybackStatus('playing');
  };

  const pauseAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setPlaybackStatus('paused');
  };

  const stopPlayback = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setPlaybackStatus('stopped');
    setAudioProgress(0);
  };

  const handleSeek = (e: React.MouseEvent | React.TouchEvent) => {
    if (!waveformRef.current || !audioRef.current || !audioRef.current.duration || isNaN(audioRef.current.duration)) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    audioRef.current.currentTime = percentage * audioRef.current.duration;
    setAudioProgress(percentage);
  };

  const currentQ = FLOW[currentStep] as FlowQuestion;

  // onboarding 文本题必须非空才能继续
  const isOnboardingTextRequired =
    isOnboarding &&
    currentQ.isText &&
    currentQ.required;

  // ✅ onboarding 的 greet/ready 页：不需要输入也必须显示"继续"
  const forceContinueButton =
    isOnboarding && (currentQ.key === "onboarding_greet" || currentQ.key === "onboarding_ready");

  // ✅ onboarding voice_preference：选完后出现"继续"，不自动跳
  const forceContinueAfterPick =
    isOnboarding && currentQ.key === "voice_preference";

  const isSingleChoice = !currentQ.isText && !currentQ.multi;

  const showNextButton =
    forceContinueButton ||
    // onboarding 声音选择
    (forceContinueAfterPick ? selectedOptions.size > 0 : false) ||
    // ✅ mood 单选也要"继续"
    (isSingleChoice && selectedOptions.size > 0) ||
    // 文本题
    (currentQ.isText && (!isOnboardingTextRequired || (userInput || "").trim().length > 0)) ||
    // 多选题
    (currentQ.multi && selectedOptions.size > 0);

  const waveBars = useMemo(() => Array.from({ length: 40 }).map((_, i) => ({
    height: 6 + Math.sin(i * 0.4) * 12 + Math.cos(i * 0.9) * 8,
    delay: Math.random() * 2
  })), []);

  // === 设备验证失败 UI ===
  if (!deviceVerified && deviceError) {
    return (
      <div className="relative w-screen h-screen overflow-hidden flex flex-col items-center justify-center font-['Noto_Sans_SC'] tracking-[0.15em] bg-[#030408]">
        <ParticleBackground />
        
        <div className="absolute top-12 left-12 opacity-20 z-20 scale-75 md:scale-100">
          {LOGO_SVG}
        </div>
        
        <div className="relative z-10 w-full flex flex-col items-center justify-center px-8 transition-all duration-1000 max-w-[420px]">
          <div className="flex items-center justify-center text-center">
            <h1
              style={{
                color: COLORS.textMain,
                whiteSpace: 'pre-line',
              }}
              className="text-[1.1rem] md:text-xl font-extralight leading-[1.8] golden-glow-text"
            >
              旅程暂停了一下
            </h1>
          </div>
          
          <div className="mt-8 flex items-center justify-center text-center">
            <p
              style={{
                color: 'rgba(168, 157, 127, 0.65)',
                letterSpacing: '0.15em',
                whiteSpace: 'pre-line',
              }}
              className="text-[0.88rem] font-extralight leading-[1.8]"
            >
              为了保护你的疗愈之旅{'\n'}请从 MEM JOY 小程序打开
            </p>
          </div>
          
          <div className="mt-12 flex items-center justify-center">
            <button
              onClick={() => {
                if (typeof (window as any).wx !== 'undefined') {
                  (window as any).wx.miniProgram.navigateTo({
                    url: '/pages/index/index'
                  });
                } else {
                  setShowCustomAlert(true);
                }
              }}
              style={{
                background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.15), rgba(212, 175, 55, 0.05))',
                border: '1px solid rgba(212, 175, 55, 0.3)',
                color: COLORS.textMain,
                letterSpacing: '0.2em',
              }}
              className="px-8 py-3 rounded-full text-[0.9rem] font-light hover:bg-opacity-20 transition-all duration-300 btn-main-glow"
            >
              打开小程序
            </button>
          </div>
        </div>
        
        {/* 自定义弹窗 */}
        {showCustomAlert && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(0, 0, 0, 0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              backdropFilter: 'blur(8px)',
            }}
            onClick={() => setShowCustomAlert(false)}
          >
            <div
              style={{
                width: '85%',
                maxWidth: '320px',
                padding: '32px 24px',
                background: 'rgba(3, 4, 8, 0.95)',
                border: '1px solid rgba(212, 175, 55, 0.3)',
                borderRadius: '16px',
                textAlign: 'center',
                boxShadow: '0 0 40px rgba(212, 175, 55, 0.15), inset 0 0 60px rgba(212, 175, 55, 0.03)',
                backdropFilter: 'blur(20px)',
              }}
              onClick={(e) => e.stopPropagation()}
              className="font-['Noto_Sans_SC']"
            >
              <p
                style={{
                  fontSize: '0.875rem',
                  lineHeight: 1.8,
                  color: 'rgba(168, 157, 127, 0.9)',
                  marginBottom: '24px',
                  letterSpacing: '0.1em',
                  fontWeight: 300,
                }}
              >
                请在微信中<br/>
                打开 MEM JOY 小程序<br/>
                重新登录
              </p>
              <button
                onClick={() => setShowCustomAlert(false)}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.2), rgba(212, 175, 55, 0.1))',
                  border: '1px solid rgba(212, 175, 55, 0.4)',
                  borderRadius: '24px',
                  color: COLORS.textMain,
                  fontSize: '0.875rem',
                  fontWeight: 300,
                  letterSpacing: '0.2em',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
                className="btn-main-glow"
              >
                我知道了
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col items-center justify-center font-['Noto_Sans_SC'] tracking-[0.15em] bg-[#030408]">
      <ParticleBackground />

      <div className="absolute top-12 left-12 opacity-20 z-20 scale-75 md:scale-100">
        {LOGO_SVG}
      </div>

      <div
        className={`relative z-10 w-full flex flex-col items-center justify-center px-8 transition-all duration-1000 max-w-[420px] spirit-fade ${visible ? 'opacity-100' : 'opacity-0'}`}>

        {/* Header Text Area */}
        <div
          className={`flex items-center justify-center text-center spirit-fade ${blurOut ? 'blur-out' : 'opacity-100'} ${(appState === AppState.RESULT || appState === AppState.GOODNIGHT) ? 'h-0 overflow-hidden' : ''}`}
        >
          <h1
            style={{
              color: COLORS.textMain,
              transform: appState === AppState.QUESTIONS ? 'translateY(30px)' : 'none',
              whiteSpace:'pre-line', // 文字换行
            }}
            className="text-[1.1rem] md:text-xl font-extralight leading-[1.8] golden-glow-text transition-transform duration-700"
          >
            {displayText}
          </h1>
        </div>

        {/* Processing Progress UI */}
        {appState === AppState.PROCESSING && (
          <div className="w-full mt-8 flex flex-col items-center spirit-fade">
            {/* ✅ Rotating soothing line (mobile-safe, no overlap) */}
            <div
              key={sootheKey}
              style={{
                color: 'rgba(168, 157, 127, 0.65)',
                letterSpacing: '0.35em',
                opacity: 0,
                animation: `sootheOne 6000ms ease-in-out 1 forwards`,
                willChange: 'opacity',
                transform: 'translateZ(0)',
              }}
              className="text-[0.88rem] font-extralight"
            >
              {sootheLine}
            </div>

            {/* Progress Bar */}
            <div className="w-[260px] mt-6">
              <div
                className="relative h-[2px] w-full rounded-full overflow-visible"
                style={{ backgroundColor: 'rgba(212, 175, 55, 0.12)' }}
              >
                {/* 金线底层 */}
                <div
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(to right, rgba(212,175,55,0.15), rgba(212,175,55,0.85), rgba(212,175,55,0.15))',
                    boxShadow: '0 0 12px rgba(212,175,55,0.25)',
                  }}
                />

                {/* ✅ 金光流动高光（严格限制在已完成金线内部） */}
                <div
                  className="absolute left-0 top-0 h-full rounded-full pointer-events-none overflow-hidden"
                  style={{ width: `${progress}%` }}
                >
                  <div
                    style={{
                      width: '200%',
                      height: '100%',
                      background:
                        'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 35%, rgba(255,255,255,0) 70%)',
                      mixBlendMode: 'screen',
                      opacity: 0.55,
                      animation: 'shineFlow 1.9s linear infinite',
                    }}
                  />
                </div>

                {/* 仙女棒尾端（雾化+金粉） */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{
                    left: `calc(${progress}% - 10px)`,
                    width: '34px',
                    height: '26px',
                    opacity: progress <= 2 ? 0 : 1,
                  }}
                >
                  <span className="spark s1" />
                  <span className="spark s2" />
                  <span className="spark s3" />
                  <span className="spark s4" />
                  <span className="spark s5" />
                  <span className="spark s6" />
                  <span className="spark s7" />
                  <span className="spark s8" />

                  <div className="fairy-tail" />
                  <div className="fairy-tip" />

                  {/* 小尾焰（保留，但很轻） */}
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full"
                    style={{
                      width: '22px',
                      background: 'linear-gradient(90deg, rgba(212,175,55,0.0), rgba(212,175,55,0.45), rgba(212,175,55,0.0))',
                      filter: 'blur(0.9px)',
                      animation: 'tailFlicker 1.6s ease-in-out infinite',
                      opacity: 0.55,
                    }}
                  />

                  {/* 尾端小金点（更小、更慢） */}
                  <div
                    className="absolute right-[6px] top-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      width: '4px',
                      height: '4px',
                      background: 'rgba(212,175,55,0.92)',
                      boxShadow: '0 0 9px rgba(212,175,55,0.35)',
                      animation: 'dotPulse 2.8s ease-in-out infinite',
                      opacity: 0.8,
                    }}
                  />
                </div>
              </div>

              {/* Percent + ETA */}
              <div className="mt-4 flex items-center justify-between">
                <div
                  style={{ color: 'rgba(212, 175, 55, 0.75)' }}
                  className="text-[0.8rem] font-extralight tracking-[0.25em]"
                >
                  {progress}%
                </div>

                <div
                  style={{ color: 'rgba(168, 157, 127, 0.55)' }}
                  className="text-[0.8rem] font-extralight tracking-[0.2em]"
                >
                  {etaSec === null ? "正在生成..." : (etaSec <= 0 ? "即将完成..." : `距疗愈还需 ${etaSec} 秒`)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interaction Body */}
        <div className={`w-full flex flex-col items-center spirit-fade ${blurOut ? 'opacity-0' : 'opacity-100'}`}>

          {appState === AppState.QUESTIONS && (
            <div className="w-full flex flex-col items-center mt-28">
              {!currentQ.isText ? (
                <div className="w-[240px] overflow-x-auto no-scrollbar mask-gradient flex items-center py-4">
                  <div className="flex flex-nowrap gap-3 px-10">
                    {(currentQ.opts ?? []).map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => handleOptionClick(opt, currentQ.multi)}
                        style={{
                          backgroundColor: selectedOptions.has(opt) ? 'rgba(212, 175, 55, 0.12)' : 'transparent',
                          borderColor: selectedOptions.has(opt) ? 'rgba(212, 175, 55, 0.4)' : 'rgba(255, 255, 255, 0.06)',
                          color: selectedOptions.has(opt) ? 'rgba(212, 175, 55, 0.9)' : 'rgba(168, 157, 127, 0.45)'
                        }}
                        className={`px-5 py-2 rounded-full border spirit-fade text-[0.85rem] whitespace-nowrap flex-shrink-0
                          ${selectedOptions.has(opt) ? 'scale-105 shadow-[0_0_15px_rgba(212,175,55,0.1)]' : 'hover:border-[rgba(255,255,255,0.12)]'}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-[300px] mt-4 relative group flex flex-col items-center">
                  <textarea
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder={currentQ.placeholder ?? "一句话就好...留白也可以"}
                    style={{ color: COLORS.textMain }}
                    rows={1}
                    className="w-full bg-transparent border-none outline-none text-center placeholder-[rgba(168,157,127,0.2)] resize-none py-4 text-[0.95rem] font-light tracking-widest focus:placeholder-transparent transition-all duration-700"
                  />
                  <div className="relative w-64 h-[2px] mt-2 flex items-center justify-center">
                    <div className="absolute w-full h-[0.5px] bg-[rgba(212,175,55,0.1)]"></div>
                    <div className="absolute h-[1px] bg-gradient-to-r from-transparent via-[rgba(212,175,55,0.8)] to-transparent shadow-[0_0_12px_rgba(212,175,55,0.6)] transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] w-0 group-focus-within:w-full"></div>
                  </div>
                </div>
              )}

              <div className="h-20 mt-16 flex items-center justify-center">
                <button
                  onClick={(e) => { if (showNextButton) { createRipple(e); handleNext(); } }}
                  style={{
                    color: COLORS.gold,
                    borderColor: 'rgba(212, 175, 55, 0.22)',
                    opacity: showNextButton ? 1 : 0,
                    pointerEvents: showNextButton ? 'auto' : 'none',
                    letterSpacing: '0.65em'
                  }}
                  className="relative overflow-hidden px-14 py-2.5 rounded-full border text-[0.9rem] btn-main-glow spirit-fade uppercase transition-all duration-500 font-extralight"
                >
                  继续
                </button>
              </div>
            </div>
          )}

          {appState === AppState.RESULT && (
            <div className="h-[30vh] flex flex-col items-center justify-center">
              {!isProcessing ? (
                <button
                  onClick={(e) => { createRipple(e); playAudio(); }}
                  style={{ color: 'rgba(212, 175, 55, 0.85)', borderColor: 'rgba(212, 175, 55, 0.35)', letterSpacing: '0.55em' }}
                  className="relative overflow-hidden px-12 py-3 rounded-full border text-[0.9rem] btn-main-glow uppercase spirit-fade font-extralight"
                >
                  开启疗愈之旅
                </button>
              ) : (
                <div className="h-16 flex items-center justify-center" />
              )}
            </div>
          )}

          {appState === AppState.GOODNIGHT && (
            <div className="flex flex-col items-center mt-20">
              <div
                ref={waveformRef}
                onMouseDown={handleSeek}
                onTouchStart={handleSeek}
                className="relative w-48 h-16 cursor-pointer flex items-center justify-between mask-gradient-x px-2"
              >
                {waveBars.map((bar, i) => {
                  const isActive = (i / waveBars.length) <= audioProgress;
                  return (
                    <div
                      key={i}
                      style={{
                        height: `${bar.height}px`,
                        backgroundColor: isActive ? 'rgba(212, 175, 55, 0.75)' : 'rgba(212, 175, 55, 0.15)',
                        boxShadow: isActive ? '0 0 10px rgba(212, 175, 55, 0.4)' : 'none',
                        animation: playbackStatus === 'playing' ? `pulse 2s infinite ease-in-out ${bar.delay}s` : 'none'
                      }}
                      className="w-[2px] rounded-full transition-all duration-500"
                    />
                  );
                })}
              </div>

              <div className="flex items-center gap-10 mt-12">
                <button
                  onClick={pauseAudio}
                  style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}
                  className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all duration-700
                    ${playbackStatus === 'paused' ? 'btn-main-glow border-[rgba(212,175,55,0.6)]' : 'opacity-30 hover:opacity-100'}`}
                >
                  <div className="flex gap-1.5">
                    <div className="w-[3px] h-5 rounded-sm bg-[rgba(212,175,55,0.8)]" />
                    <div className="w-[3px] h-5 rounded-sm bg-[rgba(212,175,55,0.8)]" />
                  </div>
                </button>

                <button
                  onClick={togglePlay}
                  style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}
                  className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all duration-700
                    ${playbackStatus === 'playing' ? 'btn-main-glow border-[rgba(212,175,55,0.6)]' : 'opacity-30 hover:opacity-100'}`}
                >
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" style={{ color: COLORS.gold }}>
                    <path d="M2 1L13 8L2 15V1Z" />
                  </svg>
                </button>

                <button
                  onClick={stopPlayback}
                  style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}
                  className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all duration-700
                    ${playbackStatus === 'stopped' ? 'btn-main-glow border-[rgba(212,175,55,0.6)]' : 'opacity-30 hover:opacity-100'}`}
                >
                  <div className="w-4 h-4 rounded-sm bg-[rgba(212,175,55,0.8)]" />
                </button>
              </div>

              <div
                style={{ color: 'rgba(168, 157, 127, 0.4)' }}
                className="mt-20 text-[0.85rem] font-extralight tracking-[0.4em] spirit-fade"
              >
                晚安 好梦
              </div>
            </div>
          )}
        </div>

      </div>


     {/* ===== Brand Footer ===== */}
     <div
       className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center z-20 "
       style={{ pointerEvents: 'none' }}
     >
     <img
       src="https://healing-audio-web.oss-cn-hangzhou.aliyuncs.com/logo.png"
       alt="MEM JOY"
       className="w-4 mb-1"
       style={{ opacity: 0.55 }}
     />

     <div className="flex flex-col items-center">
        <div
           // ✅ 和"晚安 好梦"同色
          style={{ color: 'rgba(168, 157, 127, 0.4)' }}
          className="text-[0.6rem] tracking-[0.9em] font-extralight"
        >
          元悦心灵空间
        </div>

        <div
          className="my-[3.8px]"
          style={{
            width: '200px',
            height: '0.6px',
            background: 'linear-gradient(to right, transparent, rgba(249, 199, 74, 0.8), transparent)',
            boxShadow: '0 0 4px rgb(240, 204, 85)',
            opacity: 0.4,
          }}
        />

        <div
          // ✅ 英文更淡更隐形
          style={{ color: 'rgba(168, 157, 127, 0.3)' }}
          className="text-[0.45rem] tracking-[0.75em] font-extralight mt-[0.8px]"
        >
          MEM JOY
       </div>
     </div>
    </div>

      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="auto"
      />

      <div className="absolute bottom-0 w-full h-[35%] bg-gradient-to-t from-[#030408] via-[rgba(3,4,8,0.85)] to-transparent pointer-events-none"></div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.6; transform: scaleY(1); }
          50% { opacity: 1; transform: scaleY(1.1); }
          100% { opacity: 0.6; transform: scaleY(1); }
        }

        /* ✅ 每句独立一次：淡入 -> 停留 -> 淡出（手机端不叠字） */
        @keyframes sootheOne {
          0%   { opacity: 0; }
          22%  { opacity: 1; }
          78%  { opacity: 1; }
          100% { opacity: 0; }
        }

        /* 高光流动：亮带从左往右滑过 */
        @keyframes shineFlow {
          0%   { transform: translateX(-60%); opacity: 0.25; }
          30%  { opacity: 0.65; }
          100% { transform: translateX(140%); opacity: 0.25; }
        }

        /* 尾焰轻闪 */
        @keyframes tailFlicker {
          0%   { opacity: 0.40; transform: translateY(-50%) scaleX(0.92); }
          50%  { opacity: 0.70; transform: translateY(-50%) scaleX(1.06); }
          100% { opacity: 0.40; transform: translateY(-50%) scaleX(0.92); }
        }

        /* 小金点：更慢更舒缓 */
        @keyframes dotPulse {
          0%   { transform: translateY(-50%) scale(0.92); opacity: 0.65; }
          50%  { transform: translateY(-50%) scale(1.10); opacity: 0.95; }
          100% { transform: translateY(-50%) scale(0.92); opacity: 0.65; }
        }

        /* ====== 仙女棒尾端：细金粉 + 雾化拖尾 ====== */

        .fairy-tail{
          position:absolute;
          left:6px;
          top:50%;
          width:44px;
          height:10px;
          transform:translateY(-50%);
          border-radius:999px;
          background:
            radial-gradient(circle at 85% 50%, rgba(212,175,55,0.28), rgba(212,175,55,0) 60%),
            linear-gradient(90deg, rgba(212,175,55,0.0), rgba(212,175,55,0.28), rgba(212,175,55,0.0));
          filter: blur(6px);
          opacity: 0.85;
          mix-blend-mode: screen;
          animation: fairyTailBreathe 2.8s ease-in-out infinite;
        }

        .fairy-tip{
          position:absolute;
          right:8px;
          top:50%;
          width:3px;
          height:3px;
          transform:translateY(-50%);
          border-radius:999px;
          background: rgba(212,175,55,0.95);
          box-shadow:
            0 0 8px rgba(212,175,55,0.45),
            0 0 16px rgba(212,175,55,0.18);
          mix-blend-mode: screen;
          animation: fairyTipTwinkle 4s ease-in-out infinite;
        }

        .spark{
          position:absolute;
          width:2px;
          height:2px;
          border-radius:999px;
          background: rgba(255, 236, 180, 0.95);
          box-shadow:
            0 0 10px rgba(212,175,55,0.30),
            0 0 18px rgba(212,175,55,0.16);
          opacity: 0;
          mix-blend-mode: screen;
          filter: blur(0.2px);
        }

        .spark.s1{ left:20px; top:14px; animation: fairySparkA 2.4s ease-out infinite; animation-delay:0.00s; transform:scale(0.8); }
        .spark.s2{ left:16px; top:18px; animation: fairySparkB 2.0s ease-out infinite; animation-delay:0.22s; transform:scale(0.6); }
        .spark.s3{ left:26px; top:16px; animation: fairySparkA 2.8s ease-out infinite; animation-delay:0.45s; transform:scale(0.55); }
        .spark.s4{ left:12px; top:12px; animation: fairySparkC 2.2s ease-out infinite; animation-delay:0.70s; transform:scale(0.7); }
        .spark.s5{ left:24px; top:22px; animation: fairySparkB 2.6s ease-out infinite; animation-delay:0.95s; transform:scale(0.5); }
        .spark.s6{ left:18px; top:10px; animation: fairySparkC 3.0s ease-out infinite; animation-delay:1.18s; transform:scale(0.6); }
        .spark.s7{ left:30px; top:20px; animation: fairySparkA 2.1s ease-out infinite; animation-delay:1.42s; transform:scale(0.45); }
        .spark.s8{ left:14px; top:24px; animation: fairySparkB 2.9s ease-out infinite; animation-delay:1.65s; transform:scale(0.5); }

        @keyframes fairyTailBreathe{
          0%   { opacity:0.55; transform:translateY(-50%) scaleX(0.92); }
          50%  { opacity:0.95; transform:translateY(-50%) scaleX(1.05); }
          100% { opacity:0.55; transform:translateY(-50%) scaleX(0.92); }
        }

        @keyframes fairyTipTwinkle{
          0%   { opacity:0.65; transform:translateY(-50%) scale(0.9); }
          50%  { opacity:1;    transform:translateY(-50%) scale(1.10); }
          100% { opacity:0.65; transform:translateY(-50%) scale(0.9); }
        }

        @keyframes fairySparkA{
          0%   { opacity:0; transform:translate(0px, 0px) scale(1);   filter:blur(0.0px); }
          12%  { opacity:0.95; }
          45%  { opacity:0.6; }
          100% { opacity:0; transform:translate(22px, -16px) scale(0.2); filter:blur(0.9px); }
        }
        @keyframes fairySparkB{
          0%   { opacity:0; transform:translate(0px, 0px) scale(1); }
          10%  { opacity:0.9; }
          50%  { opacity:0.55; }
          100% { opacity:0; transform:translate(26px, 10px) scale(0.15); filter:blur(1.0px); }
        }
        @keyframes fairySparkC{
          0%   { opacity:0; transform:translate(0px, 0px) scale(1); }
          14%  { opacity:0.85; }
          55%  { opacity:0.45; }
          100% { opacity:0; transform:translate(18px, -6px) scale(0.15); filter:blur(0.85px); }
        }
      `}</style>
    </div>
  );
};

export default App;