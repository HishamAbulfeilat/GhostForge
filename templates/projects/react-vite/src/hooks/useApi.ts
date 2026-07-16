import { useMemo } from 'react';
import axios, { type AxiosInstance } from 'axios';

export function useApi(): AxiosInstance {
  return useMemo(() => {
    const instance = axios.create({
      baseURL: import.meta.env.VITE_API_BASE_URL,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    instance.interceptors.response.use(
      (response) => response,
      async (error) => Promise.reject(error)
    );

    return instance;
  }, []);
}
