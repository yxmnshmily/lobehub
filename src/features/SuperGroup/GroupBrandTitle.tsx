import { ProductLogo } from '@/components/Branding';

/** Keep the site identity and group name together without squeezing the logo. */
export default function GroupBrandTitle({ title }: { title: string }) {
  return (
    <span
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        gap: 6,
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <ProductLogo size={24} style={{ flexShrink: 0 }} type="flat" />
      <span
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={title}
      >
        {title}
      </span>
    </span>
  );
}
