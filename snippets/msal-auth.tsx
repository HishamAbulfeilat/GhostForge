import * as React from 'react';
import {
  EventType,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type Configuration,
  type PopupRequest,
  type SilentRequest
} from '@azure/msal-browser';
import {
  MsalProvider,
  useAccount,
  useIsAuthenticated,
  useMsal
} from '@azure/msal-react';

const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID ?? '',
    authority: process.env.NEXT_PUBLIC_AZURE_AD_AUTHORITY ?? '',
    redirectUri:
      process.env.NEXT_PUBLIC_AZURE_AD_REDIRECT_URI ??
      (typeof window !== 'undefined' ? window.location.origin : '')
  },
  cache: {
    cacheLocation: 'sessionStorage'
  }
};

export const msalInstance = new PublicClientApplication(msalConfig);

void msalInstance.initialize().then(() => {
  const activeAccount = msalInstance.getActiveAccount();
  const firstAccount = msalInstance.getAllAccounts()[0];

  if (!activeAccount && firstAccount) {
    msalInstance.setActiveAccount(firstAccount);
  }

  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      msalInstance.setActiveAccount(event.payload.account);
    }
  });
});

export function AuthProvider({ children }: React.PropsWithChildren) {
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}

export function useMsalAccountInfo() {
  const { accounts } = useMsal();
  const account = useAccount(accounts[0] ?? null);
  const isAuthenticated = useIsAuthenticated();

  return {
    account,
    isAuthenticated,
    displayName: account?.name ?? '',
    username: account?.username ?? ''
  };
}

interface AccessTokenOptions {
  scopes: string[];
}

export function useAccessToken() {
  const { instance, accounts } = useMsal();

  return React.useCallback(
    async ({ scopes }: AccessTokenOptions) => {
      const account = instance.getActiveAccount() ?? accounts[0];

      if (!account) {
        throw new Error('No active account found.');
      }

      const silentRequest: SilentRequest = {
        account,
        scopes
      };

      try {
        const response = await instance.acquireTokenSilent(silentRequest);
        return response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          const popupRequest: PopupRequest = {
            account,
            scopes
          };

          const response = await instance.acquireTokenPopup(popupRequest);
          return response.accessToken;
        }

        throw error;
      }
    },
    [accounts, instance]
  );
}

interface AuthGuardOptions {
  scopes?: string[];
}

export function useAuthGuard(options: AuthGuardOptions = {}) {
  const { instance, inProgress, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  React.useEffect(() => {
    if (inProgress !== 'none' || isAuthenticated) {
      return;
    }

    void instance.loginRedirect({
      scopes: options.scopes ?? ['openid', 'profile', 'email'],
      account: accounts[0]
    });
  }, [accounts, inProgress, instance, isAuthenticated, options.scopes]);

  return {
    isAuthenticated,
    isLoading: inProgress !== 'none'
  };
}
