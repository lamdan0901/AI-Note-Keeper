import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import App from './App';
import { WebAuthProvider } from './auth/AuthContext';
import { BackendContext } from '../../../packages/shared/backend/context';
import { ConvexBackendClient, convexBackendHooks } from '../../../packages/shared/backend/convex';
import { AppwriteBackendClient } from '../../../packages/shared/backend/appwrite';
import { createAppwriteClient } from '../../../packages/shared/appwrite/client';
import { Account, Databases, Functions } from 'appwrite';
import './styles.css';

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const appwriteEndpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined;
const appwriteProjectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined;
const notesSyncFunctionId = import.meta.env.VITE_APPWRITE_NOTES_SYNC_FUNCTION_ID as
  | string
  | undefined;
const remindersApiFunctionId = import.meta.env.VITE_APPWRITE_REMINDERS_API_FUNCTION_ID as
  | string
  | undefined;
const subscriptionsApiFunctionId = import.meta.env.VITE_APPWRITE_SUBSCRIPTIONS_API_FUNCTION_ID as
  | string
  | undefined;

if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL is not configured. Set it in your .env file.');
}

const convex = new ConvexReactClient(convexUrl);
const convexDelegate = new ConvexBackendClient(convexUrl);

const backendClient: AppwriteBackendClient | ConvexBackendClient =
  appwriteEndpoint && appwriteProjectId
    ? (() => {
        const awClient = createAppwriteClient(appwriteEndpoint, appwriteProjectId);
        return new AppwriteBackendClient(
          new Account(awClient),
          convexDelegate,
          new Databases(awClient),
          new Functions(awClient),
          notesSyncFunctionId,
          remindersApiFunctionId,
          subscriptionsApiFunctionId,
        );
      })()
    : convexDelegate;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <BackendContext.Provider value={{ client: backendClient, hooks: convexBackendHooks }}>
        <WebAuthProvider>
          <App />
        </WebAuthProvider>
      </BackendContext.Provider>
    </ConvexProvider>
  </React.StrictMode>,
);
