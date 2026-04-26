'use client';

import { useEffect, useState } from 'react';
import { Scissors, Sparkles } from 'lucide-react';

export default function BarberLoading() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-amber-950 via-amber-900 to-amber-950">
      {/* Animated background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,#D6A84F_0%,transparent_50%)] animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,#F7F1E5_0%,transparent_50%)] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_20%,#D6A84F_0%,transparent_50%)] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Main loading content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Animated scissors */}
        <div className="relative">
          <div className="absolute inset-0 bg-amber-400/20 rounded-full blur-xl animate-pulse" />
          <div className="relative bg-gradient-to-br from-amber-400 to-amber-600 rounded-full p-8 shadow-2xl shadow-amber-500/30 animate-bounce">
            <Scissors className="w-16 h-16 text-amber-950" />
          </div>
          
          {/* Orbiting sparkles */}
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
            <Sparkles className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 w-6 h-6 text-amber-300" />
            <Sparkles className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-2 w-5 h-5 text-amber-200" style={{ animationDelay: '0.5s' }} />
            <Sparkles className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 w-4 h-4 text-amber-300" style={{ animationDelay: '1s' }} />
            <Sparkles className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 w-5 h-5 text-amber-200" style={{ animationDelay: '1.5s' }} />
          </div>
        </div>

        {/* Loading text */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold text-amber-100 tracking-wide">
            Cut Salon
          </h1>
          <p className="text-xl text-amber-200/80 font-medium">
            جاري التحضير{dots}
          </p>
          <p className="text-sm text-amber-300/60">
            صالون حلاقة راقي
          </p>
        </div>

        {/* Animated barber tools */}
        <div className="flex gap-4">
          <div className="w-3 h-12 bg-gradient-to-b from-amber-400 to-amber-600 rounded-full animate-pulse" />
          <div className="w-3 h-16 bg-gradient-to-b from-amber-300 to-amber-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
          <div className="w-3 h-10 bg-gradient-to-b from-amber-400 to-amber-600 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
          <div className="w-3 h-14 bg-gradient-to-b from-amber-300 to-amber-500 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }} />
        </div>

        {/* Progress bar */}
        <div className="w-64 h-2 bg-amber-900/30 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full animate-pulse" 
               style={{ 
                 width: '60%',
                 animation: 'shimmer 2s ease-in-out infinite'
               }} />
        </div>
      </div>

      {/* CSS for shimmer animation */}
      <style jsx>{`
        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
