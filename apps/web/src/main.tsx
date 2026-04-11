import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import App from './App';
import { WebAuthProvider } from './auth/AuthContext';
import { BackendContext } from '../../../packages/shared/backend/context';
import { ConvexBackendClient, convexBackendHooks } from '../../../packages/shared/backend/convex';
import './styles.css';

const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
const convex = new ConvexReactClient(convexUrl);
const backendClient = new ConvexBackendClient(convexUrl);

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
