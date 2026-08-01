import type { Metadata } from 'next'
import DashboardNav from './DashboardNav'

export const metadata: Metadata = {
  title: 'Redactioneel dashboard',
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap page-in" style={{ paddingBottom: 80 }}>
      <div className="dash-hdr">
        <div className="dash-title">Redactioneel dashboard</div>
        <div className="dash-sub">Inzicht in wat Stadsgeest afgraast, oppikt en laat liggen — geen bedieningspaneel.</div>
      </div>
      <DashboardNav />
      {children}
    </div>
  )
}
