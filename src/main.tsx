import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { OwnerGate } from './Auth';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><OwnerGate>{(user, signOut) => <App ownerEmail={user.email} onSignOut={signOut} />}</OwnerGate></React.StrictMode>);
