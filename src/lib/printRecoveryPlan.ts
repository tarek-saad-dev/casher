import { REQUIRED_AGENT_VERSION, type LoopbackPermissionState, type LocalPrinterSettings, type PrinterDiagnostics } from './localPrintClient';

/** Pure UI decision logic. No retries, mutation, network calls, or print jobs. */
export type RecoveryKind =
  | 'check' | 'browser' | 'agent' | 'upgrade' | 'settings'
  | 'spooler' | 'printer' | 'queue' | 'ready' | 'verify' | 'renderer';
export type RecoveryAction =
  | 'check' | 'permissions' | 'local-check' | 'upgrade' | 'open-printers'
  | 'enable' | 'test' | 'repair-browser';
export interface RecoveryStep {
  kind: RecoveryKind;
  title: string;
  detail: string;
  action: RecoveryAction;
  level: number;
}
export interface RecoveryContext {
  attempted: boolean;
  connected: boolean;
  permission: LoopbackPermissionState;
  settings?: LocalPrinterSettings | null;
  diagnostics?: PrinterDiagnostics | null;
  /** Distinguish a reachable but outdated Agent from a blocked/unreachable Agent. */
  healthVersion?: string | null;
}

export function buildPrintRecoveryPlan(c: RecoveryContext): RecoveryStep[] {
  if (!c.attempted) return [{
    kind: 'check', level: 1, title: 'ابدأ بفحص الاتصال',
    detail: 'بنطلب إذن المتصفح للفحص فقط؛ مش هنبعت أي ورق للطابعة.',
    action: 'check',
  }];
  if (c.permission === 'denied' && !c.connected) return [{
    kind: 'browser', level: 1, title: 'Chrome مانع الوصول للجهاز',
    detail: 'افتح إعدادات موقع ops.cutsaloon.com واسمح بصلاحية Loopback network ثم افحص الاتصال. لا تغيّر إعدادات أمان الجهاز العامة.',
    action: 'permissions',
  }];
  if (c.connected && c.settings && c.settings.version !== REQUIRED_AGENT_VERSION) return [{
    kind: 'upgrade', level: 2, title: 'النسخة الحالية شغالة، لكن محتاجة تحديث V2',
    detail: 'تقدر تكمل استخدام الطباعة الأساسية لحين تحديث جهاز Windows ده. افتح أداة Repair V2 على نفس الجهاز لتحصل على الفحص والإصلاح المتدرّج.',
    action: 'upgrade',
  }];
  if (!c.connected && c.healthVersion && c.healthVersion !== REQUIRED_AGENT_VERSION) return [{
    kind: 'upgrade', level: 2, title: 'برنامج الطباعة يحتاج تحديث أو إصلاح',
    detail: 'البرنامج المحلي بيرد لكنه غير متوافق مع صفحة الطباعة. استخدم أداة Repair V2 على جهاز الكاشير فقط، بعد اعتماد الإصدار.',
    action: 'upgrade',
  }];
  if (!c.connected && c.healthVersion === REQUIRED_AGENT_VERSION) return [{
    kind: 'settings', level: 2, title: 'الـ Agent شغال لكن صفحة التحكم مش بتستجيب',
    detail: 'راجع /settings والنسخة المثبتة، وبعدها جرّب أداة الفحص المحلي. ما نعيدش تشغيل الطابعة أو نطبع تلقائيًا.',
    action: 'local-check',
  }];
  if (!c.connected) return [{
    kind: 'agent', level: 2, title: 'خدمة الطباعة مش مستجيبة',
    detail: 'ممكن تكون متوقفة، أو Chrome منع الاتصال. جرّب الفحص المحلي الذي يشغّل المهمة المتوقفة فقط؛ لو ما نفعش استخدم Repair بعد اعتماد الإصدار.',
    action: 'local-check',
  }];
  if (!c.settings) return [{
    kind: 'settings', level: 2, title: 'بيانات برنامج الطباعة غير متاحة',
    detail: 'اتأكد من توافق الإصدار وافحص إعدادات الخدمة. لا نطبع أو نعيد التشغيل تلقائيًا.',
    action: 'local-check',
  }];
  if (!c.settings.enabled) return [{
    kind: 'settings', level: 3, title: 'الطباعة موقوفة من الإعدادات',
    detail: 'شغّل الطباعة من زر التحكم الموجود في الصفحة بعد التأكد إنك عايز ترجعها.',
    action: 'enable',
  }];
  const d = c.diagnostics;
  if (d?.browserFound === false) return [{
    kind: 'renderer', level: 3, title: 'Chrome الخاص بطباعة الفاتورة ناقص',
    detail: 'برنامج الطباعة متصل والطابعة ظاهرة، لكن مكتبة Puppeteer مش لاقية Chrome for Testing اللي بتحوّل الفاتورة لصورة. نزّل ملف الإصلاح على نفس كمبيوتر الكاشير وشغّله بدبل كليك. مش هيطبع أو يعيد فواتير.',
    action: 'repair-browser',
  }];
  if (!d || d.probe !== 'ok') return [{
    kind: 'verify', level: 3, title: 'الخدمة شغالة، لكن فحص Windows مش مكتمل',
    detail: 'اتأكد من طابعة Windows وافحص ورقة واحدة عند وجودك بالمحل. الحالة الفعلية للورق غير معروفة.',
    action: 'open-printers',
  }];
  if (!d.spoolerStatus || d.spoolerStatus.toLowerCase() === 'unknown') return [{
    kind: 'verify', level: 3, title: 'حالة Windows Spooler غير مؤكدة',
    detail: 'فحص Windows لم يرجّع حالة واضحة. راجع Windows Services ولا ترسل إعادة طباعة تلقائية.',
    action: 'open-printers',
  }];
  if (d.spoolerStatus.toLowerCase() === 'stopped') return [{
    kind: 'spooler', level: 3, title: 'خدمة الطباعة في Windows متوقفة',
    detail: 'من Windows Services افحص Print Spooler. مش هنشغله أو نمسح مهام الطباعة عن بُعد من المتصفح.',
    action: 'open-printers',
  }];
  if (d.printerFound === null) return [{
    kind: 'verify', level: 4, title: 'Windows لم يؤكد وجود الطابعة',
    detail: 'فحص Windows مش حاسم. راجع تعريف الطابعة والاتصال قبل إرسال ورق.',
    action: 'open-printers',
  }];
  if (d.printerFound === false) return [{
    kind: 'printer', level: 4, title: 'Windows مش لاقي الطابعة المحددة',
    detail: 'راجع USB واسم الطابعة داخل Windows. لو الاسم اتغير، شغّل أداة Repair مع اختيار الاسم الصحيح.',
    action: 'open-printers',
  }];
  const status = (d.printerStatus || '').toLowerCase();
  if (!status || status === 'unknown') return [{
    kind: 'verify', level: 4, title: 'حالة الطابعة غير معروفة',
    detail: 'راجع طابعة Windows أو اطبع اختبارًا يدويًا بعد التحقق من الورق، من غير تكرار فواتير العملاء.',
    action: 'open-printers',
  }];
  if (/offline|error|paperout|notavailable|paused|not ready|unavailable/i.test(status)) return [{
    kind: 'printer', level: 4, title: 'Windows بيبلغ إن الطابعة مش جاهزة',
    detail: 'اتأكد من الكهرباء والورق وكابل USB، وافتح قائمة طباعة Windows؛ لا نكرر أي فاتورة تلقائيًا.',
    action: 'open-printers',
  }];
  if ((d.queuedJobs ?? 0) > 0) return [{
    kind: 'queue', level: 4, title: 'في مهام طباعة معلّقة',
    detail: 'راجع قائمة الانتظار قبل إرسال أي نسخة جديدة. وجود مهام مش معناه إنها فشلت أو إنها اتطبعت.',
    action: 'open-printers',
  }];
  return [{
    kind: 'ready', level: 5, title: 'الفحوصات المبدئية سليمة',
    detail: 'ده لا يثبت خروج الورقة. جرّب ورقة اختبار واحدة بإذن منك وتأكد من النتيجة فعليًا.',
    action: 'test',
  }];
}
