# auth-interceptor

## Purpose
Axios auth interceptor with access-token injection and refresh-token retry.

## Code
```ts
import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];

api.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  response => response,
  async error => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) throw error;

    if (isRefreshing) {
      return new Promise(resolve => {
        queue.push(token => {
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = localStorage.getItem('refreshToken');
      const { data } = await axios.post('/auth/refresh', { refreshToken });
      localStorage.setItem('accessToken', data.accessToken);
      queue.forEach(replay => replay(data.accessToken));
      queue = [];
      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
```
