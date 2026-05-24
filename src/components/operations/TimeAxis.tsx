'use client';

interface Props {
  hours: string[];
}

export function TimeAxis({ hours }: Props) {
  return (
    <div className="flex flex-col w-16 shrink-0 pt-20" style={{ borderLeft: '1px solid rgba(212, 175, 55, 0.1)' }}>
      {hours.map((hour) => (
        <div
          key={hour}
          className="h-24 flex items-start justify-center pt-2 text-xs font-medium"
          style={{ color: '#a1a1aa' }}
        >
          {formatHour(hour)}
        </div>
      ))}
    </div>
  );
}

function formatHour(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'ص' : 'م';
  return `${hour12} ${ampm}`;
}
