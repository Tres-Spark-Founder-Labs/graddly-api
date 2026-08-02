# Response envelope, and file downloads

Every JSON endpoint returns:

```json
{ "message": "Success", "data": { ... } }
```

Paginated endpoints add `meta`. The message comes from `@ResponseMessage()`.
`ResponseInterceptor` applies this globally.

## File downloads are not wrapped

A handler that has already set a **non-JSON `Content-Type`** is serving a file,
and the interceptor leaves its return value alone. Every file route must set
that header anyway, so this needs no extra thought:

```ts
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="x.csv"');
return csv;
```

`@SkipResponseEnvelope()` still exists for handlers that set no header of their
own.

### Why the rule is what it is

It used to be `@SkipResponseEnvelope()` plus a hardcoded
`request.url.includes('/audit/export')` check. That protected exactly the one
route someone had noticed, and **three CSV downloads shipped wrapped**:

```
{"message":"Success","data":"Provider,Active apprentices,Completions,…
```

A `.csv` no spreadsheet opens, returned with a `200` and a body — which is
indistinguishable from success to any test asserting only on status.

One of them *had* an e2e test:

```ts
expect(res.text).toContain('enrolmentId');   // passes on the wrapped body too
```

Keying off the Content-Type header means the next file download is protected by
default rather than by remembering a decorator.

## Returning binary

Return a **`StreamableFile`**, not a `Buffer`. Nest serialises an unrecognised
return value with `res.json()`, so a bare buffer becomes:

```json
{"type":"Buffer","data":[80,75,3,4,...]}
```

which downloads happily and then fails to open.

```ts
return new StreamableFile(buffer, {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  disposition: 'attachment; filename="report.docx"',
});
```

## Testing a file route

Assert the **shape** of the response, not that the right words appear somewhere
in it:

```ts
expect(res.headers['content-type']).toMatch(/text\/csv/);
expect(res.headers['content-disposition']).toContain('attachment');
expect(res.text.startsWith('{')).toBe(false);
expect(res.text.split('\n')[0]).toContain('firstColumn');  // header row is line 1
```

For binary, check the format's magic bytes: `%PDF`, `PK` (zip, and therefore
`.docx`/`.xlsx`).

`src/common/interceptors/response.interceptor.spec.ts` pins the interceptor
behaviour for CSV, Word, PDF, JSON and the decorator path.
