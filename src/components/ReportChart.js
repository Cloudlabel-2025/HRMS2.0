'use client';

import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export default function ReportChart({ type, labels, datasets }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current.getContext('2d'), {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { size: 11 }, ...(type === 'bar' ? { boxWidth: 10 } : {}) },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#f1f5f9' } },
        },
      },
    });

    return () => chart.destroy();
  }, [type, labels, datasets]);

  return <canvas ref={ref} />;
}
