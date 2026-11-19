/** IPv4 ranges the API never connects to (private, loopback, link-local, CGNAT, unspecified). */
export const BLOCKED_IPV4_CIDRS: readonly string[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
];

/** IPv6 ranges the API never connects to. */
export const BLOCKED_IPV6_CIDRS: readonly string[] = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10'];

function parseIpv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** Eight 16-bit groups, or null when `s` is not an IPv6 address. */
function parseIpv6(s: string): number[] | null {
  if (!s.includes(':')) return null;
  let text = s;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string): number[] | null => {
    if (h === '') return [];
    const out: number[] = [];
    for (const g of h.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toGroups(halves[1] ?? '');
  if (rest === null) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function inV4Cidr(ip: number, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const b = parseIpv4(base ?? '');
  const len = Number(bits);
  if (b === null) return false;
  const size = 2 ** (32 - len);
  return Math.floor(ip / size) === Math.floor(b / size);
}

function inV6Cidr(groups: number[], cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const b = parseIpv6(base ?? '');
  if (b === null) return false;
  let left = Number(bits);
  for (let i = 0; i < 8 && left > 0; i++) {
    const take = Math.min(16, left);
    const shift = 16 - take;
    if ((groups[i] ?? 0) >> shift !== (b[i] ?? 0) >> shift) return false;
    left -= take;
  }
  return true;
}

/** True for an IPv4 dotted quad or IPv6 address (no brackets) in a blocked range; IPv4-mapped IPv6 is judged by its IPv4 part; a non-IP string is false. */
export function isBlockedIp(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return BLOCKED_IPV4_CIDRS.some((c) => inV4Cidr(v4, c));
  const g = parseIpv6(address);
  if (g === null) return false;
  // IPv4 embedded in IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d) and NAT64 (64:ff9b::/96) are judged by
  // their IPv4 part.
  const zeros = g.slice(0, 5).every((x) => x === 0);
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if ((zeros && (g[5] === 0xffff || g[5] === 0)) || nat64) {
    const ip = (g[6] ?? 0) * 65536 + (g[7] ?? 0);
    return BLOCKED_IPV4_CIDRS.some((c) => inV4Cidr(ip, c));
  }
  return BLOCKED_IPV6_CIDRS.some((c) => inV6Cidr(g, c));
}
