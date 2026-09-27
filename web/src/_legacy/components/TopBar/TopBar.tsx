import { useState, useEffect } from 'react';
import './TopBar.scss';

interface TopBarProps {
  alertCount?: number;
  activeModule?: string;
}

export default function TopBar({ alertCount = 0 }: TopBarProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = time.toLocaleTimeString('en-AE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const dateStr = time.toLocaleDateString('en-AE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <header className="topbar">
      {/* Left: Logos */}
      <div className="topbar__left">
        {/* DSO Logo */}
        <div className="topbar__logo topbar__logo--dso">
          <div className="topbar__logo-hex">
            {/* <svg viewBox="0 0 32 32" width="32" height="32">
              <polygon
                points="16,2 29,9.5 29,22.5 16,30 3,22.5 3,9.5"
                fill="none"
                stroke="#00E5FF"
                strokeWidth="1.5"
              />
              <text x="16" y="21" textAnchor="middle" fill="#00E5FF" fontSize="9" fontWeight="700" fontFamily="monospace">DSO</text>
            </svg> */}
            <img src="./dso_logo_bg_transperant.png" alt="DSO Logo" width={"100px"} height={"100px"}/>
          </div>
          {/* <div className="topbar__logo-text">
            <span className="topbar__logo-main">DIGITAL TWIN</span>
            <span className="topbar__logo-sub">Dubai Silicon Oasis</span>
          </div> */}
        </div>

        <div className="topbar__divider" />

        {/* Intel Logo */}
        <div className="topbar__logo topbar__logo--intel">
          <div className="topbar__intel-badge">
            <span className="topbar__intel-text">intel</span>
            <span className="topbar__intel-dot">®</span>
          </div>
          <span className="topbar__intel-label">Powered Platform</span>
        </div>
      </div>

      {/* Center: Title */}
      <div className="topbar__center">
        <div className="topbar__title">SMART CITY COMMAND CENTER</div>
        <div className="topbar__title-sub">DUBAI SILICON OASIS</div>
      </div>

      {/* Right: Alerts + Status + Clock */}
      <div className="topbar__right">
        {/* Alert badge */}
        <div className={`topbar__alerts ${alertCount > 0 ? 'topbar__alerts--active' : ''}`}>
          <span className="topbar__alerts-icon">⚠</span>
          <span className="topbar__alerts-count">{alertCount}</span>
          <span className="topbar__alerts-label">Active</span>
        </div>

        {/* System status */}
        <div className="topbar__status topbar__status--active">
          <span className="topbar__status-icon">▲</span>
          <span className="topbar__status-text">ACTIVE</span>
        </div>

        {/* Online status */}
        <div className="topbar__status topbar__status--online">
          <span className="topbar__status-dot" />
          <span className="topbar__status-text">ONLINE</span>
        </div>

        {/* Clock */}
        <div className="topbar__clock">
          <span className="topbar__clock-time">{timeStr}</span>
          <span className="topbar__clock-date">{dateStr}</span>
        </div>
      </div>
    </header>
  );
}
