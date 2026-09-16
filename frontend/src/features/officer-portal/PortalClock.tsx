import { useEffect, useState } from "react";
import { formatGovClock } from "../../shared/format/formatDate";

// The clock ticks once a second. Isolated in its own component so that tick
// re-renders this one <span> instead of the entire portal, which would
// otherwise rebuild every inline style object and every ticket card each second.
export function PortalClock() {
  const [now, setNow] = useState(() => formatGovClock(new Date()));

  useEffect(() => {
    const interval = setInterval(() => setNow(formatGovClock(new Date())), 1000);
    return () => clearInterval(interval);
  }, []);

  return <>{now}</>;
}
