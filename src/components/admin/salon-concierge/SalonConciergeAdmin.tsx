'use client';

import { useCallback, useEffect, useState } from 'react';

type Tab =
  | 'overview'
  | 'knowledge'
  | 'capabilities'
  | 'links'
  | 'offers'
  | 'voice'
  | 'examples'
  | 'sources'
  | 'gaps';

type Snapshot = {
  ok?: boolean;
  dbReady?: boolean;
  fixtureMode?: boolean;
  knowledge: Array<{
    key: string;
    category: string;
    title: string;
    status: string;
    answerText: string;
    aliases?: string[];
    branchCode?: string | null;
  }>;
  capabilities: Array<{
    key: string;
    displayNameAr: string;
    aliases: string[];
    status: string;
    descriptionAr?: string | null;
    branchCodes?: string[];
  }>;
  links: Array<{
    key: string;
    linkType: string;
    labelAr: string;
    url: string;
    branchCode: string | null;
    status?: string;
  }>;
  offers: Array<{ key: string; titleAr: string; descriptionAr: string; status: string; validTo: string | null }>;
  activeOffers: Array<{ key: string; titleAr: string; descriptionAr: string }>;
  brandVoice: {
    dialect: string;
    formality: string;
    warmth: string | number;
    humor: string | number;
    emojiUsage: string;
    messageLength: string;
    salesIntensity: string;
    preferredAddressTerms: string[];
    bannedAddressTerms: string[];
    preferredPhrases: string[];
    bannedPhrases: string[];
    behaviorRules: string[];
  };
  examples: Array<{
    id: number;
    scenarioKey: string;
    category: string;
    customerMessage: string;
    preferredResponse: string;
    priority: number;
    isActive: boolean;
  }>;
  sources: Array<{
    id: number;
    name: string;
    sourceType: string;
    urlOrRef: string | null;
    active: boolean;
  }>;
  knowledgeGaps: Array<{
    normalizedSubject: string;
    hitCount: number;
    categoryGuess: string | null;
    status?: string;
  }>;
};

const TABS: Array<[Tab, string]> = [
  ['overview', 'نظرة عامة'],
  ['knowledge', 'المعرفة'],
  ['capabilities', 'الخبرات'],
  ['links', 'الروابط'],
  ['offers', 'العروض'],
  ['voice', 'نبرة البراند'],
  ['examples', 'أمثلة الرد'],
  ['sources', 'مصادر المعرفة'],
  ['gaps', 'فجوات المعرفة'],
];

export function SalonConciergeAdmin() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [saving, setSaving] = useState(false);
  const [previewIn, setPreviewIn] = useState('فاتحين؟');
  const [previewOut, setPreviewOut] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/salon-concierge');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(entity: string, payload: Record<string, unknown>, action = 'upsert') {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/salon-concierge/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, action, payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/salon-concierge/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerMessage: previewIn, brandVoice: data?.brandVoice }),
      });
      const json = await res.json();
      setPreviewOut(json.replyText || (json.passToPhase2 ? '(يتحول لأدوات الحجز الحية)' : json.error || '—'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" dir="rtl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">مساعد الصالون</h1>
        <p className="text-sm text-muted-foreground">
          علّم المساعد من هنا بدون نشر كود. الأسعار والمواعيد والتوفر تظل من النظام الحي.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded px-3 py-1.5 text-sm ${tab === id ? 'bg-foreground text-background' : 'bg-muted'}`}
          >
            {label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className="rounded bg-muted px-3 py-1.5 text-sm">
          تحديث
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm">جاري التحميل…</p>}
      {saving && <p className="text-sm text-muted-foreground">جاري الحفظ…</p>}

      {data && tab === 'overview' && (
        <Section title="Overview">
          <p className="text-sm">قاعدة البيانات: {data.dbReady ? 'جاهزة' : 'غير مكتملة / محلية'}</p>
          <p className="text-sm">معرفة: {data.knowledge.length} · خبرات: {data.capabilities.length} · روابط: {data.links.length}</p>
          <p className="text-sm">عروض نشطة: {data.activeOffers.length} · أمثلة: {data.examples.length} · فجوات: {data.knowledgeGaps.length}</p>
        </Section>
      )}

      {data && tab === 'knowledge' && (
        <Section title="Knowledge">
          <KnowledgeForm onSave={(p) => void mutate('knowledge', p)} />
          {data.knowledge.map((k) => (
            <Row key={k.key} title={`${k.title} (${k.category})`} meta={`${k.status} · ${k.branchCode ?? 'عام'}`}>
              {k.answerText}
              <div className="mt-1 flex gap-2">
                <button type="button" className="text-xs underline" onClick={() => void mutate('knowledge', { key: k.key, status: 'inactive' }, 'status')}>
                  إيقاف
                </button>
                <button type="button" className="text-xs underline" onClick={() => void mutate('knowledge', { key: k.key, status: 'active' }, 'status')}>
                  تفعيل
                </button>
              </div>
            </Row>
          ))}
        </Section>
      )}

      {data && tab === 'capabilities' && (
        <Section title="Capabilities">
          <CapabilityForm onSave={(p) => void mutate('capability', p)} />
          {data.capabilities.map((c) => (
            <Row key={c.key} title={c.displayNameAr} meta={c.aliases.join(' · ')}>
              {c.descriptionAr || c.status}
            </Row>
          ))}
        </Section>
      )}

      {data && tab === 'links' && (
        <Section title="Links">
          <LinkForm onSave={(p) => void mutate('link', p)} />
          {data.links.map((l) => (
            <Row key={l.key} title={`${l.labelAr} · ${l.linkType}`} meta={l.branchCode ?? 'عام'}>
              <a href={l.url} className="underline" target="_blank" rel="noreferrer">
                {l.url}
              </a>
            </Row>
          ))}
        </Section>
      )}

      {data && tab === 'offers' && (
        <Section title="Offers">
          <OfferForm onSave={(p) => void mutate('offer', p)} />
          {data.offers.map((o) => (
            <Row key={o.key} title={o.titleAr} meta={o.status}>
              {o.descriptionAr}
            </Row>
          ))}
        </Section>
      )}

      {data && tab === 'voice' && (
        <Section title="Brand Voice Studio">
          <VoiceForm
            voice={data.brandVoice}
            onSave={(p) => void mutate('voice', p)}
            previewIn={previewIn}
            previewOut={previewOut}
            onPreviewIn={setPreviewIn}
            onPreview={() => void preview()}
          />
        </Section>
      )}

      {data && tab === 'examples' && (
        <Section title="Voice examples">
          <ExampleForm onSave={(p) => void mutate('example', p)} />
          {data.examples.map((e) => (
            <Row key={e.id} title={`${e.category} · ${e.scenarioKey}`} meta={e.isActive ? 'نشط' : 'متوقف'}>
              <p>عميل: {e.customerMessage}</p>
              <p>الرد: {e.preferredResponse}</p>
              <button
                type="button"
                className="mt-1 text-xs underline"
                onClick={() => void mutate('example', { ...e, isActive: !e.isActive })}
              >
                {e.isActive ? 'إيقاف' : 'تفعيل'}
              </button>
            </Row>
          ))}
        </Section>
      )}

      {data && tab === 'sources' && (
        <Section title="Knowledge sources">
          <p className="text-sm text-muted-foreground">التسجيل فقط — لا يتم سحب المحتوى تلقائيًا حتى المراجعة.</p>
          <SourceForm onSave={(p) => void mutate('source', p)} />
          {data.sources.map((s) => (
            <Row key={s.id} title={`${s.name} · ${s.sourceType}`} meta={s.active ? 'نشط' : 'متوقف'}>
              {s.urlOrRef ?? '—'}
            </Row>
          ))}
        </Section>
      )}

      {data && tab === 'gaps' && (
        <Section title="Knowledge gaps">
          {data.knowledgeGaps.length === 0 && <p className="text-sm">لا فجوات مسجّلة</p>}
          {data.knowledgeGaps.map((g) => (
            <Row key={g.normalizedSubject} title={g.normalizedSubject} meta={`${g.hitCount}× · ${g.status ?? 'open'}`}>
              {g.categoryGuess ?? '—'}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() =>
                    void mutate('gap', { normalizedSubject: g.normalizedSubject, status: 'ignored' }, 'status')
                  }
                >
                  تجاهل
                </button>
              </div>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded border p-3">
      <h2 className="font-medium">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="rounded bg-muted/40 p-2 text-sm">
      <div className="flex justify-between gap-2">
        <strong>{title}</strong>
        {meta && <span className="text-muted-foreground">{meta}</span>}
      </div>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'w-full rounded border bg-background px-2 py-1 text-sm';

function KnowledgeForm({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [aliases, setAliases] = useState('');
  const [category, setCategory] = useState('FAQ');
  const [branchCode, setBranchCode] = useState('');
  return (
    <form
      className="grid gap-2 rounded border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ key, title, subject, answerText, aliases, category, branchCode: branchCode || null, status: 'active' });
      }}
    >
      <Field label="المفتاح"><input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} required /></Field>
      <Field label="السؤال / الموضوع"><input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="العنوان"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="الإجابة"><textarea className={inputClass} value={answerText} onChange={(e) => setAnswerText(e.target.value)} required /></Field>
      <Field label="أسماء بديلة"><input className={inputClass} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="كيرلي, curly" /></Field>
      <Field label="التصنيف"><input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
      <Field label="الفرع (اختياري)"><input className={inputClass} value={branchCode} onChange={(e) => setBranchCode(e.target.value)} placeholder="GLEEM" /></Field>
      <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm text-background">حفظ معرفة</button>
    </form>
  );
}

function CapabilityForm({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [key, setKey] = useState('');
  const [displayNameAr, setDisplayNameAr] = useState('');
  const [aliases, setAliases] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [employeeNames, setEmployeeNames] = useState('');
  const [branchCodes, setBranchCodes] = useState('');
  return (
    <form
      className="grid gap-2 rounded border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ key, displayNameAr, aliases, descriptionAr, employeeNames, branchCodes, status: 'active' });
      }}
    >
      <Field label="المفتاح"><input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} required /></Field>
      <Field label="الاسم"><input className={inputClass} value={displayNameAr} onChange={(e) => setDisplayNameAr(e.target.value)} required /></Field>
      <Field label="أسماء بديلة"><input className={inputClass} value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
      <Field label="الوصف"><textarea className={inputClass} value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} /></Field>
      <Field label="الحلاقون (أسماء)"><input className={inputClass} value={employeeNames} onChange={(e) => setEmployeeNames(e.target.value)} /></Field>
      <Field label="الفروع"><input className={inputClass} value={branchCodes} onChange={(e) => setBranchCodes(e.target.value)} placeholder="GLEEM,CAMP_CAESAR" /></Field>
      <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm text-background">حفظ خبرة</button>
    </form>
  );
}

function LinkForm({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [key, setKey] = useState('');
  const [linkType, setLinkType] = useState('GOOGLE_MAPS');
  const [labelAr, setLabelAr] = useState('');
  const [url, setUrl] = useState('');
  const [branchCode, setBranchCode] = useState('');
  return (
    <form
      className="grid gap-2 rounded border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ key, linkType, labelAr, url, branchCode: branchCode || null, status: 'active' });
      }}
    >
      <Field label="المفتاح"><input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} required /></Field>
      <Field label="النوع">
        <select className={inputClass} value={linkType} onChange={(e) => setLinkType(e.target.value)}>
          {['GOOGLE_MAPS', 'BOOKING', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'WHATSAPP', 'BRANCH_LOCATION', 'OTHER'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="الاسم"><input className={inputClass} value={labelAr} onChange={(e) => setLabelAr(e.target.value)} required /></Field>
      <Field label="الرابط"><input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} required /></Field>
      <Field label="الفرع"><input className={inputClass} value={branchCode} onChange={(e) => setBranchCode(e.target.value)} /></Field>
      <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm text-background">حفظ رابط</button>
    </form>
  );
}

function OfferForm({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [key, setKey] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  return (
    <form
      className="grid gap-2 rounded border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ key, titleAr, descriptionAr, validFrom: validFrom || null, validTo: validTo || null, status: 'active' });
      }}
    >
      <Field label="المفتاح"><input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} required /></Field>
      <Field label="العنوان"><input className={inputClass} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} required /></Field>
      <Field label="الوصف"><textarea className={inputClass} value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} required /></Field>
      <Field label="من"><input className={inputClass} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
      <Field label="إلى"><input className={inputClass} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></Field>
      <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm text-background">حفظ عرض</button>
    </form>
  );
}

function VoiceForm({
  voice,
  onSave,
  previewIn,
  previewOut,
  onPreviewIn,
  onPreview,
}: {
  voice: Snapshot['brandVoice'];
  onSave: (p: Record<string, unknown>) => void;
  previewIn: string;
  previewOut: string;
  onPreviewIn: (v: string) => void;
  onPreview: () => void;
}) {
  const [form, setForm] = useState(voice);
  useEffect(() => setForm(voice), [voice]);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="grid gap-3">
      <Field label="اللهجة"><input className={inputClass} value={String(form.dialect)} onChange={(e) => set('dialect', e.target.value)} /></Field>
      <Field label="الرسمية"><input className={inputClass} value={String(form.formality)} onChange={(e) => set('formality', e.target.value)} /></Field>
      <Field label="الدفء"><input className={inputClass} value={String(form.warmth)} onChange={(e) => set('warmth', e.target.value)} /></Field>
      <Field label="الفكاهة"><input className={inputClass} value={String(form.humor)} onChange={(e) => set('humor', e.target.value)} /></Field>
      <Field label="الإيموجي"><input className={inputClass} value={String(form.emojiUsage)} onChange={(e) => set('emojiUsage', e.target.value)} /></Field>
      <Field label="طول الرسالة"><input className={inputClass} value={String(form.messageLength)} onChange={(e) => set('messageLength', e.target.value)} /></Field>
      <Field label="قوة البيع"><input className={inputClass} value={String(form.salesIntensity)} onChange={(e) => set('salesIntensity', e.target.value)} /></Field>
      <Field label="خطاب مفضّل">
        <input className={inputClass} value={form.preferredAddressTerms.join(', ')} onChange={(e) => set('preferredAddressTerms', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <Field label="خطاب ممنوع">
        <input className={inputClass} value={form.bannedAddressTerms.join(', ')} onChange={(e) => set('bannedAddressTerms', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <Field label="عبارات ممنوعة">
        <input className={inputClass} value={form.bannedPhrases.join(', ')} onChange={(e) => set('bannedPhrases', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <Field label="قواعد السلوك">
        <input className={inputClass} value={form.behaviorRules.join(', ')} onChange={(e) => set('behaviorRules', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <button type="button" className="rounded bg-foreground px-3 py-1.5 text-sm text-background" onClick={() => onSave(form as unknown as Record<string, unknown>)}>
        حفظ النبرة
      </button>
      <div className="rounded border p-2">
        <p className="mb-1 text-sm font-medium">معاينة (لا تغيّر المحادثات)</p>
        <Field label="رسالة العميل">
          <input className={inputClass} value={previewIn} onChange={(e) => onPreviewIn(e.target.value)} />
        </Field>
        <button type="button" className="mt-2 rounded bg-muted px-3 py-1.5 text-sm" onClick={onPreview}>
          توليد معاينة
        </button>
        <p className="mt-2 whitespace-pre-wrap text-sm">{previewOut || '—'}</p>
      </div>
    </div>
  );
}

function ExampleForm({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [scenarioKey, setScenarioKey] = useState('price');
  const [category, setCategory] = useState('PRICE');
  const [customerMessage, setCustomerMessage] = useState('');
  const [preferredResponse, setPreferredResponse] = useState('');
  const [priority, setPriority] = useState('10');
  return (
    <form
      className="grid gap-2 rounded border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ scenarioKey, category, customerMessage, preferredResponse, priority: Number(priority), isActive: true });
      }}
    >
      <Field label="السيناريو"><input className={inputClass} value={scenarioKey} onChange={(e) => setScenarioKey(e.target.value)} required /></Field>
      <Field label="التصنيف"><input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
      <Field label="رسالة العميل"><input className={inputClass} value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} required /></Field>
      <Field label="الرد المفضّل"><textarea className={inputClass} value={preferredResponse} onChange={(e) => setPreferredResponse(e.target.value)} required /></Field>
      <Field label="الأولوية"><input className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
      <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm text-background">حفظ مثال</button>
    </form>
  );
}

function SourceForm({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('WEBSITE');
  const [urlOrRef, setUrlOrRef] = useState('');
  return (
    <form
      className="grid gap-2 rounded border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, sourceType, urlOrRef: urlOrRef || null, active: true });
      }}
    >
      <Field label="الاسم"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="النوع">
        <select className={inputClass} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          {['WEBSITE', 'BOOKING_WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'GOOGLE_MAPS', 'DOCUMENT', 'MANUAL'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="الرابط / المرجع"><input className={inputClass} value={urlOrRef} onChange={(e) => setUrlOrRef(e.target.value)} /></Field>
      <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm text-background">حفظ مصدر</button>
    </form>
  );
}
