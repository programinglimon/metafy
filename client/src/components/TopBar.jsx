import React from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function TopBar() {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <div className="mark"><span className="dot" />SHEET / METADATA</div>
      <div className="topbar-right">
        <span className="user-email mono">{user?.email}</span>
        <button className="btn-ghost" onClick={logout} type="button">sign out</button>
      </div>
    </div>
  );
}
