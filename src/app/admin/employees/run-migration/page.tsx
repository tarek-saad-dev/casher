'use client';

import { useState } from 'react';

export default function RunMigrationPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runMigration = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/employees/migration', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold mb-6">تشغيل Migration للموظفين</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          هذه الصفحة لإصلاح مشكلة الأعمدة المفقودة في جدول الموظفين.
          اضغط على الزر أدناه لتشغيل الـ migration.
        </p>
      </div>

      <button
        onClick={runMigration}
        disabled={loading}
        className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'جاري التشغيل...' : 'تشغيل Migration'}
      </button>

      {result && (
        <div className={`mt-6 p-4 rounded-lg ${
          result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h3 className="font-bold mb-2">
            {result.success ? '✅ نجح' : '❌ فشل'}
          </h3>
          <pre className="text-sm whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
