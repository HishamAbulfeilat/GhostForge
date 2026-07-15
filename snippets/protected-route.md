# protected-route

## Purpose
Protected route examples for both web and mobile navigation.

## Code
```tsx
// Web
import { Navigate, Outlet } from 'react-router-dom';

export function ProtectedRoute({ isAuthenticated }: { isAuthenticated: boolean }) {
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
```

```tsx
// React Native
import { Stack } from 'expo-router';

export function ProtectedStack({ isAuthenticated }: { isAuthenticated: boolean }) {
  if (!isAuthenticated) return <Stack.Screen name="login" />;
  return <Stack.Screen name="(app)" />;
}
```
