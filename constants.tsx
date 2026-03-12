
import React from 'react';
import { Question } from './types';

export const QUESTIONS: Question[] = [
  { q: "今天感觉怎么样？", opts: ["不错", "还可以", "紧绷焦虑", "很累", "情绪低落"], multi: false },
  { q: "身体哪里最需要照顾？", opts: ["头部", "肩颈", "胸口", "肠胃", "腰背", "腿脚"], multi: true },
  { q: "今晚你希望：", opts: ["放松入睡", "情绪安抚", "身体扫描", "能量补充"], multi: true },
  { q: "想聊聊今天的心境吗？", isText: true }
];

export const COLORS = {
  bg: '#030408',
  textMain: 'rgba(168, 157, 127, 0.85)', // Nordic Sand
  gold: 'rgba(212, 175, 55, 0.7)',     // Muted Gold
  goldBright: '#d4af37',               // Deep Gold
  pillText: 'rgba(168, 157, 127, 0.5)', 
};

export const LOGO_SVG = (
  <svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" stroke="rgba(212, 175, 55, 0.25)" strokeWidth="0.5" />
    <path d="M50 20C50 20 35 40 35 55C35 63.2843 41.7157 70 50 70C58.2843 70 65 63.2843 65 55C65 40 50 20 50 20Z" fill="rgba(212, 175, 55, 0.08)" stroke="rgba(212, 175, 55, 0.35)" />
    <circle cx="50" cy="55" r="4" fill="rgba(212, 175, 55, 0.7)" />
  </svg>
);
