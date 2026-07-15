# azure-ad-login

## Purpose
MSAL login hook for Azure AD authentication.

## Code
```ts
import { useMsal } from '@azure/msal-react';

const loginRequest = { scopes: ['User.Read'] };

export function useAzureAdLogin() {
  const { instance } = useMsal();

  const login = async () => {
    const result = await instance.loginPopup(loginRequest);
    return result.account;
  };

  const logout = () => instance.logoutPopup();

  return { login, logout };
}
```
