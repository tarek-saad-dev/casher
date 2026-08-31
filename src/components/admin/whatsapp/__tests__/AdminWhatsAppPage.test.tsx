// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AdminWhatsAppPage from '@/components/admin/whatsapp/AdminWhatsAppPage';
import type { MessageTemplateSource } from '@/modules/messaging/domain/templateTypes';

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    viewBranch: {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
    },
    activeBranch: {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
    },
    loading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="restore-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

type TemplateVariable = {
  key: string;
  token: string;
  label: string;
  sample?: string;
};

type TemplateView = {
  templateKey: string;
  channel: 'whatsapp';
  language: 'ar';
  label: string;
  description: string;
  availableVariables: TemplateVariable[];
  effectiveContent: string;
  effectiveSource: MessageTemplateSource;
  branchOverride: {
    id: number;
    content: string;
    version: number;
    isActive: boolean;
  } | null;
  globalTemplate: {
    id: number;
    content: string;
    version: number;
    isActive: boolean;
  } | null;
};

const KEY = 'sale.customer_receipt';

const API_VARIABLES: TemplateVariable[] = [
  { key: 'customerName', token: '{{customerName}}', label: 'اسم العميل', sample: 'طارق' },
  { key: 'invoiceNumber', token: '{{invoiceNumber}}', label: 'رقم الفاتورة', sample: 'INV-10025' },
];

function globalTemplate(overrides: Partial<TemplateView> = {}): TemplateView {
  return {
    templateKey: KEY,
    channel: 'whatsapp',
    language: 'ar',
    label: 'رسالة فاتورة العميل',
    description: 'تُرسل للعميل بعد تسجيل الفاتورة',
    availableVariables: API_VARIABLES,
    effectiveContent: 'مرحبا {{customerName}}',
    effectiveSource: 'global_db',
    branchOverride: null,
    globalTemplate: { id: 1, content: 'مرحبا {{customerName}}', version: 1, isActive: true },
    ...overrides,
  };
}

function branchTemplate(content = 'نص الفرع {{customerName}}'): TemplateView {
  return globalTemplate({
    effectiveContent: content,
    effectiveSource: 'branch_db',
    branchOverride: { id: 2, content, version: 1, isActive: true },
  });
}

type FetchCall = { url: string; method: string; body?: Record<string, unknown> };

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('AdminWhatsAppPage', () => {
  const calls: FetchCall[] = [];
  let current: TemplateView;
  let statusMode: 'ok' | 'fail' = 'ok';
  let templatesMode: 'ok' | 'unauthorized' | 'db-error' = 'ok';
  let previewMode: 'ok' | 'validation' = 'ok';

  beforeEach(() => {
    vi.restoreAllMocks();
    calls.length = 0;
    current = globalTemplate();
    statusMode = 'ok';
    templatesMode = 'ok';
    previewMode = 'ok';

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/api/admin/whatsapp/status')) {
        if (statusMode === 'fail') return jsonResponse(500, { error: 'gateway down' });
        return jsonResponse(200, {
          integrationEnabled: true,
          botHealth: { ok: true, httpStatus: 200 },
          status: {
            available: true,
            connected: true,
            chromeConnected: true,
            whatsappReady: true,
            whatsappTabFound: true,
          },
        });
      }

      if (url.includes('/preview')) {
        if (previewMode === 'validation') {
          return jsonResponse(400, {
            error: 'متغير غير معروف: {{unknown}}',
            code: 'UNKNOWN_PLACEHOLDER',
          });
        }
        return jsonResponse(200, { ok: true, rendered: `معاينة: ${body?.content ?? ''}` });
      }

      if (url.includes('/api/admin/whatsapp/templates/') && method === 'PUT') {
        current = branchTemplate(String(body?.content ?? ''));
        return jsonResponse(200, { ok: true, template: current });
      }

      if (url.includes('/api/admin/whatsapp/templates/') && method === 'DELETE') {
        current = globalTemplate();
        return jsonResponse(200, { ok: true, template: current });
      }

      if (url.includes('/api/admin/whatsapp/templates/') && method === 'GET') {
        return jsonResponse(200, { ok: true, template: current });
      }

      if (url.endsWith('/api/admin/whatsapp/templates') || url.endsWith('/api/admin/whatsapp/templates/')) {
        if (templatesMode === 'unauthorized') {
          return jsonResponse(401, { error: 'غير مصرح — يرجى تسجيل الدخول', code: 'SESSION_REQUIRED' });
        }
        if (templatesMode === 'db-error') {
          return jsonResponse(500, { error: 'تعذر الاتصال بقاعدة البيانات' });
        }
        return jsonResponse(200, { ok: true, templates: [current] });
      }

      return jsonResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
  });

  it('loads templates from the Admin API and shows the effective source', async () => {
    render(<AdminWhatsAppPage />);

    expect(await screen.findByText('رسالة فاتورة العميل')).toBeInTheDocument();
    expect(screen.getByText('تُرسل للعميل بعد تسجيل الفاتورة')).toBeInTheDocument();
    expect(screen.getByText('الرسالة العامة')).toBeInTheDocument();
    expect(screen.queryByText(KEY)).not.toBeInTheDocument();

    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/admin/whatsapp/templates')).toBe(
      true,
    );
  });

  it('lets a global template be edited locally without sending BranchID', async () => {
    render(<AdminWhatsAppPage />);
    const editor = await screen.findByRole('textbox');
    expect(editor).toHaveValue('مرحبا {{customerName}}');

    fireEvent.change(editor, { target: { value: 'نص الفرع {{customerName}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ رسالة الفرع' }));

    await waitFor(() => {
      expect(screen.getByText('تم حفظ رسالة الفرع')).toBeInTheDocument();
    });
    expect(await screen.findByText('رسالة مخصصة لهذا الفرع')).toBeInTheDocument();
    expect(screen.getByText('هذا الفرع لديه تخصيص')).toBeInTheDocument();

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe(`/api/admin/whatsapp/templates/${encodeURIComponent(KEY)}`);
    expect(put?.body).toEqual({ language: 'ar', content: 'نص الفرع {{customerName}}' });
    expect(JSON.stringify(put?.body)).not.toMatch(/BranchID|branchId/i);
  });

  it('previews unsaved editor text and shows validation errors', async () => {
    render(<AdminWhatsAppPage />);
    const editor = await screen.findByRole('textbox');
    fireEvent.change(editor, { target: { value: 'نص غير محفوظ {{customerName}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'معاينة' }));

    expect(await screen.findByText('معاينة: نص غير محفوظ {{customerName}}')).toBeInTheDocument();
    const preview = calls.find((c) => c.method === 'POST' && c.url.includes('/preview'));
    expect(preview?.body).toEqual({ content: 'نص غير محفوظ {{customerName}}' });

    previewMode = 'validation';
    fireEvent.change(editor, { target: { value: 'مرحبا {{unknown}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'معاينة' }));
    expect(await screen.findByText('متغير غير معروف: {{unknown}}')).toBeInTheDocument();
  });

  it('restores the global message with DELETE and does not say delete', async () => {
    current = branchTemplate();
    render(<AdminWhatsAppPage />);

    expect(await screen.findByText('رسالة مخصصة لهذا الفرع')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'استخدام الرسالة العامة' }));
    expect(screen.getByTestId('restore-dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /حذف/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'تأكيد استخدام الرسالة العامة' }));
    await waitFor(() => {
      expect(screen.getByText('تم إلغاء تخصيص الفرع')).toBeInTheDocument();
    });
    expect(await screen.findByText('الرسالة العامة')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('مرحبا {{customerName}}');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('renders variables from API metadata', async () => {
    render(<AdminWhatsAppPage />);
    expect(await screen.findByText('{{customerName}}')).toBeInTheDocument();
    expect(screen.getByText('اسم العميل')).toBeInTheDocument();
    expect(screen.getByText('{{invoiceNumber}}')).toBeInTheDocument();
    expect(screen.getByText('اسم العميل').closest('button')).toHaveTextContent('{{customerName}}');
  });

  it('keeps templates usable when status fails', async () => {
    statusMode = 'fail';
    render(<AdminWhatsAppPage />);

    expect(await screen.findByText('رسالة فاتورة العميل')).toBeInTheDocument();
    expect(screen.getByText('حالة واتساب غير متاحة حالياً. يمكنك متابعة إدارة الرسائل بشكل طبيعي.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('مرحبا {{customerName}}');
  });

  it('renders connected state for the exact Phase 8 production status payload', async () => {
    render(<AdminWhatsAppPage />);

    expect(await screen.findByText('واتساب متصل وجاهز')).toBeInTheDocument();
    expect(screen.getByText('الخدمة متاحة')).toBeInTheDocument();
    expect(screen.getByText('Chrome متصل')).toBeInTheDocument();
    expect(screen.getByText('جاهز')).toBeInTheDocument();
    expect(screen.getByText('تاب واتساب موجود')).toBeInTheDocument();
  });

  it('shows degraded headline when gateway is up but WhatsApp is not ready', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });

      if (url.includes('/api/admin/whatsapp/status')) {
        return jsonResponse(200, {
          integrationEnabled: true,
          botHealth: { ok: true, httpStatus: 200 },
          status: {
            available: true,
            connected: false,
            chromeConnected: true,
            whatsappReady: false,
            whatsappTabFound: false,
          },
        });
      }
      if (url.endsWith('/api/admin/whatsapp/templates') || url.endsWith('/api/admin/whatsapp/templates/')) {
        return jsonResponse(200, { ok: true, templates: [current] });
      }
      return jsonResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    render(<AdminWhatsAppPage />);
    expect(await screen.findByText('الخدمة تعمل ولكن واتساب غير جاهز')).toBeInTheDocument();
    expect(screen.queryByText('حالة واتساب غير متاحة حالياً. يمكنك متابعة إدارة الرسائل بشكل طبيعي.')).not.toBeInTheDocument();
  });

  it('shows unauthorized template errors using existing copy', async () => {
    templatesMode = 'unauthorized';
    render(<AdminWhatsAppPage />);

    expect(await screen.findByText('غير مصرح — يرجى تسجيل الدخول')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
  });

  it('shows a clear error when template APIs cannot reach the database', async () => {
    templatesMode = 'db-error';
    render(<AdminWhatsAppPage />);

    expect(await screen.findByText('تعذر الاتصال بقاعدة البيانات')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('never calls the WhatsApp Gateway from the UI', async () => {
    render(<AdminWhatsAppPage />);
    const editor = await screen.findByRole('textbox');
    fireEvent.change(editor, { target: { value: 'نص الفرع {{customerName}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ رسالة الفرع' }));
    fireEvent.click(screen.getByRole('button', { name: 'معاينة' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    expect(calls.every((c) => c.url.startsWith('/api/admin/whatsapp/'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/api/whatsapp/send'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/api/admin/whatsapp/test-send'))).toBe(false);
  });

  it('wires the native admin route, nav, guard, and does not import the gateway', () => {
    const root = process.cwd();
    const page = readFileSync(path.join(root, 'src/app/admin/whatsapp/page.tsx'), 'utf8');
    const layout = readFileSync(path.join(root, 'src/app/admin/whatsapp/layout.tsx'), 'utf8');
    const ui = readFileSync(
      path.join(root, 'src/components/admin/whatsapp/AdminWhatsAppPage.tsx'),
      'utf8',
    );
    const nav = readFileSync(path.join(root, 'src/components/layout/nav-config.ts'), 'utf8');
    const registry = readFileSync(path.join(root, 'src/lib/pages-registry.ts'), 'utf8');

    expect(page).toContain('AdminWhatsAppPage');
    expect(layout).toContain('PageGuard');
    expect(layout).toContain('/admin/whatsapp');
    expect(nav).toContain("title: 'واتساب'");
    expect(nav).toContain("href: '/admin/whatsapp/inbox'");
    expect(nav).toContain("href: '/admin/whatsapp'");
    expect(registry).toContain("key: 'admin.whatsapp.inbox'");
    expect(registry).toContain("path: '/admin/whatsapp/inbox'");
    expect(registry).toContain("key: 'admin.whatsapp'");
    expect(registry).toContain("path: '/admin/whatsapp'");
    expect(ui).not.toContain("@/lib/integrations/whatsapp");
    expect(ui).not.toContain('/api/whatsapp/send');
    expect(ui).not.toContain('iframe');
  });
});
