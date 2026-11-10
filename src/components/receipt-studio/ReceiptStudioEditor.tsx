'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import Link from 'next/link';
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, FileText, GripVertical,
  Layers, LayoutTemplate, LockKeyhole, Plus, Redo2, RotateCcw, Ruler, FolderPlus,
  Settings2, Type, Undo2, Eye, EyeOff, Info, Printer, Image as ImageIcon, Minus, Copy, Ungroup, Group,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  COMPACT_CUT_RECEIPT_V1, DEFAULT_RECEIPT_FIELDS, RECEIPT_FIELDS_BY_KIND, validateReceiptTemplateV1,
  type ReceiptField, type ReceiptBlockV1, type ReceiptBlockKind, type ReceiptTemplateV1,
} from '@/lib/receipt-studio/template';
import {
  addReceiptDecoration, addReceiptImage, deleteReceiptDecoration, getSampleReceipt, reorderReceiptBlocks, setReceiptMinHeight,
  updateReceiptBlock, type SampleScenario,
} from '@/lib/receipt-studio/editor';
import ReceiptStudioPreview from './ReceiptStudioPreview';
import ReceiptStudioLayerTree from './ReceiptStudioLayerTree';
import { allReceiptNodes, duplicateTreeNode, findReceiptNode, groupReceiptNodes, moveTreeNode, removeTreeNode, treeNodeParentId, ungroupReceiptNode, updateTreeNode, addTreeNode, type TreePlacement } from '@/lib/receipt-studio/tree';
import { prepareThermalImage } from './prepareImage';
import { renderStudioReceiptHtml, type StudioInvoiceModel } from '@/lib/receipt-studio/render';
import { createPrintRequestId, printHtmlViaLocalService } from '@/lib/localPrintClient';

const LABELS: Record<ReceiptBlockKind, string> = {
  brand: 'الشعار والهوية',
  'invoice-meta': 'بيانات الفاتورة',
  items: 'جدول الخدمات',
  totals: 'الإجمالي والخصومات',
  payment: 'طريقة الدفع',
  divider: 'فاصل',
  text: 'نص إضافي',
  image: 'صورة PNG',
  footer: 'رسالة الشكر',
  group: 'مجموعة',
};
const REQUIRED: ReadonlySet<ReceiptBlockKind> = new Set(['items', 'totals']);
const FIXTURES: Array<{ value: SampleScenario; label: string }> = [
  { value: 'one', label: 'خدمة واحدة' },
  { value: 'three', label: '3 خدمات' },
  { value: 'twelve', label: '12 خدمة' },
  { value: 'long', label: 'أسماء طويلة' },
];
type HistoryState = { past: ReceiptTemplateV1[]; current: ReceiptTemplateV1; future: ReceiptTemplateV1[] };
type Scope = 'tenant' | 'branch';
type Revision = { version: number; action: string; createdAt: string; actorUserId: number };
type ServerStudio = {
  ok: true; draft: ReceiptTemplateV1; draftRevision: number;
  publishedVersion: number; history: Revision[]; assets: Record<string,string>;
};
function sampleAsInvoice(scenario: SampleScenario): StudioInvoiceModel {
  const fixture = getSampleReceipt(scenario);
  return {
    invoiceNo: fixture.invoiceNo.replace('#',''), date: fixture.date, time: fixture.time,
    branch: fixture.branch, brand: 'CUT SALON', customer: fixture.customer,
    items: fixture.items.map((item) => ({ name: item.name, price: item.price * item.qty })),
    subtotal: fixture.subtotal,
    discounts: fixture.discount ? [{ label: 'Discount', amount: fixture.discount }] : [],
    grandTotal: fixture.total,
    payments: [{ label: fixture.payment }],
    footer: 'شكراً لزيارتكم',
  };
}

function freshTemplate(): ReceiptTemplateV1 {
  return structuredClone(COMPACT_CUT_RECEIPT_V1);
}

export default function ReceiptStudioEditor() {
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [], current: freshTemplate(), future: [],
  }));
  const [selectedId, setSelectedId] = useState<string | null>('brand');
  const [selectedIds, setSelectedIds] = useState<string[]>(['brand']);
  const [scenario, setScenario] = useState<SampleScenario>('three');
  const [zoom, setZoom] = useState(110);
  const [heightMm, setHeightMm] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('branch');
  const [draftRevision, setDraftRevision] = useState(0);
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [versions, setVersions] = useState<Revision[]>([]);
  const [assets, setAssets] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [physicalVerified, setPhysicalVerified] = useState(false);
  const [proofMode, setProofMode] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);

  const template = history.current;
  const selected = selectedId ? findReceiptNode(template.blocks, selectedId) : null;
  const modified = JSON.stringify(template) !== JSON.stringify(COMPACT_CUT_RECEIPT_V1);
  const proofHtml = useMemo(() => renderStudioReceiptHtml(template, sampleAsInvoice(scenario), assets), [template, scenario, assets]);

  const loadStudio = useCallback(async (selectedScope: Scope) => {
    const response = await fetch(`/api/admin/receipt-studio?scope=${selectedScope}`, { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || 'تعذر تحميل التصميم المحفوظ');
    return json as ServerStudio;
  }, []);
  useEffect(() => {
    let canceled = false;
    setBusy(true);
    busyRef.current = true;
    setMessage(null);
    loadStudio(scope).then((data) => {
      if (canceled) return;
      setHistory({ past: [], current: data.draft, future: [] });
      setDraftRevision(data.draftRevision);
      setPublishedVersion(data.publishedVersion);
      setVersions(data.history);
      setAssets(data.assets);
      setDbReady(true);
      setDirty(false);
      setSelectedId(data.draft.blocks[0]?.id ?? null);
      setSelectedIds(data.draft.blocks[0] ? [data.draft.blocks[0].id] : []);
      setTestSent(false);
      setPhysicalVerified(false);
    }).catch((error) => {
      if (canceled) return;
      setDbReady(false);
      setMessage(error instanceof Error ? error.message : 'قاعدة البيانات غير جاهزة');
    }).finally(() => {
      if (canceled) return;
      setBusy(false);
      busyRef.current = false;
    });
    return () => { canceled = true; };
  }, [scope, loadStudio]);

  async function requestJson(url: string, method: 'PUT' | 'POST', data: unknown) {
    const response = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), cache: 'no-store',
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || 'فشل حفظ البيانات');
    return json;
  }
  async function saveDraft() {
    if (!dbReady || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await requestJson('/api/admin/receipt-studio', 'PUT', {
        scope, template, expectedRevision: draftRevision,
      });
      setDraftRevision(result.draftRevision);
      setDirty(false);
      setTestSent(false);
      setPhysicalVerified(false);
      setMessage('تم حفظ المسودة في SQL Server. التصميم المنشور لم يتغير.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ المسودة');
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function refreshAfterPublish() {
    const data = await loadStudio(scope);
    setHistory({ past: [], current: data.draft, future: [] });
    setPublishedVersion(data.publishedVersion);
    setDraftRevision(data.draftRevision);
    setVersions(data.history);
    setAssets(data.assets);
    setDirty(false);
    setSelectedIds([]);
    setSelectedId(null);
    setTestSent(false);
    setPhysicalVerified(false);
  }
  async function publish() {
    if (!dbReady || dirty || !testSent || !physicalVerified || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await requestJson('/api/admin/receipt-studio/publish', 'POST', {
        scope, expectedDraftRevision: draftRevision,
        physicalProofConfirmed: true,
      });
      await refreshAfterPublish();
      setMessage(`تم اعتماد الإصدار ${result.publishedVersion}. الفاتورة المنشورة هي اللي هتظهر للكاشير.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'فشل اعتماد التصميم'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function rollback() {
    if (!dbReady || rollbackTarget == null || busyRef.current || !window.confirm('تأكيد استعادة الإصدار السابق لكل فواتير هذا النطاق؟')) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await requestJson('/api/admin/receipt-studio/rollback','POST',{ scope, version: rollbackTarget });
      await refreshAfterPublish();
      setMessage(`تم نشر نسخة مستعادة بإصدار جديد #${result.publishedVersion}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'فشل استعادة الإصدار'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function printProof() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setTestSent(false); setPhysicalVerified(false);
    try {
      const result = await printHtmlViaLocalService({
        html: proofHtml, width: '72mm', receiptType: 'other',
        printer: 'default', requestId: createPrintRequestId('receipt-studio-demo'),
      });
      if (!result.ok) throw new Error(result.userMessage);
      setTestSent(true);
      setMessage('تم إرسال فاتورة اختبار إلى Windows. تأكد من الطباعة والقص قبل الاعتماد.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'فشل إرسال الطباعة التجريبية'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function uploadPng(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const image = await prepareThermalImage(file);
      let assetId: string;
      if (dbReady) {
        const body = new FormData();
        body.append('file', image.png);
        const response = await fetch('/api/admin/receipt-studio/assets', { method: 'POST', body });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || 'فشل رفع الصورة');
        assetId = String(json.assetId);
      } else {
        // Allow visual experimentation when the optional SQL schema is not installed.
        // This UUID cannot be published or saved without first uploading to the backend.
        assetId = crypto.randomUUID();
      }
      const parent = selected?.kind === 'group' ? selected.id : null;
      const candidate = addTreeNode(template, 'image', parent, assetId);
      if (candidate === template) throw new Error('الحد الأقصى 6 صور أو عمق المجموعة أكبر من المسموح');
      setAssets((previous) => ({ ...previous, [assetId]: image.dataUri }));
      const id = findInserted(candidate);
      busyRef.current = false;
      commit(candidate);
      busyRef.current = true;
      if (id) selectLayer(id);
      setMessage(dbReady
        ? 'تم إضافة الصورة وتحويلها لأبيض وأسود مناسب للطابعة. احفظ المسودة.'
        : 'الصورة موجودة في المعاينة مؤقتًا. حفظها يحتاج تفعيل قاعدة بيانات Receipt Studio.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تجهيز الصورة');
    } finally { busyRef.current = false; setBusy(false); }
  }

  const updateHeight = useCallback((mm: number) => setHeightMm((previous) => previous === mm ? previous : mm), []);

  function commit(candidate: ReceiptTemplateV1, rejectedMessage = 'الحركة دي هتخالف ترتيب الفاتورة الآمن.') {
    if (busyRef.current) return;
    if (candidate === template || JSON.stringify(candidate) === JSON.stringify(template)) {
      setMessage(rejectedMessage);
      return;
    }
    const validated = validateReceiptTemplateV1(candidate);
    if (!validated.ok) {
      setMessage(validated.errors[0] ?? 'التصميم غير صالح');
      return;
    }
    setHistory((current) => ({
      past: [...current.past.slice(-29), current.current],
      current: validated.template,
      future: [],
    }));
    setDirty(true); setTestSent(false); setPhysicalVerified(false);
    setMessage(null);
  }

  function selectLayer(id: string, additive = false) {
    if (!additive) {
      setSelectedId(id);
      setSelectedIds([id]);
      return;
    }
    setSelectedIds((previous) => {
      const next = previous.includes(id) ? previous.filter((key) => key !== id) : [...previous, id];
      setSelectedId(next[next.length - 1] ?? null);
      return next;
    });
  }
  function findInserted(candidate: ReceiptTemplateV1) {
    const previous = new Set(allReceiptNodes(template.blocks).map((b) => b.id));
    return allReceiptNodes(candidate.blocks).find((b) => !previous.has(b.id))?.id ?? null;
  }
  function commitAdded(candidate: ReceiptTemplateV1) {
    if (candidate === template) return commit(candidate);
    const id = findInserted(candidate);
    commit(candidate);
    if (id) selectLayer(id);
  }
  function changeLabel(id: string, field: ReceiptField, value: string) {
    const target = findReceiptNode(template.blocks, id);
    if (!target) return;
    commit(updateTreeNode(template, id, { fields: { ...target.fields, [field]: value } }));
    selectLayer(id);
  }
  function changeText(id: string, value: string) {
    commit(updateTreeNode(template, id, { text: value }));
    selectLayer(id);
  }
  function groupSelected() {
    const next = groupReceiptNodes(template, selectedIds);
    if (next === template) {
      setMessage('لازم تختار عنصرين أو أكثر من نفس المستوى، والمجموعة تفضل صالحة للطباعة.');
      return;
    }
    commitAdded(next);
  }
  function ungroupSelected() {
    if (!selected || selected.kind !== 'group') return;
    const parent = treeNodeParentId(template.blocks, selected.id);
    commit(ungroupReceiptNode(template, selected.id));
    const target = parent ? findReceiptNode(template.blocks, parent) : null;
    if (target) selectLayer(target.id);
    else { setSelectedId(null); setSelectedIds([]); }
  }
  function addNewNode(kind: 'text' | 'divider' | 'group') {
    const parentId = selected?.kind === 'group' ? selected.id : null;
    commitAdded(addTreeNode(template, kind, parentId));
  }
  function moveLayer(source: string, target: string, placement: TreePlacement) {
    commit(moveTreeNode(template, source, target, placement));
  }
  function duplicateLayer(id: string) {
    commitAdded(duplicateTreeNode(template, id));
  }
  function deleteSelected() {
    if (!selected) return;
    const candidate = removeTreeNode(template, selected.id);
    commit(candidate);
    if (candidate !== template) { setSelectedIds([]); setSelectedId(null); }
  }

  function changeBlock(patch: Partial<ReceiptBlockV1>) {
    if (!selected) return;
    commit(updateReceiptBlock(template, selected.id, patch));
  }

  function changeStyle(patch: NonNullable<ReceiptBlockV1['style']>) {
    if (!selected) return;
    changeBlock({ style: { ...selected.style, ...patch } });
  }

  function move(sourceId: string, targetId: string) {
    commit(reorderReceiptBlocks(template, sourceId, targetId));
  }

  function nudge(id: string, by: number) {
    const index = template.blocks.findIndex((block) => block.id === id);
    const next = template.blocks[index + by];
    if (index < 0 || !next) return;
    move(id, next.id);
  }

  function onDragStart(event: DragEvent<HTMLDivElement>, id: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
  }

  function onDrop(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    const source = event.dataTransfer.getData('text/plain') || draggedId;
    setDraggedId(null);
    if (source && source !== targetId) move(source, targetId);
  }

  function add(kind: 'text' | 'divider') {
    const candidate = addReceiptDecoration(template, kind);
    if (candidate === template) {
      setMessage('وصلت للحد الأقصى من عناصر الفاتورة.');
      return;
    }
    commit(candidate);
    setSelectedId(candidate.blocks[candidate.blocks.length - 1].id);
  }

  function undo() {
    setHistory((state) => {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), current: previous, future: [state.current, ...state.future] };
    });
    setDirty(true); setTestSent(false); setPhysicalVerified(false);
    setMessage(null);
  }

  function redo() {
    setHistory((state) => {
      if (!state.future.length) return state;
      return { past: [...state.past, state.current], current: state.future[0], future: state.future.slice(1) };
    });
    setDirty(true); setTestSent(false); setPhysicalVerified(false);
    setMessage(null);
  }

  function reset() {
    commit(freshTemplate(), 'أنت بالفعل على التصميم الافتراضي.');
    setSelectedId('brand');
  }

  const miniButton = 'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div dir="rtl" className="flex min-h-[calc(100vh-10rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
            <LayoutTemplate className="size-5"/>
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black text-foreground">Receipt Studio</h1>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {publishedVersion ? `منشور v${publishedVersion}` : 'مسودة غير منشورة'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">تصميم فواتير CUT الحرارية — 80mm رول / 72mm طباعة</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={undo} disabled={!history.past.length} title="تراجع">
            <Undo2 className="size-4"/> تراجع
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!history.future.length} title="إعادة">
            <Redo2 className="size-4"/> إعادة
          </Button>
          <Button variant="outline" size="sm" onClick={reset} disabled={!modified}><RotateCcw className="size-4"/> استعادة</Button>
          <Link href="/admin/settings/printing" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">
            <ArrowLeft className="size-4"/> إدارة الطباعة
          </Link>
        </div>
      </header>

      <section className="space-y-3 rounded-xl border border-border bg-muted/30 px-4 py-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Info className="size-4 shrink-0 text-muted-foreground"/>
            <span className="font-medium">نطاق التصميم</span>
            <select aria-label="نطاق التصميم" value={scope} disabled={busy}
              onChange={(event) => {
                const next = event.target.value as Scope;
                if (dirty && !window.confirm('هتخرج من المسودة غير المحفوظة. تكمل؟')) return;
                setScope(next);
              }}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="branch">الفرع الحالي فقط</option>
              <option value="tenant">كل فروع CUT (افتراضي)</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
              {!dbReady ? 'قاعدة البيانات غير جاهزة' : dirty ? 'تعديلات غير محفوظة' : `مسودة محفوظة #${draftRevision}`}
            </span>
            <Button size="sm" variant="outline" disabled={!dbReady || busy || !dirty} onClick={() => void saveDraft()}>
              حفظ المسودة
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setProofMode(!proofMode)}>
              {proofMode ? 'رجوع للمحرر' : 'معاينة حرارية'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void printProof()}>
              <Printer className="size-4"/> طباعة اختبار
            </Button>
            <Button size="sm" disabled={!dbReady || busy || dirty || !testSent || !physicalVerified} onClick={() => void publish()}>
              <Check className="size-4"/> اعتماد التصميم
            </Button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={physicalVerified} disabled={!testSent || busy}
            onChange={(event) => setPhysicalVerified(event.target.checked)}/>
          أؤكد أني شاهدت ورقة الاختبار وراجعت وضوحها وطولها والقص التلقائي
        </label>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">الإصدارات المعتمدة:</span>
          <select aria-label="الإصدار المراد استعادته" value={rollbackTarget ?? ''}
            onChange={(event) => setRollbackTarget(event.target.value ? Number(event.target.value) : null)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">اختر إصدار</option>
            {versions.map((version) => (
              <option key={version.version} value={version.version}>v{version.version} — {version.action}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={busy || rollbackTarget === null || !dbReady} onClick={() => void rollback()}>
            استعادة إصدار سابق
          </Button>
          <span className="text-[11px] text-muted-foreground">نشر إصدار جديد لا يمسح سجل النسخ القديمة.</span>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(360px,1fr)_275px]">
        {/* Block palette and layers */}
        <aside className="rounded-2xl border border-border bg-surface p-4 xl:sticky xl:top-4">
          <div className="mb-3 flex items-center gap-2"><Layers className="size-4 text-primary"/><h2 className="font-bold">طبقات الفاتورة</h2></div>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">اسحب الأقسام لتغيير ترتيبها أو استخدم الأسهم. جدول الخدمات يفضل قبل الإجمالي دائمًا.</p>
          <div className="space-y-2">
            {template.blocks.map((block, index) => {
              const active = selectedId === block.id;
              return (
                <div
                  key={block.id}
                  draggable
                  onDragStart={(event) => onDragStart(event, block.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDrop(event, block.id)}
                  className={`flex items-center gap-2 rounded-xl border p-2 transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/50'} ${draggedId === block.id ? 'opacity-50' : ''}`}
                >
                  <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden/>
                  <button type="button" onClick={() => setSelectedId(block.id)} className="min-w-0 flex-1 text-right">
                    <span className="block truncate text-xs font-semibold">{LABELS[block.kind]}</span>
                    <span className="text-[10px] text-muted-foreground">{REQUIRED.has(block.kind) ? 'أساسي' : block.enabled ? 'ظاهر' : 'مخفي'}</span>
                  </button>
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <button type="button" aria-label={`رفع ${LABELS[block.kind]}`} onClick={() => nudge(block.id, -1)} disabled={index === 0} className="rounded p-0.5 hover:bg-muted disabled:opacity-20"><ArrowUp className="size-3.5"/></button>
                    <button type="button" aria-label={`خفض ${LABELS[block.kind]}`} onClick={() => nudge(block.id, 1)} disabled={index === template.blocks.length - 1} className="rounded p-0.5 hover:bg-muted disabled:opacity-20"><ArrowDown className="size-3.5"/></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-3 text-xs font-bold text-muted-foreground">إضافة عنصر</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => add('text')}><Type className="size-4"/> نص</Button>
              <Button variant="outline" size="sm" onClick={() => add('divider')}><Minus className="size-4"/> فاصل</Button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground hover:bg-muted">
              <ImageIcon className="size-4"/><span>رفع PNG (أقل من 150KB)</span>
              <input type="file" accept="image/png" className="sr-only" disabled={!dbReady || busy} onChange={(event) => void uploadPng(event)}/>
            </label>
          </div>
        </aside>

        {/* Canvas */}
        <main className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="font-bold">معاينة حية</h2>
              <p className="mt-1 text-xs text-muted-foreground">معاينة شاشة قابلة للتعديل — لا تُرسل للطابعة</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Ruler className="size-4 text-muted-foreground"/>
              <span className="font-mono">{`72 × ${heightMm || '—'} mm`}</span>
              <select
                aria-label="تكبير المعاينة"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
              >
                <option value={80}>80%</option><option value={100}>100%</option>
                <option value={110}>110%</option><option value={125}>125%</option>
                <option value={150}>150%</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-border p-3" aria-label="عدد الخدمات في معاينة الفاتورة">
            {FIXTURES.map(({ value, label }) => (
              <button key={value} type="button" onClick={() => setScenario(value)} className={`${miniButton} ${scenario === value ? 'border-foreground bg-foreground text-background hover:bg-foreground' : ''}`}>
                {scenario === value && <Check className="ml-1 size-3"/>}{label}
              </button>
            ))}
          </div>
          <div
            className="min-h-[650px] overflow-auto px-4 py-8 sm:px-6"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(140,140,140,0.24) 1px, transparent 0)', backgroundSize: '18px 18px' }}
          >
            <div className="flex min-w-max flex-col items-center">
              <div className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground">THERMAL PAPER · XP-80</div>
              <div style={{ zoom: zoom / 100, width: '80mm', padding: '0 4mm', backgroundColor: '#efefef', boxShadow: '0 18px 40px rgba(0,0,0,.17)' }}>
                {proofMode ? (
                  <iframe title="Thermal proof" sandbox="" srcDoc={proofHtml} style={{
                    width: '72mm', height: Math.min(1500, Math.max(390, heightMm * 3.9 + 70)),
                    border: 0, display: 'block', filter: 'grayscale(1) contrast(2.5)', background: '#fff',
                  }}/>
                ) : (
                  <ReceiptStudioPreview template={template} scenario={scenario} selectedId={selectedId}
                    onSelect={setSelectedId} onHeight={updateHeight} assets={assets}/>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><Printer className="size-3.5"/> الطول بيتحسب تلقائيًا حسب المحتوى</div>
            </div>
          </div>
        </main>

        {/* Inspector */}
        <aside className="rounded-2xl border border-border bg-surface p-4 xl:sticky xl:top-4">
          <div className="mb-4 flex items-center gap-2"><Settings2 className="size-4 text-primary"/><h2 className="font-bold">خصائص التصميم</h2></div>
          <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span>طول الفاتورة</span>
              <span className="font-mono text-xs">Auto</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">الطول تلقائي لتجنب الفراغ أو قص الخدمات. تقدر تحدد حد أدنى بس.</p>
            <label htmlFor="minimum-paper" className="mb-2 flex items-center justify-between text-xs">
              <span>الحد الأدنى</span><span className="font-mono">{template.paper.minHeightMm ?? 0} mm</span>
            </label>
            <input
              id="minimum-paper" type="range" min={0} max={260} step={5}
              value={template.paper.minHeightMm ?? 0}
              onChange={(event) => commit(setReceiptMinHeight(template, Number(event.target.value)))}
              className="w-full accent-primary"
            />
            <div className="mt-2 text-[11px] text-muted-foreground">الطول الفعلي للمعاينة: {heightMm}mm</div>
          </div>

          {selected ? (
            <div key={selected.id} className="space-y-4 border-t border-border pt-4">
              <div>
                <div className="text-sm font-bold">{LABELS[selected.kind]}</div>
                <p className="text-xs text-muted-foreground">اختار عنصر من الفاتورة أو قائمة الطبقات.</p>
              </div>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">{selected.enabled ? <Eye className="size-4"/> : <EyeOff className="size-4"/>} إظهار العنصر</span>
                <Switch checked={selected.enabled} onCheckedChange={(checked) => changeBlock({ enabled: checked })} disabled={REQUIRED.has(selected.kind)}/>
              </label>
              {selected.kind === 'text' && (
                <label className="block text-xs">
                  <span className="mb-2 block font-semibold">النص</span>
                  <Input
                    value={selected.text ?? ''}
                    maxLength={180}
                    onChange={(event) => changeBlock({ text: event.target.value })}
                    dir="auto"
                    aria-label="النص داخل الإيصال"
                  />
                </label>
              )}
              <div>
                <label htmlFor="block-font" className="mb-2 flex justify-between text-xs font-semibold">
                  <span>حجم الخط</span><span>{selected.style?.fontSizePx ?? 12} px</span>
                </label>
                <input id="block-font" type="range" min={9} max={30} step={1}
                  value={selected.style?.fontSizePx ?? 12}
                  onChange={(event) => changeStyle({ fontSizePx: Number(event.target.value) })}
                  className="w-full accent-primary"
                />
              </div>
              <label className="block text-xs">
                <span className="mb-2 block font-semibold">سُمك الخط</span>
                <select value={selected.style?.fontWeight ?? 600}
                  onChange={(event) => changeStyle({ fontWeight: Number(event.target.value) as 400 | 600 | 700 | 800 | 900 })}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value={400}>Regular</option><option value={600}>Semi Bold</option>
                  <option value={700}>Bold</option><option value={800}>Extra Bold</option><option value={900}>Black</option>
                </select>
              </label>
              <div>
                <label htmlFor="block-gap" className="mb-2 flex justify-between text-xs font-semibold">
                  <span>المسافة بعد العنصر</span><span>{selected.style?.gapAfterMm ?? 1} mm</span>
                </label>
                <input id="block-gap" type="range" min={0} max={8} step={0.5}
                  value={selected.style?.gapAfterMm ?? 1}
                  onChange={(event) => changeStyle({ gapAfterMm: Number(event.target.value) })}
                  className="w-full accent-primary"
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold">المحاذاة</p>
                <div className="grid grid-cols-3 gap-1" dir="ltr">
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button key={align} type="button"
                      className={`${miniButton} ${(selected.style?.align ?? 'left') === align ? 'border-foreground bg-foreground text-background hover:bg-foreground' : ''}`}
                      onClick={() => changeStyle({ align })}
                    >{align}</button>
                  ))}
                </div>
              </div>
              {['text', 'divider', 'image'].includes(selected.kind) && (
                <Button variant="destructive" size="sm" className="w-full" onClick={() => {
                  commit(deleteReceiptDecoration(template, selected.id));
                  setSelectedId(null);
                }}>حذف العنصر</Button>
              )}
              {REQUIRED.has(selected.kind) && <p className="flex gap-2 text-[11px] text-muted-foreground"><LockKeyhole className="size-3.5 shrink-0"/> العنصر أساسي لضمان فاتورة صحيحة.</p>}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              اختار عنصر من التصميم علشان تعدّل خصائصه.
            </div>
          )}
        </aside>
      </div>

      {message && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <Info className="size-4"/>{message}
          <button type="button" className="mr-auto text-xs underline" onClick={() => setMessage(null)}>إغلاق</button>
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">Receipt Studio · SQL Drafts · Versioned Publishing · Safe XP-80 Print · No Chrome print dialog</p>
    </div>
  );
}
