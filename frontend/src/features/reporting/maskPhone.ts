// "+91••••••3210": enough for the reporter to recognise their number without
// showing all of it to anyone looking over their shoulder.
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  const cc = phone.match(/^\+(?:1|44|61|91|971)/)?.[0] ?? "";
  return `${cc}${"•".repeat(Math.max(0, phone.length - cc.length - 4))}${phone.slice(-4)}`;
}
