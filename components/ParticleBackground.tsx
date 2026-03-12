
import React, { useEffect, useRef } from 'react';
import { Particle } from '../types';

const ParticleBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const initScene = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      
      particles.current = [];
      for (let i = 0; i < 100; i++) {
        particles.current.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          size: Math.random() * 1 + 0.5,
          // Movement velocity reduced by another 50% for an extremely slow drift
          vx: (Math.random() - 0.5) * (Math.random() * 0.2 + 0.02),
          vy: (Math.random() - 0.5) * (Math.random() * 0.2 + 0.02),
          phi: Math.random() * Math.PI * 2,
          // Blink speed reduced by another 50% for an even more subtle twinkle
          blinkSpeed: Math.random() * 0.005 + 0.0025,
          color: `rgba(${220 + Math.random() * 35}, ${180 + Math.random() * 40}, ${100 + Math.random() * 50}`
        });
      }
    };

    const draw = () => {
      ctx.fillStyle = '#030408';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      particles.current.forEach(p => {
        p.phi += p.blinkSpeed;
        const breathe = 0.4 + Math.sin(p.phi) * 0.4;
        
        ctx.fillStyle = `${p.color}, ${breathe})`;
        ctx.shadowBlur = 10 * breathe;
        ctx.shadowColor = `rgba(212, 175, 55, ${breathe})`;
        
        ctx.beginPath(); 
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); 
        ctx.fill();
        
        ctx.shadowBlur = 0;

        p.x += p.vx; 
        p.y += p.vy;
        if (p.x < 0) p.x = window.innerWidth; 
        if (p.x > window.innerWidth) p.x = 0;
        if (p.y < 0) p.y = window.innerHeight; 
        if (p.y > window.innerHeight) p.y = 0;
      });
      animationId = requestAnimationFrame(draw);
    };

    initScene();
    draw();

    window.addEventListener('resize', initScene);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', initScene);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />;
};

export default ParticleBackground;
