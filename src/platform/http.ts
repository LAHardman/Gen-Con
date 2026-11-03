export interface TextResponse {
  status: number;
  body: string;
}

/** A page as text. Throws when the request could not be made at all. */
export async function fetchText(
  url: string,
  headers: Record<string, string> = {},
): Promise<TextResponse> {
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
