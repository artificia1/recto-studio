const visitorKey = 'recto_site_visitor';
const visitorId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Count a load of the public website with an anonymous, first-party browser ID. */
export async function recordWebsiteVisit(endpoint: string): Promise<void> {
  const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (privacy.globalPrivacyControl || privacy.doNotTrack === '1') return;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/visit' || url.search || url.hash) return;
    let id = localStorage.getItem(visitorKey);
    if (!id || !visitorId.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(visitorKey, id);
    }
    await fetch(url, {
      method: 'POST',
      body: id,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      keepalive: true,
    });
  } catch { /* Counting is optional and must never interrupt the editor. */ }
}
