import type {ReactNode} from 'react';

export type BadgeTone = 'info' | 'good' | 'warn' | 'bad';

interface Props {
  children: ReactNode;
  type?: BadgeTone;
}

export function Badge({children, type = 'info'}: Props) {
  return <span className={`badge ${type}`}>{children}</span>;
}
