
export interface Question {
  q: string;
  opts?: string[];
  isText?: boolean;
  multi?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  phi: number;
  blinkSpeed: number;
  color: string;
}

export enum AppState {
  WELCOME = 'WELCOME',
  QUESTIONS = 'QUESTIONS',
  PROCESSING = 'PROCESSING',
  RESULT = 'RESULT',
  GOODNIGHT = 'GOODNIGHT'
}
