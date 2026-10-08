import 'server-only';

/**
 * Path of the current request as stamped by the edge proxy (`x-pathname`, overwritten for every
 * session-required request). Null outside a request scope (scripts, tests, workers).
 */
export async function currentRequestPathname(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    const list = await headers();
    return list.get('x-pathname');
  } catch {
    return null;
  }
}
