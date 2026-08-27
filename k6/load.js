import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const p95 = new Trend('p95_latency');

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '60s', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000';

export default function () {
  const r1 = http.get(`${BASE}/api/health`);
  check(r1, { 'health 200': (r) => r.status === 200 });
  p95.add(r1.timings.duration);
  sleep(1);

  const r2 = http.get(`${BASE}/api/jobs?limit=10`);
  // may be 401 without auth — just measure
  check(r2, { 'jobs list <500': (r) => r.status < 500 });
  sleep(1);
}
