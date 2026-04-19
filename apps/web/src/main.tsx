import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WebAuthProvider } from './auth/AuthContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebAuthProvider>
      <App />
    </WebAuthProvider>
  </React.StrictMode>,
);
