import { useEffect, useState } from "react";
import { formatGovClock } from "../../shared/format/formatDate";

// The clock ticks once a second. Kept in its own component so that tick only
// re-renders this <span>, instead of re-rendering the entire login page — with
// the form, the CAPTCHA and every inline style object rebuilt each second.
export function ServerClock() {
  const [now, setNow] = useState("");

  useEffect(() => {
    const update = () => setNow(formatGovClock(new Date()) + " IST");
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return <span>{now || "Secure Server Time"}</span>;
}
