import http from 'k6/http';
import { check } from 'k6';

export const options = {
    scenarios: {
        benchmark: {
            executor: 'shared-iterations',
            vus: 100,
            iterations: 1000,
            maxDuration: '2m',
        },
    },
};
export default function () {
    const payload = JSON.stringify({
        originalUrl: `https://example.com/test-${__VU}-${__ITER}`
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const res = http.post(
        'http://localhost:5002/api/shorten',
        payload,
        params
    );

    check(res, {
        'status is successful': (r) => r.status >= 200 && r.status < 300,
    });
}