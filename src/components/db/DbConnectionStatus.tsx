'use client';

import { useDbToggle } from '@/hooks/useDbToggle';
import { Cloud, Server, Loader2, AlertCircle } from 'lucide-react';

export function DbConnectionStatus() {
  const { currentTarget, isLoading, error, dbInfo } = useDbToggle();

  if (currentTarget === null || isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 bg-gray-100/50 rounded-full border border-gray-200/50">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>جاري التحميل...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-full border border-red-200">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>خطأ في الاتصال</span>
      </div>
    );
  }

  const isCloud = currentTarget === 'cloud';

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border
        transition-all duration-200
        ${isCloud
          ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
          : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
        }
      `}
      title={isCloud 
        ? `متصل بالسحابة: ${dbInfo?.cloud.database || '...'}` 
        : `متصل محلياً: ${dbInfo?.local.database || '...'}`
      }
    >
      {isCloud ? (
        <>
          <Cloud className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">متصل أونلاين (السحابة)</span>
          <span className="sm:hidden">أونلاين</span>
        </>
      ) : (
        <>
          <Server className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">متصل أوفلاين (محلي)</span>
          <span className="sm:hidden">أوفلاين</span>
        </>
      )}
      <span className={`
        w-2 h-2 rounded-full animate-pulse
        ${isCloud ? 'bg-purple-500' : 'bg-blue-500'}
      `} />
    </div>
  );
}
