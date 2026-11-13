# Website visit counts

The optional counter records one visit per reported page load. A random ID
stored in the browser lets it deduplicate visits from the same browser profile.
The database stores the total number of visits and one keyed hash per browser.
The counter does not store IP addresses, user agents, referrers, page paths,
timestamps, documents, or accounts.

Unique visitors means distinct browser profiles. Using multiple devices or
clearing site storage can count a person more than once. Privacy settings,
blocked requests, and failures can reduce the totals. Treat these figures as
approximate website usage, since automated requests may also affect counts.

## Enable counting on GitHub Pages

GitHub Pages hosts the static app. The shared counter runs in a separate
Cloudflare Worker with a D1 database.

1. From this directory, run `npx wrangler login` and
   `npx wrangler d1 create recto-visits`. Use the returned database ID in
   `wrangler.toml`. The configured `SITE_ORIGIN` must exactly match the
   origin of the website, including the scheme.
2. Run `npx wrangler d1 migrations apply recto-visits --remote`, then
   `npx wrangler deploy`.
3. Generate two different high-entropy secrets, for example by running
   `node -p "require('node:crypto').randomBytes(32).toString('hex')"` twice.
   Set them with `npx wrangler secret put VISITOR_KEY` and
   `npx wrangler secret put TOTALS_TOKEN`. Keep `VISITOR_KEY` stable to
   continue deduplicating existing browsers. Keep both values out of the
   frontend, repository, and build variables.
4. Set the `VITE_VISIT_COUNTER_URL` GitHub Actions repository variable to
   the deployed HTTPS URL ending in `/visit`. Redeploy GitHub Pages with
   the `Deploy Studio to GitHub Pages` workflow. The desktop app remains
   excluded.

See the [D1 setup guide](https://developers.cloudflare.com/d1/get-started/)
and [Worker secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/)
for platform setup.

## Read totals

From a shell with `RECTO_COUNTER_TOKEN` set to your `TOTALS_TOKEN`, run
the following command using your Worker URL.

```sh
curl --fail --header "Authorization: Bearer $RECTO_COUNTER_TOKEN" \
  https://recto-visit-counter.example.workers.dev/totals
```

The response is JSON with `totalVisits` and `uniqueVisitors`.
The totals endpoint is private and does not accept cross-origin browser
requests. Leave request logging disabled if you want the counter deployment
to store only the database contents described above.
