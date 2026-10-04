import { useEffect, useState } from 'react';

/** The time now, refreshed every `every` ms while the component is shown (countdowns, "next check in"). */
export function useNow(every = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}
