import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Report from './Report';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {import.meta.env.VITE_REPORT_ONLY ? <Report /> : <App />}
  </React.StrictMode>,
);
