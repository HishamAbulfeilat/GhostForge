# zustand-store

## Purpose
Zustand store with `persist` and `devtools` middleware.

## Code
```ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

type SessionState = {
  userId: string | null;
  setUserId: (userId: string | null) => void;
};

export const useSessionStore = create<SessionState>()(
  devtools(
    persist(
      set => ({
        userId: null,
        setUserId: userId => set({ userId }),
      }),
      { name: 'session-store' }
    )
  )
);
```
