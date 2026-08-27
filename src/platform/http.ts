/**
 * Fetching, from whichever side of the bridge this copy is on.
 *
 * THE ONE DIFFERENCE THAT MATTERS. A browser will not read gencon.com: it
 * sends no `Access-Control-Allow-Origin`, so the schedule has to be
 * imported by a build machine and served from this project's own host. A
 * native request leaves from native code, where the same-origin policy does
 * not apply — so an installed app can page Gen Con's own API directly, and
 * keeps working when every piece of this project's infrastructure is gone.
 * That is the difference this module exists to expose, and the only one.
 *
 * Both implementations answer the same shape, and both treat a refused
 * network as a thrown error rather than an empty answer — the callers here
 * all have a "keep what you have" branch, and an outage that reads as an
 * empty catalogue is the one failure mode that would silently empty an app.
 */

import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './index';

export interface TextResponse {
  status: number;
  body: string;
}

/** A page as text. Throws when the request could not be made at all. */
export async function fetchText(
  url: string,
  headers: Record<string, string> = {},
): Promise<TextResponse> {
  if (isNative()) {
    const response = await CapacitorHttp.get({ url, headers, responseType: 'text' });
    return {
      status: response.status,
      body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    };
  }
  const response = await fetch(url, { headers, cache: 'no-cache' });
  return { status: response.status, body: await response.text() };
}

/**
 * A page as JSON, or a null body where it did not parse.
 *
 * Null rather than a throw for unparseable bytes, because "the host
 * answered with something that is not this" is the same to every caller as
 * "the host did not answer": both keep what they already hold.
 */
export async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const { status, body } = await fetchText(url, { Accept: 'application/json', ...headers });
  try {
    return { status, body: JSON.parse(body) };
  } catch {
    return { status, body: null };
  }
}
