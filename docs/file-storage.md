# File storage (S3 presigned URLs)

Graddly stores user-uploaded files in **Amazon S3** using **presigned URLs**. The API never receives file bytes; clients upload and download directly against S3.

## Configuration

| Variable                          | Default     | Purpose                                     |
| --------------------------------- | ----------- | ------------------------------------------- |
| `STORAGE_PROVIDER`                | `noop`      | `noop` (local/test) or `s3` (AWS)           |
| `AWS_REGION`                      | `eu-west-2` | S3 region                                   |
| `S3_BUCKET`                       | —           | Bucket name per environment                 |
| `AWS_ACCESS_KEY_ID`               | —           | Optional explicit credentials for local dev |
| `AWS_SECRET_ACCESS_KEY`           | —           | Pair with access key locally                |
| `S3_PRESIGN_UPLOAD_TTL_SECONDS`   | `900`       | Upload URL lifetime                         |
| `S3_PRESIGN_DOWNLOAD_TTL_SECONDS` | `300`       | Download URL lifetime                       |

When `STORAGE_PROVIDER=noop`, the API returns fake `https://noop-storage.local/...` URLs (no AWS required).

## Object key layout

All keys are scoped under the active organisation from the JWT:

```
orgs/{organisationId}/learners/{learnerId}/{category}/{objectId}/{filename}
orgs/{organisationId}/{category}/{objectId}/{filename}
```

- **category**: `evidence`, `signature`, `export`, `attachment`, `general`
- **objectId**: UUID generated per presign request
- **filename**: sanitized basename (max 200 chars)

Download requests are rejected unless the key starts with `orgs/{activeOrgId}/`.

## HTTP API

Requires `Authorization: Bearer <token>` and an active organisation context.

| Method | Path                           | Body                                                                         |
| ------ | ------------------------------ | ---------------------------------------------------------------------------- |
| `POST` | `/api/v1/storage/upload-url`   | `filename`, `contentType`, `contentLength`, `category`, optional `learnerId` |
| `POST` | `/api/v1/storage/download-url` | `key` (from upload response)                                                 |

### Upload flow

1. `POST /api/v1/storage/upload-url` with declared mime type and size.
2. `PUT` the file to `uploadUrl` with headers matching `contentType` and `contentLength`.
3. Persist `key` in your domain record (evidence, attachment, etc.) for later download.
4. `POST /api/v1/storage/download-url` with `key` when a signed download link is needed.

### Uploading from a browser

The PUT in step 2 goes from the browser straight to S3, not through the API, so
two things outside this codebase have to be right or no upload can succeed.

**1. Bucket CORS.** `Content-Type: image/png` is not a CORS-simple value, so the
browser sends a preflight `OPTIONS` first. If the bucket has no rule covering
the calling origin, the browser blocks the request before it is sent and
`fetch` throws `TypeError: Failed to fetch` -- the portals report this as
"Couldn't reach storage. The upload was blocked before sending". Nothing
reaches S3, so there is no access log to find.

Every portal origin needs listing, and they change whenever a domain is added:

```json
[
  {
    "AllowedOrigins": [
      "https://employer.gradlly.co.uk",
      "https://provider.gradlly.co.uk",
      "https://apprentice.gradlly.co.uk",
      "https://flow.gradlly.co.uk",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
      "http://localhost:3004"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

```bash
aws s3api put-bucket-cors --bucket <bucket> --cors-configuration file://cors.json
aws s3api get-bucket-cors --bucket <bucket>   # confirm
```

Vercel preview deployments get a new hostname each time, so they are not covered
by a fixed list; test uploads on a stable domain.

**2. No payload checksum on the presigned URL.** AWS SDK v3 from v3.729
defaults `requestChecksumCalculation` to `WHEN_SUPPORTED`, which writes a CRC32
of the request payload into the signed URL. A presign has no payload, so the
value is `x-amz-checksum-crc32=AAAAAA==` -- the CRC32 of zero bytes -- and S3
rejects every non-empty file the browser then sends. `s3-storage.provider.ts`
sets `WHEN_REQUIRED` to prevent this, and a spec asserts it; do not remove it
when upgrading the SDK.

The two fail differently and it is worth knowing which you are looking at: a
CORS fault never reaches S3 ("blocked before sending"), a checksum fault does
and comes back as an HTTP 400.

## Validation

| Rule               | Limit                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Max file size      | **25 MB** (`26_214_400` bytes)                                                                                                         |
| Allowed MIME types | `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, Word/Excel documents, `text/plain`, `text/csv` |

Validation runs when requesting an upload URL. S3 presigned PUT binds `Content-Type` and `Content-Length` so clients cannot change them after presigning.

## Security notes

- Cross-organisation download is blocked by key prefix checks.
- When creating KSB file evidence, the API validates that the storage key belongs to the organisation and matches `learners/{apprenticeId}/evidence/`. Generic presign still only format-checks `learnerId`.
- Use short TTLs in production; rotate AWS credentials via your secret manager.
