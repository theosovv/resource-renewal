import type { RequestStatus } from '../api/client';
import { requestStatusLabels } from '../lib/format';

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      {requestStatusLabels[status]}
    </span>
  );
}
