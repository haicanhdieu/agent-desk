import { Banner, Button, Icon } from '@/ds';

export interface InvitationsBannerProps {
  count: number;
  href: string;
}

/** The neutral "You have N pending invitation(s)." strip at the top of the Projects page. */
export function InvitationsBanner({ count, href }: InvitationsBannerProps) {
  if (count < 1) return null;
  return (
    <Banner
      tone="off"
      live="polite"
      centered
      icon={<Icon name="mail" size={18} />}
      title={count === 1 ? 'You have 1 pending invitation.' : `You have ${count} pending invitations.`}
      actions={
        <Button size="sm" href={href}>
          View
        </Button>
      }
    />
  );
}
