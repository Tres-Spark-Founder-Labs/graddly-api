import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3010';
const TEST_EMAIL = __ENV.TEST_EMAIL || '';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || '';
const ORG_ID = __ENV.ORG_ID || '';

export const options = {
  // Keep concurrent load low: default API throttle is 100 req/min.
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:read}': ['p(95)<500'],
  },
};

export function setup() {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error('Set TEST_EMAIL and TEST_PASSWORD env vars (run yarn load:setup)');
  }

  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(res, { 'setup login 200': (r) => r.status === 200 });

  if (res.status !== 200) {
    throw new Error(`Login failed (${res.status}): ${res.body}`);
  }

  const body = res.json();
  const token = body?.data?.accessToken;
  if (!token) {
    throw new Error('Login response missing accessToken');
  }

  return { token };
}

export default function (data) {
  const authHeaders = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
    ...(ORG_ID ? { 'x-organisation-id': ORG_ID } : {}),
  };

  const otjRes = http.get(`${BASE_URL}/api/v1/otj-log-entries?perPage=20`, {
    headers: authHeaders,
    tags: { scenario: 'read' },
  });
  check(otjRes, { 'otj list 200': (r) => r.status === 200 });

  const notificationsRes = http.get(
    `${BASE_URL}/api/v1/notifications?perPage=20&unreadOnly=true`,
    { headers: authHeaders, tags: { scenario: 'read' } },
  );
  check(notificationsRes, { 'notifications 200': (r) => r.status === 200 });

  sleep(2);
}
