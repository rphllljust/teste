import { z } from 'zod';

const config = z.object({
  baseUrl: z.string().url().transform(v => v.replace(/\/$/, '')),
  token: z.string().min(16),
}).safeParse({
  baseUrl: process.env.OFBIZ_BASE_URL,
  token: process.env.OFBIZ_SERVICE_TOKEN,
});

export class OfbizUnavailable extends Error {}

export async function ofbizRequest<T>(path: string, init: RequestInit = {}) {
  if (!config.success) throw new OfbizUnavailable('Integração OFBiz não configurada no ambiente.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${config.data.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.data.token}`,
        ...(init.headers ?? {}),
      },
    });
    const body = await response.text();
    let parsed: unknown;
    try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { message: body.slice(0, 500) }; }
    if (!response.ok) throw new OfbizUnavailable(`OFBiz respondeu HTTP ${response.status}.`);
    return parsed as T;
  } catch (error) {
    if (error instanceof OfbizUnavailable) throw error;
    throw new OfbizUnavailable('Não foi possível alcançar o serviço OFBiz.');
  } finally { clearTimeout(timeout); }
}
